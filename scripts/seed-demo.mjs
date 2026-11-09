#!/usr/bin/env node
// Seed a running OpenWidgets instance with demo content (2 activities, 1 image).
//
//   ADMIN_EMAIL=you@school.at ADMIN_PASSWORD='...' npm run demo:seed
//   node scripts/seed-demo.mjs --base-url http://127.0.0.1:3000 --email ... --password ...
//
// Safe-ish to run repeatedly: creates new activities each time (no deletes).
import process from 'node:process';
import { demoQuiz, demoWorksheet, makeDiagramPng } from './demo-data.mjs';

function parseArgs(argv) {
  const out = {};
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
}

const args = parseArgs(process.argv.slice(2));
const baseURL = String(args.baseUrl || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = String(args.email || process.env.ADMIN_EMAIL || process.env.DEMO_EMAIL || '');
const password = String(args.password || process.env.ADMIN_PASSWORD || process.env.DEMO_PASSWORD || '');

if (!email || !password) {
  console.error('Usage: ADMIN_EMAIL=you@school.at ADMIN_PASSWORD="..." node scripts/seed-demo.mjs [--base-url URL]');
  process.exit(1);
}

function cookieHeader(cookies) {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

const cookies = new Map();

async function request(method, path, body, extraHeaders = {}) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookie = cookieHeader(cookies);
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    const pair = raw.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${method} ${path}: ${text.slice(0, 400)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function uploadDemoImage() {
  const png = makeDiagramPng();
  const response = await fetch(`${baseURL}/api/assets?filename=plattentektonik-demo.png`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      Cookie: cookieHeader(cookies),
    },
    body: png,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`image upload failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data.asset;
}

async function createActivity({ definition, title, template }) {
  const created = await request('POST', '/api/activities', { title, template, locale: 'de' });
  const activity = created.activity;
  const saved = await request('PUT', `/api/activities/${activity.id}`, {
    title: definition.title || title,
    description: definition.description || '',
    template: definition.template || template,
    locale: 'de',
    definition,
    revision: activity.revision,
  });
  const published = await request('POST', `/api/activities/${activity.id}/publish`, {
    title: definition.title || title,
  });
  return { activity: saved.activity || activity, assignment: published.assignment };
}

async function main() {
  console.log(`Seeding demo content into ${baseURL} ...`);
  await request('POST', '/api/auth/login', { email, password });
  const asset = await uploadDemoImage();
  console.log(`  uploaded demo image: ${asset.url}`);

  const worksheet = await createActivity({
    definition: demoWorksheet({ imageAsset: asset }),
    title: 'Plattentektonik — Demo-Arbeitsblatt',
    template: 'worksheet',
  });
  const quiz = await createActivity({
    definition: demoQuiz({ imageAsset: asset }),
    title: 'Plattentektonik — Demo-Quiz',
    template: 'quiz',
  });

  console.log('\nDemo content created:');
  for (const [label, result] of [
    ['worksheet', worksheet],
    ['quiz', quiz],
  ]) {
    const code = result.assignment.code;
    console.log(`  ${label.padEnd(9)} activity ${result.activity.id}  →  assignment code ${code}`);
    console.log(`  ${''.padEnd(9)} join URL ${baseURL}/a/${code}`);
  }
  console.log('\nOpen /teacher/ to see them. Student flow: /a/<CODE> without login.\n');
}

main().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
});
