// LLM endpoints: admin configuration, teacher worksheet wizard, and the
// pseudonymized student feedback after submitting an assignment.
import { all, now, one, run, uid } from '../db.js';
import { assertSameOrigin, badRequest, HttpError, json, readJson } from '../lib/http.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { activityJson, definitionFromRow, requireParticipantAuth } from './_helpers.js';
import { chatJson, isLlmEnabled, isTtsAvailable, llmRateLimit, PROVIDERS, publicLlmConfig, resolveLlmConfig, saveLlmConfig } from '../llm/core.js';
import { listVoices, MAX_TTS_CHARS, synthesizeSpeech } from '../llm/tts.js';
import { assetJson, storeAssetBytes } from './assets.js';
import { buildFeedbackPrompt, buildWorksheetPrompt, LENGTH_PRESETS, MIX_PRESETS, sanitizeFeedback, sanitizeGeneratedDefinition } from '../llm/prompts.js';
import { getType } from '../../shared/items/index.js';
import { itemIsScoreable } from '../../shared/activity.js';
import { log } from '../config.js';

const GENERATE_LIMIT_PER_HOUR = 12;
const FEEDBACK_LIMIT_PER_HOUR = 5;

function requireLlmEnabled() {
  if (!isLlmEnabled()) {
    throw new HttpError(409, 'llm_disabled', 'LLM features are not configured (admin settings)');
  }
}

