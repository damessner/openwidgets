// Short answer item: one text input, server-side normalization/scoring.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
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

export const type = 'short_answer';
export const label = { en: 'Short answer', de: 'Kurze Antwort' };

registerMessages({
  de: {
    'item.short_answer.legend': 'Ihre Antwort',
    'item.short_answer.label': 'Antwort eingeben',
    'item.short_answer.placeholder': 'Antwort …',
  },
  en: {
    'item.short_answer.legend': 'Your answer',
    'item.short_answer.label': 'Enter your answer',
    'item.short_answer.placeholder': 'Answer …',
  },
});

let instanceCounter = 0;

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const readonly = isReadOnly(ctx);
  const inputId = `ow-sa-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  const field = fieldset(t('item.short_answer.legend'));
  const label = h('label.sr-only', {
    htmlFor: inputId,
    text: t('item.short_answer.label'),
  });
  const input = h('input.input.item-input.item-short-input', {
    type: 'text',
    id: inputId,
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    placeholder: t('item.short_answer.placeholder'),
  });
  if (readonly) input.disabled = true;
  field.appendChild(label);
  field.appendChild(input);
  root.appendChild(field);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const text = response && typeof response.text === 'string' ? response.text : '';
    input.value = text;
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { text: input.value };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'input:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
