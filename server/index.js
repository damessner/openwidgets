// OpenWidgets — single-process HTTP server. Serves the API, the teacher/student
// UIs and shared ES modules. No bundler, no framework, no npm dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, log, logError } from './config.js';
import { initDb, one } from './db.js';
import { cleanupSessions, getSessionUser, seedAdmin } from './lib/auth.js';
import { cleanupStudentSessions } from './lib/students.js';
import { closeAll, startHeartbeat } from './lib/events.js';
import { HttpError, Router, json, safeJoin, securityHeaders, serveFile } from './lib/http.js';
import { seedDemoContent } from './demo-seed.js';

import { register as registerAuth } from './api/auth.js';
import { register as registerAdmin } from './api/admin.js';
import { register as registerActivities } from './api/activities.js';
import { register as registerAssets } from './api/assets.js';
import { register as registerVocab } from './api/vocab.js';
import { register as registerLlm } from './api/llm.js';
import { isLlmEnabled } from './llm/core.js';
import { register as registerAssignments } from './api/assignments.js';
import { register as registerClasses } from './api/classes.js';
import { register as registerGrading } from './api/grading.js';
import { register as registerParticipant } from './api/participant.js';

initDb();
const adminSeeded = seedAdmin();
cleanupSessions();
cleanupStudentSessions();

// Demo mode (start-demo.bat): seed a handful of ready-to-use activities and
// assignments on first boot. Never enabled unless OW_DEMO_MODE=1 explicitly.
if (config.demoMode && process.env.OW_SEED_DEMO === '1') {
  try {
    const demoSeed = seedDemoContent();
    if (demoSeed.seeded) {
      log(
        `Demo mode: seeded ${demoSeed.activities} activities — join codes: ${demoSeed.codes.join(', ')}`,
      );
    } else {
      log(`Demo mode: demo content not seeded (${demoSeed.reason})`);
    }
  } catch (error) {
    logError('Demo mode: seeding failed:', error);
  }
}

const router = new Router();
registerAuth(router);
registerActivities(router);
registerAssignments(router);
registerClasses(router);
registerParticipant(router);
registerGrading(router);
registerAdmin(router);
registerAssets(router);
registerVocab(router);
registerLlm(router);

// ---------------------------------------------------------------------------
// System endpoints
// ---------------------------------------------------------------------------

router.get('/api/health', async (req, res) => {
  let dbOk = true;
  try {
    one('SELECT 1 AS ok');
  } catch {
    dbOk = false;
  }
  json(res, dbOk ? 200 : 503, {
    status: dbOk ? 'ok' : 'degraded',
    version: config.version,
    uptime: Math.floor((Date.now() - config.startedAt) / 1000),
    db: dbOk ? 'ok' : 'error',
  });
});

router.get('/api/capabilities', async (req, res) => {
  // Anonymous callers get only non-sensitive feature flags. Version, base URL
  // and the item-type list require a teacher session (the public landing page
  // must not disclose the exact attack surface).
  const user = getSessionUser(req);
  const base = {
    demoMode: config.demoMode,
    maxUploadMb: Math.round(config.maxUploadBytes / (1024 * 1024)),
    features: {
      sse: true,
      print: true,
      importExport: true,
      timeLimit: true,
      accessibility: true,
      partialCredit: true,
      classes: true,
      studentAccounts: true,
      llm: isLlmEnabled(),
    },
  };
  if (!user) {
    json(res, 200, base);
    return;
  }
  let itemTypes = [];
  try {
    const mod = await import('../shared/items/index.js');
    if (typeof mod.itemTypeMeta === 'function') itemTypes = mod.itemTypeMeta();
  } catch {
    /* shared item registry not written yet — server still boots */
  }
  json(res, 200, { ...base, version: config.version, baseUrl: config.baseUrl, itemTypes });
});

// ---------------------------------------------------------------------------
// HTML pages (client-side routed)
// ---------------------------------------------------------------------------

// JS/CSS must always revalidate so deploys show up on the next reload;
// images/fonts can stay cached briefly.
function assetCacheControl(filePath) {
  if (/\.(js|mjs|css)$/i.test(String(filePath || ''))) return 'no-cache';
  return 'public, max-age=300';
}

// ---------------------------------------------------------------------------
// Cache-busting asset version. Behind a CDN (Cloudflare) that caches JS/CSS
// for hours regardless of origin headers, the only reliable way to make a
// deploy visible immediately is a fresh URL per deploy. The auto-update
// service records the deployed commit sha in <DATA_DIR>/.deployed-sha; fall
// back to a content mtime stamp for local/dev runs.
// ---------------------------------------------------------------------------
// Read per request (short cache): the update service writes the sha *after*
// restarting the app, so a boot-time read would lag one deploy behind.
let assetVCache = { at: 0, value: '' };
function assetVersion() {
  const nowMs = Date.now();
  if (nowMs - assetVCache.at < 5000) return assetVCache.value;
  let value = '';
  try {
    const file = process.env.OW_DEPLOYED_SHA_FILE || path.join(config.dataDir, '.deployed-sha');
    const sha = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{7,40}$/i.test(sha)) value = sha.slice(0, 10);
  } catch { /* no state file */ }
  if (!value) {
    try {
      value = `t${Math.floor(fs.statSync(path.join(config.publicDir, 'app.css')).mtimeMs / 1000)}`;
    } catch {
      value = config.version.replace(/\W/g, '');
    }
  }
  assetVCache = { at: nowMs, value };
  return value;
}

