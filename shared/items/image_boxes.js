// Item type: image_boxes — draw editable rectangles ("Kästchen") over a picture;
// each box gets one or more accepted words. The student either types the word
// into the box (inputMode "type") or drags a word chip from the word bank onto
// the box (inputMode "drag").
//
// Box geometry is stored in normalized 0..1 coordinates relative to the image
// (x, y = top-left corner; w, h = size). The accepted answers never reach the
// student payload — only box geometry + label.
import { eqScore, normalizeText } from '../util.js';
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

export const type = 'image_boxes';
export const meta = {
  label: { en: 'Label boxes on image', de: 'Kästchen im Bild' },
  scoreable: true,
  category: 'assessment',
};

export const INPUT_MODES = ['type', 'drag'];

function defaultBoxes() {
  return [{ id: 'b1', x: 0.4, y: 0.4, w: 0.2, h: 0.15, label: '', accepted: [] }];
}

export function defaultConfig() {
  return {
    image: { assetId: '', alt: '' },
    boxes: defaultBoxes(),
    inputMode: 'type',
    wordBank: [],
    caseSensitive: false,
    trim: true,
    collapseSpaces: true,
    ignorePunctuation: true,
  };
}

export function defaultPoints() {
  return 2;
}

function clampBoxNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function normalizeBox(raw, used, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const x = clampBoxNumber(src.x, 0.4);
  const y = clampBoxNumber(src.y, 0.4);
  const w = Number(src.w);
  const h = Number(src.h);
  return {
    id: uniqueId(src.id, 'b', used, index),
    x,
    y,
    w: Number.isFinite(w) && w > 0 && w <= 1 ? w : 0.2,
    h: Number.isFinite(h) && h > 0 && h <= 1 ? h : 0.15,
    label: asString(src.label).slice(0, 300),
    accepted: asArray(src.accepted).filter((value) => typeof value === 'string').map((value) => value.slice(0, 500)).slice(0, 50),
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawImage = src.image && typeof src.image === 'object' ? src.image : {};
  const rawBoxes = asArray(src.boxes);
  const used = new Set();
  const boxes = (rawBoxes.length > 0 ? rawBoxes : defaultBoxes()).slice(0, 50).map((entry, index) => normalizeBox(entry, used, index));
  const inputMode = INPUT_MODES.includes(src.inputMode) ? src.inputMode : 'type';
  return {
    image: { assetId: asString(rawImage.assetId).trim(), alt: asString(rawImage.alt).slice(0, 500) },
    boxes,
    inputMode,
    wordBank: asArray(src.wordBank).filter((value) => typeof value === 'string').map((value) => value.slice(0, 200)).filter(Boolean).slice(0, 100),
    caseSensitive: asBool(src.caseSensitive, false),
    trim: asBool(src.trim, true),
    collapseSpaces: asBool(src.collapseSpaces, true),
    ignorePunctuation: asBool(src.ignorePunctuation, true),
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
  else if (typeof image.assetId !== 'string' || !image.assetId.trim()) errors.push('config.image.assetId: an uploaded image is required');
  if (image && typeof image.alt !== 'string') errors.push('config.image.alt: must be a string');

  const boxes = asArray(config.boxes);
  if (boxes.length < 1) errors.push('config.boxes: at least one box is required');
  if (boxes.length > 50) errors.push('config.boxes: at most 50 boxes are allowed');
  const ids = new Set();
  boxes.forEach((box, index) => {
    if (!box || typeof box !== 'object') {
      errors.push(`config.boxes[${index}]: must be an object`);
      return;
    }
    if (typeof box.id !== 'string' || !box.id) errors.push(`config.boxes[${index}].id: must be a non-empty string`);
    else if (ids.has(box.id)) errors.push(`config.boxes[${index}].id: duplicate box id "${box.id}"`);
    else ids.add(box.id);
    for (const key of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(box[key]) || box[key] < 0 || box[key] > 1) {
        errors.push(`config.boxes[${index}].${key}: must be a number between 0 and 1`);
      }
    }
    if (Number.isFinite(box.w) && box.w <= 0) errors.push(`config.boxes[${index}].w: must be > 0`);
    if (Number.isFinite(box.h) && box.h <= 0) errors.push(`config.boxes[${index}].h: must be > 0`);
    if (typeof box.label !== 'string') errors.push(`config.boxes[${index}].label: must be a string`);
    const accepted = asArray(box.accepted);
    accepted.forEach((value, aIndex) => {
      if (typeof value !== 'string') errors.push(`config.boxes[${index}].accepted[${aIndex}]: must be a string`);
      else if (value.length > 500) errors.push(`config.boxes[${index}].accepted[${aIndex}]: at most 500 characters`);
    });
  });

  if (!INPUT_MODES.includes(config.inputMode)) errors.push('config.inputMode: must be "type" or "drag"');
  const wordBank = asArray(config.wordBank);
  if (wordBank.length > 100) errors.push('config.wordBank: at most 100 words');
  wordBank.forEach((value, index) => {
    if (typeof value !== 'string') errors.push(`config.wordBank[${index}]: must be a string`);
  });
  if (config.inputMode === 'drag') {
    if (wordBank.length < 1) errors.push('config.wordBank: drag mode needs at least one word in the bank');
    const bank = new Set(wordBank.map((value) => normalizeText(value, { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: false })));
    for (const box of boxes) {
      const accepted = asArray(box.accepted).filter((value) => typeof value === 'string' && value.trim());
      if (accepted.length < 1) errors.push(`config.boxes: every box needs at least one accepted word in drag mode`);
      for (const value of accepted) {
        if (!bank.has(normalizeText(value, { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: false }))) {
          errors.push(`config.boxes[${box.id || '?'}]: accepted word "${value}" is not in the word bank`);
        }
      }
    }
  }
  for (const key of ['caseSensitive', 'trim', 'collapseSpaces', 'ignorePunctuation']) {
    if (typeof config[key] !== 'boolean') errors.push(`config.${key}: must be a boolean`);
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const normalized = normalizeItem(item);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawAnswers = source.answers;
  if (rawAnswers !== undefined && (typeof rawAnswers !== 'object' || Array.isArray(rawAnswers))) {
    throw new Error('image_boxes response needs { answers: { boxId: word } }');
  }
  const given = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const answers = {};
  for (const box of normalized.config.boxes) {
    const value = given[box.id];
    if (typeof value === 'string') answers[box.id] = value.slice(0, 500);
  }
  return { answers };
}

function matchOptions(config) {
  return {
    caseSensitive: config.caseSensitive,
    trim: config.trim,
    collapseSpaces: config.collapseSpaces,
    ignorePunctuation: config.ignorePunctuation,
  };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const boxes = normalized.config.boxes;
  const options = matchOptions(normalized.config);
  const maxScore = normalized.points;
  const given = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
  const hit = [];
  const miss = [];
  const detail = {};
  for (const box of boxes) {
    const raw = typeof given[box.id] === 'string' ? given[box.id] : '';
    const normalizedGiven = normalizeText(raw, options);
    const accepted = box.accepted.map((value) => normalizeText(value, options)).filter((value) => value !== '');
    const ok = normalizedGiven !== '' && accepted.includes(normalizedGiven);
    if (ok) hit.push(box.id);
    else miss.push(box.id);
    detail[box.id] = { given: raw, correct: ok };
  }
  const total = boxes.length;
  const autoScore = total > 0 ? roundScore((maxScore * hit.length) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && hit.length === total && eqScore(autoScore, maxScore),
    needsManual: false,
    correctParts: hit.length,
    totalParts: total,
    detail: { hit, miss, boxes: detail },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      // `url` is filled in by the server API layer from the assets table.
      image: { assetId: normalized.config.image.assetId, alt: normalized.config.image.alt },
      // Geometry + label are shown to students; accepted answers are the key
      // and must never leak into the student payload.
      boxes: normalized.config.boxes.map((box) => ({
        id: box.id,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        label: box.label,
      })),
      inputMode: normalized.config.inputMode,
      // The word bank is displayed to students in drag mode — not secret.
      wordBank: normalized.config.inputMode === 'drag' ? normalized.config.wordBank.slice() : [],
      caseSensitive: normalized.config.caseSensitive,
      trim: normalized.config.trim,
      collapseSpaces: normalized.config.collapseSpaces,
      ignorePunctuation: normalized.config.ignorePunctuation,
    },
  };
}

/** Post-submit solution boxes for review / answer key (rectangles). */
export function answerZones(item) {
  const normalized = normalizeItem(item);
  return normalized.config.boxes.map((box) => ({
    id: box.id,
    label: box.label,
    accepted: box.accepted.slice(),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  }));
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const answers = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
  const filled = normalized.config.boxes.filter((box) => typeof answers[box.id] === 'string' && answers[box.id].trim() !== '').length;
  return `${filled}/${normalized.config.boxes.length}`;
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const answers = {};
  for (const box of normalized.config.boxes) {
    answers[box.id] = box.accepted.find((value) => value.trim() !== '') || '';
  }
  return { answers };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.boxes.map((box) => `${box.label || box.id} → ${box.accepted.join(' / ') || '—'}`);
}

export function editSchema() {
  // The real editor is the visual canvas (renderImageBoxesEditor in
  // public/teacher/lib/fields.js); this schema is the fallback/documentation.
  return [
    { key: 'image', kind: 'text', label: { en: 'Image', de: 'Bild' } },
    { key: 'boxes', kind: 'list', label: { en: 'Boxes', de: 'Kästchen' }, min: 1, max: 50 },
    { key: 'inputMode', kind: 'select', label: { en: 'Answer mode', de: 'Antwortmodus' }, options: [{ value: 'type', label: { en: 'Type in box', de: 'Ins Kästchen tippen' } }, { value: 'drag', label: { en: 'Drag word onto box', de: 'Wort auf Kästchen ziehen' } }] },
    { key: 'wordBank', kind: 'list', label: { en: 'Word bank (drag mode)', de: 'Wortbank (Zieh-Modus)' }, primitive: 'lines' },
  ];
}
