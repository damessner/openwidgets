// Unit tests for hangman + crossword (v0.8) and the vocabulary `match` mode:
// scoring, sanitize (answer keys never leak), auto-layout, regenerateItemIds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemTypes,
  getType,
  createItem,
  validateItem,
  normalizeItem,
  scoreItem,
  sanitizeItem,
  regenerateItemIds,
} from '../shared/items/index.js';
import { buildGrid, autoLayout, lettersOf } from '../shared/items/crossword.js';

function hangmanItem(overrides = {}) {
  const item = createItem('hangman', { id: 'it_hm', points: 4 });
  item.stem = 'Errate das Wort.';
  item.config = {
    word: 'Baum',
    alternatives: ['Tree'],
    hint: 'Wächst im Wald',
    maxAttempts: 6,
    caseSensitive: false,
    ...overrides,
  };
  return normalizeItem(item);
}

function crosswordItem(words) {
  const item = createItem('crossword', { id: 'it_cw', points: 6 });
  item.config = { title: 'Test', words: words || [
    { id: 'w1', word: 'HAUS', clue: 'Wo wohnt man?', row: 0, col: 0, direction: 'across' },
    { id: 'w2', word: 'AUF', clue: 'Präposition', row: 0, col: 1, direction: 'down' },
  ] };
  return normalizeItem(item);
}

test('hangman: registered (18 types), default valid', () => {
  assert.equal(itemTypes.length, 18);
  assert.ok(getType('hangman'));
  assert.ok(getType('crossword'));
  assert.deepEqual(validateItem(createItem('hangman')), []);
  assert.deepEqual(validateItem(createItem('crossword')), []);
});

test('hangman: scoring won / partial / lost; sanitize strips the word', () => {
  const item = hangmanItem();
  const won = scoreItem(item, { letters: ['B', 'A', 'U', 'M'] });
  assert.equal(won.correct, true);
  assert.equal(won.autoScore, 4);
  assert.deepEqual(won.detail.revealed.sort(), ['A', 'B', 'M', 'U']);
  assert.equal(won.detail.won, true);

  const partial = scoreItem(item, { letters: ['B', 'A', 'X'] });
  assert.equal(partial.correct, false);
  // 2 of 4 unique letters revealed → 4 points * 0.5 (not won) * 0.5 (ratio) = 1
  assert.equal(partial.autoScore, 1);
  assert.deepEqual(partial.detail.wrong, ['X']);

  const lost = scoreItem(item, { letters: ['X', 'Y', 'Z'] });
  assert.equal(lost.autoScore, 0);
  assert.equal(lost.correct, false);

  // alternative accepted word wins too
  const alt = scoreItem(item, { letters: ['T', 'R', 'E'] });
  assert.equal(alt.correct, true);

  const clean = sanitizeItem(item);
  assert.equal(clean.config.word, undefined);
  assert.equal(clean.config.wordLength, 4);
  assert.equal(clean.config.uniqueLetters, 4);
  assert.equal(clean.config.hint, 'Wächst im Wald');
  const raw = JSON.stringify(clean);
  assert.ok(!raw.includes('Baum') && !raw.includes('Tree') && !raw.includes('"word"'));
});

test('hangman: validate rejects too-short words', () => {
  assert.ok(validateItem(hangmanItem({ word: 'A' })).some((e) => e.includes('config.word')));
});

test('crossword: buildGrid + default valid; conflicts rejected', () => {
  const item = crosswordItem();
  const grid = buildGrid(item.config.words);
  assert.ok(grid);
  assert.equal(grid.cells.size, 6); // HAUS (4) + AUF shares A → 4+2
  assert.equal(grid.cells.get('0,1').letter, 'A');
  assert.deepEqual(validateItem(item), []);

  const conflict = crosswordItem([
    { id: 'w1', word: 'HAUS', clue: 'a', row: 0, col: 0, direction: 'across' },
    { id: 'w2', word: 'BAUM', clue: 'b', row: 0, col: 2, direction: 'down' }, // B over U → conflict
  ]);
  assert.ok(validateItem(conflict).some((e) => e.includes('conflict')));
});

