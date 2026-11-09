// Item type: match — pair left items with right options. Correct answer for a
// pair is its own id, so the pairing never needs to be listed for students.
import { seededShuffle } from '../util.js';
import {
  asArray,
  asBool,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'match';
export const meta = {
  label: { en: 'Matching', de: 'Zuordnen' },
  scoreable: true,
  category: 'assessment',
};

function defaultPairs() {
  return [
    { id: 'p1', left: '', right: '' },
    { id: 'p2', left: '', right: '' },
  ];
}

export function defaultConfig() {
  return { pairs: defaultPairs(), shuffle: true };
}

export function defaultPoints() {
  return 2;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawPairs = asArray(src.pairs);
  const source = rawPairs.length > 0 ? rawPairs : defaultPairs();
  const used = new Set();
  const pairs = source.slice(0, 30).map((pair, index) => {
    const p = pair && typeof pair === 'object' ? pair : {};
    return {
      id: uniqueId(p.id, 'p', used, index),
      left: asString(p.left),
      right: asString(p.right),
    };
  });
  return { pairs, shuffle: asBool(src.shuffle, true) };
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

  const pairs = asArray(config.pairs);
  if (pairs.length < 2) errors.push('config.pairs: at least two pairs are required');
  if (pairs.length > 30) errors.push('config.pairs: at most 30 pairs are allowed');
  const ids = new Set();
  pairs.forEach((pair, index) => {
    if (!pair || typeof pair !== 'object') {
      errors.push(`config.pairs[${index}]: must be an object`);
      return;
    }
    if (typeof pair.id !== 'string' || !pair.id) {
      errors.push(`config.pairs[${index}].id: must be a non-empty string`);
    } else if (ids.has(pair.id)) {
      errors.push(`config.pairs[${index}].id: duplicate pair id "${pair.id}"`);
    } else {
      ids.add(pair.id);
    }
    if (typeof pair.left !== 'string') errors.push(`config.pairs[${index}].left: must be a string`);
    else if (pair.left.length > 1000) errors.push(`config.pairs[${index}].left: at most 1000 characters`);
    if (typeof pair.right !== 'string') errors.push(`config.pairs[${index}].right: must be a string`);
    else if (pair.right.length > 1000) errors.push(`config.pairs[${index}].right: at most 1000 characters`);
  });
  if (typeof config.shuffle !== 'boolean') errors.push('config.shuffle: must be a boolean');
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawMatches = source.matches;
  if (rawMatches === undefined || rawMatches === null) {
    throw new Error('match response needs { matches: { leftId: rightId } }');
  }
  if (typeof rawMatches !== 'object' || Array.isArray(rawMatches)) {
    throw new Error('match response "matches" must be an object');
  }
  const normalized = normalizeItem(item);
  const known = new Set(normalized.config.pairs.map((pair) => pair.id));
  const matches = {};
  for (const pair of normalized.config.pairs) {
    const value = rawMatches[pair.id];
    if (typeof value === 'string' && known.has(value)) matches[pair.id] = value;
  }
  return { matches };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const pairs = normalized.config.pairs;
  const maxScore = normalized.points;
  const matches = response && response.matches && typeof response.matches === 'object' ? response.matches : {};
  const hits = [];
  const misses = [];
  for (const pair of pairs) {
    if (matches[pair.id] === pair.id) hits.push(pair.id);
    else misses.push(pair.id);
  }
  const total = pairs.length;
  const correctCount = hits.length;
  const autoScore = total > 0 ? roundScore((maxScore * correctCount) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && correctCount === total,
    needsManual: false,
    correctParts: correctCount,
    totalParts: total,
    detail: { hits, misses, total },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  const lefts = normalized.config.pairs.map((pair) => ({ id: pair.id, text: pair.left }));
  const rights = seededShuffle(
    normalized.config.pairs.map((pair) => ({ id: pair.id, text: pair.right })),
    `match-rights:${normalized.id}`,
  );
  return {
    ...sanitizeBaseItem(normalized),
    config: { shuffle: normalized.config.shuffle, lefts, rights },
  };
}

function letterFor(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`;
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const pairs = normalized.config.pairs;
  const matches = response && response.matches && typeof response.matches === 'object' ? response.matches : {};
  const indexById = new Map(pairs.map((pair, index) => [pair.id, index]));
  return pairs
    .map((pair, index) => {
      const target = matches[pair.id];
      const targetIndex = typeof target === 'string' ? indexById.get(target) : undefined;
      return `${letterFor(index)}→${targetIndex === undefined ? '–' : letterFor(targetIndex)}`;
    })
    .join(', ')
    .slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const matches = {};
  for (const pair of normalized.config.pairs) matches[pair.id] = pair.id;
  return { matches };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.pairs.map((pair) => `${pair.left} → ${pair.right}`);
}

export function editSchema() {
  return [
    {
      key: 'pairs',
      kind: 'list',
      label: { en: 'Pairs', de: 'Paare' },
      min: 2,
      max: 30,
      itemSchema: [
        { key: 'left', kind: 'text', label: { en: 'Left item', de: 'Linke Seite' } },
        { key: 'right', kind: 'text', label: { en: 'Matching right item', de: 'Passende rechte Seite' } },
      ],
    },
    {
      key: 'shuffle',
      kind: 'switch',
      label: { en: 'Shuffle right column', de: 'Rechte Spalte mischen' },
    },
  ];
}
