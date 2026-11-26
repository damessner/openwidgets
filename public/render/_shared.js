// Shared helpers for the item renderers (public/render/*.js).
//
// Renderers are page-independent: no student-page globals, no answer keys
// assumed. Student payloads are sanitized (no keys), while the teacher app may
// pass raw activity items for preview/review/print — so `showAnswers` reveals
// answer keys only when the item actually still contains them.
import { registerMessages, t, getLocale } from '../lib/i18n.js';
import { h, clear, renderRichText, fmtScore, formatNumber } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { clamp, seededShuffle } from '../../shared/util.js';

registerMessages({
  de: {
    'item.answer_key': 'Lösung',
    'item.media_missing': 'Der Medieninhalt konnte nicht geladen werden.',
    'item.media_image_alt': 'Abbildung zur Aufgabe',
    'item.media_speed_normal': '▶ Normal',
    'item.media_speed_slow': '🐢 Langsam',
    'item.unknown_type': 'Dieser Aufgabentyp kann in dieser Ansicht nicht angezeigt werden.',
    'item.unknown_type_hint': 'Bitte wenden Sie sich an Ihre Lehrkraft.',
    'item.result.correct': 'Richtig',
    'item.result.incorrect': 'Falsch',
    'item.result.partial': 'Teilweise richtig',
    'item.result.manual': 'Wird manuell bewertet',
    'item.result.points': '{score} / {max} P.',
    'item.result.no_points': 'Keine Punkte',
  },
  en: {
    'item.answer_key': 'Answer',
    'item.media_missing': 'The media content could not be loaded.',
    'item.media_image_alt': 'Image for the question',
    'item.media_speed_normal': '▶ Normal',
    'item.media_speed_slow': '🐢 Slow',
    'item.unknown_type': 'This item type cannot be displayed in this view.',
    'item.unknown_type_hint': 'Please contact your teacher.',
    'item.result.correct': 'Correct',
    'item.result.incorrect': 'Incorrect',
    'item.result.partial': 'Partially correct',
    'item.result.manual': 'Will be graded manually',
    'item.result.points': '{score} / {max} pts',
    'item.result.no_points': 'No points',
  },
});

/** Normalize an answer key description to a string[] (accepts string|string[]). */
export function normalizeAnswerLines(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => String(entry === null || entry === undefined ? '' : entry).trim())
    .filter(Boolean);
}

/** Fill in defaults for the renderer context documented in CONTRACT §6. */
export function normalizeCtx(ctx = {}) {
  const raw = ctx && typeof ctx === 'object' ? ctx : {};
  const mode = raw.mode === 'review' || raw.mode === 'preview' ? raw.mode : 'student';
  return {
    item: raw.item && typeof raw.item === 'object' ? raw.item : {},
    response: raw.response === undefined ? null : raw.response,
    mode,
    locale: raw.locale === 'en' || raw.locale === 'de' ? raw.locale : getLocale(),
    seed: raw.seed === undefined || raw.seed === null ? 0 : raw.seed,
    disabled: raw.disabled === true,
    showAnswers: raw.showAnswers === true,
    // Solution text for the review/result screen (server-provided, string[]).
    answerText: normalizeAnswerLines(raw.answerText),
    // Optional solution zones for pins (result payload / teacher answer key).
    reviewZones: Array.isArray(raw.reviewZones) ? raw.reviewZones : null,
    result:
      raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result) ? raw.result : null,
  };
}

/** Read-only means "the user cannot change the response". */
export function isReadOnly(ctx) {
  return ctx.disabled === true || ctx.mode === 'review';
}

/** Deterministic seed for a given item + purpose (survives reloads). */
export function stableSeed(ctx, purpose = '') {
  return `${ctx.seed ?? 0}:${ctx.item && ctx.item.id ? ctx.item.id : 'item'}:${purpose}`;
}

/** Deterministic shuffle of an item-local array. */
export function shuffled(list, ctx, purpose = '') {
  return seededShuffle(Array.isArray(list) ? list : [], stableSeed(ctx, purpose));
}

/** Common wrapper element carrying type/mode/result styling hooks. */
export function itemRoot(type, ctx) {
  const root = h('div.ow-item', { dataset: { itemType: type, mode: ctx.mode } });
  if (ctx.mode === 'review') root.dataset.readonly = 'true';
  return root;
}

