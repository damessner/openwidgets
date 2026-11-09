// Item type: ordering — put items into the correct order. "positions" gives
// partial credit per correctly placed item; "exact" is all-or-nothing.
import { seededShuffle } from '../util.js';
import {
  asArray,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'ordering';
export const meta = {
  label: { en: 'Ordering', de: 'Reihenfolge' },
  scoreable: true,
  category: 'assessment',
};

function defaultItems() {
  return [
    { id: 'i1', text: '' },
    { id: 'i2', text: '' },
  ];
}

export function defaultConfig() {
  return { items: defaultItems(), mode: 'positions' };
}

export function defaultPoints() {
  return 2;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawItems = asArray(src.items);
  const source = rawItems.length > 0 ? rawItems : defaultItems();
  const used = new Set();
  const items = source.slice(0, 50).map((entry, index) => {
    const value = entry && typeof entry === 'object' ? entry : {};
    return {
      id: uniqueId(value.id, 'i', used, index),
      text: asString(value.text),
    };
  });
  return { items, mode: src.mode === 'exact' ? 'exact' : 'positions' };
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

  const items = asArray(config.items);
  if (items.length < 2) errors.push('config.items: at least two items are required');
  if (items.length > 50) errors.push('config.items: at most 50 items are allowed');
  const ids = new Set();
  items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`config.items[${index}]: must be an object`);
      return;
    }
    if (typeof entry.id !== 'string' || !entry.id) {
      errors.push(`config.items[${index}].id: must be a non-empty string`);
    } else if (ids.has(entry.id)) {
      errors.push(`config.items[${index}].id: duplicate item id "${entry.id}"`);
    } else {
      ids.add(entry.id);
    }
    if (typeof entry.text !== 'string') errors.push(`config.items[${index}].text: must be a string`);
    else if (entry.text.length > 1000) errors.push(`config.items[${index}].text: at most 1000 characters`);
  });
  if (config.mode !== 'positions' && config.mode !== 'exact') {
    errors.push('config.mode: must be "positions" or "exact"');
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const orderRaw = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? raw.order : undefined;
  if (!Array.isArray(orderRaw)) throw new Error('ordering response needs { order: [itemId] }');
  const normalized = normalizeItem(item);
  const known = new Set(normalized.config.items.map((entry) => entry.id));
  const order = [];
  for (const value of orderRaw) {
    if (typeof value === 'string' && known.has(value) && !order.includes(value)) order.push(value);
  }
  return { order };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const items = normalized.config.items;
  const maxScore = normalized.points;
  const order = asArray(response && response.order);
  const total = items.length;
  let correctPositions = 0;
  for (let index = 0; index < total; index += 1) {
    if (order[index] === items[index].id) correctPositions += 1;
  }
  let ratio = 0;
  if (total > 0) {
    if (normalized.config.mode === 'exact') ratio = correctPositions === total ? 1 : 0;
    else ratio = correctPositions / total;
  }
  const autoScore = roundScore(maxScore * ratio);
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && correctPositions === total,
    needsManual: false,
    correctParts: correctPositions,
    totalParts: total,
    detail: { correctPositions, total },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      mode: normalized.config.mode,
      items: seededShuffle(
        normalized.config.items.map((entry) => ({ id: entry.id, text: entry.text })),
        `ordering:${normalized.id}`,
      ),
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const items = normalized.config.items;
  const indexById = new Map(items.map((entry, index) => [entry.id, index]));
  const order = asArray(response && response.order);
  return order
    .map((id) => {
      const index = indexById.get(id);
      if (index === undefined) return '?';
      return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    })
    .join(', ')
    .slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  return { order: normalized.config.items.map((entry) => entry.id) };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.items.map((entry) => entry.text);
}

export function editSchema() {
  return [
    {
      key: 'items',
      kind: 'list',
      label: { en: 'Items in the correct order', de: 'Einträge in der richtigen Reihenfolge' },
      min: 2,
      max: 50,
      itemSchema: [{ key: 'text', kind: 'text', label: { en: 'Item text', de: 'Eintrag' } }],
    },
    {
      key: 'mode',
      kind: 'select',
      label: { en: 'Scoring', de: 'Bewertung' },
      options: [
        { value: 'positions', label: { en: 'Partial credit per position', de: 'Teilpunkte je Position' } },
        { value: 'exact', label: { en: 'All or nothing', de: 'Alles oder nichts' } },
      ],
    },
  ];
}
