// Password hashing, teacher sessions and auth guard helpers.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, now, one, run, uid } from '../db.js';
import { clearCookie, clientIp, forbidden, getCookie, setCookie, unauthorized } from './http.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'ow_session';
const TOKEN_BYTES = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  let expected;
  try {
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  if (!config.trustProxy) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    locale: row.locale || 'de',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export function createSession(req, res, user) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400000).toISOString();
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    sha256(token),
    user.id,
    now(),
    expiresAt,
    clientIp(req, config.trustProxy).slice(0, 100),
    String(req.headers['user-agent'] || '').slice(0, 300),
  );
  setCookie(res, SESSION_COOKIE, token, {
    maxAge: config.sessionTtlDays * 86400,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isSecureRequest(req),
  });
  return token;
}

export function destroySession(req, res) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  clearCookie(res, SESSION_COOKIE, { httpOnly: true, sameSite: 'Lax', path: '/' });
}

/** Resolve the logged-in teacher from the session cookie, sliding expiry. */
export function getSessionUser(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = one(
    'SELECT u.*, s.expires_at AS session_expires, s.token_hash AS session_token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  if (row.disabled) return null;
  const expiresMs = Date.parse(row.session_expires);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  // Slide the session at most once per "quarter lifetime" to avoid a DB write on
  // every request.
  const ttlMs = config.sessionTtlDays * 86400000;
  if (expiresMs - Date.now() < ttlMs - 86400000) {
    const extended = new Date(Date.now() + ttlMs).toISOString();
    run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', extended, tokenHash);
  }
  return publicUser(row);
}

export function requireUser(req) {
  const user = getSessionUser(req);
  if (!user) throw unauthorized();
  req.user = user;
  return user;
}

export function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden('admin_required');
  return user;
}

export function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

export function countAdmins() {
  const row = one("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0");
  return row ? row.c : 0;
}

export function findUserByEmail(email) {
  return one('SELECT * FROM users WHERE email = ?', String(email || '').trim());
}

export function createUser({ email, name, role = 'teacher', password, locale = 'de' }) {
  const cleanEmail = String(email || '').trim();
  const cleanName = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('invalid_email');
  if (cleanName.length < 2) throw new Error('invalid_name');
  if (!['admin', 'teacher'].includes(role)) throw new Error('invalid_role');
  if (String(password || '').length < 10) throw new Error('weak_password');
  if (findUserByEmail(cleanEmail)) throw new Error('email_exists');
  const id = uid();
  run(
    'INSERT INTO users (id, email, name, role, password_hash, locale, created_at) VALUES (?,?,?,?,?,?,?)',
    id,
    cleanEmail,
    cleanName,
    role,
    hashPassword(password),
    locale === 'en' ? 'en' : 'de',
    now(),
  );
  return publicUser(one('SELECT * FROM users WHERE id = ?', id));
}

export function listUsers() {
  return all('SELECT * FROM users ORDER BY created_at ASC');
}

/**
 * First-boot convenience: if there are no users yet and ADMIN_EMAIL +
 * ADMIN_PASSWORD are set, create the first admin account.
 */
export function seedAdmin() {
  const row = one('SELECT COUNT(*) AS c FROM users');
  if (row && row.c > 0) return false;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn(
      '[openwidgets] No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) and restart, ' +
        'or run: npm run admin:create -- --email you@school.at --name "Your Name" --password "..."',
    );
    return false;
  }
  if (config.adminPassword.length < 10) {
    console.warn('[openwidgets] ADMIN_PASSWORD is shorter than 10 characters — admin not created.');
    return false;
  }
  try {
    createUser({
      email: config.adminEmail,
      name: config.adminName,
      role: 'admin',
      password: config.adminPassword,
    });
    console.log(`[openwidgets] Created first admin account: ${config.adminEmail}`);
    return true;
  } catch (err) {
    console.warn(`[openwidgets] Could not create admin account: ${err.message}`);
    return false;
  }
}
