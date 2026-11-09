// Long answer item: textarea plus a live word counter (min/max limits are
// shown when configured). Scoring is manual on the server.
import { registerMessages, t } from '../lib/i18n.js';
import { h, formatNumber } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  fieldset,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'long_answer';
export const label = { en: 'Long answer', de: 'Freitext' };

registerMessages({
  de: {
    'item.long_answer.legend': 'Ihre Antwort',
    'item.long_answer.label': 'Antwort eingeben',
    'item.long_answer.placeholder': 'Schreiben Sie Ihre Antwort …',
    'item.long_answer.word_count': '{count} Wörter',
    'item.long_answer.word_count_max': '{count} / {max} Wörter',
    'item.long_answer.word_count_min': '{count} / mindestens {min} Wörter',
    'item.long_answer.too_long': 'Der Text ist zu lang (höchstens {max} Wörter).',
    'item.long_answer.too_short': 'Der Text ist zu kurz (mindestens {min} Wörter).',
    'item.long_answer.rubric_label': 'Bewertungsraster (nur Vorschau)',
  },
  en: {
    'item.long_answer.legend': 'Your answer',
    'item.long_answer.label': 'Enter your answer',
    'item.long_answer.placeholder': 'Write your answer …',
    'item.long_answer.word_count': '{count} words',
    'item.long_answer.word_count_max': '{count} / {max} words',
    'item.long_answer.word_count_min': '{count} / at least {min} words',
    'item.long_answer.too_long': 'The text is too long (at most {max} words).',
    'item.long_answer.too_short': 'The text is too short (at least {min} words).',
    'item.long_answer.rubric_label': 'Grading rubric (preview only)',
  },
});

let instanceCounter = 0;

function countWords(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const minWords = Number(config.minWords);
  const maxWords = Number(config.maxWords);
  const hasMin = Number.isFinite(minWords) && minWords > 0;
  const hasMax = Number.isFinite(maxWords) && maxWords > 0;
  const inputId = `ow-long-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  const field = fieldset(t('item.long_answer.legend'));
  field.appendChild(h('label.sr-only', { htmlFor: inputId, text: t('item.long_answer.label') }));

  const textarea = h('textarea.textarea.item-textarea', {
    id: inputId,
    rows: 8,
    autocomplete: 'off',
    spellcheck: 'true',
    placeholder: t('item.long_answer.placeholder'),
    'aria-describedby': `${inputId}-counter`,
  });
  if (readonly) textarea.disabled = true;
  field.appendChild(textarea);

  const counter = h('p.item-word-count', { id: `${inputId}-counter`, 'aria-live': 'polite' });
  field.appendChild(counter);
  const limitNote = h('p.item-hint', { hidden: true });
  field.appendChild(limitNote);
  root.appendChild(field);

  // Authoring preview: expose the raw grading rubric (never present for students).
  if (ctx.mode === 'preview') {
    const rubric = Array.isArray(config.rubric) ? config.rubric : [];
    if (rubric.length) {
      const preview = h('div.item-preview-meta');
      preview.appendChild(h('p.item-preview-title', { text: t('item.long_answer.rubric_label') }));
      const list = h('ul.item-preview-list');
      for (const criterion of rubric) {
        const label = String((criterion && criterion.criterion) || '');
        if (label) list.appendChild(h('li', { text: label }));
      }
      preview.appendChild(list);
      root.appendChild(preview);
    }
  }

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function updateCounter() {
    const words = countWords(textarea.value);
    let text;
    if (hasMax) text = t('item.long_answer.word_count_max', { count: formatNumber(words), max: formatNumber(maxWords) });
    else if (hasMin) text = t('item.long_answer.word_count_min', { count: formatNumber(words), min: formatNumber(minWords) });
    else text = t('item.long_answer.word_count', { count: formatNumber(words) });
    counter.textContent = text;
    let overLimit = false;
    if (hasMax && words > maxWords) {
      overLimit = true;
      limitNote.hidden = false;
      limitNote.textContent = t('item.long_answer.too_long', { max: formatNumber(maxWords) });
      limitNote.classList.add('is-error');
    } else if (hasMin && words > 0 && words < minWords) {
      limitNote.hidden = false;
      limitNote.textContent = t('item.long_answer.too_short', { min: formatNumber(minWords) });
      limitNote.classList.remove('is-error');
    } else {
      limitNote.hidden = true;
      limitNote.textContent = '';
      limitNote.classList.remove('is-error');
    }
    textarea.setAttribute('aria-invalid', overLimit && !readonly ? 'true' : 'false');
  }

  textarea.addEventListener('input', updateCounter);

  function setResponse(response) {
    const text = response && typeof response.text === 'string' ? response.text : '';
    textarea.value = text;
    updateCounter();
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { text: textarea.value };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'textarea:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
