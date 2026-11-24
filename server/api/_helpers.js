// Internal helpers shared by the server-dev API modules (activities,
// assignments, participant, grading, admin, assets). Not part of the public API
// contract — keep the shapes here aligned with docs/CONTRACT.md.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, now, one, parseJson, run, shortId } from '../db.js';
import { forgetPresence, isOnline, publish } from '../lib/events.js';
import { HttpError, notFound } from '../lib/http.js';
import { activityStats, itemIsScoreable, normalizeActivity, normalizeSettings, sanitizeActivity } from '../../shared/activity.js';
import {
  answerKey as itemAnswerKey,
  answerText as itemAnswerText,
  answerZones as itemAnswerZones,
  getType,
  sanitizeItem,
} from '../../shared/items/index.js';
import { seededShuffle } from '../../shared/util.js';

export const SCORE_EPSILON = 1e-9;

export const PARTICIPANT_STATES = ['unanswered', 'correct', 'partial', 'incorrect', 'manual'];

export function roundScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Activity / assignment row mapping
// ---------------------------------------------------------------------------

export function definitionFromRow(row) {
  if (!row) return normalizeActivity({});
  const parsed = parseJson(row.definition, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return normalizeActivity(parsed);
  return normalizeActivity({
    template: row.template,
    locale: row.locale,
    title: row.title,
    description: row.description,
  });
}

/** Assignment settings snapshot (falls back to the activity settings). */
export function settingsFor(assignmentRow, definition = null) {
  const snapshot = parseJson(assignmentRow && assignmentRow.settings, null);
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) return normalizeSettings(snapshot);
  return normalizeSettings(definition ? definition.settings : {});
}

export function shareUrl(code) {
  return `${config.baseUrl || ''}/a/${code}`;
}

export function activityJson(row) {
  const definition = definitionFromRow(row);
  const stats = activityStats(definition);
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    template: row.template,
    locale: row.locale,
    status: row.status,
    revision: row.revision,
    definition,
    itemCount: stats.itemCount,
    scoreableCount: stats.scoreableCount,
    maxScore: roundScore(stats.maxScore),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function activityListItem(row, assignmentCount = 0) {
  const stats = activityStats(definitionFromRow(row));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    template: row.template,
    locale: row.locale,
    status: row.status,
    revision: row.revision,
    itemCount: stats.itemCount,
    maxScore: roundScore(stats.maxScore),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    assignmentCount: Number(assignmentCount) || 0,
  };
}

export function itemOrderFor(definition, settings, seed) {
  const ids = definition.items.map((item) => item.id);
  if (settings && settings.shuffleItems) return seededShuffle(ids, `items:${seed}`);
  return ids;
}

/** Item ids in display order that actually accept responses (no plain text blocks). */
export function scoreableItemIds(definition, order) {
  const byId = new Map(definition.items.map((item) => [item.id, item]));
  return order.filter((itemId) => {
    const item = byId.get(itemId);
    return item ? itemIsScoreable(item) : false;
  });
}

/** Lightweight item list for the live dashboard / results / CSV. */
export function itemBriefs(definition, order) {
  const byId = new Map(definition.items.map((item) => [item.id, item]));
  const briefs = [];
  order.forEach((itemId) => {
    const item = byId.get(itemId);
    if (!item) return;
    const module = getType(item.type);
    if (!itemIsScoreable(item)) return;
    briefs.push({
      id: item.id,
      index: briefs.length + 1,
      type: item.type,
      points: roundScore(item.points),
      scoreable: true,
      label: module.meta && module.meta.label ? { ...module.meta.label } : { en: item.type, de: item.type },
      stem: item.stem,
    });
  });
  return briefs;
}

export function assignmentDetail(row, activityRow) {
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(row, definition);
  const order = itemOrderFor(definition, settings, row.id);
  const stats = activityStats(definition);
  const countRow = one('SELECT COUNT(*) AS c FROM participants WHERE assignment_id = ?', row.id);
  return {
    id: row.id,
    activityId: row.activity_id,
    activityTitle: activityRow ? activityRow.title : '',
    title: row.title,
    code: row.code,
    status: row.status,
    settings,
    dueAt: row.due_at || null,
    createdAt: row.created_at,
    template: activityRow ? activityRow.template : definition.template,
    locale: activityRow ? activityRow.locale : definition.locale,
    maxScore: roundScore(stats.maxScore),
    itemCount: stats.itemCount,
    scoreableCount: stats.scoreableCount,
    participantCount: countRow ? countRow.c : 0,
    itemOrder: order,
    url: shareUrl(row.code),
    activity: activityRow
      ? {
          id: activityRow.id,
          title: activityRow.title,
          description: activityRow.description,
          template: activityRow.template,
          locale: activityRow.locale,
          status: activityRow.status,
          revision: activityRow.revision,
          updatedAt: activityRow.updated_at,
          definition,
        }
      : null,
  };
}

