// Teacher authentication endpoints. Owned by the Lead.
import { readJson, json, noContent, badRequest, unauthorized, rateLimited, assertSameOrigin, clientIp } from '../lib/http.js';
import { config } from '../config.js';
import { now, one, run } from '../db.js';
import {
  createSession,
  destroySession,
  hashPassword,
  publicUser,
  requireUser,
  verifyPassword,
} from '../lib/auth.js';

// In-memory login throttle: 10 failures per 15 minutes per IP.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map(); // ip -> { count, resetAt }

function bumpFailure(ip) {
  const entry = failures.get(ip);
  const nowMs = Date.now();
  if (!entry || entry.resetAt < nowMs) {
    failures.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function assertNotThrottled(ip) {
  const entry = failures.get(ip);
  if (!entry) return;
  if (entry.resetAt < Date.now()) {
    failures.delete(ip);
    return;
  }
  if (entry.count >= MAX_FAILURES) throw rateLimited();
}

function clearFailures(ip) {
  failures.delete(ip);
}

export function register(router) {
  router.post('/api/auth/login', async (req, res) => {
    assertSameOrigin(req);
    const ip = clientIp(req, config.trustProxy);
    assertNotThrottled(ip);

    const body = await readJson(req, 16 * 1024);
    let email = String(body.email || '').trim();
    const password = String(body.password || '');
    // Demo mode: the pre-configured account may be entered as bare "admin".
    if (config.demoMode && email && !email.includes('@')) email = `${email}@schule.local`;
    if (!email || !password) throw badRequest('missing_credentials', 'Email and password are required');

    const row = one('SELECT * FROM users WHERE email = ?', email);
    if (!row || row.disabled || !verifyPassword(password, row.password_hash)) {
      bumpFailure(ip);
      throw unauthorized('invalid_credentials');
    }

    clearFailures(ip);
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), row.id);
    createSession(req, res, row);
    json(res, 200, { user: publicUser({ ...row, last_login_at: now() }) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    assertSameOrigin(req);
    destroySession(req, res);
    noContent(res);
  });

  router.get('/api/me', async (req, res) => {
    const user = requireUser(req);
    json(res, 200, { user });
  });

  router.patch('/api/me', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req, 64 * 1024);
    const updates = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 120) throw badRequest('invalid_name', 'Name must be 2-120 characters');
      updates.name = name;
    }
    if (body.locale !== undefined) {
      const locale = body.locale === 'en' ? 'en' : 'de';
      updates.locale = locale;
    }
    if (body.password !== undefined) {
      const current = String(body.currentPassword || '');
      const next = String(body.password || '');
      const row = one('SELECT * FROM users WHERE id = ?', user.id);
      if (!row || !verifyPassword(current, row.password_hash)) {
        throw unauthorized('invalid_current_password');
      }
      if (next.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters');
      updates.password_hash = hashPassword(next);
    }

    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length > 0) {
      run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values, user.id);
    }
    json(res, 200, { user: publicUser(one('SELECT * FROM users WHERE id = ?', user.id)) });
  });
}
