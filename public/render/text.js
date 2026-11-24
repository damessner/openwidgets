// Text block item ("Textblock"): rich content — **bold**, *italic*, lists,
// tables, inline images — plus optional inline answer gaps written as
// <<answer>> by the teacher. The student payload masks them as <<>>; here they
// become real inputs (gap ids g1..gN in order of appearance). Without gaps the
// block is pure content and has no response.
import { registerMessages } from '../lib/i18n.js';
import { h, renderRichText } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'text';
export const label = { en: 'Text block', de: 'Textblock' };

registerMessages({
  de: {
    'item.text.empty': 'Dieser Textblock ist leer.',
    'item.text.gap_label': 'Lücke {n}',
  },
  en: {
    'item.text.empty': 'This text block is empty.',
    'item.text.gap_label': 'Gap {n}',
  },
});

const GAP_MARKER_RE = /<<[^<>]*>>/;

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const root = itemRoot(type, ctx);

  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);

  const bodyText = String(config.text || '');
  const hasGaps = GAP_MARKER_RE.test(bodyText);
  const gapInputs = new Map(); // gapId -> input

  if (bodyText.trim()) {
    const body = h('div.item-text-content');
    if (hasGaps) {
      renderRichText(body, bodyText, {
        editableGaps: true,
        readonlyGaps: readonly,
        gapValues: {},
        gapLabel: (gapId, n) => `${t('item.text.gap_label', { n })}`,
        onGapInput: () => {},
      });
      // collect the gap inputs renderRichText created, in document order
      body.querySelectorAll('input.rt-gap').forEach((input) => {
        gapInputs.set(input.dataset.gap, input);
      });
    } else {
      renderRichText(body, bodyText);
    }
    root.appendChild(body);
  }

  const help = helpBlock(item);
  if (help) root.appendChild(help);

  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!root.childNodes.length) root.appendChild(notice(t('item.text.empty'), 'info'));

  const resultRegion = createResultRegion();
  if (hasGaps) {
    root.appendChild(resultRegion);
    if (ctx.result) applyResult(root, resultRegion, ctx.result);
    const keyBlock = solutionBlock(item, ctx);
    if (keyBlock) root.appendChild(keyBlock);
  }

  function setResponse(response) {
    const gaps = response && response.gaps && typeof response.gaps === 'object' ? response.gaps : {};
    for (const [gapId, input] of gapInputs) {
      input.value = typeof gaps[gapId] === 'string' ? gaps[gapId] : '';
    }
  }
  setResponse(ctx.response);

  container.replaceChildren(root);

  return {
    getResponse() {
      if (!hasGaps) return {};
      const gaps = {};
      for (const [gapId, input] of gapInputs) gaps[gapId] = input.value;
      return { gaps };
    },
    setResponse,
    setResult(result) {
      if (!hasGaps) return;
      applyResult(root, resultRegion, result);
      const detail = result && result.detail && typeof result.detail === 'object' ? result.detail : {};
      const perGap = detail.gaps && typeof detail.gaps === 'object' ? detail.gaps : {};
      for (const [gapId, input] of gapInputs) {
        const entry = perGap[gapId];
        input.classList.remove('is-correct', 'is-incorrect');
        if (entry && entry.correct) input.classList.add('is-correct');
        else if (entry && entry.given) input.classList.add('is-incorrect');
      }
    },
    focus() {
      if (gapInputs.size && !focusFirst(root, 'input.rt-gap')) focusRoot(root);
      else focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
