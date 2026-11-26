// API tests for student accounts (class roster with generated passwords),
// student login, account-linked joins, and practice mode.
// Ephemeral server in a temp DATA_DIR, same pattern as classes-api.test.js.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-students-'));
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
    if (options.classToken) headers['x-class-token'] = options.classToken;
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

async function makeAssignment(admin, title, itemId, settings = {}) {
  const created = expectStatus(await admin.post('/api/activities', { title, template: 'quiz', locale: 'de' }), 201, `create ${title}`);
  const activityId = created.activity.id;
  const current = expectStatus(await admin.get(`/api/activities/${activityId}`), 200, `get ${title}`);
  const definition = {
    v: 1,
    template: 'quiz',
    title,
    description: '',
    locale: 'de',
    settings: { instantFeedback: true, showResults: true, allowReview: true, requireName: true, ...settings },
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

test('setup: admin + class with one published assignment', async () => {
  const admin = new Client(baseUrl);
  expectStatus(await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }), 200, 'login');
  state.admin = admin;
  state.a = await makeAssignment(admin, 'Quiz A', 'qa1');
  const created = expectStatus(await admin.post('/api/classes', { name: '4a', orderMode: 'free' }), 201, 'create class');
  state.classId = created.class.id;
  expectStatus(await admin.put(`/api/classes/${state.classId}/items`, { assignmentIds: [state.a.id] }), 200, 'set items');
  const published = expectStatus(await admin.post(`/api/classes/${state.classId}/publish`, {}), 200, 'publish class');
  state.classCode = published.class.code;
});

test('roster: teacher adds names, gets generated credentials once', async () => {
  const admin = state.admin;
  const res = expectStatus(
    await admin.post(`/api/classes/${state.classId}/students`, { names: ['Anna Müller', 'Max Muster', 'anna müller'] }),
    201,
    'add students',
  );
  // duplicate name (case-insensitive) reuses the account
  assert.equal(res.credentials.length, 2);
  const anna = res.credentials.find((c) => c.name === 'Anna Müller');
  assert.equal(anna.username, 'anna-mueller');
  assert.match(anna.password, /^[A-Za-z2-9]{10}$/);
  assert.ok(!anna.password.includes('0') && !anna.password.includes('O'));
  state.anna = anna;
  state.maxPw = res.credentials.find((c) => c.name === 'Max Muster').password;

  const list = expectStatus(await admin.get(`/api/classes/${state.classId}/students`), 200, 'roster list');
  assert.equal(list.students.length, 2);
  assert.ok(list.students.every((s) => s.hasAccount && s.username));
  assert.ok(!JSON.stringify(list).includes(anna.password), 'roster list must not leak passwords');

  // anon cannot manage the roster
  const anon = new Client(baseUrl);
  assert.equal((await anon.get(`/api/classes/${state.classId}/students`)).status, 401);
  assert.equal((await anon.post(`/api/classes/${state.classId}/students`, { names: ['X Y'] })).status, 401);
});

test('student login: wrong password rejected, correct accepted; /api/student/me', async () => {
  const anon = new Client(baseUrl);
  const bad = await anon.post('/api/auth/student-login', { username: state.anna.username, password: 'wrongwrong' });
  assert.equal(bad.status, 401);

  const student = new Client(baseUrl);
  expectStatus(await student.post('/api/auth/student-login', { username: 'ANNA-MUELLER', password: state.anna.password }), 200, 'student login (case-insensitive username)');
  const me = expectStatus(await student.get('/api/student/me'), 200, 'student/me');
  assert.equal(me.student.username, 'anna-mueller');
  assert.equal(me.classes.length, 1);
  assert.equal(me.classes[0].code, state.classCode);
  assert.equal(me.classes[0].items.length, 1);

  // anonymous /api/student/me is rejected
  assert.equal((await anon.get('/api/student/me')).status, 401);
});

test('student login: full name ("Anna Müller") works like the username; wrong password rejected', async () => {
  const anon = new Client(baseUrl);
  // name with different case + extra whitespace
  expectStatus(
    await anon.post('/api/auth/student-login', { username: '  anna müller ', password: state.anna.password }),
    200,
    'login by full name',
  );
  // slug of the typed name also works
  expectStatus(
    await anon.post('/api/auth/student-login', { username: 'Anna Mueller', password: state.anna.password }),
    200,
    'login by slug of the name',
  );
  // full name but wrong password -> 401
  assert.equal(
    (await anon.post('/api/auth/student-login', { username: 'Anna Müller', password: 'wrongwrong' })).status,
    401,
  );
  // unknown name -> 401
  assert.equal(
    (await anon.post('/api/auth/student-login', { username: 'Niemand Hier', password: state.anna.password })).status,
    401,
  );
});

