// Unit tests for shared/items/* — scoring semantics, validation, response
// normalization and the answer-stripping guarantee of sanitizeItem().
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerKey,
  answerText,
  createItem,
  getType,
  itemTypeMeta,
  itemTypes,
  normalizeItem,
  regenerateItemIds,
  sanitizeItem,
  scoreItem,
  summarizeResponse,
  validateItem,
} from '../shared/items/index.js';

const SECRET = 'SENTINEL_SECRET_ANSWER';

test('registry: ten types with palette metadata', () => {
  assert.deepEqual(
    itemTypes.map((module) => module.type),
    [
      'text',
      'multiple_choice',
      'short_answer',
      'numeric',
      'fill_blanks',
      'match',
      'ordering',
      'pins',
      'image_boxes',
      'long_answer',
    ],
  );
  const meta = itemTypeMeta();
  assert.equal(meta.length, 10);
  assert.equal(meta.find((entry) => entry.type === 'text').scoreable, false);
  assert.equal(meta.find((entry) => entry.type === 'multiple_choice').scoreable, true);
  for (const entry of meta) {
    assert.equal(typeof entry.label.en, 'string');
    assert.equal(typeof entry.label.de, 'string');
  }
  assert.equal(getType('nope'), null);
  assert.throws(() => createItem('nope'), /Unknown item type/);
  const unknownScore = scoreItem({ type: 'nope', points: 5 }, {});
  assert.equal(unknownScore.autoScore, 0);
  assert.equal(unknownScore.maxScore, 0);
  assert.equal(unknownScore.correct, false);
});

test('every type creates a valid default item with an editSchema', () => {
  for (const module of itemTypes) {
    const item = createItem(module.type);
    assert.equal(item.type, module.type);
    assert.match(item.id, /^it_/);
    if (module.type === 'image_boxes') {
      // the default has no image yet — it only becomes valid once one is uploaded
      assert.ok(validateItem(item).some((e) => e.includes('config.image.assetId')));
      const withImage = normalizeItem({ ...item, config: { ...item.config, image: { assetId: 'a1', alt: '' } } });
      assert.deepEqual(validateItem(withImage), []);
    } else {
      assert.deepEqual(validateItem(item), [], `${module.type} default item should be valid`);
    }
    const schema = module.editSchema();
    assert.ok(Array.isArray(schema) && schema.length > 0, `${module.type} editSchema`);
    for (const field of schema) {
      assert.equal(typeof field.key, 'string');
      assert.ok(['text', 'textarea', 'number', 'switch', 'select', 'list'].includes(field.kind));
      assert.equal(typeof field.label.en, 'string');
      assert.equal(typeof field.label.de, 'string');
    }
  }
});

test('text: non-scoreable, keeps content, never validates points', () => {
  const item = createItem('text');
  assert.equal(item.points, 0);
  const scored = scoreItem({ ...item, points: 3 }, {});
  assert.equal(scored.maxScore, 0);
  const invalid = validateItem({ ...item, points: 3 });
  assert.ok(invalid.some((error) => error.startsWith('points:')));
  const sanitized = sanitizeItem({ ...item, config: { text: 'Lies mich' } });
  assert.equal(sanitized.config.text, 'Lies mich');
});

test('multiple_choice: single choice full/zero points', () => {
  const item = normalizeItem({
    id: 'it_mc',
    type: 'multiple_choice',
    points: 2,
    config: {
      multi: false,
      choices: [
        { id: 'c1', text: 'richtig', correct: true },
        { id: 'c2', text: 'falsch', correct: false },
      ],
    },
  });
  assert.equal(validateItem(item).length, 0);
  const right = scoreItem(item, { selected: ['c1'] });
  assert.equal(right.autoScore, 2);
  assert.equal(right.maxScore, 2);
  assert.equal(right.correct, true);
  const wrong = scoreItem(item, { selected: ['c2'] });
  assert.equal(wrong.autoScore, 0);
  assert.equal(wrong.correct, false);
  const empty = scoreItem(item, { selected: [] });
  assert.equal(empty.autoScore, 0);
  assert.deepEqual(empty.detail.correctIds, ['c1']);
});

