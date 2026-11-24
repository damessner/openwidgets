// Item type: table — "Tabelle ausfüllen" (fill gaps in a table) and
// "Matrix-Frage" (question table: each row is a question, the column cells
// are the answer options, one or more correct per row).
//
// Config:
//   columns: [{ id, label }]                          — header columns
//   mode: 'fill' | 'choice'
//   multi: bool (choice mode: several options per row allowed)
//   rows: [{ id, label, cells: { [colId]: cell } }]
//     cell = { kind: 'static', text }                — given content
//          | { kind: 'gap', answers: [string] }      — fill mode, text input
//          | { kind: 'option', correct: bool }       — choice mode, radio/checkbox cell
// Response:
//   fill:   { cells: { "<rowId>|<colId>": "text" } }
//   choice: { choices: { [rowId]: colId | [colIds] } }
// Answers (gap answers, option correct flags) never reach the student payload.
import { normalizeText } from '../util.js';
import {
  asArray,
  asBool,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'table';
export const meta = {
  label: { en: 'Table (fill / matrix question)', de: 'Tabelle (ausfüllen / Matrix)' },
  scoreable: true,
  category: 'assessment',
};

export const MODES = ['fill', 'choice'];
export const CELL_KINDS = ['static', 'gap', 'option'];

export function defaultConfig() {
  return {
    mode: 'fill',
    multi: false,
    columns: [
      { id: 'c1', label: '' },
      { id: 'c2', label: '' },
    ],
    rows: [
      {
        id: 'r1',
        label: '',
        cells: { c1: { kind: 'static', text: 'Beispiel' }, c2: { kind: 'gap', answers: ['Antwort'] } },
      },
    ],
  };
}

export function defaultPoints() {
  return 2;
}

function normalizeCell(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const kind = CELL_KINDS.includes(src.kind) ? src.kind : 'static';
  return {
    kind,
    text: asString(src.text).slice(0, 1000),
    answers: asArray(src.answers).filter((v) => typeof v === 'string').map((v) => v.slice(0, 500)).slice(0, 20),
    correct: asBool(src.correct, false),
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const usedCols = new Set();
  const columns = (asArray(src.columns).length > 0 ? asArray(src.columns) : defaultConfig().columns)
    .slice(0, 12)
    .map((entry, index) => {
      const col = entry && typeof entry === 'object' ? entry : {};
      return { id: uniqueId(col.id, 'c', usedCols, index), label: asString(col.label).slice(0, 300) };
    });
  const colIds = new Set(columns.map((col) => col.id));
  const usedRows = new Set();
  const rows = (asArray(src.rows).length > 0 ? asArray(src.rows) : defaultConfig().rows)
    .slice(0, 30)
    .map((entry, index) => {
      const row = entry && typeof entry === 'object' ? entry : {};
      const rawCells = row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells) ? row.cells : {};
      const cells = {};
      for (const col of columns) {
        cells[col.id] = normalizeCell(rawCells[col.id]);
      }
      // tolerate legacy cell arrays
      if (Array.isArray(row.cells)) {
        row.cells.slice(0, columns.length).forEach((cell, cellIndex) => {
          cells[columns[cellIndex].id] = normalizeCell(cell);
        });
      }
      return { id: uniqueId(row.id, 'r', usedRows, index), label: asString(row.label).slice(0, 300), cells };
    });
  const mode = MODES.includes(src.mode) ? src.mode : 'fill';
  return { mode, multi: asBool(src.multi, false), columns, rows };
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  return normalizeBaseItem(src, type, normalizeConfig(src.config), defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  // validate the normalized config so partially-filled editor states are fine
  const config = normalizeConfig(item.config);
  if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) return errors;
  if (!MODES.includes(config.mode)) errors.push('config.mode: must be "fill" or "choice"');
  const columns = asArray(config.columns);
  if (columns.length < 1) errors.push('config.columns: at least one column is required');
  if (columns.length > 12) errors.push('config.columns: at most 12 columns are allowed');
  const colIds = new Set();
  columns.forEach((col, index) => {
    if (!col || typeof col !== 'object') {
      errors.push(`config.columns[${index}]: must be an object`);
      return;
    }
    if (typeof col.id !== 'string' || !col.id) errors.push(`config.columns[${index}].id: must be a non-empty string`);
    else if (colIds.has(col.id)) errors.push(`config.columns[${index}].id: duplicate "${col.id}"`);
    else colIds.add(col.id);
    if (typeof col.label !== 'string') errors.push(`config.columns[${index}].label: must be a string`);
  });
  const rows = asArray(config.rows);
  if (rows.length < 1) errors.push('config.rows: at least one row is required');
  if (rows.length > 30) errors.push('config.rows: at most 30 rows are allowed');
  const rowIds = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      errors.push(`config.rows[${index}]: must be an object`);
      return;
    }
    if (typeof row.id !== 'string' || !row.id) errors.push(`config.rows[${index}].id: must be a non-empty string`);
    else if (rowIds.has(row.id)) errors.push(`config.rows[${index}].id: duplicate "${row.id}"`);
    else rowIds.add(row.id);
    const cells = row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells) ? row.cells : {};
    for (const col of columns) {
      const cell = cells[col.id];
      if (!cell) continue;
      if (!CELL_KINDS.includes(cell.kind)) errors.push(`config.rows[${index}].cells.${col.id}.kind: invalid`);
      if (cell.kind === 'gap' && asArray(cell.answers).filter((a) => typeof a === 'string' && a.trim()).length === 0) {
        errors.push(`config.rows[${index}].cells.${col.id}.answers: a gap needs at least one accepted answer`);
      }
    }
  });
  return errors;
}

