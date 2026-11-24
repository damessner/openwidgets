// Unit tests for the shared class-bundle logic (shared/classes.js):
// validation + per-item lock/unlock states for 'free' and 'sequence' classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_LIMITS,
  computeItemStates,
  firstBlockingPosition,
  isAssignmentUnlocked,
  normalizeUnlockMinPercent,
  validateClass,
} from '../shared/classes.js';

const classRow = (overrides = {}) => ({
  id: 'cls1',
  order_mode: 'sequence',
  unlock_min_percent: 0,
  ...overrides,
});

const item = (position, assignmentId) => ({
  id: `ci${position}`,
  class_id: 'cls1',
  assignment_id: assignmentId,
  position,
});

const participantRow = (assignmentId, overrides = {}) => ({
  id: `p-${assignmentId}`,
  assignment_id: assignmentId,
  status: 'submitted',
  score: 2,
  max_score: 2,
  ...overrides,
});

// ---------------------------------------------------------------------------
// validateClass
// ---------------------------------------------------------------------------

test('validateClass: minimal valid input normalizes to free/0', () => {
  const check = validateClass({ name: '  3a Mathe  ' });
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, { name: '3a Mathe', description: '', orderMode: 'free', unlockMinPercent: 0 });
});

test('validateClass: name is required and length-capped', () => {
  assert.equal(validateClass({}).ok, false);
  assert.equal(validateClass({ name: '   ' }).ok, false);
  assert.ok(validateClass({ name: 'x'.repeat(CLASS_LIMITS.nameMax + 1) }).errors.includes('name_too_long'));
  assert.equal(validateClass({ name: 'x'.repeat(CLASS_LIMITS.nameMax) }).ok, true);
});

test('validateClass: order mode + unlock percent validation', () => {
  assert.ok(validateClass({ name: 'A', orderMode: 'bogus' }).errors.includes('invalid_order_mode'));
  assert.equal(validateClass({ name: 'A', orderMode: 'sequence', unlockMinPercent: 50 }).value.orderMode, 'sequence');
  assert.ok(validateClass({ name: 'A', unlockMinPercent: -5 }).errors.includes('invalid_unlock_min_percent'));
  assert.ok(validateClass({ name: 'A', unlockMinPercent: 101 }).errors.includes('invalid_unlock_min_percent'));
  assert.ok(validateClass({ name: 'A', unlockMinPercent: 'abc' }).errors.includes('invalid_unlock_min_percent'));
});

test('normalizeUnlockMinPercent: clamps and rounds', () => {
  assert.equal(normalizeUnlockMinPercent(undefined), 0);
  assert.equal(normalizeUnlockMinPercent(-3), 0);
  assert.equal(normalizeUnlockMinPercent(0), 0);
  assert.equal(normalizeUnlockMinPercent(55), 55);
  assert.equal(normalizeUnlockMinPercent(250), 100);
  assert.equal(normalizeUnlockMinPercent(33.333), 33.3);
});

// ---------------------------------------------------------------------------
// computeItemStates — free mode
// ---------------------------------------------------------------------------

test('free mode: every item is open regardless of progress', () => {
  const items = [item(1, 'a1'), item(2, 'a2'), item(3, 'a3')];
  const states = computeItemStates(classRow({ order_mode: 'free' }), items, []);
  assert.deepEqual(states.map((s) => s.state), ['open', 'open', 'open']);
  assert.deepEqual(states.map((s) => s.position), [1, 2, 3]);
});

test('free mode: submitted item is done with score', () => {
  const items = [item(1, 'a1'), item(2, 'a2')];
  const states = computeItemStates(classRow({ order_mode: 'free' }), items, [participantRow('a2')]);
  assert.equal(states[1].state, 'done');
  assert.equal(states[1].score, 2);
  assert.equal(states[1].maxScore, 2);
  assert.equal(states[0].state, 'open');
});

// ---------------------------------------------------------------------------
// computeItemStates — sequence mode
// ---------------------------------------------------------------------------

