#!/usr/bin/env node
// Restore a backup produced by scripts/backup.mjs.
// The OpenWidgets service MUST be stopped first (this script refuses if it can
// still reach the health endpoint). The current database is moved aside to
// data/.pre-restore-<timestamp>/ before the backup is copied in.
//
// Usage: node scripts/restore.mjs --from <backup-dir-or-file> --yes [--force]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config } from '../server/config.js';
import { DatabaseSync } from 'node:sqlite';

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

function isSqliteFile(file) {
  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString('utf8').startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.from) {
  console.error('Usage: node scripts/restore.mjs --from <backup-dir-or-file> --yes [--force]');
  process.exit(1);
}

const from = path.resolve(String(args.from));
const sourceDb = fs.existsSync(from) && fs.statSync(from).isDirectory() ? path.join(from, 'openwidgets.db') : from;

if (!fs.existsSync(sourceDb) || !isSqliteFile(sourceDb)) {
  console.error(`Not a valid OpenWidgets/SQLite backup: ${sourceDb}`);
  process.exit(1);
}

if (!args.yes) {
  console.error('Refusing to overwrite the database without --yes. Stop the service, then re-run with --yes.');
  process.exit(1);
}

// Refuse to run while the instance is reachable (unless --force).
if (!args.force) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) {
      console.error(`OpenWidgets still responds on port ${config.port}. Stop the service first (e.g. systemctl stop openwidgets).`);
      process.exit(1);
    }
  } catch {
    /* not running — good */
  }
}

// Secondary guard: make sure nothing holds the SQLite write lock.
if (fs.existsSync(config.dbPath)) {
  let probe;
  try {
    probe = new DatabaseSync(config.dbPath);
    probe.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE; ROLLBACK;');
  } catch {
    console.error('The database appears to be locked by another process. Stop OpenWidgets first.');
    try {
      probe?.close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
  try {
    probe.close();
  } catch {
    /* ignore */
  }
}

fs.mkdirSync(config.dataDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const safetyDir = path.join(config.dataDir, `.pre-restore-${stamp}`);
fs.mkdirSync(safetyDir, { recursive: true });

for (const file of ['openwidgets.db', 'openwidgets.db-wal', 'openwidgets.db-shm']) {
  const full = path.join(config.dataDir, file);
  if (fs.existsSync(full)) fs.copyFileSync(full, path.join(safetyDir, file));
}

fs.copyFileSync(sourceDb, config.dbPath);
for (const file of ['openwidgets.db-wal', 'openwidgets.db-shm']) {
  const full = path.join(config.dataDir, file);
  if (fs.existsSync(full)) fs.rmSync(full, { force: true });
}

const sourceAssets = path.join(path.dirname(sourceDb), 'assets');
if (fs.existsSync(sourceAssets)) {
  fs.cpSync(sourceAssets, config.assetsDir, { recursive: true, force: true });
}

console.log(`Restored database from: ${sourceDb}`);
console.log(`Previous database moved to: ${safetyDir}`);
console.log('Start the service again, then verify: curl http://127.0.0.1:' + config.port + '/api/health');
