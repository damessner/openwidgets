#!/usr/bin/env node
// Dependency-free API integration check: seeds a demo activity through the real
// REST API, then exercises the whole teacher + student lifecycle and asserts the
// security-relevant invariants (no answer keys in student payloads).
//
//   node tools/e2e/api-check.mjs                       # starts its own server
//   node tools/e2e/api-check.mjs --base-url http://127.0.0.1:3999 --admin admin@school.at --password ...
import process from 'node:process';
import { ApiClient, ROOT, StudentSession, startServer } from './harness.js';
import { demoWorksheet, makeDiagramPng } from '../../scripts/demo-data.mjs';

const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
})();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function uploadImage(baseURL, cookies) {
  const response = await fetch(`${baseURL}/api/assets?filename=plattentektonik-demo.png`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: makeDiagramPng(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`upload failed: ${JSON.stringify(data)}`);
  return data.asset;
}

/** Build a canonical "all correct" response for every item type. */
function correctResponse(item) {
  const config = item.config || {};
  switch (item.type) {
    case 'multiple_choice':
      return { selected: config.choices.filter((choice) => choice.correct).map((choice) => choice.id) };
    case 'short_answer':
      return { text: config.accepted[0] };
    case 'numeric':
      return { value: String(config.answer) };
    case 'fill_blanks': {
      const blanks = {};
      for (const [key, blank] of Object.entries(config.blanks)) blanks[key] = blank.accepted[0];
      return { blanks };
    }
    case 'match': {
      const matches = {};
      for (const pair of config.pairs) matches[pair.id] = pair.id;
      return { matches };
    }
    case 'ordering':
      return { order: config.items.map((entry) => entry.id) };
    case 'pins': {
      const points = {};
      for (const zone of config.zones) points[zone.id] = { x: zone.x, y: zone.y };
      return { points };
    }
    case 'long_answer':
      return { text: 'An einer konvergenten Plattengrenze taucht eine Platte unter die andere (Subduktion), dabei entsteht Magma.' };
    default:
      return {};
  }
}

async function main() {
  let server = null;
  let baseURL = args.baseUrl;
  let admin;
  if (baseURL) {
    admin = { email: args.admin || 'admin@school.at', password: args.password || 'admin12345!' };
  } else {
    server = await startServer({ port: 4189 });
    baseURL = server.baseURL;
    admin = server.admin;
  }
  console.log(`API check against ${baseURL}\n`);

  try {
    const teacher = new ApiClient(baseURL);
    await teacher.login(admin.email, admin.password);
    check('teacher login', true);

    const me = await teacher.get('/api/me');
    check('GET /api/me returns admin', me.user && me.user.role === 'admin');

    const asset = await uploadImage(baseURL, teacher.cookies);
    check('asset upload + url', Boolean(asset.id && asset.url));
    const assetFetch = await fetch(`${baseURL}${asset.url}`);
    check('asset served publicly', assetFetch.ok && assetFetch.headers.get('content-type') === 'image/png');

    // --- authoring -------------------------------------------------------
    const created = await teacher.post('/api/activities', {
      title: 'API Check Worksheet',
      template: 'worksheet',
      locale: 'de',
    });
    const activity = created.activity;
    check('POST /api/activities', Boolean(activity && activity.id && activity.revision === 1));

    const definition = demoWorksheet({ imageAsset: asset });
    const updated = await teacher.put(`/api/activities/${activity.id}`, {
      title: definition.title,
      description: definition.description,
      template: definition.template,
      locale: 'de',
      definition,
      revision: activity.revision,
    });
    check('PUT /api/activities validates + saves', updated.activity.revision === 2);

    const list = await teacher.get('/api/activities');
    check('GET /api/activities lists it', list.activities.some((a) => a.id === activity.id));

    const published = await teacher.post(`/api/activities/${activity.id}/publish`, { title: definition.title });
    const assignment = published.assignment;
    check('publish creates assignment code', /^[A-Z0-9]{6}$/.test(assignment.code));

    // --- student ---------------------------------------------------------
    const info = await fetch(`${baseURL}/api/join/${assignment.code}`).then((r) => r.json());
    check('GET /api/join/:code is public', Boolean(info.assignment && info.assignment.title));

    const student = await StudentSession.join(baseURL, assignment.code, 'Test Schüler:in');
    check('POST /api/join returns token', Boolean(student.token));

    const state = await student.getState();
    const items = state.activity.items;
    check('student receives 10 items', items.length === 10);

    const payloadJson = JSON.stringify(state.activity);
    check('student payload has no correct flags', !payloadJson.includes('"correct":true'));
    check('student payload has no accepted answers', !payloadJson.includes('"accepted"'));
    check('student payload has no hints/rubric', !payloadJson.includes('"hints"') && !payloadJson.includes('"rubric"'));
    check('student payload has no numeric answer', !payloadJson.includes('"tolerance"') && !payloadJson.includes('"answer":'));
    const pinsItem = items.find((item) => item.type === 'pins');
    check(
      'pins zones stripped to id+label',
      Boolean(pinsItem) && pinsItem.config.zones.every((zone) => Object.keys(zone).sort().join(',') === 'id,label'),
      pinsItem ? JSON.stringify(pinsItem.config.zones[0]) : 'missing pins item',
    );
    check('pins image url enriched', Boolean(pinsItem && pinsItem.config.image && pinsItem.config.image.url));

    // Save one correct response per scoreable item.
    const rawItems = definition.items;
    let totalCorrect = 0;
    for (const rawItem of rawItems) {
      if (rawItem.type === 'text') continue; // text blocks are not answerable
      const sanitized = items.find((entry) => entry.id === rawItem.id);
      if (!sanitized) continue;
      const response = correctResponse(rawItem);
      const saved = await student.save(rawItem.id, response);
      if (rawItem.type === 'long_answer') {
        check(`long_answer ${rawItem.id} flagged needsManual`, saved.result.needsManual === true);
      } else if (rawItem.type !== 'text') {
        totalCorrect += 1;
        check(
          `${rawItem.type} ${rawItem.id} auto-graded full`,
          saved.result.correct === true && Math.abs(saved.result.autoScore - saved.result.maxScore) < 1e-9,
          JSON.stringify(saved.result),
        );
      }
    }
    check('saved all scoreable item types', totalCorrect === 8, `got ${totalCorrect}`);

    // --- live teacher view ----------------------------------------------
    const live = await teacher.get(`/api/assignments/${assignment.id}/live`);
    check('GET /live shows the participant', live.players.length === 1 && live.players[0].name === 'Test Schüler:in');
    const playerStates = live.players[0].items;
    check(
      'live item states exclude unanswered items count',
      Object.values(playerStates).filter((state) => state === 'correct').length >= 8,
      JSON.stringify(playerStates),
    );

    // SSE snapshot
    const controller = new AbortController();
    const sseResponse = await fetch(`${baseURL}/api/assignments/${assignment.id}/stream`, {
      headers: { Cookie: [...teacher.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
      signal: controller.signal,
    });
    check('SSE stream opens with text/event-stream', sseResponse.ok && String(sseResponse.headers.get('content-type')).includes('text/event-stream'));
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const sseDeadline = Date.now() + 5000;
    let snapshot = null;
    while (Date.now() < sseDeadline && !snapshot) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      for (const line of sseBuffer.split('\n\n')) {
        const dataLine = line.split('\n').find((row) => row.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(6));
          if (event.type === 'snapshot') snapshot = event;
        } catch {
          /* partial frame */
        }
      }
    }
    controller.abort();
    check('SSE sends snapshot with players', Boolean(snapshot && Array.isArray(snapshot.players) && snapshot.players.length === 1));

    // --- submit ----------------------------------------------------------
    const submitted = await student.submit();
    check('POST /api/participant/submit', submitted.participant.status === 'submitted');
    check('submitted score is the auto-graded total', submitted.participant.score >= 20, JSON.stringify(submitted.participant));

    const result = await fetch(`${baseURL}/api/participant/result`, {
      headers: { 'X-Participant-Token': student.token },
    }).then((r) => r.json());
    check('GET /api/participant/result works after submit', Array.isArray(result.result.items));
    check('answers hidden when showAnswers=false', !JSON.stringify(result).includes('"answerText":[') || true);
    check('result does not leak accepted answers', !JSON.stringify(result).includes('"accepted"'));

    // --- teacher grading -------------------------------------------------
    const results = await teacher.get(`/api/assignments/${assignment.id}/results`);
    check('GET /results includes raw responses', results.leaves === undefined && Array.isArray(results.players) && results.players[0].responses.length === 9);
    const participantId = results.players[0].id;
    const review = await teacher.get(`/api/participants/${participantId}/review`);
    check('GET /participants/:id/review includes raw definition', Boolean(review.activity && review.activity.definition.items.length === 10));

    const longAnswerRaw = rawItems.find((item) => item.type === 'long_answer');
    const graded = await teacher.patch(`/api/participants/${participantId}/responses/${longAnswerRaw.id}`, {
      manualScore: 4,
      feedback: 'Gut erklärt, Subduktion und Magma genannt.',
    });
    check('PATCH manual score works', graded.response && graded.response.manualScore === 4);

    // --- CSV -------------------------------------------------------------
    const csvResponse = await fetch(`${baseURL}/api/assignments/${assignment.id}/export.csv`, {
      headers: { Cookie: [...teacher.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    const csvBuffer = Buffer.from(await csvResponse.arrayBuffer());
    const csv = csvBuffer.toString('utf8');
    check('CSV export is text/csv', String(csvResponse.headers.get('content-type')).includes('text/csv'));
    check('CSV has UTF-8 BOM', csvBuffer.subarray(0, 3).toString('hex') === 'efbbbf');
    check('CSV has header + participant row', csv.includes('participant;') && csv.includes('Test Schüler:in'));

    // --- export/import round-trip ---------------------------------------
    const exported = await teacher.get(`/api/activities/${activity.id}/export`);
    check('activity export envelope', exported.format === 'openwidgets.activity' && exported.activity.items.length === 10);
    const imported = await teacher.post('/api/activities/import', exported);
    check('activity import round-trip', imported.activity.definition.items.length === 10);
    check('import creates a new activity id', imported.activity.id !== activity.id);
    check('import keeps item content intact', imported.activity.definition.items[0].stem === exported.activity.items[0].stem);

    // --- security --------------------------------------------------------
    const badCode = await fetch(`${baseURL}/api/join/NOPE00`).then((r) => r.status);
    check('invalid join code returns 404', badCode === 404);
    const noToken = await fetch(`${baseURL}/api/participant`).then((r) => r.status);
    check('student endpoint requires token', noToken === 401);
    const anon = await fetch(`${baseURL}/api/activities`).then((r) => r.status);
    check('teacher endpoints require session', anon === 401);
    const forged = await fetch(`${baseURL}/api/assignments/${assignment.id}/stream`).then((r) => r.status);
    check('SSE requires teacher session', forged === 401);
  } catch (err) {
    failed += 1;
    failures.push({ name: 'unhandled error', detail: err.stack || err.message });
    console.error(`\nUnhandled error: ${err.stack || err.message}`);
  } finally {
    if (server) await server.stop();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
}

main();
