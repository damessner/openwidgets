// Student / participant API — CONTRACT.md §5.4.
// Server-authoritative grading: every save re-scores from the canonical response
// with the shared scorers. Student payloads are built from sanitizeActivity().
import { config } from '../config.js';
import { all, now, one, run, uid } from '../db.js';
import { requireParticipantAuth, tokenHash } from './_helpers.js';
import {
  assertSameOrigin,
  badRequest,
  clientIp,
  conflict,
  HttpError,
  json,
  notFound,
  rateLimited,
  readJson,
} from '../lib/http.js';
import { touchPresence } from '../lib/events.js';
import { activityStats } from '../../shared/activity.js';
import { getType } from '../../shared/items/index.js';
import {
  definitionFromRow,
  finalizeSubmission,
  findAssignmentByCode,
  newParticipantToken,
  participantFlags,
  publishParticipantEvent,
  publishResponseEvent,
  recomputeTotals,
  resultPayload,
  roundScore,
  sanitizedActivityFor,
  settingsFor,
  timeLimitInfo,
} from './_helpers.js';

const MAX_PARTICIPANTS_PER_ASSIGNMENT = 500;
const JOIN_LIMIT_PER_IP = 30;
const SAVE_LIMIT_PER_TOKEN = 120;
const SUBMIT_LIMIT_PER_TOKEN = 5;
const RATE_WINDOW_MS = 60000;
const windows = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, limit) {
  const nowMs = Date.now();
  const entry = windows.get(key);
  if (windows.size > 5000) {
    for (const [candidate, value] of windows) {
      if (value.resetAt < nowMs) windows.delete(candidate);
    }
  }
  if (!entry || entry.resetAt < nowMs) {
    windows.set(key, { count: 1, resetAt: nowMs + RATE_WINDOW_MS });
    return;
  }
  if (entry.count >= limit) throw rateLimited();
  entry.count += 1;
}

function participantTokenKey(req) {
  const header = req.headers['x-participant-token'];
  const token = Array.isArray(header) ? header[0] : header;
  return tokenHash(token || '');
}

function participantResponseJson(row) {
  return {
    itemId: row.item_id,
    response: JSON.parse(row.response || '{}'),
    result: {
      correct: !!row.correct,
      autoScore: roundScore(row.auto_score),
      maxScore: roundScore(row.max_score),
      needsManual: !!row.needs_manual,
    },
  };
}

function responsesFor(participantId) {
  return all('SELECT * FROM responses WHERE participant_id = ? ORDER BY updated_at ASC', participantId).map(
    participantResponseJson,
  );
}

function touchLastSeen(participantRow, assignmentRow, activityRow) {
  const timestamp = now();
  run('UPDATE participants SET last_seen_at = ? WHERE id = ?', timestamp, participantRow.id);
  participantRow.last_seen_at = timestamp;
  if (touchPresence(participantRow.id, assignmentRow.id)) {
    publishParticipantEvent(assignmentRow, activityRow, participantRow, 'presence');
  }
}

function joinAssignmentInfo(assignmentRow, activityRow) {
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(assignmentRow, definition);
  return {
    assignment: {
      code: assignmentRow.code,
      title: assignmentRow.title,
      template: activityRow.template,
      locale: activityRow.locale,
      status: assignmentRow.status,
      requireName: settings.requireName !== false,
    },
    activity: { title: definition.title, description: definition.description },
  };
}

