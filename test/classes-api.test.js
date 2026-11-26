// API tests for the classes feature (bundles of assignments with free or
// sequential unlock): teacher CRUD/publish, student class join, lobby lock
// states, and enforcement on direct assignment joins.
//
// Ephemeral server in a temp DATA_DIR, same pattern as api.test.js.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-classes-'));
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

// One single-question multiple-choice activity, published as an assignment.
async function makeAssignment(admin, title, itemId) {
  const created = expectStatus(
    await admin.post('/api/activities', { title, template: 'quiz', locale: 'de' }),
    201,
    `create ${title}`,
  );
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
    await admin.put(`/api/activities/${activityId}`, {
      title,
      template: 'quiz',
      locale: 'de',
      definition,
      revision: current.activity.revision,
    }),
    200,
    `update ${title}`,
  );
  const published = expectStatus(
    await admin.post(`/api/activities/${activityId}/publish`, { title }),
    201,
    `publish ${title}`,
  );
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
    await Promise.race([
      new Promise((resolve) => serverProcess.once('exit', resolve)),
      delay(3000),
    ]);
  }
  if (logFd !== null) {
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir */ }
});

// ---------------------------------------------------------------------------
// Tests (sequential, shared state)
// ---------------------------------------------------------------------------

test('setup: admin login + three published quiz assignments', async () => {
  const admin = new Client(baseUrl);
  expectStatus(await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }), 200, 'login');
  state.admin = admin;
  state.a = await makeAssignment(admin, 'Quiz A', 'qa1');
  state.b = await makeAssignment(admin, 'Quiz B', 'qb1');
  state.c = await makeAssignment(admin, 'Quiz C', 'qc1');
  assert.match(state.a.code, /^[A-Z2-9]{6}$/);
});

test('classes: teacher endpoints require auth', async () => {
  const anon = new Client(baseUrl);
  const list = await anon.get('/api/classes');
  assert.equal(list.status, 401);
  const create = await anon.post('/api/classes', { name: 'X' });
  assert.equal(create.status, 401);
});

test('classes: create draft, publish requires at least one item', async () => {
  const admin = state.admin;
  const created = expectStatus(
    await admin.post('/api/classes', { name: 'Klasse 1', description: 'Lernpfad', orderMode: 'sequence', unlockMinPercent: 0 }),
    201,
    'create class',
  );
  state.classId = created.class.id;
  assert.equal(created.class.status, 'draft');
  assert.equal(created.class.code, null);
  assert.equal(created.class.orderMode, 'sequence');

  const badName = await admin.post('/api/classes', { name: '  ' });
  assert.equal(badName.status, 400);
  assert.equal(badName.json.error.code, 'invalid_class');

  const emptyPublish = await admin.post(`/api/classes/${state.classId}/publish`, {});
  assert.equal(emptyPublish.status, 409);
  assert.equal(emptyPublish.json.error.code, 'class_empty');
});

test('classes: item ordering validation + replace items', async () => {
  const admin = state.admin;
  const dup = await admin.put(`/api/classes/${state.classId}/items`, { assignmentIds: [state.a.id, state.a.id] });
  assert.equal(dup.status, 400);
  assert.equal(dup.json.error.code, 'duplicate_items');

  const missing = await admin.put(`/api/classes/${state.classId}/items`, { assignmentIds: ['nope'] });
  assert.equal(missing.status, 404);

  const set = expectStatus(
    await admin.put(`/api/classes/${state.classId}/items`, { assignmentIds: [state.a.id, state.b.id] }),
    200,
    'set items',
  );
  assert.equal(set.class.items.length, 2);
  assert.deepEqual(set.class.items.map((i) => [i.position, i.code]), [[1, state.a.code], [2, state.b.code]]);

  const detail = expectStatus(await admin.get(`/api/classes/${state.classId}`), 200, 'class detail');
  assert.equal(detail.class.itemCount, 2);
});

