// Vocabulary lists API — teacher-managed word libraries (CONTRACT §5.9).
// Lists are owner-scoped (admins can read all). Entries are replaced
// wholesale on PUT (simplest consistent model for an editor grid) and can be
// bulk-imported from CSV (`term;translation;example` per line, tab allowed).
// The vocabulary item type stores a snapshot of entries, so lists are an
// authoring library — deleting a list never breaks a saved activity.
import { all, now, one, run, tx, uid, parseJson } from '../db.js';
import { parseVocabCsv, MAX_VOCAB_CSV_ROWS } from '../../shared/vocab-csv.js';
import { requireUser } from '../lib/auth.js';
import {
  assertSameOrigin,
  badRequest,
  forbidden,
  json,
  noContent,
  notFound,
  readJson,
} from '../lib/http.js';

const MAX_ENTRIES = 200;
const MAX_CSV_ROWS = MAX_VOCAB_CSV_ROWS;

function readJsonSafe(req) {
  return readJson(req, 256 * 1024).catch(() => {
    throw badRequest('invalid_json', 'Request body must be JSON');
  });
}

function cleanLang(value, fallback) {
  const v = String(value || '').trim().toLowerCase().slice(0, 10);
  return /^[a-z-]{2,10}$/.test(v) ? v : fallback;
}

function listRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function entryRow(row) {
  return {
    id: row.id,
    position: row.position,
    term: row.term,
    translation: row.translation,
    alternatives: parseJson(row.alternatives, []),
    example: row.example,
    imageAssetId: row.image_asset_id || '',
    audioAssetId: row.audio_asset_id || '',
    notes: row.notes,
  };
}

