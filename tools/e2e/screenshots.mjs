#!/usr/bin/env node
// Browser verification + screenshot run. Assumes a seeded dev server
// (npm run demo:seed) — or point it at any instance with E2E_EMAIL/E2E_PASSWORD.
//
//   node tools/e2e/screenshots.mjs --base-url http://127.0.0.1:3999
//
// Writes PNGs to tools/e2e/screenshots/ and copies the best ones to
// docs/screenshots/. Fails (exit 1) on uncaught page errors or 5xx responses.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { ROOT } from './harness.js';
import { DEMO_STUDENTS, correctResponse, partialResponse, wrongResponse } from './fixtures.mjs';
import { demoWorksheet } from '../../scripts/demo-data.mjs';

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
    } else out[key] = true;
  }
  return out;
})();

const BASE = String(args.baseUrl || process.env.E2E_BASE_URL || 'http://127.0.0.1:3999').replace(/\/$/, '');
const EMAIL = String(args.email || process.env.E2E_EMAIL || 'admin@school.at');
const PASSWORD = String(args.password || process.env.E2E_PASSWORD || 'admin12345!');
const SHOTS = path.join(ROOT, 'tools/e2e/screenshots');
const DOCS_SHOTS = path.join(ROOT, 'docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOCS_SHOTS, { recursive: true });

const problems = [];
const saved = [];

function note(pageName, error) {
  problems.push(`${pageName}: ${error}`);
}

async function shot(page, name, { fullPage = false, isMobile = false } = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  saved.push({ name, file, isMobile });
  console.log(`  shot ${name}`);
}

async function waitForView(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const view = document.querySelector('#view') || document.querySelector('#app');
      if (!view) return false;
      if (view.querySelector('.loading-block')) return false;
      return view.children.length > 0;
    },
    null,
    { timeout },
  );
  await page.waitForTimeout(500);
}

function attachErrorCollectors(page, label) {
  page.on('pageerror', (error) => note(label, `pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The teacher shell probes /api/me on boot; a 401 before login is by design.
    if (/status of 401/.test(text)) return;
    note(label, `console.error: ${text}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) note(label, `HTTP ${response.status()} ${response.url()}`);
  });
}

