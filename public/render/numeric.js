// Numeric answer item: raw string response (localized comma/dot accepted),
// parsed and scored on the server.
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

export const type = 'numeric';
export const label = { en: 'Numeric answer', de: 'Numerische Antwort' };

registerMessages({
  de: {
    'item.numeric.legend': 'Ihre Zahl',
    'item.numeric.label': 'Zahl eingeben',
    'item.numeric.placeholder': 'z. B. 3,5',
    'item.numeric.hint': 'Komma oder Punkt als Dezimaltrennzeichen sind erlaubt.',
  },
  en: {
    'item.numeric.legend': 'Your number',
    'item.numeric.label': 'Enter a number',
    'item.numeric.placeholder': 'e.g. 3.5',
    'item.numeric.hint': 'You may use a comma or a dot as the decimal separator.',
  },
});

let instanceCounter = 0;

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const readonly = isReadOnly(ctx);
  const inputId = `ow-num-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  const field = fieldset(t('item.numeric.legend'));
  const label = h('label.sr-only', { htmlFor: inputId, text: t('item.numeric.label') });
  const input = h('input.input.item-input.item-numeric-input', {
    type: 'text',
    id: inputId,
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t('item.numeric.placeholder'),
    'aria-describedby': `${inputId}-hint`,
  });
  if (readonly) input.disabled = true;
  const hint = h('p.item-hint', { id: `${inputId}-hint`, text: t('item.numeric.hint') });
  field.appendChild(label);
  field.appendChild(input);
  field.appendChild(hint);
  root.appendChild(field);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const value = response && response.value !== undefined && response.value !== null ? response.value : '';
    input.value = String(value);
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { value: input.value };
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
