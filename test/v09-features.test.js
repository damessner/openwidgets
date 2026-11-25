// v0.9 features: fill_blanks drag & drop (<<n>> syntax + word bank) and the
// vocabulary course generator.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gapKeys,
  canonicalizeText,
  effectiveWordBank,
  normalizeItem,
  validateItem,
  score,
  sanitizeItem,
  normalizeResponse,
} from '../shared/items/fill_blanks.js';
import { validateActivity } from '../shared/activity.js';
import { buildVocabCourse } from '../shared/vocab-course.js';

// ---------------------------------------------------------------------------
// fill_blanks: <<n>> syntax
// ---------------------------------------------------------------------------

test('fill_blanks: <<n>> gaps are parsed, legacy {{n}} canonicalized', () => {
  assert.deepEqual(gapKeys('Der <<1>> und die <<2>>.'), ['1', '2']);
  assert.deepEqual(gapKeys('Der {{1}} und die {{2}}.'), ['1', '2']);
  assert.deepEqual(gapKeys('Mixed <<1>> and {{2}}.'), ['1', '2']);
  assert.equal(canonicalizeText('a {{1}} b <<2>> c {{ 3 }}'), 'a <<1>> b <<2>> c <<3>>');
  const item = normalizeItem({
    id: 'x', type: 'fill_blanks', points: 2,
    config: { text: 'legacy {{1}}', blanks: { 1: { accepted: ['Haus'] } } },
  });
  assert.equal(item.config.text, 'legacy <<1>>');
  assert.deepEqual(item.config.blanks['1'].accepted, ['Haus']);
  assert.equal(item.config.mode, 'input', 'default mode is input');
});

test('fill_blanks: validateItem uses <<n>> and checks drag word bank', () => {
  const base = {
    id: 'x', type: 'fill_blanks', points: 2,
    config: { text: 'Der <<1>> wohnen.', blanks: { 1: { accepted: ['Häuser'] } }, caseSensitive: false },
  };
  assert.deepEqual(validateItem(normalizeItem(base)), []);

  // no gaps -> error mentions <<1>>
  const noGaps = normalizeItem({ id: 'y', type: 'fill_blanks', config: { text: 'kein gap', blanks: {} } });
  assert.ok(validateItem(noGaps).some((e) => e.includes('<<1>>')));

  // drag mode: wordBank = distractors only, answers are auto-added -> valid even without them
  const dragOk = normalizeItem({
    id: 'z2', type: 'fill_blanks', points: 2,
    config: { text: 'Der <<1>>.', blanks: { 1: { accepted: ['Häuser'] } }, mode: 'drag', wordBank: ['Auto'] },
  });
  assert.deepEqual(validateItem(dragOk), []);

  // empty distractor list is fine too (bank = answers only)
  const dragEmpty = normalizeItem({
    id: 'z3', type: 'fill_blanks', points: 2,
    config: { text: 'Der <<1>>.', blanks: { 1: { accepted: ['Häuser'] } }, mode: 'drag', wordBank: [] },
  });
  assert.deepEqual(validateItem(dragEmpty), []);
});

test('fill_blanks: effectiveWordBank = gap answers + distractors, deduplicated', () => {
  const item = normalizeItem({
    id: 'w', type: 'fill_blanks', points: 2,
    config: {
      text: '<<1>> und <<2>>',
      blanks: { 1: { accepted: ['Hund', 'dog'] }, 2: { accepted: ['Katze'] } },
      mode: 'drag',
      wordBank: ['Hund', 'Vogel'],
    },
  });
  assert.deepEqual(effectiveWordBank(item), ['Hund', 'dog', 'Katze', 'Vogel']);
});

