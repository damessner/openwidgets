// Item type: crossword (Kreuzworträtsel). Words are placed on a grid with an
// explicit start cell + direction; the editor offers an auto-layout that
// crosses each new word at the first shared letter. Students type one letter
// per cell. Scoring is per letter (partial credit), `correct` = every letter.
// The words are the answer key — sanitize keeps only clue + placement +
// length, never the letters.
import { normalizeText } from '../util.js';
import {
  asArray,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'crossword';

export const meta = {
  label: { en: 'Crossword', de: 'Kreuzworträtsel' },
  scoreable: true,
  category: 'interactive',
};

export const MAX_WORDS = 20;
export const MAX_GRID = 20; // grid is at most MAX_GRID x MAX_GRID
export const LETTER_RE = /^[A-ZÄÖÜ]$/;

const WORD_LETTERS = /[^A-ZÄÖÜ]/gi;

/** Uppercase letters of a word (only A-Z, Ä, Ö, Ü are grid letters). */
export function lettersOf(word) {
  return asString(word).toUpperCase().replace(WORD_LETTERS, '').split('');
}

export function cellKey(row, col) {
  return `${row},${col}`;
}

export function defaultConfig() {
  return {
    title: '',
    words: [
      { id: 'w1', word: 'HAUS', clue: 'Wo wohnt man?', row: 0, col: 0, direction: 'across' },
      { id: 'w2', word: 'AUF', clue: 'Präposition: ___ dem Tisch', row: 0, col: 1, direction: 'down' },
    ],
  };
}

export function defaultPoints() {
  return 3;
}

function normalizeWord(raw, used, index) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const row = Number(src.row);
  const col = Number(src.col);
  return {
    id: uniqueId(src.id, 'w', used, index),
    word: asString(src.word).slice(0, 30),
    clue: asString(src.clue).slice(0, 300),
    row: Number.isFinite(row) ? Math.max(0, Math.min(MAX_GRID - 1, Math.round(row))) : 0,
    col: Number.isFinite(col) ? Math.max(0, Math.min(MAX_GRID - 1, Math.round(col))) : 0,
    direction: src.direction === 'down' ? 'down' : 'across',
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const used = new Set();
  const words = asArray(src.words).slice(0, MAX_WORDS).map((w, i) => normalizeWord(w, used, i));
  return { title: asString(src.title).slice(0, 200), words };
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  return normalizeBaseItem(src, type, normalizeConfig(src.config), defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

/**
 * Derive the grid from placements. Returns null on conflict (two words writing
 * different letters into the same cell) or out-of-bounds.
 * cells: Map "r,c" -> { letter, starts: [wordIds] }
 */
export function buildGrid(words) {
  const cells = new Map();
  const placements = [];
  for (const word of words) {
    const letters = lettersOf(word.word);
    if (letters.length === 0) return null;
    const cellKeys = [];
    for (let i = 0; i < letters.length; i += 1) {
      const r = word.direction === 'down' ? word.row + i : word.row;
      const c = word.direction === 'across' ? word.col + i : word.col;
      if (r < 0 || c < 0 || r >= MAX_GRID || c >= MAX_GRID) return null;
      const key = cellKey(r, c);
      const existing = cells.get(key);
      if (existing && existing.letter !== letters[i]) return null;
      if (!existing) cells.set(key, { letter: letters[i], starts: [] });
      cellKeys.push(key);
    }
    placements.push({ ...word, letters, cellKeys });
  }
  // number the start cells in reading order
  const starts = placements
    .map((p) => ({ id: p.id, row: p.row, col: p.col, direction: p.direction }))
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

/**
 * Simple auto-layout: place the first word across at (0,0); every following
 * word tries to cross an existing word at a shared letter (candidate with the
 * most crossings wins, across preferred on ties); if no crossing exists, the
 * word is appended below the current grid. Returns placements
 * [{word, clue, row, col, direction}] or null if the grid would overflow.
 */
export function autoLayout(entries) {
  const words = (Array.isArray(entries) ? entries : [])
    .map((e) => ({ word: asString(e && e.word), clue: asString(e && e.clue) }))
    .filter((e) => lettersOf(e.word).length >= 2)
    .slice(0, MAX_WORDS);
  if (words.length === 0) return null;
  const occupied = new Map(); // "r,c" -> letter
  const placed = [];
  let maxRow = 0;
  let maxCol = 0;

  function tryPlace(word, direction, row, col, requireCrossing = true) {
    const letters = lettersOf(word.word);
    const keys = [];
    let crossings = 0;
    for (let i = 0; i < letters.length; i += 1) {
      const r = direction === 'down' ? row + i : row;
      const c = direction === 'across' ? col + i : col;
      if (r < 0 || c < 0 || r >= MAX_GRID || c >= MAX_GRID) return null;
      const key = cellKey(r, c);
      const existing = occupied.get(key);
      if (existing !== undefined && existing !== letters[i]) return null;
      if (existing !== undefined) crossings += 1;
      keys.push(key);
    }
    // a crossing placement must touch the existing grid at least once
    if (requireCrossing && placed.length > 0 && crossings === 0) return null;
    return { row, col, direction, keys, crossings };
  }

  function commit(word, placement) {
    const letters = lettersOf(word.word);
    placement.keys.forEach((key, i) => occupied.set(key, letters[i]));
    placed.push({ word: word.word, clue: word.clue, row: placement.row, col: placement.col, direction: placement.direction });
    letters.forEach((_, i) => {
      const r = placement.direction === 'down' ? placement.row + i : placement.row;
      const c = placement.direction === 'across' ? placement.col + i : placement.col;
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
    });
  }

  const first = words[0];
  commit(first, { row: 0, col: 0, direction: 'across', keys: lettersOf(first.word).map((_, i) => cellKey(0, i)), crossings: 0 });

  for (const word of words.slice(1)) {
    const letters = lettersOf(word.word);
    let best = null;
    for (const [key, letter] of occupied) {
      const [r, c] = key.split(',').map(Number);
      const idx = letters.indexOf(letter);
      if (idx === -1) continue;
      for (const direction of ['across', 'down']) {
        const row = direction === 'down' ? r - idx : r;
        const col = direction === 'across' ? c - idx : c;
        const candidate = tryPlace(word, direction, row, col);
        if (!candidate) continue;
        if (!best || candidate.crossings > best.crossings) best = candidate;
      }
    }
    if (!best) {
      // no crossing possible: append below the grid
      const row = maxRow + 2;
      const candidate = tryPlace(word, 'across', row, 0, false);
      if (!candidate) return null;
      best = candidate;
    }
    commit(word, best);
  }
  return placed;
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  const config = normalizeConfig(item.config);
  if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) return errors;
  if (typeof config.title !== 'string') errors.push('config.title: must be a string');
  if (config.words.length < 1) errors.push('config.words: at least one word is required');
  if (config.words.length > MAX_WORDS) errors.push(`config.words: at most ${MAX_WORDS} words`);
  config.words.forEach((word, index) => {
    const label = `config.words[${index}]`;
    if (lettersOf(word.word).length < 2) errors.push(`${label}.word: needs at least 2 letters (A-Z, ÄÖÜ)`);
    if (lettersOf(word.word).length > 15) errors.push(`${label}.word: at most 15 letters`);
    if (!word.clue.trim()) errors.push(`${label}.clue: must not be empty`);
    if (!['across', 'down'].includes(word.direction)) errors.push(`${label}.direction: must be across or down`);
  });
  const grid = buildGrid(config.words);
  if (!grid) errors.push('config.words: placements conflict (overlapping letters or grid larger than 20x20)');
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = normalizeItem(item);
  const grid = buildGrid(normalized.config.words);
  const validKeys = grid ? new Set(grid.cells.keys()) : new Set();
  const rawCells = source.cells && typeof source.cells === 'object' && !Array.isArray(source.cells) ? source.cells : {};
  const cells = {};
  for (const [key, value] of Object.entries(rawCells)) {
    if (!validKeys.has(key)) continue;
    if (typeof value === 'string') {
      const ch = value.toUpperCase().replace(WORD_LETTERS, '').slice(0, 1);
      cells[key] = ch;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      cells[key] = String(value).slice(0, 1);
    } else if (value !== undefined && value !== null) {
      throw new Error(`crossword cell "${key}" must be a single letter`);
    }
  }
  return { cells };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const grid = buildGrid(normalized.config.words);
  const maxScore = normalized.points;
  if (!grid) {
    return makeResult({ autoScore: 0, maxScore, correct: false, needsManual: false, correctParts: 0, totalParts: 0, detail: {} });
  }
  const given = response && response.cells && typeof response.cells === 'object' ? response.cells : {};
  const options = { caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true };
  let correctLetters = 0;
  let totalLetters = 0;
  const cellDetail = {};
  for (const [key, cell] of grid.cells) {
    totalLetters += 1;
    const givenLetter = normalizeText(given[key] || '', options).toUpperCase();
    const correct = givenLetter !== '' && givenLetter === cell.letter;
    if (correct) correctLetters += 1;
    cellDetail[key] = { given: givenLetter, correct };
  }
  const wordDetail = {};
  for (const placement of grid.placements) {
    let ok = 0;
    for (const key of placement.cellKeys) {
      if (cellDetail[key] && cellDetail[key].correct) ok += 1;
    }
    wordDetail[placement.id] = { correctLetters: ok, totalLetters: placement.cellKeys.length, complete: ok === placement.cellKeys.length };
  }
  const autoScore = totalLetters > 0 ? roundScore((maxScore * correctLetters) / totalLetters) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: totalLetters > 0 && correctLetters === totalLetters,
    needsManual: false,
    correctParts: correctLetters,
    totalParts: totalLetters,
    detail: { cells: cellDetail, words: wordDetail },
  });
}

/**
 * Student-safe subset of the score detail: per-cell given/correct flags.
 * Letters are never included — only whether the student's own letter is right.
 */
export function safeDetail(detail) {
  if (!detail || typeof detail !== 'object' || !detail.cells || typeof detail.cells !== 'object') return null;
  const cells = {};
  for (const [key, info] of Object.entries(detail.cells)) {
    if (!info || typeof info !== 'object') continue;
    cells[key] = { given: asString(info.given), correct: info.correct === true };
  }
  return { cells };
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  // Keep only the shape + clues; the letters are the answer key.
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      title: normalized.config.title,
      words: normalized.config.words.map((word) => ({
        id: word.id,
        clue: word.clue,
        row: word.row,
        col: word.col,
        direction: word.direction,
        length: lettersOf(word.word).length,
      })),
    },
  };
}

