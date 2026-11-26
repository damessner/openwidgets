// Item type: writing — a writing task with AI feedback. The student writes a
// text (response { text }); the teacher defines criteria with weights, a
// grade level and optional source material. The LLM feedback loop is served
// by POST /api/llm/writing-feedback (pseudonymized, rate limited) and stored
// in writing_feedback — this module only defines the item shape and keeps
// the criteria configuration server-side on sanitize where useful.
import { asArray, asBool, asFiniteNumber, asString, makeResult, normalizeBaseItem, roundScore, sanitizeBaseItem, validateBaseItem } from './common.js';
import { shortId } from '../util.js';

export const type = 'writing';

export const meta = {
  label: { en: 'Writing task (AI feedback)', de: 'Schreibaufgabe (KI-Feedback)' },
  scoreable: true, // graded manually by the teacher (needsManual), like long_answer
  category: 'manual',
};

export const MAX_CRITERIA = 8;
export const MAX_SOURCE_TEXT = 20000;
export const MAX_REQUIRED_WORDS = 12;
export const MAX_REQUIRED_WORD_LEN = 40;
export const MAX_HINTS = 3;
export const MAX_HINT_LEN = 500;

export function defaultConfig() {
  return {
    gradeLevel: '',
    sourceText: '',
    criteria: [{ id: 'c1', label: 'Inhalt', weight: 40, description: '' }],
    minWords: 0,
    maxWords: 3000,
    allowLoops: true,
    requiredWords: [],
    hints: [],
  };
}

function normalizeWordList(value, max, maxLen) {
  const list = asArray(value)
    .map((entry) => asString(entry).trim().replace(/\s+/g, ' '))
    .filter((entry) => entry.length > 0)
    .slice(0, max)
    .map((entry) => entry.slice(0, maxLen));
  return [...new Set(list)];
}

/**
 * Word-boundary, case-insensitive matching of required words/phrases in a text.
 * Returns { used: string[], missing: string[] } (used/missing as given in words).
 */
export function findUsedWords(text, words) {
  const source = String(text || '');
  const used = [];
  const missing = [];
  for (const word of asArray(words)) {
    const w = String(word || '').trim();
    if (!w) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu');
    if (pattern.test(source)) used.push(w);
    else missing.push(w);
  }
  return { used, missing };
}

export function defaultPoints() {
  return 5;
}

function normalizeCriterion(raw, index) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    id: typeof src.id === 'string' && src.id.trim() ? src.id.trim().slice(0, 40) : `c${index + 1}`,
    label: asString(src.label).slice(0, 120),
    weight: Math.max(0, Math.min(100, asFiniteNumber(src.weight, 0))),
    description: asString(src.description).slice(0, 500),
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const criteria = asArray(src.criteria)
    .slice(0, MAX_CRITERIA)
    .map((entry, index) => normalizeCriterion(entry, index));
  if (!criteria.length) criteria.push(normalizeCriterion({}, 0));
  return {
    gradeLevel: asString(src.gradeLevel).slice(0, 40),
    sourceText: asString(src.sourceText).slice(0, MAX_SOURCE_TEXT),
    criteria,
    minWords: Math.max(0, Math.min(100000, asFiniteNumber(src.minWords, 0))),
    maxWords: Math.max(1, Math.min(100000, asFiniteNumber(src.maxWords, 3000))),
    allowLoops: asBool(src.allowLoops, true),
    requiredWords: normalizeWordList(src.requiredWords, MAX_REQUIRED_WORDS, MAX_REQUIRED_WORD_LEN),
    hints: normalizeWordList(src.hints, MAX_HINTS, MAX_HINT_LEN),
  };
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

  const criteria = asArray(config.criteria);
  if (criteria.length < 1) errors.push('config.criteria: at least one criterion is required');
  if (criteria.length > MAX_CRITERIA) errors.push(`config.criteria: at most ${MAX_CRITERIA} criteria are allowed`);
  const seen = new Set();
  criteria.forEach((criterion, index) => {
    const c = criterion && typeof criterion === 'object' ? criterion : {};
    if (!asString(c.label).trim()) errors.push(`config.criteria[${index}].label: must not be empty`);
    if (seen.has(c.id)) errors.push(`config.criteria[${index}].id: duplicate id "${c.id}"`);
    seen.add(c.id);
    if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100) {
      errors.push(`config.criteria[${index}].weight: must be a number between 0 and 100`);
    }
  });
  if (asString(config.sourceText).length > MAX_SOURCE_TEXT) {
    errors.push(`config.sourceText: at most ${MAX_SOURCE_TEXT} characters`);
  }
  const requiredWords = asArray(config.requiredWords);
  if (requiredWords.length > MAX_REQUIRED_WORDS) {
    errors.push(`config.requiredWords: at most ${MAX_REQUIRED_WORDS} words are allowed`);
  }
  requiredWords.forEach((word, index) => {
    if (asString(word).trim().length > MAX_REQUIRED_WORD_LEN) {
      errors.push(`config.requiredWords[${index}]: at most ${MAX_REQUIRED_WORD_LEN} characters per word`);
    }
  });
  const hints = asArray(config.hints);
  if (hints.length > MAX_HINTS) {
    errors.push(`config.hints: at most ${MAX_HINTS} hints are allowed`);
  }
  hints.forEach((hint, index) => {
    if (asString(hint).length > MAX_HINT_LEN) {
      errors.push(`config.hints[${index}]: at most ${MAX_HINT_LEN} characters per hint`);
    }
  });
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = asString(source.text);
  if (text.length > 100000) throw new Error('writing response text is too long');
  return { text };
}

