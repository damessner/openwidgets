// Text-to-speech via Mistral Voxtral (POST /v1/audio/speech). Used to
// generate listening audios for worksheets; the API key never leaves the
// server. `fetchImpl` is injectable for tests.
import { HttpError } from '../lib/http.js';
import { resolveLlmConfig, isTtsAvailable } from './core.js';
import { splitVorlesetext } from '../../shared/items/text.js';

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
  const raw = Array.isArray(payload) ? payload : payload.items || payload.voices || payload.data || [];
  return raw.map((v) => ({
    id: String(v.slug || v.voice_id || v.id || ''),
    name: String(v.name || v.slug || v.id || ''),
    gender: v.gender || '',
    language: Array.isArray(v.languages) && v.languages.length ? v.languages[0] : v.language || '',
  })).filter((v) => v.id);
}

/** Last-resort preset voice (docs example) when the voices list is unreachable. */
const FALLBACK_VOICE = 'voice_592';

let cachedDefaultVoice = null;

/** Pick a voice: configured voice, else the first English preset voice from the API. */
async function resolveVoiceId(cfg, voice, fetchImpl) {
  if (voice) return voice;
  if (cfg.voice) return cfg.voice;
  if (cachedDefaultVoice) return cachedDefaultVoice;
  try {
    const voices = await listVoices(fetchImpl);
    const preset = voices.find((v) => /^en/i.test(v.language)) || voices[0];
    if (preset) {
      cachedDefaultVoice = preset.id;
      return preset.id;
    }
  } catch {
    /* fall through to the fallback preset */
  }
  return FALLBACK_VOICE;
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
  const input = splitVorlesetext(String(text || '')).text.trim();
  if (!input) throw new HttpError(400, 'tts_empty', 'No text to speak');
  if (input.length > MAX_TTS_CHARS) throw new HttpError(400, 'tts_too_long', `Text too long (max ${MAX_TTS_CHARS} characters)`);

  const base = cfg.baseUrl.replace(/\/+$/, '');
  const model = cfg.ttsModel || 'voxtral-mini-tts-3-0';
  const voiceId = await resolveVoiceId(cfg, voice, fetchImpl);
  const body = { model, input, response_format: 'mp3', voice: voiceId };

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
  // The endpoint answers either raw audio bytes OR a JSON envelope with
  // base64 audio ({"audio_data": "..."}) — handle both.
  const contentType = String((response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : '') || '');
  let bytes;
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    const b64 = String(payload.audio_data || payload.audio || payload.data || '');
    if (!b64) throw new HttpError(502, 'tts_failed', 'Mistral TTS returned a JSON envelope without audio data');
    bytes = Buffer.from(b64, 'base64');
  } else {
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length < 100) throw new HttpError(502, 'tts_failed', 'Mistral TTS returned an empty audio response');
  // sanity: MP3 starts with an ID3 tag or a frame sync byte
  const looksMp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!looksMp3) throw new HttpError(502, 'tts_failed', 'Mistral TTS did not return MP3 audio (unexpected payload)');
  return { bytes, mime: 'audio/mpeg', voice: voiceId, model };
}
