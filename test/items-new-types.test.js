// Unit tests for the v0.6 item types: hotspot (TipToi), table (fill/matrix),
// groups (drag&drop zones), mark_sentence, audio_answer â€” registry, sanitize
// (answer keys must never reach the student payload), scoring, regenerate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemTypes,
  getType,
  createItem,
  validateItem,
  scoreItem,
  sanitizeItem,
  regenerateItemIds,
  answerKey,
  answerText,
  summarizeResponse,
  itemTypeMeta,
} from '../shared/items/index.js';

const TYPES = ['hotspot', 'table', 'groups', 'mark_sentence', 'audio_answer'];

test('registry: all new types registered with labels + meta', () => {
  const meta = itemTypeMeta();
  for (const type of TYPES) {
    assert.ok(getType(type), `missing ${type}`);
    const entry = meta.find((m) => m.type === type);
    assert.ok(entry && entry.label.de && entry.label.en, `meta for ${type}`);
    assert.equal(entry.scoreable, true);
  }
  assert.equal(itemTypes.length, 16);
});

test('hotspot: sanitize strips correct flag, keeps feedback/link; scoring counts hits vs wrong taps', () => {
  const item = createItem('hotspot');
  item.config.image = { assetId: 'img1', alt: 'Wiese' };
  item.config.prompt = { text: 'Tippe den Vogel an', audioAssetId: 'aud1' };
  item.config.zones = [
    { id: 'z1', label: 'Vogel', shape: 'circle', x: 0.3, y: 0.3, r: 0.1, correct: true, feedback: { text: 'Richtig!', audioAssetId: 'fb1' }, link: { type: 'assignment', value: 'ABC234' } },
    { id: 'z2', label: 'Baum', shape: 'rect', x: 0.6, y: 0.6, w: 0.2, h: 0.2, correct: false, feedback: { text: '' }, link: { type: 'none', value: '' } },
  ];
  assert.deepEqual(validateItem(item), []);
  const clean = sanitizeItem(item);
  const raw = JSON.stringify(clean);
  assert.ok(!raw.includes('"correct"'), 'correct flag must be stripped');
  assert.ok(raw.includes('Richtig!'), 'feedback stays visible for the popup');
  assert.ok(raw.includes('ABC234'), 'link stays visible');
  assert.ok(raw.includes('aud1'), 'prompt audio stays');
  // scoring
  const allRight = scoreItem(item, { tapped: ['z1'] });
  assert.equal(allRight.correct, true);
  assert.equal(allRight.autoScore, item.points);
  const wrong = scoreItem(item, { tapped: ['z2'] });
  assert.equal(wrong.autoScore, 0);
  assert.equal(wrong.correct, false);
  const both = scoreItem(item, { tapped: ['z1', 'z2'] });
  assert.equal(both.autoScore, 0, 'wrong tap cancels the hit');
  assert.deepEqual(getType(item.type).normalizeResponse(item, { tapped: ['z1', 'nope', 'z1'] }), { tapped: ['z1'] });
  assert.deepEqual(answerKey(item), { tapped: ['z1'] });
  assert.ok(answerText(item).some((l) => l.includes('Vogel')));
  assert.ok(summarizeResponse(item, { tapped: ['z1'] }).includes('Vogel'));
});

test('table fill: gap scoring with alternatives + normalization; sanitize strips answers', () => {
  const item = createItem('table');
  item.config = {
    mode: 'fill',
    multi: false,
    columns: [{ id: 'c1', label: 'Land' }, { id: 'c2', label: 'Hauptstadt' }],
    rows: [
      { id: 'r1', label: 'Ã–sterreich', cells: { c1: { kind: 'static', text: 'Ã–sterreich' }, c2: { kind: 'gap', answers: ['Wien', 'Vienna'] } } },
      { id: 'r2', label: 'Deutschland', cells: { c1: { kind: 'static', text: 'Deutschland' }, c2: { kind: 'gap', answers: ['Berlin'] } } },
    ],
  };
  assert.deepEqual(validateItem(item), []);
  const clean = JSON.stringify(sanitizeItem(item));
  assert.ok(!clean.includes('Wien') && !clean.includes('Berlin'), 'gap answers stripped');
  assert.ok(clean.includes('Ã–sterreich'), 'static text stays');
  const half = scoreItem(item, { cells: { 'r1|c2': '  wien ', 'r2|c2': 'MÃ¼nchen' } });
  assert.equal(half.correctParts, 1);
  assert.equal(half.totalParts, 2);
  assert.equal(half.correct, false);
  const full = scoreItem(item, { cells: { 'r1|c2': 'Vienna', 'r2|c2': 'BERLIN' } });
  assert.equal(full.correct, true);
  assert.equal(full.autoScore, item.points);
  assert.deepEqual(getType(item.type).normalizeResponse(item, { cells: { 'r1|c2': 'Wien', 'r9|c9': 'x' } }), { cells: { 'r1|c2': 'Wien' } });
});

