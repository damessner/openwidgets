// Tiny HTTP toolkit: router, body parsing, cookies, JSON responses, secure file
// serving and same-origin checks. No framework — Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code = 'invalid_request', message = 'Bad request', details) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code = 'unauthorized') => new HttpError(401, code, 'Authentication required');
export const forbidden = (code = 'forbidden') => new HttpError(403, code, 'Not allowed');
export const notFound = (code = 'not_found') => new HttpError(404, code, 'Not found');
export const conflict = (code = 'conflict', message = 'Conflict') => new HttpError(409, code, message);
export const tooLarge = () => new HttpError(413, 'payload_too_large', 'Request body too large');
export const rateLimited = () => new HttpError(429, 'rate_limited', 'Too many requests');

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

export async function readRaw(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 1024 * 1024) {
  const raw = await readRaw(req, maxBytes);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('invalid_json', 'Request body is not valid JSON');
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function noContent(res) {
  res.writeHead(204);
  res.end();
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': body.length });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function getCookie(req, name) {
  return parseCookies(req.headers.cookie || '')[name];
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  return parts.join('; ');
}

export function setCookie(res, name, value, opts = {}) {
  const existing = res.getHeader('Set-Cookie');
  const cookie = serializeCookie(name, value, opts);
  const list = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : [];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

export function clearCookie(res, name, opts = {}) {
  setCookie(res, name, '', { ...opts, maxAge: 0, expires: new Date(0) });
}

// ---------------------------------------------------------------------------
// Request metadata helpers
// ---------------------------------------------------------------------------

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || '';
}

export function requestOrigin(req, trustProxy = false) {
  const proto = trustProxy
    ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http'
    : (req.socket?.encrypted ? 'https' : 'http');
  const host = trustProxy
    ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() || req.headers.host
    : req.headers.host;
  return { proto, host };
}

/** CSRF defence: state-changing browser requests must be same-origin. */
export function assertSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const { proto, host } = requestOrigin(req, config.trustProxy);
  const candidates = [];
  if (req.headers.origin) candidates.push(req.headers.origin);
  if (req.headers.referer) candidates.push(req.headers.referer);
  if (candidates.length === 0) return; // non-browser client (curl/tests) — SameSite cookie still applies
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.host === host || url.host === `localhost:${config.port}` || url.host === `127.0.0.1:${config.port}`) {
        return;
      }
      // Behind a proxy the outward host may differ from the internal Host header.
      if (config.trustProxy && config.baseUrl) {
        try {
          if (new URL(config.baseUrl).host === url.host) return;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* malformed origin */
    }
  }
  throw new HttpError(403, 'bad_origin', 'Cross-origin request rejected');
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export function securityHeaders(res, { embed = false } = {}) {
  const frameAncestors = embed ? '*' : "'self'";
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!embed) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a URL path inside a root directory, refusing traversal outside it.
 * Returns absolute path or null when unsafe.
 */
export function safeJoin(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '/'));
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalizedUrl = decoded.replace(/\\/g, '/');
  const target = path.resolve(rootDir, '.' + (normalizedUrl.startsWith('/') ? normalizedUrl : `/${normalizedUrl}`));
  const root = path.resolve(rootDir);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * Serve a file with ETag/304 support. Returns false when the file does not
 * exist or is not a regular file (caller can fall back to a 404).
 */
export async function serveFile(req, res, filePath, opts = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cacheControl = opts.cacheControl || 'no-cache';
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
  };
  if (opts.downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${opts.downloadName.replace(/["\\]/g, '_')}"`;
  } else {
    headers['Content-Disposition'] = 'inline';
  }

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  headers['Content-Length'] = stat.size;
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return true;
  }

  res.writeHead(200, headers);
  try {
    await pipeline(fs.createReadStream(filePath), res);
  } catch (err) {
    // Client aborted mid-stream (common on navigation) — not an application error.
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') throw err;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function compilePattern(pattern) {
  const segments = String(pattern)
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return `(?<${segment.slice(1)}>[^/]+)`;
      if (segment === '*') return '(?:.*)';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
  return new RegExp(`^${segments.join('/')}$`);
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method: String(method).toUpperCase(), matcher: compilePattern(pattern), handler, pattern });
    return this;
  }

  get(pattern, handler) {
    return this.add('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.add('POST', pattern, handler);
  }

  put(pattern, handler) {
    return this.add('PUT', pattern, handler);
  }

  patch(pattern, handler) {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern, handler) {
    return this.add('DELETE', pattern, handler);
  }

  /**
   * Find a handler for method+path. Returns { handler, params } or null.
   * HEAD requests are matched to GET handlers.
   */
  match(method, pathname) {
    const wanted = String(method).toUpperCase();
    for (const route of this.routes) {
      if (route.method !== wanted) {
        if (!(wanted === 'HEAD' && route.method === 'GET')) continue;
      }
      const m = route.matcher.exec(pathname);
      if (!m) continue;
      const params = {};
      for (const [key, value] of Object.entries(m.groups || {})) {
        if (value === undefined) continue;
        try {
          params[key] = decodeURIComponent(value);
        } catch {
          params[key] = value;
        }
      }
      return { handler: route.handler, params };
    }
    return null;
  }
}
