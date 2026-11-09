// Ordering item: list reordered with up/down buttons (no drag-only interaction).
//
// Two config shapes must be supported:
//  - sanitized student item: `config.items` are ALREADY deterministically
//    shuffled server-side, so render them in the given order and never
//    re-shuffle (that would desync from the server seed).
//  - raw teacher item: `config.items` are in the correct order.
// A stored response (`{order:[itemId,…]}`) always wins.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  fieldset,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusRoot,
} from './_shared.js';

export const type = 'ordering';
export const label = { en: 'Ordering', de: 'Reihenfolge' };

registerMessages({
  de: {
    'item.ordering.legend': 'Bringen Sie die Elemente in die richtige Reihenfolge.',
    'item.ordering.position': 'Position {position}',
    'item.ordering.move_up': 'nach oben',
    'item.ordering.move_down': 'nach unten',
    'item.ordering.empty': 'Für diese Aufgabe sind keine Elemente hinterlegt.',
  },
  en: {
    'item.ordering.legend': 'Put the elements in the correct order.',
    'item.ordering.position': 'Position {position}',
    'item.ordering.move_up': 'move up',
    'item.ordering.move_down': 'move down',
    'item.ordering.empty': 'No elements are configured for this item.',
  },
});

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const allItems = Array.isArray(config.items) ? config.items : [];
  const entries = allItems.filter(
    (entry) => entry && typeof entry === 'object' && entry.id !== undefined && entry.id !== null,
  );

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!entries.length) {
    root.appendChild(notice(t('item.ordering.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() {
        return { order: [] };
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

  const field = fieldset(t('item.ordering.legend'));
  const list = h('ol.item-order-list');

  // Initial order: stored response order > payload order as-is.
  // The sanitized student payload is already shuffled server-side and must not
  // be shuffled a second time here (that would desync from the server seed);
  // raw preview items arrive in the correct order.
  const byId = new Map(entries.map((entry) => [String(entry.id), entry]));
  const storedOrder =
    ctx.response && Array.isArray(ctx.response.order)
      ? ctx.response.order.map((id) => String(id)).filter((id) => byId.has(id))
      : [];
  const useStored = storedOrder.length === entries.length && new Set(storedOrder).size === entries.length;
  const displayOrder = useStored ? storedOrder.map((id) => byId.get(id)) : entries;

  /** @type {Map<string, HTMLElement>} */
  const rowEls = new Map();

  for (const entry of displayOrder) {
    const key = String(entry.id);
    const row = h('li.item-order-row', { dataset: { itemId: key, key } });
    row.appendChild(h('span.sr-only.item-order-description', { text: '' }));
    row.appendChild(h('span.item-order-number', { 'aria-hidden': 'true' }));
    row.appendChild(
      h('span.item-order-text', { text: String(entry.text === undefined || entry.text === null ? '' : entry.text) }),
    );
    if (!readonly) {
      const controls = h('div.item-order-controls');
      const upButton = h(
        'button.btn.btn-icon.btn-sm.btn-secondary.item-order-btn',
        {
          type: 'button',
          'data-move': 'up',
          'aria-label': t('item.ordering.move_up'),
        },
        h('span', { html: icon('chevron-up', { size: 18 }) }),
      );
      const downButton = h(
        'button.btn.btn-icon.btn-sm.btn-secondary.item-order-btn',
        {
          type: 'button',
          'data-move': 'down',
          'aria-label': t('item.ordering.move_down'),
        },
        h('span', { html: icon('chevron-down', { size: 18 }) }),
      );
      upButton.addEventListener('click', () => moveRow(row, -1));
      downButton.addEventListener('click', () => moveRow(row, 1));
      controls.appendChild(upButton);
      controls.appendChild(downButton);
      row.appendChild(controls);
    } else {
      row.classList.add('is-readonly');
    }
    rowEls.set(key, row);
    list.appendChild(row);
  }

  field.appendChild(list);
  root.appendChild(field);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function refresh() {
    const rows = Array.from(list.children);
    rows.forEach((row, index) => {
      const number = row.querySelector('.item-order-number');
      if (number) number.textContent = String(index + 1);
      const description = row.querySelector('.item-order-description');
      if (description) {
        description.textContent = `${t('item.ordering.position', { position: index + 1 })}: ${
          row.querySelector('.item-order-text')?.textContent || ''
        }`;
      }
      const up = row.querySelector('[data-move="up"]');
      const down = row.querySelector('[data-move="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === rows.length - 1;
    });
  }

  function moveRow(row, direction) {
    if (readonly) return;
    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) list.insertBefore(row, sibling);
    else list.insertBefore(sibling, row);
    refresh();
    // Keep keyboard focus on a usable button of the moved row.
    const preferred = row.querySelector(direction < 0 ? '[data-move="up"]' : '[data-move="down"]');
    if (preferred && !preferred.disabled) preferred.focus();
    else {
      const fallback = row.querySelector('[data-move]:not(:disabled)');
      if (fallback) fallback.focus();
    }
  }

  function setResponse(response) {
    const order =
      response && Array.isArray(response.order) ? response.order.map((id) => String(id)) : [];
    const seen = new Set();
    const orderedRows = [];
    for (const id of order) {
      const row = rowEls.get(id);
      if (row && !seen.has(id)) {
        seen.add(id);
        orderedRows.push(row);
      }
    }
    if (orderedRows.length !== list.children.length) return;
    for (const row of orderedRows) list.appendChild(row);
    refresh();
  }

  refresh();
  container.replaceChildren(root);

  return {
    getResponse() {
      return {
        order: Array.from(list.children).map((row) => {
          const key = row.dataset.itemId;
          const entry = byId.get(key);
          return entry ? entry.id : key;
        }),
      };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      const first = root.querySelector('[data-move]:not(:disabled)');
      if (first) first.focus();
      else focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