test('table choice (matrix): single + multi correct per row', () => {
  const item = createItem('table');
  item.config = {
    mode: 'choice',
    multi: false,
    columns: [{ id: 'c1', label: 'Ja' }, { id: 'c2', label: 'Nein' }],
    rows: [{ id: 'r1', label: 'Ist 2+2=4?', cells: { c1: { kind: 'option', correct: true }, c2: { kind: 'option', correct: false } } }],
  };
  assert.equal(scoreItem(item, { choices: { r1: 'c1' } }).correct, true);
  assert.equal(scoreItem(item, { choices: { r1: 'c2' } }).correct, false);
  assert.ok(!JSON.stringify(sanitizeItem(item)).includes('"correct":true'));

  item.config.multi = true;
  item.config.columns.push({ id: 'c3', label: 'Vielleicht' });
  item.config.rows.push({ id: 'r2', label: 'Welche sind Primzahlen?', cells: { c1: { kind: 'option', correct: false }, c2: { kind: 'option', correct: true }, c3: { kind: 'option', correct: true } } });
  const multi = scoreItem(item, { choices: { r1: 'c1', r2: ['c2', 'c3'] } });
  assert.equal(multi.correct, true);
  const partial = scoreItem(item, { choices: { r1: 'c1', r2: ['c2'] } });
  assert.equal(partial.correct, false);
  assert.equal(partial.correctParts, 1);
});

test('groups: placement scoring, sanitize strips zoneId, regenerate remaps zone ids', () => {
  const item = createItem('groups');
  item.config = {
    shuffle: false,
    zones: [{ id: 'z1', label: 'Tiere' }, { id: 'z2', label: 'Pflanzen' }],
    items: [
      { id: 'i1', side: { kind: 'text', text: 'Hund' }, zoneId: 'z1' },
      { id: 'i2', side: { kind: 'audio', assetId: 'a9' }, zoneId: 'z2' },
    ],
  };
  assert.deepEqual(validateItem(item), []);
  assert.ok(!JSON.stringify(sanitizeItem(item)).includes('zoneId'));
  assert.equal(scoreItem(item, { placement: { i1: 'z1', i2: 'z2' } }).correct, true);
  const wrong = scoreItem(item, { placement: { i1: 'z2', i2: 'z2' } });
  assert.equal(wrong.correctParts, 1);
  assert.equal(wrong.autoScore, item.points / 2);
  assert.deepEqual(getType(item.type).normalizeResponse(item, { placement: { i1: 'z1', iX: 'z1' } }), { placement: { i1: 'z1' } });
  const dup = regenerateItemIds(item);
  assert.notEqual(dup.config.items[0].id, 'i1');
  assert.ok(dup.config.items.every((e) => dup.config.zones.some((z) => z.id === e.zoneId)), 'zone refs remapped');
  assert.deepEqual(answerKey(item), { placement: { i1: 'z1', i2: 'z2' } });
  assert.ok(answerText(item).some((l) => l.includes('Hund')));
});

test('mark_sentence: mark mode + correct mode with fix scoring', () => {
  const item = createItem('mark_sentence');
  item.config = {
    mode: 'mark',
    words: [
      { text: 'Der', target: 'none' },
      { text: 'schnelle', target: 'mark' },
      { text: 'Fuchs', target: 'mark' },
    ],
  };
  assert.deepEqual(validateItem(item), []);
  assert.ok(!JSON.stringify(sanitizeItem(item)).includes('"target"'));
  assert.equal(scoreItem(item, { selected: [1, 2] }).correct, true);
  const partial = scoreItem(item, { selected: [1, 0] });
  assert.equal(partial.correct, false);
  assert.equal(partial.autoScore, 0, 'one hit + one wrong selection cancels out');

  item.config.mode = 'correct';
  item.config.words = [
    { text: 'Er', target: 'none' },
    { text: 'geht', target: 'wrong', fix: 'ging' },
  ];
  assert.equal(scoreItem(item, { selected: [1], fixes: { 1: 'ging' } }).correct, true);
  assert.equal(scoreItem(item, { selected: [1], fixes: { 1: 'ging' } }).autoScore, item.points);
  assert.equal(scoreItem(item, { selected: [1], fixes: { 1: 'ginge' } }).correct, false, 'wrong correction fails');
  assert.equal(scoreItem(item, { selected: [1] }).correct, false, 'missing fix fails when fix required');
  assert.deepEqual(getType(item.type).normalizeResponse(item, { selected: [1, 99, 'x'], fixes: { 1: 'ging' } }), { selected: [1], fixes: { 1: 'ging' } });
});

test('audio_answer: needsManual always, response normalization, sanitize', () => {
  const item = createItem('audio_answer');
  item.config = { maxDurationSec: 60 };
  assert.deepEqual(validateItem(item), []);
  const result = scoreItem(item, { assetId: 'a1', durationMs: 4000, mime: 'audio/webm' });
  assert.equal(result.needsManual, true);
  assert.equal(result.maxScore, item.points);
  assert.equal(result.autoScore, 0);
  assert.deepEqual(getType(item.type).normalizeResponse(item, { assetId: 'a1', durationMs: 4000, mime: 'audio/webm' }), { assetId: 'a1', durationMs: 4000, mime: 'audio/webm' });
  assert.deepEqual(getType(item.type).normalizeResponse(item, {}), { assetId: '', durationMs: 0, mime: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeItem(item))).config, { maxDurationSec: 60 });
  assert.equal(summarizeResponse(item, { assetId: 'a1', durationMs: 4000 }), String.fromCodePoint(0x1F399) + ' 4s');
  assert.equal(answerKey(item), null);
});

