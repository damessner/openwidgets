// Tests for the LLM integration (v0.9): provider abstraction, prompt builders,
// sanitizers, config masking, rate limiting â€” plus an API-level run against a
// spawned server with an in-process mock LLM endpoint.
//
// Part A imports server/llm/* directly, so DATA_DIR must point at a throwaway
// directory BEFORE the import (db.js opens the database at import time).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-llm-'));
process.env.DATA_DIR = dataDir;

const core = await import('../server/llm/core.js');
const prompts = await import('../server/llm/prompts.js');
const { itemTypes } = await import('../shared/items/index.js');

const {
  PROVIDERS,
  chatJson,
  extractJsonObject,
  isLlmEnabled,
  llmRateLimit,
  publicLlmConfig,
  resolveLlmConfig,
  saveLlmConfig,
} = core;
const {
  LENGTH_PRESETS,
  MIX_PRESETS,
  buildFeedbackPrompt,
  buildWorksheetPrompt,
  sanitizeFeedback,
  sanitizeGeneratedDefinition,
} = prompts;

// ---------------------------------------------------------------------------
// Part A: pure functions
// ---------------------------------------------------------------------------

test('extractJsonObject: plain, fenced and prose-wrapped JSON', () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJsonObject('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJsonObject('Here you go: {"a":3} hope it helps'), { a: 3 });
  assert.throws(() => extractJsonObject('no json at all'), /JSON/);
  assert.throws(() => extractJsonObject('{broken'), /JSON/);
});

test('chatJson: openrouter request/response shape (mocked fetch)', async () => {
  process.env.OW_LLM_PROVIDER = 'openrouter';
  process.env.OW_LLM_API_KEY = 'sk-or-test-abcdef';
  process.env.OW_LLM_BASE_URL = 'http://llm.test';
  process.env.OW_LLM_MODEL = 'mock/free';
  process.env.OW_LLM_ENABLED = '1';
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true,"n":42}' } }] }),
    };
  };
  const out = await chatJson({ system: 'sys', user: 'hi', fetchImpl });
  assert.deepEqual(out, { ok: true, n: 42 });
  assert.equal(seen.url, 'http://llm.test/api/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-or-test-abcdef');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'mock/free');
  assert.equal(body.response_format.type, 'json_object');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
});

