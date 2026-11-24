// Classes API — bundles of published assignments ("Klassen"/Lernpfade).
//   teacher: CRUD + item ordering + publish (join code)
//   student: join by class code, lobby with per-item lock state
// Unlock rules live in shared/classes.js (unit-tested); enforcement for
// assignment joins happens in participant.js via the helpers exported here.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, now, one, run, tx, uid } from '../db.js';
import { requireUser } from '../lib/auth.js';
import {
  assertSameOrigin,
  badRequest,
  clientIp,
  conflict,
  HttpError,
  json,
  noContent,
  notFound,
  rateLimited,
  readJson,
} from '../lib/http.js';
import { assertCanAccess, roundScore, tokenHash, newParticipantToken } from './_helpers.js';
import { CLASS_LIMITS, computeItemStates, firstBlockingPosition, validateClass } from '../../shared/classes.js';

const MAX_BODY_BYTES = 64 * 1024;
const CLASS_JOIN_LIMIT_PER_IP = 30;
const CLASS_RATE_WINDOW_MS = 60000;
const classJoinWindows = new Map();

function checkClassJoinRateLimit(req) {
  const ip = clientIp(req, config.trustProxy) || 'unknown';
  const nowMs = Date.now();
  const entry = classJoinWindows.get(ip);
  if (classJoinWindows.size > 5000) {
    for (const [key, value] of classJoinWindows) if (value.resetAt < nowMs) classJoinWindows.delete(key);
  }
  if (!entry || entry.resetAt < nowMs) {
    classJoinWindows.set(ip, { count: 1, resetAt: nowMs + CLASS_RATE_WINDOW_MS });
    return;
  }
  if (entry.count >= CLASS_JOIN_LIMIT_PER_IP) throw rateLimited();
  entry.count += 1;
}

