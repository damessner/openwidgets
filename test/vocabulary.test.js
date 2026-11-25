// Unit tests for the `vocabulary` item type (v0.7): default validity, scoring
// per mode/direction, sanitize (answer side never leaks), regenerateItemIds.
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
  itemTypeMeta,
} from '../shared/items/index.js';
import { parseVocabCsv } from '../shared/vocab-csv.js';

const TYPES_ENTRY = () => itemTypes.find((m) => m.type === 'vocabulary');

function makeItem(configOverrides = {}) {
  const item = createItem('vocabulary', { id: 'it_vocab', points: 4 });
  item.stem = 'Übe die Vokabeln.';
  item.config = {
    mode: 'translate',
    direction: 'term_to_translation',
    shuffle: false,
    caseSensitive: false,
    entries: [
      { id: 'e1', term: 'Haus', translation: 'house', alternatives: ['home'], example: 'Das Haus ist groß.', imageAssetId: 'img1', audioAssetId: 'aud1' },
      { id: 'e2', term: 'Baum', translation: 'tree', alternatives: [], example: 'Der Baum ist alt.', imageAssetId: '', audioAssetId: 'aud2' },
    ],
    ...configOverrides,
  };
  return normalizeItem(item);
}

test('vocabulary: registered as 16th type with meta', () => {
  const module = TYPES_ENTRY();
  assert.ok(module, 'vocabulary registered');
  assert.equal(itemTypes.length, 16);
  const meta = itemTypeMeta().find((m) => m.type === 'vocabulary');
  assert.equal(meta.scoreable, true);
  assert.ok(meta.label.de && meta.label.en);
});

test('vocabulary: default item is valid', () => {
  const item = createItem('vocabulary');
  assert.deepEqual(validateItem(item), []);
});

