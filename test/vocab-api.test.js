// API tests for the vocabulary lists (v0.7): teacher CRUD, CSV import,
// ownership scoping — and that a `vocabulary` item in the student join
// payload never leaks the answer side (translation/alternatives or term,
// depending on mode/direction).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createItem } from '../shared/items/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-vocab-'));
const logPath = path.join(dataDir, 'server.log');
const ADMIN = { email: 'admin@school.at', password: 'admin12345!', name: 'Admin' };
const TEACHER = { email: 'teacher@school.at', password: 'teacher12345!', name: 'Lehrer' };

let serverProcess = null;
let baseUrl = '';
let logFd = null;

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

function req(pathname, { method = 'GET', cookie, body, contentType } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (contentType) headers['content-type'] = contentType;
  return fetch(baseUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  }).then(async (response) => {
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text, setCookies };
  });
}

async function login(email, password) {
  const response = await req('/api/auth/login', {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login ${email}: ${response.text}`);
  return response.setCookies.map((c) => c.split(';')[0]).join('; ');
}

let adminCookie = '';
let teacherCookie = '';

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
  adminCookie = await login(ADMIN.email, ADMIN.password);
  // second teacher account (created by admin) for ownership tests
  const created = await req('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ email: TEACHER.email, name: TEACHER.name, role: 'teacher', password: TEACHER.password }),
  });
  assert.equal(created.status, 201, created.text);
  teacherCookie = await login(TEACHER.email, TEACHER.password);
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), delay(3000)]);
  }
  if (logFd !== null) { try { fs.closeSync(logFd); } catch { /* ignore */ } }
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp */ }
});

test('vocab-lists: anon 401, CRUD by owner, CSV import, validation', async () => {
  const anon = await req('/api/vocab-lists');
  assert.equal(anon.status, 401);

  // create
  const created = await req('/api/vocab-lists', {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Unit 3', sourceLang: 'en', targetLang: 'de' }),
  });
  assert.equal(created.status, 201, created.text);
  const listId = created.json.list.id;
  assert.equal(created.json.list.entryCount, 0);

  // invalid: empty title
  const bad = await req('/api/vocab-lists', {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ title: '  ' }),
  });
  assert.equal(bad.status, 400);

  // CSV import
  const csv = await req(`/api/vocab-lists/${listId}/import`, {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ csv: 'word;Wort;Beispiel\nhouse;Haus;The house is big.\ntree;Baum\n' }),
  });
  assert.equal(csv.status, 200, csv.text);
  assert.equal(csv.json.added, 2);
  assert.equal(csv.json.entries.length, 2);
  assert.equal(csv.json.entries[0].term, 'house');
  assert.equal(csv.json.entries[0].translation, 'Haus');

  // empty csv rejected
  const emptyCsv = await req(`/api/vocab-lists/${listId}/import`, {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ csv: '   ' }),
  });
  assert.equal(emptyCsv.status, 400);

  // list + detail
  const list = await req('/api/vocab-lists', { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.lists.some((l) => l.id === listId && l.entryCount === 2));
  const detail = await req(`/api/vocab-lists/${listId}`, { cookie: adminCookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.entries.length, 2);

  // PUT replaces entries; unknown asset rejected
  const badAsset = await req(`/api/vocab-lists/${listId}`, {
    method: 'PUT',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({
      title: 'Unit 3',
      entries: [{ term: 'cat', translation: 'Katze', imageAssetId: 'does-not-exist' }],
    }),
  });
  assert.equal(badAsset.status, 400);
  assert.ok(badAsset.text.includes('unknown asset'));

  const put = await req(`/api/vocab-lists/${listId}`, {
    method: 'PUT',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({
      title: 'Unit 3 (v2)',
      sourceLang: 'en',
      targetLang: 'de',
      entries: [
        { term: 'cat', translation: 'Katze', alternatives: ['catze'], example: 'The cat sleeps.', notes: '' },
        { term: 'dog', translation: 'Hund', alternatives: [], example: '', notes: '' },
      ],
    }),
  });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.list.title, 'Unit 3 (v2)');
  assert.equal(put.json.entries.length, 2);
  assert.deepEqual(put.json.entries[0].alternatives, ['catze']);

  // ownership: the other teacher may not read or delete
  const foreign = await req(`/api/vocab-lists/${listId}`, { cookie: teacherCookie });
  assert.equal(foreign.status, 403);
  const foreignDel = await req(`/api/vocab-lists/${listId}`, { method: 'DELETE', cookie: teacherCookie });
  assert.equal(foreignDel.status, 403);
  // ...and does not see it in the list
  const foreignList = await req('/api/vocab-lists', { cookie: teacherCookie });
  assert.ok(!foreignList.json.lists.some((l) => l.id === listId));

  // missing list → 404
  const missing = await req('/api/vocab-lists/nope-nope', { cookie: adminCookie });
  assert.equal(missing.status, 404);

  // delete
  const del = await req(`/api/vocab-lists/${listId}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(del.status, 204);
  const gone = await req(`/api/vocab-lists/${listId}`, { cookie: adminCookie });
  assert.equal(gone.status, 404);
});

test('vocab item in join payload: answer side stripped per mode/direction', async () => {
  const vocab = createItem('vocabulary', { id: 'it_vocab', points: 4 });
  vocab.stem = 'Übe Unit 3.';
  vocab.config = {
    mode: 'translate',
    direction: 'term_to_translation',
    shuffle: false,
    caseSensitive: false,
    entries: [
      { id: 'e1', term: 'house', translation: 'Haus', alternatives: ['home'], example: 'The house is big.', imageAssetId: '', audioAssetId: '' },
      { id: 'e2', term: 'tree', translation: 'Baum', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' },
    ],
  };

  const created = await req('/api/activities', {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Vocab Quiz', template: 'worksheet' }),
  });
  assert.equal(created.status, 201, created.text);
  const activity = created.json.activity;
  const current = await req(`/api/activities/${activity.id}`, { cookie: adminCookie });
  const definition = {
    v: 1,
    template: 'worksheet',
    title: 'Vocab Quiz',
    description: '',
    locale: 'de',
    settings: { instantFeedback: true, showResults: true, allowReview: true, requireName: true },
    items: [vocab],
  };
  const upd = await req(`/api/activities/${activity.id}`, {
    method: 'PUT',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Vocab Quiz', template: 'worksheet', locale: 'de', definition, revision: current.json.activity.revision }),
  });
  assert.equal(upd.status, 200, upd.text);
  const pub = await req(`/api/activities/${activity.id}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Vocab Quiz' }),
  });
  assert.equal(pub.status, 201, pub.text);
  const code = pub.json.assignment.code;

  const join = await req('/api/join', {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ code, name: 'Vocab-Test' }),
  });
  assert.equal(join.status, 200, join.text);
  const payload = join.text;
  const item = join.json.activity.items.find((i) => i.id === 'it_vocab');
  assert.ok(item, 'vocab item in payload');
  assert.equal(item.config.mode, 'translate');
  // term_to_translation: term + example stay, translation/alternatives stripped
  assert.equal(item.config.entries[0].term, 'house');
  assert.equal(item.config.entries[0].translation, '');
  assert.deepEqual(item.config.entries[0].alternatives, []);
  assert.ok(!payload.includes('"Haus"'));
  assert.ok(!payload.includes('"home"'));
  assert.ok(!payload.includes('"Baum"'));

  // answer + score through the participant API
  const token = join.json.participantToken;
  const save = await req('/api/participant/responses/it_vocab', {
    method: 'PUT',
    contentType: 'application/json',
    body: JSON.stringify({ response: { answers: { e1: 'haus', e2: 'Baum' } } }),
    cookie: undefined,
  });
  assert.equal(save.status, 401); // needs the participant token header, not a cookie
  const save2 = await fetch(`${baseUrl}/api/participant/responses/it_vocab`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-participant-token': token },
    body: JSON.stringify({ response: { answers: { e1: 'haus', e2: 'Baum' } } }),
  });
  assert.equal(save2.status, 200);
  const saved = await save2.json();
  assert.equal(saved.result.correct, true);
  assert.equal(saved.result.autoScore, 4);
  assert.equal(saved.result.maxScore, 4);
});