export function assignmentListItem(row, activityRow, definition, participantCount) {
  const stats = activityStats(definition);
  return {
    id: row.id,
    title: row.title,
    code: row.code,
    status: row.status,
    activityId: row.activity_id,
    activityTitle: activityRow ? activityRow.title : '',
    template: activityRow ? activityRow.template : definition.template,
    participantCount: Number(participantCount) || 0,
    createdAt: row.created_at,
    dueAt: row.due_at || null,
    maxScore: roundScore(stats.maxScore),
  };
}

// ---------------------------------------------------------------------------
// Ownership / lookup guards
// ---------------------------------------------------------------------------

export function requireActivityRow(id) {
  const row = one('SELECT * FROM activities WHERE id = ?', String(id));
  if (!row) throw notFound('activity_not_found');
  return row;
}

export function assertCanAccess(user, row) {
  if (!user || !row) throw notFound();
  if (user.role !== 'admin' && row.owner_id !== user.id) {
    throw new HttpError(403, 'forbidden', 'You do not have access to this resource');
  }
}

export function requireOwnedActivity(req, id) {
  const row = requireActivityRow(id);
  assertCanAccess(req.user, row);
  return row;
}

export function requireOwnedAssignment(req, id) {
  const assignment = one('SELECT * FROM assignments WHERE id = ?', String(id));
  if (!assignment) throw notFound('assignment_not_found');
  assertCanAccess(req.user, assignment);
  const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
  if (!activity) throw notFound('activity_not_found');
  return { assignment, activity };
}

export function findAssignmentByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  return one('SELECT * FROM assignments WHERE code = ?', normalized);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

/** 6 chars, uppercase, no I/O/0/1, unique across assignments. */
export function generateAssignmentCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = randomCode();
    if (!one('SELECT id FROM assignments WHERE code = ?', code)) return code;
  }
  throw new HttpError(500, 'internal_error', 'Could not generate an assignment code');
}

// ---------------------------------------------------------------------------
// Participant auth (student token) — only the SHA-256 hash is stored
// ---------------------------------------------------------------------------

export function tokenHash(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

export function newParticipantToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function requireParticipantAuth(req) {
  const header = req.headers['x-participant-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== 'string' || token.trim().length < 16) {
    throw new HttpError(401, 'invalid_participant_token', 'A participant token is required');
  }
  const participant = one('SELECT * FROM participants WHERE token_hash = ?', tokenHash(token.trim()));
  if (!participant) {
    throw new HttpError(401, 'invalid_participant_token', 'Invalid participant token');
  }
  const assignment = one('SELECT * FROM assignments WHERE id = ?', participant.assignment_id);
  if (!assignment) throw new HttpError(401, 'invalid_participant_token', 'Invalid participant token');
  const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
  if (!activity) throw new HttpError(401, 'invalid_participant_token', 'Invalid participant token');
  return { participant, assignment, activity };
}

// ---------------------------------------------------------------------------
// Time limit
// ---------------------------------------------------------------------------

export const TIME_LIMIT_GRACE_MS = 60000;

export function timeLimitInfo(settings, participantRow) {
  const minutes = Number(settings && settings.timeLimitMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return { limited: false, expired: false };
  const startedMs = Date.parse(participantRow && participantRow.started_at);
  if (!Number.isFinite(startedMs)) return { limited: false, expired: false };
  const deadlineMs = startedMs + minutes * 60000;
  const graceEndMs = deadlineMs + TIME_LIMIT_GRACE_MS;
  return { limited: true, deadlineMs, graceEndMs, expired: Date.now() > graceEndMs };
}

// ---------------------------------------------------------------------------
// Live players / results
// ---------------------------------------------------------------------------

/** Derive the live-dashboard state from a stored response row. */
export function stateForRow(row) {
  if (!row) return 'unanswered';
  if (Number(row.needs_manual)) return 'manual';
  const auto = Number(row.auto_score);
  const max = Number(row.max_score);
  if (auto >= max - SCORE_EPSILON) return 'correct';
  if (auto <= SCORE_EPSILON) return 'incorrect';
  return 'partial';
}

export function participantFlags(row) {
  const flags = parseJson(row && row.flags, []);
  return Array.isArray(flags) ? flags.filter((value) => typeof value === 'string') : [];
}

/** Practice attempts (settings.practice) are excluded from results/dashboard. */
export function isPracticeParticipant(row) {
  return participantFlags(row).includes('practice');
}

const NOT_PRACTICE_SQL = `(p.flags IS NULL OR p.flags NOT LIKE '%"practice"%')`;

export function livePlayer(row, order, responseRows) {
  const byItem = new Map((responseRows || []).map((responseRow) => [responseRow.item_id, responseRow]));
  const items = {};
  for (const itemId of order) items[itemId] = stateForRow(byItem.get(itemId));
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    score: roundScore(row.score),
    maxScore: roundScore(row.max_score),
    lastSeenAt: row.last_seen_at || null,
    online: isOnline(row.last_seen_at),
    items,
    flags: participantFlags(row),
    submittedAt: row.submitted_at || null,
  };
}

/** All participants of an assignment as live-player objects. */
export function livePlayers(assignmentId, order) {
  const participants = all(
    `SELECT p.* FROM participants p WHERE p.assignment_id = ? AND ${NOT_PRACTICE_SQL} ORDER BY p.started_at ASC, p.id ASC`,
    assignmentId,
  );
  const responses = all(
    `SELECT r.* FROM responses r JOIN participants p ON p.id = r.participant_id WHERE p.assignment_id = ? AND ${NOT_PRACTICE_SQL}`,
    assignmentId,
  );
  const byParticipant = new Map();
  for (const row of responses) {
    if (!byParticipant.has(row.participant_id)) byParticipant.set(row.participant_id, []);
    byParticipant.get(row.participant_id).push(row);
  }
  return participants.map((row) => livePlayer(row, order, byParticipant.get(row.id) || []));
}

export function responseTeacherJson(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    response: parseJson(row.response, {}),
    autoScore: roundScore(row.auto_score),
    maxScore: roundScore(row.max_score),
    correct: !!row.correct,
    needsManual: !!row.needs_manual,
    feedback: row.feedback || '',
    manualScore: row.manual_score === null || row.manual_score === undefined ? null : roundScore(row.manual_score),
    updatedAt: row.updated_at,
  };
}

