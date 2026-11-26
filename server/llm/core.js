// LLM integration core: provider abstraction (Google Gemini + OpenRouter),
// configuration (settings table + env overrides), JSON chat helper, caching
// and rate limiting. The API key never leaves the server.
import crypto from 'node:crypto';
import { one, run } from '../db.js';
import { HttpError } from '../lib/http.js';

export const LLM_SETTINGS_KEY = 'llm_config';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    // Models with a usable free tier (API key required).
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    // Free models on OpenRouter carry a ":free" suffix and rate limits.
    models: [
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
      'deepseek/deepseek-chat-v3-0324:free',
    ],
  },
  mistral: {
    label: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'ministral-8b-latest', 'open-mistral-nemo'],
    // Voxtral TTS (POST /v1/audio/speech) — used to generate listening audios.
    ttsDefaultModel: 'voxtral-mini-tts-3-0',
    ttsModels: ['voxtral-mini-tts-3-0', 'voxtral-mini-tts-latest'],
  },
};

const DEFAULTS = { provider: 'gemini', enabled: true };

/**
 * Normalize a speaker→voice map ("Tom=voice_3150" lines, JSON or object) to a
 * clean object { lowercaseSpeaker: voiceSlug }. Max 20 entries.
 */
export function normalizeVoiceMap(input) {
  let raw = input;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) {
      try { raw = JSON.parse(trimmed); } catch { raw = {}; }
    } else {
      raw = Object.fromEntries(
        trimmed.split('\n').map((line) => {
          const idx = line.indexOf('=');
          return idx > 0 ? [line.slice(0, idx), line.slice(idx + 1)] : null;
        }).filter(Boolean),
      );
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key || '').trim().toLowerCase().slice(0, 40);
    const v = String(value || '').trim().slice(0, 100);
    if (k && v) out[k] = v;
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}

function storedConfig() {
  try {
    const row = one('SELECT value FROM settings WHERE key = ?', LLM_SETTINGS_KEY);
    const parsed = row ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolved LLM configuration. Environment variables win over the settings
 * table so an operator can lock the setup down via systemd.
 */
export function resolveLlmConfig() {
  const stored = storedConfig();
  const env = {
    provider: (process.env.OW_LLM_PROVIDER || '').trim(),
    apiKey: (process.env.OW_LLM_API_KEY || '').trim(),
    model: (process.env.OW_LLM_MODEL || '').trim(),
    baseUrl: (process.env.OW_LLM_BASE_URL || '').trim(),
    enabled: (process.env.OW_LLM_ENABLED || '').trim(),
    ttsModel: (process.env.OW_LLM_TTS_MODEL || '').trim(),
    voice: (process.env.OW_LLM_VOICE || '').trim(),
    voiceMap: (process.env.OW_LLM_VOICE_MAP || '').trim(),
  };
  const provider = env.provider || stored.provider || DEFAULTS.provider;
  const prov = PROVIDERS[provider] || null;
  const enabledRaw = env.enabled !== '' ? env.enabled : stored.enabled;
  const enabled = enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
    ? DEFAULTS.enabled
    : enabledRaw === true || enabledRaw === '1' || enabledRaw === 'true';
  return {
    provider,
    providerKnown: !!prov,
    apiKey: env.apiKey || (typeof stored.apiKey === 'string' ? stored.apiKey : ''),
    model: env.model || (typeof stored.model === 'string' && stored.model ? stored.model : '') || (prov ? prov.defaultModel : ''),
    baseUrl: env.baseUrl || (typeof stored.baseUrl === 'string' && stored.baseUrl ? stored.baseUrl : '') || (prov ? prov.defaultBaseUrl : ''),
    enabled,
    ttsModel: env.ttsModel || (typeof stored.ttsModel === 'string' && stored.ttsModel ? stored.ttsModel : '') || (prov && prov.ttsDefaultModel ? prov.ttsDefaultModel : ''),
    voice: env.voice || (typeof stored.voice === 'string' ? stored.voice : ''),
    voiceMap: Object.keys(normalizeVoiceMap(env.voiceMap)).length
      ? normalizeVoiceMap(env.voiceMap)
      : normalizeVoiceMap(stored.voiceMap),
    source: env.apiKey || env.provider || env.model || env.baseUrl || env.enabled || env.ttsModel || env.voice || env.voiceMap ? 'env' : 'db',
  };
}

export function isLlmEnabled() {
  const cfg = resolveLlmConfig();
  return !!(cfg.enabled && cfg.providerKnown && cfg.apiKey && cfg.baseUrl);
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Config as safe to send to a logged-in teacher (key masked). */
export function publicLlmConfig() {
  const cfg = resolveLlmConfig();
  const prov = PROVIDERS[cfg.provider] || PROVIDERS.gemini;
  return {
    enabled: isLlmEnabled(),
    active: !!(cfg.enabled && cfg.providerKnown),
    provider: cfg.provider,
    providerLabel: prov.label,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKeyMasked: maskKey(cfg.apiKey),
    hasApiKey: !!cfg.apiKey,
    keySource: cfg.source,
    ttsModel: cfg.ttsModel,
    ttsModels: prov.ttsModels || [],
    voice: cfg.voice,
    voiceMap: cfg.voiceMap,
    ttsAvailable: isTtsAvailable(),
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, models: p.models, defaultModel: p.defaultModel, ttsModels: p.ttsModels || [] }]),
    ),
  };
}