export function score(item) {
  // Writing tasks are graded manually by the teacher; AI feedback is formative.
  const normalized = normalizeItem(item);
  return makeResult({
    autoScore: 0,
    maxScore: roundScore(normalized.points),
    correct: false,
    needsManual: true,
    correctParts: 0,
    totalParts: 1,
    detail: {},
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  // Students see the criteria labels + weights (transparent rubric) and the
  // source material; the detailed criterion descriptions stay teacher-side.
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      gradeLevel: normalized.config.gradeLevel,
      sourceText: normalized.config.sourceText,
      criteria: normalized.config.criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight })),
      minWords: normalized.config.minWords,
      maxWords: normalized.config.maxWords,
      allowLoops: normalized.config.allowLoops,
      requiredWords: normalized.config.requiredWords,
      hints: normalized.config.hints,
    },
  };
}

export function summarizeResponse(item, response) {
  const text = asString(response && response.text);
  return text.replace(/\s+/g, ' ').slice(0, 120);
}

export function answerText() {
  return [];
}

export function safeDetail() {
  return null;
}

export function editSchema() {
  return [
    {
      key: 'gradeLevel',
      kind: 'text',
      label: { en: 'Grade level', de: 'Jahrgangsstufe' },
      help: { en: 'e.g. "7th grade" — calibrates the feedback complexity.', de: 'z. B. „7. Klasse“ — steuert die Komplexität des Feedbacks.' },
    },
    {
      key: 'sourceText',
      kind: 'textarea',
      label: { en: 'Source material (optional)', de: 'Quellmaterial (optional)' },
      help: { en: 'Background text the pupil should work with.', de: 'Hintergrundtext, mit dem gearbeitet werden soll.' },
    },
    {
      key: 'minWords',
      kind: 'number',
      label: { en: 'Min. words', de: 'Min. Wörter' },
    },
    {
      key: 'maxWords',
      kind: 'number',
      label: { en: 'Max. words', de: 'Max. Wörter' },
    },
    {
      key: 'allowLoops',
      kind: 'switch',
      label: { en: 'Allow interim AI feedback loops', de: 'Zwischenfeedback (KI) erlauben' },
    },
    {
      key: 'requiredWords',
      kind: 'list',
      primitive: 'lines',
      label: { en: 'Required words (word box — must be used in the text)', de: 'Pflichtwörter (Wortbox — müssen im Text verwendet werden)' },
      help: { en: 'One word or short phrase per line (max 12). Used words are highlighted green in the text and struck through in the word box.', de: 'Ein Wort oder kurzer Ausdruck pro Zeile (max. 12). Verwendete Wörter werden im Text grün markiert und in der Wortbox durchgestrichen.' },
    },
    {
      key: 'hints',
      kind: 'list',
      primitive: 'lines',
      label: { en: 'Step-by-step hints (shown before writing starts, max 3)', de: 'Schritt-für-Schritt-Hinweise (vor Schreibbeginn, max. 3)' },
      help: { en: 'Short hints the pupil clicks through one by one before the text field unlocks.', de: 'Kurze Hinweise, die der Schüler/die Schülerin vor dem Freischalten des Textfelds durchklickt.' },
    },
  ];
}

export { shortId };
