// Activity definition helpers: default document, normalization, validation,
// student sanitization and statistics. Pure module — importable from the
// server and the browser.
import { deepClone } from './util.js';
import { getType, itemTypeMeta, normalizeItem, sanitizeItem } from './items/index.js';

export const DEFINITION_VERSION = 1;
export const MAX_ITEMS = 300;

export function defaultSettings() {
  return {
    instantFeedback: true,
    shuffleItems: false,
    showResults: true,
    allowReview: true,
    showAnswers: false,
    warnUnanswered: true,
    timeLimitMinutes: null,
    requireName: true,
    accessibility: { tts: true, starQuestions: true, fontScale: true },
  };
}

/** Coerce arbitrary settings JSON into the canonical shape. */
export function normalizeSettings(settings) {
  const src = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const accessibility =
    src.accessibility && typeof src.accessibility === 'object' && !Array.isArray(src.accessibility)
      ? src.accessibility
      : {};
  let timeLimitMinutes = null;
  if (src.timeLimitMinutes !== null && src.timeLimitMinutes !== undefined && src.timeLimitMinutes !== '') {
    const minutes = Number(src.timeLimitMinutes);
    if (Number.isFinite(minutes) && minutes > 0) timeLimitMinutes = Math.min(600, Math.round(minutes));
  }
  return {
    instantFeedback: typeof src.instantFeedback === 'boolean' ? src.instantFeedback : true,
    shuffleItems: typeof src.shuffleItems === 'boolean' ? src.shuffleItems : false,
    showResults: typeof src.showResults === 'boolean' ? src.showResults : true,
    allowReview: typeof src.allowReview === 'boolean' ? src.allowReview : true,
    showAnswers: typeof src.showAnswers === 'boolean' ? src.showAnswers : false,
    warnUnanswered: typeof src.warnUnanswered === 'boolean' ? src.warnUnanswered : true,
    timeLimitMinutes,
    requireName: typeof src.requireName === 'boolean' ? src.requireName : true,
    accessibility: {
      tts: typeof accessibility.tts === 'boolean' ? accessibility.tts : true,
      starQuestions: typeof accessibility.starQuestions === 'boolean' ? accessibility.starQuestions : true,
      fontScale: typeof accessibility.fontScale === 'boolean' ? accessibility.fontScale : true,
    },
  };
}

/** A fresh, empty activity definition. */
export function createDefinition({ template = 'worksheet', locale = 'de', title = '' } = {}) {
  return {
    v: DEFINITION_VERSION,
    template: template === 'quiz' ? 'quiz' : 'worksheet',
    title: typeof title === 'string' ? title : '',
    description: '',
    locale: locale === 'en' ? 'en' : 'de',
    settings: defaultSettings(),
    items: [],
  };
}

export function emptyDefinition() {
  return createDefinition();
}

/** Fill in every missing field and normalize all items. Returns a new object. */
export function normalizeActivity(definition) {
  const src = definition && typeof definition === 'object' && !Array.isArray(definition) ? definition : {};
  const items = Array.isArray(src.items) ? src.items : [];
  return {
    v: DEFINITION_VERSION,
    template: src.template === 'quiz' ? 'quiz' : 'worksheet',
    title: typeof src.title === 'string' ? src.title : '',
    description: typeof src.description === 'string' ? src.description : '',
    locale: src.locale === 'en' ? 'en' : 'de',
    settings: normalizeSettings(src.settings),
    items: items.map((item) => normalizeItem(item)),
  };
}

function splitItemError(error) {
  const text = String(error || '');
  const index = text.indexOf(': ');
  if (index > 0) return { path: text.slice(0, index), message: text.slice(index + 2) };
  return { path: '', message: text };
}

/**
 * Validate a definition.
 * @returns {{ok: boolean, errors: Array<{path: string, message: string}>}}
 */
export function validateActivity(definition) {
  const errors = [];
  const push = (path, message) => errors.push({ path, message });

  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { ok: false, errors: [{ path: '', message: 'Activity definition must be an object' }] };
  }

  const raw = definition;
  const normalized = normalizeActivity(raw);

  if (raw.v !== undefined && raw.v !== DEFINITION_VERSION) {
    push('v', `Unsupported definition version (expected ${DEFINITION_VERSION})`);
  }
  if (raw.template !== undefined && raw.template !== 'quiz' && raw.template !== 'worksheet') {
    push('template', 'template must be "quiz" or "worksheet"');
  }
  if (raw.locale !== undefined && raw.locale !== 'de' && raw.locale !== 'en') {
    push('locale', 'locale must be "de" or "en"');
  }
  if (normalized.title.length > 200) push('title', 'title must be at most 200 characters');
  if (normalized.description.length > 10000) {
    push('description', 'description must be at most 10000 characters');
  }

  const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  if (rawSettings.timeLimitMinutes !== undefined && rawSettings.timeLimitMinutes !== null) {
    const minutes = Number(rawSettings.timeLimitMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
      push('settings.timeLimitMinutes', 'timeLimitMinutes must be null or a number between 1 and 600');
    }
  }
  for (const key of [
    'instantFeedback',
    'shuffleItems',
    'showResults',
    'allowReview',
    'showAnswers',
    'warnUnanswered',
    'requireName',
  ]) {
    if (rawSettings[key] !== undefined && typeof rawSettings[key] !== 'boolean') {
      push(`settings.${key}`, `${key} must be a boolean`);
    }
  }

  const rawItems = raw.items;
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    push('items', 'items must be an array');
  } else {
    const items = normalized.items;
    if (items.length > MAX_ITEMS) push('items', `an activity supports at most ${MAX_ITEMS} items`);
    const seenIds = new Map();
    items.forEach((item, index) => {
      const duplicateAt = seenIds.get(item.id);
      if (duplicateAt !== undefined) {
        push(`items[${index}].id`, `duplicate item id "${item.id}" (also used by item ${duplicateAt + 1})`);
      } else {
        seenIds.set(item.id, index);
      }
      const module = getType(item.type);
      if (!module) {
        push(`items[${index}].type`, `unknown item type "${item.type}"`);
        return;
      }
      for (const error of module.validateItem(item)) {
        const { path, message } = splitItemError(error);
        push(path ? `items[${index}].${path}` : `items[${index}]`, message);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Student-safe activity: no answers, hints, rubric, zone radii, feedback.
 * Note: the server additionally re-orders items per assignment settings.
 */
export function sanitizeActivity(definition) {
  const normalized = normalizeActivity(definition);
  return {
    v: DEFINITION_VERSION,
    template: normalized.template,
    title: normalized.title,
    description: normalized.description,
    locale: normalized.locale,
    settings: deepClone(normalized.settings),
    items: normalized.items.map((item) => sanitizeItem(item)),
  };
}

/** @returns {{itemCount: number, scoreableCount: number, maxScore: number}} */
export function activityStats(definition) {
  const normalized = normalizeActivity(definition);
  let scoreableCount = 0;
  let maxScore = 0;
  for (const item of normalized.items) {
    const module = getType(item.type);
    if (module && isScoreable(module)) {
      scoreableCount += 1;
      maxScore += Number(item.points) || 0;
    }
  }
  return {
    itemCount: normalized.items.length,
    scoreableCount,
    maxScore: Math.round(maxScore * 10000) / 10000,
  };
}

function isScoreable(module) {
  return !!(module && module.meta && module.meta.scoreable);
}

/** Palette metadata passthrough (re-exported for convenience). */
export { itemTypeMeta };
