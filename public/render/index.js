// Renderer registry for OpenWidgets items.
//
// Every item module under public/render/<type>.js implements the contract from
// docs/CONTRACT.md §6:
//
//   export const type = '<type>';
//   export const label = { en, de };
//   export function mount(container, ctx) => {
//     getResponse(), setResponse(response), setResult(result), focus(), destroy()
//   }
//
// ctx = { item, response, mode: 'student'|'preview'|'review', locale, seed,
//         disabled, showAnswers, answerText, reviewZones, result }
//
// Page-independent: the student player and the teacher app both mount these.
import { t } from '../lib/i18n.js';
import { h, renderRichText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { notice, focusRoot } from './_shared.js';

import * as text from './text.js';
import * as multipleChoice from './multiple_choice.js';
import * as shortAnswer from './short_answer.js';
import * as numeric from './numeric.js';
import * as fillBlanks from './fill_blanks.js';
import * as match from './match.js';
import * as ordering from './ordering.js';
import * as pins from './pins.js';
import * as imageBoxes from './image_boxes.js';
import * as longAnswer from './long_answer.js';
import * as hotspot from './hotspot.js';
import * as table from './table.js';
import * as groups from './groups.js';
import * as markSentence from './mark_sentence.js';
import * as audioAnswer from './audio_answer.js';

const modules = [text, multipleChoice, shortAnswer, numeric, fillBlanks, match, ordering, pins, imageBoxes, longAnswer, hotspot, table, groups, markSentence, audioAnswer];

/** Map<type, rendererModule> — e.g. for palette listings. */
export const renderers = new Map(modules.map((module) => [module.type, module]));

/** All supported item type ids in registry order. */
export function rendererTypes() {
  return Array.from(renderers.keys());
}

/** Renderer module for a type, or null. */
export function getRenderer(type) {
  return renderers.get(String(type === undefined || type === null ? '' : type)) || null;
}

export function isSupportedType(type) {
  return getRenderer(type) !== null;
}

/** Localized human label for an item type ({en, de}), or null. */
export function rendererLabel(type) {
  const module = getRenderer(type);
  return module && module.label ? module.label : null;
}

/**
 * Graceful fallback used for unknown item types (and as an error boundary when
 * a renderer throws on malformed data): the caller gets the same object shape
 * as a real renderer so the page never ends up blank.
 */
function mountFallback(container, ctx, reason) {
  const item = ctx && ctx.item && typeof ctx.item === 'object' ? ctx.item : {};
  const root = h('div.ow-item.ow-item-unknown', {
    dataset: { itemType: String(item.type === undefined ? 'unknown' : item.type) },
  });
  const box = h('div.item-notice.item-notice-warning');
  box.appendChild(h('span.item-notice-icon', { html: icon('warning', { size: 20 }) }));
  box.appendChild(h('span', { text: t('item.unknown_type') }));
  root.appendChild(box);
  root.appendChild(h('p.item-help', { text: t('item.unknown_type_hint') }));
  const stemText = String(item.stem || '').trim();
  if (stemText) {
    const stem = h('div.item-stem');
    renderRichText(stem, stemText);
    root.appendChild(stem);
  }
  if (reason) root.dataset.fallbackReason = String(reason);
  container.replaceChildren(root);
  return {
    getResponse() {
      return {};
    },
    setResponse() {
      /* nothing to restore */
    },
    setResult() {
      /* nothing to mark */
    },
    focus() {
      focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}

/**
 * Mount the renderer for `ctx.item.type` into `container`.
 * Unknown types and renderer crashes fall back to a visible notice.
 */
export function mountItem(container, ctx = {}) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('mountItem(container, ctx): container must be a DOM element');
  }
  const module = getRenderer(ctx && ctx.item && ctx.item.type);
  if (!module || typeof module.mount !== 'function') {
    return mountFallback(container, ctx, 'unknown_type');
  }
  try {
    return module.mount(container, ctx);
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error(`[openwidgets] renderer failed for type "${module.type}"`, error);
    }
    return mountFallback(container, ctx, 'renderer_error');
  }
}

/** Contract alias: some callers refer to static rendering as renderItemStatic. */
export const renderItemStatic = mountItem;
