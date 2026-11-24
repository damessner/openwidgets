// Item type: groups — drag & drop items (text, image or audio) into the
// correct zone/group ("Gruppieren"). Keyboard/screen-reader fallback: each
// item also has a <select> of zones.
//
// Config:
//   zones: [{ id, label }]
//   items: [{ id, side: {kind:'text',text} | {kind:'image',assetId,alt} | {kind:'audio',assetId}, zoneId }]
//   shuffle: bool — shuffle item order for students
// Response: { placement: { [itemId]: zoneId } }
// The correct zoneId of each item never reaches the student payload.
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

export const type = 'groups';
export const meta = {
  label: { en: 'Group into zones (drag & drop)', de: 'In Zonen gruppieren (Drag & Drop)' },
  scoreable: true,
  category: 'interactive',
};

export function defaultConfig() {
  return {
    zones: [
      { id: 'z1', label: '' },
      { id: 'z2', label: '' },
    ],
    items: [{ id: 'i1', side: { kind: 'text', text: '' }, zoneId: 'z1' }],
    shuffle: true,
  };
}

export function defaultPoints() {
  return 2;
}

export function normalizeSide(raw) {
  if (typeof raw === 'string') return { kind: 'text', text: raw.slice(0, 500) };
  const src = raw && typeof raw === 'object' ? raw : {};
  const kind = src.kind === 'image' || src.kind === 'audio' ? src.kind : 'text';
  if (kind === 'image') {
    return { kind, assetId: asString(src.assetId).trim(), alt: asString(src.alt).slice(0, 500) };
  }
  if (kind === 'audio') {
    return { kind, assetId: asString(src.assetId).trim() };
  }
  return { kind: 'text', text: asString(src.text).slice(0, 500) };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const usedZones = new Set();
  const zones = (asArray(src.zones).length > 0 ? asArray(src.zones) : defaultConfig().zones)
    .slice(0, 12)
    .map((entry, index) => {
      const zone = entry && typeof entry === 'object' ? entry : {};
      return { id: uniqueId(zone.id, 'z', usedZones, index), label: asString(zone.label).slice(0, 300) };
    });
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const usedItems = new Set();
  const items = (asArray(src.items).length > 0 ? asArray(src.items) : defaultConfig().items)
    .slice(0, 40)
    .map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const zoneId = zoneIds.has(item.zoneId) ? item.zoneId : zones[0] ? zones[0].id : '';
      return { id: uniqueId(item.id, 'i', usedItems, index), side: normalizeSide(item.side), zoneId };
    });
  return { zones, items, shuffle: asBool(src.shuffle, true) };
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
  const zones = asArray(config.zones);
  if (zones.length < 1) errors.push('config.zones: at least one zone is required');
  if (zones.length > 12) errors.push('config.zones: at most 12 zones are allowed');
  const zoneIds = new Set();
  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== 'object') {
      errors.push(`config.zones[${index}]: must be an object`);
      return;
    }
    if (typeof zone.id !== 'string' || !zone.id) errors.push(`config.zones[${index}].id: must be a non-empty string`);
    else if (zoneIds.has(zone.id)) errors.push(`config.zones[${index}].id: duplicate "${zone.id}"`);
    else zoneIds.add(zone.id);
    if (typeof zone.label !== 'string') errors.push(`config.zones[${index}].label: must be a string`);
  });
  const items = asArray(config.items);
  if (items.length < 1) errors.push('config.items: at least one item is required');
  if (items.length > 40) errors.push('config.items: at most 40 items are allowed');
  const itemIds = new Set();
  items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`config.items[${index}]: must be an object`);
      return;
    }
    if (typeof entry.id !== 'string' || !entry.id) errors.push(`config.items[${index}].id: must be a non-empty string`);
    else if (itemIds.has(entry.id)) errors.push(`config.items[${index}].id: duplicate "${entry.id}"`);
    else itemIds.add(entry.id);
    if (!entry.side || typeof entry.side !== 'object') errors.push(`config.items[${index}].side: must be an object`);
    else if (entry.side.kind === 'image' && !String(entry.side.assetId || '').trim()) errors.push(`config.items[${index}].side.assetId: image item needs an uploaded image`);
    else if (entry.side.kind === 'audio' && !String(entry.side.assetId || '').trim()) errors.push(`config.items[${index}].side.assetId: audio item needs an uploaded audio`);
    if (typeof entry.zoneId !== 'string' || !zoneIds.has(entry.zoneId)) errors.push(`config.items[${index}].zoneId: must reference a zone`);
  });
  return errors;
}

export function normalizeResponse(item, raw) {
  const normalized = normalizeItem(item);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const itemIds = new Set(normalized.config.items.map((entry) => entry.id));
  const zoneIds = new Set(normalized.config.zones.map((zone) => zone.id));
  const rawPlacement = source.placement && typeof source.placement === 'object' && !Array.isArray(source.placement) ? source.placement : {};
  const placement = {};
  for (const [itemId, zoneId] of Object.entries(rawPlacement)) {
    if (itemIds.has(itemId) && zoneIds.has(zoneId)) placement[itemId.slice(0, 64)] = zoneId.slice(0, 64);
  }
  return { placement };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const items = normalized.config.items;
  const maxScore = normalized.points;
  const placement = response && response.placement && typeof response.placement === 'object' ? response.placement : {};
  let hit = 0;
  const detail = [];
  for (const entry of items) {
    const given = placement[entry.id];
    const ok = given === entry.zoneId;
    if (ok) hit += 1;
    detail.push({ itemId: entry.id, given: given || null, correct: entry.zoneId, ok });
  }
  const total = items.length;
  return makeResult({
    autoScore: total > 0 ? roundScore((maxScore * hit) / total) : 0,
    maxScore,
    correct: total > 0 && hit === total,
    needsManual: false,
    correctParts: hit,
    totalParts: total,
    detail: { items: detail },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      zones: normalized.config.zones.map((zone) => ({ id: zone.id, label: zone.label })),
      // zoneId is the answer key — stripped for students
      items: normalized.config.items.map((entry) => ({ id: entry.id, side: entry.side })),
      shuffle: normalized.config.shuffle,
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const zoneById = new Map(normalized.config.zones.map((zone) => [zone.id, zone.label || zone.id]));
  const itemById = new Map(normalized.config.items.map((entry) => [entry.id, entry.side]));
  const placement = response && response.placement && typeof response.placement === 'object' ? response.placement : {};
  const parts = Object.entries(placement).map(([itemId, zoneId]) => {
    const side = itemById.get(itemId);
    const label = side && side.kind === 'text' ? side.text : itemId;
    return `${label}→${zoneById.get(zoneId) || zoneId}`;
  });
  return parts.join(' · ').slice(0, 140) || '–';
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const placement = {};
  for (const entry of normalized.config.items) placement[entry.id] = entry.zoneId;
  return { placement };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const zoneById = new Map(normalized.config.zones.map((zone) => [zone.id, zone.label || zone.id]));
  return normalized.config.items.map((entry) => {
    const label = entry.side.kind === 'text' ? entry.side.text : `[${entry.side.kind}]`;
    return `${label} → ${zoneById.get(entry.zoneId) || entry.zoneId}`;
  });
}

// The real editor is the zone/item list (renderGroupsEditor in the teacher app).
export function editSchema() {
  return [{ key: 'items', kind: 'list', label: { en: 'Items', de: 'Elemente' }, min: 1, max: 40 }];
}
