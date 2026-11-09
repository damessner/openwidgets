// Activities API — CONTRACT.md §5.2. Teacher-owned activity CRUD, optimistic
// concurrency on `revision`, duplicate with regenerated ids, JSON import/export.
import { all, now, one, run, tx, uid } from '../db.js';
import { badRequest, HttpError, json, noContent, readJson } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { assertSameOrigin } from '../lib/http.js';
import { normalizeActivity, validateActivity } from '../../shared/activity.js';
import { regenerateItemIds } from '../../shared/items/index.js';
import { activityJson, activityListItem, definitionFromRow, requireOwnedActivity, slugify } from './_helpers.js';

const MAX_DEFINITION_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

function defaultTitle(template, locale) {
  if (locale === 'en') return template === 'quiz' ? 'New quiz' : 'New worksheet';
  return template === 'quiz' ? 'Neues Quiz' : 'Neues Arbeitsblatt';
}

function normalizeDefinitionInput(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new HttpError(400, 'validation_failed', 'Activity definition is invalid', [
      { path: 'definition', message: 'definition must be an object' },
    ]);
  }
  if (definition.items !== undefined && !Array.isArray(definition.items)) {
    throw new HttpError(400, 'validation_failed', 'Activity definition is invalid', [
      { path: 'items', message: 'items must be an array' },
    ]);
  }
  const normalized = normalizeActivity(definition);
  const check = validateActivity(normalized);
  if (!check.ok) {
    throw new HttpError(400, 'validation_failed', 'Activity definition is invalid', check.errors);
  }
  return normalized;
}

function assertTitle(title) {
  if (typeof title !== 'string') throw badRequest('invalid_title', 'Title must be a string');
  if (title.length > 200) throw badRequest('invalid_title', 'Title must be at most 200 characters');
}

function assertDescription(description) {
  if (typeof description !== 'string') throw badRequest('invalid_description', 'Description must be a string');
  if (description.length > 10000) {
    throw badRequest('invalid_description', 'Description must be at most 10000 characters');
  }
}

function assertTemplate(template) {
  if (template !== 'quiz' && template !== 'worksheet') {
    throw badRequest('invalid_template', 'Template must be "quiz" or "worksheet"');
  }
}

function assertLocale(locale) {
  if (locale !== 'de' && locale !== 'en') throw badRequest('invalid_locale', 'Locale must be "de" or "en"');
}

