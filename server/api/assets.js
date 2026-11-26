// Assets API — CONTRACT.md §5.5. Raw-body upload with a MIME allowlist (no
// SVG, XSS), public immutable serving for renderers, owner-only deletion.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { all, now, one, run, uid } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { getStudent } from '../lib/students.js';
import { mp3Filename, needsTranscode, transcodeToMp3 } from '../lib/audio.js';
import { tokenHash } from './_helpers.js';
import {
  assertSameOrigin,
  badRequest,
  HttpError,
  json,
  noContent,
  notFound,
  rateLimited,
  readRaw,
  safeJoin,
  unauthorized,
} from '../lib/http.js';

// Allowlist from the contract. A few common browser aliases are mapped onto the
// canonical value; SVG is deliberately absent (scriptable content).
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-mp3': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
};

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

const UPLOAD_LIMIT_PER_MINUTE = 60;
const uploadWindows = new Map(); // userId -> { count, resetAt }

function assertUploadAllowed(userId) {
  const nowMs = Date.now();
  const entry = uploadWindows.get(userId);
  if (!entry || entry.resetAt < nowMs) {
    uploadWindows.set(userId, { count: 1, resetAt: nowMs + 60000 });
    return;
  }
  if (entry.count >= UPLOAD_LIMIT_PER_MINUTE) throw rateLimited();
  entry.count += 1;
}

function normalizeMime(req) {
  const raw = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const mime = MIME_ALIASES[raw] || raw;
  if (!ALLOWED_MIME.has(mime)) {
    throw badRequest(
      'unsupported_type',
      'Unsupported file type. Allowed: PNG, JPEG, WebP, GIF, MP3, M4A, OGG, WAV, WebM.',
    );
  }
  return mime;
}

function sanitizeFilename(value) {
  const base = path.basename(String(value || '') || 'datei');
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned || 'datei';
}

function assetFile(id) {
  return safeJoin(config.assetsDir, `/${id}`);
}

/**
 * Store raw bytes as an asset (used by uploads and by TTS generation).
 * Returns the inserted assets row.
 */