test('chatJson: gemini request/response shape (mocked fetch)', async () => {
  process.env.OW_LLM_PROVIDER = 'gemini';
  process.env.OW_LLM_API_KEY = 'gemini-key-123';
  process.env.OW_LLM_BASE_URL = 'http://gemini.test';
  process.env.OW_LLM_MODEL = 'gemini-2.0-flash';
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"ok":true}\n```' }] } }] }),
    };
  };
  const out = await chatJson({ system: 'sys', user: 'hi again', fetchImpl });
  assert.deepEqual(out, { ok: true });
  assert.match(seen.url, /^http:\/\/gemini\.test\/v1beta\/models\/gemini-2\.0-flash:generateContent\?key=gemini-key-123$/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('chatJson: provider error and unreachable become 502, disabled/key missing 409', async () => {
  process.env.OW_LLM_PROVIDER = 'openrouter';
  process.env.OW_LLM_API_KEY = 'k';
  process.env.OW_LLM_BASE_URL = 'http://llm.test';
  process.env.OW_LLM_MODEL = 'm';
  process.env.OW_LLM_ENABLED = '1';
  await assert.rejects(
    chatJson({ system: 's', user: 'u', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) }),
    (err) => err.status === 502 && err.code === 'llm_failed',
  );
  await assert.rejects(
    chatJson({ system: 's', user: 'u', fetchImpl: async () => { throw new Error('socket hangup'); } }),
    (err) => err.status === 502 && err.code === 'llm_unreachable',
  );
  process.env.OW_LLM_ENABLED = '0';
  await assert.rejects(chatJson({ system: 's', user: 'u', fetchImpl: async () => { throw new Error('should not be called'); } }), (err) => err.status === 409);
  process.env.OW_LLM_ENABLED = '1';
  process.env.OW_LLM_API_KEY = '';
  await assert.rejects(chatJson({ system: 's', user: 'u', fetchImpl: async () => { throw new Error('should not be called'); } }), (err) => err.status === 409 && err.code === 'llm_no_key');
  delete process.env.OW_LLM_API_KEY;
  delete process.env.OW_LLM_ENABLED;
  delete process.env.OW_LLM_PROVIDER;
  delete process.env.OW_LLM_BASE_URL;
  delete process.env.OW_LLM_MODEL;
});

test('chatJson: caches identical prompts', async () => {
  process.env.OW_LLM_PROVIDER = 'openrouter';
  process.env.OW_LLM_API_KEY = 'cache-key';
  process.env.OW_LLM_BASE_URL = 'http://llm.test';
  process.env.OW_LLM_MODEL = 'm';
  process.env.OW_LLM_ENABLED = '1';
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  await chatJson({ system: 'cache-sys', user: 'cache-user', fetchImpl });
  await chatJson({ system: 'cache-sys', user: 'cache-user', fetchImpl });
  assert.equal(calls, 1);
  delete process.env.OW_LLM_API_KEY;
  delete process.env.OW_LLM_ENABLED;
  delete process.env.OW_LLM_PROVIDER;
  delete process.env.OW_LLM_BASE_URL;
  delete process.env.OW_LLM_MODEL;
});

test('config: env overrides db, key is masked in public config', () => {
  // db config
  saveLlmConfig({ provider: 'gemini', apiKey: 'db-secret-key-99', model: 'gemini-2.0-flash', baseUrl: '', enabled: true });
  let cfg = resolveLlmConfig();
  assert.equal(cfg.apiKey, 'db-secret-key-99');
  assert.equal(cfg.source, 'db');
  const pub = publicLlmConfig();
  assert.equal(pub.apiKeyMasked, 'db-s\u2022\u2022\u2022\u2022y-99');
  assert.ok(!JSON.stringify(pub).includes('db-secret-key-99'), 'public config must not leak the raw key');
  assert.deepEqual(Object.keys(pub.providers), ['gemini', 'openrouter', 'mistral']);
  // env wins
  process.env.OW_LLM_API_KEY = 'env-key-12345678';
  process.env.OW_LLM_PROVIDER = 'openrouter';
  cfg = resolveLlmConfig();
  assert.equal(cfg.apiKey, 'env-key-12345678');
  assert.equal(cfg.provider, 'openrouter');
  assert.equal(cfg.source, 'env');
  assert.equal(isLlmEnabled(), true);
  process.env.OW_LLM_ENABLED = '0';
  assert.equal(isLlmEnabled(), false);
  delete process.env.OW_LLM_API_KEY;
  delete process.env.OW_LLM_PROVIDER;
  delete process.env.OW_LLM_ENABLED;
  // saving with empty apiKey keeps the stored one
  const saved = saveLlmConfig({ provider: 'gemini', apiKey: '', model: 'gemini-1.5-flash', enabled: true });
  assert.equal(saved.apiKeyMasked, 'db-s\u2022\u2022\u2022\u2022y-99');
  assert.throws(() => saveLlmConfig({ provider: 'nope' }), (err) => err.status === 400);
});

test('llmRateLimit: throws 429 after the limit', () => {
  const key = `test-${Date.now()}`;
  llmRateLimit(key, 2, 60_000);
  llmRateLimit(key, 2, 60_000);
  assert.throws(() => llmRateLimit(key, 2, 60_000), (err) => err.status === 429);
});

test('buildWorksheetPrompt: presets, mixes and full type catalog', () => {
  const all = buildWorksheetPrompt({ topic: 'Fotosynthese', locale: 'de', length: 'long', mix: 'diverse' });
  for (const module of itemTypes) assert.ok(all.system.includes(`"type": "${module.type}"`), `catalog contains ${module.type}`);
  assert.ok(all.system.includes(`${LENGTH_PRESETS.long.min}`) && all.system.includes(`${LENGTH_PRESETS.long.max}`), 'long preset item range present');
  assert.ok(all.user.includes('Fotosynthese'));

  const simple = buildWorksheetPrompt({ topic: 'X', locale: 'en', length: 'short', mix: 'simple' });
  for (const type of MIX_PRESETS.simple) assert.ok(simple.system.includes(`"type": "${type}"`));
  assert.ok(!simple.system.includes('"type": "crossword"'), 'simple mix excludes crossword');
  assert.ok(simple.system.includes('English'));
  assert.ok(LENGTH_PRESETS.short.max === 9 && LENGTH_PRESETS.long.min === 15 && LENGTH_PRESETS.long.max === 20);
});

test('sanitizeGeneratedDefinition: keeps valid, drops invalid, fixes ids', () => {
  const raw = {
    title: 'Test-Arbeitsblatt',
    description: 'd',
    items: [
      { id: 'a', type: 'multiple_choice', points: 1, stem: 'Frage?', config: { choices: [{ id: 'c1', text: 'ja', correct: true }, { id: 'c2', text: 'nein', correct: false }] } },
      { id: 'a', type: 'short_answer', points: 1, stem: 'Dup id', config: { accepted: ['x'] } }, // duplicate id -> new id
      { id: 'b', type: 'does_not_exist', points: 1, stem: 'kaputt' }, // unknown type -> dropped
      { id: 'c', type: 'fill_blanks', points: 1, stem: 'kaputt', config: { text: 'Text ohne LÃ¼cke {{}}' } }, // invalid (no valid gap) -> dropped
    ],
  };
  const { definition, dropped, total } = sanitizeGeneratedDefinition(raw, { locale: 'de', template: 'worksheet' });
  assert.equal(total, 4);
  assert.equal(dropped, 2);
  assert.equal(definition.items.length, 2);
  assert.notEqual(definition.items[0].id, definition.items[1].id);
  assert.equal(definition.title, 'Test-Arbeitsblatt');
  assert.equal(definition.locale, 'de');
  assert.throws(() => sanitizeGeneratedDefinition({ items: [{ id: 'x', type: 'nope' }] }), (err) => err.code === 'llm_invalid_output');
});

test('buildFeedbackPrompt + sanitizeFeedback: pseudonymized input, sanitized output', () => {
  const results = [
    { stem: 'Was ist Fotosynthese?', type: 'short_answer', correct: false, autoScore: 0, maxScore: 1, needsManual: false },
    { stem: 'WÃ¤hle richtig', type: 'multiple_choice', correct: true, autoScore: 2, maxScore: 2, needsManual: false },
  ];
  const { system, user } = buildFeedbackPrompt({ locale: 'de', activityTitle: 'Bio-Test', results });
  assert.ok(user.includes('Was ist Fotosynthese?'));
  assert.ok(user.includes('incorrect'));
  assert.ok(!user.includes('Max Mustermann'), 'prompt builder gets no names anyway');

  const raw = {
    summary: '  Gut gemacht! '.repeat(50),
    tips: ['Tipp eins', 42, '', 'Tipp drei'],
    exercises: [
      { id: 'e1', type: 'multiple_choice', points: 5, stem: 'Ãœbung?', config: { choices: [{ id: 'c1', text: 'a', correct: true }, { id: 'c2', text: 'b', correct: false }] } },
      { id: 'e2', type: 'crossword', points: 1, stem: 'nicht erlaubt' }, // not in EXERCISE_TYPES -> dropped
    ],
  };
  const fb = sanitizeFeedback(raw);
  assert.ok(fb.summary.length <= 1500);
  assert.deepEqual(fb.tips, ['Tipp eins', '42', 'Tipp drei']);
  assert.equal(fb.exercises.length, 1);
  assert.equal(fb.exercises[0].item.points, 0, 'exercise points forced to 0 (unscored practice)');
  assert.ok(!JSON.stringify(fb).includes('"correct":true'), 'sanitized exercise must not expose the answer key');
  assert.throws(() => sanitizeFeedback({}), (err) => err.code === 'llm_invalid_output');
});

// ---------------------------------------------------------------------------
// Part B: spawned server + in-process mock LLM (OpenRouter dialect)
// ---------------------------------------------------------------------------

const ADMIN = { email: 'llm-admin@school.at', password: 'llm-admin-pass-1', name: 'LLM Admin' };
let appPort = 0;
let mockPort = 0;
let baseUrl = '';
let appProcess = null;
let mockServer = null;
let mockLogFd = null;
const mockRequests = [];

function mockLlmHandler(req, res) {
  if (req.method === 'POST' && req.url === '/__requests') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(mockRequests));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const payload = JSON.parse(data || '{}');
    mockRequests.push(payload);
    const system = payload.messages.find((m) => m.role === 'system')?.content || '';
    const user = [...payload.messages].reverse().find((m) => m.role === 'user')?.content || '';
    let answer;
    if (/Ping/.test(user)) answer = { ok: true };
    else if (/formative feedback/i.test(system)) {
      answer = {
        summary: 'Guter Anfang — baue die Argumentation noch aus.',
        criteria: [
          { id: 'c1', label: 'Inhalt', met: 0.6, comment: 'Zwei Argumente sind gut.', tip: 'Ergänze ein Beispiel.' },
          { id: 'c2', label: 'Struktur', met: 0.9, comment: 'Klare Absätze.', tip: 'Schlussatz ausbauen.' },
        ],
      };
    } else if (/tutor/i.test(system)) {
      answer = {
        summary: 'Du hast die Grundlagen drauf â€” Ã¼be die Fachbegriffe.',
        tips: ['Lies genau.', 'Wiederhole Vokabeln laut.'],
        exercises: [
          {
            id: 'ex1', type: 'multiple_choice', points: 0, stem: 'Ãœbung: Was braucht Fotosynthese?',
            config: { choices: [{ id: 'c1', text: 'Licht', correct: true }, { id: 'c2', text: 'Dunkelheit', correct: false }] },
          },
        ],
      };
    } else {
      answer = {
        title: 'KI-Arbeitsblatt: Test-Thema',
        description: 'Mock',
        items: [
          { id: 'it1', type: 'multiple_choice', points: 1, stem: 'Was ist 1+1?', config: { choices: [{ id: 'c1', text: '2', correct: true }, { id: 'c2', text: '3', correct: false }] } },
          { id: 'it2', type: 'short_answer', points: 1, stem: 'Nenne eine Farbe.', config: { accepted: ['rot'] } },
        ],
      };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
  });
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }
  async request(pathname, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (token) headers['x-participant-token'] = token;
    const response = await fetch(this.base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: response.status, text, json };
  }
  get(p, o) { return this.request(p, { ...o, method: 'GET' }); }
  post(p, b, o) { return this.request(p, { ...o, method: 'POST', body: b }); }
  put(p, b, o) { return this.request(p, { ...o, method: 'PUT', body: b }); }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitHealthy(url) {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

before(async () => {
  mockPort = await freePort();
  appPort = await freePort();
  baseUrl = `http://127.0.0.1:${appPort}`;
  mockServer = http.createServer(mockLlmHandler);
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  const logPath = path.join(dataDir, 'server.log');
  const logFd = fs.openSync(logPath, 'a');
  mockLogFd = logFd;
  appProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      ADMIN_NAME: ADMIN.name,
      OW_LLM_PROVIDER: 'openrouter',
      OW_LLM_API_KEY: 'mock-api-key-abcdef',
      OW_LLM_BASE_URL: `http://127.0.0.1:${mockPort}`,
      OW_LLM_MODEL: 'mock/free',
      OW_LLM_ENABLED: '1',
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  await waitHealthy(baseUrl);
});

