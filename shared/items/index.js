// Item-type registry. This is the only entry point the server, the authoring UI
// and the student player should use to talk about item types. Everything here
// is pure and safe to import in the browser.
import { shortId } from '../util.js';
import { uniqueId } from './common.js';
import * as text from './text.js';
import * as multipleChoice from './multiple_choice.js';
import * as shortAnswer from './short_answer.js';
import * as numeric from './numeric.js';
import * as fillBlanks from './fill_blanks.js';
import * as match from './match.js';
import * as ordering from './ordering.js';
import * as pins from './pins.js';
import * as longAnswer from './long_answer.js';

export const itemTypes = [
  text,
  multipleChoice,
  shortAnswer,
  numeric,
  fillBlanks,
  match,
  ordering,
  pins,
  longAnswer,
];

const byType = new Map(itemTypes.map((module) => [module.type, module]));

export function getType(type) {
  return byType.get(String(type)) || null;
}

/** Palette metadata for the authoring UI / GET /api/capabilities. */
export function itemTypeMeta() {
  return itemTypes.map((module) => ({
    type: module.type,
    label: { en: module.meta.label.en, de: module.meta.label.de },
    scoreable: !!module.meta.scoreable,
    category: module.meta.category || 'assessment',
    defaultPoints: typeof module.defaultPoints === 'function' ? module.defaultPoints() : 1,
  }));
}

export function createItem(type, opts = {}) {
  const module = getType(type);
  if (!module) throw new Error(`Unknown item type: ${type}`);
  return module.createItem(opts || {});
}

const UNKNOWN_RESULT = {
  autoScore: 0,
  maxScore: 0,
  correct: false,
  needsManual: false,
  correctParts: 0,
  totalParts: 0,
  detail: {},
};

function fallbackItem(source) {
  const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const points = Number(src.points);
  return {
    id: typeof src.id === 'string' && src.id.trim() ? src.id.trim() : shortId('it'),
    type: typeof src.type === 'string' && src.type ? src.type : 'text',
    points: Number.isFinite(points) && points >= 0 ? points : 1,
    stem: typeof src.stem === 'string' ? src.stem : '',
    help: typeof src.help === 'string' ? src.help : '',
    media: { type: 'none' },
    config: src.config && typeof src.config === 'object' && !Array.isArray(src.config) ? src.config : {},
    feedback: { correct: '', incorrect: '' },
  };
}

export function normalizeItem(item) {
  const module = getType(item && item.type);
  if (module) return module.normalizeItem(item);
  return fallbackItem(item);
}

export function validateItem(item) {
  const module = getType(item && item.type);
  if (!module) return [`type: unknown item type "${item && item.type}"`];
  return module.validateItem(item);
}

export function scoreItem(item, response) {
  const module = getType(item && item.type);
  if (!module) return { ...UNKNOWN_RESULT };
  try {
    return module.score(module.normalizeItem(item), response);
  } catch {
    return { ...UNKNOWN_RESULT };
  }
}

export function sanitizeItem(item) {
  const module = getType(item && item.type);
  if (!module) {
    const fallback = fallbackItem(item);
    return {
      id: fallback.id,
      type: fallback.type,
      points: fallback.points,
      stem: fallback.stem,
      help: fallback.help,
      media: { ...fallback.media },
      config: {},
    };
  }
  return module.sanitizeItem(item);
}

export function summarizeResponse(item, response) {
  const module = getType(item && item.type);
  if (!module || typeof module.summarizeResponse !== 'function') return '';
  try {
    return module.summarizeResponse(module.normalizeItem(item), response);
  } catch {
    return '';
  }
}

/** Canonical correct response for an item (teacher preview / after submit). */
export function answerKey(item) {
  const module = getType(item && item.type);
  if (!module || typeof module.answerKey !== 'function') return null;
  try {
    return module.answerKey(module.normalizeItem(item));
  } catch {
    return null;
  }
}

/** Human-readable solution lines for the student result screen (showAnswers). */
export function answerText(item) {
  const module = getType(item && item.type);
  if (!module || typeof module.answerText !== 'function') return [];
  try {
    return module.answerText(module.normalizeItem(item));
  } catch {
    return [];
  }
}

/** Post-submit pins solution zones (teacher answer key / review with showAnswers). */
export function answerZones(item) {
  const module = getType(item && item.type);
  if (!module || typeof module.answerZones !== 'function') return null;
  try {
    return module.answerZones(module.normalizeItem(item));
  } catch {
    return null;
  }
}

/**
 * Fresh sub-ids for a copy of an item (activity duplicate / import). The item
 * id itself is regenerated too. Keeps blank keys because they are referenced by
 * the text placeholders.
 */
export function regenerateItemIds(item) {
  const normalized = normalizeItem(item);
  const out = { ...normalized, id: shortId('it') };
  const freshIds = (list, prefix) => {
    const used = new Set();
    return list.map((entry) => {
      let id = shortId(prefix);
      while (used.has(id)) id = shortId(prefix);
      used.add(id);
      return { ...entry, id };
    });
  };
  switch (normalized.type) {
    case 'multiple_choice':
      out.config = { ...normalized.config, choices: freshIds(normalized.config.choices, 'c') };
      break;
    case 'match':
      out.config = { ...normalized.config, pairs: freshIds(normalized.config.pairs, 'p') };
      break;
    case 'ordering':
      out.config = { ...normalized.config, items: freshIds(normalized.config.items, 'i') };
      break;
    case 'pins':
      out.config = { ...normalized.config, zones: freshIds(normalized.config.zones, 'z') };
      break;
    default:
      break;
  }
  return out;
}
