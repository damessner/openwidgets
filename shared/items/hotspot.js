// Item type: hotspot — a "TipToi"-style interactive image. The teacher draws
// clickable zones (rect or circle) onto an image; each zone can carry a
// feedback popup (text / image / audio) and an optional link (to another
// assignment = learning path, or an external URL). The item can also have an
// audio prompt (item media audio or config.prompt.audioAssetId): "hör zu und
// tippe den Vogel an".
//
// Zones may be flagged `correct`; the student response is the list of tapped
// zone ids and scoring compares against the correct set. Geometry, feedback
// and links are visible to students; the `correct` flag never is.
import {
  asArray,
  asBool,
  asString,
  clamp01,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'hotspot';
export const meta = {
  label: { en: 'Hotspot image (TipToi)', de: 'Hotspot-Bild (TipToi)' },
  scoreable: true,
  category: 'interactive',
};

export const SHAPES = ['rect', 'circle'];
export const LINK_TYPES = ['none', 'assignment', 'url'];

function defaultZones() {
  return [{ id: 'z1', label: '', shape: 'rect', x: 0.35, y: 0.35, w: 0.3, h: 0.25 }];
}

export function defaultConfig() {
  return {
    image: { assetId: '', alt: '' },
    prompt: { text: '', audioAssetId: '' },
    zones: defaultZones(),
  };
}

export function defaultPoints() {
  return 2;
}

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeLink(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const linkType = LINK_TYPES.includes(src.type) ? src.type : 'none';
  const value = asString(src.value).slice(0, 500);
  if (linkType === 'url' && value && !/^https?:\/\//i.test(value)) return { type: 'none', value: '' };
  return { type: linkType, value };
}

function normalizeZone(raw, used, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const shape = SHAPES.includes(src.shape) ? src.shape : 'rect';
  const feedbackSrc = src.feedback && typeof src.feedback === 'object' ? src.feedback : {};
  return {
    id: uniqueId(src.id, 'z', used, index),
    label: asString(src.label).slice(0, 300),
    shape,
    // rect: x,y top-left + w,h; circle: x,y center + r
    x: clampNum(src.x, 0.5, 0, 1),
    y: clampNum(src.y, 0.5, 0, 1),
    w: shape === 'rect' ? clampNum(src.w, 0.2, 0.02, 1) : undefined,
    h: shape === 'rect' ? clampNum(src.h, 0.15, 0.02, 1) : undefined,
    r: shape === 'circle' ? clampNum(src.r, 0.08, 0.02, 0.5) : undefined,
    correct: asBool(src.correct, false),
    feedback: {
      text: asString(feedbackSrc.text).slice(0, 2000),
      imageAssetId: asString(feedbackSrc.imageAssetId).trim(),
      audioAssetId: asString(feedbackSrc.audioAssetId).trim(),
    },
    link: normalizeLink(src.link),
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawImage = src.image && typeof src.image === 'object' ? src.image : {};
  const rawPrompt = src.prompt && typeof src.prompt === 'object' ? src.prompt : {};
  const rawZones = asArray(src.zones);
  const used = new Set();
  const zones = (rawZones.length > 0 ? rawZones : defaultZones()).slice(0, 30).map((entry, index) => normalizeZone(entry, used, index));
  return {
    image: { assetId: asString(rawImage.assetId).trim(), alt: asString(rawImage.alt).slice(0, 500) },
    prompt: { text: asString(rawPrompt.text).slice(0, 500), audioAssetId: asString(rawPrompt.audioAssetId).trim() },
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
  // validate the normalized config so partially-filled editor states are fine
  const config = normalizeConfig(item.config);
  if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) return errors;

  const image = config.image && typeof config.image === 'object' ? config.image : null;
  if (!image) errors.push('config.image: must be an object');
  else {
    if (typeof image.assetId !== 'string' || !image.assetId.trim()) errors.push('config.image.assetId: an uploaded image is required');
    if (typeof image.alt !== 'string') errors.push('config.image.alt: must be a string');
  }
  const prompt = config.prompt && typeof config.prompt === 'object' ? config.prompt : null;
  if (!prompt) errors.push('config.prompt: must be an object');
  else {
    if (typeof prompt.text !== 'string') errors.push('config.prompt.text: must be a string');
    if (typeof prompt.audioAssetId !== 'string') errors.push('config.prompt.audioAssetId: must be a string');
  }

  const zones = asArray(config.zones);
  if (zones.length < 1) errors.push('config.zones: at least one zone is required');
  if (zones.length > 30) errors.push('config.zones: at most 30 zones are allowed');
  const ids = new Set();
  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== 'object') {
      errors.push(`config.zones[${index}]: must be an object`);
      return;
    }
    if (typeof zone.id !== 'string' || !zone.id) errors.push(`config.zones[${index}].id: must be a non-empty string`);
    else if (ids.has(zone.id)) errors.push(`config.zones[${index}].id: duplicate zone id "${zone.id}"`);
    else ids.add(zone.id);
    if (!SHAPES.includes(zone.shape)) errors.push(`config.zones[${index}].shape: must be rect or circle`);
    for (const key of ['x', 'y']) {
      if (!Number.isFinite(zone[key]) || zone[key] < 0 || zone[key] > 1) errors.push(`config.zones[${index}].${key}: must be 0..1`);
    }
    if (zone.shape === 'rect') {
      for (const key of ['w', 'h']) {
        if (!Number.isFinite(zone[key]) || zone[key] <= 0 || zone[key] > 1) errors.push(`config.zones[${index}].${key}: must be in (0,1]`);
      }
    } else if (!Number.isFinite(zone.r) || zone.r <= 0 || zone.r > 0.5) {
      errors.push(`config.zones[${index}].r: must be in (0,0.5]`);
    }
    if (typeof zone.label !== 'string') errors.push(`config.zones[${index}].label: must be a string`);
    if (typeof zone.correct !== 'boolean') errors.push(`config.zones[${index}].correct: must be a boolean`);
    const feedback = zone.feedback && typeof zone.feedback === 'object' ? zone.feedback : null;
    if (!feedback) errors.push(`config.zones[${index}].feedback: must be an object`);
    else {
      if (typeof feedback.text !== 'string') errors.push(`config.zones[${index}].feedback.text: must be a string`);
      if (typeof feedback.imageAssetId !== 'string') errors.push(`config.zones[${index}].feedback.imageAssetId: must be a string`);
      if (typeof feedback.audioAssetId !== 'string') errors.push(`config.zones[${index}].feedback.audioAssetId: must be a string`);
    }
    const link = zone.link && typeof zone.link === 'object' ? zone.link : null;
    if (!link) errors.push(`config.zones[${index}].link: must be an object`);
    else {
      if (!LINK_TYPES.includes(link.type)) errors.push(`config.zones[${index}].link.type: invalid`);
      if (typeof link.value !== 'string') errors.push(`config.zones[${index}].link.value: must be a string`);
    }
  });
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = normalizeItem(item);
  const zoneIds = new Set(normalized.config.zones.map((zone) => zone.id));
  const rawTapped = asArray(source.tapped).filter((value) => typeof value === 'string');
  const tapped = [...new Set(rawTapped.filter((id) => zoneIds.has(id)).map((id) => id.slice(0, 64)))].slice(0, 30);
  return { tapped };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const zones = normalized.config.zones;
  const correctZones = zones.filter((zone) => zone.correct);
  const maxScore = normalized.points;
  const tapped = new Set(asArray(response && response.tapped).filter((value) => typeof value === 'string'));
  const hit = correctZones.filter((zone) => tapped.has(zone.id)).map((zone) => zone.id);
  const wrong = [...tapped].filter((id) => !correctZones.some((zone) => zone.id === id));
  const total = correctZones.length;
  const autoScore =
    total > 0 ? roundScore((maxScore * Math.max(0, hit.length - wrong.length)) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && hit.length === total && wrong.length === 0,
    needsManual: false,
    correctParts: hit.length,
    totalParts: total,
    detail: { hit, wrong, tapped: [...tapped] },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      image: { assetId: normalized.config.image.assetId, alt: normalized.config.image.alt },
      prompt: { text: normalized.config.prompt.text, audioAssetId: normalized.config.prompt.audioAssetId },
      // Geometry, label, feedback and link are shown to students; `correct` is the answer key.
      zones: normalized.config.zones.map((zone) => {
        const base = { id: zone.id, label: zone.label, shape: zone.shape, x: zone.x, y: zone.y };
        if (zone.shape === 'rect') {
          base.w = zone.w;
          base.h = zone.h;
        } else {
          base.r = zone.r;
        }
        base.feedback = { text: zone.feedback.text, imageAssetId: zone.feedback.imageAssetId, audioAssetId: zone.feedback.audioAssetId };
        base.link = { type: zone.link.type, value: zone.link.value };
        return base;
      }),
    },
  };
}

/** Post-submit solution zones (review with showAnswers). */
export function answerZones(item) {
  const normalized = normalizeItem(item);
  return normalized.config.zones
    .filter((zone) => zone.correct)
    .map((zone) => ({
      id: zone.id,
      label: zone.label,
      shape: zone.shape,
      x: zone.x,
      y: zone.y,
      w: zone.w,
      h: zone.h,
      r: zone.r,
    }));
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const byId = new Map(normalized.config.zones.map((zone) => [zone.id, zone]));
  const tapped = asArray(response && response.tapped);
  return tapped.map((id) => (byId.get(id) || {}).label || id).join(', ') || '–';
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  return { tapped: normalized.config.zones.filter((zone) => zone.correct).map((zone) => zone.id) };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const lines = normalized.config.zones.filter((zone) => zone.correct).map((zone) => zone.label || zone.id);
  return lines.length > 0 ? lines : [];
}

// The real editor is the visual canvas (renderHotspotEditor in the teacher app).
export function editSchema() {
  return [{ key: 'zones', kind: 'list', label: { en: 'Zones', de: 'Bereiche' }, min: 1, max: 30 }];
}