async function readSmallJson(req, bytes = 64 * 1024) {
  return readJson(req, bytes);
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Join info (public, teacher-facing share link landing)
  // -------------------------------------------------------------------------
  router.get('/api/join/:code', async (req, res, params) => {
    const assignment = findAssignmentByCode(params.code);
    if (!assignment) throw notFound('invalid_code');
    const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
    if (!activity) throw notFound('invalid_code');
    json(res, 200, joinAssignmentInfo(assignment, activity));
  });

  // -------------------------------------------------------------------------
  // Join (creates a participant + returns the sanitized activity)
  // -------------------------------------------------------------------------
  router.post('/api/join', async (req, res) => {
    assertSameOrigin(req);
    const ip = clientIp(req, config.trustProxy);
    checkRateLimit(`join:${ip || 'unknown'}`, JOIN_LIMIT_PER_IP);
    const body = await readSmallJson(req, 32 * 1024);

    const assignment = findAssignmentByCode(body.code);
    if (!assignment) throw notFound('invalid_code');
    if (assignment.status !== 'open') throw conflict('assignment_closed', 'This assignment is closed');

    const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
    if (!activity) throw notFound('invalid_code');

    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);

    const countRow = one('SELECT COUNT(*) AS c FROM participants WHERE assignment_id = ?', assignment.id);
    if (countRow && countRow.c >= MAX_PARTICIPANTS_PER_ASSIGNMENT) {
      throw new HttpError(409, 'participant_limit_reached', 'This assignment has reached the participant limit');
    }

    let name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      if (settings.requireName !== false) throw badRequest('name_required', 'Please enter your name');
      name = definition.locale === 'en' ? 'Guest' : 'Gast';
    }
    if (name.length > 80) throw badRequest('invalid_name', 'Name must be at most 80 characters');

    const rawToken = newParticipantToken();
    const id = uid();
    const timestamp = now();
    const stats = activityStats(definition);
    // Data minimisation: participant IP / user agent are intentionally NOT
    // stored (minors, DSGVO). The columns stay NULL for a future opt-in.
    run(
      'INSERT INTO participants (id, assignment_id, name, token_hash, status, started_at, submitted_at, last_seen_at, score, max_score, flags, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      assignment.id,
      name,
      tokenHash(rawToken),
      'in_progress',
      timestamp,
      null,
      timestamp,
      0,
      roundScore(stats.maxScore),
      '[]',
      null,
      null,
    );
    const participant = one('SELECT * FROM participants WHERE id = ?', id);
    touchPresence(id, assignment.id);
    publishParticipantEvent(assignment, activity, participant, 'joined');

    const sanitized = sanitizedActivityFor(assignment, activity);
    json(res, 200, {
      participantToken: rawToken,
      participant: { id: participant.id, name: participant.name },
      assignment: {
        code: assignment.code,
        title: assignment.title,
        template: activity.template,
        locale: activity.locale,
        settings,
      },
      activity: {
        title: sanitized.title,
        description: sanitized.description,
        settings: sanitized.settings,
        items: sanitized.items,
      },
      responses: [],
      flags: [],
    });
  });

  // -------------------------------------------------------------------------
  // Current participant state (resume / reload)
  // -------------------------------------------------------------------------
  router.get('/api/participant', async (req, res) => {
    const { participant, assignment, activity } = requireParticipantAuth(req);
    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);

    let current = participant;
    const limit = timeLimitInfo(settings, participant);
    if (limit.expired && current.status === 'in_progress') {
      const finalized = finalizeSubmission(current);
      current = finalized.participant;
      publishParticipantEvent(assignment, activity, current, 'submitted');
    } else {
      touchLastSeen(current, assignment, activity);
      current = one('SELECT * FROM participants WHERE id = ?', current.id);
    }

    const sanitized = sanitizedActivityFor(assignment, activity);
    json(res, 200, {
      participant: {
        id: current.id,
        name: current.name,
        status: current.status,
        score: roundScore(current.score),
        maxScore: roundScore(current.max_score),
        startedAt: current.started_at,
        submittedAt: current.submitted_at || null,
      },
      assignment: {
        code: assignment.code,
        title: assignment.title,
        template: activity.template,
        locale: activity.locale,
        settings,
        status: assignment.status,
      },
      activity: {
        title: sanitized.title,
        description: sanitized.description,
        settings: sanitized.settings,
        items: sanitized.items,
      },
      responses: responsesFor(current.id),
      flags: participantFlags(current),
    });
  });

  // -------------------------------------------------------------------------
  // Save one response (server-authoritative scoring, time limit, SSE)
  // -------------------------------------------------------------------------
  router.put('/api/participant/responses/:itemId', async (req, res, params) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    checkRateLimit(`save:${participantTokenKey(req)}`, SAVE_LIMIT_PER_TOKEN);
    const body = await readJson(req, 256 * 1024);

    if (participant.status !== 'in_progress') {
      throw conflict('attempt_submitted', 'This attempt has already been submitted');
    }
    if (assignment.status !== 'open') {
      throw conflict('assignment_closed', 'This assignment is closed');
    }

    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);

    const limit = timeLimitInfo(settings, participant);
    if (limit.expired) {
      const finalized = finalizeSubmission(participant);
      publishParticipantEvent(assignment, activity, finalized.participant, 'submitted');
      throw new HttpError(409, 'time_expired', 'The time limit has expired and the attempt was submitted');
    }

    const rawItem = definition.items.find((item) => item.id === String(params.itemId));
    if (!rawItem) throw notFound('item_not_found');
    const module = getType(rawItem.type);
    if (!module || !module.meta || !module.meta.scoreable) {
      throw badRequest('invalid_response', 'This item does not accept a response');
    }
    const item = module.normalizeItem(rawItem);

    let canonical;
    try {
      canonical = module.normalizeResponse(item, body.response === undefined ? {} : body.response);
    } catch (error) {
      throw new HttpError(400, 'invalid_response', error && error.message ? error.message : 'Invalid response');
    }

    const scored = module.score(item, canonical);
    const existing = one(
      'SELECT * FROM responses WHERE participant_id = ? AND item_id = ?',
      participant.id,
      item.id,
    );
    const updatedAt = now();
    if (existing) {
      run(
        'UPDATE responses SET response = ?, auto_score = ?, max_score = ?, correct = ?, needs_manual = ?, updated_at = ? WHERE id = ?',
        JSON.stringify(canonical),
        scored.autoScore,
        scored.maxScore,
        scored.correct ? 1 : 0,
        scored.needsManual ? 1 : 0,
        updatedAt,
        existing.id,
      );
    } else {
      run(
        'INSERT INTO responses (id, participant_id, item_id, response, auto_score, max_score, correct, needs_manual, feedback, manual_score, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        uid(),
        participant.id,
        item.id,
        JSON.stringify(canonical),
        scored.autoScore,
        scored.maxScore,
        scored.correct ? 1 : 0,
        scored.needsManual ? 1 : 0,
        '',
        null,
        updatedAt,
      );
    }

    const totals = recomputeTotals(participant.id);
    const stored = one('SELECT * FROM responses WHERE participant_id = ? AND item_id = ?', participant.id, item.id);
    publishResponseEvent(assignment, participant, item.id, stored, totals);
    touchLastSeen(participant, assignment, activity);

    json(res, 200, {
      saved: true,
      result: {
        correct: !!stored.correct,
        autoScore: roundScore(stored.auto_score),
        maxScore: roundScore(stored.max_score),
        needsManual: !!stored.needs_manual,
      },
      score: totals.score,
      maxScore: totals.maxScore,
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat (presence, throttled SSE)
  // -------------------------------------------------------------------------
  router.post('/api/participant/heartbeat', async (req, res) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    touchLastSeen(participant, assignment, activity);
    json(res, 200, { ok: true });
  });

  // -------------------------------------------------------------------------
  // Starred questions ("flags")
  // -------------------------------------------------------------------------
  router.post('/api/participant/flags', async (req, res) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    const body = await readSmallJson(req, 32 * 1024);
    if (!Array.isArray(body.flags)) throw badRequest('invalid_flags', 'flags must be an array of item ids');

    const definition = definitionFromRow(activity);
    const known = new Set(definition.items.map((item) => item.id));
    const flags = [];
    for (const value of body.flags) {
      if (typeof value === 'string' && known.has(value) && !flags.includes(value)) flags.push(value);
      if (flags.length >= 300) break;
    }
    run('UPDATE participants SET flags = ?, last_seen_at = ? WHERE id = ?', JSON.stringify(flags), now(), participant.id);
    participant.flags = JSON.stringify(flags);
    participant.last_seen_at = now();
    publishParticipantEvent(assignment, activity, participant, 'flags');
    json(res, 200, { flags });
  });

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  router.post('/api/participant/submit', async (req, res) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    checkRateLimit(`submit:${participantTokenKey(req)}`, SUBMIT_LIMIT_PER_TOKEN);
    const body = await readSmallJson(req, 16 * 1024);

    if (participant.status !== 'in_progress') {
      throw conflict('attempt_submitted', 'This attempt has already been submitted');
    }
    if (body.confirm !== true) {
      throw badRequest('confirmation_required', 'Submit requires { "confirm": true }');
    }

    const finalized = finalizeSubmission(participant);
    publishParticipantEvent(assignment, activity, finalized.participant, 'submitted');
    json(res, 200, resultPayload(finalized.participant, assignment, activity));
  });

  // -------------------------------------------------------------------------
  // Result (only after submit; auto-submits a timed-out attempt)
  // -------------------------------------------------------------------------
  router.get('/api/participant/result', async (req, res) => {
    const { participant, assignment, activity } = requireParticipantAuth(req);
    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);

    let current = participant;
    if (current.status === 'in_progress') {
      const limit = timeLimitInfo(settings, current);
      if (!limit.expired) throw new HttpError(403, 'not_submitted', 'The attempt has not been submitted yet');
      const finalized = finalizeSubmission(current);
      current = finalized.participant;
      publishParticipantEvent(assignment, activity, current, 'submitted');
    }
    json(res, 200, resultPayload(current, assignment, activity));
  });
}
