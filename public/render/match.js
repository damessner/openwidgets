// Matching item: one <select> per left-hand entry (keyboard/screen-reader
// friendly, no drag interaction).
//
// Two config shapes must be supported:
//  - raw item (preview/review in the teacher app):
//      { pairs: [{id, left, right}], shuffle }
//    right-hand options are derived and shuffled here (deterministic seed).
//  - sanitized student item:
//      { shuffle, lefts: [{id, text}], rights: [{id, text}] }
//    `rights` are already deterministically shuffled server-side and their ids
//    ARE the pair ids, so they are rendered as-is.
// Canonical response: { matches: { <leftPairId>: <rightPairId> } }.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  fieldset,
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'match';
export const label = { en: 'Matching', de: 'Zuordnen' };

registerMessages({
  de: {
    'item.match.legend': 'Ordnen Sie jeder Aussage die passende Zuordnung zu.',
    'item.match.placeholder': 'Bitte wählen …',
    'item.match.select_label': 'Zuordnung für: {left}',
    'item.match.empty': 'Für diese Aufgabe sind keine Zuordnungen hinterlegt.',
  },
  en: {
    'item.match.legend': 'Match each item on the left with the correct option.',
    'item.match.placeholder': 'Choose …',
    'item.match.select_label': 'Match for: {left}',
    'item.match.empty': 'No matching pairs are configured for this item.',
  },
});

let instanceCounter = 0;

function asEntryList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => entry && typeof entry === 'object' && entry.id !== undefined && entry.id !== null)
    .map((entry) => ({ id: entry.id, text: String(entry.text === undefined || entry.text === null ? '' : entry.text) }));
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const groupName = `ow-match-${++instanceCounter}`;

  // Resolve the two supported shapes.
  let lefts = [];
  let rights = [];
  if (Array.isArray(config.lefts) || Array.isArray(config.rights)) {
    lefts = asEntryList(config.lefts);
    rights = asEntryList(config.rights);
  } else if (Array.isArray(config.pairs)) {
    const pairs = config.pairs.filter(
      (pair) => pair && typeof pair === 'object' && pair.id !== undefined && pair.id !== null,
    );
    lefts = pairs.map((pair) => ({
      id: pair.id,
      text: String(pair.left === undefined || pair.left === null ? '' : pair.left),
    }));
    const rightEntries = pairs.map((pair) => ({
      id: pair.id,
      text: String(pair.right === undefined || pair.right === null ? '' : pair.right),
    }));
    rights = config.shuffle === false ? rightEntries : shuffled(rightEntries, ctx, 'match-rights');
  }

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!lefts.length) {
    root.appendChild(notice(t('item.match.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() {
        return { matches: {} };
      },
      setResponse() {
        /* nothing to set */
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

  const field = fieldset(t('item.match.legend'));
  const list = h('div.item-match-list');
  /** @type {Array<{left: {id: any, text: string}, select: HTMLSelectElement}>} */
  const entries = [];

  lefts.forEach((left, index) => {
    const selectId = `${groupName}-${index}`;
    const select = h('select.select.item-match-select', {
      id: selectId,
      'aria-label': t('item.match.select_label', { left: left.text }),
    });
    select.appendChild(h('option', { value: '' }, t('item.match.placeholder')));
    for (const option of rights) {
      const optionEl = h('option', { value: String(option.id) });
      optionEl.textContent = option.text;
      select.appendChild(optionEl);
    }
    if (readonly) select.disabled = true;

    const row = h(
      'div.item-match-row',
      h('span.item-match-left', { text: left.text }),
      h('span.item-match-arrow', { 'aria-hidden': 'true', text: '→' }),
      select,
    );
    entries.push({ left, select });
    list.appendChild(row);
  });

  field.appendChild(list);
  root.appendChild(field);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const matches =
      response && response.matches && typeof response.matches === 'object' ? response.matches : {};
    for (const { left, select } of entries) {
      const value =
        matches[left.id] === undefined || matches[left.id] === null ? '' : String(matches[left.id]);
      const exists = Array.from(select.options).some((option) => option.value === value);
      select.value = exists ? value : '';
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      const matches = {};
      for (const { left, select } of entries) {
        if (select.value) matches[left.id] = select.value;
      }
      return { matches };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'select:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
