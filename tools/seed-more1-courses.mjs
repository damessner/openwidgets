#!/usr/bin/env node
// Seed the MORE 1 revision courses (Unit 1–3) into one class on a running
// OpenWidgets server. Idempotent: if the class "1G — Englisch (MORE 1)" already
// exists with courses, nothing is created.
//
// Usage:
//   OW_BASE_URL=https://openwidgets.smiletelfs.dpdns.org \
//   OW_ADMIN_EMAIL=... OW_ADMIN_PASSWORD=... \
//   node tools/seed-more1-courses.mjs [--dry-run]
//
// Env: OW_BASE_URL (default http://127.0.0.1:3000), OW_ADMIN_EMAIL,
//      OW_ADMIN_PASSWORD (required unless --dry-run), OW_CLASS_NAME override.
import { buildMore1Courses } from '../shared/more1-content.js';

const BASE = (process.env.OW_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = process.env.OW_ADMIN_EMAIL || '';
const PASSWORD = process.env.OW_ADMIN_PASSWORD || '';
const CLASS_NAME = process.env.OW_CLASS_NAME || '1G — Englisch (MORE 1)';
const DRY_RUN = process.argv.includes('--dry-run');
const REPLACE = process.argv.includes('--replace');

if (!DRY_RUN && (!EMAIL || !PASSWORD)) {
  console.error('Set OW_ADMIN_EMAIL and OW_ADMIN_PASSWORD (or use --dry-run to only validate content).');
  process.exit(1);
}

let cookie = '';

async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function main() {
  const courses = buildMore1Courses();
  console.log(`Content OK: ${courses.length} courses — ${courses.map((c) => `${c.courseTitle} (${c.activities.length} activities)`).join(', ')}`);

  if (DRY_RUN) {
    console.log('Dry run — no server calls. Content validated.');
    return;
  }

  await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  console.log('Logged in as admin.');

  // Idempotency: skip if the class already exists with courses — unless
  // --replace is given, which deletes the old class (and its assignments)
  // and seeds fresh. Safe before pupils/responses exist.
  const classesData = await api('GET', '/api/classes');
  const existing = (classesData.classes || []).find((cls) => cls.name === CLASS_NAME);
  if (existing && existing.courseCount > 0 && !REPLACE) {
    console.log(`Class "${CLASS_NAME}" already exists (id ${existing.id}, ${existing.courseCount} courses, ${existing.itemCount} items) — nothing to do.`);
    return;
  }
  if (existing && REPLACE) {
    const detail = await api('GET', `/api/classes/${existing.id}`);
    for (const item of detail.class.items || []) {
      await api('DELETE', `/api/assignments/${item.assignmentId}`);
      console.log(`  - deleted old assignment ${item.code || item.assignmentId} (${item.title})`);
    }
    await api('DELETE', `/api/classes/${existing.id}`);
    console.log(`Replaced existing class "${CLASS_NAME}" (${existing.id}).`);
  }

  const created = await api('POST', '/api/classes', {
    name: CLASS_NAME,
    description: 'Revision-Kurse zu MORE 1 (Unit 1–3): Vokabeln, Grammatik, Lesen, Hören, Schreiben, Exit-Check — als Kurs sequence zum Durcharbeiten.',
    orderMode: 'sequence',
    unlockMinPercent: 0,
  });
  const classId = created.class.id;
  console.log(`Class created: ${classId}`);

  const itemEntries = [];
  for (const course of courses) {
    const courseRes = await api('POST', `/api/classes/${classId}/courses`, {
      title: course.courseTitle,
      description: `Revision Unit ${course.unit} (MORE 1) — in Reihenfolge durcharbeiten.`,
    });
    const courseId = courseRes.class.courses.find((c) => c.title === course.courseTitle)?.id;
    if (!courseId) throw new Error(`course id not returned for ${course.courseTitle}`);
    console.log(`Course "${course.courseTitle}" -> ${courseId}`);

    for (const definition of course.activities) {
      const act = await api('POST', '/api/activities', {
        title: definition.title,
        template: definition.template,
        locale: definition.locale || 'de',
      });
      const activity = act.activity;
      await api('PUT', `/api/activities/${activity.id}`, {
        title: definition.title,
        description: definition.description || '',
        template: definition.template,
        locale: definition.locale || 'de',
        definition,
        revision: activity.revision,
      });
      const pub = await api('POST', `/api/activities/${activity.id}/publish`, { title: definition.title });
      const assignmentId = pub.assignment.id;
      itemEntries.push({ assignmentId, courseId });
      console.log(`  + ${definition.title} (assignment ${pub.assignment.code})`);
    }
  }

  await api('PUT', `/api/classes/${classId}/items`, { items: itemEntries });
  const published = await api('POST', `/api/classes/${classId}/publish`);
  console.log(`\nDone. Class code: ${published.class.code}`);
  console.log(`Class URL: ${published.url || `${BASE}/c/${published.class.code}`}`);
  console.log(`${itemEntries.length} assignments in ${courses.length} courses, sequence mode, published.`);
}

main().catch((error) => {
  console.error('SEED FAILED:', error.message);
  process.exit(1);
});
