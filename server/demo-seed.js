// Demo-mode seeding: pre-configured activities + assignments for a throwaway
// instance started with OW_DEMO_MODE=1 and OW_SEED_DEMO=1 (see start-demo.bat).
// Writes directly to the database — no HTTP round-trip, no admin credentials
// needed beyond the seeded admin account. Idempotent: does nothing if any
// activity already exists.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { now, one, run, uid } from './db.js';
import { normalizeActivity, normalizeSettings } from '../shared/activity.js';
import {
  demoDeutschWorksheet,
  demoMathWorksheet,
  demoQuiz,
  demoWorksheet,
  makeDiagramPng,
} from '../scripts/demo-data.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

function uniqueAssignmentCode() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = randomCode();
    if (!one('SELECT 1 AS x FROM assignments WHERE code = ?', code)) return code;
  }
  throw new Error('Could not generate a unique assignment code');
}

/** Store the generated demo image once and return it in the asset shape items expect. */
function ensureDemoAsset(ownerId) {
  const filename = 'plattentektonik-demo.png';
  const existing = one('SELECT * FROM assets WHERE filename = ? ORDER BY created_at LIMIT 1', filename);
  if (existing) {
    return {
      id: existing.id,
      url: `/assets/${existing.id}/${encodeURIComponent(existing.filename)}`,
      alt: 'Vereinfachte Karte mit drei Plattengrenzen',
    };
  }
  const png = makeDiagramPng();
  const id = uid();
  fs.writeFileSync(path.join(config.assetsDir, id), png);
  run(
    'INSERT INTO assets (id, owner_id, filename, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?)',
    id,
    ownerId,
    filename,
    'image/png',
    png.length,
    crypto.createHash('sha256').update(png).digest('hex'),
    now(),
  );
  return { id, url: `/assets/${id}/${encodeURIComponent(filename)}`, alt: 'Vereinfachte Karte mit drei Plattengrenzen' };
}

/**
 * @returns {{seeded: boolean, reason?: string, activities?: number, codes?: string[]}}
 */
export function seedDemoContent() {
  const activityCount = one('SELECT COUNT(*) AS c FROM activities');
  if (activityCount && activityCount.c > 0) {
    return { seeded: false, reason: 'instance already has activities' };
  }
  const admin = one("SELECT * FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at LIMIT 1");
  if (!admin) return { seeded: false, reason: 'no admin account available for ownership' };

  const asset = ensureDemoAsset(admin.id);
  const bundle = [
    { definition: demoWorksheet({ imageAsset: asset }) },
    { definition: demoQuiz({ imageAsset: asset }) },
    { definition: demoMathWorksheet() },
    { definition: demoDeutschWorksheet() },
  ];

  const codes = [];
  for (const entry of bundle) {
    const definition = normalizeActivity(entry.definition);
    const activityId = uid();
    const timestamp = now();
    run(
      `INSERT INTO activities
         (id, owner_id, title, description, template, locale, definition, status, revision, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      activityId,
      admin.id,
      definition.title,
      definition.description,
      definition.template,
      definition.locale,
      JSON.stringify(definition),
      'published',
      2,
      timestamp,
      timestamp,
    );
    const code = uniqueAssignmentCode();
    run(
      'INSERT INTO assignments (id, activity_id, owner_id, code, title, settings, status, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      uid(),
      activityId,
      admin.id,
      code,
      definition.title,
      JSON.stringify(normalizeSettings(definition.settings)),
      'open',
      null,
      timestamp,
    );
    codes.push(code);
  }

  return { seeded: true, activities: bundle.length, codes };
}
