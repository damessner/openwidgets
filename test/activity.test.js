// Unit tests for shared/activity.js — defaults, normalization, validation,
// sanitization and statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityStats,
  createDefinition,
  defaultSettings,
  emptyDefinition,
  normalizeActivity,
  normalizeSettings,
  sanitizeActivity,
  validateActivity,
} from '../shared/activity.js';
import { createItem, normalizeItem } from '../shared/items/index.js';

const SECRET = 'SENTINEL_ACTIVITY_ANSWER';

test('createDefinition / emptyDefinition provide the contract document', () => {
  const def = createDefinition({ template: 'quiz', locale: 'en', title: 'Titel' });
  assert.equal(def.v, 1);
  assert.equal(def.template, 'quiz');
  assert.equal(def.locale, 'en');
  assert.equal(def.title, 'Titel');
  assert.equal(def.description, '');
  assert.deepEqual(def.items, []);
  assert.deepEqual(def.settings, defaultSettings());
  assert.equal(def.settings.timeLimitMinutes, null);
  assert.equal(def.settings.accessibility.tts, true);

  const empty = emptyDefinition();
  assert.equal(empty.template, 'worksheet');
  assert.equal(empty.locale, 'de');
  assert.equal(empty.title, '');
});

test('normalizeSettings coerces safely', () => {
  const settings = normalizeSettings({
    instantFeedback: false,
    timeLimitMinutes: 30,
    requireName: 'nope',
    accessibility: { tts: false },
    extra: 'ignored',
  });
  assert.equal(settings.instantFeedback, false);
  assert.equal(settings.timeLimitMinutes, 30);
  assert.equal(settings.requireName, true);
  assert.equal(settings.accessibility.tts, false);
  assert.equal(settings.accessibility.starQuestions, true);
  assert.equal('extra' in settings, false);
  assert.equal(normalizeSettings({ timeLimitMinutes: -5 }).timeLimitMinutes, null);
  assert.equal(normalizeSettings({ timeLimitMinutes: 9999 }).timeLimitMinutes, 600);
});

test('normalizeActivity fills fields and normalizes items', () => {
  const normalized = normalizeActivity({
    template: 'quiz',
    title: 'X',
    settings: { showResults: false },
    items: [{ type: 'multiple_choice', config: {} }],
  });
  assert.equal(normalized.v, 1);
  assert.equal(normalized.template, 'quiz');
  assert.equal(normalized.settings.showResults, false);
  assert.equal(normalized.items.length, 1);
  assert.match(normalized.items[0].id, /^it_/);
  assert.equal(normalized.items[0].type, 'multiple_choice');
  assert.equal(normalizeActivity(null).items.length, 0);
  assert.equal(normalizeActivity('nonsense').template, 'worksheet');
});

test('validateActivity accepts a realistic full definition', () => {
  const def = createDefinition({ title: 'Plattentektonik' });
  def.items = [
    createItem('text'),
    createItem('multiple_choice'),
    createItem('short_answer'),
    createItem('numeric'),
    createItem('fill_blanks'),
    createItem('match'),
    createItem('ordering'),
    createItem('pins'),
    createItem('long_answer'),
  ];
  const result = validateActivity(def);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('validateActivity reports structural and item errors with paths', () => {
  const bad = {
    v: 2,
    template: 'nope',
    locale: 'fr',
    items: [
      { id: 'dup', type: 'unknown_type', points: 1 },
      {
        id: 'dup',
        type: 'multiple_choice',
        points: 5000,
        config: { choices: [{ id: 'c1', text: 'a', correct: false }] },
      },
    ],
  };
  const result = validateActivity(bad);
  assert.equal(result.ok, false);
  const paths = result.errors.map((error) => error.path);
  assert.ok(paths.includes('v'));
  assert.ok(paths.includes('template'));
  assert.ok(paths.includes('locale'));
  assert.ok(result.errors.some((error) => error.path.startsWith('items[0].type')));
  assert.ok(result.errors.some((error) => error.path === 'items[1].points'));
  assert.ok(result.errors.some((error) => error.path === 'items[1].config.choices'));
  assert.ok(result.errors.some((error) => error.path === 'items[1].id'));
});

test('validateActivity rejects duplicate item ids and non-array items', () => {
  const item = createItem('multiple_choice');
  const duplicated = { ...createDefinition(), items: [item, { ...item }] };
  const duplicateResult = validateActivity(duplicated);
  assert.ok(duplicateResult.errors.some((error) => error.message.includes('duplicate item id')));

  const notArray = validateActivity({ ...createDefinition(), items: 'nope' });
  assert.ok(notArray.errors.some((error) => error.path === 'items'));
});

test('activityStats counts scoreable items and ignores text blocks', () => {
  const def = createDefinition();
  def.items = [
    createItem('text'),
    normalizeItem({ id: 'it_a', type: 'multiple_choice', points: 2 }),
    normalizeItem({ id: 'it_b', type: 'numeric', points: 1.5 }),
    normalizeItem({ id: 'it_c', type: 'long_answer', points: 5 }),
  ];
  const stats = activityStats(def);
  assert.equal(stats.itemCount, 4);
  assert.equal(stats.scoreableCount, 3);
  assert.equal(stats.maxScore, 8.5);
});

test('sanitizeActivity strips answers from every item', () => {
  const def = createDefinition({ title: 'Test' });
  def.items = [
    normalizeItem({ id: 'it_sa', type: 'short_answer', config: { accepted: [SECRET] } }),
    normalizeItem({ id: 'it_num', type: 'numeric', config: { answer: 1234 } }),
    normalizeItem({
      id: 'it_fb',
      type: 'fill_blanks',
      config: { text: '{{1}}', blanks: { 1: { accepted: [SECRET] } } },
    }),
    normalizeItem({ id: 'it_la', type: 'long_answer', config: { hints: [{ text: SECRET, points: 1 }] } }),
  ];
  def.settings.showAnswers = true;
  def.settings.timeLimitMinutes = 10;
  const sanitized = sanitizeActivity(def);
  const json = JSON.stringify(sanitized);
  assert.ok(!json.includes(SECRET));
  assert.ok(!json.includes('"accepted"'));
  assert.ok(!json.includes('"hints"'));
  assert.equal(sanitized.settings.showAnswers, true, 'settings themselves are safe to share');
  assert.equal(sanitized.settings.timeLimitMinutes, 10);
  assert.equal(sanitized.items.length, 4);
  assert.equal(sanitized.items[0].type, 'short_answer');
  // sanitizeActivity returns a deep copy: mutating it must not touch the source
  sanitized.settings.showResults = false;
  assert.equal(def.settings.showResults, true);
});