after(() => {
  if (appProcess) appProcess.kill('SIGTERM');
  if (mockServer) mockServer.close();
  if (mockLogFd) fs.closeSync(mockLogFd);
});

test('api: capabilities expose llm flag, config is masked, unauth rejected', async () => {
  const anon = new Client(baseUrl);
  const caps = await anon.get('/api/capabilities');
  assert.equal(caps.json.features.llm, true);
  const unauth = await anon.get('/api/llm/config');
  assert.equal(unauth.status, 401);
  const gen = await anon.post('/api/llm/generate-worksheet', { topic: 'Test' });
  assert.equal(gen.status, 401);

  const admin = new Client(baseUrl);
  const login = await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal(login.status, 200);
  const cfg = await admin.get('/api/llm/config');
  assert.equal(cfg.json.enabled, true);
  assert.equal(cfg.json.provider, 'openrouter');
  assert.equal(cfg.json.apiKeyMasked, 'mock\u2022\u2022\u2022\u2022cdef');
  assert.ok(!cfg.text.includes('mock-api-key-abcdef'), 'raw key must not be exposed');
});

test('api: admin can test the connection and save masked config', async () => {
  const admin = new Client(baseUrl);
  await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  const testRes = await admin.post('/api/llm/test', {});
  assert.equal(testRes.status, 200);
  assert.equal(testRes.json.ok, true);
  assert.equal(testRes.json.model, 'mock/free');
  // env key wins over db save; saving with empty key keeps env key
  const saved = await admin.put('/api/llm/config', { provider: 'openrouter', apiKey: '', model: 'mock/free-v2', baseUrl: '', enabled: true });
  assert.equal(saved.status, 200);
  const cfg = await admin.get('/api/llm/config');
  assert.equal(cfg.json.model, 'mock/free', 'env OW_LLM_MODEL still wins over db value');
});

