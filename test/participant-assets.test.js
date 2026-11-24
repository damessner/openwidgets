// API tests for POST /api/participant/assets (student audio answers):
// participant token or student session required, audio-only, rate-limited;
// and that new item types are sanitized correctly in the student join payload.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-passets-'));
const logPath = path.join(dataDir, 'server.log');
const ADMIN = { email: 'admin@school.at', password: 'admin12345!', name: 'Admin' };

let serverProcess = null;
let baseUrl = '';
let logFd = null;
const state = {};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function req(pathname, { method = 'GET', token, student, body, contentType } = {}) {
  const headers = {};
  if (token) headers['x-participant-token'] = token;
  if (student) headers.cookie = `ow_student=${student}`;
  if (contentType) headers['content-type'] = contentType;
  const response = await fetch(baseUrl + pathname, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text, setCookies };
}

before(async () => {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  logFd = fs.openSync(logPath, 'a');
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      ADMIN_NAME: ADMIN.name,
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  let healthy = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) { healthy = true; break; }
    } catch { /* not up yet */ }
    await delay(100);
  }
  if (!healthy) throw new Error('test server did not start');
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), delay(3000)]);
  }
  if (logFd !== null) { try { fs.closeSync(logFd); } catch { /* ignore */ } }
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp */ }
});

async function authed(pathname, { method = 'GET', body } = {}, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: response.status, json, text };
}

async function makeQuizWithHotspot() {
  // login as admin
  const login = await req('/api/auth/login', { method: 'POST', contentType: 'application/json', body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }) });
  assert.equal(login.status, 200);
  const cookie = login.setCookies.map((c) => c.split(';')[0]).join('; ');
  const created = await authed('/api/activities', { method: 'POST', body: { title: 'TipToi Quiz', template: 'quiz', locale: 'de' } }, cookie);
  assert.equal(created.status, 201, created.text);
  const activity = created.json.activity;
  const current = await authed(`/api/activities/${activity.id}`, {}, cookie);
  const definition = {
    v: 1,
    template: 'quiz',
    title: 'TipToi Quiz',
    description: '',
    locale: 'de',
    settings: { instantFeedback: true, showResults: true, allowReview: true, requireName: true },
    items: [
      {
        id: 'hs1',
        type: 'hotspot',
        points: 2,
        stem: 'Tippe den Vogel an.',
        media: { type: 'none' },
        config: {
          image: { assetId: 'img-x', alt: 'Wiese' },
          prompt: { text: 'Tippe den Vogel an.', audioAssetId: '' },
          zones: [
            { id: 'z1', label: 'Vogel', shape: 'circle', x: 0.3, y: 0.3, r: 0.1, correct: true, feedback: { text: 'Richtig!' }, link: { type: 'none', value: '' } },
            { id: 'z2', label: 'Baum', shape: 'rect', x: 0.7, y: 0.7, w: 0.2, h: 0.2, correct: false, feedback: { text: '' }, link: { type: 'none', value: '' } },
          ],
        },
        feedback: { correct: '', incorrect: '' },
      },
      {
        id: 'au1',
        type: 'audio_answer',
        points: 3,
        stem: 'Lies den Satz laut vor.',
        media: { type: 'none' },
        config: { maxDurationSec: 30 },
        feedback: { correct: '', incorrect: '' },
      },
    ],
  };
  const upd = await authed(`/api/activities/${activity.id}`, {
    method: 'PUT',
    body: { title: 'TipToi Quiz', template: 'quiz', locale: 'de', definition, revision: current.json.activity.revision },
  }, cookie);
  assert.equal(upd.status, 200, upd.text);
  const pub = await authed(`/api/activities/${activity.id}/publish`, { method: 'POST', body: { title: 'TipToi Quiz' } }, cookie);
  assert.equal(pub.status, 201, pub.text);
  return pub.json.assignment;
}