export function register(router) {
  // -------------------------------------------------------------------------
  // List own activities (admins see everything)
  // -------------------------------------------------------------------------
  router.get('/api/activities', async (req, res) => {
    const user = requireUser(req);
    const rows =
      user.role === 'admin'
        ? all(
            `SELECT a.*, (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id) AS assignment_count
             FROM activities a ORDER BY a.updated_at DESC`,
          )
        : all(
            `SELECT a.*, (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id) AS assignment_count
             FROM activities a WHERE a.owner_id = ? ORDER BY a.updated_at DESC`,
            user.id,
          );
    json(res, 200, {
      activities: rows.map((row) => activityListItem(row, row.assignment_count)),
    });
  });

  // -------------------------------------------------------------------------
  // Create draft
  // -------------------------------------------------------------------------
  router.post('/api/activities', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req, 64 * 1024);

    const template = body.template === undefined ? 'worksheet' : body.template;
    assertTemplate(template);
    const locale = body.locale === undefined ? user.locale || 'de' : body.locale;
    assertLocale(locale);
    const title =
      body.title === undefined || body.title === null || body.title === ''
        ? defaultTitle(template, locale)
        : String(body.title);
    assertTitle(title);
    const description = body.description === undefined ? '' : String(body.description);
    assertDescription(description);

    const definition = normalizeActivity({
      template,
      locale,
      title,
      description,
      settings: body.settings,
      items: [],
    });
    const id = uid();
    const timestamp = now();
    run(
      'INSERT INTO activities (id, owner_id, title, description, template, locale, definition, status, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      title,
      description,
      template,
      locale,
      JSON.stringify(definition),
      'draft',
      1,
      timestamp,
      timestamp,
    );
    json(res, 201, { activity: activityJson(one('SELECT * FROM activities WHERE id = ?', id)) });
  });

  // -------------------------------------------------------------------------
  // Import (export envelope or bare activity) — must be registered before :id
  // -------------------------------------------------------------------------
  router.post('/api/activities/import', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const body = await readJson(req, MAX_IMPORT_BYTES);

    let payload = body;
    if (body && typeof body === 'object' && body.format === 'openwidgets.activity') {
      payload = body.activity;
    } else if (body && typeof body === 'object' && body.activity && typeof body.activity === 'object') {
      payload = body.activity;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('invalid_import', 'Import payload must be an activity object or an OpenWidgets export envelope');
    }

    const template = payload.template === 'quiz' ? 'quiz' : 'worksheet';
    const locale = payload.locale === 'en' ? 'en' : 'de';
    const title = typeof payload.title === 'string' ? payload.title : defaultTitle(template, locale);
    assertTitle(title);
    const description = typeof payload.description === 'string' ? payload.description : '';
    assertDescription(description);

    const definition = normalizeDefinitionInput({
      v: 1,
      template,
      locale,
      title,
      description,
      settings: payload.settings,
      items: Array.isArray(payload.items) ? payload.items : [],
    });

    // Regenerate duplicate item ids so imported ids never clash internally.
    const seen = new Set();
    for (const item of definition.items) {
      if (seen.has(item.id)) {
        const fresh = regenerateItemIds(item);
        Object.assign(item, fresh);
      }
      seen.add(item.id);
    }

    const id = uid();
    const timestamp = now();
    run(
      'INSERT INTO activities (id, owner_id, title, description, template, locale, definition, status, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      title,
      description,
      definition.template,
      definition.locale,
      JSON.stringify(definition),
      'draft',
      1,
      timestamp,
      timestamp,
    );
    json(res, 201, { activity: activityJson(one('SELECT * FROM activities WHERE id = ?', id)) });
  });

  // -------------------------------------------------------------------------
  // Get one
  // -------------------------------------------------------------------------
  router.get('/api/activities/:id', async (req, res, params) => {
    requireUser(req);
    const row = requireOwnedActivity(req, params.id);
    json(res, 200, { activity: activityJson(row) });
  });

  // -------------------------------------------------------------------------
  // Update (optimistic concurrency via revision)
  // -------------------------------------------------------------------------
  router.put('/api/activities/:id', async (req, res, params) => {
    assertSameOrigin(req);
    requireUser(req);
    // Read the body before loading the row so check-and-write happen in one
    // synchronous turn (two concurrent saves cannot both win on the revision).
    const body = await readJson(req, MAX_DEFINITION_BYTES);
    const row = requireOwnedActivity(req, params.id);

    if (!Number.isInteger(body.revision)) {
      throw badRequest('revision_required', 'A numeric revision is required for updates');
    }
    if (body.revision !== row.revision) {
      throw new HttpError(409, 'revision_conflict', 'The activity was changed by someone else', {
        currentRevision: row.revision,
      });
    }

    const title = body.title === undefined ? row.title : String(body.title);
    assertTitle(title);
    const description = body.description === undefined ? row.description : String(body.description);
    assertDescription(description);
    const template = body.template === undefined ? row.template : body.template;
    assertTemplate(template);
    const locale = body.locale === undefined ? row.locale : body.locale;
    assertLocale(locale);

    let definition;
    if (body.definition === undefined) {
      definition = definitionFromRow(row);
    } else {
      definition = normalizeDefinitionInput(body.definition);
    }
    definition.title = title;
    definition.description = description;
    definition.template = template;
    definition.locale = locale;

    const updatedAt = now();
    run(
      'UPDATE activities SET title = ?, description = ?, template = ?, locale = ?, definition = ?, revision = ?, updated_at = ? WHERE id = ?',
      title,
      description,
      template,
      locale,
      JSON.stringify(definition),
      row.revision + 1,
      updatedAt,
      row.id,
    );
    json(res, 200, { activity: activityJson(one('SELECT * FROM activities WHERE id = ?', row.id)) });
  });

  // -------------------------------------------------------------------------
  // Delete (?force=1 removes the dependent assignments too)
  // -------------------------------------------------------------------------
  router.delete('/api/activities/:id', async (req, res, params, url) => {
    assertSameOrigin(req);
    requireUser(req);
    const row = requireOwnedActivity(req, params.id);
    const force = url && url.searchParams ? url.searchParams.get('force') : null;

    const assignments = all('SELECT id FROM assignments WHERE activity_id = ?', row.id);
    if (assignments.length > 0 && force !== '1') {
      throw new HttpError(
        409,
        'has_assignments',
        'This activity has assignments. Delete them first or pass force=1.',
        { assignmentCount: assignments.length },
      );
    }

    tx(() => {
      for (const assignment of assignments) {
        run('DELETE FROM events WHERE assignment_id = ?', assignment.id);
      }
      // assignments/participants/responses cascade from the activity row.
      run('DELETE FROM activities WHERE id = ?', row.id);
    });
    noContent(res);
  });

  // -------------------------------------------------------------------------
  // Duplicate (new item ids, title + " (Kopie)")
  // -------------------------------------------------------------------------
  router.post('/api/activities/:id/duplicate', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const source = requireOwnedActivity(req, params.id);
    const sourceDefinition = definitionFromRow(source);
    const definition = normalizeActivity(sourceDefinition);
    definition.items = definition.items.map((item) => regenerateItemIds(item));
    definition.title = `${sourceDefinition.title || defaultTitle(sourceDefinition.template, sourceDefinition.locale)} (Kopie)`;
    definition.description = sourceDefinition.description;
    definition.template = sourceDefinition.template;
    definition.locale = sourceDefinition.locale;

    const id = uid();
    const timestamp = now();
    run(
      'INSERT INTO activities (id, owner_id, title, description, template, locale, definition, status, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id,
      user.id,
      definition.title,
      definition.description,
      definition.template,
      definition.locale,
      JSON.stringify(definition),
      'draft',
      1,
      timestamp,
      timestamp,
    );
    json(res, 201, { activity: activityJson(one('SELECT * FROM activities WHERE id = ?', id)) });
  });

  // -------------------------------------------------------------------------
  // Export (attachment envelope)
  // -------------------------------------------------------------------------
  router.get('/api/activities/:id/export', async (req, res, params) => {
    requireUser(req);
    const row = requireOwnedActivity(req, params.id);
    const definition = definitionFromRow(row);
    const envelope = {
      format: 'openwidgets.activity',
      formatVersion: 1,
      exportedAt: now(),
      activity: {
        title: definition.title,
        description: definition.description,
        template: definition.template,
        locale: definition.locale,
        settings: definition.settings,
        items: definition.items,
      },
    };
    json(res, 200, envelope, {
      'Content-Disposition': `attachment; filename="openwidgets-${slugify(definition.title)}.json"`,
    });
  });
}
