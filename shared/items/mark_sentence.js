// Item type: mark_sentence — "Satz markieren" (mark the target words) and
// "falsche Wörter streichen" (strike/correct the wrong words). The teacher
// writes a sentence; the editor splits it into word chips; each word can be
// flagged as a target (mark mode) or as wrong with an optional correction
// (correct mode).
//
// Config:
//   mode: 'mark' | 'correct'
//   words: [{ text, target: 'none'|'mark'|'wrong', fix?: string }]
// Response:
//   { selected: [wordIndex...], fixes: { [wordIndex]: "correction" } }
// Targets and fixes never reach the student payload.
import { normalizeText } from '../util.js';
import {
  asArray,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'mark_sentence';
export const meta = {
  label: { en: 'Mark / correct words in a sentence', de: 'Satz markieren / Wörter streichen' },
  scoreable: true,
  category: 'assessment',
};

export const MODES = ['mark', 'correct'];
export const TARGETS = ['none', 'mark', 'wrong'];

export function defaultConfig() {
  return {
    mode: 'mark',
    words: [
      { text: 'Der', target: 'none', fix: '' },
      { text: 'Vogel', target: 'mark', fix: '' },
      { text: 'singt.', target: 'none', fix: '' },
    ],
  };
}

export function defaultPoints() {
  return 2;
}

function normalizeWord(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const target = TARGETS.includes(src.target) ? src.target : 'none';
  return {
    text: asString(src.text).slice(0, 200),
    target,
    fix: target === 'wrong' ? asString(src.fix).slice(0, 200) : '',
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const words = (asArray(src.words).length > 0 ? asArray(src.words) : defaultConfig().words).slice(0, 120).map(normalizeWord);
  return { mode: MODES.includes(src.mode) ? src.mode : 'mark', words };
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  return normalizeBaseItem(src, type, normalizeConfig(src.config), defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return errors;
  if (!MODES.includes(config.mode)) errors.push('config.mode: must be "mark" or "correct"');
  const words = asArray(config.words);
  if (words.length < 1) errors.push('config.words: at least one word is required');
  if (words.length > 120) errors.push('config.words: at most 120 words are allowed');
  words.forEach((word, index) => {
    if (!word || typeof word !== 'object') {
      errors.push(`config.words[${index}]: must be an object`);
      return;
    }
    if (typeof word.text !== 'string') errors.push(`config.words[${index}].text: must be a string`);
    if (!TARGETS.includes(word.target)) errors.push(`config.words[${index}].target: invalid`);
    if (word.target === 'wrong' && config.mode === 'correct' && typeof word.fix === 'string' && word.fix.trim() === '') {
      // fix optional — teacher may only want the strike
    }
  });
  const targets = words.filter((word) => word && word.target !== 'none');
  if (targets.length === 0) errors.push('config.words: at least one word must be a target (mark/wrong)');
  return errors;
}

export function normalizeResponse(item, raw) {
  const normalized = normalizeItem(item);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const maxIndex = normalized.config.words.length - 1;
  const rawSelected = asArray(source.selected).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= maxIndex);
  const selected = [...new Set(rawSelected)].slice(0, normalized.config.words.length);
  const rawFixes = source.fixes && typeof source.fixes === 'object' && !Array.isArray(source.fixes) ? source.fixes : {};
  const fixes = {};
  for (const [key, value] of Object.entries(rawFixes)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index <= maxIndex && typeof value === 'string') {
      fixes[index] = value.slice(0, 200);
    }
  }
  return { selected, fixes };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const words = normalized.config.words;
  const mode = normalized.config.mode;
  const maxScore = normalized.points;
  const resp = response && typeof response === 'object' ? response : {};
  const selected = new Set(asArray(resp.selected).map((value) => Number(value)));
  const fixes = resp.fixes && typeof resp.fixes === 'object' ? resp.fixes : {};

  // scorable words: in mark mode → target 'mark'; in correct mode → target 'wrong'
  const scorable = words.map((word, index) => ({ word, index })).filter(({ word }) => word.target === (mode === 'mark' ? 'mark' : 'wrong'));
  const total = scorable.length;
  let hit = 0;
  const detail = [];
  for (const { word, index } of scorable) {
    const wasSelected = selected.has(index);
    let ok = wasSelected;
    if (ok && mode === 'correct' && word.fix && word.fix.trim() !== '') {
      const given = typeof fixes[index] === 'string' ? fixes[index] : '';
      ok = normalizeText(given, { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true }) ===
        normalizeText(word.fix, { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true });
    }
    if (ok) hit += 1;
    detail.push({ index, text: word.text, selected: wasSelected, fixGiven: fixes[index] || null, ok });
  }
  // wrongly selected non-target words reduce the score
  const wrongSelected = [...selected].filter((index) => words[index] && words[index].target === 'none').length;
  return makeResult({
    autoScore: total > 0 ? roundScore((maxScore * Math.max(0, hit - wrongSelected)) / total) : 0,
    maxScore,
    correct: total > 0 && hit === total && wrongSelected === 0,
    needsManual: false,
    correctParts: hit,
    totalParts: total,
    detail: { mode, words: detail, wrongSelected },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      mode: normalized.config.mode,
      // target/fix are the answer key — stripped for students
      words: normalized.config.words.map((word) => ({ text: word.text })),
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const resp = response && typeof response === 'object' ? response : {};
  const selected = asArray(resp.selected).map((value) => Number(value));
  return selected.map((index) => (normalized.config.words[index] || {}).text || `#${index}`).join(' ').slice(0, 140) || '–';
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const selected = [];
  const fixes = {};
  normalized.config.words.forEach((word, index) => {
    if (word.target !== 'none') {
      selected.push(index);
      if (word.fix) fixes[index] = word.fix;
    }
  });
  return { selected, fixes };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => word.target !== 'none')
    .map(({ word, index }) => {
      if (word.target === 'wrong') return `#${index + 1} „${word.text}“ → „${word.fix || '?'}“`;
      return `#${index + 1} „${word.text}“`;
    });
}

// The real editor is the word-chip list (renderMarkSentenceEditor in the teacher app).
export function editSchema() {
  return [{ key: 'words', kind: 'list', label: { en: 'Words', de: 'Wörter' }, min: 1, max: 120 }];
}
