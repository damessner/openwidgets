// Item type: pins — click the right places on an image. Each zone has a label
// and a hidden center + radius; the radius never reaches the student payload.
import {
  asArray,
  asString,
  clamp01,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'pins';
export const meta = {
  label: { en: 'Pin on image', de: 'Bild markieren' },
  scoreable: true,
  category: 'assessment',
};

function defaultZones() {
  return [{ id: 'z1', label: '', x: 0.5, y: 0.5, r: 0.1 }];
}

export function defaultConfig() {
  return { image: { assetId: '', alt: '' }, zones: defaultZones() };
}

export function defaultPoints() {
  return 2;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawImage = src.image && typeof src.image === 'object' ? src.image : {};
  const rawZones = asArray(src.zones);
  const source = rawZones.length > 0 ? rawZones : defaultZones();
  const used = new Set();
  const zones = source.slice(0, 50).map((entry, index) => {
    const zone = entry && typeof entry === 'object' ? entry : {};
    const r = Number(zone.r);
    return {
      id: uniqueId(zone.id, 'z', used, index),
      label: asString(zone.label),
      x: clamp01(zone.x, 0.5),
      y: clamp01(zone.y, 0.5),
      r: Number.isFinite(r) && r > 0 && r <= 1 ? r : 0.1,
    };
  });
  return {
    image: { assetId: asString(rawImage.assetId).trim(), alt: asString(rawImage.alt) },
    zones,
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

  const image = config.image && typeof config.image === 'object' ? config.image : null;
  if (!image) errors.push('config.image: must be an object');
  else {
    if (typeof image.assetId !== 'string') errors.push('config.image.assetId: must be a string');
    if (typeof image.alt !== 'string') errors.push('config.image.alt: must be a string');
    else if (image.alt.length > 500) errors.push('config.image.alt: at most 500 characters');
  }

  const zones = asArray(config.zones);
  if (zones.length < 1) errors.push('config.zones: at least one zone is required');
  if (zones.length > 50) errors.push('config.zones: at most 50 zones are allowed');
  const ids = new Set();
  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== 'object') {
      errors.push(`config.zones[${index}]: must be an object`);
      return;
    }
    if (typeof zone.id !== 'string' || !zone.id) {
      errors.push(`config.zones[${index}].id: must be a non-empty string`);
    } else if (ids.has(zone.id)) {
      errors.push(`config.zones[${index}].id: duplicate zone id "${zone.id}"`);
    } else {
      ids.add(zone.id);
    }
    if (typeof zone.label !== 'string') errors.push(`config.zones[${index}].label: must be a string`);
    else if (zone.label.length > 300) errors.push(`config.zones[${index}].label: at most 300 characters`);
    for (const key of ['x', 'y']) {
      if (!Number.isFinite(zone[key]) || zone[key] < 0 || zone[key] > 1) {
        errors.push(`config.zones[${index}].${key}: must be a number between 0 and 1`);
      }
    }
    if (!Number.isFinite(zone.r) || zone.r <= 0 || zone.r > 1) {
      errors.push(`config.zones[${index}].r: must be a number between 0 (exclusive) and 1`);
    }
  });
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawPoints = source.points;
  if (rawPoints !== undefined && (typeof rawPoints !== 'object' || Array.isArray(rawPoints))) {
    throw new Error('pins response needs { points: { zoneId: { x, y } } }');
  }
  const normalized = normalizeItem(item);
  const given = rawPoints && typeof rawPoints === 'object' ? rawPoints : {};
  const points = {};
  for (const zone of normalized.config.zones) {
    const point = given[zone.id];
    if (!point || typeof point !== 'object' || Array.isArray(point)) continue;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points[zone.id] = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }
  return { points };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const zones = normalized.config.zones;
  const maxScore = normalized.points;
  const points = response && response.points && typeof response.points === 'object' ? response.points : {};
  const hit = [];
  const miss = [];
  for (const zone of zones) {
    const point = points[zone.id];
    let correct = false;
    if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
      const distance = Math.hypot(Number(point.x) - zone.x, Number(point.y) - zone.y);
      correct = distance <= zone.r + 1e-12;
    }
    if (correct) hit.push(zone.id);
    else miss.push(zone.id);
  }
  const total = zones.length;
  const autoScore = total > 0 ? roundScore((maxScore * hit.length) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && hit.length === total,
    needsManual: false,
    correctParts: hit.length,
    totalParts: total,
    detail: { hit, miss },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      // `url` is filled in by the server API layer from the assets table so the
      // student player can render the image; the raw config only stores assets.
      image: { assetId: normalized.config.image.assetId, alt: normalized.config.image.alt },
      // The exact target coordinates AND the hit radius are the answer. Never
      // send them to students — result payloads may reveal them after submit.
      zones: normalized.config.zones.map((zone) => ({ id: zone.id, label: zone.label })),
    },
  };
}

/** Post-submit solution details (only sent when settings.showAnswers is on). */
export function answerZones(item) {
  const normalized = normalizeItem(item);
  return normalized.config.zones.map((zone) => ({
    id: zone.id,
    label: zone.label,
    x: zone.x,
    y: zone.y,
    r: zone.r,
  }));
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const points = response && response.points && typeof response.points === 'object' ? response.points : {};
  let placed = 0;
  for (const zone of normalized.config.zones) {
    if (points[zone.id]) placed += 1;
  }
  return `${placed}/${normalized.config.zones.length}`;
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const points = {};
  for (const zone of normalized.config.zones) points[zone.id] = { x: zone.x, y: zone.y };
  return { points };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.zones.map((zone) => zone.label || zone.id);
}

export function editSchema() {
  return [
    {
      key: 'image',
      kind: 'text',
      label: { en: 'Image', de: 'Bild' },
      help: {
        en: 'Upload an image (PNG/JPEG/WebP/GIF); the editor stores its asset id.',
        de: 'Bild hochladen (PNG/JPEG/WebP/GIF); der Editor speichert die Asset-ID.',
      },
    },
    {
      key: 'zones',
      kind: 'list',
      label: { en: 'Target zones', de: 'Zielbereiche' },
      help: {
        en: 'x/y are 0…1 relative to the image; r is the hit radius (hidden from students).',
        de: 'x/y sind 0…1 relativ zum Bild; r ist der Trefferradius (für Schüler:innen unsichtbar).',
      },
      min: 1,
      max: 50,
      itemSchema: [
        { key: 'label', kind: 'text', label: { en: 'Zone label', de: 'Bezeichnung' } },
        { key: 'x', kind: 'number', label: { en: 'x (0–1)', de: 'x (0–1)' }, min: 0, max: 1 },
        { key: 'y', kind: 'number', label: { en: 'y (0–1)', de: 'y (0–1)' }, min: 0, max: 1 },
        { key: 'r', kind: 'number', label: { en: 'Radius', de: 'Radius' }, min: 0, max: 1 },
      ],
    },
  ];
}
