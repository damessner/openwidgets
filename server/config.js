// Central runtime configuration. Everything that differs between a laptop and a
// school LXC comes from the environment — no config files, no dotenv dependency.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  root: ROOT,
  serverDir: path.join(ROOT, 'server'),
  publicDir: path.join(ROOT, 'public'),
  sharedDir: path.join(ROOT, 'shared'),
  dataDir,
  assetsDir: path.join(dataDir, 'assets'),
  dbPath: path.join(dataDir, 'openwidgets.db'),
  port: intEnv('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
  trustProxy: process.env.TRUST_PROXY === '1',
  // Demo mode is OFF unless explicitly requested. It allows the throwaway
  // "admin"/"admin" account and a login with a bare username, and is surfaced
  // in the UI so nobody mistakes it for a real instance.
  demoMode: process.env.OW_DEMO_MODE === '1',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Administrator',
  sessionTtlDays: Math.max(1, intEnv('SESSION_TTL_DAYS', 14)),
  maxUploadBytes: Math.max(1, intEnv('MAX_UPLOAD_MB', 10)) * 1024 * 1024,
  nodeEnv: process.env.NODE_ENV || 'development',
  version: '0.9.0',
  startedAt: Date.now(),
};

export const isProd = config.nodeEnv === 'production';

export function log(...args) {
  if (config.nodeEnv === 'test') return;
  console.log('[openwidgets]', ...args);
}

export function logError(...args) {
  console.error('[openwidgets]', ...args);
}