function readJsonSafe(req) {
  return readJson(req, MAX_BODY_BYTES);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

/** 6 chars, uppercase, no I/O/0/1, unique across classes. */
export function generateClassCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = randomCode();
    if (!one('SELECT id FROM classes WHERE code = ?', code)) return code;
  }
  throw new HttpError(500, 'internal_error', 'Could not generate a class code');
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function classListItem(row) {
  const itemCount = one('SELECT COUNT(*) AS c FROM class_items WHERE class_id = ?', row.id);
  const participantCount = one('SELECT COUNT(*) AS c FROM class_participants WHERE class_id = ?', row.id);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    orderMode: row.order_mode,
    unlockMinPercent: Number(row.unlock_min_percent) || 0,
    status: row.status,
    itemCount: itemCount ? itemCount.c : 0,
    participantCount: participantCount ? participantCount.c : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemRowsFor(classId) {
  return all(
    `SELECT ci.id AS item_id, ci.position, s.id AS assignment_id, s.code AS assignment_code, s.title AS assignment_title,
            s.status AS assignment_status, a.title AS activity_title, a.template AS template, a.locale AS locale,
            (SELECT COUNT(*) FROM participants p WHERE p.assignment_id = s.id) AS participant_count
     FROM class_items ci JOIN assignments s ON s.id = ci.assignment_id LEFT JOIN activities a ON a.id = s.activity_id
     WHERE ci.class_id = ? ORDER BY ci.position ASC`,
    classId,
  );
}

function classDetail(row) {
  return {
    ...classListItem(row),
    items: itemRowsFor(row.id).map((item) => ({
      id: item.item_id,
      position: item.position,
      assignmentId: item.assignment_id,
      code: item.assignment_code,
      title: item.assignment_title,
      activityTitle: item.activity_title,
      template: item.template,
      status: item.assignment_status,
      participantCount: Number(item.participant_count) || 0,
    })),
  };
}

/** Student-facing payload: item states for one class participant. */
function classStudentPayload(classRow, participantRows) {
  const items = all('SELECT * FROM class_items WHERE class_id = ? ORDER BY position ASC', classRow.id);
  const meta = itemRowsFor(classRow.id);
  const metaByAssignment = new Map(meta.map((row) => [row.assignment_id, row]));
  const states = computeItemStates(classRow, items, participantRows);
  // For locked items: the first previous position that still blocks the chain.
  let firstNotPassed = null;
  for (const state of states) {
    if (!state.passed && firstNotPassed === null) firstNotPassed = state.position;
  }
  return {
    code: classRow.code,
    name: classRow.name,
    description: classRow.description,
    orderMode: classRow.order_mode,
    unlockMinPercent: Number(classRow.unlock_min_percent) || 0,
    status: classRow.status,
    items: states.map((state) => {
      const m = metaByAssignment.get(state.assignmentId) || {};
      return {
        position: state.position,
        assignmentId: state.assignmentId,
        title: m.assignment_title || m.activity_title || '',
        template: m.template || 'worksheet',
        state: state.state,
        status: state.status,
        score: roundScore(state.score),
        maxScore: roundScore(state.maxScore),
        blockedBy: state.state === 'locked' ? firstNotPassed : null,
        // Locked items must not leak their assignment code.
        code: state.state === 'locked' ? null : m.assignment_code || null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function requireClassRow(id) {
  const row = one('SELECT * FROM classes WHERE id = ?', String(id));
  if (!row) throw notFound('class_not_found');
  return row;
}

function requireOwnedClass(req, id) {
  const row = requireClassRow(id);
  assertCanAccess(req.user, row);
  return row;
}

function findClassByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  return one('SELECT * FROM classes WHERE code = ?', normalized);
}

// ---------------------------------------------------------------------------
// Unlock enforcement (used by participant.js when joining an assignment)
// ---------------------------------------------------------------------------

/** Published sequence-mode classes that contain this assignment. */
export function sequenceClassesForAssignment(assignmentId) {
  return all(
    `SELECT c.* FROM classes c JOIN class_items ci ON ci.class_id = c.id
     WHERE ci.assignment_id = ? AND c.order_mode = 'sequence' AND c.status = 'published'`,
    String(assignmentId),
  );
}

export function classParticipantByToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.trim().length < 16) return null;
  return one('SELECT * FROM class_participants WHERE token_hash = ?', tokenHash(rawToken.trim()));
}

/**
 * Throws 403 class_required / 409 item_locked when the assignment may not be
 * joined directly. Returns the class_participants row on success.
 */
export function enforceClassUnlock(assignmentRow, classToken) {
  const seqClasses = sequenceClassesForAssignment(assignmentRow.id);
  if (seqClasses.length === 0) return null;
  const cp = classParticipantByToken(classToken);
  if (!cp || !seqClasses.some((row) => row.id === cp.class_id)) {
    throw new HttpError(403, 'class_required', 'This assignment is part of a class — join it through the class link', {
      classCode: seqClasses[0].code,
    });
  }
  const classRow = one('SELECT * FROM classes WHERE id = ?', cp.class_id);
  const items = all('SELECT * FROM class_items WHERE class_id = ? ORDER BY position ASC', classRow.id);
  const rows = all('SELECT * FROM participants WHERE class_participant_id = ?', cp.id);
  const states = computeItemStates(classRow, items, rows);
  const target = states.find((state) => state.assignmentId === assignmentRow.id);
  if (!target) {
    throw new HttpError(403, 'not_in_class', 'This assignment is not part of the class');
  }
  if (target.state === 'locked') {
    throw new HttpError(409, 'item_locked', 'Finish the previous assignments first', {
      position: target.position,
      blockingPosition: firstBlockingPosition(classRow, items, rows),
      classCode: classRow.code,
    });
  }
  return cp;
}

/** Class link info for a participant row (student payloads). */
export function classLinkForParticipant(participantRow) {
  if (!participantRow || !participantRow.class_participant_id) return null;
  const cp = one('SELECT * FROM class_participants WHERE id = ?', participantRow.class_participant_id);
  if (!cp) return null;
  const cls = one('SELECT * FROM classes WHERE id = ?', cp.class_id);
  if (!cls) return null;
  return { id: cls.id, code: cls.code, name: cls.name, orderMode: cls.order_mode };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function register(router) {
  // -------------------------------------------------------------------------
  // Teacher: list
  // -------------------------------------------------------------------------
  router.get('/api/classes', async (req, res) => {
    const user = requireUser(req);
    const rows =
      user.role === 'admin'
        ? all('SELECT * FROM classes ORDER BY updated_at DESC')
        : all('SELECT * FROM classes WHERE owner_id = ? ORDER BY updated_at DESC', user.id);
    json(res, 200, { classes: rows.map(classListItem) });
  });

  // -------------------------------------------------------------------------
  // Teacher: create (draft)
  // -------------------------------------------------------------------------
  router.post('/api/classes', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const body = await readJsonSafe(req);
    const check = validateClass(body);
    if (!check.ok) throw badRequest('invalid_class', 'Invalid class data', check.errors);
    const id = uid();
    const timestamp = now();
    run(
      `INSERT INTO classes (id, owner_id, code, name, description, order_mode, unlock_min_percent, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id,
      user.id,
      null,
      check.value.name,
      check.value.description,
      check.value.orderMode,
      check.value.unlockMinPercent,
      'draft',
      timestamp,
      timestamp,
    );
    json(res, 201, { class: classListItem(one('SELECT * FROM classes WHERE id = ?', id)) });
  });

  // -------------------------------------------------------------------------
  // Teacher: detail
  // -------------------------------------------------------------------------
  router.get('/api/classes/:id', async (req, res, params) => {
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    json(res, 200, { class: classDetail(row) });
  });

  // -------------------------------------------------------------------------
  // Teacher: update fields
  // -------------------------------------------------------------------------
  router.put('/api/classes/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const body = await readJsonSafe(req);
    const check = validateClass({ ...row, name: body.name ?? row.name, description: body.description ?? row.description, orderMode: body.orderMode ?? row.order_mode, unlockMinPercent: body.unlockMinPercent ?? row.unlock_min_percent });
    if (!check.ok) throw badRequest('invalid_class', 'Invalid class data', check.errors);
    run(
      'UPDATE classes SET name = ?, description = ?, order_mode = ?, unlock_min_percent = ?, updated_at = ? WHERE id = ?',
      check.value.name,
      check.value.description,
      check.value.orderMode,
      check.value.unlockMinPercent,
      now(),
      row.id,
    );
    json(res, 200, { class: classDetail(one('SELECT * FROM classes WHERE id = ?', row.id)) });
  });

  // -------------------------------------------------------------------------
  // Teacher: delete
  // -------------------------------------------------------------------------
  router.delete('/api/classes/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    tx(() => {
      run('UPDATE participants SET class_participant_id = NULL WHERE class_participant_id IN (SELECT id FROM class_participants WHERE class_id = ?)', row.id);
      run('DELETE FROM classes WHERE id = ?', row.id);
    });
    noContent(res);
  });

  // -------------------------------------------------------------------------
  // Teacher: replace ordered items
  // -------------------------------------------------------------------------
  router.put('/api/classes/:id/items', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const body = await readJsonSafe(req);
    if (!Array.isArray(body.assignmentIds)) throw badRequest('invalid_items', 'assignmentIds must be an array');
    if (body.assignmentIds.length > CLASS_LIMITS.maxItems) throw badRequest('too_many_items', `At most ${CLASS_LIMITS.maxItems} items per class`);
    const ids = body.assignmentIds.map((value) => String(value));
    if (new Set(ids).size !== ids.length) throw badRequest('duplicate_items', 'Each assignment may appear only once');
    for (const assignmentId of ids) {
      const assignment = one('SELECT * FROM assignments WHERE id = ?', assignmentId);
      if (!assignment) throw notFound('assignment_not_found');
      assertCanAccess(user, assignment);
    }
    tx(() => {
      run('DELETE FROM class_items WHERE class_id = ?', row.id);
      ids.forEach((assignmentId, index) => {
        run('INSERT INTO class_items (id, class_id, assignment_id, position) VALUES (?,?,?,?)', uid(), row.id, assignmentId, index + 1);
      });
      run('UPDATE classes SET updated_at = ? WHERE id = ?', now(), row.id);
    });
    json(res, 200, { class: classDetail(one('SELECT * FROM classes WHERE id = ?', row.id)) });
  });

  // -------------------------------------------------------------------------
  // Teacher: publish / unpublish (join code)
  // -------------------------------------------------------------------------
  router.post('/api/classes/:id/publish', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const itemCount = one('SELECT COUNT(*) AS c FROM class_items WHERE class_id = ?', row.id);
    if (!itemCount || itemCount.c === 0) throw conflict('class_empty', 'Add at least one assignment before publishing');
    const code = row.code || generateClassCode();
    run("UPDATE classes SET status = 'published', code = ?, updated_at = ? WHERE id = ?", code, now(), row.id);
    const fresh = one('SELECT * FROM classes WHERE id = ?', row.id);
    json(res, 200, {
      class: classDetail(fresh),
      url: `${config.baseUrl || ''}/c/${code}`,
    });
  });

  router.post('/api/classes/:id/unpublish', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    run("UPDATE classes SET status = 'draft', updated_at = ? WHERE id = ?", now(), row.id);
    json(res, 200, { class: classDetail(one('SELECT * FROM classes WHERE id = ?', row.id)) });
  });

  // -------------------------------------------------------------------------
  // Student: public join info
  // -------------------------------------------------------------------------
  router.get('/api/classes/join/:code', async (req, res, params) => {
    const cls = findClassByCode(params.code);
    if (!cls || cls.status !== 'published') throw notFound('invalid_code');
    const itemCount = one('SELECT COUNT(*) AS c FROM class_items WHERE class_id = ?', cls.id);
    json(res, 200, {
      class: {
        code: cls.code,
        name: cls.name,
        description: cls.description,
        orderMode: cls.order_mode,
        unlockMinPercent: Number(cls.unlock_min_percent) || 0,
        itemCount: itemCount ? itemCount.c : 0,
      },
    });
  });

  // -------------------------------------------------------------------------
  // Student: join a class (creates a class participant)
  // -------------------------------------------------------------------------
  router.post('/api/classes/join', async (req, res) => {
    assertSameOrigin(req);
    checkClassJoinRateLimit(req);
    const body = await readJsonSafe(req);
    const cls = findClassByCode(body.code);
    if (!cls || cls.status !== 'published') throw notFound('invalid_code');

    let name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw badRequest('name_required', 'Please enter your name');
    if (name.length > 80) throw badRequest('invalid_name', 'Name must be at most 80 characters');

    const rawToken = newParticipantToken();
    const id = uid();
    const timestamp = now();
    run(
      'INSERT INTO class_participants (id, class_id, name, token_hash, created_at, last_seen_at) VALUES (?,?,?,?,?,?)',
      id,
      cls.id,
      name,
      tokenHash(rawToken),
      timestamp,
      timestamp,
    );
    const cp = one('SELECT * FROM class_participants WHERE id = ?', id);
    json(res, 200, {
      classToken: rawToken,
      class: classStudentPayload(cls, []),
      participant: { id: cp.id, name: cp.name },
    });
  });

  // -------------------------------------------------------------------------
  // Student: resume class lobby
  // -------------------------------------------------------------------------
  router.get('/api/classes/:code/participant', async (req, res, params) => {
    const cls = findClassByCode(params.code);
    if (!cls || cls.status !== 'published') throw notFound('invalid_code');
    const header = req.headers['x-class-token'];
    const token = Array.isArray(header) ? header[0] : header;
    const cp = classParticipantByToken(token);
    if (!cp || cp.class_id !== cls.id) {
      throw new HttpError(401, 'invalid_class_token', 'A valid class token is required');
    }
    run('UPDATE class_participants SET last_seen_at = ? WHERE id = ?', now(), cp.id);
    const rows = all('SELECT * FROM participants WHERE class_participant_id = ?', cp.id);
    json(res, 200, {
      class: classStudentPayload(cls, rows),
      participant: { id: cp.id, name: cp.name },
    });
  });
}