/** Live players plus their raw responses (teacher results / review). */
export function playersWithResponses(assignmentId, order) {
  const participants = all(
    `SELECT p.* FROM participants p WHERE p.assignment_id = ? AND ${NOT_PRACTICE_SQL} ORDER BY p.started_at ASC, p.id ASC`,
    assignmentId,
  );
  const responses = all(
    `SELECT r.* FROM responses r JOIN participants p ON p.id = r.participant_id WHERE p.assignment_id = ? AND ${NOT_PRACTICE_SQL} ORDER BY r.updated_at ASC`,
    assignmentId,
  );
  const byParticipant = new Map();
  for (const row of responses) {
    if (!byParticipant.has(row.participant_id)) byParticipant.set(row.participant_id, []);
    byParticipant.get(row.participant_id).push(row);
  }
  return participants.map((row) => {
    const rows = byParticipant.get(row.id) || [];
    return { ...livePlayer(row, order, rows), responses: rows.map(responseTeacherJson) };
  });
}

export function participantJson(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    score: roundScore(row.score),
    maxScore: roundScore(row.max_score),
    startedAt: row.started_at,
    submittedAt: row.submitted_at || null,
    lastSeenAt: row.last_seen_at || null,
    online: isOnline(row.last_seen_at),
    flags: participantFlags(row),
  };
}

// ---------------------------------------------------------------------------
// Score recomputation
// ---------------------------------------------------------------------------

/** Recompute participant totals from stored responses (manual ?? auto). */
export function recomputeTotals(participantId) {
  const participant = one('SELECT * FROM participants WHERE id = ?', participantId);
  if (!participant) return { score: 0, maxScore: 0 };
  const assignment = one('SELECT * FROM assignments WHERE id = ?', participant.assignment_id);
  let maxScore = 0;
  if (assignment) {
    const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
    if (activity) maxScore = activityStats(definitionFromRow(activity)).maxScore;
  }
  const rows = all('SELECT auto_score, manual_score FROM responses WHERE participant_id = ?', participantId);
  let score = 0;
  for (const row of rows) {
    const effective =
      row.manual_score === null || row.manual_score === undefined ? Number(row.auto_score) || 0 : Number(row.manual_score);
    score += effective;
  }
  const totals = { score: roundScore(score), maxScore: roundScore(maxScore) };
  run('UPDATE participants SET score = ?, max_score = ? WHERE id = ?', totals.score, totals.maxScore, participantId);
  return totals;
}