/** Stem (question text) with markdown-lite support; null when empty. */
export function stemBlock(item) {
  const text = String((item && item.stem) || '').trim();
  if (!text) return null;
  const el = h('div.item-stem');
  renderRichText(el, text);
  return el;
}

/** Optional hint under the stem; null when empty. */
export function helpBlock(item) {
  const text = String((item && item.help) || '').trim();
  if (!text) return null;
  const el = h('div.item-help');
  renderRichText(el, text);
  return el;
}

/** Build a public asset URL. Media definitions carry an assetId; the server
 * route is /assets/:id/:filename and ignores the cosmetic filename segment. */
export function mediaUrl(media) {
  if (!media || typeof media !== 'object') return null;
  if (typeof media.url === 'string' && media.url.trim()) return media.url;
  const assetId = media.assetId;
  if (!assetId) return null;
  const id = encodeURIComponent(String(assetId));
  const name = encodeURIComponent(String(media.filename || assetId));
  return `/assets/${id}/${name}`;
}

/** URL of the slow-speed variant of an audio media (TTS "langsam"), or null. */
export function slowMediaUrl(media) {
  if (!media || typeof media !== 'object') return null;
  if (typeof media.slowUrl === 'string' && media.slowUrl.trim()) return media.slowUrl;
  if (!media.slowAssetId) return null;
  const id = encodeURIComponent(String(media.slowAssetId));
  const name = encodeURIComponent(String(media.slowFilename || media.slowAssetId));
  return `/assets/${id}/${name}`;
}

/** Render item.media (image/audio/video) as a safe DOM block, or null. */
export function mediaBlock(media) {
  if (!media || typeof media !== 'object') return null;
  const mediaType = String(media.type || 'none');
  if (mediaType === 'none') return null;
  const url = mediaUrl(media);
  if (!url) return null;
  let node = null;
  let mediaEl = null; // the actual <img>/<audio>/<video> for the error handler
  if (mediaType === 'image') {
    node = h('img.item-media-img', {
      src: url,
      alt: String(media.alt || '') || t('item.media_image_alt'),
      loading: 'lazy',
      decoding: 'async',
    });
    mediaEl = node;
  } else if (mediaType === 'audio') {
    const audio = h('audio.item-media-audio', { controls: true, preload: 'metadata', src: url });
    mediaEl = audio;
    const slowUrl = slowMediaUrl(media);
    if (slowUrl) {
      // normal + slow version: small toggle above the player switches the source
      const normalBtn = h('button.btn.btn-sm.btn-secondary.audio-speed-btn.is-active', { type: 'button', dataset: { speed: 'normal' } }, t('item.media_speed_normal'));
      const slowBtn = h('button.btn.btn-sm.btn-secondary.audio-speed-btn', { type: 'button', dataset: { speed: 'slow' } }, t('item.media_speed_slow'));
      const switchSpeed = (btn, targetUrl) => {
        audio.src = targetUrl;
        audio.load();
        normalBtn.classList.toggle('is-active', btn === normalBtn);
        slowBtn.classList.toggle('is-active', btn === slowBtn);
      };
      normalBtn.addEventListener('click', () => switchSpeed(normalBtn, url));
      slowBtn.addEventListener('click', () => switchSpeed(slowBtn, slowUrl));
      node = h('div.item-media-audio-wrap', h('div.row.gap-1.mb-1', normalBtn, slowBtn), audio);
    } else {
      node = audio;
    }
  } else if (mediaType === 'video') {
    node = h('video.item-media-video', { controls: true, preload: 'metadata', src: url });
    mediaEl = node;
  }
  if (!node) return null;
  const wrap = h('div.item-media', { dataset: { mediaType } });
  if (mediaEl) {
    mediaEl.addEventListener(
      'error',
      () => {
        wrap.replaceChildren(h('p.item-media-error', { text: t('item.media_missing') }));
      },
      { once: true },
    );
  }
  wrap.appendChild(node);
  return wrap;
}

/** Visible "no content" notice (plain text). */
export function notice(text, kind = 'info') {
  return h(`div.item-notice.item-notice-${kind}`, { text: String(text) });
}