test('api: generate-worksheet creates a valid draft activity', async () => {
  const admin = new Client(baseUrl);
  await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  const bad = await admin.post('/api/llm/generate-worksheet', { topic: 'x' });
  assert.equal(bad.status, 400);
  const res = await admin.post('/api/llm/generate-worksheet', {
    topic: 'Addition im Zahlenraum 100', subject: 'Mathematik', grade: '2. Klasse', locale: 'de', length: 'short', mix: 'simple', template: 'worksheet',
  });
  assert.equal(res.status, 201, res.text);
  const activity = res.json.activity;
  assert.equal(activity.status, 'draft');
  assert.equal(activity.definition.items.length, 2);
  assert.equal(res.json.dropped, 0);
  // the created draft passes server-side validation and is loadable
  const fetched = await admin.get(`/api/activities/${activity.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.activity.definition.items.length, 2);
});

test('api: student feedback after submit is pseudonymized and cached', async () => {
  const admin = new Client(baseUrl);
  await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });

  // build a tiny activity, publish it, join as a student, answer, submit
  const created = await admin.post('/api/activities', {
    title: 'LLM Feedback Test',
    template: 'quiz',
    locale: 'de',
    definition: {
      v: 1, template: 'quiz', title: 'LLM Feedback Test', description: '', locale: 'de',
      settings: { showResults: true, allowReview: true },
      items: [
        { id: 'q1', type: 'multiple_choice', points: 1, stem: '2+2?', config: { choices: [{ id: 'c1', text: '4', correct: true }, { id: 'c2', text: '5', correct: false }] } },
      ],
    },
  });
  assert.equal(created.status, 201, created.text);
  const activityId = created.json.activity.id;
  const published = await admin.post(`/api/activities/${activityId}/publish`, { title: 'LLM Feedback Test' });
  assert.ok([200, 201].includes(published.status), published.text);
  const code = published.json.assignment.code;

  const anon = new Client(baseUrl);
  const joined = await anon.post('/api/join', { code, name: 'Erika Mustermann' });
  assert.equal(joined.status, 200, joined.text);
  const token = joined.json.participantToken;
  assert.ok(token && token.length >= 24);

  // feedback before submit -> 409
  const early = await anon.post('/api/llm/feedback', {}, { token });
  assert.equal(early.status, 409);

  await anon.put('/api/participant/responses/q1', { response: { selected: ['c1'] } }, { token });
  const submitted = await anon.post('/api/participant/submit', { confirm: true }, { token });
  assert.equal(submitted.status, 200, submitted.text);

  const before = mockRequests.length;
  const fb = await anon.post('/api/llm/feedback', {}, { token });
  assert.equal(fb.status, 200, fb.text);
  assert.ok(fb.json.feedback.summary.includes('Fachbegriffe'));
  assert.equal(fb.json.feedback.exercises.length, 1);
  assert.equal(fb.json.feedback.exercises[0].item.points, 0);
  assert.equal(fb.json.cached, false);

  // the prompt sent to the LLM must not contain the participant name
  const last = mockRequests[before];
  assert.ok(last, 'mock received a request');
  assert.ok(!JSON.stringify(last).includes('Erika'), 'participant name must not be sent to the LLM');
  assert.ok(JSON.stringify(last).includes('multiple_choice'));

  // second call is served from the cache
  const again = await anon.post('/api/llm/feedback', {}, { token });
  assert.equal(again.status, 200);
  assert.equal(again.json.cached, true);
  const viaGet = await anon.get('/api/llm/feedback', { token });
  assert.ok(viaGet.json.feedback.summary.includes('Fachbegriffe'));
});

test('api: writing task feedback loop is pseudonymized, stored per loop, monitorable', async () => {
  const admin = new Client(baseUrl);
  await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });

  const created = await admin.post('/api/activities', { title: 'Schreibaufgabe Test', template: 'worksheet', locale: 'de' });
  assert.equal(created.status, 201, created.text);
  const activityId = created.json.activity.id;
  const definition = {
    v: 1, template: 'worksheet', title: 'Schreibaufgabe Test', description: '', locale: 'de',
    settings: { showResults: true, allowReview: true },
    items: [
      {
        id: 'w1', type: 'writing', points: 5, stem: 'Schreibe einen Text über deinen Hund.',
        config: {
          gradeLevel: '5. Klasse',
          sourceText: 'Hunde sind Säugetiere.',
          criteria: [
            { id: 'c1', label: 'Inhalt', weight: 60, description: 'Bezug zum Thema' },
            { id: 'c2', label: 'Sprache', weight: 40, description: 'Rechtschreibung' },
          ],
          minWords: 20, maxWords: 300, allowLoops: true,
        },
      },
    ],
  };
  const updated = await admin.put(`/api/activities/${activityId}`, {
    title: 'Schreibaufgabe Test', description: '', template: 'worksheet', locale: 'de',
    definition, revision: created.json.activity.revision,
  });
  assert.equal(updated.status, 200, updated.text);
  const published = await admin.post(`/api/activities/${activityId}/publish`, { title: 'Schreibaufgabe Test' });
  assert.ok([200, 201].includes(published.status), published.text);
  const code = published.json.assignment.code;
  const assignmentId = published.json.assignment.id;

  const anon = new Client(baseUrl);
  const joined = await anon.post('/api/join', { code, name: 'Lisa Schreiber' });
  assert.equal(joined.status, 200, joined.text);
  const token = joined.json.participantToken;

  // too short text -> 400
  const tooShort = await anon.post('/api/llm/writing-feedback', { itemId: 'w1', text: 'kurz' }, { token });
  assert.equal(tooShort.status, 400);

  const draft = 'Mein Hund Bello ist braun und spielt gern Ball. Er ist sehr lieb und treu.';
  await anon.put('/api/participant/responses/w1', { response: { text: draft } }, { token });

  const before = mockRequests.length;
  const fb = await anon.post('/api/llm/writing-feedback', { itemId: 'w1', text: draft }, { token });
  assert.equal(fb.status, 200, fb.text);
  assert.equal(fb.json.feedback.loop, 1);
  assert.equal(fb.json.feedback.criteria.length, 2);
  assert.equal(fb.json.feedback.criteria[0].id, 'c1');
  assert.ok(fb.json.feedback.criteria[0].tip.length > 0);
  // pseudonymized: name not sent to the LLM
  assert.ok(!JSON.stringify(mockRequests[before]).includes('Lisa'), 'participant name must not be sent');
  assert.ok(JSON.stringify(mockRequests[before]).includes('Bello'), 'the draft text is sent');

  // second loop increments
  const fb2 = await anon.post('/api/llm/writing-feedback', { itemId: 'w1', text: draft + ' Außerdem bellt er nie.' }, { token });
  assert.equal(fb2.json.feedback.loop, 2);

  // loops are listed
  const loops = await anon.get('/api/llm/writing-feedback/w1', { token });
  assert.equal(loops.json.loops.length, 2);

  // after submit, feedback is blocked but result carries it
  await anon.post('/api/participant/submit', { confirm: true }, { token });
  const blocked = await anon.post('/api/llm/writing-feedback', { itemId: 'w1', text: draft }, { token });
  assert.equal(blocked.status, 409);
  const result = await anon.get('/api/participant/result', { token });
  const writingEntry = result.json.result.items.find((entry) => entry.itemId === 'w1');
  assert.ok(writingEntry && writingEntry.writingFeedback, 'result carries the latest writing feedback');
  assert.equal(writingEntry.writingFeedback.loop, 2);

  // teacher monitor sees the participant with loops (names visible to teacher)
  const monitor = await admin.get(`/api/writing/monitor/${assignmentId}`);
  assert.equal(monitor.status, 200, monitor.text);
  const row = monitor.json.participants.find((p) => p.name.includes('Lisa'));
  assert.ok(row, 'monitor lists the participant');
  assert.equal(row.items[0].loopCount, 2);
  assert.equal(row.items[0].latestFeedback.criteria.length, 2);
  assert.ok(row.items[0].draft.includes('Bello'));
});