test('classes: publish generates a 6-char code and a /c/ url', async () => {
  const admin = state.admin;
  const published = expectStatus(await admin.post(`/api/classes/${state.classId}/publish`, {}), 200, 'publish');
  state.classCode = published.class.code;
  assert.match(state.classCode, /^[A-Z2-9]{6}$/);
  assert.ok(published.url.endsWith(`/c/${state.classCode}`));
  assert.equal(published.class.status, 'published');

  const list = expectStatus(await admin.get('/api/classes'), 200, 'list classes');
  const found = list.classes.find((entry) => entry.id === state.classId);
  assert.equal(found.code, state.classCode);
  assert.equal(found.itemCount, 2);
});

test('classes: public join info + name required + bad codes', async () => {
  const anon = new Client(baseUrl);
  const info = expectStatus(await anon.get(`/api/classes/join/${state.classCode}`), 200, 'join info');
  assert.equal(info.class.name, 'Klasse 1');
  assert.equal(info.class.orderMode, 'sequence');
  assert.equal(info.class.itemCount, 2);

  const bad = await anon.get('/api/classes/join/ZZZZZZ');
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error.code, 'invalid_code');

  const noName = await anon.post('/api/classes/join', { code: state.classCode, name: '  ' });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.error.code, 'name_required');

  const badJoin = await anon.post('/api/classes/join', { code: 'ZZZZZZ', name: 'X' });
  assert.equal(badJoin.status, 404);
});

test('classes: direct join of a gated assignment is rejected with class_required', async () => {
  const anon = new Client(baseUrl);
  const joinInfo = expectStatus(await anon.get(`/api/join/${state.a.code}`), 200, 'join info lists classCode');
  assert.equal(joinInfo.assignment.classCode, state.classCode);

  const direct = await anon.post('/api/join', { code: state.a.code, name: 'Direkt' });
  assert.equal(direct.status, 403);
  assert.equal(direct.json.error.code, 'class_required');
  assert.equal(direct.json.error.details.classCode, state.classCode);

  // Wrong/absent token is rejected the same way.
  const wrongToken = await anon.post('/api/join', { code: state.a.code, name: 'Direkt', classToken: 'x'.repeat(40) });
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.json.error.code, 'class_required');
});

test('classes: student joins class, lobby shows open/locked states, codes hidden when locked', async () => {
  const anon = new Client(baseUrl);
  const joined = expectStatus(
    await anon.post('/api/classes/join', { code: state.classCode, name: 'Lena' }),
    200,
    'class join',
  );
  state.classToken = joined.classToken;
  assert.ok(state.classToken && state.classToken.length >= 16);
  assert.equal(joined.participant.name, 'Lena');
  assert.equal(joined.class.name, 'Klasse 1');
  assert.equal(joined.class.items.length, 2);
  assert.equal(joined.class.items[0].state, 'open');
  assert.equal(joined.class.items[0].code, state.a.code);
  assert.equal(joined.class.items[1].state, 'locked');
  assert.equal(joined.class.items[1].code, null);
  assert.equal(joined.class.items[1].blockedBy, 1);

  // Resume via token.
  const resumed = expectStatus(
    await anon.get(`/api/classes/${state.classCode}/participant`, { classToken: state.classToken }),
    200,
    'resume lobby',
  );
  assert.equal(resumed.participant.name, 'Lena');
  assert.equal(resumed.class.items[1].state, 'locked');

  const badToken = await anon.get(`/api/classes/${state.classCode}/participant`, { classToken: 'y'.repeat(40) });
  assert.equal(badToken.status, 401);
  assert.equal(badToken.json.error.code, 'invalid_class_token');
});

test('classes: locked item rejects join with item_locked; unlocked item accepts', async () => {
  const anon = new Client(baseUrl);
  const locked = await anon.post('/api/join', { code: state.b.code, name: 'Lena', classToken: state.classToken });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.error.code, 'item_locked');
  assert.equal(locked.json.error.details.position, 2);
  assert.equal(locked.json.error.details.blockingPosition, 1);
  assert.equal(locked.json.error.details.classCode, state.classCode);

  const opened = expectStatus(
    await anon.post('/api/join', { code: state.a.code, name: 'Lena', classToken: state.classToken }),
    200,
    'join unlocked item',
  );
  state.participantToken = opened.participantToken;
  assert.ok(opened.class && opened.class.code === state.classCode);
  assert.equal(opened.class.orderMode, 'sequence');
});