/** Accessible fieldset (+ visually hidden legend when the stem already asks it). */
export function fieldset(legendText) {
  const fs = h('fieldset.item-fieldset');
  if (legendText) fs.appendChild(h('legend.item-legend.sr-only', { text: String(legendText) }));
  return fs;
}

/** Icon-only marker used to flag correct answers in answer-key views. */
export function correctMark(extraClass = '') {
  const mark = h(`span.item-correct-mark${extraClass ? `.${extraClass}` : ''}`, {
    html: icon('check', { size: 16 }),
  });
  mark.appendChild(h('span.sr-only', { text: t('item.answer_key') }));
  return mark;
}

// ---------------------------------------------------------------------------
// Result feedback (marks only — never answer keys; result payloads contain
// only correct/autoScore/maxScore/needsManual from the server).
// ---------------------------------------------------------------------------

export function resultStateOf(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.needsManual === true) return 'manual';
  if (result.correct === true) return 'correct';
  const auto = Number(result.autoScore);
  const max = Number(result.maxScore);
  if (Number.isFinite(auto) && Number.isFinite(max) && max > 0 && auto >= max - 1e-9) return 'correct';
  if (Number.isFinite(auto) && auto > 0) return 'partial';
  return 'incorrect';
}

const RESULT_ICONS = {
  correct: 'checkCircle',
  incorrect: 'xCircle',
  partial: 'partial',
  manual: 'info',
};

export function createResultRegion() {
  return h('div.item-result', { role: 'status', 'aria-live': 'polite', hidden: true });
}

/**
 * Apply (or clear, with result === null) a per-item result to the renderer root.
 * Adds `data-result` for CSS state classes and fills an aria-live region.
 */
