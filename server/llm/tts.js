// Text-to-speech via Mistral Voxtral (POST /v1/audio/speech). Used to
// generate listening audios for worksheets; the API key never leaves the
// server. `fetchImpl` is injectable for tests.
import { HttpError } from '../lib/http.js';
import { resolveLlmConfig, isTtsAvailable } from './core.js';

export const MAX_TTS_CHARS = 8000;

function authHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
}

/** List available preset/cloned voices (GET /v1/audio/voices). */
export async function listVoices(fetchImpl = globalThis.fetch) {
  const cfg = resolveLlmConfig();
  if (!isTtsAvailable()) throw new HttpError(409, 'tts_unavailable', 'TTS is available with the Mistral provider (La Plateforme API key)');
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/v1/audio/voices`, {
    method: 'GET',
    headers: authHeaders(cfg),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new HttpError(502, 'tts_failed', `Mistral voices endpoint answered ${response.status}`);
  }
  const payload = await response.json();
  const voices = Array.isArray(payload) ? payload : payload.voices || payload.data || [];
  return voices.map((v) => ({
    id: String(v.id || v.voice_id || ''),
    name: String(v.name || v.id || ''),
    gender: v.gender || '',
    language: v.language || v.languages?.[0] || '',
  })).filter((v) => v.id);
}

let cachedDefaultVoice = null;

/** Pick a voice: configured voice, else the first preset voice from the API. */
async function resolveVoiceId(cfg, voice, fetchImpl) {
  if (voice) return voice;
  if (cfg.voice) return cfg.voice;
  if (cachedDefaultVoice) return cachedDefaultVoice;
  try {
    const voices = await listVoices(fetchImpl);
    const preset = voices.find((v) => /en/i.test(v.language) || !v.language) || voices[0];
    if (preset) {
      cachedDefaultVoice = preset.id;
      return preset.id;
    }
  } catch {
    /* fall through to API default */
  }
  return '';
}

/**
 * Synthesize `text` to MP3 bytes via Mistral Voxtral TTS.
 * Returns { bytes: Buffer, mime: 'audio/mpeg', voice, model }.
 */
export async function synthesizeSpeech({ text, voice, fetchImpl = globalThis.fetch } = {}) {
  const cfg = resolveLlmConfig();
  if (!isTtsAvailable()) {
    throw new HttpError(409, 'tts_unavailable', 'TTS needs the Mistral provider with an API key (admin → LLM settings)');
  }
  const input = String(text || '').replace(/^VORLESETEXT[^\n]*\n?/im, '').trim();
  if (!input) throw new HttpError(400, 'tts_empty', 'No text to speak');
  if (input.length > MAX_TTS_CHARS) throw new HttpError(400, 'tts_too_long', `Text too long (max ${MAX_TTS_CHARS} characters)`);

  const base = cfg.baseUrl.replace(/\/+$/, '');
  const model = cfg.ttsModel || 'voxtral-mini-tts-3-0';
  const voiceId = await resolveVoiceId(cfg, voice, fetchImpl);
  const body = { model, input, response_format: 'mp3' };
  if (voiceId) body.voice_id = voiceId;

  let response;
  try {
    response = await fetchImpl(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new HttpError(502, 'tts_unreachable', `TTS request failed: ${error && error.message ? error.message : 'network error'}`);
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 300); } catch { /* ignore */ }
    throw new HttpError(502, 'tts_failed', `Mistral TTS answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) throw new HttpError(502, 'tts_failed', 'Mistral TTS returned an empty audio response');
  return { bytes, mime: 'audio/mpeg', voice: voiceId, model };
}