function cellKey(rowId, colId) {
  return `${rowId}|${colId}`;
}

export function normalizeResponse(item, raw) {
  const normalized = normalizeItem(item);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const config = normalized.config;
  const response = { cells: {}, choices: {} };
  if (config.mode === 'choice') {
    const rawChoices = source.choices && typeof source.choices === 'object' && !Array.isArray(source.choices) ? source.choices : {};
    for (const row of config.rows) {
      const rawValue = rawChoices[row.id];
      const optionColIds = columnsOf(config, row).filter((colId) => config.rows.find((r) => r.id === row.id).cells[colId].kind === 'option').map((colId) => colId);
      if (Array.isArray(rawValue)) {
        const picked = rawValue.filter((v) => typeof v === 'string' && optionColIds.includes(v)).slice(0, optionColIds.length);
        if (config.multi) response.choices[row.id] = [...new Set(picked)];
        else if (picked.length > 0) response.choices[row.id] = picked[0];
      } else if (typeof rawValue === 'string' && optionColIds.includes(rawValue)) {
        response.choices[row.id] = config.multi ? [rawValue] : rawValue;
      }
    }
    return response;
  }
  const rawCells = source.cells && typeof source.cells === 'object' && !Array.isArray(source.cells) ? source.cells : {};
  const cells = {};
  for (const row of config.rows) {
    for (const col of config.columns) {
      const cell = row.cells[col.id];
      if (!cell || cell.kind !== 'gap') continue;
      const value = rawCells[cellKey(row.id, col.id)];
      if (typeof value === 'string') cells[cellKey(row.id, col.id)] = value.slice(0, 500);
    }
  }
  return { cells };
}