test('multiple_choice: multi partial credit and exact mode', () => {
  const base = {
    id: 'it_mcm',
    type: 'multiple_choice',
    points: 4,
    config: {
      multi: true,
      partialCredit: true,
      choices: [
        { id: 'c1', text: 'a', correct: true },
        { id: 'c2', text: 'b', correct: true },
        { id: 'c3', text: 'c', correct: true },
        { id: 'c4', text: 'd', correct: false },
      ],
    },
  };
  const partial = normalizeItem(base);
  // 2 correct, 1 wrong -> (2-1)/3 of 4 points
  const scored = scoreItem(partial, { selected: ['c1', 'c2', 'c4'] });
  assert.equal(scored.autoScore, 1.3333);
  assert.equal(scored.correct, false);
  assert.equal(scored.autoScore <= partial.points, true);

  const exact = normalizeItem({ ...base, config: { ...base.config, partialCredit: false } });
  assert.equal(scoreItem(exact, { selected: ['c1', 'c2', 'c3'] }).autoScore, 4);
  assert.equal(scoreItem(exact, { selected: ['c1', 'c2'] }).autoScore, 0);
  assert.equal(scoreItem(exact, { selected: ['c1', 'c2', 'c3', 'c4'] }).autoScore, 0);

  const negative = scoreItem(partial, { selected: ['c4'] });
  assert.equal(negative.autoScore, 0);
});

test('multiple_choice: invalid configs are reported', () => {
  const item = normalizeItem({
    id: 'it_mci',
    type: 'multiple_choice',
    config: { choices: [{ id: 'c1', text: 'a', correct: false }, { id: 'c2', text: 'b', correct: false }] },
  });
  const errors = validateItem(item);
  assert.ok(errors.some((error) => error.includes('at least one choice')));
  const singleTwoCorrect = normalizeItem({
    id: 'it_mci2',
    type: 'multiple_choice',
    config: {
      multi: false,
      choices: [
        { id: 'c1', text: 'a', correct: true },
        { id: 'c2', text: 'b', correct: true },
      ],
    },
  });
  assert.ok(validateItem(singleTwoCorrect).some((error) => error.includes('exactly one')));
});

test('short_answer: normalization flags and accepted answers', () => {
  const item = normalizeItem({
    id: 'it_sa',
    type: 'short_answer',
    points: 1,
    config: { accepted: ['Photosynthese', 'Fotosynthese'], caseSensitive: false, ignorePunctuation: true },
  });
  assert.equal(scoreItem(item, { text: '  photosynthese!  ' }).autoScore, 1);
  assert.equal(scoreItem(item, { text: 'fotosynthese' }).correct, true);
  assert.equal(scoreItem(item, { text: 'Atmung' }).autoScore, 0);
  assert.equal(scoreItem(item, { text: '' }).autoScore, 0);
  const strict = normalizeItem({ ...item, config: { ...item.config, caseSensitive: true } });
  assert.equal(scoreItem(strict, { text: 'photosynthese' }).autoScore, 0);
  assert.equal(scoreItem(strict, { text: 'Photosynthese' }).autoScore, 1);
});

test('numeric: localized input, tolerance modes, unparseable input', () => {
  const absolute = normalizeItem({
    id: 'it_num',
    type: 'numeric',
    points: 2,
    config: { answer: 3.5, tolerance: 0.01, toleranceType: 'absolute' },
  });
  assert.equal(scoreItem(absolute, { value: '3,5' }).autoScore, 2);
  assert.equal(scoreItem(absolute, { value: '3.50' }).autoScore, 2);
  assert.equal(scoreItem(absolute, { value: ' 3,51 ' }).autoScore, 2);
  assert.equal(scoreItem(absolute, { value: '3,6' }).autoScore, 0);
  assert.equal(scoreItem(absolute, { value: 'abc' }).autoScore, 0);
  assert.equal(scoreItem(absolute, { value: '' }).autoScore, 0);

  const percent = normalizeItem({
    id: 'it_nump',
    type: 'numeric',
    points: 1,
    config: { answer: 200, tolerance: 5, toleranceType: 'percent' },
  });
  // 5 % of 200 = 10
  assert.equal(scoreItem(percent, { value: '210' }).autoScore, 1);
  assert.equal(scoreItem(percent, { value: '211' }).autoScore, 0);

  const draft = normalizeItem({ id: 'it_numd', type: 'numeric', config: { answer: null } });
  assert.equal(scoreItem(draft, { value: '0' }).autoScore, 0);
});

test('fill_blanks: per-gap weighting, missing gaps and case handling', () => {
  const item = normalizeItem({
    id: 'it_fb',
    type: 'fill_blanks',
    points: 2,
    config: {
      text: 'Platten gleiten an {{1}} Grenzen. Das ist {{2}}.',
      blanks: {
        1: { accepted: ['transform'] },
        2: { accepted: ['divergent'] },
      },
      caseSensitive: false,
    },
  });
  assert.equal(validateItem(item).length, 0);
  assert.equal(scoreItem(item, { blanks: { 1: 'Transform', 2: 'divergent' } }).autoScore, 2);
  const half = scoreItem(item, { blanks: { 1: 'transform', 2: 'konvergent' } });
  assert.equal(half.autoScore, 1);
  assert.equal(half.correct, false);
  assert.equal(half.correctParts, 1);
  assert.equal(half.totalParts, 2);
  assert.equal(scoreItem(item, { blanks: {} }).autoScore, 0);
  assert.equal(scoreItem(item, { blanks: { 1: ' transform ' } }).autoScore, 1);
});

