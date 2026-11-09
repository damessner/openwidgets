// Assets API — CONTRACT.md §5.5. Raw-body upload with a MIME allowlist (no
// SVG, XSS), public immutable serving for renderers, owner-only deletion.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { now, one, run, uid } from '../db.js';
import { requireUser } from '../lib/auth.js';
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

export function assetJson(row) {
  return {
    id: row.id,
    url: `/assets/${row.id}/${encodeURIComponent(row.filename)}`,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
  };
}

export function register(router) {
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

    const id = uid();
    const target = assetFile(id);
    if (!target) throw badRequest('invalid_asset', 'Could not store the asset');
    await fs.promises.writeFile(target, bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    run(
      'INSERT INTO assets (id, owner_id, filename, mime, size, sha256, created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      user.id,
      filename,
      mime,
      bytes.length,
      sha256,
      now(),
    );
    json(res, 201, { asset: assetJson(one('SELECT * FROM assets WHERE id = ?', id)) });
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
