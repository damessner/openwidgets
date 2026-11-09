#!/usr/bin/env node
// Data-retention helper for DSGVO/Löschkonzept. Deletes student submissions
// (participants, responses, events) older than N days, keeping teacher-authored
// activities and assignments.
//
//   node scripts/prune.mjs --older-than-days 365 --dry-run
//   node scripts/prune.mjs --older-than-days 365 --yes
//
// Can run while the service is up (SQLite handles locking), but prefer a quiet
// moment; a backup before pruning is strongly recommended (npm run backup).
import process from 'node:process';
import { all, db, initDb, now, one, run, tx } from '../server/db.js';

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
if (args.help) {
  console.log(`Usage: node scripts/prune.mjs --older-than-days <n> [--dry-run] [--yes] [--include-events]

Deletes participants (and cascading responses/events) whose submission/start is
older than n days. Activities and assignments are kept. --include-events also
prunes standalone event rows older than the same cutoff.`);
  process.exit(0);
}

const days = Math.max(1, Number.parseInt(String(args.olderThanDays || '365'), 10) || 365);
const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
const dryRun = Boolean(args.dryRun);
const confirmed = Boolean(args.yes);

if (!dryRun && !confirmed) {
  console.error('Refusing to delete without --yes (use --dry-run to preview).');
  process.exit(1);
}

initDb();

// Cutoff applies to the moment the student actually finished (falls back to start).
const participants = all(
  `SELECT id, assignment_id, name, status, started_at, submitted_at
   FROM participants
   WHERE COALESCE(submitted_at, started_at) < ?`,
  cutoffIso,
);
const responseCount = one(
  `SELECT COUNT(*) AS c FROM responses
   WHERE participant_id IN (
     SELECT id FROM participants WHERE COALESCE(submitted_at, started_at) < ?
   )`,
  cutoffIso,
);
const eventCount = one(
  `SELECT COUNT(*) AS c FROM events
   WHERE created_at < ? OR participant_id IN (
     SELECT id FROM participants WHERE COALESCE(submitted_at, started_at) < ?
   )`,
  cutoffIso,
  cutoffIso,
);

console.log(`Cutoff: ${cutoffIso} (older than ${days} days)`);
console.log(`Participants to delete: ${participants.length}`);
console.log(`Responses to delete:    ${responseCount?.c ?? 0}`);
console.log(`Events to delete:       ${eventCount?.c ?? 0}`);
for (const participant of participants.slice(0, 20)) {
  console.log(`  - ${participant.name} (${participant.status}, ${participant.submitted_at || participant.started_at}, assignment ${participant.assignment_id})`);
}
if (participants.length > 20) console.log(`  … and ${participants.length - 20} more`);

if (dryRun) {
  console.log('\nDry run — nothing deleted.');
  process.exit(0);
}

const ids = participants.map((participant) => participant.id);

tx(() => {
  for (const id of ids) {
    run('DELETE FROM responses WHERE participant_id = ?', id);
    run('DELETE FROM events WHERE participant_id = ?', id);
    run('DELETE FROM participants WHERE id = ?', id);
  }
  if (args.includeEvents) {
    run('DELETE FROM events WHERE created_at < ?', cutoffIso);
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
});

console.log(`\nDeleted ${ids.length} participants and their responses/events at ${now()}.`);
console.log('Run "npm run backup" afterwards to capture the pruned state.');
