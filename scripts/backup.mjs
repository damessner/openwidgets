#!/usr/bin/env node
// Consistent SQLite + assets backup. Safe to run on a live instance: SQLite's
// VACUUM INTO produces a transactionally consistent copy, no file copying.
// Usage: node scripts/backup.mjs [--out <dir>] [--keep <n>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config } from '../server/config.js';
import { db, initDb } from '../server/db.js';

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

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

const args = parseArgs(process.argv.slice(2));
const outRoot = path.resolve(
  args.out || path.join(process.env.DATA_DIR ? path.dirname(config.dataDir) : config.root, 'backups'),
);
const keep = Math.max(1, Number.parseInt(String(args.keep || '10'), 10) || 10);

initDb();
// Move any WAL content into the main database so the snapshot is complete.
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const targetDir = path.join(outRoot, `openwidgets-${stamp}`);
fs.mkdirSync(targetDir, { recursive: true });

const dbTarget = path.join(targetDir, 'openwidgets.db');
db.exec(`VACUUM INTO '${dbTarget.replace(/'/g, "''")}'`);

if (fs.existsSync(config.assetsDir)) {
  fs.cpSync(config.assetsDir, path.join(targetDir, 'assets'), { recursive: true });
}

fs.writeFileSync(
  path.join(targetDir, 'manifest.json'),
  JSON.stringify(
    {
      format: 'openwidgets.backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      appVersion: config.version,
      sourceDataDir: config.dataDir,
    },
    null,
    2,
  ),
);

// Retention: keep the newest N backups, delete older ones.
const entries = fs
  .readdirSync(outRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('openwidgets-'))
  .map((entry) => entry.name)
  .sort();
while (entries.length > keep) {
  const stale = entries.shift();
  fs.rmSync(path.join(outRoot, stale), { recursive: true, force: true });
  console.log(`Pruned old backup: ${stale}`);
}

console.log(`Backup written: ${targetDir}`);
console.log(`  database: ${(fs.statSync(dbTarget).size / 1024).toFixed(1)} KiB`);
console.log(`  assets:   ${(dirSizeBytes(path.join(targetDir, 'assets')) / 1024 / 1024).toFixed(2)} MiB`);