/** Pseudonymized per-item results — never includes the participant name. */
function pseudonymizedResults(activityRow, participantId) {
  const definition = definitionFromRow(activityRow);
  const rows = all('SELECT * FROM responses WHERE participant_id = ?', participantId);
  const byItem = new Map(rows.map((row) => [row.item_id, row]));
  const results = [];
  for (const item of definition.items) {
    if (!itemIsScoreable(item)) continue;
    const row = byItem.get(item.id);
    results.push({
      stem: String(item.stem || '').replace(/\s+/g, ' ').slice(0, 160),
      type: item.type,
      correct: row ? !!row.correct : false,
      autoScore: row ? Number(row.auto_score) || 0 : 0,
      maxScore: row ? Number(row.max_score) || Number(item.points) || 0 : Number(item.points) || 0,
      needsManual: row ? !!row.needs_manual : false,
    });
  }
  return { definition, results };
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Configuration (teacher reads masked config; admin writes it)
  // -------------------------------------------------------------------------
  router.get('/api/llm/config', async (req, res) => {
    requireUser(req);
    json(res, 200, publicLlmConfig());
  });

  router.put('/api/llm/config', async (req, res) => {
    assertSameOrigin(req);
    requireAdmin(req);
    const body = await readJson(req, 16 * 1024);
    json(res, 200, saveLlmConfig(body || {}));
  });

  router.post('/api/llm/test', async (req, res) => {
    assertSameOrigin(req);
    requireAdmin(req);
    requireLlmEnabled();
    const started = Date.now();
    const cfg = resolveLlmConfig();
    try {
      const answer = await chatJson({
        system: 'You are a JSON-only assistant. Reply with exactly {"ok":true} and nothing else.',
        user: 'Ping. Reply with {"ok":true}.',
        temperature: 0,
      });
      json(res, 200, { ok: answer && answer.ok === true, model: cfg.model, provider: cfg.provider, latencyMs: Date.now() - started });
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(
          error.status,
          error.code,
          `${error.message} — Anbieter: ${cfg.provider}, Modell: „${cfg.model}“. Bitte Modell/Key in den Admin-Einstellungen prüfen (Vorschläge siehe Modell-Liste).`,
        );
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // Teacher: text-to-speech (Mistral Voxtral) — generate a listening audio
  // from a text and store it as an asset (mp3) the teacher can attach.
  // -------------------------------------------------------------------------
  router.get('/api/llm/tts/voices', async (req, res) => {
    requireUser(req);
    if (!isTtsAvailable()) throw new HttpError(409, 'tts_unavailable', 'TTS needs the Mistral provider with an API key');
    const voices = await listVoices();
    json(res, 200, { voices });
  });

  router.post('/api/llm/tts', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    if (!isTtsAvailable()) throw new HttpError(409, 'tts_unavailable', 'TTS needs the Mistral provider with an API key (admin → LLM settings)');
    llmRateLimit(`tts:${user.id}`, 30);
    const body = await readJson(req, 256 * 1024);
    const text = String(body.text || '');
    if (!text.trim()) throw badRequest('tts_empty', 'text is required');
    if (text.length > MAX_TTS_CHARS) throw badRequest('tts_too_long', `text must be at most ${MAX_TTS_CHARS} characters`);
    const voice = typeof body.voice === 'string' ? body.voice.trim().slice(0, 100) : '';
    const speed = body.speed === 'slow' ? 'slow' : 'normal';

    const result = await synthesizeSpeech({ text, voice, speed });
    const slug = text.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'tts';
    const row = await storeAssetBytes({
      ownerId: user.id,
      bytes: result.bytes,
      mime: result.mime,
      filename: `${slug}${speed === 'slow' ? '-langsam' : ''}.mp3`,
    });
    log(`LLM: TTS for user ${user.id} (${result.model}, voice ${result.voice || 'default'}, ${result.speed}${result.speedApplied ? '' : ' (tempo n/a)'}, ${result.bytes.length} bytes)`);
    json(res, 201, { asset: assetJson(row), voice: result.voice, model: result.model, characters: text.length, speakers: result.speakers, speed: result.speed, speedApplied: result.speedApplied });
  });

  // -------------------------------------------------------------------------
  // Teacher: AI worksheet wizard
  // -------------------------------------------------------------------------
  router.post('/api/llm/generate-worksheet', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    requireLlmEnabled();
    llmRateLimit(`llm-gen:${user.id}`, GENERATE_LIMIT_PER_HOUR);
    const body = await readJson(req, 16 * 1024);

    const topic = String(body.topic || '').trim();
    if (topic.length < 3 || topic.length > 300) {
      throw badRequest('validation_failed', 'topic must be 3–300 characters', [
        { path: 'topic', message: 'topic is required (3–300 characters)' },
      ]);
    }
    const length = LENGTH_PRESETS[body.length] ? body.length : 'medium';
    const mix = body.mix in MIX_PRESETS ? body.mix : 'normal';
    const template = body.template === 'quiz' ? 'quiz' : 'worksheet';
    const locale = body.locale === 'en' ? 'en' : 'de';
    const preset = LENGTH_PRESETS[length];

    const { system, user: prompt } = buildWorksheetPrompt({
      topic,
      subject: String(body.subject || '').slice(0, 120),
      grade: String(body.grade || '').slice(0, 120),
      locale,
      length,
      mix,
      template,
      title: String(body.title || '').slice(0, 200),
    });

    const raw = await chatJson({ system, user: prompt, temperature: 0.5 });
    const { definition, dropped, total } = sanitizeGeneratedDefinition(raw, {
      locale,
      template,
      maxItems: preset.max,
    });

    const id = uid();
    const timestamp = now();
    run(
      'INSERT INTO activities (id, owner_id, title, description, template, locale, definition, status, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      definition.title,
      definition.description,
      definition.template,
      definition.locale,
      JSON.stringify(definition),
      'draft',
      1,
      timestamp,
      timestamp,
    );
    log(`LLM: user ${user.id} generated worksheet ${id} (${definition.items.length} items, ${dropped}/${total} dropped)`);
    json(res, 201, {
      activity: activityJson(one('SELECT * FROM activities WHERE id = ?', id)),
      dropped,
      total,
    });
  });

  // -------------------------------------------------------------------------
  // Student: individual feedback after submit (cached on the participant)
  // -------------------------------------------------------------------------
  router.get('/api/llm/feedback', async (req, res) => {
    const { participant } = requireParticipantAuth(req);
    const cached = participant.ai_feedback ? JSON.parse(participant.ai_feedback) : null;
    json(res, 200, { feedback: cached, llmEnabled: isLlmEnabled() });
  });

  router.post('/api/llm/feedback', async (req, res) => {
    assertSameOrigin(req);
    const { participant, assignment, activity } = requireParticipantAuth(req);
    requireLlmEnabled();
    llmRateLimit(`llm-fb:${participant.id}`, FEEDBACK_LIMIT_PER_HOUR);

    if (participant.status === 'in_progress') {
      throw new HttpError(409, 'not_submitted', 'Feedback is available after submitting');
    }
    if (participant.ai_feedback) {
      json(res, 200, { feedback: JSON.parse(participant.ai_feedback), cached: true });
      return;
    }

    const { definition, results } = pseudonymizedResults(activity, participant.id);
    const { system, user: prompt } = buildFeedbackPrompt({
      locale: definition.locale === 'en' ? 'en' : 'de',
      activityTitle: definition.title,
      results,
    });
    const raw = await chatJson({ system, user: prompt, temperature: 0.6 });
    const feedback = sanitizeFeedback(raw);
    run('UPDATE participants SET ai_feedback = ? WHERE id = ?', JSON.stringify(feedback), participant.id);
    log(`LLM: feedback for participant ${participant.id} on assignment ${assignment.id} (${results.length} items, pseudonymized)`);
    json(res, 200, { feedback, cached: false });
  });
}
