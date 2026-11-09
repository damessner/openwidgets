// Item type: text — a non-scoreable block of content (instructions, reading
// passage, …). Renders as static text; it never accepts a response.
import { asString, makeResult, normalizeBaseItem, sanitizeBaseItem, validateBaseItem } from './common.js';

export const type = 'text';

export const meta = {
  label: { en: 'Text block', de: 'Textblock' },
  scoreable: false,
  category: 'content',
};

export function defaultConfig() {
  return { text: '' };
}

export function defaultPoints() {
  return 0;
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  const config = src.config && typeof src.config === 'object' && !Array.isArray(src.config) ? src.config : {};
  return normalizeBaseItem(src, type, { text: asString(config.text) }, defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return errors;
  if (typeof config.text !== 'string') errors.push('config.text: must be a string');
  else if (config.text.length > 20000) errors.push('config.text: must be at most 20000 characters');
  if (Number(item.points) !== 0) errors.push('points: text blocks cannot carry points');
  return errors;
}

export function normalizeResponse() {
  return {};
}

export function score() {
  return makeResult({ autoScore: 0, maxScore: 0, correct: false });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return { ...sanitizeBaseItem(normalized), config: { text: normalized.config.text } };
}

export function summarizeResponse() {
  return '';
}

export function answerKey() {
  return null;
}

export function answerText() {
  return [];
}

export function editSchema() {
  return [
    {
      key: 'text',
      kind: 'textarea',
      label: { en: 'Text', de: 'Text' },
      help: {
        en: 'Plain text. **bold**, *italic*, line breaks and "- " lists are supported.',
        de: 'Reiner Text. **fett**, *kursiv*, Zeilenumbrüche und "- "-Listen werden unterstützt.',
      },
    },
  ];
}