test('fill_blanks: validation reports unknown gaps', () => {
  const unknown = normalizeItem({
    id: 'it_fbv',
    type: 'fill_blanks',
    config: { text: 'x {{1}} y', blanks: { 9: { accepted: ['nope'] } } },
  });
  const errors = validateItem(unknown);
  assert.ok(errors.some((error) => error.includes('config.blanks.9')));
  const noGaps = normalizeItem({ id: 'it_fbv2', type: 'fill_blanks', config: { text: 'keine Lücke' } });
  assert.ok(validateItem(noGaps).some((error) => error.includes('at least one gap')));
});

test('match: self-pairing semantics, partial credit, sanitization shape', () => {
  const item = normalizeItem({
    id: 'it_m',
    type: 'match',
    points: 3,
    config: {
      pairs: [
        { id: 'p1', left: 'A', right: '1' },
        { id: 'p2', left: 'B', right: '2' },
        { id: 'p3', left: 'C', right: '3' },
      ],
    },
  });
  assert.equal(scoreItem(item, { matches: { p1: 'p1', p2: 'p2', p3: 'p3' } }).autoScore, 3);
  const partial = scoreItem(item, { matches: { p1: 'p1', p2: 'p3', p3: 'p2' } });
  assert.equal(partial.autoScore, 1);
  assert.equal(partial.correct, false);
  assert.equal(partial.correctParts, 1);
  const sanitized = sanitizeItem(item);
  assert.ok(sanitized.config.lefts.every((left) => left.text && !('right' in left)));
  assert.ok(sanitized.config.rights.every((right) => right.text && !('left' in right)));
  assert.equal(sanitized.config.lefts.length, 3);
  assert.equal(sanitized.config.rights.length, 3);
});

test('ordering: positions mode partial credit, exact mode all-or-nothing', () => {
  const make = (mode) =>
    normalizeItem({
      id: `it_o_${mode}`,
      type: 'ordering',
      points: 3,
      config: {
        mode,
        items: [
          { id: 'i1', text: 'eins' },
          { id: 'i2', text: 'zwei' },
          { id: 'i3', text: 'drei' },
        ],
      },
    });
  const positions = make('positions');
  assert.equal(scoreItem(positions, { order: ['i1', 'i2', 'i3'] }).autoScore, 3);
  assert.equal(scoreItem(positions, { order: ['i1', 'i3', 'i2'] }).autoScore, 1);
  assert.equal(scoreItem(positions, { order: ['i3', 'i2', 'i1'] }).autoScore, 1);
  const exact = make('exact');
  assert.equal(scoreItem(exact, { order: ['i1', 'i2', 'i3'] }).autoScore, 3);
  assert.equal(scoreItem(exact, { order: ['i1', 'i3', 'i2'] }).autoScore, 0);
});

test('pins: distance against zone radius, partial credit', () => {
  const item = normalizeItem({
    id: 'it_p',
    type: 'pins',
    points: 2,
    config: {
      image: { assetId: 'asset-1', alt: '' },
      zones: [
        { id: 'z1', label: 'links', x: 0.2, y: 0.2, r: 0.05 },
        { id: 'z2', label: 'rechts', x: 0.8, y: 0.8, r: 0.05 },
      ],
    },
  });
  assert.equal(scoreItem(item, { points: { z1: { x: 0.21, y: 0.19 }, z2: { x: 0.8, y: 0.8 } } }).autoScore, 2);
  const partial = scoreItem(item, { points: { z1: { x: 0.21, y: 0.19 }, z2: { x: 0.5, y: 0.5 } } });
  assert.equal(partial.autoScore, 1);
  assert.deepEqual(partial.detail.hit, ['z1']);
  assert.deepEqual(partial.detail.miss, ['z2']);
  const sanitized = sanitizeItem(item);
  for (const zone of sanitized.config.zones) {
    assert.deepEqual(Object.keys(zone).sort(), ['id', 'label'], 'zones must expose only id+label');
  }
  assert.ok(!JSON.stringify(sanitized).includes('"r"'));
  assert.ok(!JSON.stringify(sanitized).includes('"x"'));
});

