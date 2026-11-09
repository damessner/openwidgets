// Shared helpers for the individual item-type modules.
// Pure module: no DOM APIs, no node: imports — safe to load in the browser and
// on the server. Everything here is deterministic.
import { shortId } from '../util.js';

export const SCORE_EPSILON = 1e-9;

/** Scores are floats; round to 4 decimals like the contract asks for blanks. */
export function roundScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function asBool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Points must be a finite number >= 0; anything else falls back. */
export function asPoints(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function asFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp01(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Stable, unique id inside one config namespace (choices, pairs, gaps, zones…).
 * Keeps a usable author id, otherwise generates "prefix + n".
 */
export function uniqueId(preferred, prefix, used, index) {
  const candidate = typeof preferred === 'string' ? preferred.trim() : '';
  if (candidate && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let n = index + 1;
  let id = `${prefix}${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  used.add(id);
  return id;
}

const MEDIA_TYPES = new Set(['none', 'image', 'audio', 'video']);

export function normalizeMedia(media) {
  if (!media || typeof media !== 'object' || Array.isArray(media)) return { type: 'none' };
  const type = MEDIA_TYPES.has(media.type) ? media.type : 'none';
  if (type === 'none') return { type: 'none' };
  if (type === 'video') {
    const url = asString(media.url).trim();
    return /^https?:\/\//i.test(url) ? { type, url } : { type: 'none' };
  }
  const assetId = asString(media.assetId).trim();
  if (!assetId) return { type: 'none' };
  const out = { type, assetId };
  if (type === 'image') out.alt = asString(media.alt);
  return out;
}

/** Returns string[] of errors, each formatted "path: message". */
export function validateMedia(media) {
  const errors = [];
  if (!media || typeof media !== 'object' || Array.isArray(media)) {
    errors.push('media: must be an object');
    return errors;
  }
  if (!MEDIA_TYPES.has(media.type)) {
    errors.push('media.type: must be "none", "image", "audio" or "video"');
    return errors;
  }
  if (media.type === 'none') return errors;
  if (media.type === 'video') {
    if (typeof media.url !== 'string' || !/^https?:\/\//i.test(media.url)) {
      errors.push('media.url: video media needs an http(s) URL');
    }
    return errors;
  }
  if (typeof media.assetId !== 'string' || !media.assetId.trim()) {
    errors.push('media.assetId: an uploaded asset is required');
  }
  if (media.alt !== undefined && typeof media.alt !== 'string') {
    errors.push('media.alt: must be a string');
  } else if (typeof media.alt === 'string' && media.alt.length > 500) {
    errors.push('media.alt: must be at most 500 characters');
  }
  return errors;
}

export function normalizeFeedback(feedback) {
  const src = feedback && typeof feedback === 'object' ? feedback : {};
  return {
    correct: asString(src.correct),
    incorrect: asString(src.incorrect),
  };
}

/**
 * Normalize the fields every item has. `config` must already be normalized by
 * the type module. Returns a brand-new object (never mutates the input).
 */
export function normalizeBaseItem(source, type, config, defaultPointsValue = 1) {
  const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const points = type === 'text' ? 0 : asPoints(src.points, defaultPointsValue);
  return {
    id: typeof src.id === 'string' && src.id.trim() ? src.id.trim() : shortId('it'),
    type,
    points,
    stem: asString(src.stem),
    help: asString(src.help),
    media: normalizeMedia(src.media),
    config: config && typeof config === 'object' && !Array.isArray(config) ? config : {},
    feedback: normalizeFeedback(src.feedback),
  };
}

/** Item-level validation shared by all types. */
export function validateBaseItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['item: must be an object'];
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) {
    errors.push('id: must be 1-64 characters (letters, digits, "_" or "-")');
  }
  if (typeof item.type !== 'string' || !item.type) errors.push('type: must be a non-empty string');
  if (!Number.isFinite(item.points) || item.points < 0 || item.points > 1000) {
    errors.push('points: must be a number between 0 and 1000');
  }
  if (typeof item.stem !== 'string') errors.push('stem: must be a string');
  else if (item.stem.length > 5000) errors.push('stem: must be at most 5000 characters');
  if (typeof item.help !== 'string') errors.push('help: must be a string');
  else if (item.help.length > 2000) errors.push('help: must be at most 2000 characters');
  if (
    !item.feedback ||
    typeof item.feedback !== 'object' ||
    typeof item.feedback.correct !== 'string' ||
    typeof item.feedback.incorrect !== 'string'
  ) {
    errors.push('feedback: must be an object with "correct" and "incorrect" strings');
  }
  errors.push(...validateMedia(item.media));
  if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) {
    errors.push('config: must be an object');
  }
  return errors;
}

/** Fields every student payload may contain (no answers, no feedback). */
export function sanitizeBaseItem(item) {
  return {
    id: item.id,
    type: item.type,
    points: roundScore(item.points),
    stem: item.stem,
    help: item.help,
    media: { ...item.media },
  };
}

/** Build a score() result object. */
export function makeResult({
  autoScore = 0,
  maxScore = 0,
  correct = false,
  needsManual = false,
  correctParts = 0,
  totalParts = 0,
  detail = {},
} = {}) {
  return {
    autoScore: roundScore(autoScore),
    maxScore: roundScore(maxScore),
    correct: !!correct,
    needsManual: !!needsManual,
    correctParts,
    totalParts,
    detail: detail || {},
  };
}