/** Validate one incoming entry; returns {ok, errors, entry}. */
function validateEntry(raw, index) {
  const errors = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const term = String(src.term || '').slice(0, 200);
  if (!term.trim()) errors.push(`entries[${index}].term: must not be empty`);
  const translation = String(src.translation || '').slice(0, 200);
  const alternatives = (Array.isArray(src.alternatives) ? src.alternatives : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.slice(0, 200))
    .slice(0, 10);
  const example = String(src.example || '').slice(0, 1000);
  const notes = String(src.notes || '').slice(0, 500);
  const imageAssetId = String(src.imageAssetId || '').trim().slice(0, 64);
  const audioAssetId = String(src.audioAssetId || '').trim().slice(0, 64);
  for (const [field, assetId] of [['imageAssetId', imageAssetId], ['audioAssetId', audioAssetId]]) {
    if (assetId) {
      const asset = one('SELECT id FROM assets WHERE id = ?', assetId);
      if (!asset) errors.push(`entries[${index}].${field}: unknown asset "${assetId}"`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    entry: { term, translation, alternatives, example, imageAssetId, audioAssetId, notes },
  };
}

function validateListBody(body) {
  const errors = [];
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const title = String(src.title || '').trim().slice(0, 200);
  if (!title) errors.push('title: must not be empty');
  if (title.length > 200) errors.push('title: at most 200 characters');
  const description = String(src.description || '').slice(0, 2000);
  const sourceLang = cleanLang(src.sourceLang ?? src.source_lang, 'de');
  const targetLang = cleanLang(src.targetLang ?? src.target_lang, 'en');
  let entries = null;
  if (src.entries !== undefined) {
    if (!Array.isArray(src.entries)) errors.push('entries: must be an array');
    else if (src.entries.length > MAX_ENTRIES) errors.push(`entries: at most ${MAX_ENTRIES} entries per list`);
    else {
      entries = [];
      src.entries.forEach((raw, index) => {
        const check = validateEntry(raw, index);
        if (!check.ok) errors.push(...check.errors);
        else entries.push(check.entry);
      });
    }
  }
  return { ok: errors.length === 0, errors, title, description, sourceLang, targetLang, entries };
}

function getOwnedList(req, id) {
  const user = requireUser(req);
  const row = one('SELECT * FROM vocab_lists WHERE id = ?', String(id || ''));
  if (!row) throw notFound('vocab_list_not_found', 'Vocabulary list not found');
  if (row.owner_id !== user.id && user.role !== 'admin') throw forbidden('not_your_list', 'Not your vocabulary list');
  return { user, row };
}

function replaceEntries(listId, entries) {
  run('DELETE FROM vocab_entries WHERE list_id = ?', listId);
  entries.forEach((entry, index) => {
    run(
      `INSERT INTO vocab_entries (id, list_id, position, term, translation, alternatives, example, image_asset_id, audio_asset_id, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid(),
      listId,
      index,
      entry.term,
      entry.translation,
      JSON.stringify(entry.alternatives),
      entry.example,
      entry.imageAssetId || null,
      entry.audioAssetId || null,
      entry.notes,
    );
  });
}

function listWithCount(row) {
  const countRow = one('SELECT COUNT(*) AS n FROM vocab_entries WHERE list_id = ?', row.id);
  return { ...listRow(row), entryCount: countRow ? Number(countRow.n) : 0 };
}

export function register(router) {
  router.get('/api/vocab-lists', async (req, res) => {
    const user = requireUser(req);
    const rows = user.role === 'admin'
      ? all('SELECT * FROM vocab_lists ORDER BY updated_at DESC')
      : all('SELECT * FROM vocab_lists WHERE owner_id = ? ORDER BY updated_at DESC', user.id);
    json(res, 200, { lists: rows.map(listWithCount) });
  });

  router.post('/api/vocab-lists', async (req, res) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const body = await readJsonSafe(req);
    const check = validateListBody(body);
    if (!check.ok) throw badRequest('validation_failed', 'Invalid vocabulary list', check.errors.map((message) => ({ path: message, message })));
    const id = uid();
    const timestamp = now();
    tx(() => {
      run(
        `INSERT INTO vocab_lists (id, owner_id, title, description, source_lang, target_lang, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        id, user.id, check.title, check.description, check.sourceLang, check.targetLang, timestamp, timestamp,
      );
      if (check.entries) replaceEntries(id, check.entries);
    });
    const row = one('SELECT * FROM vocab_lists WHERE id = ?', id);
    const entries = all('SELECT * FROM vocab_entries WHERE list_id = ? ORDER BY position', id).map(entryRow);
    json(res, 201, { list: listWithCount(row), entries });
  });

  router.get('/api/vocab-lists/:id', async (req, res, params) => {
    const { row } = getOwnedList(req, params.id);
    const entries = all('SELECT * FROM vocab_entries WHERE list_id = ? ORDER BY position', row.id).map(entryRow);
    json(res, 200, { list: listWithCount(row), entries });
  });

  router.put('/api/vocab-lists/:id', async (req, res, params) => {
    assertSameOrigin(req);
    const { row } = getOwnedList(req, params.id);
    const body = await readJsonSafe(req);
    const check = validateListBody({ ...body });
    if (!check.ok) throw badRequest('validation_failed', 'Invalid vocabulary list', check.errors.map((message) => ({ path: message, message })));
    tx(() => {
      run(
        `UPDATE vocab_lists SET title = ?, description = ?, source_lang = ?, target_lang = ?, updated_at = ? WHERE id = ?`,
        check.title, check.description, check.sourceLang, check.targetLang, now(), row.id,
      );
      if (check.entries) replaceEntries(row.id, check.entries);
    });
    const updated = one('SELECT * FROM vocab_lists WHERE id = ?', row.id);
    const entries = all('SELECT * FROM vocab_entries WHERE list_id = ? ORDER BY position', row.id).map(entryRow);
    json(res, 200, { list: listWithCount(updated), entries });
  });

  router.delete('/api/vocab-lists/:id', async (req, res, params) => {
    assertSameOrigin(req);
    const { row } = getOwnedList(req, params.id);
    run('DELETE FROM vocab_lists WHERE id = ?', row.id);
    noContent(res);
  });

  // Bulk import: append CSV rows to an existing list.
  router.post('/api/vocab-lists/:id/import', async (req, res, params) => {
    assertSameOrigin(req);
    const { row } = getOwnedList(req, params.id);
    const body = await readJsonSafe(req);
    const csv = String(body && body.csv !== undefined ? body.csv : '');
    if (!csv.trim()) throw badRequest('empty_csv', 'csv must not be empty');
    if (csv.length > 512 * 1024) throw badRequest('csv_too_large', 'csv must be at most 512 KB');
    const parsed = parseVocabCsv(csv);
    if (parsed.length === 0) throw badRequest('no_rows', 'No usable rows found (expected term;translation;example)');
    const existing = one('SELECT COUNT(*) AS n FROM vocab_entries WHERE list_id = ?', row.id);
    const current = existing ? Number(existing.n) : 0;
    if (current + parsed.length > MAX_ENTRIES) {
      throw badRequest('too_many_entries', `List would exceed ${MAX_ENTRIES} entries`);
    }
    tx(() => {
      parsed.forEach((entry, offset) => {
        run(
          `INSERT INTO vocab_entries (id, list_id, position, term, translation, alternatives, example, image_asset_id, audio_asset_id, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          uid(), row.id, current + offset, entry.term, entry.translation, JSON.stringify(entry.alternatives),
          entry.example, null, null, entry.notes,
        );
      });
      run('UPDATE vocab_lists SET updated_at = ? WHERE id = ?', now(), row.id);
    });
    const entries = all('SELECT * FROM vocab_entries WHERE list_id = ? ORDER BY position', row.id).map(entryRow);
    json(res, 200, { added: parsed.length, entries });
  });
}