test('long_answer: hint keyword auto-score and always needs manual grading', () => {
  const item = normalizeItem({
    id: 'it_la',
    type: 'long_answer',
    points: 5,
    config: {
      hints: [
        { text: 'photosynthese', alternatives: ['fotosynthese'], points: 2 },
        { text: 'chloroplast', alternatives: [], points: 2 },
      ],
      rubric: [{ criterion: 'Fachliche Richtigkeit', levels: [{ label: 'gut', points: 1 }] }],
      minWords: 10,
      maxWords: 500,
    },
  });
  const scored = scoreItem(item, { text: 'Die Photosynthese findet im Chloroplast statt.' });
  assert.equal(scored.autoScore, 4);
  assert.equal(scored.needsManual, true);
  assert.equal(scored.correct, false);
  assert.equal(scored.maxScore, 5);
  const none = scoreItem(item, { text: 'Keine Ahnung.' });
  assert.equal(none.autoScore, 0);
  assert.equal(none.needsManual, true);
  const sanitized = sanitizeItem(item);
  assert.ok(!('hints' in sanitized.config));
  assert.ok(!('rubric' in sanitized.config));
});

test('sanitizeItem never leaks answers for any type', () => {
  const items = [
    createItem('multiple_choice'),
    normalizeItem({ id: 'it_sa2', type: 'short_answer', config: { accepted: [SECRET] } }),
    normalizeItem({ id: 'it_num2', type: 'numeric', config: { answer: 42 } }),
    normalizeItem({
      id: 'it_fb2',
      type: 'fill_blanks',
      config: { text: '{{1}}', blanks: { 1: { accepted: [SECRET] } } },
    }),
    normalizeItem({
      id: 'it_m2',
      type: 'match',
      config: { pairs: [{ id: 'p1', left: 'links A', right: 'rechts A' }, { id: 'p2', left: 'links B', right: 'rechts B' }] },
    }),
    normalizeItem({
      id: 'it_o2',
      type: 'ordering',
      config: { items: [{ id: 'i1', text: 'eins' }, { id: 'i2', text: 'zwei' }] },
    }),
    normalizeItem({
      id: 'it_p2',
      type: 'pins',
      config: { image: { assetId: 'a', alt: '' }, zones: [{ id: 'z1', label: 'L', x: 0.3, y: 0.4, r: 0.05 }] },
    }),
    normalizeItem({
      id: 'it_la2',
      type: 'long_answer',
      config: { hints: [{ text: SECRET, alternatives: [], points: 1 }], rubric: [{ criterion: SECRET }] },
    }),
  ];
  for (const item of items) {
    const json = JSON.stringify(sanitizeItem(item));
    assert.ok(!json.includes('"accepted"'), `${item.type} must not leak accepted lists`);
    assert.ok(!json.includes('"correct"'), `${item.type} must not leak correct flags`);
    assert.ok(!json.includes('"rubric"'), `${item.type} must not leak the rubric`);
    assert.ok(!json.includes('"hints"'), `${item.type} must not leak hints`);
    assert.ok(!json.includes('"tolerance"'), `${item.type} must not leak tolerances`);
  }
  // Answer-bearing fields are stripped wherever they appear.
  const answerBearing = [
    normalizeItem({ id: 'it_sa3', type: 'short_answer', config: { accepted: [SECRET] } }),
    normalizeItem({ id: 'it_fb3', type: 'fill_blanks', config: { text: '{{1}}', blanks: { 1: { accepted: [SECRET] } } } }),
    normalizeItem({ id: 'it_la3', type: 'long_answer', config: { hints: [{ text: SECRET, points: 1 }] } }),
  ];
  for (const item of answerBearing) {
    assert.ok(!JSON.stringify(sanitizeItem(item)).includes(SECRET), `${item.type} leaked its answers`);
  }
});

