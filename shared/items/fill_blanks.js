// Item type: fill_blanks — a text with <<n>> gaps; each gap accepts a list of
// answers. Scoring is per gap with equal weight.
// mode "input" = type the answer, mode "drag" = drag words from a word bank
// (config.wordBank) into the gaps. Legacy {{n}} markers are still parsed and
// canonicalized to <<n>> on normalize.
import { eqScore, normalizeText } from '../util.js';
import {
  asArray,
  asBool,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'fill_blanks';

export const meta = {
  label: { en: 'Fill in the blanks', de: 'Lückentext' },
  scoreable: true,
  category: 'assessment',
};

// Canonical gap marker: <<1>>. Legacy {{1}} is accepted and rewritten on normalize.
const GAP_PATTERN = /<<\s*([A-Za-z0-9_]+)\s*>>|\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const LEGACY_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function defaultConfig() {
  return {
    text: 'Lückentext <<1>>',
    blanks: { 1: { accepted: [] } },
    caseSensitive: false,
    mode: 'input',
    wordBank: [],
  };
}

export function defaultPoints() {
  return 2;
}

/** Unique gap keys in the order they appear in the text (<<n>> or legacy {{n}}). */
export function gapKeys(text) {
  const keys = [];
  const source = asString(text);
  GAP_PATTERN.lastIndex = 0;
  let match = GAP_PATTERN.exec(source);
  while (match) {
    const key = match[1] || match[2];
    if (key && !keys.includes(key)) keys.push(key);
    match = GAP_PATTERN.exec(source);
  }
  return keys;
}

/** Rewrite legacy {{n}} markers to the canonical <<n>> form. */
export function canonicalizeText(text) {
  return asString(text).replace(new RegExp(LEGACY_PATTERN.source, 'g'), (whole, key) => `<<${key}>>`);
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const text = canonicalizeText(src.text);
  const rawBlanks = src.blanks && typeof src.blanks === 'object' && !Array.isArray(src.blanks) ? src.blanks : {};
  const keys = gapKeys(text);
  for (const key of Object.keys(rawBlanks)) {
    if (!keys.includes(key)) keys.push(key);
  }
  const blanks = {};
  for (const key of keys.slice(0, 50)) {
    const entry = rawBlanks[key];
    const accepted = entry && typeof entry === 'object' ? asArray(entry.accepted) : [];
    blanks[key] = {
      accepted: accepted.filter((value) => typeof value === 'string').slice(0, 50),
    };
  }
  const mode = src.mode === 'drag' ? 'drag' : 'input';
  const wordBank = asArray(src.wordBank)
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.slice(0, 200))
    .slice(0, 60);
  return { text, blanks, caseSensitive: asBool(src.caseSensitive, false), mode, wordBank };
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

  if (typeof config.text !== 'string') {
    errors.push('config.text: must be a string');
    return errors;
  }
  if (config.text.length > 20000) errors.push('config.text: must be at most 20000 characters');
  const keys = gapKeys(config.text);
  if (keys.length === 0) errors.push('config.text: add at least one gap like <<1>>');
  if (keys.length > 50) errors.push('config.text: at most 50 gaps are supported');

  const blanks = config.blanks && typeof config.blanks === 'object' ? config.blanks : {};
  for (const key of keys) {
    const entry = blanks[key];
    if (!entry || typeof entry !== 'object') {
      errors.push(`config.blanks.${key}: missing answers for gap <<${key}>>`);
      continue;
    }
    const accepted = asArray(entry.accepted);
    accepted.forEach((value, index) => {
      if (typeof value !== 'string') errors.push(`config.blanks.${key}.accepted[${index}]: must be a string`);
    });
  }
  for (const key of Object.keys(blanks)) {
    if (!keys.includes(key)) errors.push(`config.blanks.${key}: gap is not used in the text`);
  }
  if (typeof config.caseSensitive !== 'boolean') errors.push('config.caseSensitive: must be a boolean');

  const mode = config.mode === 'drag' ? 'drag' : 'input';
  if (config.mode !== undefined && mode !== config.mode) errors.push('config.mode: must be "input" or "drag"');
  if (mode === 'drag') {
    const wordBank = asArray(config.wordBank).filter((value) => typeof value === 'string');
    if (wordBank.length === 0) errors.push('config.wordBank: in drag mode at least one word is required');
    if (wordBank.length > 60) errors.push('config.wordBank: at most 60 words are supported');
    // every accepted answer must be available in the word bank, otherwise the gap is unsolvable
    const bank = new Set(wordBank.map((value) => value.trim()));
    for (const key of keys) {
      const accepted = asArray(blanks[key] && blanks[key].accepted);
      for (const answer of accepted) {
        if (typeof answer === 'string' && answer.trim() !== '' && !bank.has(answer.trim())) {
          errors.push(`config.wordBank: missing the answer "${answer.trim()}" for gap <<${key}>>`);
        }
      }
    }
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawBlanks = source.blanks;
  if (rawBlanks !== undefined && (typeof rawBlanks !== 'object' || Array.isArray(rawBlanks))) {
    throw new Error('fill_blanks response needs { blanks: { "1": "text" } }');
  }
  const given = rawBlanks && typeof rawBlanks === 'object' ? rawBlanks : {};
  const normalized = normalizeItem(item);
  const out = {};
  for (const key of gapKeys(normalized.config.text)) {
    const value = given[key];
    if (value === undefined || value === null) out[key] = '';
    else if (typeof value === 'string') out[key] = value.slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
    else throw new Error(`fill_blanks response for gap "${key}" must be a string`);
  }
  return { blanks: out };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const maxScore = normalized.points;
  const keys = gapKeys(config.text);
  const options = { caseSensitive: config.caseSensitive, trim: true, collapseSpaces: true, ignorePunctuation: false };
  const given = response && response.blanks && typeof response.blanks === 'object' ? response.blanks : {};
  const detail = { blanks: {} };
  let correctCount = 0;

  for (const key of keys) {
    const accepted = asArray(config.blanks[key] && config.blanks[key].accepted)
      .map((value) => normalizeText(value, options))
      .filter((value) => value !== '');
    const normalizedGiven = normalizeText(given[key], options);
    const correct = normalizedGiven !== '' && accepted.includes(normalizedGiven);
    if (correct) correctCount += 1;
    detail.blanks[key] = { correct, given: normalizedGiven };
  }

  const total = keys.length;
  const autoScore = total > 0 ? roundScore((maxScore * correctCount) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && correctCount === total,
    needsManual: false,
    correctParts: correctCount,
    totalParts: total,
    detail,
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  // The word bank is public by design (it is the word box shown to students);
  // the accepted answers per gap stay server-side.
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      text: normalized.config.text,
      caseSensitive: normalized.config.caseSensitive,
      mode: normalized.config.mode,
      wordBank: [...normalized.config.wordBank],
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const keys = gapKeys(normalized.config.text);
  const given = response && response.blanks && typeof response.blanks === 'object' ? response.blanks : {};
  const parts = keys.map((key) => String(given[key] === undefined ? '' : given[key]).trim());
  return parts.join(' | ').slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const blanks = {};
  for (const key of gapKeys(normalized.config.text)) {
    blanks[key] = normalized.config.blanks[key]?.accepted.find((value) => value.trim() !== '') || '';
  }
  return { blanks };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const out = [];
  for (const key of gapKeys(normalized.config.text)) {
    const first = normalized.config.blanks[key]?.accepted.find((value) => value.trim() !== '');
    if (first) out.push(first);
  }
  return out;
}

export function editSchema() {
  return [
    {
      key: 'text',
      kind: 'textarea',
      label: { en: 'Text with gaps', de: 'Text mit Lücken' },
      help: {
        en: 'Insert gaps as <<1>>, <<2>>, … Each number is one blank.',
        de: 'Lücken als <<1>>, <<2>>, … einfügen. Jede Nummer ist eine Lücke.',
      },
    },
    {
      key: 'mode',
      kind: 'select',
      label: { en: 'Answer mode', de: 'Antwort-Modus' },
      options: [
        { value: 'input', label: { en: 'Type in', de: 'Eintippen' } },
        { value: 'drag', label: { en: 'Drag & drop from word box', de: 'Drag & Drop aus der Wortbox' } },
      ],
      help: {
        en: 'In drag mode the pupil drags words from a word box into the gaps.',
        de: 'Im Drag-Modus zieht der Schüler Wörter aus einer Wortbox in die Lücken.',
      },
    },
    {
      key: 'wordBank',
      kind: 'list',
      label: { en: 'Word box (drag mode)', de: 'Wortbox (Drag-Modus)' },
      help: {
        en: 'One word per row. Must contain every accepted answer (plus optional distractor words).',
        de: 'Ein Wort pro Zeile. Muss jede akzeptierte Antwort enthalten (plus optional Ablenkungswörter).',
      },
      itemSchema: [{ key: '$value', kind: 'text', label: { en: 'Word', de: 'Wort' } }],
    },
    {
      key: 'blanks',
      kind: 'list',
      label: { en: 'Accepted answers per gap', de: 'Akzeptierte Antworten je Lücke' },
      help: {
        en: 'One row per gap number. Add several accepted spellings per gap.',
        de: 'Eine Zeile je Lückennummer. Mehrere akzeptierte Schreibweisen pro Lücke möglich.',
      },
      itemSchema: [
        { key: 'key', kind: 'text', label: { en: 'Gap number', de: 'Lückennummer' } },
        {
          key: 'accepted',
          kind: 'list',
          label: { en: 'Accepted answers', de: 'Akzeptierte Antworten' },
          itemSchema: [{ key: '$value', kind: 'text', label: { en: 'Answer', de: 'Antwort' } }],
        },
      ],
    },
    {
      key: 'caseSensitive',
      kind: 'switch',
      label: { en: 'Case-sensitive', de: 'Groß-/Kleinschreibung beachten' },
    },
  ];
}
