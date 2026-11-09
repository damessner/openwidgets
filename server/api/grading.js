// Teacher grading API — CONTRACT.md §5.5. Manual scores/feedback, force submit,
// reset, delete; all ownership-checked through the assignment.
import { all, now, one, run, tx, uid } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { assertSameOrigin, badRequest, json, noContent, notFound, readJson } from '../lib/http.js';
import { forgetPresence } from '../lib/events.js';
import { activityStats } from '../../shared/activity.js';
import { getType } from '../../shared/items/index.js';
import {
  definitionFromRow,
  finalizeSubmission,
  participantJson,
  publishParticipantEvent,
  publishResponseEvent,
  recomputeStatus,
  recomputeTotals,
  requireOwnedAssignment,
  responseTeacherJson,
  roundScore,
  settingsFor,
} from './_helpers.js';

function loadParticipantForTeacher(req, participantId) {
  const participant = one('SELECT * FROM participants WHERE id = ?', String(participantId));
  if (!participant) throw notFound('participant_not_found');
  const { assignment, activity } = requireOwnedAssignment(req, participant.assignment_id);
  return { participant, assignment, activity };
}

function rePublishParticipant(assignment, activity, participant, action) {
  const fresh = one('SELECT * FROM participants WHERE id = ?', participant.id);
  publishParticipantEvent(assignment, activity, fresh || participant, action);
  return fresh || participant;
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Full review payload for one student (raw definition + raw responses)
  // -------------------------------------------------------------------------
  router.get('/api/participants/:id/review', async (req, res, params) => {
    requireUser(req);
    const { participant, assignment, activity } = loadParticipantForTeacher(req, params.id);
    const definition = definitionFromRow(activity);
    const settings = settingsFor(assignment, definition);
    const responses = all(
      'SELECT * FROM responses WHERE participant_id = ? ORDER BY updated_at ASC',
      participant.id,
    );
    const activityJson = {
      id: activity.id,
      title: activity.title,
      description: activity.description,
      template: activity.template,
      locale: activity.locale,
      revision: activity.revision,
      status: activity.status,
      definition,
    };
    json(res, 200, {
      participant: {
        ...participantJson(participant),
        startedAt: participant.started_at,
      },
      assignment: {
        id: assignment.id,
        activityId: assignment.activity_id,
        title: assignment.title,
        code: assignment.code,
        status: assignment.status,
        settings,
        dueAt: assignment.due_at || null,
        createdAt: assignment.created_at,
        template: activity.template,
        locale: activity.locale,
        maxScore: roundScore(activityStats(definition).maxScore),
      },
      activity: activityJson,
      responses: responses.map(responseTeacherJson),
    });
  });

  // -------------------------------------------------------------------------
  // Manual score / feedback for one item
  // -------------------------------------------------------------------------
  router.patch('/api/participants/:id/responses/:itemId', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { participant, assignment, activity } = loadParticipantForTeacher(req, params.id);
    const body = await readJson(req, 64 * 1024);
    const definition = definitionFromRow(activity);
    const rawItem = definition.items.find((item) => item.id === String(params.itemId));
    if (!rawItem) throw notFound('item_not_found');

    let row = one(
      'SELECT * FROM responses WHERE participant_id = ? AND item_id = ?',
      participant.id,
      rawItem.id,
    );
    if (!row) {
      // Teacher may award points for an unanswered item: create a placeholder row.
      const module = getType(rawItem.type);
      const needsManual = !!(module && module.meta && module.meta.scoreable) &&
        rawItem.type === 'long_answer';
      run(
        'INSERT INTO responses (id, participant_id, item_id, response, auto_score, max_score, correct, needs_manual, feedback, manual_score, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        uid(),
        participant.id,
        rawItem.id,
        '{}',
        0,
        roundScore(rawItem.points),
        0,
        needsManual ? 1 : 0,
        '',
        null,
        now(),
      );
      row = one('SELECT * FROM responses WHERE participant_id = ? AND item_id = ?', participant.id, rawItem.id);
    }

    const updates = {};
    if (body.manualScore !== undefined) {
      if (body.manualScore === null) {
        updates.manual_score = null;
      } else {
        const value = Number(body.manualScore);
        const maxScore = roundScore(row.max_score);
        if (!Number.isFinite(value) || value < 0 || value > maxScore + 1e-9) {
          throw badRequest('invalid_score', `manualScore must be between 0 and ${maxScore} (or null)`);
        }
        updates.manual_score = roundScore(value);
      }
    }
    if (body.feedback !== undefined) {
      if (body.feedback !== null && typeof body.feedback !== 'string') {
        throw badRequest('invalid_feedback', 'feedback must be a string');
      }
      const feedback = body.feedback === null ? '' : String(body.feedback);
      if (feedback.length > 2000) throw badRequest('invalid_feedback', 'feedback must be at most 2000 characters');
      updates.feedback = feedback;
    }

    if (Object.keys(updates).length > 0) {
      const fields = Object.keys(updates);
      run(
        `UPDATE responses SET ${fields.map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...fields.map((field) => updates[field]),
        now(),
        row.id,
      );
    }

    row = one('SELECT * FROM responses WHERE id = ?', row.id);
    // Long answers become "correct" only once a teacher awards full points.
    if (Number(row.needs_manual)) {
      const correct = row.manual_score === null ? 0 : Number(row.manual_score) >= Number(row.max_score) - 1e-9 ? 1 : 0;
      run('UPDATE responses SET correct = ? WHERE id = ?', correct, row.id);
      row.correct = correct;
    }

    const totals = recomputeTotals(participant.id);
    recomputeStatus(participant.id);
    publishResponseEvent(assignment, participant, rawItem.id, row, totals);
    rePublishParticipant(assignment, activity, participant, 'updated');
    json(res, 200, {
      response: responseTeacherJson(row),
      participantTotals: totals,
    });
  });

  // -------------------------------------------------------------------------
  // Force submit (teacher)
  // -------------------------------------------------------------------------
  router.post('/api/participants/:id/submit', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { participant, assignment, activity } = loadParticipantForTeacher(req, params.id);
    let fresh = participant;
    if (participant.status === 'in_progress') {
      const finalized = finalizeSubmission(participant);
      fresh = finalized.participant;
      publishParticipantEvent(assignment, activity, fresh, 'submitted');
    }
    json(res, 200, { participant: participantJson(fresh) });
  });

  // -------------------------------------------------------------------------
  // Reset an attempt (teacher, destructive — the UI must confirm)
  // -------------------------------------------------------------------------
  router.post('/api/participants/:id/reset', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { participant, assignment, activity } = loadParticipantForTeacher(req, params.id);
    const definition = definitionFromRow(activity);
    const maxScore = activityStats(definition).maxScore;
    const timestamp = now();
    tx(() => {
      run('DELETE FROM responses WHERE participant_id = ?', participant.id);
      run(
        "UPDATE participants SET status = 'in_progress', score = 0, max_score = ?, started_at = ?, submitted_at = NULL, last_seen_at = ? WHERE id = ?",
        roundScore(maxScore),
        timestamp,
        timestamp,
        participant.id,
      );
    });
    const fresh = one('SELECT * FROM participants WHERE id = ?', participant.id);
    publishParticipantEvent(assignment, activity, fresh, 'reset');
    json(res, 200, { participant: participantJson(fresh) });
  });

  // -------------------------------------------------------------------------
  // Delete a participant and everything they submitted
  // -------------------------------------------------------------------------
  router.delete('/api/participants/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    const { participant } = loadParticipantForTeacher(req, params.id);
    tx(() => {
      run('DELETE FROM events WHERE participant_id = ?', participant.id);
      run('DELETE FROM participants WHERE id = ?', participant.id);
    });
    forgetPresence(participant.id);
    noContent(res);
  });
}
