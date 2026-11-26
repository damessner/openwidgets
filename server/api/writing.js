// Writing tasks: AI feedback loops for students (pseudonymized, rate
// limited, stored per loop) and the teacher monitor for a live assignment.
import { all, now, one, run, uid } from '../db.js';
import { assertSameOrigin, badRequest, HttpError, json, readJson } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { definitionFromRow, requireOwnedAssignment, requireParticipantAuth } from './_helpers.js';
import { chatJson, isLlmEnabled, llmRateLimit } from '../llm/core.js';
import { buildWritingFeedbackPrompt, sanitizeWritingFeedback } from '../llm/prompts.js';
import { normalizeItem } from '../../shared/items/index.js';
import { findUsedWords } from '../../shared/items/writing.js';
import { log } from '../config.js';

const FEEDBACK_LIMIT_PER_HOUR = 10;

function writingItemOf(activityRow, itemId) {
  const definition = definitionFromRow(activityRow);
  const item = (definition.items || []).find((entry) => entry && entry.id === String(itemId));
  if (!item || item.type !== 'writing') return null;
  return normalizeItem(item);
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Student: request an interim AI feedback loop for a writing item.
  // Pseudonymized: the pupil's name is never sent to the LLM.
  // -------------------------------------------------------------------------
  router.post('/api/llm/writing-feedback', async (req, res) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    if (!isLlmEnabled()) throw new HttpError(409, 'llm_disabled', 'LLM features are not configured (admin settings)');
    llmRateLimit(`llm-writing:${participant.id}`, FEEDBACK_LIMIT_PER_HOUR);
    const body = await readJson(req, 256 * 1024);

    const item = writingItemOf(activity, body.itemId);
    if (!item) throw badRequest('not_a_writing_item', 'itemId is not a writing task of this activity');
    const text = String(body.text || '');
    if (text.trim().length < 10) {
      throw badRequest('text_too_short', 'Write at least a few words before asking for feedback');
    }
    if (text.length > 100000) throw badRequest('text_too_long', 'Text is too long');
    if (participant.status !== 'in_progress') {
      throw new HttpError(409, 'attempt_submitted', 'This attempt has already been submitted');
    }

    const config = item.config;
    const existing = all(
      'SELECT * FROM writing_feedback WHERE participant_id = ? AND item_id = ? ORDER BY loop ASC',
      participant.id, item.id,
    );
    const loop = existing.length + 1;
    const previous = existing.length ? JSON.parse(existing[existing.length - 1].feedback) : null;

    const { system, user: prompt } = buildWritingFeedbackPrompt({
      locale: definitionFromRow(activity).locale === 'en' ? 'en' : 'de',
      gradeLevel: config.gradeLevel,
      criteria: config.criteria,
      sourceText: config.sourceText,
      text,
      loop,
      previous,
      requiredWords: config.requiredWords,
    });
    const raw = await chatJson({ system, user: prompt, temperature: 0.5 });
    const feedback = sanitizeWritingFeedback(raw, config.criteria);
    feedback.loop = loop;
    // Deterministic word-box check (students see the same rule as the UI):
    // which required words are used / still missing in this draft.
    const wordCheck = Array.isArray(config.requiredWords) && config.requiredWords.length
      ? findUsedWords(text, config.requiredWords)
      : null;
    if (wordCheck) feedback.requiredWords = { used: wordCheck.used, missing: wordCheck.missing };

    run(
      'INSERT INTO writing_feedback (id, participant_id, item_id, loop, text, feedback, created_at) VALUES (?,?,?,?,?,?,?)',
      uid(), participant.id, item.id, loop, text.slice(0, 100000), JSON.stringify(feedback), now(),
    );
    log(`LLM: writing feedback loop ${loop} for participant ${participant.id}, item ${item.id} (pseudonymized)`);
    json(res, 200, { feedback, loop });
  });

  // -------------------------------------------------------------------------
  // Student: list own feedback loops for an item (e.g. in the result view)
  // -------------------------------------------------------------------------
  router.get('/api/llm/writing-feedback/:itemId', async (req, res, params) => {
    const { participant } = requireParticipantAuth(req);
    const rows = all(
      'SELECT loop, feedback, created_at FROM writing_feedback WHERE participant_id = ? AND item_id = ? ORDER BY loop ASC',
      participant.id, String(params.itemId || ''),
    ).map((row) => ({ loop: row.loop, feedback: JSON.parse(row.feedback), createdAt: row.created_at }));
    json(res, 200, { loops: rows });
  });

  // -------------------------------------------------------------------------
  // Teacher: monitor a live writing assignment — drafts, loops, progress.
  // -------------------------------------------------------------------------
  router.get('/api/writing/monitor/:assignmentId', async (req, res, params) => {
    requireUser(req);
    const { assignment, activity } = requireOwnedAssignment(req, params.assignmentId);
    const definition = definitionFromRow(activity);
    const writingItems = (definition.items || []).filter((item) => item && item.type === 'writing');

    const participants = all(
      `SELECT p.id, p.name, p.status, p.score, p.max_score, p.submitted_at, p.last_seen_at
       FROM participants p WHERE p.assignment_id = ? ORDER BY p.name COLLATE NOCASE`,
      assignment.id,
    );
    const result = [];
    for (const participant of participants) {
      const responses = all('SELECT item_id, response, updated_at FROM responses WHERE participant_id = ?', participant.id);
      const byItem = new Map(responses.map((row) => [row.item_id, row]));
      const loops = all(
        'SELECT item_id, loop, text, feedback, created_at FROM writing_feedback WHERE participant_id = ? ORDER BY item_id, loop ASC',
        participant.id,
      );
      const items = writingItems.map((item) => {
        const responseRow = byItem.get(item.id);
        const itemLoops = loops.filter((row) => row.item_id === item.id).map((row) => ({
          loop: row.loop,
          createdAt: row.created_at,
          feedback: JSON.parse(row.feedback),
        }));
        const currentText = responseRow ? String(JSON.parse(responseRow.response || '{}').text || '') : '';
        const latest = itemLoops.length ? itemLoops[itemLoops.length - 1].feedback : null;
        return {
          itemId: item.id,
          stem: item.stem,
          criteria: item.config.criteria,
          draft: currentText.slice(0, 400),
          draftWords: currentText.trim() ? currentText.trim().split(/\s+/).length : 0,
          lastSavedAt: responseRow ? responseRow.updated_at : null,
          loopCount: itemLoops.length,
          latestFeedback: latest,
          loops: itemLoops,
        };
      });
      result.push({
        participantId: participant.id,
        name: participant.name,
        status: participant.status,
        score: participant.score,
        maxScore: participant.max_score,
        submittedAt: participant.submitted_at,
        lastSeenAt: participant.last_seen_at,
        items,
      });
    }
    json(res, 200, {
      assignment: { id: assignment.id, code: assignment.code, title: assignment.title },
      activityTitle: definition.title,
      writingItems: writingItems.map((item) => ({ id: item.id, stem: item.stem })),
      participants: result,
    });
  });
}