test('classes: submit first item → second unlocks in the lobby', async () => {
  const anon = new Client(baseUrl);
  expectStatus(
    await anon.put(`/api/participant/responses/${state.a.itemId}`, { response: { selected: ['c1'] } }, { token: state.participantToken }),
    200,
    'save correct answer',
  );
  const submitted = expectStatus(
    await anon.post('/api/participant/submit', { confirm: true }, { token: state.participantToken }),
    200,
    'submit',
  );
  assert.equal(submitted.result.score, 2);
  assert.equal(submitted.result.maxScore, 2);

  const lobby = expectStatus(
    await anon.get(`/api/classes/${state.classCode}/participant`, { classToken: state.classToken }),
    200,
    'lobby after submit',
  );
  assert.equal(lobby.class.items[0].state, 'done');
  assert.equal(lobby.class.items[0].score, 2);
  assert.equal(lobby.class.items[1].state, 'open');
  assert.equal(lobby.class.items[1].code, state.b.code);

  const nowOpen = expectStatus(
    await anon.post('/api/join', { code: state.b.code, name: 'Lena', classToken: state.classToken }),
    200,
    'join newly unlocked item',
  );
  assert.ok(nowOpen.participantToken);
});

test('classes: unlock_min_percent gates the next item until the score is reached', async () => {
  const admin = state.admin;
  const anon = new Client(baseUrl);
  // Class 2: sequence, must reach 100% on C before B opens.
  const created = expectStatus(
    await admin.post('/api/classes', { name: 'Klasse 2', orderMode: 'sequence', unlockMinPercent: 100 }),
    201,
    'create class 2',
  );
  expectStatus(
    await admin.put(`/api/classes/${created.class.id}/items`, { assignmentIds: [state.c.id, state.b.id] }),
    200,
    'set items class 2',
  );
  const published = expectStatus(await admin.post(`/api/classes/${created.class.id}/publish`, {}), 200, 'publish class 2');
  const code2 = published.class.code;

  // Participant 1: answers C wrong → 0% → B stays locked.
  const j1 = expectStatus(await anon.post('/api/classes/join', { code: code2, name: 'Falsch' }), 200, 'join class 2');
  const p1 = expectStatus(
    await anon.post('/api/join', { code: state.c.code, name: 'Falsch', classToken: j1.classToken }),
    200,
    'join C',
  );
  expectStatus(
    await anon.put(`/api/participant/responses/${state.c.itemId}`, { response: { selected: ['c2'] } }, { token: p1.participantToken }),
    200,
    'save wrong',
  );
  expectStatus(await anon.post('/api/participant/submit', { confirm: true }, { token: p1.participantToken }), 200, 'submit wrong');

  const lobby1 = expectStatus(
    await anon.get(`/api/classes/${code2}/participant`, { classToken: j1.classToken }),
    200,
    'lobby class 2 (failed)',
  );
  assert.equal(lobby1.class.items[0].state, 'done');
  assert.equal(lobby1.class.items[0].score, 0);
  assert.equal(lobby1.class.items[1].state, 'locked');
  const blocked = await anon.post('/api/join', { code: state.b.code, name: 'Falsch', classToken: j1.classToken });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, 'item_locked');

  // Participant 2: answers C correctly → 100% → B opens.
  const j2 = expectStatus(await anon.post('/api/classes/join', { code: code2, name: 'Richtig' }), 200, 'join class 2 again');
  const p2 = expectStatus(
    await anon.post('/api/join', { code: state.c.code, name: 'Richtig', classToken: j2.classToken }),
    200,
    'join C (p2)',
  );
  expectStatus(
    await anon.put(`/api/participant/responses/${state.c.itemId}`, { response: { selected: ['c1'] } }, { token: p2.participantToken }),
    200,
    'save correct',
  );
  expectStatus(await anon.post('/api/participant/submit', { confirm: true }, { token: p2.participantToken }), 200, 'submit correct');

  const lobby2 = expectStatus(
    await anon.get(`/api/classes/${code2}/participant`, { classToken: j2.classToken }),
    200,
    'lobby class 2 (passed)',
  );
  assert.equal(lobby2.class.items[1].state, 'open');
  expectStatus(
    await anon.post('/api/join', { code: state.b.code, name: 'Richtig', classToken: j2.classToken }),
    200,
    'join B after passing threshold',
  );
});

