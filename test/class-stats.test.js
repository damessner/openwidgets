// API tests for the teacher class-statistics endpoint
// GET /api/classes/:id/stats (matrix of roster participants x class items),
// including that attempts in free-order classes are linked to the roster
// entry (via class token or student account).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-stats-'));
const logPath = path.join(dataDir, 'server.log');
const ADMIN = { email: 'admin@school.at', password: 'admin12345!', name: 'Admin' };

let serverProcess = null;
let baseUrl = '';
let logFd = null;
const state = {};

class Client {
  constructor(url) {
    this.baseUrl = url;
    this.cookies = new Map();
  }
  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  async request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    const jar = this.cookieHeader();
    if (jar) headers.cookie = jar;
    if (options.token) headers['x-participant-token'] = options.token;
    let body;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(this.baseUrl + pathname, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual',
    });
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, headers: response.headers, text, json };
  }
  get(pathname, options) { return this.request(pathname, { ...options, method: 'GET' }); }
  post(pathname, body, options) { return this.request(pathname, { ...options, method: 'POST', body }); }
  put(pathname, body, options) { return this.request(pathname, { ...options, method: 'PUT', body }); }
  delete(pathname, options) { return this.request(pathname, { ...options, method: 'DELETE' }); }
}

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status} — ${response.text}`);
  return response.json;
}

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

async function makeAssignment(admin, title, itemId) {
  const created = expectStatus(await admin.post('/api/activities', { title, template: 'quiz', locale: 'de' }), 201, `create ${title}`);
  const activityId = created.activity.id;
  const current = expectStatus(await admin.get(`/api/activities/${activityId}`), 200, `get ${title}`);
  const definition = {
    v: 1,
    template: 'quiz',
    title,
    description: '',
    locale: 'de',
    settings: { instantFeedback: true, showResults: true, allowReview: true, requireName: true },
    items: [
      {
        id: itemId,
        type: 'multiple_choice',
        points: 2,
        stem: 'Welche Antwort ist richtig?',
        config: {
          multi: false,
          shuffle: false,
          partialCredit: false,
          choices: [
            { id: 'c1', text: 'Richtig', correct: true },
            { id: 'c2', text: 'Falsch', correct: false },
          ],
        },
      },
    ],
  };
  expectStatus(
    await admin.put(`/api/activities/${activityId}`, { title, template: 'quiz', locale: 'de', definition, revision: current.activity.revision }),
    200,
    `update ${title}`,
  );
  const published = expectStatus(await admin.post(`/api/activities/${activityId}/publish`, { title }), 201, `publish ${title}`);
  return { activityId, id: published.assignment.id, code: published.assignment.code, itemId };
}

async function submitCorrect(client, token, itemId) {
  expectStatus(await client.put(`/api/participant/responses/${itemId}`, { response: { selected: ['c1'] } }, { token }), 200, 'save');
  const submitted = expectStatus(await client.post('/api/participant/submit', { confirm: true }, { token }), 200, 'submit');
  assert.equal(submitted.result.score, 2);
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
  if (!healthy) {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '(no log)';
    throw new Error(`OpenWidgets test server did not start.\n${log}`);
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), delay(3000)]);
  }
  if (logFd !== null) {
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir */ }
});

// ---------------------------------------------------------------------------

test('setup: class with two published assignments + roster', async () => {
  const admin = new Client(baseUrl);
  expectStatus(await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }), 200, 'login');
  state.admin = admin;
  state.a = await makeAssignment(admin, 'Quiz A', 'qa1');
  state.b = await makeAssignment(admin, 'Quiz B', 'qb1');
  const created = expectStatus(await admin.post('/api/classes', { name: '4a', orderMode: 'free' }), 201, 'create class');
  state.classId = created.class.id;
  expectStatus(await admin.put(`/api/classes/${state.classId}/items`, { assignmentIds: [state.a.id, state.b.id] }), 200, 'set items');
  const published = expectStatus(await admin.post(`/api/classes/${state.classId}/publish`, {}), 200, 'publish class');
  state.classCode = published.class.code;
  const roster = expectStatus(
    await admin.post(`/api/classes/${state.classId}/students`, { names: ['Anna Müller', 'Max Muster'] }),
    201,
    'roster',
  );
  assert.equal(roster.credentials.length, 2);
  state.anna = roster.credentials.find((c) => c.username === 'anna-mueller');
});

test('class list includes assignmentIds (for the add-to-class checkboxes)', async () => {
  const list = expectStatus(await state.admin.get('/api/classes'), 200, 'class list');
  const cls = list.classes.find((c) => c.id === state.classId);
  assert.deepEqual(cls.assignmentIds, [state.a.id, state.b.id]);
});

test('stats: 401 for anonymous, 200 for owner', async () => {
  const anon = new Client(baseUrl);
  assert.equal((await anon.get(`/api/classes/${state.classId}/stats`)).status, 401);
  const res = expectStatus(await state.admin.get(`/api/classes/${state.classId}/stats`), 200, 'stats');
  assert.equal(res.class.id, state.classId);
  assert.equal(res.items.length, 2);
  assert.deepEqual(res.items.map((i) => i.assignmentId), [state.a.id, state.b.id]);
  assert.equal(res.students.length, 2);
});

test('free-order class: attempts via class token / student account are linked, stats matrix reflects them', async () => {
  // Anna (roster account) joins the class, then assignment A through it.
  const anna = new Client(baseUrl);
  expectStatus(await anna.post('/api/auth/student-login', { username: state.anna.username, password: state.anna.password }), 200, 'anna login');
  const classJoin = expectStatus(await anna.post('/api/classes/join', { code: state.classCode }), 200, 'anna class join');
  const classToken = classJoin.classToken;
  const joinA = expectStatus(await anna.post('/api/join', { code: state.a.code, classToken }), 200, 'anna join A');
  await submitCorrect(anna, joinA.participantToken, state.a.itemId);

  // Lisa is not on the roster; she joins the class by name and does assignment B.
  const lisa = new Client(baseUrl);
  const lisaClassJoin = expectStatus(await lisa.post('/api/classes/join', { code: state.classCode, name: 'Lisa Lustig' }), 200, 'lisa class join');
  const joinB = expectStatus(await lisa.post('/api/join', { code: state.b.code, name: 'Lisa Lustig', classToken: lisaClassJoin.classToken }), 200, 'lisa join B');
  await submitCorrect(lisa, joinB.participantToken, state.b.itemId);

  const stats = expectStatus(await state.admin.get(`/api/classes/${state.classId}/stats`), 200, 'stats after attempts');
  assert.equal(stats.students.length, 3); // Anna, Max, Lisa

  const byName = new Map(stats.students.map((s) => [s.name, s]));
  const annaRow = byName.get('Anna Müller');
  assert.equal(annaRow.username, 'anna-mueller');
  assert.equal(annaRow.cells[state.a.id].state, 'done');
  assert.equal(annaRow.cells[state.a.id].score, 2);
  assert.equal(annaRow.cells[state.a.id].maxScore, 2);
  assert.equal(annaRow.cells[state.a.id].percent, 100);
  assert.ok(annaRow.cells[state.a.id].submittedAt);
  assert.equal(annaRow.cells[state.b.id].state, 'open');
  assert.equal(annaRow.total.percent, 100);

  const lisaRow = byName.get('Lisa Lustig');
  assert.equal(lisaRow.hasAccount, false);
  assert.equal(lisaRow.cells[state.b.id].state, 'done');
  assert.equal(lisaRow.cells[state.b.id].percent, 100);
  assert.equal(lisaRow.cells[state.a.id].state, 'open');

  const max = byName.get('Max Muster');
  assert.equal(max.cells[state.a.id].state, 'open');
  assert.equal(max.cells[state.b.id].state, 'open');
  assert.equal(max.total.percent, null);
  assert.equal(max.total.maxScore, 0);
});

test('stats: sequence-mode class shows locked state for not-yet-unlocked items', async () => {
  const admin = state.admin;
  const seq = await makeAssignment(admin, 'Quiz S', 'qs1');
  const created = expectStatus(await admin.post('/api/classes', { name: '4b', orderMode: 'sequence', unlockMinPercent: 100 }), 201, 'create seq class');
  const seqId = created.class.id;
  expectStatus(await admin.put(`/api/classes/${seqId}/items`, { assignmentIds: [state.a.id, seq.id] }), 200, 'seq items');
  expectStatus(await admin.post(`/api/classes/${seqId}/publish`, {}), 200, 'publish seq');
  await admin.post(`/api/classes/${seqId}/students`, { names: ['Anna Müller'] }); // reuses account

  const stats = expectStatus(await admin.get(`/api/classes/${seqId}/stats`), 200, 'seq stats');
  const anna = stats.students.find((s) => s.name === 'Anna Müller');
  // Anna has no attempt in this new class participant entry -> first item open, second locked
  assert.equal(anna.cells[state.a.id].state, 'open');
  assert.equal(anna.cells[seq.id].state, 'locked');
});
