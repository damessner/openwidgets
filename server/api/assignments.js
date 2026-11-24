// Assignments + live dashboard API — CONTRACT.md §5.3 and §5.6.
// Publishing snapshots the activity settings; the definition itself is read
// through the activity (republishing creates a new assignment).
import { all, now, one, run, tx, uid } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { assertSameOrigin, badRequest, HttpError, json, noContent, readJson } from '../lib/http.js';
import { publish, sseOpen, sseSend, subscribe } from '../lib/events.js';
import { validateActivity } from '../../shared/activity.js';
import {
  assignmentDetail,
  assignmentListItem,
  definitionFromRow,
  forgetAssignmentPresence,
  generateAssignmentCode,
  itemBriefs,
  itemOrderFor,
  livePlayers,
  playersWithResponses,
  requireOwnedActivity,
  requireOwnedAssignment,
  roundScore,
  settingsFor,
  snapshotPayload,
  stateForRow,
} from './_helpers.js';

const MAX_BODY_BYTES = 64 * 1024;

function readJsonSafe(req) {
  return readJson(req, MAX_BODY_BYTES);
}

function parseDueAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) throw badRequest('invalid_due_at', 'dueAt must be a valid ISO-8601 date or null');
  return new Date(ms).toISOString();
}

function assertAssignmentTitle(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest('invalid_title', 'Title must be a non-empty string');
  }
  if (value.length > 200) throw badRequest('invalid_title', 'Title must be at most 200 characters');
  return value;
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** German-Excel-friendly number: decimal comma, no quotes needed. */
function csvNumber(value) {
  const rounded = roundScore(value);
  return String(rounded).replace('.', ',');
}

function assignmentRowsFor(user) {
  const base = `SELECT s.*, a.title AS activity_title, a.template AS activity_template, a.locale AS activity_locale,
      a.definition AS activity_definition,
      (SELECT COUNT(*) FROM participants p WHERE p.assignment_id = s.id) AS participant_count
    FROM assignments s LEFT JOIN activities a ON a.id = s.activity_id`;
  if (user.role === 'admin') return all(`${base} ORDER BY s.created_at DESC`);
  return all(`${base} WHERE s.owner_id = ? ORDER BY s.created_at DESC`, user.id);
}

function fakeActivityRow(row) {
  if (!row.activity_definition) return null;
  return {
    id: row.activity_id,
    title: row.activity_title,
    template: row.activity_template,
    locale: row.activity_locale,
    definition: row.activity_definition,
    description: '',
    status: 'published',
    revision: 0,
    updated_at: row.created_at,
  };
}