test('classes: free order mode leaves everything open; sequence still gates direct joins', async () => {
  const admin = state.admin;
  const anon = new Client(baseUrl);
  const created = expectStatus(
    await admin.post('/api/classes', { name: 'Freie Klasse', orderMode: 'free' }),
    201,
    'create free class',
  );
  expectStatus(
    await admin.put(`/api/classes/${created.class.id}/items`, { assignmentIds: [state.a.id, state.b.id, state.c.id] }),
    200,
    'set free items',
  );
  const published = expectStatus(await admin.post(`/api/classes/${created.class.id}/publish`, {}), 200, 'publish free class');
  const joined = expectStatus(
    await anon.post('/api/classes/join', { code: published.class.code, name: 'Frei' }),
    200,
    'join free class',
  );
  assert.deepEqual(joined.class.items.map((i) => i.state), ['open', 'open', 'open']);
  assert.ok(joined.class.items.every((i) => typeof i.code === 'string'));

  // A is still gated by the published sequence class 1 → direct join 403.
  const direct = await anon.post('/api/join', { code: state.a.code, name: 'Direkt' });
  assert.equal(direct.status, 403);
  assert.equal(direct.json.error.code, 'class_required');
});

test('classes: unpublish removes the gate and hides the lobby; delete cleans up', async () => {
  const admin = state.admin;
  const anon = new Client(baseUrl);
  expectStatus(await admin.post(`/api/classes/${state.classId}/unpublish`, {}), 200, 'unpublish class 1');

  const info = await anon.get(`/api/classes/join/${state.classCode}`);
  assert.equal(info.status, 404);

  // No published sequence class contains A anymore → direct join works.
  const direct = expectStatus(await anon.post('/api/join', { code: state.a.code, name: 'Direkt' }), 200, 'direct join after unpublish');
  assert.equal(direct.class, null);

  const del = await admin.delete(`/api/classes/${state.classId}`);
  assert.equal(del.status, 204);
  const gone = await admin.get(`/api/classes/${state.classId}`);
  assert.equal(gone.status, 404);
});

test('classes: update fields (name/mode/percent) round-trips', async () => {
  const admin = state.admin;
  const created = expectStatus(
    await admin.post('/api/classes', { name: 'Alt', orderMode: 'free', unlockMinPercent: 0 }),
    201,
    'create',
  );
  const updated = expectStatus(
    await admin.put(`/api/classes/${created.class.id}`, { name: 'Neu', description: 'd', orderMode: 'sequence', unlockMinPercent: 80 }),
    200,
    'update',
  );
  assert.equal(updated.class.name, 'Neu');
  assert.equal(updated.class.orderMode, 'sequence');
  assert.equal(updated.class.unlockMinPercent, 80);

  const bad = await admin.put(`/api/classes/${created.class.id}`, { name: '' });
  assert.equal(bad.status, 400);
  await admin.delete(`/api/classes/${created.class.id}`);
});