test('fill_blanks: drag mode scores like input mode; sanitize exposes wordBank but not answers', () => {
  const item = normalizeItem({
    id: 'd', type: 'fill_blanks', points: 2,
    config: { text: 'Der <<1>> und die <<2>>.', blanks: { 1: { accepted: ['Hund'] }, 2: { accepted: ['Katze'] } }, mode: 'drag', wordBank: ['Hund', 'Katze', 'Vogel'] },
  });
  const response = normalizeResponse(item, { blanks: { 1: 'hund', 2: 'Katze' } });
  const result = score(item, response);
  assert.equal(result.correct, true);
  assert.equal(result.autoScore, 2);

  const wrong = score(item, { blanks: { 1: 'Vogel', 2: '' } });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correctParts, 0);

  const safe = sanitizeItem(item);
  assert.equal(safe.config.mode, 'drag');
  // sanitized bank contains answers mixed with distractors, but no per-gap mapping
  assert.deepEqual([...safe.config.wordBank].sort(), ['Hund', 'Katze', 'Vogel']);
  assert.ok(!('blanks' in safe.config), 'per-gap answer mapping must not be sanitized to the client');
  assert.ok(JSON.stringify(safe).includes('<<1>>'), 'gap markers stay visible');
});

// ---------------------------------------------------------------------------
// vocabulary course generator
// ---------------------------------------------------------------------------

const ENTRIES = [
  { term: 'Haus', translation: 'house', alternatives: ['home'], example: 'Das Haus ist groß.', audioAssetId: 'a1' },
  { term: 'Baum', translation: 'tree', alternatives: [], example: 'Der Baum ist hoch.', audioAssetId: 'a2' },
  { term: 'Katze', translation: 'cat', alternatives: [], example: 'Die Katze schläft.', audioAssetId: '' },
  { term: 'Hund', translation: 'dog', alternatives: [], example: 'Der Hund bellt.', audioAssetId: '' },
  { term: 'Tisch', translation: 'table', alternatives: [], example: '', audioAssetId: 'a3' },
];

test('vocab-course: builds escalating levels, all valid, final level tests spelling', () => {
  const { levels, levelTitles } = buildVocabCourse({
    title: 'Unit 5', sourceLang: 'de', targetLang: 'en', entries: ENTRIES,
  });
  // flashcards, example (no images in fixture), translate, translate reverse, listen (3 audio), final quiz
  assert.equal(levels.length, 6);
  assert.ok(levelTitles.some((t) => t.includes('Abschluss')));
  for (const level of levels) {
    const check = validateActivity(level);
    assert.ok(check.ok, `level "${level.title}" must validate: ${JSON.stringify(check.errors)}`);
  }
  const modes = levels.slice(0, 5).map((l) => l.items[0].config.mode);
  assert.deepEqual(modes, ['flashcards', 'example', 'translate', 'translate', 'listen']);
  const listenLevel = levels[4];
  assert.ok(listenLevel.items[0].config.entries.every((e) => e.audioAssetId), 'listen level only uses entries with audio');

  const final = levels[5];
  assert.equal(final.template, 'quiz');
  const types = final.items.map((i) => i.type);
  assert.ok(types.includes('short_answer'), 'final level contains typed answers');
  assert.ok(types.includes('crossword') || types.includes('hangman'), 'final level contains a spelling game');
  const sa = final.items.find((i) => i.type === 'short_answer');
  assert.ok(sa.config.accepted.includes('house'));
  // every short_answer has a non-empty accepted list (otherwise unsolvable)
  for (const item of final.items.filter((i) => i.type === 'short_answer')) {
    assert.ok(item.config.accepted.length > 0);
  }
});

test('vocab-course: fewer than 3 entries throws; no audio -> no listen level', () => {
  assert.throws(() => buildVocabCourse({ title: 'X', entries: ENTRIES.slice(0, 2) }), /3/);
  const noAudio = ENTRIES.map((e) => ({ ...e, audioAssetId: '' }));
  const { levels } = buildVocabCourse({ title: 'Unit 5', entries: noAudio });
  assert.equal(levels.length, 5, 'no listen level without audio');
  assert.ok(!levels.some((l) => l.items[0] && l.items[0].config.mode === 'listen'));
});
