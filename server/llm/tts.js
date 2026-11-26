// Text-to-speech via Mistral Voxtral (POST /v1/audio/speech). Used to
// generate listening audios for worksheets; the API key never leaves the
// server. `fetchImpl` is injectable for tests.
import { HttpError } from '../lib/http.js';
import { resolveLlmConfig, isTtsAvailable } from './core.js';
import { splitVorlesetext, parseDialogue } from '../../shared/items/text.js';
import { concatMp3Buffers, changeTempoMp3 } from '../lib/audio.js';

export const MAX_TTS_CHARS = 8000;
export const SLOW_TEMPO = 0.72;

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
 * Assign a voice to every distinct speaker of a parsed dialogue.
 * - explicit map from the LLM settings (voiceMap, case-insensitive) wins
 * - narrator ('') uses the configured default voice
 * - unmapped speakers rotate through the English preset voices, skipping
 *   voices already used, so two speakers never share a voice by accident
 * Returns Map(speaker -> voiceSlug); '' is the narrator.
 */
export async function assignSpeakerVoices(speakers, cfg, fetchImpl = globalThis.fetch) {
  const assignment = new Map();
  const used = new Set();
  let presets = [];
  try {
    presets = (await listVoices(fetchImpl)).filter((v) => /^en/i.test(v.language) || !v.language);
  } catch { /* presets stay empty → FALLBACK_VOICE rotation */ }
  const defaultVoice = await resolveVoiceId(cfg, '', fetchImpl);
  if (!speakers.includes('')) assignment.set('', defaultVoice);
  used.add(assignment.get('') || defaultVoice);
  let presetIdx = 0;
  for (const speaker of speakers) {
    if (speaker === '') continue;
    const mapped = (cfg.voiceMap && cfg.voiceMap[speaker.toLowerCase()]) || '';
    if (mapped) {
      assignment.set(speaker, mapped);
      used.add(mapped);
      continue;
    }
    let voice = '';
    while (presetIdx < presets.length + 1) {
      const candidate = presets.length ? presets[presetIdx % presets.length].id : FALLBACK_VOICE;
      presetIdx += 1;
      if (!used.has(candidate)) { voice = candidate; break; }
    }
    if (!voice) voice = FALLBACK_VOICE;
    assignment.set(speaker, voice);
    used.add(voice);
  }
  return assignment;
}

/** One speech request → validated MP3 bytes. */
async function speakSegment({ base, model, input, voiceId, auth, fetchImpl }) {
  const body = { model, input, response_format: 'mp3', voice: voiceId };
  let response;
  try {
    response = await fetchImpl(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: auth,
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
  return bytes;
}

/**
 * Synthesize `text` to MP3 bytes via Mistral Voxtral TTS.
 * - VORLESETEXT marker line is stripped; `Name: "…"` dialogue lines are spoken
 *   by a per-speaker voice (voiceMap in LLM settings, else preset rotation)
 *   and concatenated with short pauses.
 * - speed: 'normal' | 'slow' (slow = ffmpeg atempo, needs ffmpeg; otherwise
 *   the normal-speed audio is returned with speedApplied=false).
 * Returns { bytes, mime, voice, model, speakers, speed, speedApplied }.
 */
export async function synthesizeSpeech({ text, voice, speed = 'normal', fetchImpl = globalThis.fetch } = {}) {
  const cfg = resolveLlmConfig();
  if (!isTtsAvailable()) {
    throw new HttpError(409, 'tts_unavailable', 'TTS needs the Mistral provider with an API key (admin → LLM settings)');
  }
  const rawText = splitVorlesetext(String(text || '')).text;
  if (!rawText.trim()) throw new HttpError(400, 'tts_empty', 'No text to speak');
  if (String(text || '').length > MAX_TTS_CHARS) throw new HttpError(400, 'tts_too_long', `Text too long (max ${MAX_TTS_CHARS} characters)`);

  const base = cfg.baseUrl.replace(/\/+$/, '');
  const model = cfg.ttsModel || 'voxtral-mini-tts-3-0';
  const auth = authHeaders(cfg);
  const segments = parseDialogue(String(text || ''));
  const wantSlow = speed === 'slow';

  let bytes;
  let speakers = [];
  let voiceSummary;
  if (segments.length <= 1) {
    const input = (segments[0] && segments[0].text) || rawText.trim();
    const voiceId = await resolveVoiceId(cfg, voice, fetchImpl);
    bytes = await speakSegment({ base, model, input, voiceId, auth, fetchImpl });
    voiceSummary = voiceId;
  } else {
    // dialogue: one request per segment with the speaker's voice
    const speakerNames = [...new Set(segments.map((s) => s.speaker))];
    const assignment = await assignSpeakerVoices(speakerNames, cfg, fetchImpl);
    const parts = await Promise.all(segments.map(async (seg) => {
      const voiceId = seg.speaker === ''
        ? await resolveVoiceId(cfg, voice, fetchImpl)
        : (assignment.get(seg.speaker) || await resolveVoiceId(cfg, voice, fetchImpl));
      const partBytes = await speakSegment({ base, model, input: seg.text, voiceId, auth, fetchImpl });
      return { speaker: seg.speaker, voice: voiceId, bytes: partBytes };
    }));
    speakers = speakerNames.map((name) => ({ speaker: name, voice: (parts.find((p) => p.speaker === name) || {}).voice || '' }));
    voiceSummary = speakers.map((s) => (s.speaker ? `${s.speaker}=${s.voice}` : `narrator=${s.voice}`)).join(', ');
    bytes = await concatMp3Buffers(parts.map((p) => p.bytes), { pauseSec: 0.45 });
  }

  let speedApplied = false;
  if (wantSlow) {
    const slowed = await changeTempoMp3(bytes, SLOW_TEMPO);
    if (slowed !== bytes) {
      bytes = slowed;
      speedApplied = true;
    }
  }
  return { bytes, mime: 'audio/mpeg', voice: voiceSummary, model, speakers, speed: wantSlow ? 'slow' : 'normal', speedApplied };
}