export function applyResult(root, region, result) {
  if (!root || !region) return;
  const state = resultStateOf(result);
  if (!state) {
    delete root.dataset.result;
    region.hidden = true;
    clear(region);
    region.removeAttribute('data-state');
    return;
  }
  root.dataset.result = state;
  region.dataset.state = state;
  region.hidden = false;
  clear(region);
  region.appendChild(
    h('span.item-result-icon', { html: icon(RESULT_ICONS[state] || 'info', { size: 18 }) }),
  );
  region.appendChild(h('span.item-result-text', { text: t(`item.result.${state}`) }));
  const auto = Number(result.autoScore);
  const max = Number(result.maxScore);
  if (Number.isFinite(auto) && Number.isFinite(max) && max > 0) {
    region.appendChild(
      h('span.item-result-points', {
        text: t('item.result.points', { score: fmtScore(Math.max(0, auto)), max: fmtScore(max) }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Answer-key reveal for raw (teacher-owned) items only. Student payloads have
// the keys stripped, so these helpers return an empty string and render
// nothing there. The student result screen renders `answerText` separately.
// ---------------------------------------------------------------------------

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOf(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/** Plain-text description of the correct answer from a *raw* item config. */
export function rawAnswerText(item) {
  const config = item && item.config && typeof item.config === 'object' ? item.config : {};
  switch (item && item.type) {
    case 'multiple_choice': {
      const choices = Array.isArray(config.choices) ? config.choices : [];
      if (!choices.some((choice) => choice && choice.correct === true)) return '';
      return choices
        .filter((choice) => choice && choice.correct === true)
        .map((choice) => textOf(choice.text))
        .filter(Boolean)
        .join(' · ');
    }
    case 'short_answer': {
      const accepted = Array.isArray(config.accepted) ? config.accepted : [];
      return accepted.map(textOf).filter(Boolean).join(' · ');
    }
    case 'numeric': {
      const answer = numberOrNull(config.answer);
      if (answer === null) return '';
      const tolerance = numberOrNull(config.tolerance);
      let suffix = '';
      if (tolerance !== null && tolerance > 0) {
        suffix =
          config.toleranceType === 'percent'
            ? ` (±${formatNumber(tolerance)} %)`
            : ` (±${formatNumber(tolerance)})`;
      }
      return `${formatNumber(answer)}${suffix}`;
    }
    case 'fill_blanks': {
      const blanks = config.blanks && typeof config.blanks === 'object' ? config.blanks : {};
      return Object.keys(blanks)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((key) => {
          const accepted = Array.isArray(blanks[key] && blanks[key].accepted)
            ? blanks[key].accepted
            : [];
          const first = accepted.map(textOf).filter(Boolean)[0];
          return first ? `${key}: ${first}` : '';
        })
        .filter(Boolean)
        .join(' · ');
    }
    case 'match': {
      const pairs = Array.isArray(config.pairs) ? config.pairs : [];
      return pairs
        .filter((pair) => pair && pair.left !== undefined && pair.right !== undefined)
        .map((pair) => `${textOf(pair.left)} → ${textOf(pair.right)}`)
        .join(' · ');
    }
    case 'ordering': {
      const items = Array.isArray(config.items) ? config.items : [];
      return items
        .map((entry, index) => `${index + 1}. ${textOf(entry && entry.text)}`)
        .join(' · ');
    }
    case 'pins': {
      const zones = Array.isArray(config.zones) ? config.zones : [];
      return zones
        .map((zone) => textOf(zone && (zone.label || zone.id)))
        .filter(Boolean)
        .join(' · ');
    }
    case 'long_answer': {
      const hints = Array.isArray(config.hints) ? config.hints : [];
      const hintTexts = hints.map((hint) => textOf(hint && hint.text)).filter(Boolean);
      if (hintTexts.length) return hintTexts.join(' · ');
      const rubric = Array.isArray(config.rubric) ? config.rubric : [];
      return rubric
        .map((criterion) => textOf(criterion && criterion.criterion))
        .filter(Boolean)
        .join(' · ');
    }
    default:
      return '';
  }
}

/**
 * Server-provided solution lines for the review/result view (`ctx.answerText`).
 * The student result payload contains only these strings — never the config
 * answer keys — so renderers display them generically under the item.
 */
export function answerTextBlock(ctx) {
  if (!ctx) return null;
  const lines = normalizeAnswerLines(ctx.answerText);
  if (!lines.length) return null;
  const block = h('div.item-answer-key', { dataset: { source: 'result' } });
  block.appendChild(h('span.item-answer-key-label', { text: t('item.answer_key') }));
  if (lines.length === 1) {
    block.appendChild(h('span.item-answer-key-text', { text: lines[0] }));
  } else {
    block.appendChild(h('ul.item-answer-key-list', lines.map((line) => h('li', { text: line }))));
  }
  return block;
}

/**
 * Config-derived solution text. Only meaningful for *raw* teacher-owned items
 * (preview/print/review in the authoring UI); sanitized student items have the
 * keys stripped so this returns null there.
 */
export function configAnswerBlock(item, ctx) {
  if (!ctx || ctx.showAnswers !== true) return null;
  if (ctx.mode === 'student') return null;
  const text = rawAnswerText(item);
  if (!text) return null;
  return h(
    'div.item-answer-key',
    { dataset: { source: 'config' } },
    h('span.item-answer-key-label', { text: t('item.answer_key') }),
    h('span.item-answer-key-text', { text }),
  );
}

/**
 * Best solution block for the current context: server result text first,
 * teacher config answer key as a preview/review fallback.
 */
export function solutionBlock(item, ctx) {
  return answerTextBlock(ctx) || configAnswerBlock(item, ctx);
}

/** Focus the first focusable non-disabled element matching selector. */
export function focusFirst(root, selector) {
  if (!root) return false;
  const nodes = root.querySelectorAll(selector || 'input:enabled, select:enabled, textarea:enabled, button:enabled');
  for (const node of nodes) {
    if (typeof node.focus === 'function' && !node.disabled) {
      node.focus();
      return true;
    }
  }
  return false;
}

/** Make a non-focusable root focusable as a last-resort focus target. */
export function focusRoot(root) {
  if (!root) return;
  if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
  root.focus();
}

/** Rounded normalized coordinate (0..1, 4 decimals). */
export function roundCoord(value) {
  return Math.round(clamp(value, 0, 1) * 10000) / 10000;
}

/** Simple polite live region for renderer-internal announcements. */
export function liveRegion(className = 'item-live') {
  return h(`div.${className}`, { role: 'status', 'aria-live': 'polite' });
}

/** Replace the text of a live region (announces when text changes). */
export function announce(region, text) {
  if (!region) return;
  region.textContent = String(text || '');
}
