// Pure helpers shared by the Node server and the browser renderers.
// Rules: no DOM APIs, no node: imports, no side effects. Importable as
// /shared/util.js in the browser and ../shared/util.js on the server.

export function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Score comparison with the epsilon used everywhere in the app. */
export const SCORE_EPSILON = 1e-9;

export function eqScore(a, b) {
  return Math.abs(Number(a) - Number(b)) <= SCORE_EPSILON;
}

/**
 * Text normalization for answer comparison.
 * Options deliberately mirror the authoring UI (caseSensitive, trim, ...).
 */
export function normalizeText(value, options = {}) {
  const {
    caseSensitive = false,
    trim = true,
    collapseSpaces = true,
    ignorePunctuation = false,
  } = options;
  let out = String(value ?? '');
  if (trim) out = out.trim();
  if (collapseSpaces) out = out.replace(/\s+/g, ' ');
  if (ignorePunctuation) out = out.replace(/[.,;:!?'"„“”‚‘’()[\]{}\-–—]/g, '');
  if (!caseSensitive) out = out.toLowerCase();
  try {
    out = out.normalize('NFC');
  } catch {
    /* older engine — keep as is */
  }
  return out;
}

/**
 * Parse a number typed by a student. Accepts German ("3,5", "1.234,5") and
 * English ("3.5", "1,234.5") decimal styles, signs and scientific notation.
 * Returns a finite number or null.
 */
export function parseLocalizedNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  // Remove spaces (incl. narrow/no-break), currency symbols, percent signs and
  // unit letters — keeping digits, separators, sign and exponent markers.
  s = s.replace(/[\s\u00A0\u202F]/g, '');
  s = s.replace(/[^\d.,+\-eE]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else s = s.replace(/,/g, ''); // 1,234.56
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    const singleComma = s.indexOf(',') === lastComma;
    // "1,234" is far more likely a thousands separator than a German decimal.
    if (singleComma && after === 3 && /^[+-]?\d{1,3},\d{3}$/.test(s)) s = s.replace(',', '');
    else if (singleComma) s = s.replace(',', '.');
    else return null;
  }
  const parsed = Number.parseFloat(s);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 32-bit FNV-1a hash — used for deterministic shuffles and seeds. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  const str = String(value ?? '');
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic Fisher–Yates shuffle. Same array + seed always yields the same
 * order, so shuffling survives page reloads and is identical on client/server.
 */
export function seededShuffle(array, seed) {
  const out = Array.from(array ?? []);
  let state = hashString(seed) || 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short opaque id, e.g. shortId('it') -> "it_k3j9x2". Works in browser+node. */
export function shortId(prefix = 'id') {
  let out = '';
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(6));
    for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  } else {
    for (let i = 0; i < 6; i += 1) out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return `${prefix}_${out}`;
}