test('classes: courses within a class � CRUD, item assignment, student payload groups by course', async () => {
  const admin = state.admin;
  const created = expectStatus(
    await admin.post('/api/classes', { name: 'Kurs-Test', orderMode: 'sequence', unlockMinPercent: 0 }),
    201,
    'create class',
  );
  const classId = created.class.id;

  // create two courses
  const c1 = expectStatus(await admin.post(`/api/classes/${classId}/courses`, { title: 'Unit 1 � Time for School' }), 201, 'course 1');
  const c2 = expectStatus(await admin.post(`/api/classes/${classId}/courses`, { title: 'Unit 2 � At the Zoo' }), 201, 'course 2');
  const courses = c2.class.courses;
  assert.equal(courses.length, 2);
  assert.equal(courses[0].title, 'Unit 1 � Time for School');
  assert.equal(courses[1].title, 'Unit 2 � At the Zoo');
  const course1 = courses[0].id;
  const course2 = courses[1].id;

  // assign items: A,B -> course1, C -> course2 (via items entries)
  const itemsRes = expectStatus(
    await admin.put(`/api/classes/${classId}/items`, {
      items: [
        { assignmentId: state.a.id, courseId: course1 },
        { assignmentId: state.b.id, courseId: course1 },
        { assignmentId: state.c.id, courseId: course2 },
      ],
    }),
    200,
    'set items with courses',
  );
  assert.equal(itemsRes.class.courses.find((c) => c.id === course1).itemCount, 2);
  assert.equal(itemsRes.class.courses.find((c) => c.id === course2).itemCount, 1);
  const itemCourse = new Map(itemsRes.class.items.map((item) => [item.assignmentId, item.courseId]));
  assert.equal(itemCourse.get(state.a.id), course1);
  assert.equal(itemCourse.get(state.c.id), course2);

  // invalid courseId rejected
  const bad = await admin.put(`/api/classes/${classId}/items`, { items: [{ assignmentId: state.a.id, courseId: 'nope' }] });
  assert.equal(bad.status, 400);

  // bonus flag round-trips on the class item (⭐ never blocks the sequence)
  const bonusRes = expectStatus(
    await admin.put(`/api/classes/${classId}/items`, {
      items: [
        { assignmentId: state.a.id, courseId: course1, bonus: true },
        { assignmentId: state.b.id, courseId: course1 },
        { assignmentId: state.c.id, courseId: course2 },
      ],
    }),
    200,
    'set items with bonus flag',
  );
  const bonusByAssignment = new Map(bonusRes.class.items.map((item) => [item.assignmentId, item.bonus]));
  assert.equal(bonusByAssignment.get(state.a.id), true);
  assert.equal(bonusByAssignment.get(state.b.id), false);

  // legacy assignmentIds still accepted (courseId null)
  const legacy = expectStatus(
    await admin.put(`/api/classes/${classId}/items`, { assignmentIds: [state.a.id, state.b.id] }),
    200,
    'legacy items',
  );
  assert.ok(legacy.class.items.every((item) => item.courseId === null));
  assert.ok(legacy.class.items.every((item) => item.bonus === false));
  // restore course assignment (without bonus, so later sequence-lock assertions hold)
  await admin.put(`/api/classes/${classId}/items`, {
    items: [
      { assignmentId: state.a.id, courseId: course1 },
      { assignmentId: state.b.id, courseId: course1 },
      { assignmentId: state.c.id, courseId: course2 },
    ],
  });

  // rename + reorder course
  const renamed = expectStatus(
    await admin.put(`/api/classes/${classId}/courses/${course2}`, { title: 'Unit 2 � Zoo', position: 1 }),
    200,
    'rename/reorder course',
  );
  assert.equal(renamed.class.courses[0].title, 'Unit 2 � Zoo');
  assert.equal(renamed.class.courses[0].id, course2);

  // publish and check the student payload carries courses + courseId
  expectStatus(await admin.post(`/api/classes/${classId}/publish`, {}), 200, 'publish');
  const detail = expectStatus(await admin.get(`/api/classes/${classId}`), 200, 'class detail');
  const classCode = detail.class.code;
  assert.ok(classCode, 'published class has a code');
  const anon = new Client(baseUrl);
  const joinInfo = expectStatus(await anon.get(`/api/classes/join/${classCode}`), 200, 'join info');
  assert.ok(joinInfo.class);
  const joined = expectStatus(await anon.post('/api/classes/join', { code: classCode, name: 'Kurs-Sch�ler' }), 200, 'class join');
  const payload = joined.class;
  assert.equal(payload.courses.length, 2);
  assert.ok(payload.items.every((item) => typeof item.courseId === 'string'));
  // sequence lock still works: first item open, rest locked
  assert.equal(payload.items[0].state, 'open');
  assert.equal(payload.items[1].state, 'locked');
  assert.equal(payload.items[2].state, 'locked');

  // delete course -> items become unassigned, course gone
  const delCourse = expectStatus(await admin.delete(`/api/classes/${classId}/courses/${course1}`), 200, 'delete course');
  assert.equal(delCourse.class.courses.length, 1);
  const unassigned = delCourse.class.items.filter((item) => item.courseId === null);
  assert.equal(unassigned.length, 2);

  // course create validation
  const noTitle = await admin.post(`/api/classes/${classId}/courses`, { title: '  ' });
  assert.equal(noTitle.status, 400);

  await admin.delete(`/api/classes/${classId}`);
});