test('vocabulary: validate catches empty entries and mode-specific requirements', () => {
  const noEntries = makeItem({ entries: [] });
  assert.ok(validateItem(noEntries).some((e) => e.includes('config.entries')));
  const listenNoAudio = makeItem({
    mode: 'listen',
    entries: [{ id: 'e1', term: 'Haus', translation: 'house', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' }],
  });
  assert.ok(validateItem(listenNoAudio).some((e) => e.includes('audioAssetId')));
  const exampleNoExample = makeItem({ mode: 'example', entries: [{ id: 'e1', term: 'Haus', translation: 'house', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' }] });
  assert.ok(validateItem(exampleNoExample).some((e) => e.includes('example')));
  const emptyTerm = makeItem({ entries: [{ id: 'e1', term: '', translation: 'house', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' }] });
  assert.ok(validateItem(emptyTerm).some((e) => e.includes('term')));
});

test('vocabulary translate: scoring per entry with alternatives + normalization', () => {
  const item = makeItem();
  // e1 correct via alternative "home" (case-insensitive), e2 wrong
  const result = scoreItem(item, { answers: { e1: 'HOME', e2: 'blume' } });
  assert.equal(result.maxScore, 4);
  assert.equal(result.autoScore, 2);
  assert.equal(result.correct, false);
  assert.equal(result.correctParts, 1);
  assert.equal(result.totalParts, 2);
  // both correct (exact + alternative)
  const full = scoreItem(item, { answers: { e1: 'house', e2: ' tree ' } });
  assert.equal(full.autoScore, 4);
  assert.equal(full.correct, true);
});

test('vocabulary direction: translation_to_term answers with the term; both alternates', () => {
  const item = makeItem({ direction: 'translation_to_term' });
  const r = scoreItem(item, { answers: { e1: 'Haus', e2: 'Baum' } });
  assert.equal(r.correct, true);
  assert.equal(r.autoScore, 4);

  const both = makeItem({ direction: 'both' });
  // e1 (index 0) term->translation: answer "house"; e2 (index 1) translation->term: answer "Baum"
  const rb = scoreItem(both, { answers: { e1: 'house', e2: 'Baum' } });
  assert.equal(rb.correct, true);
});

test('vocabulary listen mode: answer is the term; sanitize keeps only audio', () => {
  const item = makeItem({ mode: 'listen' });
  const r = scoreItem(item, { answers: { e1: 'Haus', e2: 'Baum' } });
  assert.equal(r.correct, true);
  const clean = sanitizeItem(item);
  for (const entry of clean.config.entries) {
    assert.equal(entry.term, '');
    assert.equal(entry.translation, '');
    assert.deepEqual(entry.alternatives, []);
    assert.equal(entry.example, '');
    assert.equal(entry.imageAssetId, '');
    assert.ok(entry.audioAssetId, 'audio kept as prompt');
  }
  assert.ok(!JSON.stringify(clean).includes('"Haus"'));
});

test('vocabulary example mode: sanitize masks the term in the example', () => {
  const item = makeItem({ mode: 'example' });
  const clean = sanitizeItem(item);
  const e1 = clean.config.entries.find((e) => e.id === 'e1');
  assert.ok(e1.example.includes('_____'), 'term masked');
  assert.ok(!e1.example.includes('Haus'));
  assert.equal(e1.term, '');
  assert.equal(e1.translation, '');
  const r = scoreItem(item, { answers: { e1: 'Haus', e2: 'Baum' } });
  assert.equal(r.correct, true);
});

test('vocabulary translate sanitize: term_to_translation keeps prompt side, strips translation; translation_to_term vice versa', () => {
  const item = makeItem({ direction: 'term_to_translation' });
  const clean = sanitizeItem(item);
  const e1 = clean.config.entries[0];
  assert.equal(e1.term, 'Haus');
  assert.equal(e1.translation, '');
  assert.deepEqual(e1.alternatives, []);
  assert.equal(e1.example, 'Das Haus ist groß.');
  assert.equal(e1.imageAssetId, 'img1');
  assert.ok(!JSON.stringify(clean).includes('"house"') && !JSON.stringify(clean).includes('"home"'));

  const reverse = sanitizeItem(makeItem({ direction: 'translation_to_term' }));
  const r1 = reverse.config.entries[0];
  assert.equal(r1.translation, 'house');
  assert.equal(r1.term, '');
  assert.equal(r1.example, '');
  assert.equal(r1.imageAssetId, '');
  assert.ok(!JSON.stringify(reverse).includes('"Haus"'));
});

test('vocabulary flashcards: not scoreable, ratings stored, sanitize keeps both sides', () => {
  const item = makeItem({ mode: 'flashcards' });
  const clean = sanitizeItem(item);
  assert.equal(clean.config.entries[0].term, 'Haus');
  assert.equal(clean.config.entries[0].translation, 'house');
  const r = scoreItem(item, { ratings: { e1: 'known', e2: 'unknown' } });
  assert.equal(r.maxScore, 0);
  assert.equal(r.autoScore, 0);
  assert.equal(r.correctParts, 1);
  assert.equal(r.totalParts, 2);
  assert.equal(r.correct, false);
  const allKnown = scoreItem(item, { ratings: { e1: 'known', e2: 'known' } });
  assert.equal(allKnown.correct, true);
});

test('vocabulary: normalizeResponse keeps known entry ids only and validates shapes', () => {
  const module = getType('vocabulary');
  const item = makeItem();
  const typed = module.normalizeResponse(item, { answers: { e1: 'house', eX: 'nope', e2: 42 } });
  assert.deepEqual(typed, { answers: { e1: 'house', e2: '42' } });
  const flash = module.normalizeResponse(makeItem({ mode: 'flashcards' }), { ratings: { e1: 'known', e2: 'maybe' } });
  assert.deepEqual(flash, { ratings: { e1: 'known' } });
});

test('vocabulary: regenerateItemIds remaps entry ids', () => {
  const item = makeItem();
  const copy = regenerateItemIds(item);
  const oldIds = new Set(item.config.entries.map((e) => e.id));
  assert.ok(copy.config.entries.every((e) => !oldIds.has(e.id)));
  assert.equal(copy.config.entries.length, 2);
});

test('parseVocabCsv: term;translation;example, tab support, header skip, limits', () => {
  const entries = parseVocabCsv('Begriff;Übersetzung;Beispiel\nHaus;house;Das Haus ist groß.\nBaum\ttree\n\n;no-term;skip');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { term: 'Haus', translation: 'house', alternatives: [], example: 'Das Haus ist groß.', imageAssetId: '', audioAssetId: '', notes: '' });
  assert.equal(entries[1].term, 'Baum');
  assert.equal(entries[1].translation, 'tree');
});