function columnsOf(config, row) {
  return config.columns.map((col) => col.id);
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const maxScore = normalized.points;
  const resp = response && typeof response === 'object' ? response : {};

  if (config.mode === 'choice') {
    const rows = config.rows;
    let hit = 0;
    const detailRows = [];
    for (const row of rows) {
      const optionCols = config.columns.filter((col) => row.cells[col.id] && row.cells[col.id].kind === 'option');
      const correct = new Set(optionCols.filter((col) => row.cells[col.id].correct).map((col) => col.id));
      const raw = resp.choices && resp.choices[row.id];
      const picked = new Set(config.multi ? (Array.isArray(raw) ? raw : raw ? [raw] : []) : raw ? [raw] : []);
      const ok = correct.size > 0 && picked.size === correct.size && [...correct].every((id) => picked.has(id));
      if (ok) hit += 1;
      detailRows.push({ rowId: row.id, picked: [...picked], correct: [...correct], ok });
    }
    const total = rows.length;
    return makeResult({
      autoScore: total > 0 ? roundScore((maxScore * hit) / total) : 0,
      maxScore,
      correct: total > 0 && hit === total,
      needsManual: false,
      correctParts: hit,
      totalParts: total,
      detail: { rows: detailRows },
    });
  }

  // fill mode
  const gaps = [];
  for (const row of config.rows) {
    for (const col of config.columns) {
      const cell = row.cells[col.id];
      if (cell && cell.kind === 'gap') gaps.push({ rowId: row.id, colId: col.id, answers: cell.answers });
    }
  }
  const cells = resp.cells && typeof resp.cells === 'object' ? resp.cells : {};
  let hit = 0;
  const detailCells = [];
  for (const gap of gaps) {
    const key = cellKey(gap.rowId, gap.colId);
    const given = typeof cells[key] === 'string' ? cells[key] : '';
    const norm = (value) => normalizeText(value, { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true });
    const ok = gap.answers.some((answer) => norm(answer) === norm(given)) && norm(given) !== '';
    if (ok) hit += 1;
    detailCells.push({ key, given, ok });
  }
  const total = gaps.length;
  return makeResult({
    autoScore: total > 0 ? roundScore((maxScore * hit) / total) : 0,
    maxScore,
    correct: total > 0 && hit === total,
    needsManual: false,
    correctParts: hit,
    totalParts: total,
    detail: { cells: detailCells },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      mode: config.mode,
      multi: config.multi,
      columns: config.columns.map((col) => ({ id: col.id, label: col.label })),
      rows: config.rows.map((row) => ({
        id: row.id,
        label: row.label,
        cells: Object.fromEntries(
          config.columns.map((col) => {
            const cell = row.cells[col.id] || { kind: 'static', text: '' };
            if (cell.kind === 'gap') return [col.id, { kind: 'gap' }];
            if (cell.kind === 'option') return [col.id, { kind: 'option' }];
            return [col.id, { kind: 'static', text: cell.text }];
          }),
        ),
      })),
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const resp = response && typeof response === 'object' ? response : {};
  if (config.mode === 'choice') {
    const rows = config.rows.map((row) => {
      const raw = resp.choices && resp.choices[row.id];
      const picked = config.multi ? asArray(raw) : raw ? [raw] : [];
      const labels = picked
        .map((colId) => (config.columns.find((col) => col.id === colId) || {}).label || colId)
        .join('+');
      return `${row.label || row.id}: ${labels || '–'}`;
    });
    return rows.join(' · ').slice(0, 140);
  }
  const cells = resp.cells && typeof resp.cells === 'object' ? resp.cells : {};
  const parts = Object.entries(cells).map(([key, value]) => String(value || '').trim()).filter(Boolean);
  return parts.join(', ').slice(0, 140) || '–';
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  if (config.mode === 'choice') {
    const choices = {};
    for (const row of config.rows) {
      const correct = config.columns.filter((col) => row.cells[col.id] && row.cells[col.id].kind === 'option' && row.cells[col.id].correct).map((col) => col.id);
      if (correct.length > 0) choices[row.id] = config.multi ? correct : correct[0];
    }
    return { choices };
  }
  const cells = {};
  for (const row of config.rows) {
    for (const col of config.columns) {
      const cell = row.cells[col.id];
      if (cell && cell.kind === 'gap') cells[cellKey(row.id, col.id)] = cell.answers[0] || '';
    }
  }
  return { cells };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const lines = [];
  if (config.mode === 'choice') {
    for (const row of config.rows) {
      const correct = config.columns
        .filter((col) => row.cells[col.id] && row.cells[col.id].kind === 'option' && row.cells[col.id].correct)
        .map((col) => col.label || col.id);
      if (correct.length > 0) lines.push(`${row.label || row.id}: ${correct.join(', ')}`);
    }
  } else {
    for (const row of config.rows) {
      for (const col of config.columns) {
        const cell = row.cells[col.id];
        if (cell && cell.kind === 'gap' && cell.answers.length > 0) {
          lines.push(`${row.label || row.id} / ${col.label || col.id}: ${cell.answers.join(' | ')}`);
        }
      }
    }
  }
  return lines;
}

// The real editor is the visual grid (renderTableEditor in the teacher app).
export function editSchema() {
  return [{ key: 'rows', kind: 'list', label: { en: 'Rows', de: 'Zeilen' }, min: 1, max: 30 }];
}