/** Append ?v=<deploy version> to local asset references in served HTML/JS text. */
function versionAssetRefs(content) {
  const v = assetVersion();
  return String(content)
    .replace(/(href|src)="(\/[^"?]+\.(?:css|js))"/g, (m, attr, url) => `${attr}="${url}?v=${v}"`)
    .replace(/((?:from|import)\s*\(?\s*)(['"])(\/(?!api\/)[^'"]+\.js|\.\.?\/[^'"]+\.js)\2/g, (m, pre, q, url) => `${pre}${q}${url}?v=${v}${q}`);
}

const TEXT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

/** Serve a text asset (html/js) with versioned references and no-cache. */
function serveTextAsset(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = TEXT_TYPES[ext];
  if (!type) return false;
  let body;
  try {
    body = Buffer.from(versionAssetRefs(fs.readFileSync(filePath, 'utf8')), 'utf8');
  } catch {
    return false;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function pageHandler(file) {
  return async (req, res, params, url) => {
    const pathname = url?.pathname || req.url || '/';
    // SPA fallback must not swallow real assets like /teacher/app.js or
    // /teacher/teacher.css — anything with a file extension is served as static.
    if (pathname.startsWith('/teacher/') && /\.[a-z0-9]{1,8}$/i.test(pathname)) {
      const assetPath = safeJoin(config.publicDir, pathname);
      if (assetPath && /\.(js|mjs)$/i.test(pathname) && serveTextAsset(req, res, assetPath)) return;
      if (assetPath && (await serveFile(req, res, assetPath, { cacheControl: assetCacheControl(pathname) }))) return;
      throw new HttpError(404, 'not_found', 'Not found');
    }
    const pageFile = path.join(config.publicDir, file);
    if (!serveTextAsset(req, res, pageFile)) {
      const ok = await serveFile(req, res, pageFile, { cacheControl: 'no-cache' });
      if (!ok) renderErrorPage(res, 404, 'not_found', 'Page not found');
    }
  };
}

router.get('/', pageHandler('index.html'));
router.get('/login', pageHandler('login.html'));
router.get('/teacher', pageHandler('teacher/index.html'));
router.get('/teacher/*', pageHandler('teacher/index.html'));
router.get('/a/:code', pageHandler('student.html'));
router.get('/c/:code', pageHandler('student.html'));

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function renderErrorPage(res, status, code, message) {
  const escape = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} — OpenWidgets</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main class="error-page">
  <div class="card">
    <h1>${status}</h1>
    <p>${escape(message)}</p>
    <p class="small muted">${escape(code)}</p>
    <p><a class="btn btn-primary" href="/">Zur Startseite</a></p>
  </div>
</main>
</body>
</html>`;
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function handleError(req, res, err, pathname) {
  if (res.headersSent || res.writableEnded) {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
    return;
  }
  const isHttp = err instanceof HttpError;
  const status = isHttp ? err.status : 500;
  const code = isHttp ? err.code : 'internal_error';
  const message = isHttp ? err.message : 'Internal server error';
  if (status >= 500) logError(`${req.method} ${pathname}`, err);
  const wantsHtml = !pathname.startsWith('/api/') && String(req.headers.accept || '').includes('text/html');
  if (wantsHtml && (req.method === 'GET' || req.method === 'HEAD')) {
    renderErrorPage(res, status, code, message);
    return;
  }
  json(res, status, {
    error: {
      code,
      message,
      ...(isHttp && err.details ? { details: err.details } : {}),
    },
  });
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
    securityHeaders(res, { embed: pathname.startsWith('/a/') });

    const hit = router.match(req.method || 'GET', pathname);
    if (hit) {
      await hit.handler(req, res, hit.params, url);
      return;
    }

    if (pathname.startsWith('/api/')) {
      throw new HttpError(404, 'not_found', 'Unknown API endpoint');
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      let filePath = null;
      if (pathname === '/shared' || pathname.startsWith('/shared/')) {
        filePath = safeJoin(config.sharedDir, pathname.slice('/shared'.length) || '/');
      } else {
        filePath = safeJoin(config.publicDir, pathname);
      }
      if (filePath) {
        if (/\.(html|js|mjs)$/i.test(filePath) && serveTextAsset(req, res, filePath)) return;
        const served = await serveFile(req, res, filePath, {
          cacheControl: assetCacheControl(filePath),
        });
        if (served) return;
      }
    }

    throw new HttpError(404, 'not_found', 'Not found');
  } catch (err) {
    handleError(req, res, err, pathname);
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

startHeartbeat();

server.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log(`OpenWidgets ${config.version} listening on http://${shownHost}:${config.port}`);
  log(`Data directory: ${config.dataDir}`);
  if (!adminSeeded) {
    const users = one('SELECT COUNT(*) AS c FROM users');
    if (users && users.c === 0) {
      log('No accounts yet — see README "First login" for creating the admin user.');
    }
  }
});

server.on('error', (err) => {
  logError('Server failed:', err);
  process.exitCode = 1;
});

function shutdown(signal) {
  log(`${signal} received — shutting down`);
  closeAll();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { server, router };
