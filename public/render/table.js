// Table item: fill mode (text inputs in gap cells) and choice mode (one
// question per row; the column cells are radio/checkbox options).
// Student payload (sanitized): gap cells carry no answers, option cells no
// `correct` flag — only kinds, static text and labels.
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
} from './_shared.js';

export const type = 'table';
export const label = { en: 'Table (fill / matrix question)', de: 'Tabelle (ausfüllen / Matrix)' };

registerMessages({
  de: {
    'item.table.legend_fill': 'Fülle die leeren Zellen der Tabelle aus.',
    'item.table.legend_choice': 'Wähle pro Zeile die richtige Antwort.',
    'item.table.legend_choice_multi': 'Wähle pro Zeile alle richtigen Antworten.',
    'item.table.empty': 'Für diese Aufgabe ist keine Tabelle hinterlegt.',
    'item.table.gap_label': 'Zelle {row}, {col} ausfüllen',
    'item.table.option_label': 'Antwort {col} für Zeile {row}',
    'item.table.row_label': 'Zeile {n}',
  },
  en: {
    'item.table.legend_fill': 'Fill in the empty cells of the table.',
    'item.table.legend_choice': 'Choose the correct answer in each row.',
    'item.table.legend_choice_multi': 'Choose all correct answers in each row.',
    'item.table.empty': 'No table is configured for this item.',
    'item.table.gap_label': 'Fill cell {row}, {col}',
    'item.table.option_label': 'Answer {col} for row {row}',
    'item.table.row_label': 'Row {n}',
  },
});

let instanceCounter = 0;

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const mode = config.mode === 'choice' ? 'choice' : 'fill';
  const multi = mode === 'choice' && config.multi === true;
  const columns = Array.isArray(config.columns) ? config.columns.filter((c) => c && c.id != null) : [];
  const rows = Array.isArray(config.rows) ? config.rows.filter((r) => r && r.id != null) : [];
  const groupBase = `ow-table-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  if (columns.length === 0 || rows.length === 0) {
    root.appendChild(notice(t('item.table.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() { return mode === 'choice' ? { choices: {} } : { cells: {} }; },
      setResponse() {},
      setResult() {},
      focus() { focusRoot(root); },
      destroy() { container.replaceChildren(); },
    };
  }

  const legend = mode === 'choice' ? (multi ? t('item.table.legend_choice_multi') : t('item.table.legend_choice')) : t('item.table.legend_fill');
  const fs = h('fieldset.item-fieldset');
  fs.appendChild(h('legend.item-legend.sr-only', { text: legend }));

  const table = h('table.item-table');
  const thead = h('thead');
  const headRow = h('tr', h('th.item-table-corner', { text: '' }));
  for (const col of columns) headRow.appendChild(h('th', { text: String(col.label || '') }));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = h('tbody');
  /** gap inputs and choice inputs for getResponse/setResponse */
  const gapInputs = []; // { key, input }
  const choiceInputs = []; // { rowId, colId, input }

  rows.forEach((row, rowIndex) => {
    const tr = h('tr');
    tr.appendChild(h('th.item-table-rowlabel', { text: String(row.label || t('item.table.row_label', { n: rowIndex + 1 })) }));
    const cells = row.cells && typeof row.cells === 'object' ? row.cells : {};
    for (const col of columns) {
      const cell = cells[col.id] && typeof cells[col.id] === 'object' ? cells[col.id] : { kind: 'static', text: '' };
      const td = h('td.item-table-cell', { dataset: { kind: cell.kind } });
      if (cell.kind === 'gap') {
        const input = h('input.input.input-sm.item-table-gap', {
          type: 'text',
          'aria-label': t('item.table.gap_label', { row: String(row.label || rowIndex + 1), col: String(col.label || col.id) }),
        });
        if (readonly) input.disabled = true;
        gapInputs.push({ key: `${row.id}|${col.id}`, input });
        td.appendChild(input);
      } else if (cell.kind === 'option') {
        const input = h('input.item-table-option', {
          type: multi ? 'checkbox' : 'radio',
          name: `${groupBase}-row-${row.id}`,
          value: String(col.id),
          'aria-label': t('item.table.option_label', { col: String(col.label || col.id), row: String(row.label || rowIndex + 1) }),
        });
        if (readonly) input.disabled = true;
        choiceInputs.push({ rowId: row.id, colId: col.id, input });
        td.appendChild(h('label.item-table-option-label', input, h('span', { text: String(col.label || col.id) })));
      } else {
        td.appendChild(h('span.item-table-static', { text: String(cell.text || '') }));
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  fs.appendChild(table);
  root.appendChild(fs);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const resp = response && typeof response === 'object' ? response : {};
    if (mode === 'choice') {
      const choices = resp.choices && typeof resp.choices === 'object' ? resp.choices : {};
      for (const { rowId, colId, input } of choiceInputs) {
        const value = choices[rowId];
        const picked = multi ? Array.isArray(value) && value.includes(colId) : value === colId;
        input.checked = !!picked;
      }
    } else {
      const cells = resp.cells && typeof resp.cells === 'object' ? resp.cells : {};
      for (const { key, input } of gapInputs) {
        input.value = typeof cells[key] === 'string' ? cells[key] : '';
      }
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      if (mode === 'choice') {
        const choices = {};
        for (const { rowId, colId, input } of choiceInputs) {
          if (!input.checked) continue;
          if (multi) {
            if (!Array.isArray(choices[rowId])) choices[rowId] = [];
            choices[rowId].push(colId);
          } else {
            choices[rowId] = colId;
          }
        }
        return { choices };
      }
      const cells = {};
      for (const { key, input } of gapInputs) {
        if (input.value.trim() !== '') cells[key] = input.value;
      }
      return { cells };
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