test('normalizeResponse returns canonical responses', () => {
  const mc = createItem('multiple_choice');
  assert.deepEqual(mc && getType('multiple_choice').normalizeResponse(mc, { selected: ['c1', 'c1', 'ghost'] }), {
    selected: ['c1'],
  });
  assert.throws(() => getType('multiple_choice').normalizeResponse(mc, { nope: true }));

  const sa = createItem('short_answer');
  assert.deepEqual(getType('short_answer').normalizeResponse(sa, { text: 'hi' }), { text: 'hi' });

  const num = createItem('numeric');
  assert.deepEqual(getType('numeric').normalizeResponse(num, { value: '3,5' }), { value: '3,5' });
  assert.deepEqual(getType('numeric').normalizeResponse(num, { value: 3.5 }), { value: '3.5' });

  const fb = normalizeItem({ id: 'it_nr1', type: 'fill_blanks', config: { text: '{{1}} {{2}}' } });
  assert.deepEqual(getType('fill_blanks').normalizeResponse(fb, { blanks: { 1: 'a', 9: 'x' } }), {
    blanks: { 1: 'a', 2: '' },
  });

  const match = normalizeItem({
    id: 'it_nr2',
    type: 'match',
    config: { pairs: [{ id: 'p1', left: 'l', right: 'r' }, { id: 'p2', left: 'l2', right: 'r2' }] },
  });
  assert.deepEqual(getType('match').normalizeResponse(match, { matches: { p1: 'p2', p2: 'p1', p9: 'p1' } }), {
    matches: { p1: 'p2', p2: 'p1' },
  });
  assert.throws(() => getType('match').normalizeResponse(match, {}));

  const ordering = normalizeItem({
    id: 'it_nr3',
    type: 'ordering',
    config: { items: [{ id: 'i1', text: 'a' }, { id: 'i2', text: 'b' }] },
  });
  assert.deepEqual(getType('ordering').normalizeResponse(ordering, { order: ['i2', 'ghost', 'i1'] }), {
    order: ['i2', 'i1'],
  });

  const pins = normalizeItem({
    id: 'it_nr4',
    type: 'pins',
    config: { zones: [{ id: 'z1', label: '', x: 0.5, y: 0.5, r: 0.1 }] },
  });
  assert.deepEqual(getType('pins').normalizeResponse(pins, { points: { z1: { x: 2, y: -1 } } }), {
    points: { z1: { x: 1, y: 0 } },
  });

  const long = createItem('long_answer');
  assert.deepEqual(getType('long_answer').normalizeResponse(long, { text: 'Aufsatz' }), { text: 'Aufsatz' });
});

test('answerKey / answerText / summarizeResponse produce teacher material', () => {
  const mc = normalizeItem({
    id: 'it_ak1',
    type: 'multiple_choice',
    config: {
      choices: [
        { id: 'c1', text: 'Richtig A', correct: true },
        { id: 'c2', text: 'Falsch', correct: false },
        { id: 'c3', text: 'Richtig B', correct: true },
      ],
      multi: true,
    },
  });
  assert.deepEqual(answerKey(mc), { selected: ['c1', 'c3'] });
  assert.deepEqual(answerText(mc), ['Richtig A', 'Richtig B']);
  assert.equal(summarizeResponse(mc, { selected: ['c1'] }), 'Richtig A');

  const order = normalizeItem({
    id: 'it_ak2',
    type: 'ordering',
    config: { items: [{ id: 'i1', text: 'eins' }, { id: 'i2', text: 'zwei' }] },
  });
  assert.deepEqual(answerKey(order), { order: ['i1', 'i2'] });
  assert.deepEqual(answerText(order), ['eins', 'zwei']);
  assert.equal(summarizeResponse(order, { order: ['i2', 'i1'] }), 'B, A');

  const num = normalizeItem({ id: 'it_ak3', type: 'numeric', config: { answer: 3.5 } });
  assert.deepEqual(answerKey(num), { value: '3.5' });
  assert.deepEqual(answerText(num), ['3.5']);
  assert.equal(summarizeResponse(num, { value: '3,4' }), '3,4');

  const text = createItem('text');
  assert.deepEqual(answerKey(text), { gaps: {} });
  assert.deepEqual(answerText(text), []);
});

test('regenerateItemIds changes item and nested ids but keeps answers', () => {
  const mc = normalizeItem({
    id: 'it_regen',
    type: 'multiple_choice',
    config: {
      choices: [
        { id: 'c1', text: 'a', correct: true },
        { id: 'c2', text: 'b', correct: false },
      ],
    },
  });
  const copy = regenerateItemIds(mc);
  assert.notEqual(copy.id, mc.id);
  assert.notDeepEqual(copy.config.choices.map((choice) => choice.id), ['c1', 'c2']);
  assert.deepEqual(copy.config.choices.map((choice) => choice.correct), [true, false]);
  assert.equal(copy.stem, mc.stem);

  const match = normalizeItem({
    id: 'it_regen2',
    type: 'match',
    config: { pairs: [{ id: 'p1', left: 'l', right: 'r' }, { id: 'p2', left: 'l2', right: 'r2' }] },
  });
  const matchCopy = regenerateItemIds(match);
  assert.equal(matchCopy.config.pairs.length, 2);
  assert.deepEqual(
    matchCopy.config.pairs.map((pair) => pair.left.text),
    ['l', 'l2'],
  );
});

// ---------------------------------------------------------------------------
// rich-media authoring: text gaps, image boxes, match media sides
// ---------------------------------------------------------------------------