test('sequence mode: first item open, rest locked until previous submitted', () => {
  const items = [item(1, 'a1'), item(2, 'a2'), item(3, 'a3')];
  const empty = computeItemStates(classRow(), items, []);
  assert.deepEqual(empty.map((s) => s.state), ['open', 'locked', 'locked']);

  const oneDone = computeItemStates(classRow(), items, [participantRow('a1')]);
  assert.deepEqual(oneDone.map((s) => s.state), ['done', 'open', 'locked']);

  const twoDone = computeItemStates(classRow(), items, [participantRow('a1'), participantRow('a2')]);
  assert.deepEqual(twoDone.map((s) => s.state), ['done', 'done', 'open']);
});

test('sequence mode: unsorted items are processed in position order', () => {
  const items = [item(3, 'a3'), item(1, 'a1'), item(2, 'a2')];
  const states = computeItemStates(classRow(), items, []);
  assert.deepEqual(states.map((s) => [s.position, s.state]), [[1, 'open'], [2, 'locked'], [3, 'locked']]);
});

test('sequence mode: min percent gates the next item', () => {
  const cls = classRow({ unlock_min_percent: 100 });
  const items = [item(1, 'a1'), item(2, 'a2')];

  // 50% < 100% → next stays locked even though submitted
  const low = computeItemStates(cls, items, [participantRow('a1', { score: 1, max_score: 2 })]);
  assert.equal(low[0].state, 'done');
  assert.equal(low[0].passed, false);
  assert.equal(low[1].state, 'locked');

  // 100% → next opens
  const full = computeItemStates(cls, items, [participantRow('a1', { score: 2, max_score: 2 })]);
  assert.equal(full[1].state, 'open');

  // maxScore = 0 (unscored) counts as passed
  const unscored = computeItemStates(cls, items, [participantRow('a1', { score: 0, max_score: 0 })]);
  assert.equal(unscored[0].passed, true);
  assert.equal(unscored[1].state, 'open');
});

test('sequence mode: in_progress (not submitted) does not unlock the next', () => {
  const items = [item(1, 'a1'), item(2, 'a2')];
  const states = computeItemStates(classRow(), items, [participantRow('a1', { status: 'in_progress', score: 0 })]);
  assert.equal(states[0].state, 'open');
  assert.equal(states[1].state, 'locked');
});

test('graded ranks above submitted for the same assignment', () => {
  const items = [item(1, 'a1'), item(2, 'a2')];
  const rows = [
    participantRow('a1', { id: 'p-old', status: 'submitted', score: 0, max_score: 2 }),
    participantRow('a1', { id: 'p-new', status: 'graded', score: 2, max_score: 2 }),
  ];
  const states = computeItemStates(classRow({ unlock_min_percent: 100 }), items, rows);
  assert.equal(states[0].score, 2);
  assert.equal(states[1].state, 'open');
});

// ---------------------------------------------------------------------------
// firstBlockingPosition / isAssignmentUnlocked
// ---------------------------------------------------------------------------

test('firstBlockingPosition returns the first not-passed position', () => {
  const items = [item(1, 'a1'), item(2, 'a2'), item(3, 'a3')];
  assert.equal(firstBlockingPosition(classRow(), items, []), 1);
  assert.equal(firstBlockingPosition(classRow(), items, [participantRow('a1')]), 2);
  assert.equal(firstBlockingPosition(classRow(), items, [participantRow('a1'), participantRow('a2'), participantRow('a3')]), null);
});

test('firstBlockingPosition reports a done-but-failed item below threshold', () => {
  const cls = classRow({ unlock_min_percent: 100 });
  const items = [item(1, 'a1'), item(2, 'a2')];
  assert.equal(firstBlockingPosition(cls, items, [participantRow('a1', { score: 0, max_score: 2 })]), 1);
});

test('isAssignmentUnlocked mirrors computeItemStates', () => {
  const items = [item(1, 'a1'), item(2, 'a2')];
  assert.equal(isAssignmentUnlocked(classRow(), items, [], 'a1'), true);
  assert.equal(isAssignmentUnlocked(classRow(), items, [], 'a2'), false);
  assert.equal(isAssignmentUnlocked(classRow(), items, [participantRow('a1')], 'a2'), true);
  assert.equal(isAssignmentUnlocked(classRow({ order_mode: 'free' }), items, [], 'a2'), true);
  assert.equal(isAssignmentUnlocked(classRow(), items, [], 'nope'), false);
});