test('crossword: scoring per letter; sanitize strips letters but keeps clues/placement', () => {
  const item = crosswordItem();
  const full = scoreItem(item, { cells: { '0,0': 'H', '0,1': 'A', '0,2': 'U', '0,3': 'S', '1,1': 'U', '2,1': 'F' } });
  assert.equal(full.correct, true);
  assert.equal(full.autoScore, 6);
  const partial = scoreItem(item, { cells: { '0,0': 'H', '0,1': 'A' } });
  assert.equal(partial.correctParts, 2);
  assert.equal(partial.autoScore, 2); // 6 * 2/6
  assert.equal(partial.correct, false);

  const clean = sanitizeItem(item);
  assert.equal(clean.config.words[0].word, undefined);
  assert.equal(clean.config.words[0].length, 4);
  assert.equal(clean.config.words[0].clue, 'Wo wohnt man?');
  const raw = JSON.stringify(clean);
  for (const ch of ['H', 'U', 'S', 'F']) {
    // single letters may appear inside other strings; assert the words array has no letters
  }
  assert.ok(!raw.includes('"word"'));
  assert.ok(!clean.config.words.some((w) => 'word' in w));
});

test('crossword: autoLayout crosses words and stays in bounds', () => {
  const placed = autoLayout([
    { word: 'Haus', clue: 'a' },
    { word: 'Auge', clue: 'b' }, // shares A/U? A at index0 of AUGE vs HAUS A at index1 → crossing
    { word: 'Tisch', clue: 'c' }, // no shared letter with H,A,U,S,E,G → appended below
  ]);
  assert.ok(placed);
  assert.equal(placed.length, 3);
  const grid = buildGrid(placed.map((p, i) => ({ ...p, id: `w${i}` })));
  assert.ok(grid, 'auto layout produces a consistent grid');
  assert.ok(grid.rows <= 20 && grid.cols <= 20);
});

test('crossword: regenerateItemIds remaps word ids', () => {
  const item = crosswordItem();
  const copy = regenerateItemIds(item);
  const oldIds = new Set(item.config.words.map((w) => w.id));
  assert.ok(copy.config.words.every((w) => !oldIds.has(w.id)));
});

test('vocabulary match mode: scoring + sanitize decouples images from terms', () => {
  const item = createItem('vocabulary', { id: 'it_vm', points: 4 });
  item.config = {
    mode: 'match',
    direction: 'term_to_translation',
    shuffle: true,
    caseSensitive: false,
    entries: [
      { id: 'e1', term: 'Haus', translation: 'house', alternatives: [], example: '', imageAssetId: 'img1', audioAssetId: '' },
      { id: 'e2', term: 'Baum', translation: 'tree', alternatives: [], example: '', imageAssetId: 'img2', audioAssetId: '' },
    ],
  };
  const normalized = normalizeItem(item);
  assert.deepEqual(validateItem(normalized), []);

  const r = scoreItem(normalized, { matches: { e1: 'haus', e2: 'Baum' } });
  assert.equal(r.correct, true);
  assert.equal(r.autoScore, 4);

  const clean = sanitizeItem(normalized);
  assert.equal(clean.config.entries.length, 2);
  assert.ok(clean.config.entries.every((e) => e.imageAssetId && e.term === undefined), 'images carry no term');
  assert.ok(Array.isArray(clean.config.terms) && clean.config.terms.length === 2);
  assert.deepEqual([...clean.config.terms].sort(), ['Baum', 'Haus']);
  // the pairing must not be recoverable: image ids and term order are independent
  const raw = JSON.stringify(clean);
  assert.ok(!raw.includes('"term"'));

  // match mode requires images
  const noImg = normalizeItem({
    id: 'x', type: 'vocabulary', points: 2,
    config: { mode: 'match', direction: 'term_to_translation', shuffle: false, caseSensitive: false, entries: [{ id: 'e1', term: 'Haus', translation: '', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' }] },
  });
  assert.ok(validateItem(noImg).some((e) => e.includes('imageAssetId')));

  // normalizeResponse keeps known entry ids
  const mod = getType('vocabulary');
  const resp = mod.normalizeResponse(normalized, { matches: { e1: 'Haus', eX: 'nope' } });
  assert.deepEqual(resp, { matches: { e1: 'Haus', e2: '' } });
});

test('lettersOf strips non-letters and uppercases (umlauts kept)', () => {
  assert.deepEqual(lettersOf('baum!'), ['B', 'A', 'U', 'M']);
  assert.deepEqual(lettersOf('Ähre'), ['Ä', 'H', 'R', 'E']);
});