/** 'graded' once every manual-required response has a teacher score. */
export function recomputeStatus(participantId) {
  const participant = one('SELECT * FROM participants WHERE id = ?', participantId);
  if (!participant || participant.status === 'in_progress') return participant ? participant.status : null;
  const pending = one(
    'SELECT COUNT(*) AS c FROM responses WHERE participant_id = ? AND needs_manual = 1 AND manual_score IS NULL',
    participantId,
  );
  const next = pending && pending.c > 0 ? 'submitted' : 'graded';
  if (next !== participant.status) run('UPDATE participants SET status = ? WHERE id = ?', next, participantId);
  return next;
}

/** Mark an in-progress attempt as submitted, then recompute totals/status. */
export function finalizeSubmission(participantRow) {
  const submittedAt = participantRow.submitted_at || now();
  // Practice attempts are flagged so results/dashboard/grading exclude them.
  let flags = participantFlags(participantRow);
  const assignment = one('SELECT * FROM assignments WHERE id = ?', participantRow.assignment_id);
  if (assignment) {
    const activity = one('SELECT * FROM activities WHERE id = ?', assignment.activity_id);
    const settings = settingsFor(assignment, activity ? definitionFromRow(activity) : null);
    if (settings.practice && !flags.includes('practice')) flags = [...flags, 'practice'];
  }
  run(
    "UPDATE participants SET status = 'submitted', submitted_at = ?, last_seen_at = ?, flags = ? WHERE id = ?",
    submittedAt,
    now(),
    JSON.stringify(flags),
    participantRow.id,
  );
  const totals = recomputeTotals(participantRow.id);
  recomputeStatus(participantRow.id);
  return { participant: one('SELECT * FROM participants WHERE id = ?', participantRow.id), totals };
}

// ---------------------------------------------------------------------------
// Student payloads
// ---------------------------------------------------------------------------

/** Collect every asset id referenced by an item's sanitized config. */
function collectAssetIds(item, into) {
  const config = item && item.config;
  if (!config || typeof config !== 'object') return;
  if ((item.type === 'pins' || item.type === 'image_boxes') && config.image && typeof config.image.assetId === 'string' && config.image.assetId) {
    into.add(config.image.assetId);
  }
  if (item.type === 'match') {
    for (const side of [...(Array.isArray(config.lefts) ? config.lefts : []), ...(Array.isArray(config.rights) ? config.rights : [])]) {
      if (side && (side.kind === 'image' || side.kind === 'audio') && typeof side.assetId === 'string' && side.assetId) into.add(side.assetId);
    }
  }
}

/** Add /assets/<id>/<filename> URLs for every referenced asset (student payloads only). */
export function enrichPinImageUrls(items) {
  const assetIds = new Set();
  for (const item of items) collectAssetIds(item, assetIds);
  if (assetIds.size === 0) return items;
  const rows = all(
    `SELECT id, filename FROM assets WHERE id IN (${[...assetIds].map(() => '?').join(',')})`,
    ...assetIds,
  );
  const filenames = new Map(rows.map((row) => [row.id, row.filename]));
  const urlFor = (assetId) => (filenames.has(assetId) ? `/assets/${assetId}/${encodeURIComponent(filenames.get(assetId))}` : null);
  for (const item of items) {
    const config = item && item.config;
    if (!config) continue;
    if ((item.type === 'pins' || item.type === 'image_boxes') && config.image && typeof config.image.assetId === 'string') {
      const url = urlFor(config.image.assetId);
      if (url) config.image = { ...config.image, url };
    }
    if (item.type === 'match') {
      for (const key of ['lefts', 'rights']) {
        if (!Array.isArray(config[key])) continue;
        config[key] = config[key].map((side) => {
          if (!side || (side.kind !== 'image' && side.kind !== 'audio') || typeof side.assetId !== 'string') return side;
          const url = urlFor(side.assetId);
          return url ? { ...side, url } : side;
        });
      }
    }
  }
  return items;
}

/** Student-safe activity with assignment item order + pin image URLs. */
export function sanitizedActivityFor(assignmentRow, activityRow) {
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(assignmentRow, definition);
  const order = itemOrderFor(definition, settings, assignmentRow.id);
  const sanitized = sanitizeActivity(definition);
  const byId = new Map(sanitized.items.map((item) => [item.id, item]));
  sanitized.settings = settings;
  sanitized.items = order.map((itemId) => byId.get(itemId)).filter(Boolean);
  enrichPinImageUrls(sanitized.items);
  return sanitized;
}

