// Unit tests for shared/util.js (Lead-owned module, exercised through our code).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  deepClone,
  eqScore,
  hashString,
  normalizeText,
  parseLocalizedNumber,
  seededShuffle,
  shortId,
} from '../shared/util.js';

test('normalizeText applies the configured normalization', () => {
  assert.equal(normalizeText('  Hello   World  '), 'hello world');
  assert.equal(normalizeText('  Hello   World  ', { caseSensitive: true }), 'Hello World');
  assert.equal(normalizeText('Transform-Rand!', { ignorePunctuation: true }), 'transformrand');
  assert.equal(normalizeText('a   b', { collapseSpaces: false }), 'a   b');
  assert.equal(normalizeText('a   b', { trim: false, collapseSpaces: false }), 'a   b');
});

test('parseLocalizedNumber handles German and English formats', () => {
  assert.equal(parseLocalizedNumber('3,5'), 3.5);
  assert.equal(parseLocalizedNumber('3.5'), 3.5);
  assert.equal(parseLocalizedNumber('1.234,5'), 1234.5);
  assert.equal(parseLocalizedNumber('1,234.5'), 1234.5);
  assert.equal(parseLocalizedNumber('4.2e3'), 4200);
  assert.equal(parseLocalizedNumber('€ 12,50'), 12.5);
  assert.equal(parseLocalizedNumber('  -7 '), -7);
  assert.equal(parseLocalizedNumber('1,234'), 1234);
  assert.equal(parseLocalizedNumber('12 km'), 12);
  assert.equal(parseLocalizedNumber(''), null);
  assert.equal(parseLocalizedNumber('keine Zahl'), null);
  assert.equal(parseLocalizedNumber(null), null);
});

test('seededShuffle is deterministic and keeps all elements', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = seededShuffle(input, 'seed-a');
  const b = seededShuffle(input, 'seed-a');
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], 'input must not be mutated');
});

test('hashString is stable and differs between strings', () => {
  assert.equal(hashString('openwidgets'), hashString('openwidgets'));
  assert.notEqual(hashString('openwidgets'), hashString('openwidget'));
  assert.ok(Number.isInteger(hashString('x')));
});

test('clamp / eqScore / deepClone / shortId basics', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp('nope', 2, 3), 2);
  assert.ok(eqScore(1, 1 + 1e-12));
  assert.ok(!eqScore(1, 1.001));
  const source = { a: { b: [1, 2] } };
  const clone = deepClone(source);
  clone.a.b.push(3);
  assert.deepEqual(source.a.b, [1, 2]);
  assert.match(shortId('it'), /^it_[0-9a-z]{6}$/);
  assert.match(shortId(), /^id_[0-9a-z]{6}$/);
});