function assignmentById(id) {
  return one('SELECT * FROM assignments WHERE id = ?', String(id));
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Publish (POST /api/activities/:id/publish)
  // -------------------------------------------------------------------------
  router.post('/api/activities/:id/publish', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const activity = requireOwnedActivity(req, params.id);
    const body = await readJsonSafe(req);

    const definition = definitionFromRow(activity);
    const check = validateActivity(definition);
    if (!check.ok) {
      throw new HttpError(400, 'activity_invalid', 'The activity is not valid for publishing', check.errors);
    }

    const title = body.title === undefined || body.title === null || body.title === ''
      ? activity.title
      : assertAssignmentTitle(String(body.title));
    const dueAt = parseDueAt(body.dueAt);
    const settings = JSON.parse(JSON.stringify(definition.settings));

    const id = uid();
    const code = generateAssignmentCode();
    run(
      'INSERT INTO assignments (id, activity_id, owner_id, code, title, settings, status, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id,
      activity.id,
      user.id,
      code,
      title,
      JSON.stringify(settings),
      'open',
      dueAt,
      now(),
    );
    run("UPDATE activities SET status = 'published' WHERE id = ? AND status = 'draft'", activity.id);
    const assignment = assignmentById(id);
    json(res, 201, { assignment: assignmentDetail(assignment, activity) });
  });

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------
  router.get('/api/assignments', async (req, res) => {
    const user = requireUser(req);
    const rows = assignmentRowsFor(user);
    const assignments = rows.map((row) => {
      const activityRow = fakeActivityRow(row);
      const definition = definitionFromRow(activityRow);
      return assignmentListItem(row, activityRow, definition, row.participant_count);
    });
    json(res, 200, { assignments });
  });

  // -------------------------------------------------------------------------
  // Get one (raw definition for the teacher)
  // -------------------------------------------------------------------------
  router.get('/api/assignments/:id', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);
    json(res, 200, { assignment: assignmentDetail(assignment, activity) });
  });

  // -------------------------------------------------------------------------
  // Patch (status / title / dueAt)
  // -------------------------------------------------------------------------
  router.patch('/api/assignments/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);
    const body = await readJsonSafe(req);

    const updates = {};
    if (body.title !== undefined) updates.title = assertAssignmentTitle(String(body.title));
    if (body.dueAt !== undefined) updates.due_at = parseDueAt(body.dueAt);
    if (body.status !== undefined) {
      if (body.status !== 'open' && body.status !== 'closed') {
        throw badRequest('invalid_status', 'status must be "open" or "closed"');
      }
      updates.status = body.status;
    }
    if (updates.status !== undefined && updates.status === assignment.status) delete updates.status;
    if (updates.title !== undefined && updates.title === assignment.title) delete updates.title;
    if (updates.due_at !== undefined && updates.due_at === (assignment.due_at || null)) delete updates.due_at;

    const fields = Object.keys(updates);
    if (fields.length > 0) {
      run(
        `UPDATE assignments SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`,
        ...fields.map((field) => updates[field]),
        assignment.id,
      );
    }
    if (updates.status === 'closed' || updates.status === 'open') {
      publish(assignment.id, {
        type: 'assignment',
        action: updates.status === 'closed' ? 'closed' : 'opened',
      });
    }
    const fresh = assignmentById(assignment.id);
    json(res, 200, { assignment: assignmentDetail(fresh, activity) });
  });

  // -------------------------------------------------------------------------
  // Delete (cascade participants/responses, notify the dashboard)
  // -------------------------------------------------------------------------
  router.delete('/api/assignments/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { assignment } = requireOwnedAssignment(req, params.id);
    forgetAssignmentPresence(assignment.id);
    tx(() => {
      run('DELETE FROM events WHERE assignment_id = ?', assignment.id);
      run('DELETE FROM assignments WHERE id = ?', assignment.id);
    });
    publish(assignment.id, { type: 'assignment', action: 'deleted' });
    noContent(res);
  });

  // -------------------------------------------------------------------------
  // Live snapshot (first load of the dashboard)
  // -------------------------------------------------------------------------
  router.get('/api/assignments/:id/live', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);
    const definition = definitionFromRow(activity);
    const order = itemOrderFor(definition, settingsFor(assignment, definition), assignment.id);
    const items = itemBriefs(definition, order);
    json(res, 200, {
      assignment: { id: assignment.id, title: assignment.title, code: assignment.code, status: assignment.status },
      items,
      players: livePlayers(
        assignment.id,
        items.map((item) => item.id),
      ),
    });
  });

  // -------------------------------------------------------------------------
  // SSE live stream (CONTRACT.md §5.6)
  // -------------------------------------------------------------------------
  router.get('/api/assignments/:id/stream', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);

    sseOpen(res);
    sseSend(res, snapshotPayload(assignment, activity));
    const unsubscribe = subscribe(assignment.id, res);

    const ping = setInterval(() => sseSend(res, { type: 'ping', t: Date.now() }), 25000);
    if (typeof ping.unref === 'function') ping.unref();

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(ping);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
  });

  // -------------------------------------------------------------------------
  // Results (teacher review with raw responses)
  // -------------------------------------------------------------------------
  router.get('/api/assignments/:id/results', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);
    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);
    const order = itemOrderFor(definition, settings, assignment.id);
    const detail = assignmentDetail(assignment, activity);
    const items = itemBriefs(definition, order);
    json(res, 200, {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        code: assignment.code,
        status: assignment.status,
        activityId: assignment.activity_id,
        activityTitle: detail.activityTitle,
        template: detail.template,
        settings,
        dueAt: assignment.due_at || null,
        createdAt: assignment.created_at,
        maxScore: detail.maxScore,
        itemOrder: order,
      },
      items,
      players: playersWithResponses(
        assignment.id,
        items.map((item) => item.id),
      ),
    });
  });

  // -------------------------------------------------------------------------
  // CSV export (CONTRACT.md §5.3) — BOM + semicolons + German decimals so the
  // file opens cleanly in German Excel.
  // -------------------------------------------------------------------------
  router.get('/api/assignments/:id/export.csv', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.id);
    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);
    const order = itemOrderFor(definition, settings, assignment.id);
    const items = itemBriefs(definition, order);
    const participants = all(
      `SELECT p.* FROM participants p WHERE p.assignment_id = ? AND (p.flags IS NULL OR p.flags NOT LIKE '%"practice"%') ORDER BY p.started_at ASC, p.id ASC`,
      assignment.id,
    );
    const responses = all(
      `SELECT r.* FROM responses r JOIN participants p ON p.id = r.participant_id WHERE p.assignment_id = ? AND (p.flags IS NULL OR p.flags NOT LIKE '%"practice"%')`,
      assignment.id,
    );
    const byParticipant = new Map();
    for (const row of responses) {
      if (!byParticipant.has(row.participant_id)) byParticipant.set(row.participant_id, []);
      byParticipant.get(row.participant_id).push(row);
    }

    const header = ['participant', 'status', 'score', 'max_score', 'started_at', 'submitted_at'];
    for (const item of items) {
      header.push(`item_${item.index}`, `item_${item.index}_state`);
    }

    const lines = [header.map(csvField).join(';')];
    for (const participant of participants) {
      const rows = byParticipant.get(participant.id) || [];
      const byItem = new Map(rows.map((row) => [row.item_id, row]));
      const cells = [
        participant.name,
        participant.status,
        csvNumber(participant.score),
        csvNumber(participant.max_score),
        participant.started_at,
        participant.submitted_at || '',
      ];
      for (const item of items) {
        const row = byItem.get(item.id);
        if (!row) {
          cells.push('', 'unanswered');
          continue;
        }
        const effective =
          row.manual_score === null || row.manual_score === undefined ? row.auto_score : row.manual_score;
        cells.push(csvNumber(effective), stateForRow(row));
      }
      lines.push(cells.map(csvField).join(';'));
    }

    const body = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="openwidgets-${assignment.code}.csv"`,
    });
    res.end(body);
  });
}

// ---------------------------------------------------------------------------
// Assignment rows are always reachable through _helpers.requireOwnedAssignment,
// which enforces owner_id = user.id (admins bypass).
// ---------------------------------------------------------------------------