import { parseGaps, maskGaps } from '../shared/items/text.js';
import { normalizeSide, sideLabel } from '../shared/items/match.js';
import { itemIsScoreable } from '../shared/activity.js';

test('text: parseGaps finds <<answer|alt>> gaps in order', () => {
  assert.deepEqual(parseGaps('Die <<Hauptstadt|Haupt-Stadt>> von Frankreich ist <<Paris>>.'), [
    { index: 1, raw: 'Hauptstadt|Haupt-Stadt', accepted: ['Hauptstadt', 'Haupt-Stadt'] },
    { index: 2, raw: 'Paris', accepted: ['Paris'] },
  ]);
  assert.deepEqual(parseGaps('no gaps here'), []);
  assert.deepEqual(parseGaps('<<>>'), [{ index: 1, raw: '', accepted: [] }]);
  assert.equal(parseGaps('<<a>>'.repeat(60)).length, 60);
});

test('text: maskGaps hides answers but keeps the placeholder', () => {
  const masked = maskGaps(`Das ist das Ende mit <<${SECRET}|x>>.`);
  assert.ok(!masked.includes(SECRET));
  assert.ok(masked.includes('<<>>'));
  // text outside gaps is untouched
  assert.equal(maskGaps(`plain ${SECRET}`), `plain ${SECRET}`);
});

test('text: points require at least one gap; empty gap is a validation error', () => {
  const plain = normalizeItem({ id: 't1', type: 'text', points: 3, config: { text: 'Nur ein Text.' } });
  assert.ok(validateItem(plain).some((e) => e.startsWith('points:')));

  const plainSecret = normalizeItem({ id: 't2', type: 'text', points: 3, config: { text: `Das ${SECRET} ist schön, aber ohne Lücke.` } });
  assert.ok(validateItem(plainSecret).some((e) => e.startsWith('points:')));

  const gapped = normalizeItem({ id: 't3', type: 'text', points: 4, config: { text: `Paris ist die <<${SECRET}>>.` } });
  assert.deepEqual(validateItem(gapped), []);

  const emptyGap = normalizeItem({ id: 't4', type: 'text', points: 2, config: { text: 'Ein <<>> hier.' } });
  assert.ok(validateItem(emptyGap).some((e) => e.includes('gap #1')));
});

test('text: gaps make the item scoreable and are scored per gap', () => {
  const item = normalizeItem({
    id: 't5',
    type: 'text',
    points: 4,
    config: { text: '<<eins>> und <<zwei|2>>.' },
  });
  assert.equal(itemIsScoreable(item), true);
  assert.equal(itemIsScoreable(normalizeItem({ id: 't6', type: 'text', points: 0, config: { text: '<<x>>' } })), false);
  assert.equal(itemIsScoreable(normalizeItem({ id: 't7', type: 'text', points: 2, config: { text: 'kein gap' } })), false);

  const response =getType(item.type).normalizeResponse(item, { gaps: { g1: ' Eins ', g2: 'zwei' } });
  assert.deepEqual(response, { gaps: { g1: ' Eins ', g2: 'zwei' } });
  const result = scoreItem(item, response);
  assert.equal(result.maxScore, 4);
  assert.equal(result.correctParts, 2);
  assert.equal(result.totalParts, 2);
  assert.equal(result.correct, true);
  assert.equal(result.autoScore, 4);

  const wrong = scoreItem(item,getType(item.type).normalizeResponse(item, { gaps: { g1: 'drei', g2: '' } }));
  assert.equal(wrong.correctParts, 0);
  assert.equal(wrong.autoScore, 0);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.detail.gaps.g1.correct, false);
});

test('text: sanitize masks gap answers in the student payload', () => {
  const item = normalizeItem({ id: 't8', type: 'text', points: 2, config: { text: `Antwort: <<${SECRET}>>.` } });
  const safe = sanitizeItem(item);
  assert.ok(!JSON.stringify(safe).includes(SECRET));
  assert.ok(safe.config.text.includes('<<>>'));
  assert.deepEqual(answerKey(item), { gaps: { g1: SECRET } });
  assert.deepEqual(answerText(item), [`Lücke 1: ${SECRET}`]);
});

