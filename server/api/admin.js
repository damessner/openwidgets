// Admin API — CONTRACT.md §5.5. User management, instance statistics and a
// retention helper for school DSGVO clean-up.
import { config } from '../config.js';
import { all, dbSizeBytes, now, one, run, tx } from '../db.js';
import {
  countAdmins,
  createUser,
  hashPassword,
  publicUser,
  requireAdmin,
} from '../lib/auth.js';
import { assertSameOrigin, badRequest, conflict, json, noContent, notFound, HttpError, readJson } from '../lib/http.js';

function adminUserJson(row) {
  return { ...publicUser(row), disabled: !!row.disabled };
}

const CREATE_ERROR_CODES = new Set(['invalid_email', 'invalid_name', 'invalid_role', 'weak_password']);

export function register(router) {
  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  router.get('/api/admin/users', async (req, res) => {
    requireAdmin(req);
    const rows = all('SELECT * FROM users ORDER BY created_at ASC');
    json(res, 200, { users: rows.map(adminUserJson) });
  });

  router.post('/api/admin/users', async (req, res) => {
    assertSameOrigin(req);
    requireAdmin(req);
    const body = await readJson(req, 64 * 1024);
    let user;
    try {
      user = createUser({
        email: body.email,
        name: body.name,
        role: body.role === undefined ? 'teacher' : body.role,
        password: body.password,
        locale: body.locale,
      });
    } catch (error) {
      const code = error && error.message ? error.message : 'invalid_request';
      if (code === 'email_exists') throw conflict('email_exists', 'A user with this email already exists');
      if (CREATE_ERROR_CODES.has(code)) {
        const messages = {
          invalid_email: 'Email is not valid',
          invalid_name: 'Name must be 2-120 characters',
          invalid_role: 'Role must be "admin" or "teacher"',
          weak_password: 'Password must be at least 10 characters',
        };
        throw badRequest(code, messages[code]);
      }
      throw error;
    }
    const row = one('SELECT * FROM users WHERE id = ?', user.id);
    json(res, 201, { user: adminUserJson(row) });
  });

  router.patch('/api/admin/users/:id', async (req, res, params) => {
    assertSameOrigin(req);
    const admin = requireAdmin(req);
    const row = one('SELECT * FROM users WHERE id = ?', String(params.id));
    if (!row) throw notFound('user_not_found');
    const body = await readJson(req, 64 * 1024);
    const updates = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 120) throw badRequest('invalid_name', 'Name must be 2-120 characters');
      updates.name = name;
    }
    if (body.role !== undefined) {
      if (body.role !== 'admin' && body.role !== 'teacher') {
        throw badRequest('invalid_role', 'Role must be "admin" or "teacher"');
      }
      if (row.role === 'admin' && body.role !== 'admin' && countAdmins() <= 1) {
        throw conflict('last_admin', 'The last admin account cannot be demoted');
      }
      updates.role = body.role;
    }
    if (body.disabled !== undefined) {
      const disabled = body.disabled ? 1 : 0;
      if (row.role === 'admin' && disabled && countAdmins() <= 1) {
        throw conflict('last_admin', 'The last admin account cannot be disabled');
      }
      updates.disabled = disabled;
    }
    if (body.password !== undefined) {
      const password = String(body.password);
      if (password.length < 10) throw badRequest('weak_password', 'Password must be at least 10 characters');
      updates.password_hash = hashPassword(password);
    }

    const fields = Object.keys(updates);
    if (fields.length > 0) {
      run(
        `UPDATE users SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`,
        ...fields.map((field) => updates[field]),
        row.id,
      );
    }
    void admin;
    json(res, 200, { user: adminUserJson(one('SELECT * FROM users WHERE id = ?', row.id)) });
  });

  router.delete('/api/admin/users/:id', async (req, res, params) => {
    assertSameOrigin(req);
    const admin = requireAdmin(req);
    const row = one('SELECT * FROM users WHERE id = ?', String(params.id));
    if (!row) throw notFound('user_not_found');
    if (row.id === admin.id) throw conflict('cannot_delete_self', 'You cannot delete your own account');
    if (row.role === 'admin' && countAdmins() <= 1) {
      throw conflict('last_admin', 'The last admin account cannot be deleted');
    }
    tx(() => {
      // Foreign keys RESTRICT on owned content, so the admin delete removes the
      // user's assignments and activities explicitly (participants cascade).
      const assignments = all('SELECT id FROM assignments WHERE owner_id = ?', row.id);
      for (const assignment of assignments) {
        run('DELETE FROM events WHERE assignment_id = ?', assignment.id);
      }
      const activities = all('SELECT id FROM activities WHERE owner_id = ?', row.id);
      for (const activity of activities) {
        const related = all('SELECT id FROM assignments WHERE activity_id = ?', activity.id);
        for (const assignment of related) run('DELETE FROM events WHERE assignment_id = ?', assignment.id);
      }
      run('DELETE FROM assignments WHERE owner_id = ?', row.id);
      run('DELETE FROM activities WHERE owner_id = ?', row.id);
      run('DELETE FROM sessions WHERE user_id = ?', row.id);
      run('DELETE FROM users WHERE id = ?', row.id);
    });
    noContent(res);
  });

  // -------------------------------------------------------------------------
  // Instance statistics
  // -------------------------------------------------------------------------
  router.get('/api/admin/stats', async (req, res) => {
    requireAdmin(req);
    const count = (sql, ...args) => {
      const row = one(sql, ...args);
      return row ? row.c : 0;
    };
    const assetsBytesRow = one('SELECT COALESCE(SUM(size), 0) AS s FROM assets');
    json(res, 200, {
      users: count('SELECT COUNT(*) AS c FROM users'),
      activities: count('SELECT COUNT(*) AS c FROM activities'),
      assignments: count('SELECT COUNT(*) AS c FROM assignments'),
      participants: count('SELECT COUNT(*) AS c FROM participants'),
      assets: count('SELECT COUNT(*) AS c FROM assets'),
      dbBytes: dbSizeBytes(),
      assetsBytes: assetsBytesRow ? assetsBytesRow.s : 0,
      version: config.version,
    });
  });

  // -------------------------------------------------------------------------
  // Retention helper (DSGVO): delete old submitted/graded participants + their
  // responses for assignments created before the cutoff. Assignments and
  // activities are kept. Safe dry-run first.
  // -------------------------------------------------------------------------
  router.post('/api/admin/purge', async (req, res) => {
    assertSameOrigin(req);
    requireAdmin(req);
    const body = await readJson(req, 32 * 1024);
    const days = body.olderThanDays === undefined ? 30 : Number(body.olderThanDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw badRequest('invalid_older_than_days', 'olderThanDays must be an integer between 1 and 3650');
    }
    const dryRun = body.dryRun === true;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const candidates = all(
      `SELECT p.id FROM participants p JOIN assignments s ON s.id = p.assignment_id
       WHERE s.created_at < ? AND p.status IN ('submitted','graded')`,
      cutoff,
    );
    const ids = candidates.map((row) => row.id);
    let responses = 0;
    let events = 0;
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const responseRow = one(`SELECT COUNT(*) AS c FROM responses WHERE participant_id IN (${placeholders})`, ...ids);
      const eventRow = one(`SELECT COUNT(*) AS c FROM events WHERE participant_id IN (${placeholders})`, ...ids);
      responses = responseRow ? responseRow.c : 0;
      events = eventRow ? eventRow.c : 0;
    }

    if (!dryRun && ids.length > 0) {
      tx(() => {
        const placeholders = ids.map(() => '?').join(',');
        run(`DELETE FROM responses WHERE participant_id IN (${placeholders})`, ...ids);
        run(`DELETE FROM events WHERE participant_id IN (${placeholders})`, ...ids);
        run(`DELETE FROM participants WHERE id IN (${placeholders})`, ...ids);
      });
    }

    json(res, 200, {
      dryRun,
      olderThanDays: days,
      cutoff,
      participantsDeleted: dryRun ? 0 : ids.length,
      participantsMatched: ids.length,
      responses: responses,
      events,
      settings: { note: 'Assignments and activities are kept; only participant data is removed.' },
    });
  });
}
