// Crossword renderer. The sanitized config carries clue + placement + length
// only — the letters stay server-side. Students type one letter per cell;
// correctness is marked per cell from the server result detail.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  notice,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
  liveRegion,
  announce,
} from './_shared.js';

export const type = 'crossword';
export const label = { en: 'Crossword', de: 'Kreuzworträtsel' };

registerMessages({
  de: {
    'item.crossword.across': 'Waagerecht',
    'item.crossword.down': 'Senkrecht',
    'item.crossword.clues': 'Hinweise',
    'item.crossword.empty': 'Lege Wörter mit Hinweis fest (Editor: Auto-Platzieren).',
  },
  en: {
    'item.crossword.across': 'Across',
    'item.crossword.down': 'Down',
    'item.crossword.clues': 'Clues',
    'item.crossword.empty': 'Add words with clues (editor: auto-layout).',
  },
});

function cellKey(row, col) {
  return `${row},${col}`;
}

/** Derive grid shape from sanitized placements (id, clue, row, col, direction, length). */
function shapeOf(words) {
  const cells = new Map(); // "r,c" -> { starts: [wordId] }
  const placements = [];
  for (const word of words) {
    const len = Math.max(1, Number(word.length) || 1);
    const keys = [];
    for (let i = 0; i < len; i += 1) {
      const r = word.direction === 'down' ? word.row + i : word.row;
      const c = word.direction === 'across' ? word.col + i : word.col;
      const key = cellKey(r, c);
      if (!cells.has(key)) cells.set(key, { starts: [] });
      keys.push(key);
    }
    placements.push({ ...word, cellKeys: keys });
  }
  const starts = placements
    .map((p) => ({ id: p.id, row: p.row, col: p.col, direction: p.direction, clue: p.clue }))
    .sort((a, b) => a.row - b.row || a.col - b.col || (a.direction === b.direction ? 0 : a.direction === 'across' ? -1 : 1));
  const numbers = new Map();
  starts.forEach((s, index) => {
    numbers.set(cellKey(s.row, s.col), index + 1);
    const cell = cells.get(cellKey(s.row, s.col));
    if (cell) cell.starts.push(s.id);
  });
  let rows = 0;
  let cols = 0;
  for (const key of cells.keys()) {
    const [r, c] = key.split(',').map(Number);
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { cells, placements, numbers, rows, cols };
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const words = Array.isArray(config.words) ? config.words : [];
  const shape = shapeOf(words);

  const answers = new Map(); // "r,c" -> letter
  const inputByKey = new Map();
  let activePlacement = null;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  if (config.title) root.appendChild(h('h3.item-crossword-title', { text: config.title }));
  if (shape.cells.size === 0) root.appendChild(notice(t('item.crossword.empty'), 'warning'));

  const gridWrap = h('div.item-crossword-grid-wrap');
  if (shape.cells.size > 0) {
    const table = h('table.item-crossword-grid', { role: 'grid', style: `--cw-rows:${shape.rows};--cw-cols:${shape.cols}` });
    for (let r = 0; r < shape.rows; r += 1) {
      const tr = h('tr');
      for (let c = 0; c < shape.cols; c += 1) {
        const key = cellKey(r, c);
        const cell = shape.cells.get(key);
        const td = h('td.item-crossword-cell', { dataset: { key } });
        if (!cell) {
          td.classList.add('is-block');
        } else {
          const number = shape.numbers.get(key);
          if (number) td.appendChild(h('span.item-crossword-num', { text: String(number) }));
          const input = h('input.item-crossword-input', {
            type: 'text',
            maxlength: '1',
            autocomplete: 'off',
            autocapitalize: 'characters',
            'aria-label': `Zeile ${r + 1}, Spalte ${c + 1}`,
            disabled: readonly || undefined,
            dataset: { key },
          });
          input.addEventListener('focus', () => {
            activePlacement =
              shape.placements.find((p) => p.cellKeys.includes(key) && p.direction === (activePlacement && activePlacement.cellKeys.includes(key) ? activePlacement.direction : 'across')) ||
              shape.placements.find((p) => p.cellKeys.includes(key));
          });
          input.addEventListener('input', () => {
            const ch = input.value.toUpperCase().replace(/[^A-ZÄÖÜ]/g, '').slice(0, 1);
            input.value = ch;
            if (ch) answers.set(key, ch);
            else answers.delete(key);
            // advance within the active word
            if (ch && activePlacement) {
              const idx = activePlacement.cellKeys.indexOf(key);
              const nextKey = activePlacement.cellKeys[idx + 1];
              if (nextKey) {
                const next = inputByKey.get(nextKey);
                if (next) next.focus();
              }
            }
          });
          inputByKey.set(key, input);
          td.appendChild(input);
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    gridWrap.appendChild(table);
  }
  root.appendChild(gridWrap);

  // clue lists
  const cluesBox = h('div.item-crossword-clues');
  for (const direction of ['across', 'down']) {
    const list = shape.placements.filter((p) => p.direction === direction);
    if (list.length === 0) continue;
    const col = h('div.item-crossword-clue-col',
      h('h4', t(direction === 'across' ? 'item.crossword.across' : 'item.crossword.down')),
    );
    for (const p of list) {
      const num = shape.numbers.get(cellKey(p.row, p.col));
      const btn = h('button.item-crossword-clue', {
        type: 'button',
        on: {
          click: () => {
            activePlacement = p;
            const first = inputByKey.get(p.cellKeys[0]);
            if (first) first.focus();
          },
        },
      }, h('span.item-crossword-clue-num', { text: `${num}. ` }), p.clue);
      col.appendChild(btn);
    }
    cluesBox.appendChild(col);
  }
  if (shape.placements.length > 0) root.appendChild(cluesBox);

  const live = liveRegion();
  const resultRegion = createResultRegion();
  root.appendChild(live);
  root.appendChild(resultRegion);

  function setResponse(response) {
    answers.clear();
    const given = response && response.cells && typeof response.cells === 'object' ? response.cells : {};
    for (const [key, value] of Object.entries(given)) {
      const ch = String(value || '').toUpperCase().replace(/[^A-ZÄÖÜ]/g, '').slice(0, 1);
      if (ch && shape.cells.has(key)) {
        answers.set(key, ch);
        const input = inputByKey.get(key);
        if (input) input.value = ch;
      }
    }
  }

  function setResult(result) {
    applyResult(root, resultRegion, result);
    const detail = result && result.detail && typeof result.detail === 'object' ? result.detail : {};
    const cellDetail = detail.cells && typeof detail.cells === 'object' ? detail.cells : {};
    for (const [key, info] of Object.entries(cellDetail)) {
      const td = root.querySelector(`td[data-key="${key}"]`);
      if (!td) continue;
      td.classList.toggle('is-correct', !!(info && info.correct));
      td.classList.toggle('is-incorrect', !!(info && info.correct === false));
    }
  }

  setResponse(ctx.response);
  if (ctx.result) setResult(ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);
  container.replaceChildren(root);

  return {
    getResponse() {
      const cells = {};
      for (const [key, ch] of answers) cells[key] = ch;
      return { cells };
    },
    setResponse,
    setResult,
    focus() {
      if (!focusFirst(root, 'input:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
