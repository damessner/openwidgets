// Student accounts: roster logins created by a teacher inside a class.
// Each student gets a unique username + a generated one-time password (the
// plaintext is returned exactly once at creation/reset and never stored).
// Sessions live in their own table/cookie so teacher and student sessions
// can coexist on the same device.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, now, one, run, uid } from '../db.js';
import { clearCookie, getCookie, setCookie, unauthorized } from './http.js';
import { hashPassword, isSecureRequest, sha256, verifyPassword } from './auth.js';

const STUDENT_COOKIE = 'ow_student';
const TOKEN_BYTES = 32;

// Unambiguous alphabet (no 0/O, 1/I/l) so passwords can be read aloud/printed.
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const USER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random readable password, e.g. "kX3mPq9Zt". */
export function generatePassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += PW_ALPHABET[byte % PW_ALPHABET.length];
  return out;
}

/** Slug base for usernames: "Müller, Anna" -> "anna-mueller". */
export function usernameBase(name) {
  const umlauts = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
  const text = String(name || '')
    .replace(/[äöüßÄÖÜ]/g, (char) => umlauts[char])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 40);
  return text.replace(/\./g, '-') || 'schueler';
}

/** Unique username derived from the student's name. */
export function generateUsername(name) {
  const base = usernameBase(name);
  let candidate = base;
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    if (!one('SELECT id FROM students WHERE username = ?', candidate)) return candidate;
    const suffix = crypto.randomBytes(2).toString('hex');
    candidate = `${base}-${suffix}`;
    if (attempt > 20) {
      // deterministic fallback with counter
      candidate = `${base}-${attempt}`;
      if (!one('SELECT id FROM students WHERE username = ?', candidate)) return candidate;
    }
  }
  // last resort: random suffix
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export function normalizeStudentName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function findStudentByUsername(username) {
  return one('SELECT * FROM students WHERE username = ?', String(username || '').trim().toLowerCase());
}

/** Find an existing account of this teacher for the same (normalized) name. */
export function findStudentByName(ownerId, name) {
  const clean = normalizeStudentName(name).toLowerCase();
  if (!clean) return null;
  return one('SELECT * FROM students WHERE owner_id = ? AND lower(name) = ?', ownerId, clean);
}

export function createStudent({ ownerId, name, password }) {
  const cleanName = normalizeStudentName(name);
  if (cleanName.length < 2) throw new Error('invalid_name');
  const username = generateUsername(cleanName);
  const id = uid();
  run(
    'INSERT INTO students (id, owner_id, name, username, password_hash, created_at) VALUES (?,?,?,?,?,?)',
    id,
    ownerId,
    cleanName,
    username,
    hashPassword(password),
    now(),
  );
  return one('SELECT * FROM students WHERE id = ?', id);
}

export function studentPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export function createStudentSession(req, res, student) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400000).toISOString();
  run(
    'INSERT INTO student_sessions (token_hash, student_id, created_at, expires_at) VALUES (?,?,?,?)',
    sha256(token),
    student.id,
    now(),
    expiresAt,
  );
  setCookie(res, STUDENT_COOKIE, token, {
    maxAge: config.sessionTtlDays * 86400,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isSecureRequest(req),
  });
  return token;
}

export function destroyStudentSession(req, res) {
  const token = getCookie(req, STUDENT_COOKIE);
  if (token) run('DELETE FROM student_sessions WHERE token_hash = ?', sha256(token));
  clearCookie(res, STUDENT_COOKIE, { httpOnly: true, sameSite: 'Lax', path: '/' });
}

/** Resolve the logged-in student from the cookie, sliding expiry. */
export function getStudent(req) {
  const token = getCookie(req, STUDENT_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = one(
    'SELECT s.*, ss.expires_at AS session_expires FROM student_sessions ss JOIN students s ON s.id = ss.student_id WHERE ss.token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  const expiresMs = Date.parse(row.session_expires);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    run('DELETE FROM student_sessions WHERE token_hash = ?', tokenHash);
    return null;
  }
  const ttlMs = config.sessionTtlDays * 86400000;
  if (expiresMs - Date.now() < ttlMs - 86400000) {
    run('UPDATE student_sessions SET expires_at = ? WHERE token_hash = ?', new Date(Date.now() + ttlMs).toISOString(), tokenHash);
  }
  return row;
}

export function requireStudent(req) {
  const student = getStudent(req);
  if (!student) throw unauthorized('student_required');
  req.student = student;
  return student;
}

export function cleanupStudentSessions() {
  run('DELETE FROM student_sessions WHERE expires_at < ?', now());
}

/** All class_participants rows linked to this student account. */
export function classParticipantsOfStudent(studentId) {
  return all('SELECT * FROM class_participants WHERE student_id = ?', studentId);
}

export { verifyPassword };
