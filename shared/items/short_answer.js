// Item type: short_answer — one text answer checked against a list of accepted
// values with configurable normalization.
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

export const type = 'short_answer';

export const meta = {
  label: { en: 'Short answer', de: 'Kurze Antwort' },
  scoreable: true,
  category: 'assessment',
};

export function defaultConfig() {
  return {
    accepted: [],
    caseSensitive: false,
    trim: true,
    collapseSpaces: true,
    ignorePunctuation: true,
  };
}

export function defaultPoints() {
  return 1;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  return {
    accepted: asArray(src.accepted)
      .filter((value) => typeof value === 'string')
      .slice(0, 100),
    caseSensitive: asBool(src.caseSensitive, false),
    trim: asBool(src.trim, true),
    collapseSpaces: asBool(src.collapseSpaces, true),
    ignorePunctuation: asBool(src.ignorePunctuation, true),
  };
}

function normalizeOptions(config) {
  return {
    caseSensitive: config.caseSensitive,
    trim: config.trim,
    collapseSpaces: config.collapseSpaces,
    ignorePunctuation: config.ignorePunctuation,
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

  const accepted = asArray(config.accepted);
  if (accepted.length > 100) errors.push('config.accepted: at most 100 accepted answers');
  accepted.forEach((value, index) => {
    if (typeof value !== 'string') errors.push(`config.accepted[${index}]: must be a string`);
    else if (value.length > 500) errors.push(`config.accepted[${index}]: at most 500 characters`);
  });
  for (const key of ['caseSensitive', 'trim', 'collapseSpaces', 'ignorePunctuation']) {
    if (typeof config[key] !== 'boolean') errors.push(`config.${key}: must be a boolean`);
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (source.text !== undefined && typeof source.text !== 'string') {
    throw new Error('short_answer response needs { text: string }');
  }
  if (typeof raw === 'string') return { text: raw.slice(0, 10000) };
  return { text: asString(source.text).slice(0, 10000) };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const options = normalizeOptions(normalized.config);
  const maxScore = normalized.points;
  const given = normalizeText(response && response.text, options);
  const accepted = normalized.config.accepted
    .map((value) => normalizeText(value, options))
    .filter((value) => value !== '');
  const matched = given !== '' && accepted.includes(given);
  const autoScore = matched ? roundScore(maxScore) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: matched && eqScore(autoScore, maxScore),
    needsManual: false,
    correctParts: matched ? 1 : 0,
    totalParts: 1,
    detail: { normalized: given },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      caseSensitive: normalized.config.caseSensitive,
      trim: normalized.config.trim,
      collapseSpaces: normalized.config.collapseSpaces,
      ignorePunctuation: normalized.config.ignorePunctuation,
    },
  };
}

export function summarizeResponse(item, response) {
  return String((response && response.text) || '').slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  return { text: normalized.config.accepted.find((value) => value.trim() !== '') || '' };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const first = normalized.config.accepted.find((value) => value.trim() !== '');
  return first ? [first] : [];
}

export function editSchema() {
  return [
    {
      key: 'accepted',
      kind: 'list',
      label: { en: 'Accepted answers', de: 'Akzeptierte Antworten' },
      help: {
        en: 'Any of these answers earns full points. Comparison is trim/case-insensitive by default.',
        de: 'Jede dieser Antworten gibt volle Punkte. Vergleich ignoriert standardmäßig Groß-/Kleinschreibung und Leerzeichen.',
      },
      min: 1,
      max: 100,
      itemSchema: [{ key: '$value', kind: 'text', label: { en: 'Answer', de: 'Antwort' } }],
    },
    {
      key: 'caseSensitive',
      kind: 'switch',
      label: { en: 'Case-sensitive', de: 'Groß-/Kleinschreibung beachten' },
    },
    { key: 'trim', kind: 'switch', label: { en: 'Trim whitespace', de: 'Leerzeichen am Rand ignorieren' } },
    {
      key: 'collapseSpaces',
      kind: 'switch',
      label: { en: 'Collapse inner spaces', de: 'Mehrfache Leerzeichen zusammenfassen' },
    },
    {
      key: 'ignorePunctuation',
      kind: 'switch',
      label: { en: 'Ignore punctuation', de: 'Satzzeichen ignorieren' },
    },
  ];
}
