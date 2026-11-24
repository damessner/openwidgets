// SQLite persistence layer. One file database in DATA_DIR; WAL mode.
// Schema is created idempotently on boot. Keep this file dependency-free and
// boring: query helpers + schema only, no business logic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.assetsDir, { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin','teacher')),
  password_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT 'worksheet' CHECK (template IN ('quiz','worksheet')),
  locale TEXT NOT NULL DEFAULT 'de',
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  settings TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  due_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  last_seen_at TEXT,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  response TEXT NOT NULL,
  auto_score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  needs_manual INTEGER NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL DEFAULT '',
  manual_score REAL,
  updated_at TEXT NOT NULL,
  UNIQUE (participant_id, item_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id TEXT NOT NULL,
  participant_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- v2: classes (bundles of assignments) --------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_mode TEXT NOT NULL DEFAULT 'free' CHECK (order_mode IN ('free','sequence')),
  unlock_min_percent REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_items (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE (class_id, assignment_id),
  UNIQUE (class_id, position)
);

CREATE TABLE IF NOT EXISTS class_participants (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_owner ON assignments(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_activity ON assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_participants_assignment ON participants(assignment_id, started_at);
CREATE INDEX IF NOT EXISTS idx_responses_participant ON responses(participant_id);
CREATE INDEX IF NOT EXISTS idx_events_assignment ON events(assignment_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_classes_owner ON classes(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_items_class ON class_items(class_id, position);
CREATE INDEX IF NOT EXISTS idx_class_participants_class ON class_participants(class_id);
`;

export const db = new DatabaseSync(config.dbPath);

const SCHEMA_VERSION = 2;

/**
 * Migration ladder. When the schema changes in v0.2+, append
 * `{ version: 3, up() { db.exec('ALTER TABLE ...'); } }`. Every migration runs
 * exactly once inside a transaction; `user_version` is the bookkeeping.
 */
const MIGRATIONS = [
  {
    version: 2,
    up() {
      // Link assignment participants to a class participant when they joined
      // through a class (unlock tracking). Guarded so fresh installs (where the
      // column may already exist) do not fail on a duplicate column.
      const cols = db.prepare('PRAGMA table_info(participants)').all().map((col) => col.name);
      if (!cols.includes('class_participant_id')) {
        db.exec(
          'ALTER TABLE participants ADD COLUMN class_participant_id TEXT REFERENCES class_participants(id) ON DELETE SET NULL',
        );
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_participants_class_participant ON participants(class_participant_id)');
    },
  },
];

let initialized = false;

/** Create schema if needed and apply connection pragmas. Safe to call twice. */
export function initDb() {
  if (initialized) return db;
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');

  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${SCHEMA_VERSION}). ` +
        'Refusing to start — upgrade the application instead of downgrading the data.',
    );
  }

  db.exec(SCHEMA);
  if (current < SCHEMA_VERSION) {
    for (const migration of MIGRATIONS) {
      if (current < migration.version) {
        db.exec('BEGIN IMMEDIATE');
        try {
          migration.up();
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw new Error(`Schema migration to v${migration.version} failed: ${err.message}`);
        }
      }
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
  initialized = true;
  return db;
}

export function one(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function uid() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

/** Short opaque id with a readable prefix, e.g. "it_k3j9x2". */
export function shortId(prefix = 'id') {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

export function parseJson(text, fallback = null) {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

/** Bytes used by the database file (including WAL) — for the admin dashboard. */
export function dbSizeBytes() {
  let total = 0;
  for (const file of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
    try {
      total += fs.statSync(file).size;
    } catch {
      /* file may not exist */
    }
  }
  return total;
}