test('image_boxes: normalize clamps geometry, keeps label, caps boxes', () => {
  const item = normalizeItem({
    id: 'ib1',
    type: 'image_boxes',
    points: 6,
    config: {
      image: { assetId: 'a1', alt: 'Karte' },
      boxes: [
        { id: 'b1', x: 2, y: -1, w: 0.5, h: 0.4, label: 'Hauptstadt', accepted: [SECRET] },
        { id: 'b2', x: 0.1, y: 0.1, w: 2, h: 0.2, label: '', accepted: ['x', 'y'] },
        { id: 'b1', x: 0, y: 0, w: 0.1, h: 0.1, label: '', accepted: [] }, // duplicate id gets re-issued
      ],
    },
  });
  assert.equal(item.config.boxes.length, 3);
  assert.equal(item.config.boxes[0].x, 1);
  assert.equal(item.config.boxes[0].y, 0);
  assert.equal(item.config.boxes[1].w, 0.2); // invalid w falls back to default
  assert.notEqual(item.config.boxes[2].id, 'b1');
  assert.deepEqual(validateItem(item).filter((e) => e.includes('assetId') || e.includes('inputMode')), []);
});

test('image_boxes: validation requires image, boxes and drag-mode word bank coverage', () => {
  const noImage = normalizeItem({ id: 'ib2', type: 'image_boxes', config: { boxes: [{ id: 'b1', x: 0, y: 0, w: 0.2, h: 0.2, label: '', accepted: ['a'] }] } });
  assert.ok(validateItem(noImage).some((e) => e.includes('config.image.assetId')));

  const drag = normalizeItem({
    id: 'ib3',
    type: 'image_boxes',
    config: {
      image: { assetId: 'a1', alt: '' },
      inputMode: 'drag',
      wordBank: ['Haus', 'Baum'],
      boxes: [{ id: 'b1', x: 0, y: 0, w: 0.2, h: 0.2, label: '', accepted: ['Haus', 'Turm'] }],
    },
  });
  const errors = validateItem(drag);
  assert.ok(errors.some((e) => e.includes('not in the word bank')));
  assert.ok(errors.some((e) => e.includes('every box needs at least one accepted word') || e.includes('not in the word bank')));

  const dragOk = normalizeItem({
    id: 'ib4',
    type: 'image_boxes',
    config: {
      image: { assetId: 'a1', alt: '' },
      inputMode: 'drag',
      wordBank: ['Haus', 'Baum'],
      boxes: [
        { id: 'b1', x: 0, y: 0, w: 0.2, h: 0.2, label: '', accepted: ['haus'] }, // case-insensitive bank match
        { id: 'b2', x: 0.3, y: 0, w: 0.2, h: 0.2, label: '', accepted: ['Baum'] },
      ],
    },
  });
  assert.deepEqual(validateItem(dragOk), []);

  const dragNoBank = normalizeItem({
    id: 'ib5',
    type: 'image_boxes',
    config: { image: { assetId: 'a1', alt: '' }, inputMode: 'drag', wordBank: [], boxes: [{ id: 'b1', x: 0, y: 0, w: 0.2, h: 0.2, label: '', accepted: ['x'] }] },
  });
  assert.ok(validateItem(dragNoBank).some((e) => e.includes('word bank')));
});

