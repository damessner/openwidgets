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
import {
  createStudent,
  findStudentByName,
  generatePassword,
  getStudent,
  normalizeStudentName,
  requireStudent,
  studentPublic,
} from '../lib/students.js';
import { hashPassword } from '../lib/auth.js';

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
  const assignmentIds = all('SELECT assignment_id FROM class_items WHERE class_id = ? ORDER BY position ASC', row.id).map(
    (r) => r.assignment_id,
  );
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
    assignmentIds,
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

export function requireOwnedClass(req, id) {
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
  return enforceClassUnlockForParticipant(assignmentRow, cp);
}

/** Same unlock check, but for an already-resolved class participant row (student account). */
export function enforceClassUnlockForParticipant(assignmentRow, cp) {
  const classRow = one('SELECT * FROM classes WHERE id = ?', cp.class_id);
  if (!classRow) throw notFound('class_not_found');
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

/** The class_participants row of a logged-in student account for a class (if any). */
export function classParticipantOfStudent(classId, studentId) {
  return one('SELECT * FROM class_participants WHERE class_id = ? AND student_id = ?', classId, studentId);
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

    // Logged-in student account: reuse/link the roster entry, name comes from
    // the account. A fresh class token is issued (single active session).
    const student = getStudent(req);
    if (student) {
      let cp = classParticipantOfStudent(cls.id, student.id);
      const rawToken = newParticipantToken();
      const timestamp = now();
      if (cp) {
        run('UPDATE class_participants SET token_hash = ?, name = ?, last_seen_at = ? WHERE id = ?', tokenHash(rawToken), student.name, timestamp, cp.id);
        cp = one('SELECT * FROM class_participants WHERE id = ?', cp.id);
      } else {
        // Link to an existing anonymous entry with the same name if present.
        const existing = one(
          'SELECT * FROM class_participants WHERE class_id = ? AND student_id IS NULL AND lower(name) = ?',
          cls.id,
          student.name.toLowerCase(),
        );
        if (existing) {
          run('UPDATE class_participants SET student_id = ?, token_hash = ?, last_seen_at = ? WHERE id = ?', student.id, tokenHash(rawToken), timestamp, existing.id);
          cp = one('SELECT * FROM class_participants WHERE id = ?', existing.id);
        } else {
          const id = uid();
          run(
            'INSERT INTO class_participants (id, class_id, name, token_hash, created_at, last_seen_at, student_id) VALUES (?,?,?,?,?,?,?)',
            id,
            cls.id,
            student.name,
            tokenHash(rawToken),
            timestamp,
            timestamp,
            student.id,
          );
          cp = one('SELECT * FROM class_participants WHERE id = ?', id);
        }
      }
      const rows = all('SELECT * FROM participants WHERE class_participant_id = ?', cp.id);
      json(res, 200, {
        classToken: rawToken,
        class: classStudentPayload(cls, rows),
        participant: { id: cp.id, name: cp.name, username: student.username },
      });
      return;
    }

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
      participant: { id: cp.id, name: cp.name, username: studentUsernameOf(cp) },
    });
  });

  // -------------------------------------------------------------------------
  // Student account: own profile + all classes with per-item states
  // -------------------------------------------------------------------------
  router.get('/api/student/me', async (req, res) => {
    const student = requireStudent(req);
    const cps = all('SELECT * FROM class_participants WHERE student_id = ? ORDER BY created_at ASC', student.id);
    const classes = [];
    for (const cp of cps) {
      const cls = one('SELECT * FROM classes WHERE id = ?', cp.class_id);
      if (!cls || cls.status !== 'published') continue;
      const rows = all('SELECT * FROM participants WHERE class_participant_id = ?', cp.id);
      classes.push(classStudentPayload(cls, rows));
    }
    json(res, 200, { student: studentPublic(student), classes });
  });

  // -------------------------------------------------------------------------
  // Teacher: class roster (students with accounts)
  // -------------------------------------------------------------------------
  router.get('/api/classes/:id/students', async (req, res, params) => {
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const rows = all(
      `SELECT cp.id AS cp_id, cp.name AS name, cp.created_at AS added_at, cp.last_seen_at AS last_seen_at,
              s.id AS student_id, s.username AS username, s.last_login_at AS last_login_at
       FROM class_participants cp LEFT JOIN students s ON s.id = cp.student_id
       WHERE cp.class_id = ? ORDER BY lower(cp.name) ASC`,
      row.id,
    );
    json(res, 200, {
      students: rows.map((r) => ({
        id: r.student_id || null,
        participantId: r.cp_id,
        name: r.name,
        username: r.username || null,
        hasAccount: !!r.student_id,
        addedAt: r.added_at,
        lastSeenAt: r.last_seen_at || null,
        lastLoginAt: r.last_login_at || null,
      })),
    });
  });

  // Create accounts for a list of names and add them to the class roster.
  // Plaintext passwords are returned exactly once (only for new accounts).
  router.post('/api/classes/:id/students', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const body = await readJsonSafe(req);
    if (!Array.isArray(body.names)) throw badRequest('invalid_names', 'names must be an array of strings');
    const names = [...new Set(body.names.map((n) => normalizeStudentName(n)).filter((n) => n.length >= 2))];
    if (names.length === 0) throw badRequest('invalid_names', 'At least one valid name (2+ characters) is required');
    if (names.length > 100) throw badRequest('too_many_names', 'At most 100 names per request');

    const credentials = [];
    const linked = [];
    const skipped = [];
    tx(() => {
      for (const name of names) {
        // Reuse an existing roster entry with the same name in this class.
        let cp = one('SELECT * FROM class_participants WHERE class_id = ? AND lower(name) = ?', row.id, name.toLowerCase());
        // Account of this teacher with the same name?
        let student = findStudentByName(user.id, name);
        let isNewAccount = false;
        if (!student) {
          const password = generatePassword();
          student = createStudent({ ownerId: user.id, name, password });
          credentials.push({ name: student.name, username: student.username, password });
          isNewAccount = true;
        }
        if (cp) {
          if (cp.student_id && cp.student_id !== student.id) {
            skipped.push({ name, reason: 'name_taken' });
            continue;
          }
          if (!cp.student_id) {
            run('UPDATE class_participants SET student_id = ? WHERE id = ?', student.id, cp.id);
          }
          linked.push({ name: cp.name, username: student.username, created: isNewAccount });
          continue;
        }
        const rawToken = newParticipantToken();
        const id = uid();
        const timestamp = now();
        run(
          'INSERT INTO class_participants (id, class_id, name, token_hash, created_at, last_seen_at, student_id) VALUES (?,?,?,?,?,?,?)',
          id,
          row.id,
          name,
          tokenHash(rawToken),
          timestamp,
          timestamp,
          student.id,
        );
        linked.push({ name, username: student.username, created: isNewAccount });
      }
    });
    run('UPDATE classes SET updated_at = ? WHERE id = ?', now(), row.id);
    json(res, 201, { credentials, linked, skipped });
  });

  // Reset the password of one roster student — new plaintext returned once.
  router.post('/api/classes/:id/students/:studentId/reset', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const cp = one('SELECT * FROM class_participants WHERE class_id = ? AND student_id = ?', row.id, params.studentId);
    if (!cp) throw notFound('student_not_found');
    const student = one('SELECT * FROM students WHERE id = ?', params.studentId);
    if (!student) throw notFound('student_not_found');
    assertCanAccess(user, student);
    const password = generatePassword();
    run('UPDATE students SET password_hash = ? WHERE id = ?', hashPassword(password), student.id);
    json(res, 200, { username: student.username, password });
  });

  // Remove a student from the class roster (the account itself stays).
  router.delete('/api/classes/:id/students/:studentId', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const cp = one('SELECT * FROM class_participants WHERE class_id = ? AND student_id = ?', row.id, params.studentId);
    if (!cp) throw notFound('student_not_found');
    run('DELETE FROM class_participants WHERE id = ?', cp.id);
    noContent(res);
  });

  // -------------------------------------------------------------------------
  // Teacher: class statistics — matrix of roster participants x items
  // -------------------------------------------------------------------------
  router.get('/api/classes/:id/stats', async (req, res, params) => {
    requireUser(req);
    const row = requireOwnedClass(req, params.id);
    const items = itemRowsFor(row.id);
    const itemRows = all('SELECT * FROM class_items WHERE class_id = ? ORDER BY position ASC', row.id);
    const cps = all(
      `SELECT cp.id AS cp_id, cp.name AS name, cp.created_at AS added_at, cp.last_seen_at AS last_seen_at,
              s.id AS student_id, s.username AS username, s.last_login_at AS last_login_at
       FROM class_participants cp LEFT JOIN students s ON s.id = cp.student_id
       WHERE cp.class_id = ? ORDER BY lower(cp.name) ASC`,
      row.id,
    );
    const students = cps.map((cp) => {
      const participantRows = all('SELECT * FROM participants WHERE class_participant_id = ?', cp.cp_id);
      const submittedAt = new Map(
        participantRows
          .filter((p) => p.status === 'submitted' || p.status === 'graded')
          .map((p) => [p.assignment_id, p.submitted_at || null]),
      );
      const states = computeItemStates(row, itemRows, participantRows);
      const cells = {};
      let scoreSum = 0;
      let maxSum = 0;
      for (const state of states) {
        const percent = state.maxScore > 0 ? Math.round((state.score / state.maxScore) * 1000) / 10 : null;
        cells[state.assignmentId] = {
          state: state.state,
          status: state.status,
          score: roundScore(state.score),
          maxScore: roundScore(state.maxScore),
          percent,
          submittedAt: submittedAt.get(state.assignmentId) || null,
        };
        if (state.state === 'done') {
          scoreSum += state.score;
          maxSum += state.maxScore;
        }
      }
      return {
        participantId: cp.cp_id,
        studentId: cp.student_id || null,
        name: cp.name,
        username: cp.username || null,
        hasAccount: !!cp.student_id,
        lastLoginAt: cp.last_login_at || null,
        cells,
        total: {
          score: roundScore(scoreSum),
          maxScore: roundScore(maxSum),
          percent: maxSum > 0 ? Math.round((scoreSum / maxSum) * 1000) / 10 : null,
        },
      };
    });
    json(res, 200, {
      class: classListItem(row),
      items: items.map((item) => ({
        assignmentId: item.assignment_id,
        position: Number(item.position),
        title: item.assignment_title || item.activity_title || '',
        code: item.assignment_code,
        status: item.assignment_status,
      })),
      students,
    });
  });
}

function studentUsernameOf(cp) {
  if (!cp || !cp.student_id) return null;
  const student = one('SELECT username FROM students WHERE id = ?', cp.student_id);
  return student ? student.username : null;
}