function textAnswerFor(item) {
  try {
    return itemAnswerText(item);
  } catch {
    return [];
  }
}

function keyFor(item) {
  try {
    return itemAnswerKey(item);
  } catch {
    return null;
  }
}

/**
 * Submit/result payload: per-item student results. Answer material is only
 * included when the effective showAnswers setting is on (contract: showAnswers
 * only applies together with allowReview).
 */
export function resultPayload(participantRow, assignmentRow, activityRow) {
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(assignmentRow, definition);
  const order = itemOrderFor(definition, settings, assignmentRow.id);
  const byId = new Map(definition.items.map((item) => [item.id, item]));
  const rows = all('SELECT * FROM responses WHERE participant_id = ?', participantRow.id);
  const byItem = new Map(rows.map((row) => [row.item_id, row]));
  const showResults = settings.showResults !== false;
  const showAnswers = !!(settings.showAnswers && settings.allowReview);
  const items = [];

  order.forEach((itemId) => {
    const item = byId.get(itemId);
    if (!item) return;
    const module = getType(item.type);
    if (!module || !module.meta || !module.meta.scoreable) return;
    const row = byItem.get(itemId);
    const entry = {
      itemId,
      correct: row ? !!row.correct : false,
      autoScore: row ? roundScore(row.auto_score) : 0,
      maxScore: row ? roundScore(row.max_score) : roundScore(item.points),
      needsManual: row ? !!row.needs_manual : false,
    };
    if (row) entry.response = parseJson(row.response, {});
    else if (module.normalizeResponse) entry.response = {};
    if (showAnswers) {
      const answerText = textAnswerFor(item);
      if (answerText.length > 0) entry.answerText = answerText;
      const answer = keyFor(item);
      if (answer) entry.answer = answer;
      if (item.type === 'pins') {
        try {
          const zones = itemAnswerZones(item);
          if (zones) entry.answerZones = zones;
        } catch {
          /* ignore */
        }
      }
    }
    items.push(entry);
  });

  return {
    participant: {
      id: participantRow.id,
      name: participantRow.name,
      status: participantRow.status,
      score: roundScore(participantRow.score),
      maxScore: roundScore(participantRow.max_score),
    },
    result: {
      showResults,
      showAnswers,
      score: roundScore(participantRow.score),
      maxScore: roundScore(participantRow.max_score),
      items,
    },
  };
}

// ---------------------------------------------------------------------------
// SSE publishing helpers
// ---------------------------------------------------------------------------

export function snapshotPayload(assignmentRow, activityRow) {
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(assignmentRow, definition);
  const order = itemOrderFor(definition, settings, assignmentRow.id);
  const items = itemBriefs(definition, order);
  return {
    type: 'snapshot',
    at: now(),
    items,
    players: livePlayers(assignmentRow.id, items.map((item) => item.id)),
  };
}

export function publishParticipantEvent(assignmentRow, activityRow, participantRow, action) {
  if (isPracticeParticipant(participantRow)) return; // practice attempts stay out of the live dashboard
  const definition = definitionFromRow(activityRow);
  const settings = settingsFor(assignmentRow, definition);
  const order = scoreableItemIds(definition, itemOrderFor(definition, settings, assignmentRow.id));
  const responses = all('SELECT * FROM responses WHERE participant_id = ?', participantRow.id);
  const fresh = one('SELECT * FROM participants WHERE id = ?', participantRow.id) || participantRow;
  publish(assignmentRow.id, {
    type: 'participant',
    action,
    participant: livePlayer(fresh, order, responses),
  });
}

export function publishResponseEvent(assignmentRow, participantRow, itemId, responseRow, totals) {
  if (isPracticeParticipant(participantRow)) return;
  publish(assignmentRow.id, {
    type: 'response',
    participantId: participantRow.id,
    itemId,
    state: stateForRow(responseRow),
    autoScore: roundScore(responseRow.auto_score),
    maxScore: roundScore(responseRow.max_score),
    needsManual: !!responseRow.needs_manual,
    score: roundScore(totals.score),
    maxScoreTotal: roundScore(totals.maxScore),
  });
}

/** Drop in-memory presence for every participant of an assignment (deletion). */
export function forgetAssignmentPresence(assignmentId) {
  const rows = all('SELECT id FROM participants WHERE assignment_id = ?', assignmentId);
  for (const row of rows) forgetPresence(row.id);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function slugify(value) {
  const umlauts = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
  const text = String(value || '')
    .replace(/[äöüßÄÖÜ]/g, (char) => umlauts[char])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return text || 'activity';
}

export function shortItemId() {
  return shortId('it');
}
