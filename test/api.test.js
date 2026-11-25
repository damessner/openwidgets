// End-to-end API tests against a real ephemeral server process:
// activities CRUD/validation/import/export -> publish -> join -> save -> submit
// -> live/SSE -> results -> grading -> CSV, plus assets, admin and time limits.
//
// The server is spawned with stdio redirected to a log file (the test sandbox
// does not allow piped stdio); DATA_DIR is a throw-away temp directory.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-api-'));
const logPath = path.join(dataDir, 'server.log');
const ADMIN = { email: 'admin@school.at', password: 'admin12345!', name: 'Admin' };
const ANSWER_SENTINEL = 'SENTINEL_ACCEPTED_ANSWER';

let serverProcess = null;
let baseUrl = '';
let logFd = null;
const state = {};

// ---------------------------------------------------------------------------
// HTTP client with a tiny cookie jar
// ---------------------------------------------------------------------------

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
    if (options.rawBody !== undefined) {
      body = options.rawBody;
    } else if (options.body !== undefined) {
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
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, headers: response.headers, text, buffer, json };
  }

  get(pathname, options) {
    return this.request(pathname, { ...options, method: 'GET' });
  }

  post(pathname, body, options) {
    return this.request(pathname, { ...options, method: 'POST', body });
  }

  put(pathname, body, options) {
    return this.request(pathname, { ...options, method: 'PUT', body });
  }

  patch(pathname, body, options) {
    return this.request(pathname, { ...options, method: 'PATCH', body });
  }

  delete(pathname, options) {
    return this.request(pathname, { ...options, method: 'DELETE' });
  }
}

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status} — ${response.text}`);
  return response.json;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openDatabase() {
  const db = new DatabaseSync(path.join(dataDir, 'openwidgets.db'));
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_IDS = {
  text: 'it_text0001',
  mc: 'it_mc000001',
  sa: 'it_sa000001',
  num: 'it_nm000001',
  fb: 'it_fb000001',
  match: 'it_ma000001',
  order: 'it_or000001',
  pins: 'it_pi000001',
  long: 'it_la000001',
};

function buildDefinition() {
  return {
    v: 1,
    template: 'worksheet',
    title: 'Plattentektonik Test',
    description: 'Eine Beschreibung',
    locale: 'de',
    settings: {
      instantFeedback: true,
      shuffleItems: false,
      showResults: true,
      allowReview: true,
      showAnswers: true,
      warnUnanswered: true,
      timeLimitMinutes: null,
      requireName: true,
    },
    items: [
      { id: ITEM_IDS.text, type: 'text', points: 0, stem: '', help: '', config: { text: 'Lesetext' } },
      {
        id: ITEM_IDS.mc,
        type: 'multiple_choice',
        points: 2,
        stem: 'Welche Aussage ist richtig?',
        help: 'Denk an die Platten.',
        config: {
          multi: false,
          shuffle: false,
          partialCredit: true,
          choices: [
            { id: 'c1', text: 'Richtig', correct: true },
            { id: 'c2', text: 'Falsch', correct: false },
          ],
        },
      },
      {
        id: ITEM_IDS.sa,
        type: 'short_answer',
        points: 1,
        stem: 'Wie heißt der Vorgang?',
        config: { accepted: ['Photosynthese', ANSWER_SENTINEL], caseSensitive: false },
      },
      {
        id: ITEM_IDS.num,
        type: 'numeric',
        points: 1,
        stem: 'Wie viel?',
        config: { answer: 3.5, tolerance: 0.01, toleranceType: 'absolute' },
      },
      {
        id: ITEM_IDS.fb,
        type: 'fill_blanks',
        points: 2,
        stem: 'Ergänze.',
        config: {
          text: 'Platten gleiten an {{1}} Grenzen.',
          blanks: { 1: { accepted: ['transform'] } },
          caseSensitive: false,
        },
      },
      {
        id: ITEM_IDS.match,
        type: 'match',
        points: 2,
        stem: 'Ordne zu.',
        config: {
          shuffle: true,
          pairs: [
            { id: 'p1', left: 'A', right: '1' },
            { id: 'p2', left: 'B', right: '2' },
          ],
        },
      },
      {
        id: ITEM_IDS.order,
        type: 'ordering',
        points: 2,
        stem: 'Sortiere.',
        config: {
          mode: 'positions',
          items: [
            { id: 'i1', text: 'eins' },
            { id: 'i2', text: 'zwei' },
            { id: 'i3', text: 'drei' },
          ],
        },
      },
      {
        id: ITEM_IDS.pins,
        type: 'pins',
        points: 2,
        stem: 'Markiere.',
        config: {
          image: { assetId: '', alt: 'Karte' },
          zones: [
            { id: 'z1', label: 'Transform-Rand', x: 0.3, y: 0.4, r: 0.05 },
            { id: 'z2', label: 'Divergenz', x: 0.7, y: 0.7, r: 0.05 },
          ],
        },
      },
      {
        id: ITEM_IDS.long,
        type: 'long_answer',
        points: 5,
        stem: 'Erkläre die Photosynthese.',
        config: {
          hints: [{ text: 'photosynthese', alternatives: [ANSWER_SENTINEL], points: 2 }],
          rubric: [{ criterion: 'Fachliche Richtigkeit', levels: [{ label: 'gut', points: 5 }] }],
          minWords: 0,
          maxWords: 3000,
        },
      },
    ],
  };
}

const CORRECT_RESPONSES = {
  [ITEM_IDS.mc]: { selected: ['c1'] },
  [ITEM_IDS.sa]: { text: '  photosynthese! ' },
  [ITEM_IDS.num]: { value: '3,5' },
  [ITEM_IDS.fb]: { blanks: { 1: 'Transform' } },
  [ITEM_IDS.match]: { matches: { p1: 'p1', p2: 'p2' } },
  [ITEM_IDS.order]: { order: ['i1', 'i2', 'i3'] },
  [ITEM_IDS.pins]: { points: { z1: { x: 0.31, y: 0.41 }, z2: { x: 0.7, y: 0.7 } } },
  [ITEM_IDS.long]: { text: 'Die Photosynthese läuft in den Chloroplasten ab.' },
};

// ---------------------------------------------------------------------------
// Start / stop the server
// ---------------------------------------------------------------------------

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
      MAX_UPLOAD_MB: '1',
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  let healthy = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not up yet */
    }
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
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows may keep the SQLite file locked for a moment — temp dir is fine to leave */
  }
});

// ---------------------------------------------------------------------------
// Tests (sequential, shared state)
// ---------------------------------------------------------------------------

test('health and capabilities', async () => {
  const anon = new Client(baseUrl);
  const health = expectStatus(await anon.get('/api/health'), 200, 'health');
  assert.equal(health.status, 'ok');
  assert.equal(health.db, 'ok');
  assert.equal(typeof health.version, 'string');
  const anonCaps = expectStatus(await anon.get('/api/capabilities'), 200, 'capabilities anon');
  // Anonymous callers must NOT see version/item types (public landing page).
  assert.equal(anonCaps.itemTypes, undefined);
  assert.equal(anonCaps.version, undefined);
  assert.equal(anonCaps.features.sse, true);
  assert.equal(anonCaps.features.studentAccounts, true);
  assert.ok(anonCaps.maxUploadMb >= 1);

  // Authenticated teacher gets the full capabilities.
  const authed = new Client(baseUrl);
  await authed.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  const capabilities = expectStatus(await authed.get('/api/capabilities'), 200, 'capabilities authed');
  assert.equal(capabilities.itemTypes.length, 16);
  assert.equal(typeof capabilities.version, 'string');
});

test('auth: guards and login', async () => {
  const anon = new Client(baseUrl);
  expectStatus(await anon.get('/api/activities'), 401, 'activities without session');
  expectStatus(await anon.get('/api/me'), 401, 'me without session');

  const badLogin = await anon.post('/api/auth/login', { email: ADMIN.email, password: 'wrong-password' });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.json.error.code, 'invalid_credentials');

  const admin = new Client(baseUrl);
  const login = expectStatus(await admin.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password }), 200, 'login');
  assert.equal(login.user.role, 'admin');
  assert.equal(login.user.email, ADMIN.email);
  const me = expectStatus(await admin.get('/api/me'), 200, 'me');
  assert.equal(me.user.email, ADMIN.email);
  state.admin = admin;
});

test('activities: create, list, get', async () => {
  const admin = state.admin;
  const created = expectStatus(
    await admin.post('/api/activities', { title: 'Meine Aktivität', template: 'worksheet', locale: 'de' }),
    201,
    'create activity',
  );
  state.activityId = created.activity.id;
  assert.equal(created.activity.revision, 1);
  assert.equal(created.activity.status, 'draft');
  assert.equal(created.activity.template, 'worksheet');
  assert.deepEqual(created.activity.definition.items, []);
  assert.equal(created.activity.maxScore, 0);

  const list = expectStatus(await admin.get('/api/activities'), 200, 'list activities');
  const found = list.activities.find((entry) => entry.id === state.activityId);
  assert.ok(found);
  assert.equal(found.title, 'Meine Aktivität');
  assert.equal(found.itemCount, 0);
  assert.equal(found.assignmentCount, 0);

  const detail = expectStatus(await admin.get(`/api/activities/${state.activityId}`), 200, 'get activity');
  assert.equal(detail.activity.id, state.activityId);
  assert.ok(detail.activity.definition);
});

test('activities: invalid definition is rejected with details', async () => {
  const admin = state.admin;
  const current = expectStatus(await admin.get(`/api/activities/${state.activityId}`), 200, 'reload');
  const bad = await admin.put(`/api/activities/${state.activityId}`, {
    title: 'Bad',
    definition: {
      v: 1,
      template: 'worksheet',
      title: 'Bad',
      settings: {},
      items: [{ id: 'it_bad', type: 'not_a_real_type', points: 1, stem: 'x' }],
    },
    revision: current.activity.revision,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'validation_failed');
  assert.ok(Array.isArray(bad.json.error.details));
  assert.ok(bad.json.error.details.some((entry) => entry.path.startsWith('items[0]')));
});

test('activities: full update stores the definition and bumps revision', async () => {
  const admin = state.admin;
  const current = expectStatus(await admin.get(`/api/activities/${state.activityId}`), 200, 'reload');
  const definition = buildDefinition();
  const updated = expectStatus(
    await admin.put(`/api/activities/${state.activityId}`, {
      title: definition.title,
      description: definition.description,
      template: definition.template,
      locale: definition.locale,
      definition,
      revision: current.activity.revision,
    }),
    200,
    'update activity',
  );
  assert.equal(updated.activity.revision, 2);
  assert.equal(updated.activity.definition.items.length, 9);
  assert.equal(updated.activity.maxScore, 17);
  assert.equal(updated.activity.itemCount, 9);
  state.revision = 2;
  state.definition = updated.activity.definition;
});

test('activities: stale revision yields 409 revision_conflict', async () => {
  const admin = state.admin;
  const stale = await admin.put(`/api/activities/${state.activityId}`, {
    title: 'Race',
    definition: state.definition,
    revision: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'revision_conflict');
});

test('activities: duplicate regenerates item ids and appends " (Kopie)"', async () => {
  const admin = state.admin;
  const duplicated = expectStatus(
    await admin.post(`/api/activities/${state.activityId}/duplicate`, {}),
    201,
    'duplicate',
  );
  state.duplicateId = duplicated.activity.id;
  assert.equal(duplicated.activity.revision, 1);
  assert.equal(duplicated.activity.status, 'draft');
  assert.ok(duplicated.activity.title.endsWith(' (Kopie)'));
  assert.equal(duplicated.activity.definition.items.length, 9);
  const originalIds = new Set(state.definition.items.map((item) => item.id));
  for (const item of duplicated.activity.definition.items) {
    assert.ok(!originalIds.has(item.id), 'duplicated item ids must be fresh');
  }
  const mc = duplicated.activity.definition.items.find((item) => item.type === 'multiple_choice');
  assert.deepEqual(mc.config.choices.map((choice) => choice.correct), [true, false]);
});

test('activities: export envelope and import round-trip', async () => {
  const admin = state.admin;
  const exported = await admin.get(`/api/activities/${state.activityId}/export`);
  expectStatus(exported, 200, 'export');
  assert.match(exported.headers.get('content-disposition') || '', /attachment; filename="openwidgets-.*\.json"/);
  assert.equal(exported.json.format, 'openwidgets.activity');
  assert.equal(exported.json.formatVersion, 1);
  assert.equal(typeof exported.json.exportedAt, 'string');
  assert.equal(exported.json.activity.items.length, 9);
  assert.equal(exported.json.activity.settings.showAnswers, true);
  assert.ok(!('id' in exported.json.activity), 'export envelope hides internal activity ids');

  const imported = expectStatus(await admin.post('/api/activities/import', exported.json), 201, 'import');
  state.importId = imported.activity.id;
  assert.equal(imported.activity.revision, 1);
  assert.equal(imported.activity.definition.items.length, 9);
  assert.ok(imported.activity.definition.items.every((item) => typeof item.id === 'string' && item.id));

  const bare = expectStatus(
    await admin.post('/api/activities/import', {
      title: 'Bare Import',
      template: 'quiz',
      locale: 'en',
      items: [{ type: 'text', config: { text: 'Hallo' } }],
    }),
    201,
    'bare import',
  );
  assert.equal(bare.activity.template, 'quiz');
  assert.equal(bare.activity.locale, 'en');
  assert.match(bare.activity.definition.items[0].id, /^it_/);
});

test('assignments: publish snapshots settings and generates a code', async () => {
  const admin = state.admin;
  const published = expectStatus(
    await admin.post(`/api/activities/${state.activityId}/publish`, { title: 'Live-Test' }),
    201,
    'publish',
  );
  state.assignmentId = published.assignment.id;
  state.assignmentCode = published.assignment.code;
  assert.match(published.assignment.code, /^[A-Z2-9]{6}$/);
  assert.equal(published.assignment.status, 'open');
  assert.equal(published.assignment.title, 'Live-Test');
  assert.equal(published.assignment.settings.showAnswers, true);
  assert.equal(published.assignment.maxScore, 17);
  assert.equal(published.assignment.itemOrder.length, 9);
  assert.equal(published.assignment.activity.definition.items.length, 9);
  assert.ok(published.assignment.url.endsWith(`/a/${published.assignment.code}`));

  const assignments = expectStatus(await admin.get('/api/assignments'), 200, 'list assignments');
  const entry = assignments.assignments.find((candidate) => candidate.id === state.assignmentId);
  assert.ok(entry);
  assert.equal(entry.activityTitle, 'Plattentektonik Test');
  assert.equal(entry.participantCount, 0);
  assert.equal(entry.maxScore, 17);

  const detail = expectStatus(await admin.get(`/api/assignments/${state.assignmentId}`), 200, 'assignment detail');
  assert.equal(detail.assignment.activity.definition.items.length, 9);
  assert.equal(detail.assignment.settings.showAnswers, true);
  assert.equal(detail.assignment.itemOrder.length, 9);
});

test('assignments: live returns empty roster, SSE sends a snapshot', async () => {
  const admin = state.admin;
  const live = expectStatus(await admin.get(`/api/assignments/${state.assignmentId}/live`), 200, 'live');
  assert.deepEqual(live.players, []);
  assert.equal(live.items.length, 8, 'only scoreable items appear in the live grid');
  assert.equal(live.items[0].index, 1);
  assert.equal(typeof live.items[0].label.de, 'string');

  const snapshot = await readSseMessage(`/api/assignments/${state.assignmentId}/stream`, admin.cookieHeader());
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.items.length, 8);
  assert.deepEqual(snapshot.players, []);
});

test('join: info, unknown code, missing name', async () => {
  const anon = new Client(baseUrl);
  const info = expectStatus(await anon.request(`/api/join/${state.assignmentCode}`), 200, 'join info');
  assert.equal(info.assignment.code, state.assignmentCode);
  assert.equal(info.assignment.requireName, true);
  assert.equal(info.activity.title, 'Plattentektonik Test');
  assert.ok(!('definition' in info.activity), 'join info must not leak the activity');

  const unknownInfo = await anon.get('/api/join/ZZZZZZ');
  assert.equal(unknownInfo.status, 404);
  assert.equal(unknownInfo.json.error.code, 'invalid_code');

  const badCode = await anon.post('/api/join', { code: 'ZZZZZZ', name: 'Max' });
  assert.equal(badCode.status, 404);
  assert.equal(badCode.json.error.code, 'invalid_code');

  const noName = await anon.post('/api/join', { code: state.assignmentCode, name: '   ' });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.error.code, 'name_required');
});

test('join: creates a participant and never leaks answers', async () => {
  const anon = new Client(baseUrl);
  const joined = expectStatus(
    await anon.post('/api/join', { code: state.assignmentCode.toLowerCase(), name: 'Max Mustermann' }),
    200,
    'join',
  );
  state.participantToken = joined.participantToken;
  state.participantId = joined.participant.id;
  assert.ok(joined.participantToken.length >= 24);
  assert.equal(joined.participant.name, 'Max Mustermann');
  assert.equal(joined.activity.items.length, 9);
  assert.deepEqual(joined.responses, []);
  assert.deepEqual(joined.flags, []);
  assert.equal(joined.assignment.settings.showAnswers, true);

  const payload = JSON.stringify(joined);
  assert.ok(!payload.includes(ANSWER_SENTINEL), 'student payload leaked an accepted answer');
  assert.ok(!payload.includes('"accepted"'), 'student payload leaked accepted lists');
  assert.ok(!payload.includes('"correct"'), 'student payload leaked correct flags');
  assert.ok(!payload.includes('"hints"'), 'student payload leaked hints');
  assert.ok(!payload.includes('"rubric"'), 'student payload leaked the rubric');
  assert.ok(!payload.includes('"tolerance"'), 'student payload leaked the tolerance');

  const byType = new Map(joined.activity.items.map((item) => [item.type, item]));
  assert.deepEqual(Object.keys(byType.get('pins').config.zones[0]).sort(), ['id', 'label']);
  assert.ok(!('r' in byType.get('pins').config.zones[0]));
  assert.ok(!('x' in byType.get('pins').config.zones[0]));
  assert.deepEqual(byType.get('multiple_choice').config.choices, [
    { id: 'c1', text: 'Richtig' },
    { id: 'c2', text: 'Falsch' },
  ]);
  assert.ok(!('answer' in byType.get('numeric').config));
  assert.ok(!('accepted' in byType.get('short_answer').config));
  assert.ok(!('blanks' in byType.get('fill_blanks').config));
  assert.ok(!('pairs' in byType.get('match').config));
  assert.equal(byType.get('match').config.lefts.length, 2);
  assert.equal(byType.get('match').config.rights.length, 2);
  assert.equal(byType.get('ordering').config.items.length, 3);
  assert.ok(!('hints' in byType.get('long_answer').config));
});

test('participant: state endpoint returns sanitized activity and empty responses', async () => {
  const anon = new Client(baseUrl);
  const stateResponse = await anon.get('/api/participant', { token: state.participantToken });
  const payload = expectStatus(stateResponse, 200, 'participant state');
  assert.equal(payload.participant.status, 'in_progress');
  assert.equal(payload.participant.score, 0);
  assert.equal(payload.participant.maxScore, 17);
  assert.deepEqual(payload.responses, []);
  assert.equal(payload.activity.items.length, 9);
  assert.ok(!JSON.stringify(payload).includes(ANSWER_SENTINEL));

  const noToken = await anon.get('/api/participant');
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'invalid_participant_token');

  const notSubmitted = await anon.get('/api/participant/result', { token: state.participantToken });
  assert.equal(notSubmitted.status, 403);
  assert.equal(notSubmitted.json.error.code, 'not_submitted');
});

test('responses: server-authoritative scoring per item type', async () => {
  const anon = new Client(baseUrl);
  const token = state.participantToken;
  const expected = [
    [ITEM_IDS.mc, 2],
    [ITEM_IDS.sa, 1],
    [ITEM_IDS.num, 1],
    [ITEM_IDS.fb, 2],
    [ITEM_IDS.match, 2],
    [ITEM_IDS.order, 2],
    [ITEM_IDS.pins, 2],
    [ITEM_IDS.long, 2],
  ];
  let running = 0;
  for (const [itemId, autoScore] of expected) {
    const saved = await anon.put(`/api/participant/responses/${itemId}`, { response: CORRECT_RESPONSES[itemId] }, {
      token,
    });
    const body = expectStatus(saved, 200, `save ${itemId}`);
    assert.equal(body.saved, true);
    assert.equal(body.result.autoScore, autoScore, `autoScore for ${itemId}`);
    assert.equal(body.result.maxScore, state.definition.items.find((item) => item.id === itemId).points);
    running += autoScore;
    assert.equal(body.score, running);
    assert.equal(body.maxScore, 17);
  }
  const longAnswer = expectStatus(
    await anon.put(`/api/participant/responses/${ITEM_IDS.long}`, { response: CORRECT_RESPONSES[ITEM_IDS.long] }, { token }),
    200,
    'long answer save',
  );
  assert.equal(longAnswer.result.needsManual, true);
  assert.equal(longAnswer.result.correct, false);

  // A wrong answer scores 0 and does not leak the correct choice.
  const wrong = expectStatus(
    await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: { selected: ['c2'] } }, { token }),
    200,
    'wrong mc',
  );
  assert.equal(wrong.result.autoScore, 0);
  assert.equal(wrong.result.correct, false);
  // Restore the correct answer for the rest of the flow.
  expectStatus(
    await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: CORRECT_RESPONSES[ITEM_IDS.mc] }, { token }),
    200,
    'restore mc',
  );

  const invalidResponse = await anon.put(`/api/participant/responses/${ITEM_IDS.order}`, { response: { nope: 1 } }, {
    token,
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.json.error.code, 'invalid_response');

  const unknownItem = await anon.put('/api/participant/responses/it_does_not_exist', { response: {} }, { token });
  assert.equal(unknownItem.status, 404);

  const textItem = await anon.put(`/api/participant/responses/${ITEM_IDS.text}`, { response: {} }, { token });
  assert.equal(textItem.status, 400);
});

test('participant: heartbeat and starred questions', async () => {
  const anon = new Client(baseUrl);
  const token = state.participantToken;
  const heartbeat = expectStatus(await anon.post('/api/participant/heartbeat', {}, { token }), 200, 'heartbeat');
  assert.equal(heartbeat.ok, true);

  const flags = expectStatus(
    await anon.post('/api/participant/flags', { flags: [ITEM_IDS.mc, ITEM_IDS.long, 'ghost_item'] }, { token }),
    200,
    'flags',
  );
  assert.deepEqual(flags.flags, [ITEM_IDS.mc, ITEM_IDS.long]);
});

test('assignments: live dashboard reflects answers and presence', async () => {
  const admin = state.admin;
  const live = expectStatus(await admin.get(`/api/assignments/${state.assignmentId}/live`), 200, 'live');
  assert.equal(live.players.length, 1);
  const player = live.players[0];
  assert.equal(player.name, 'Max Mustermann');
  assert.equal(player.status, 'in_progress');
  assert.equal(player.online, true);
  assert.equal(player.score, 14);
  assert.equal(player.maxScore, 17);
  assert.equal(player.items[ITEM_IDS.mc], 'correct');
  assert.equal(player.items[ITEM_IDS.long], 'manual');
  assert.deepEqual(player.flags, [ITEM_IDS.mc, ITEM_IDS.long]);

  const snapshot = await readSseMessage(`/api/assignments/${state.assignmentId}/stream`, admin.cookieHeader());
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].score, 14);
});

test('assignments: results include raw responses for the teacher', async () => {
  const admin = state.admin;
  const results = expectStatus(await admin.get(`/api/assignments/${state.assignmentId}/results`), 200, 'results');
  assert.equal(results.items.length, 8);
  assert.equal(results.players.length, 1);
  const player = results.players[0];
  assert.equal(player.responses.length, 8);
  const mcResponse = player.responses.find((entry) => entry.itemId === ITEM_IDS.mc);
  assert.deepEqual(mcResponse.response, { selected: ['c1'] });
  assert.equal(mcResponse.manualScore, null);
  assert.equal(mcResponse.needsManual, false);
  const longResponse = player.responses.find((entry) => entry.itemId === ITEM_IDS.long);
  assert.equal(longResponse.needsManual, true);
  assert.equal(longResponse.correct, false);
});

test('submit: result payload with solutions, re-submit rejected', async () => {
  const anon = new Client(baseUrl);
  const token = state.participantToken;
  const submitted = expectStatus(await anon.post('/api/participant/submit', { confirm: true }, { token }), 200, 'submit');
  assert.equal(submitted.participant.score, 14, `participant status ${submitted.participant.status}`);
  assert.ok(['submitted', 'graded'].includes(submitted.participant.status));
  assert.equal(submitted.result.showResults, true);
  assert.equal(submitted.result.showAnswers, true);
  assert.equal(submitted.result.items.length, 8);
  const mc = submitted.result.items.find((entry) => entry.itemId === ITEM_IDS.mc);
  assert.deepEqual(mc.answerText, ['Richtig']);
  assert.deepEqual(mc.answer, { selected: ['c1'] });
  const sa = submitted.result.items.find((entry) => entry.itemId === ITEM_IDS.sa);
  assert.deepEqual(sa.answerText, ['Photosynthese']);
  const numeric = submitted.result.items.find((entry) => entry.itemId === ITEM_IDS.num);
  assert.deepEqual(numeric.answerText, ['3.5']);
  const pins = submitted.result.items.find((entry) => entry.itemId === ITEM_IDS.pins);
  assert.equal(pins.answerText.length, 2);
  assert.equal(pins.answerZones.length, 2);
  assert.ok(typeof pins.answerZones[0].r === 'number');

  const result = expectStatus(await anon.get('/api/participant/result', { token }), 200, 'result');
  assert.equal(result.participant.status, 'submitted');

  const again = await anon.post('/api/participant/submit', { confirm: true }, { token });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'attempt_submitted');

  const saveAfterSubmit = await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: { selected: ['c1'] } }, {
    token,
  });
  assert.equal(saveAfterSubmit.status, 409);
  assert.equal(saveAfterSubmit.json.error.code, 'attempt_submitted');

  // Submit is rate limited (5 per minute per token); after the 6th call -> 429.
  let sawRateLimit = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const limited = await anon.post('/api/participant/submit', { confirm: true }, { token });
    if (limited.status === 429) {
      assert.equal(limited.json.error.code, 'rate_limited');
      sawRateLimit = true;
      break;
    }
    assert.equal(limited.status, 409);
  }
  assert.ok(sawRateLimit, 'submit endpoint must rate limit repeated attempts');
});

test('grading: review, manual score and feedback, status becomes graded', async () => {
  const admin = state.admin;
  const review = expectStatus(
    await admin.get(`/api/participants/${state.participantId}/review`),
    200,
    'participant review',
  );
  assert.equal(review.participant.name, 'Max Mustermann');
  assert.equal(review.activity.definition.items.length, 9);
  assert.equal(review.responses.length, 8);

  const patched = expectStatus(
    await admin.patch(`/api/participants/${state.participantId}/responses/${ITEM_IDS.long}`, {
      manualScore: 5,
      feedback: 'Sehr gut erklärt!',
    }),
    200,
    'manual score',
  );
  assert.equal(patched.response.manualScore, 5);
  assert.equal(patched.response.feedback, 'Sehr gut erklärt!');
  assert.equal(patched.response.correct, true);
  assert.deepEqual(patched.participantTotals, { score: 17, maxScore: 17 });

  const patchedAgain = expectStatus(
    await admin.patch(`/api/participants/${state.participantId}/responses/${ITEM_IDS.long}`, {
      manualScore: 3,
    }),
    200,
    'manual score partial',
  );
  assert.equal(patchedAgain.response.correct, false);
  assert.deepEqual(patchedAgain.participantTotals, { score: 15, maxScore: 17 });

  const invalidScore = await admin.patch(
    `/api/participants/${state.participantId}/responses/${ITEM_IDS.long}`,
    { manualScore: 999 },
  );
  assert.equal(invalidScore.status, 400);

  expectStatus(
    await admin.patch(`/api/participants/${state.participantId}/responses/${ITEM_IDS.long}`, { manualScore: 5 }),
    200,
    'restore manual score',
  );
  const reviewAfter = expectStatus(
    await admin.get(`/api/participants/${state.participantId}/review`),
    200,
    'review after grading',
  );
  assert.equal(reviewAfter.participant.status, 'graded');
  assert.equal(reviewAfter.participant.score, 17);
});

test('CSV: BOM, German Excel separators and per-item columns', async () => {
  const admin = state.admin;
  const response = await admin.get(`/api/assignments/${state.assignmentId}/export.csv`);
  expectStatus(response, 200, 'csv');
  assert.match(response.headers.get('content-type') || '', /^text\/csv; charset=utf-8/);
  assert.match(response.headers.get('content-disposition') || '', /attachment; filename=".*\.csv"/);
  assert.equal(response.text.charCodeAt(0), 0xfeff, 'CSV must start with a UTF-8 BOM');
  const body = response.text.slice(1);
  const lines = body.split('\r\n').filter((line) => line !== '');
  const header = lines[0].split(';');
  assert.deepEqual(header.slice(0, 6), ['participant', 'status', 'score', 'max_score', 'started_at', 'submitted_at']);
  assert.equal(header.length, 6 + 8 * 2);
  assert.equal(header[6], 'item_1');
  assert.equal(header[7], 'item_1_state');
  assert.equal(lines.length, 2);
  const cells = lines[1].split(';');
  assert.equal(cells[0], 'Max Mustermann');
  assert.equal(cells[1], 'graded');
  assert.equal(cells[2], '17');
  assert.equal(cells[3], '17');
  const scoreIndex = header.indexOf('item_1');
  const stateIndex = header.indexOf('item_1_state');
  assert.equal(cells[scoreIndex], '2', 'item 1 is the multiple-choice item worth 2 points');
  assert.equal(cells[stateIndex], 'correct');
  const longIndex = header.indexOf('item_8');
  assert.equal(cells[header.indexOf('item_8_state')], 'manual');
  assert.equal(cells[longIndex], '5', 'manually graded long answer score');
});

test('participant lifecycle: force submit, reset, delete', async () => {
  const admin = state.admin;
  const anon = new Client(baseUrl);
  const joined = expectStatus(
    await anon.post('/api/join', { code: state.assignmentCode, name: 'Zoe Zweit' }),
    200,
    'second join',
  );
  const token = joined.participantToken;
  const participantId = joined.participant.id;
  expectStatus(await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: { selected: ['c2'] } }, { token }), 200, 'save wrong');

  const forced = expectStatus(await admin.post(`/api/participants/${participantId}/submit`, {}), 200, 'force submit');
  assert.equal(forced.participant.status, 'graded');

  const reset = expectStatus(await admin.post(`/api/participants/${participantId}/reset`, {}), 200, 'reset');
  assert.equal(reset.participant.status, 'in_progress');
  assert.equal(reset.participant.score, 0);
  const review = expectStatus(await admin.get(`/api/participants/${participantId}/review`), 200, 'review after reset');
  assert.deepEqual(review.responses, []);

  expectStatus(await admin.delete(`/api/participants/${participantId}`), 204, 'delete participant');
  const gone = await admin.get(`/api/participants/${participantId}/review`);
  assert.equal(gone.status, 404);
});

test('assignment status: closing blocks saves, reopening allows them', async () => {
  const admin = state.admin;
  const anon = new Client(baseUrl);
  const joined = expectStatus(await anon.post('/api/join', { code: state.assignmentCode, name: 'Tim Dritt' }), 200, 'join');
  const token = joined.participantToken;

  const closed = expectStatus(
    await admin.patch(`/api/assignments/${state.assignmentId}`, { status: 'closed' }),
    200,
    'close assignment',
  );
  assert.equal(closed.assignment.status, 'closed');
  const saveClosed = await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: { selected: ['c1'] } }, {
    token,
  });
  assert.equal(saveClosed.status, 409);
  assert.equal(saveClosed.json.error.code, 'assignment_closed');
  const joinClosed = await anon.post('/api/join', { code: state.assignmentCode, name: 'Neu' });
  assert.equal(joinClosed.status, 409);
  assert.equal(joinClosed.json.error.code, 'assignment_closed');
  const closedInfo = expectStatus(await anon.get(`/api/join/${state.assignmentCode}`), 200, 'closed join info');
  assert.equal(closedInfo.assignment.status, 'closed');

  const invalidStatus = await admin.patch(`/api/assignments/${state.assignmentId}`, { status: 'paused' });
  assert.equal(invalidStatus.status, 400);
  const invalidDue = await admin.patch(`/api/assignments/${state.assignmentId}`, { dueAt: 'not-a-date' });
  assert.equal(invalidDue.status, 400);
  assert.equal(invalidDue.json.error.code, 'invalid_due_at');
  const dueAt = new Date(Date.now() + 86400000).toISOString();
  const renamed = expectStatus(
    await admin.patch(`/api/assignments/${state.assignmentId}`, { title: 'Umbenannt', dueAt }),
    200,
    'patch title/dueAt',
  );
  assert.equal(renamed.assignment.title, 'Umbenannt');
  assert.equal(renamed.assignment.dueAt, dueAt);

  const reopened = expectStatus(
    await admin.patch(`/api/assignments/${state.assignmentId}`, { status: 'open' }),
    200,
    'reopen assignment',
  );
  assert.equal(reopened.assignment.status, 'open');
  expectStatus(await anon.put(`/api/participant/responses/${ITEM_IDS.mc}`, { response: { selected: ['c1'] } }, { token }), 200, 'save after reopen');
});

test('assets: upload allowlist, public immutable serving, delete', async () => {
  const admin = state.admin;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
  const uploaded = await admin.post('/api/assets?filename=Mein%20Bild.png', undefined, {
    rawBody: png,
    headers: { 'content-type': 'image/png' },
  });
  const assetBody = expectStatus(uploaded, 201, 'upload asset');
  state.assetId = assetBody.asset.id;
  assert.equal(assetBody.asset.filename, 'Mein_Bild.png');
  assert.equal(assetBody.asset.mime, 'image/png');
  assert.equal(assetBody.asset.size, png.length);
  assert.equal(assetBody.asset.url, `/assets/${state.assetId}/Mein_Bild.png`);

  // Public: no session cookie needed, filename segment is ignored.
  const publicClient = new Client(baseUrl);
  const fetched = await publicClient.get(`/assets/${state.assetId}/irrelevant-name.txt`);
  expectStatus(fetched, 200, 'fetch asset');
  assert.equal(fetched.headers.get('content-type'), 'image/png');
  assert.match(fetched.headers.get('cache-control') || '', /public, max-age=31536000, immutable/);
  assert.equal(fetched.headers.get('content-disposition'), 'inline');
  assert.deepEqual(fetched.buffer, png);

  const missing = await publicClient.get('/assets/9f9f9f9f-0000-0000-0000-000000000000/x.png');
  assert.equal(missing.status, 404);

  const svg = await admin.post('/api/assets?filename=x.svg', undefined, {
    rawBody: Buffer.from('<svg onload="alert(1)"></svg>'),
    headers: { 'content-type': 'image/svg+xml' },
  });
  assert.equal(svg.status, 400);
  assert.equal(svg.json.error.code, 'unsupported_type');

  const oversized = await admin.post('/api/assets?filename=big.png', undefined, {
    rawBody: Buffer.alloc(1024 * 1024 + 100, 1),
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error.code, 'payload_too_large');

  expectStatus(await admin.delete(`/api/assets/${state.assetId}`), 204, 'delete asset');
  const gone = await publicClient.get(`/assets/${state.assetId}/x.png`);
  assert.equal(gone.status, 404);
});

test('pins: asset url is enriched in the student payload only', async () => {
  const admin = state.admin;
  const png = Buffer.from('\x89PNG\r\n\x1a\nfake', 'binary');
  const uploaded = await admin.post('/api/assets?filename=Karte.png', undefined, {
    rawBody: png,
    headers: { 'content-type': 'image/png' },
  });
  const asset = expectStatus(uploaded, 201, 'upload pins image');
  state.pinsAssetId = asset.asset.id;

  const created = expectStatus(await admin.post('/api/activities', { title: 'Pins Test' }), 201, 'create pins activity');
  const definition = {
    v: 1,
    template: 'worksheet',
    title: 'Pins Test',
    locale: 'de',
    settings: {},
    items: [
      {
        id: 'it_pins0001',
        type: 'pins',
        points: 1,
        stem: 'Markiere den Rand.',
        config: { image: { assetId: state.pinsAssetId, alt: 'Karte' }, zones: [{ id: 'z1', label: 'Rand', x: 0.5, y: 0.5, r: 0.1 }] },
      },
    ],
  };
  expectStatus(
    await admin.put(`/api/activities/${created.activity.id}`, {
      title: 'Pins Test',
      definition,
      revision: created.activity.revision,
    }),
    200,
    'save pins activity',
  );
  const published = expectStatus(await admin.post(`/api/activities/${created.activity.id}/publish`, {}), 201, 'publish pins');
  const anon = new Client(baseUrl);
  const joined = expectStatus(await anon.post('/api/join', { code: published.assignment.code, name: 'Pia' }), 200, 'join pins');
  const pinsItem = joined.activity.items.find((item) => item.type === 'pins');
  assert.equal(pinsItem.config.image.url, `/assets/${state.pinsAssetId}/Karte.png`);
  assert.equal(pinsItem.config.image.assetId, state.pinsAssetId);
  assert.deepEqual(Object.keys(pinsItem.config.zones[0]).sort(), ['id', 'label']);
});

test('admin: user management, ownership checks, stats', async () => {
  const admin = state.admin;
  const created = expectStatus(
    await admin.post('/api/admin/users', {
      email: 'lehrer2@school.at',
      name: 'Lehrer Zwei',
      role: 'teacher',
      password: 'lehrer12345!',
    }),
    201,
    'create user',
  );
  state.teacher2Id = created.user.id;
  assert.equal(created.user.role, 'teacher');
  assert.equal(created.user.disabled, false);
  assert.ok(!('password_hash' in created.user));

  const duplicate = await admin.post('/api/admin/users', {
    email: 'lehrer2@school.at',
    name: 'Noch wer',
    role: 'teacher',
    password: 'lehrer12345!',
  });
  assert.equal(duplicate.status, 409);

  const users = expectStatus(await admin.get('/api/admin/users'), 200, 'list users');
  assert.ok(users.users.some((user) => user.email === 'lehrer2@school.at'));

  const patched = expectStatus(
    await admin.patch(`/api/admin/users/${state.teacher2Id}`, { name: 'Lehrer Zwei Neu' }),
    200,
    'patch user',
  );
  assert.equal(patched.user.name, 'Lehrer Zwei Neu');

  // Second teacher cannot see or edit the admin's resources.
  const teacher2 = new Client(baseUrl);
  expectStatus(await teacher2.post('/api/auth/login', { email: 'lehrer2@school.at', password: 'lehrer12345!' }), 200, 'teacher2 login');
  const forbiddenGet = await teacher2.get(`/api/activities/${state.activityId}`);
  assert.equal(forbiddenGet.status, 403);
  assert.equal(forbiddenGet.json.error.code, 'forbidden');
  const forbiddenAssignments = await teacher2.get('/api/assignments');
  expectStatus(forbiddenAssignments, 200, 'teacher2 assignments list');
  assert.deepEqual(forbiddenAssignments.json.assignments, []);
  const forbiddenAdmin = await teacher2.get('/api/admin/users');
  assert.equal(forbiddenAdmin.status, 403);
  assert.equal(forbiddenAdmin.json.error.code, 'admin_required');

  const stats = expectStatus(await admin.get('/api/admin/stats'), 200, 'stats');
  assert.ok(stats.users >= 2);
  assert.ok(stats.activities >= 3);
  assert.ok(stats.assignments >= 2);
  assert.ok(stats.dbBytes > 0);
  const { config } = await import('../server/config.js');
  assert.equal(stats.version, config.version);

  const cannotDeleteSelf = await admin.delete(`/api/admin/users/${created.user.id === admin.id ? admin.id : 'nope'}`);
  assert.ok(cannotDeleteSelf.status === 404 || cannotDeleteSelf.status === 409);

  expectStatus(await admin.delete(`/api/admin/users/${state.teacher2Id}`), 204, 'delete teacher2');
  const goneUser = expectStatus(await admin.get('/api/admin/users'), 200, 'users after delete');
  assert.ok(!goneUser.users.some((user) => user.email === 'lehrer2@school.at'));
});

test('time limit: expired attempt auto-submits and rejects saves with 409', async () => {
  const admin = state.admin;
  const created = expectStatus(await admin.post('/api/activities', { title: 'Timed' }), 201, 'create timed activity');
  const definition = {
    v: 1,
    template: 'worksheet',
    title: 'Timed',
    locale: 'de',
    settings: { timeLimitMinutes: 1 },
    items: [
      {
        id: 'it_timed001',
        type: 'multiple_choice',
        points: 1,
        stem: 'Schnell?',
        config: { choices: [{ id: 'c1', text: 'a', correct: true }, { id: 'c2', text: 'b', correct: false }] },
      },
    ],
  };
  expectStatus(
    await admin.put(`/api/activities/${created.activity.id}`, {
      title: 'Timed',
      definition,
      revision: created.activity.revision,
    }),
    200,
    'save timed activity',
  );
  const published = expectStatus(await admin.post(`/api/activities/${created.activity.id}/publish`, {}), 201, 'publish timed');
  state.timedActivityId = created.activity.id;
  state.timedAssignmentId = published.assignment.id;

  const anon = new Client(baseUrl);
  const joined = expectStatus(await anon.post('/api/join', { code: published.assignment.code, name: 'Schnell' }), 200, 'join timed');
  const token = joined.participantToken;

  // Backdate the start beyond the 60 s grace window directly in SQLite.
  const db = openDatabase();
  try {
    const startedAt = new Date(Date.now() - 5 * 60000).toISOString();
    db.prepare('UPDATE participants SET started_at = ? WHERE id = ?').run(startedAt, joined.participant.id);
  } finally {
    db.close();
  }

  const expired = await anon.put('/api/participant/responses/it_timed001', { response: { selected: ['c1'] } }, { token });
  assert.equal(expired.status, 409);
  assert.equal(expired.json.error.code, 'time_expired');

  const stateAfter = expectStatus(await anon.get('/api/participant', { token }), 200, 'state after expiry');
  assert.ok(['submitted', 'graded'].includes(stateAfter.participant.status), 'expired attempt must be submitted');
  assert.notEqual(stateAfter.participant.status, 'in_progress');
  const result = expectStatus(await anon.get('/api/participant/result', { token }), 200, 'result after expiry');
  assert.ok(['submitted', 'graded'].includes(result.participant.status));
});

test('retention: admin purge dry-run then delete old participant data', async () => {
  const admin = state.admin;
  const invalid = await admin.post('/api/admin/purge', { olderThanDays: 0 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, 'invalid_older_than_days');

  // Backdate the main assignment (and the graded participant stays submitted/graded).
  const db = openDatabase();
  try {
    db.prepare('UPDATE assignments SET created_at = ? WHERE id = ?').run(
      new Date(Date.now() - 3 * 86400000).toISOString(),
      state.assignmentId,
    );
  } finally {
    db.close();
  }

  const dry = expectStatus(await admin.post('/api/admin/purge', { olderThanDays: 1, dryRun: true }), 200, 'purge dry-run');
  assert.equal(dry.dryRun, true);
  assert.equal(dry.participantsDeleted, 0);
  assert.ok(dry.participantsMatched >= 1, `expected matched participants, got ${dry.participantsMatched}`);

  const real = expectStatus(await admin.post('/api/admin/purge', { olderThanDays: 1 }), 200, 'purge');
  assert.equal(real.dryRun, false);
  assert.ok(real.participantsDeleted >= 1);

  const purgedReview = await admin.get(`/api/participants/${state.participantId}/review`);
  assert.equal(purgedReview.status, 404);
  const assignmentStillThere = await admin.get(`/api/assignments/${state.assignmentId}`);
  expectStatus(assignmentStillThere, 200, 'assignment survives purge');
});

test('cleanup: delete assignment, force-delete activity with assignments', async () => {
  const admin = state.admin;

  const guarded = await admin.delete(`/api/activities/${state.activityId}`);
  assert.equal(guarded.status, 409);
  assert.equal(guarded.json.error.code, 'has_assignments');

  expectStatus(await admin.delete(`/api/assignments/${state.assignmentId}`), 204, 'delete assignment');
  const goneAssignment = await admin.get(`/api/assignments/${state.assignmentId}`);
  assert.equal(goneAssignment.status, 404);

  // The timed activity still has an assignment -> force delete cascades.
  expectStatus(await admin.delete(`/api/activities/${state.timedActivityId}?force=1`), 204, 'force delete activity');
  const goneTimed = await admin.get(`/api/assignments/${state.timedAssignmentId}`);
  assert.equal(goneTimed.status, 404);
  const goneActivity = await admin.get(`/api/activities/${state.timedActivityId}`);
  assert.equal(goneActivity.status, 404);

  const list = expectStatus(await admin.get('/api/activities'), 200, 'activities after cleanup');
  assert.ok(!list.activities.some((entry) => entry.id === state.timedActivityId));
});

test('solutions are only included when showAnswers is enabled', async () => {
  const admin = state.admin;
  const detail = expectStatus(await admin.get(`/api/activities/${state.duplicateId}`), 200, 'duplicate detail');
  const definition = detail.activity.definition;
  definition.settings.showAnswers = false;
  const saved = expectStatus(
    await admin.put(`/api/activities/${state.duplicateId}`, {
      title: definition.title,
      definition,
      revision: detail.activity.revision,
    }),
    200,
    'disable showAnswers',
  );
  assert.equal(saved.activity.definition.settings.showAnswers, false);

  const published = expectStatus(
    await admin.post(`/api/activities/${state.duplicateId}/publish`, {}),
    201,
    'publish no-answers activity',
  );
  const anon = new Client(baseUrl);
  const joined = expectStatus(await anon.post('/api/join', { code: published.assignment.code, name: 'Noa' }), 200, 'join');
  const mcItem = joined.activity.items.find((item) => item.type === 'multiple_choice');
  const token = joined.participantToken;
  const save = await anon.put(
    `/api/participant/responses/${mcItem.id}`,
    { response: { selected: [mcItem.config.choices[0].id] } },
    { token },
  );
  expectStatus(save, 200, 'save for gating test');
  const submitted = expectStatus(await anon.post('/api/participant/submit', { confirm: true }, { token }), 200, 'submit gating');
  assert.equal(submitted.result.showAnswers, false);
  for (const item of submitted.result.items) {
    assert.ok(!('answerText' in item), 'answerText must be omitted when showAnswers is off');
    assert.ok(!('answer' in item), 'canonical answer must be omitted when showAnswers is off');
    assert.ok(!('answerZones' in item));
  }
  expectStatus(await admin.delete(`/api/assignments/${published.assignment.id}`), 204, 'cleanup gating assignment');
});

test('SSE: participant, response, flags, submitted and assignment events are published', async () => {
  const admin = state.admin;
  // Dedicated activity/assignment so the stream is isolated from other tests.
  const created = expectStatus(await admin.post('/api/activities', { title: 'SSE Events' }), 201, 'create sse activity');
  const definition = {
    v: 1,
    template: 'worksheet',
    title: 'SSE Events',
    locale: 'de',
    settings: {},
    items: [
      {
        id: 'it_sse00001',
        type: 'multiple_choice',
        points: 1,
        stem: 'Event?',
        config: {
          choices: [
            { id: 'c1', text: 'ja', correct: true },
            { id: 'c2', text: 'nein', correct: false },
          ],
        },
      },
    ],
  };
  expectStatus(
    await admin.put(`/api/activities/${created.activity.id}`, {
      title: 'SSE Events',
      definition,
      revision: created.activity.revision,
    }),
    200,
    'save sse activity',
  );
  const published = expectStatus(await admin.post(`/api/activities/${created.activity.id}/publish`, {}), 201, 'publish sse');

  const anon = new Client(baseUrl);
  const other = new Client(baseUrl);
  const events = await collectSseEvents(
    `/api/assignments/${published.assignment.id}/stream`,
    admin.cookieHeader(),
    async () => {
      const joined = expectStatus(await anon.post('/api/join', { code: published.assignment.code, name: 'Stream' }), 200, 'sse join');
      state.sseToken = joined.participantToken;
      expectStatus(
        await other.put(`/api/participant/responses/it_sse00001`, { response: { selected: ['c1'] } }, { token: joined.participantToken }),
        200,
        'sse save',
      );
      expectStatus(
        await other.post('/api/participant/flags', { flags: ['it_sse00001'] }, { token: joined.participantToken }),
        200,
        'sse flags',
      );
      expectStatus(await admin.patch(`/api/assignments/${published.assignment.id}`, { status: 'closed' }), 200, 'sse close');
      expectStatus(await admin.patch(`/api/assignments/${published.assignment.id}`, { status: 'open' }), 200, 'sse open');
    },
    1200,
  );

  assert.equal(events[0].type, 'snapshot');
  assert.ok(
    events.some((event) => event.type === 'participant' && event.action === 'joined'),
    'expected a participant joined event',
  );
  assert.ok(
    events.some((event) => event.type === 'response' && event.itemId === 'it_sse00001' && event.state === 'correct'),
    'expected a response event with derived state',
  );
  assert.ok(
    events.some((event) => event.type === 'participant' && event.action === 'flags'),
    'expected a flags participant event',
  );
  assert.ok(
    events.some((event) => event.type === 'assignment' && event.action === 'closed'),
    'expected an assignment closed event',
  );
  assert.ok(
    events.some((event) => event.type === 'assignment' && event.action === 'opened'),
    'expected an assignment opened event',
  );
  expectStatus(await admin.delete(`/api/assignments/${published.assignment.id}`), 204, 'cleanup sse assignment');
});

test('join is rate limited per IP', async () => {
  const anon = new Client(baseUrl);
  let sawRateLimit = false;
  let lastResponse = null;
  for (let attempt = 0; attempt < 70; attempt += 1) {
    lastResponse = await anon.post('/api/join', { code: 'ZZZZZZ', name: 'Rate' });
    if (lastResponse.status === 429) {
      assert.equal(lastResponse.json.error.code, 'rate_limited');
      sawRateLimit = true;
      break;
    }
    assert.equal(lastResponse.status, 404);
  }
  assert.ok(sawRateLimit, `join must be rate limited (last status ${lastResponse && lastResponse.status})`);
});

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function readSseMessage(pathname, cookieHeader) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: '127.0.0.1', port: Number(new URL(baseUrl).port), path: pathname, headers: { cookie: cookieHeader } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`SSE status ${response.statusCode}`));
          return;
        }
        let buffer = '';
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          response.destroy();
          request.destroy();
          if (error) reject(error);
          else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('SSE timeout — no data event received')), 5000);
        timer.unref();
        response.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const match = buffer.match(/data: (\{.*?\})\n\n/s);
          if (!match) return;
          try {
            finish(null, JSON.parse(match[1]));
          } catch (error) {
            finish(error);
          }
        });
        response.on('error', (error) => finish(error));
      },
    );
    request.on('error', reject);
  });
}

/**
 * Open an SSE stream, run `trigger` once connected, then collect all data events
 * for `waitMs` milliseconds and resolve with them.
 */
function collectSseEvents(pathname, cookieHeader, trigger, waitMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: '127.0.0.1', port: Number(new URL(baseUrl).port), path: pathname, headers: { cookie: cookieHeader } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`SSE status ${response.statusCode}`));
          return;
        }
        const events = [];
        let buffer = '';
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          response.destroy();
          request.destroy();
          if (error) reject(error);
          else resolve(events);
        };
        const timer = setTimeout(() => finish(null), waitMs);
        timer.unref();
        response.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let index = buffer.indexOf('\n\n');
          while (index >= 0) {
            const rawEvent = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            for (const line of rawEvent.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                /* ignore malformed */
              }
            }
            index = buffer.indexOf('\n\n');
          }
        });
        response.on('error', (error) => finish(error));
        Promise.resolve()
          .then(trigger)
          .catch((error) => finish(error));
      },
    );
    request.on('error', reject);
  });
}