export function summarizeResponse(item, response) {
  const cells = response && response.cells && typeof response.cells === 'object' ? response.cells : {};
  const filled = Object.values(cells).filter((v) => v !== '' && v != null).length;
  const normalized = normalizeItem(item);
  const grid = buildGrid(normalized.config.words);
  const total = grid ? grid.cells.size : 0;
  return `${filled}/${total} Zellen`.slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const grid = buildGrid(normalized.config.words);
  const cells = {};
  if (grid) for (const [key, cell] of grid.cells) cells[key] = cell.letter;
  return { cells, words: normalized.config.words.map((w) => w.word) };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.words.map((w) => `${w.clue} → ${w.word}`);
}

export function editSchema() {
  return [
    { key: 'title', kind: 'text', label: { en: 'Title', de: 'Titel' } },
    {
      key: 'words',
      kind: 'list',
      label: { en: 'Words', de: 'Wörter' },
      min: 1,
      max: MAX_WORDS,
      itemSchema: [
        { key: 'word', kind: 'text', label: { en: 'Word', de: 'Wort' } },
        { key: 'clue', kind: 'text', label: { en: 'Clue', de: 'Hinweis' } },
        { key: 'row', kind: 'number', label: { en: 'Row', de: 'Zeile' }, min: 0, max: MAX_GRID - 1 },
        { key: 'col', kind: 'number', label: { en: 'Column', de: 'Spalte' }, min: 0, max: MAX_GRID - 1 },
        { key: 'direction', kind: 'select', label: { en: 'Direction', de: 'Richtung' }, options: [{ value: 'across', label: { en: 'across', de: 'waagerecht' } }, { value: 'down', label: { en: 'down', de: 'senkrecht' } }] },
      ],
    },
  ];
}