test('participant assets: audio upload works with token; image rejected; anon rejected', async () => {
  state.assignment = await makeQuizWithHotspot();

  // anonymous participant joins by name
  const join = await req('/api/join', {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ code: state.assignment.code, name: 'Hörer:in' }),
  });
  assert.equal(join.status, 200, join.text);
  const token = join.json.participantToken;
  assert.ok(token);

  // audio upload OK
  const audioBytes = Buffer.from('RIFF....WAVEfmt fake-audio-bytes', 'utf8');
  const up = await req('/api/participant/assets?filename=aufnahme.webm', {
    method: 'POST',
    token,
    contentType: 'audio/webm',
    body: audioBytes,
  });
  assert.equal(up.status, 201, up.text);
  assert.ok(up.json.asset.id);
  assert.equal(up.json.asset.mime, 'audio/webm');
  assert.match(up.json.asset.url, /^\/assets\//);

  // the asset is publicly servable (player uses /assets/:id/:filename)
  const serve = await fetch(`${baseUrl}${up.json.asset.url}`);
  assert.equal(serve.status, 200);
  assert.equal(serve.headers.get('content-type'), 'audio/webm');

  // image upload rejected (audio only)
  const img = await req('/api/participant/assets?filename=x.png', {
    method: 'POST',
    token,
    contentType: 'image/png',
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(img.status, 400);
  assert.equal(img.json.error.code, 'unsupported_type');

  // no token + not logged in -> 401
  const anon = await req('/api/participant/assets?filename=x.webm', {
    method: 'POST',
    contentType: 'audio/webm',
    body: audioBytes,
  });
  assert.equal(anon.status, 401);

  // teacher endpoint still rejects participant tokens
  const teacherRoute = await req('/api/assets?filename=x.webm', {
    method: 'POST',
    token,
    contentType: 'audio/webm',
    body: audioBytes,
  });
  assert.equal(teacherRoute.status, 401);

  state.token = token;
});

test('student join payload: hotspot config sanitized (no correct flag), audio_answer config present', async () => {
  const join = await req('/api/join', {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ code: state.assignment.code, name: 'Zuschauer:in' }),
  });
  assert.equal(join.status, 200);
  const items = join.json.activity.items;
  const hs = items.find((i) => i.type === 'hotspot');
  assert.ok(hs, 'hotspot item in payload');
  assert.ok(!JSON.stringify(hs.config).includes('"correct"'), 'correct flag stripped');
  assert.ok(hs.config.zones.length === 2);
  assert.ok(hs.config.zones[0].feedback.text === 'Richtig!');
  const au = items.find((i) => i.type === 'audio_answer');
  assert.ok(au && au.config.maxDurationSec === 30);

  // submit a hotspot response + audio answer, verify scoring via results
  const token = join.json.participantToken;
  const save1 = await req('/api/participant/responses/hs1', {
    method: 'PUT',
    token,
    contentType: 'application/json',
    body: JSON.stringify({ response: { tapped: ['z1'] } }),
  });
  assert.equal(save1.status, 200, save1.text);
  assert.equal(save1.json.result.correct, true);
  assert.equal(save1.json.result.autoScore, 2);

  // upload an audio answer and save it as the response
  const up = await req('/api/participant/assets?filename=antwort.webm', {
    method: 'POST',
    token,
    contentType: 'audio/webm',
    body: Buffer.from('fake audio', 'utf8'),
  });
  assert.equal(up.status, 201);
  const save2 = await req('/api/participant/responses/au1', {
    method: 'PUT',
    token,
    contentType: 'application/json',
    body: JSON.stringify({ response: { assetId: up.json.asset.id, durationMs: 2500, mime: 'audio/webm' } }),
  });
  assert.equal(save2.status, 200, save2.text);
  assert.equal(save2.json.result.needsManual, true, 'audio answer needs manual grading');
  assert.equal(save2.json.result.maxScore, 3);
});