/** Admin-only save. `apiKey: ''` keeps the stored key. */
export function saveLlmConfig(input) {
  const stored = storedConfig();
  const provider = String(input.provider || stored.provider || DEFAULTS.provider);
  if (!PROVIDERS[provider]) {
    throw new HttpError(400, 'validation_failed', `Unknown provider "${provider}"`, [
      { path: 'provider', message: `provider must be one of: ${Object.keys(PROVIDERS).join(', ')}` },
    ]);
  }
  const next = {
    provider,
    apiKey: typeof input.apiKey === 'string' && input.apiKey !== '' ? input.apiKey : stored.apiKey || '',
    model: typeof input.model === 'string' ? input.model.trim() : stored.model || '',
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl.trim() : stored.baseUrl || '',
    enabled: typeof input.enabled === 'boolean' ? input.enabled : stored.enabled !== false,
    ttsModel: typeof input.ttsModel === 'string' ? input.ttsModel.trim() : stored.ttsModel || '',
    voice: typeof input.voice === 'string' ? input.voice.trim() : stored.voice || '',
    voiceMap: input.voiceMap !== undefined ? normalizeVoiceMap(input.voiceMap) : normalizeVoiceMap(stored.voiceMap),
  };
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', LLM_SETTINGS_KEY, JSON.stringify(next));
  return publicLlmConfig();
}

/** TTS (Voxtral speech generation) is available with the Mistral provider. */
export function isTtsAvailable() {
  const cfg = resolveLlmConfig();
  if (!cfg.enabled || !cfg.apiKey) return false;
  return cfg.provider === 'mistral' || /api\.mistral\.ai/i.test(cfg.baseUrl || '');
}

// ---------------------------------------------------------------------------
// Provider request/response mapping
// ---------------------------------------------------------------------------

function geminiRequest(cfg, { system, user, temperature }) {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const model = encodeURIComponent(cfg.model);
  return {
    url: `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          responseMimeType: 'application/json',
        },
      }),
    },
  };
}

function openRouterRequest(cfg, { system, user, temperature }) {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    url: `${base}/api/v1/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://openwidgets.local',
        'X-Title': 'OpenWidgets',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
  };
}

function mistralRequest(cfg, { system, user, temperature }) {
  // Mistral's /v1/chat/completions is OpenAI-compatible.
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    url: `${base}/v1/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
  };
}

function parseGeminiResponse(payload) {
  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || '';
    throw new HttpError(502, 'llm_failed', `Gemini returned no content${reason ? ` (${reason})` : ''}`);
  }
  return text;
}

function parseOpenRouterResponse(payload) {
  const text = payload?.choices?.[0]?.message?.content || '';
  if (!text) throw new HttpError(502, 'llm_failed', 'OpenRouter returned no content');
  return Array.isArray(text) ? text.map((p) => p.text || '').join('') : String(text);
}

// ---------------------------------------------------------------------------
// JSON extraction + chat helper with cache
// ---------------------------------------------------------------------------

/** Extract the first JSON object from a model answer (tolerates ``` fences). */
export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new HttpError(502, 'llm_invalid_json', 'The model did not return a JSON object');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new HttpError(502, 'llm_invalid_json', 'The model returned malformed JSON');
  }
}

const cache = new Map(); // key -> { at, value }
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 200;

function cacheKey(cfg, system, user) {
  const hash = crypto.createHash('sha256').update(`${cfg.provider}|${cfg.model}|${system}\n${user}`).digest('hex');
  return hash;
}

/**
 * Send a system+user prompt and parse the answer as a JSON object.
 * `fetchImpl` is injectable for tests.
 */
export async function chatJson({ system, user, temperature = 0.4, fetchImpl = globalThis.fetch } = {}) {
  const cfg = resolveLlmConfig();
  if (!cfg.enabled || !cfg.providerKnown) throw new HttpError(409, 'llm_disabled', 'LLM integration is disabled');
  if (!cfg.apiKey) throw new HttpError(409, 'llm_no_key', 'No LLM API key configured (admin settings)');

  const key = cacheKey(cfg, system, user);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  const build = cfg.provider === 'gemini' ? geminiRequest : cfg.provider === 'mistral' ? mistralRequest : openRouterRequest;
  const parse = cfg.provider === 'gemini' ? parseGeminiResponse : parseOpenRouterResponse;
  const { url, init } = build(cfg, { system, user, temperature });
  init.signal = AbortSignal.timeout(60_000);

  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new HttpError(502, 'llm_unreachable', `LLM request failed: ${error && error.message ? error.message : 'network error'}`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch { /* ignore */ }
    throw new HttpError(502, 'llm_failed', `LLM provider answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'llm_invalid_json', 'LLM provider returned non-JSON');
  }
  const value = extractJsonObject(parse(payload));
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory sliding window, same pattern as participant.js)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000;
const windows = new Map();

export function llmRateLimit(key, limit, windowMs = RATE_WINDOW_MS) {
  const nowMs = Date.now();
  if (windows.size > 5000) {
    for (const [candidate, value] of windows) {
      if (value.resetAt < nowMs) windows.delete(candidate);
    }
  }
  const entry = windows.get(key);
  if (!entry || entry.resetAt < nowMs) {
    windows.set(key, { count: 1, resetAt: nowMs + windowMs });
    return;
  }
  if (entry.count >= limit) {
    throw new HttpError(429, 'rate_limited', 'Too many LLM requests — please try again later');
  }
  entry.count += 1;
}