async function api(context, apiPath, options = {}) {
  const response = await context.request.fetch(apiPath, {
    method: options.method || 'GET',
    data: options.body,
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok()) throw new Error(`API ${response.status()} ${apiPath}: ${text.slice(0, 300)}`);
  return data;
}

async function joinFromApi(code, name) {
  const response = await fetch(`${BASE}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`join failed: ${JSON.stringify(data)}`);
  return data;
}

async function saveFromApi(token, itemId, responseBody) {
  const response = await fetch(`${BASE}/api/participant/responses/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token },
    body: JSON.stringify({ response: responseBody }),
  });
  if (!response.ok) throw new Error(`save failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function submitFromApi(token) {
  const response = await fetch(`${BASE}/api/participant/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token },
    body: JSON.stringify({ confirm: true }),
  });
  if (!response.ok) throw new Error(`submit failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
  });
  const page = await context.newPage();
  attachErrorCollectors(page, 'teacher');

  // ---- public pages -----------------------------------------------------
  console.log('public pages');
  await page.goto('/');
  await page.waitForTimeout(700);
  await shot(page, '01-landing');

  await page.goto('/login');
  await page.waitForTimeout(500);
  await shot(page, '02-login');

  // ---- login ------------------------------------------------------------
  console.log('teacher login');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForURL(/\/teacher\//, { timeout: 20000 }), page.click('#login-submit')]);
  await waitForView(page, 20000).catch(() => note('dashboard', 'view did not load after login'));
  await shot(page, '03-teacher-dashboard');

  // ---- create a fresh assignment with 3 participants --------------------
  const activityList = await api(context, '/api/activities');
  const demoActivity =
    activityList.activities.find((entry) => String(entry.title).includes('Demo-Arbeitsblatt')) ||
    activityList.activities[0];
  if (!demoActivity) throw new Error('no activities found — run `npm run demo:seed` first');

  const activityDetail = await api(context, `/api/activities/${demoActivity.id}`);
  const rawDefinition = activityDetail.activity.definition;
  const published = await api(context, `/api/activities/${demoActivity.id}/publish`, {
    method: 'POST',
    body: { title: `${demoActivity.title} (${new Date().toISOString().slice(0, 16)})` },
  });
  const assignment = published.assignment;
  const rawItems = rawDefinition.items.filter((item) => item.type !== 'text');

  const participants = [];
  for (let index = 0; index < DEMO_STUDENTS.length; index += 1) {
    const joined = await joinFromApi(assignment.code, DEMO_STUDENTS[index]);
    const token = joined.participantToken;
    // Anna: everything correct + submitted. Ben: mixed + submitted. Clara: a few answers, still working.
    for (const [itemIndex, rawItem] of rawItems.entries()) {
      if (index === 2 && itemIndex > 3) continue;
      let responseBody;
      if (index === 0) responseBody = correctResponse(rawItem);
      else if (index === 1) responseBody = itemIndex % 2 === 0 ? wrongResponse(rawItem) : partialResponse(rawItem);
      else responseBody = itemIndex % 2 === 0 ? correctResponse(rawItem) : partialResponse(rawItem);
      await saveFromApi(token, rawItem.id, responseBody);
    }
    if (index < 2) await submitFromApi(token);
    participants.push({ id: joined.participant.id, name: DEMO_STUDENTS[index], token });
  }

  // ---- teacher: live dashboard -----------------------------------------
  console.log('teacher live dashboard');
  await page.goto(`/teacher/assignment?id=${assignment.id}`);
  await waitForView(page, 25000).catch(() => note('live', 'view did not load'));
  await page.waitForTimeout(1500); // let SSE snapshot arrive
  await shot(page, '07-live-dashboard');

  // ---- teacher: editor (open the demo activity) ------------------------
  console.log('teacher editor');
  await page.goto(`/teacher/edit?id=${demoActivity.id}`);
  await waitForView(page, 25000).catch(() => note('editor', 'view did not load'));
  await page.waitForTimeout(1200);
  await shot(page, '04-editor');
  await page.screenshot({ path: path.join(SHOTS, '04b-editor-full.png'), fullPage: true });

  // ---- teacher: grading ------------------------------------------------
  console.log('teacher grading');
  const submitted = participants[0];
  await page.goto(`/teacher/grade?assignment=${assignment.id}&participant=${submitted.id}`);
  await waitForView(page, 25000).catch(() => note('grade', 'view did not load'));
  await page.waitForTimeout(800);
  await shot(page, '08-grading');

  // ---- teacher: admin --------------------------------------------------
  console.log('teacher admin');
  await page.goto('/teacher/admin');
  await waitForView(page, 25000).catch(() => note('admin', 'view did not load'));
  await page.waitForTimeout(600);
  await shot(page, '12-admin');

  // ---- teacher: print view (print media) -------------------------------
  console.log('teacher print');
  await page.goto(`/teacher/print?activity=${demoActivity.id}`);
  await waitForView(page, 25000).catch(() => note('print', 'view did not load'));
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);
  await shot(page, '10-print-activity', { fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  // ---- student flow (fresh incognito context) --------------------------
  console.log('student flow');
  const studentContext = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    locale: 'de-AT',
  });
  const studentPage = await studentContext.newPage();
  attachErrorCollectors(studentPage, 'student');
  await studentPage.goto(`/a/${assignment.code}`);
  await waitForView(studentPage, 25000).catch(() => note('student-join', 'join screen did not load'));
  await shot(studentPage, '05-student-join');

  await studentPage.fill('#join-name', 'Test Schüler:in');
  await studentPage.locator('.student-join-form button[type="submit"]').first().click();
  await studentPage.waitForFunction(
    () => {
      const app = document.querySelector('#app');
      return app && app.querySelector('.ow-item');
    },
    null,
    { timeout: 25000 },
  ).catch(() => note('student-player', 'worksheet did not render'));
  await studentPage.waitForTimeout(700);
  await shot(studentPage, '06-student-worksheet');

  // Answer the first multiple-choice item to show instant feedback.
  const firstChoice = studentPage.locator('.ow-item .item-choice-input').first();
  if (await firstChoice.count()) {
    await firstChoice.check({ force: true }).catch(() => {});
    await studentPage.waitForTimeout(1200);
    await shot(studentPage, '06b-student-feedback');
  }

  // Full-page student worksheet (long, for docs)
  await studentPage.screenshot({ path: path.join(SHOTS, '06c-student-worksheet-full.png'), fullPage: true });

  // ---- mobile student screenshot --------------------------------------
  const mobileContext = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'de-AT',
  });
  const mobilePage = await mobileContext.newPage();
  attachErrorCollectors(mobilePage, 'student-mobile');
  await mobilePage.goto(`/a/${assignment.code}`);
  await waitForView(mobilePage, 25000).catch(() => note('student-mobile', 'join screen did not load'));
  await mobilePage.fill('#join-name', 'Mobil Schüler:in').catch(() => {});
  await mobilePage.locator('.student-join-form button[type="submit"]').first().click().catch(() => {});
  await mobilePage
    .waitForFunction(() => document.querySelector('#app .ow-item'), null, { timeout: 25000 })
    .catch(() => note('student-mobile', 'worksheet did not render'));
  await mobilePage.waitForTimeout(600);
  await shot(mobilePage, '11-student-mobile');

  // ---- copy the public-facing screenshots into docs/ -------------------
  const docShots = [
    ['01-landing', 'landing.png'],
    ['03-teacher-dashboard', 'teacher-dashboard.png'],
    ['04-editor', 'editor.png'],
    ['05-student-join', 'student-join.png'],
    ['06-student-worksheet', 'student-worksheet.png'],
    ['07-live-dashboard', 'live-dashboard.png'],
    ['08-grading', 'grading.png'],
    ['10-print-activity', 'print.png'],
  ];
  for (const [shotName, docName] of docShots) {
    const source = path.join(SHOTS, `${shotName}.png`);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(DOCS_SHOTS, docName));
  }

  await browser.close();

  console.log(`\n${saved.length} screenshots written to ${SHOTS}`);
  console.log(`docs screenshots updated in ${DOCS_SHOTS}`);
  if (problems.length > 0) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const problem of [...new Set(problems)].slice(0, 40)) console.log(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('\nNo console/page errors, no 5xx responses. OK');
  }
}

main().catch((error) => {
  console.error(`Screenshot run failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