export async function storeAssetBytes({ ownerId, bytes, mime, filename }) {
  const id = uid();
  const target = assetFile(id);
  if (!target) throw badRequest('invalid_asset', 'Could not store the asset');
  await fs.promises.writeFile(target, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  run(
    'INSERT INTO assets (id, owner_id, filename, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?)',
    id,
    ownerId,
    sanitizeFilename(filename),
    mime,
    bytes.length,
    sha256,
    now(),
  );
  return one('SELECT * FROM assets WHERE id = ?', id);
}

export function assetJson(row, extra) {
  return {
    id: row.id,
    url: `/assets/${row.id}/${encodeURIComponent(row.filename)}`,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    ...(extra || {}),
  };
}

/**
 * Normalise uploaded audio to MP3 when possible (WAV/OGG/M4A/WebM → MP3, much
 * smaller). Falls back to the original bytes when ffmpeg is unavailable or the
 * conversion fails — browsers play those formats natively.
 */
async function normalizeAudioUpload(bytes, mime, filename) {
  if (!needsTranscode(mime)) return { bytes, mime, filename, converted: false };
  const mp3 = await transcodeToMp3(bytes, mime);
  if (!mp3) return { bytes, mime, filename, converted: false };
  return { bytes: mp3.bytes, mime: mp3.mime, filename: mp3Filename(filename), converted: true };
}

export function register(router) {
  // -------------------------------------------------------------------------
  // Library: list uploaded assets (owner-scoped; admins see all). This is
  // what the teacher media picker shows — uploads are NOT only kept in the
  // browser's localStorage, they live on the server.
  // -------------------------------------------------------------------------
  router.get('/api/assets', async (req, res) => {
    const user = requireUser(req);
    const rows =
      user.role === 'admin'
        ? all('SELECT * FROM assets ORDER BY created_at DESC LIMIT 200')
        : all('SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', user.id);
    json(res, 200, {
      assets: rows.map((row) => ({
        ...assetJson(row),
        createdAt: row.created_at,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // Upload (raw body, teacher only, rate limited)
  // -------------------------------------------------------------------------
  router.post('/api/assets', async (req, res, params, url) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    assertUploadAllowed(user.id);

    const mime = normalizeMime(req);
    const requested = url && url.searchParams ? url.searchParams.get('filename') : '';
    const filename = sanitizeFilename(requested);

    const bytes = await readRaw(req, config.maxUploadBytes);
    if (!bytes || bytes.length === 0) throw badRequest('empty_file', 'The uploaded file is empty');

    const audio = await normalizeAudioUpload(bytes, mime, filename);

    const id = uid();
    const target = assetFile(id);
    if (!target) throw badRequest('invalid_asset', 'Could not store the asset');
    await fs.promises.writeFile(target, audio.bytes);
    const sha256 = crypto.createHash('sha256').update(audio.bytes).digest('hex');
    run(
      'INSERT INTO assets (id, owner_id, filename, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      user.id,
      audio.filename,
      audio.mime,
      audio.bytes.length,
      sha256,
      now(),
    );
    json(res, 201, { asset: assetJson(one('SELECT * FROM assets WHERE id = ?', id), { convertedToMp3: audio.converted }) });
  });

  // -------------------------------------------------------------------------
  // Participant upload (student audio answers): participant token header or
  // student session. Audio only, smaller cap, rate limited per participant.
  // owner_id stays NULL for anonymous participants (admin can delete those).
  // -------------------------------------------------------------------------
  const PARTICIPANT_AUDIO_LIMIT_PER_MINUTE = 20;
  const PARTICIPANT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
  const participantUploadWindows = new Map();

  function assertParticipantUploadAllowed(key) {
    const nowMs = Date.now();
    const entry = participantUploadWindows.get(key);
    if (!entry || entry.resetAt < nowMs) {
      participantUploadWindows.set(key, { count: 1, resetAt: nowMs + 60000 });
      return;
    }
    if (entry.count >= PARTICIPANT_AUDIO_LIMIT_PER_MINUTE) throw rateLimited();
    entry.count += 1;
  }

  router.post('/api/participant/assets', async (req, res, params, url) => {
    assertSameOrigin(req);
    const header = req.headers['x-participant-token'];
    const token = Array.isArray(header) ? header[0] : header;
    const participant =
      typeof token === 'string' && token.trim().length >= 16
        ? one('SELECT * FROM participants WHERE token_hash = ?', tokenHash(token.trim()))
        : null;
    const student = getStudent(req);
    if (!participant && !student) throw unauthorized('Authentication required');
    assertParticipantUploadAllowed(participant ? `p:${participant.id}` : `s:${student.id}`);

    const mime = normalizeMime(req);
    if (!mime.startsWith('audio/')) {
      throw badRequest('unsupported_type', 'Participant uploads are limited to audio recordings (MP3, M4A, OGG, WAV, WebM).');
    }
    const requested = url && url.searchParams ? url.searchParams.get('filename') : '';
    const ext = mime === 'audio/webm' ? 'webm' : mime === 'audio/ogg' ? 'ogg' : mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : 'm4a';
    const filename = sanitizeFilename(requested || `aufnahme-${Date.now()}.${ext}`);

    const bytes = await readRaw(req, Math.min(config.maxUploadBytes, PARTICIPANT_UPLOAD_MAX_BYTES));
    if (!bytes || bytes.length === 0) throw badRequest('empty_file', 'The uploaded file is empty');

    const audio = await normalizeAudioUpload(bytes, mime, filename);

    const id = uid();
    const target = assetFile(id);
    if (!target) throw badRequest('invalid_asset', 'Could not store the asset');
    await fs.promises.writeFile(target, audio.bytes);
    const sha256 = crypto.createHash('sha256').update(audio.bytes).digest('hex');
    run(
      'INSERT INTO assets (id, owner_id, filename, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      student ? student.id : null,
      audio.filename,
      audio.mime,
      audio.bytes.length,
      sha256,
      now(),
    );
    json(res, 201, { asset: assetJson(one('SELECT * FROM assets WHERE id = ?', id), { convertedToMp3: audio.converted }) });
  });

  // -------------------------------------------------------------------------
  // Public serving: /assets/:id/:filename — the filename is cosmetic/ignored
  // (renderers only know the asset id), the id is authoritative.
  // -------------------------------------------------------------------------
  router.get('/assets/:id/:filename', async (req, res, params) => {
    const row = one('SELECT * FROM assets WHERE id = ?', String(params.id));
    if (!row) throw notFound('asset_not_found');
    const file = assetFile(row.id);
    if (!file) throw notFound('asset_not_found');
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw notFound('asset_not_found');
    }
    if (!stat.isFile()) throw notFound('asset_not_found');

    const headers = {
      'Content-Type': row.mime,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      ETag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    };
    if (req.headers['if-none-match'] === headers.ETag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    try {
      await pipeline(fs.createReadStream(file), res);
    } catch (error) {
      if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE' && error.code !== 'ECONNRESET') throw error;
    }
  });

  // -------------------------------------------------------------------------
  // Delete (owner or admin). References from activities are not tracked in
  // v0.1 (contract: warn, don't enforce); the UI warns before deleting.
  // -------------------------------------------------------------------------
  router.delete('/api/assets/:id', async (req, res, params) => {
    assertSameOrigin(req);
    const user = requireUser(req);
    const row = one('SELECT * FROM assets WHERE id = ?', String(params.id));
    if (!row) throw notFound('asset_not_found');
    if (user.role !== 'admin' && row.owner_id !== user.id) {
      throw new HttpError(403, 'forbidden', 'You do not have access to this asset');
    }
    run('DELETE FROM assets WHERE id = ?', row.id);
    const file = assetFile(row.id);
    if (file) {
      try {
        await fs.promises.unlink(file);
      } catch {
        /* file may already be gone */
      }
    }
    noContent(res);
  });
}
