// Shared "class" (bundle of assignments) logic — pure functions, no I/O.
// Used by the server (API + unlock enforcement) and covered by unit tests.
//
// A class bundles published assignments in a fixed order. orderMode:
//   - 'free'     : every assignment is open immediately, any order
//   - 'sequence' : an assignment unlocks only when all previous items are done
//                  ("done" = submitted/graded; when unlockMinPercent > 0 the
//                  previous item must also reach that score percentage)
export const ORDER_MODES = ['free', 'sequence'];

export const CLASS_LIMITS = {
  nameMax: 120,
  descriptionMax: 2000,
  maxItems: 50,
  maxCourses: 50,
  courseTitleMax: 120,
  courseDescriptionMax: 500,
};

export function normalizeUnlockMinPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 10) / 10);
}

/** Validate + normalize class fields from a client payload. */
export function validateClass(input) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) errors.push('name_required');
  else if (name.length > CLASS_LIMITS.nameMax) errors.push('name_too_long');
  const description = typeof source.description === 'string' ? source.description.trim() : '';
  if (description.length > CLASS_LIMITS.descriptionMax) errors.push('description_too_long');
  const orderMode = ORDER_MODES.includes(source.orderMode) ? source.orderMode : 'free';
  if (!ORDER_MODES.includes(source.orderMode) && source.orderMode !== undefined) errors.push('invalid_order_mode');
  const unlockMinPercent = normalizeUnlockMinPercent(source.unlockMinPercent);
  if (source.unlockMinPercent !== undefined && (Number.isNaN(Number(source.unlockMinPercent)) || Number(source.unlockMinPercent) < 0 || Number(source.unlockMinPercent) > 100)) {
    errors.push('invalid_unlock_min_percent');
  }
  return {
    ok: errors.length === 0,
    errors,
    value: { name, description, orderMode, unlockMinPercent },
  };
}

/**
 * Compute the per-item state for one class participant.
 *
 * @param classRow  classes row (order_mode, unlock_min_percent)
 * @param items     class_items rows ({id, assignment_id, position, ...})
 * @param participantRows  participants rows linked via class_participant_id
 * @returns array in position order: { itemId, assignmentId, position, state,
 *   status, score, maxScore, passed, unlocked }
 *   state: 'done' (submitted/graded) | 'open' | 'locked'
 */
export function computeItemStates(classRow, items, participantRows) {
  const sorted = [...(items || [])].sort((a, b) => Number(a.position) - Number(b.position));
  const byAssignment = new Map();
  const rank = (row) => (row.status === 'graded' ? 3 : row.status === 'submitted' ? 2 : 1);
  for (const row of participantRows || []) {
    const existing = byAssignment.get(row.assignment_id);
    if (!existing || rank(row) > rank(existing)) byAssignment.set(row.assignment_id, row);
  }
  const minPercent = normalizeUnlockMinPercent(classRow && classRow.unlock_min_percent);
  const sequence = classRow && classRow.order_mode === 'sequence';

  let previousPassed = true;
  return sorted.map((item) => {
    const row = byAssignment.get(item.assignment_id) || null;
    const submitted = !!row && (row.status === 'submitted' || row.status === 'graded');
    const score = row ? Number(row.score) || 0 : 0;
    const maxScore = row ? Number(row.max_score) || 0 : 0;
    const percent = maxScore > 0 ? (score / maxScore) * 100 : 100;
    const passed = submitted && (minPercent <= 0 || maxScore <= 0 || percent >= minPercent - 1e-9);

    let state;
    if (submitted) state = 'done';
    else if (sequence && !previousPassed) state = 'locked';
    else state = 'open';

    const result = {
      itemId: item.id,
      assignmentId: item.assignment_id,
      position: Number(item.position),
      state,
      status: row ? row.status : 'not_started',
      score,
      maxScore,
      passed,
      unlocked: state !== 'locked',
    };
    if (!passed) previousPassed = false;
    return result;
  });
}

/** True when the given assignment is currently unlocked for this class participant. */
export function isAssignmentUnlocked(classRow, items, participantRows, assignmentId) {
  const states = computeItemStates(classRow, items, participantRows);
  const target = states.find((state) => state.assignmentId === assignmentId);
  return target ? target.unlocked : false;
}

/**
 * Position of the first item that still blocks the chain (not yet passed) —
 * for error details / UI hints. Null when everything is passed.
 */
export function firstBlockingPosition(classRow, items, participantRows) {
  const states = computeItemStates(classRow, items, participantRows);
  const unpassed = states.find((state) => !state.passed);
  return unpassed ? unpassed.position : null;
}