test('image_boxes: score splits points across boxes; sanitize never leaks accepted words', () => {
  const item = normalizeItem({
    id: 'ib6',
    type: 'image_boxes',
    points: 4,
    config: {
      image: { assetId: 'a1', alt: 'Karte' },
      boxes: [
        { id: 'b1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'A', accepted: [SECRET] },
        { id: 'b2', x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: 'B', accepted: ['zwei', '2'] },
      ],
    },
  });
  const response =getType(item.type).normalizeResponse(item, { answers: { b1: ` ${SECRET} `, b2: 'ZWEI' } });
  const result = scoreItem(item, response);
  assert.equal(result.correct, true);
  assert.equal(result.autoScore, 4);
  assert.equal(result.detail.boxes.b1.correct, true);

  const half = scoreItem(item,getType(item.type).normalizeResponse(item, { answers: { b1: SECRET } }));
  assert.equal(half.correctParts, 1);
  assert.equal(half.totalParts, 2);
  assert.equal(half.autoScore, 2);
  assert.equal(half.correct, false);

  const safe = sanitizeItem(item);
  assert.ok(!JSON.stringify(safe).includes(SECRET));
  assert.deepEqual(safe.config.boxes[0], { id: 'b1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'A' });
  assert.deepEqual(safe.config.wordBank, []); // type mode: bank stays hidden
  assert.equal(safe.config.image.assetId, 'a1');

  const zones = getType('image_boxes').answerZones(item);
  assert.equal(zones.length, 2);
  assert.deepEqual(zones[0].accepted, [SECRET]);
  assert.equal(zones[0].x, 0.1);

  assert.deepEqual(answerKey(item), { answers: { b1: SECRET, b2: 'zwei' } });
  assert.throws(() =>getType(item.type).normalizeResponse(item, { answers: 'nope' }), /answers/);
});

test('image_boxes: drag mode exposes the word bank but still hides accepted words', () => {
  const item = normalizeItem({
    id: 'ib7',
    type: 'image_boxes',
    config: {
      image: { assetId: 'a1', alt: '' },
      inputMode: 'drag',
      wordBank: ['Haus', SECRET],
      boxes: [{ id: 'b1', x: 0, y: 0, w: 0.3, h: 0.3, label: 'Wohnen', accepted: [SECRET] }],
    },
  });
  const safe = sanitizeItem(item);
  assert.deepEqual(safe.config.wordBank, ['Haus', SECRET]); // bank is shown by design
  assert.ok(!JSON.stringify(safe.config.boxes).includes(SECRET));
  assert.equal(safe.config.inputMode, 'drag');
});

test('image_boxes: regenerateItemIds re-issues box ids', () => {
  const item = normalizeItem({
    id: 'ib8',
    type: 'image_boxes',
    config: {
      image: { assetId: 'a1', alt: '' },
      boxes: [{ id: 'b1', x: 0, y: 0, w: 0.2, h: 0.2, label: 'x', accepted: ['a'] }],
    },
  });
  const copy = regenerateItemIds(item);
  assert.notEqual(copy.id, item.id);
  assert.notEqual(copy.config.boxes[0].id, 'b1');
  assert.equal(copy.config.boxes[0].accepted[0], 'a');
});

test('match: legacy string sides normalize to text; media sides keep kind + assetId', () => {
  assert.deepEqual(normalizeSide('Hallo'), { kind: 'text', text: 'Hallo' });
  assert.deepEqual(normalizeSide({ kind: 'image', assetId: 'a9', alt: 'Dom' }), { kind: 'image', assetId: 'a9', alt: 'Dom' });
  assert.deepEqual(normalizeSide({ kind: 'audio', assetId: 'a10' }), { kind: 'audio', assetId: 'a10' });
  assert.deepEqual(normalizeSide({ kind: 'bogus', text: 'x' }), { kind: 'text', text: 'x' });
  assert.equal(sideLabel({ kind: 'image', assetId: 'a', alt: '' }, 2), '[Bild 3]');
  assert.equal(sideLabel({ kind: 'audio', assetId: 'a' }, 0), '[Audio 1]');
  assert.equal(sideLabel({ kind: 'text', text: 'T' }), 'T');

  const item = normalizeItem({
    id: 'm1',
    type: 'match',
    points: 3,
    config: {
      pairs: [
        { id: 'p1', left: 'Hund', right: { kind: 'image', assetId: 'a1', alt: 'Foto' } },
        { id: 'p2', left: { kind: 'audio', assetId: 'a2' }, right: 'bellt' },
      ],
    },
  });
  assert.deepEqual(validateItem(item), []);
  assert.equal(item.config.pairs[0].left.kind, 'text');
  assert.equal(item.config.pairs[0].right.kind, 'image');
  assert.equal(item.config.pairs[1].left.kind, 'audio');

  const noAsset = normalizeItem({
    id: 'm2',
    type: 'match',
    config: { pairs: [{ id: 'p1', left: { kind: 'image', assetId: '', alt: '' }, right: 'x' }, { id: 'p2', left: 'a', right: 'b' }] },
  });
  assert.ok(validateItem(noAsset).some((e) => e.includes('assetId')));
});

test('match: sanitize emits lefts/rights with media kinds and never leaks pair structure', () => {
  const item = normalizeItem({
    id: 'm3',
    type: 'match',
    points: 2,
    config: {
      pairs: [
        { id: 'p1', left: 'Hund', right: { kind: 'image', assetId: 'a1', alt: 'Foto' } },
        { id: 'p2', left: { kind: 'audio', assetId: 'a2' }, right: 'bellt' },
      ],
    },
  });
  const safe = sanitizeItem(item);
  assert.ok(Array.isArray(safe.config.lefts));
  assert.ok(Array.isArray(safe.config.rights));
  assert.deepEqual(safe.config.lefts.map((s) => s.kind), ['text', 'audio']);
  assert.deepEqual(safe.config.rights.map((s) => s.kind).sort(), ['image', 'text']);
  // right side is shuffled deterministically per item id
  const safeAgain = sanitizeItem(item);
  assert.deepEqual(safeAgain.config.rights, safe.config.rights);
  // scoring still works on the normalized item
  const result = scoreItem(item,getType(item.type).normalizeResponse(item, { matches: { p1: 'p1', p2: 'p2' } }));
  assert.equal(result.correct, true);
  assert.equal(result.autoScore, 2);
});