test('account join: class join links the roster entry, assignment join links the attempt', async () => {
  const student = new Client(baseUrl);
  await student.post('/api/auth/student-login', { username: state.anna.username, password: state.anna.password });

  const joined = expectStatus(await student.post('/api/classes/join', { code: state.classCode }), 200, 'class join with account');
  assert.equal(joined.participant.username, 'anna-mueller');
  assert.equal(joined.participant.name, 'Anna Müller');
  assert.ok(joined.classToken);

  // join the assignment directly — allowed via the account (free order class)
  const join = expectStatus(await student.post('/api/join', { code: state.a.code }), 200, 'assignment join with account');
  assert.equal(join.participant.username, 'anna-mueller');
  assert.ok(join.participantToken);
  state.annaToken = join.participantToken;

  // teacher sees the attempt under the account name
  const results = expectStatus(await state.admin.get(`/api/assignments/${state.a.id}/results`), 200, 'results');
  assert.equal(results.players.length, 1);
  assert.equal(results.players[0].name, 'Anna Müller');
});

test('roster: reset password returns a new one-time password', async () => {
  const admin = state.admin;
  const list = expectStatus(await admin.get(`/api/classes/${state.classId}/students`), 200, 'roster');
  const anna = list.students.find((s) => s.username === 'anna-mueller');
  const reset = expectStatus(await admin.post(`/api/classes/${state.classId}/students/${anna.id}/reset`, {}), 200, 'reset');
  assert.equal(reset.username, 'anna-mueller');
  assert.match(reset.password, /^[A-Za-z2-9]{10}$/);
  assert.notEqual(reset.password, state.anna.password);
  state.anna.password = reset.password;

  // old password no longer works, new one does
  const oldLogin = new Client(baseUrl);
  assert.equal((await oldLogin.post('/api/auth/student-login', { username: 'anna-mueller', password: 'anna-mueller' })).status, 401);
  const newLogin = new Client(baseUrl);
  expectStatus(await newLogin.post('/api/auth/student-login', { username: 'anna-mueller', password: reset.password }), 200, 'login with new pw');
});

test('practice mode: attempt is flagged and excluded from results, reopen works', async () => {
  const admin = state.admin;
  state.p = await makeAssignment(admin, 'Übungsquiz', 'qp1', { practice: true });

  const anon = new Client(baseUrl);
  const join = expectStatus(await anon.post('/api/join', { code: state.p.code, name: 'Übender' }), 200, 'join practice');
  assert.equal(join.assignment.settings.practice, true);
  const token = join.participantToken;

  // save the correct answer + submit
  expectStatus(await anon.put(`/api/participant/responses/${state.p.itemId}`, { response: { selected: ['c1'] } }, { token }), 200, 'save');
  const submitted = expectStatus(await anon.post('/api/participant/submit', { confirm: true }, { token }), 200, 'submit practice');
  assert.equal(submitted.result.score, 2);

  // results/dashboard exclude the practice attempt
  const results = expectStatus(await admin.get(`/api/assignments/${state.p.id}/results`), 200, 'practice results');
  assert.equal(results.players.length, 0);
  const csv = await admin.get(`/api/assignments/${state.p.id}/export.csv`);
  assert.ok(!csv.text.includes('Übender'), 'CSV must not contain the practice participant');

  // reopen is allowed in practice mode and restores in_progress
  const reopened = expectStatus(await anon.post('/api/participant/reopen', {}, { token }), 200, 'reopen');
  assert.equal(reopened.participant.status, 'in_progress');

  // reopen is rejected on a normal assignment
  const normalJoin = expectStatus(await anon.post('/api/join', { code: state.a.code, name: 'Normal' }), 200, 'join normal');
  const reopenDenied = await anon.post('/api/participant/reopen', {}, { token: normalJoin.participantToken });
  assert.equal(reopenDenied.status, 409);
});

test('roster: remove from class unlinks but keeps the account login working', async () => {
  const admin = state.admin;
  const list = expectStatus(await admin.get(`/api/classes/${state.classId}/students`), 200, 'roster');
  const max = list.students.find((s) => s.username === 'max-muster');
  expectStatus(await admin.delete(`/api/classes/${state.classId}/students/${max.id}`), 204, 'remove from class');
  const after = expectStatus(await admin.get(`/api/classes/${state.classId}/students`), 200, 'roster after');
  assert.equal(after.students.length, 1);

  // account itself still exists and can log in (just no classes)
  const client = new Client(baseUrl);
  expectStatus(await client.post('/api/auth/student-login', { username: 'max-muster', password: state.maxPw }), 200, 'account still works');
  const me = expectStatus(await client.get('/api/student/me'), 200, 'me');
  assert.equal(me.classes.length, 0);
});
