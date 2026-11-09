# OpenWidgets — Engineering Contract v0.1

This is the binding contract for everyone writing code in this repository. If reality disagrees with this document, fix the document or stop and message the Lead — do not silently diverge.

## 0. Non-negotiables

1. **Zero runtime npm dependencies.** Only Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:url`, `node:zlib`, `node:stream`). No framework, no bundler, no build step. Dev-only deps are allowed **only** under `tools/e2e/package.json`.
2. **Node ≥ 22.5** (we run Node 24). `"type": "module"`, ES modules everywhere, including in the browser (native ESM, served as-is).
3. **Single process, single-origin.** The Node server serves `/api/*`, `/assets/*`, and static files from `public/`. The browser loads JS with native `<script type="module">`. No transpilation.
4. **CSP is enforced** (`script-src 'self'`): no inline `<script>`, no inline event handlers (`onclick=...`), no `eval`. All event wiring in JS files. Inline `style="..."` attributes are allowed (`style-src 'unsafe-inline'`), but prefer CSS classes.
5. **No untrusted HTML injection.** Never assign user/teacher/student text via `innerHTML`. Use `textContent`, or the allowlisted rich-text helper `renderRichText()` in `public/lib/dom.js` (plain text + markdown-lite only). Teacher-authored content is untrusted input.
6. **German-first UI, English second.** Every user-visible string goes through `t()` from `public/lib/i18n.js` with keys `en`/`de`. Default locale `de`.
7. **School instance, not multi-tenant SaaS.** One organization per deployment. No org tables. No cross-school isolation logic.
8. **Server-authoritative grading, answer stripping.** The activity JSON sent to students must contain **no answer keys** (`sanitizeItem()`). Auto-grading happens only on the server; the client receives only `{correct, autoScore, maxScore, needsManual}` per response. The shared scoring modules still run in the browser for the teacher's live preview/authoring validation only.
9. **No secrets in the repo.** Env vars only (see §2).
10. **Accessibility baseline:** every interactive element keyboard-reachable, visible focus rings, `aria-label`/`aria-live` where dynamic, no drag-only interactions (always provide buttons/selects as alternative). WCAG 2.1 AA is the target; do not overclaim 2.2 AA.

Product name: **OpenWidgets** (UI may show "OpenWidgets — selbst gehostet"). License: AGPL-3.0-or-later.

## 1. Repository map and file ownership

```
package.json                      Lead
server/
  config.js                       Lead
  db.js                           Lead  (schema + tiny query helpers)
  index.js                        Lead  (bootstrap, static pages, route mounting)
  lib/http.js                     Lead  (Router, JSON/cookie/file helpers, HttpError)
  lib/auth.js                     Lead  (scrypt, sessions, requireUser/requireAdmin)
  lib/events.js                   Lead  (SSE hub + in-memory presence)
  api/auth.js                     Lead  (login/logout/me)
  api/activities.js               server-dev
  api/assignments.js              server-dev
  api/participant.js              server-dev  (student join/save/submit/heartbeat/flags/result)
  api/grading.js                  server-dev  (teacher review, manual scores, force submit/reset, CSV)
  api/admin.js                    server-dev  (users, stats)
  api/assets.js                   server-dev  (upload/serve/delete)
shared/
  util.js                         server-dev  (normalization, seeded shuffle, number parsing)
  activity.js                     server-dev  (validateActivity, sanitizeActivity)
  items/index.js                  server-dev  (registry: getType, itemTypes, createItem, scoreItem)
  items/<type>.js                 server-dev  (one file per type, 9 types)
public/
  index.html, login.html, login.js Lead
  app.css                         Lead   (design tokens + shared components)
  lib/api.js, dom.js, i18n.js, icons.js, qr.js?  Lead
  render/index.js, render/render.css, render/<type>.js   client-dev
  student.html, student.js, student.css                   client-dev
  teacher/index.html, teacher/app.js, teacher/views/*.js, teacher/teacher.css   authoring-dev
test/
  *.test.js                       server-dev (shared/API tests); Lead adds smoke/e2e-adjacent tests
scripts/
  create-admin.mjs, backup.mjs, restore.mjs   Lead
tools/e2e/                        QA (separate package.json + Playwright)
deploy/                           research-critic (do not touch)
docs/                             research-critic (CRITICAL-EVALUATION.md, DEPLOY-LXC.md); Lead (CONTRACT.md, USER-RESEARCH.md)
```

**One file, one owner.** If you need a change in someone else's file: message the Lead, do not edit. Pages include shared assets: `/app.css`, `/render/render.css`, then their own CSS.

## 2. Runtime, config, commands

Start: `node server/index.js` (no args). Static UI served by the same process.

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `<repo>/data` | SQLite DB + uploaded assets. In prod: `/var/lib/openwidgets` |
| `ADMIN_EMAIL` | — | Seeds first admin **on first boot only** (if no users exist) |
| `ADMIN_PASSWORD` | — | Password for seeded admin (min 10 chars) |
| `ADMIN_NAME` | `Administrator` | Display name for seeded admin |
| `BASE_URL` | inferred | Public base URL used for share links, e.g. `https://widgets.school.local` |
| `TRUST_PROXY` | `0` | `1` when behind Caddy/nginx (uses `X-Forwarded-*`) |
| `SESSION_TTL_DAYS` | `14` | Teacher session lifetime (sliding) |
| `MAX_UPLOAD_MB` | `10` | Per-asset upload limit |
| `NODE_ENV` | `development` | `production` disables verbose logging |

Data layout: `${DATA_DIR}/openwidgets.db` (+ `-wal`, `-shm`), `${DATA_DIR}/assets/<assetId>`.

Commands: `npm start`, `npm test` (`node --test test/`), `npm run admin:create -- --email x --name y --password z`, `npm run backup -- --out <dir>`, `npm run restore -- --from <path>`. There is no `npm install` for runtime.

## 3. Data model (canonical: `server/db.js`)

IDs are UUID v4 strings (`crypto.randomUUID()`). Timestamps are ISO-8601 UTC strings (`new Date().toISOString()`). JSON columns are TEXT containing JSON.

- `users(id, email UNIQUE NOCASE, name, role 'admin'|'teacher', password_hash, locale, disabled, created_at, last_login_at)`
- `sessions(token_hash PK, user_id, created_at, expires_at, ip, user_agent)`
- `activities(id, owner_id, title, description, template 'quiz'|'worksheet', locale, definition TEXT JSON, status 'draft'|'published', revision INT, created_at, updated_at)`
- `assignments(id, activity_id, owner_id, code UNIQUE, title, settings TEXT JSON snapshot, status 'open'|'closed', due_at, created_at)`
- `participants(id, assignment_id, name, token_hash UNIQUE, status 'in_progress'|'submitted'|'graded', started_at, submitted_at, last_seen_at, score, max_score, flags TEXT JSON (starred item ids), ip, user_agent)`
- `responses(id, participant_id, item_id, response TEXT JSON, auto_score REAL, max_score REAL, correct INT, needs_manual INT, feedback TEXT, manual_score REAL, updated_at, UNIQUE(participant_id,item_id))`
- `events(id INTEGER PK AUTOINCREMENT, assignment_id, participant_id, kind, payload TEXT JSON, created_at)`
- `assets(id, owner_id, filename, mime, size, sha256, created_at)`
- `settings(key PK, value)`

Query helpers exported by `server/db.js`: `db`, `one(sql, ...params)`, `all(sql, ...params)`, `run(sql, ...params)`, `uid()`, `now()`, `tx(fn)`. Always use prepared statements via these helpers (no string interpolation of values).

**Response marking model:** each response keeps the original `response` JSON, the server-computed `auto_score`/`max_score`, `needs_manual`, and (after teacher grading) `manual_score` + `feedback`. Effective score for an item = `manual_score ?? auto_score`. Participant total = sum of effective item scores (recomputed on every change). `max_score` total = sum of item points for all items.

## 4. Activity definition (declarative JSON, versioned)

Stored in `activities.definition`. Validated by `shared/activity.js` on save; sanitized for students by `sanitizeActivity()`.

```jsonc
{
  "v": 1,
  "template": "worksheet",            // "worksheet" (single scroll) | "quiz" (one item per screen)
  "title": "Plattentektonik",
  "description": "",
  "locale": "de",
  "settings": {
    "instantFeedback": true,          // show correct/incorrect after each saved response
    "shuffleItems": false,
    "showResults": true,              // student sees score after submit
    "allowReview": true,              // student may reopen submitted work read-only
    "showAnswers": false,             // reveal expected answers after submit (only if allowReview)
    "warnUnanswered": true,           // confirmation dialog before submit
    "timeLimitMinutes": null,         // null = unlimited
    "requireName": true,
    "accessibility": { "tts": true, "starQuestions": true, "fontScale": true }
  },
  "items": [
    {
      "id": "it_ab12cd",              // unique within activity, opaque, NEVER reused when duplicating items
      "type": "multiple_choice",      // one of §4.1
      "points": 2,                    // number >= 0; 0 only for "text"
      "stem": "Welche Aussage ist richtig?",   // plain text, may contain markdown-lite
      "help": "",                     // optional hint shown under stem
      "media": { "type": "none" },    // {"type":"image","assetId":"...","alt":"..."} or {"type":"audio","assetId":"..."} or {"type":"video","url":"https://..."}
      "config": { },                  // see §4.1; MUST NOT contain custom HTML
      "feedback": { "correct": "", "incorrect": "" }   // optional post-answer messages (plain text)
    }
  ]
}
```

Assignment delivery: `POST /api/activities/:id/publish` copies the activity `settings` into `assignments.settings` (snapshot) and generates `code` (6 chars, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, stored uppercase; lookup case-insensitive). Later edits to the activity do **not** mutate a live assignment's settings, but the definition is read through the activity (document this: republishing is a new assignment).

### 4.1 Item types (v0.1)

`meta.label` is `{en, de}`. `editSchema` is the declarative authoring form. Score = number 0..item.points. All scorers are pure and deterministic.

| type | scoreable | meta.label (de) | config |
| --- | --- | --- | --- |
| `text` | no | Textblock | `{ "text": "..." }` |
| `multiple_choice` | yes | Multiple Choice | `{ "multi": false, "choices": [{"id":"c1","text":"...","correct":true}], "shuffle": false, "partialCredit": true }` |
| `short_answer` | yes | Kurze Antwort | `{ "accepted": ["antwort", "..."], "caseSensitive": false, "trim": true, "collapseSpaces": true, "ignorePunctuation": true }` |
| `numeric` | yes | Numerische Antwort | `{ "answer": 3.5, "tolerance": 0.01, "toleranceType": "absolute" \| "percent" }` |
| `fill_blanks` | yes | Lückentext | `{ "text": "Platten gleiten an {{1}} Grenzen. {{2}} ...", "blanks": { "1": { "accepted": ["transform"] }, "2": { "accepted": ["divergent"] } }, "caseSensitive": false }` |
| `match` | yes | Zuordnen | `{ "pairs": [{"id":"p1","left":"...","right":"..."}], "shuffle": true }` |
| `ordering` | yes | Reihenfolge | `{ "items": [{"id":"i1","text":"..."}], "mode": "positions" \| "exact" }` |
| `pins` | yes | Bild markieren | `{ "image": {"assetId": "...", "alt": ""}, "zones": [{"id":"z1","label":"Transform-Rand","x":0.32,"y":0.44,"r":0.05}] }` |
| `long_answer` | yes (manual) | Freitext | `{ "hints": [{"text":"photosynthese","alternatives":[],"points":1}], "rubric": [{"criterion":"Fachliche Richtigkeit","levels":[{"label":"...","points":0}]}], "minWords": 0, "maxWords": 3000 }` |

**Canonical responses** (what the client sends, stored as-is after `normalizeResponse`):

| type | response |
| --- | --- |
| `text` | `{}` |
| `multiple_choice` | `{ "selected": ["c2"] }` (array; single choice ⇒ length ≤ 1) |
| `short_answer` | `{ "text": "..." }` |
| `numeric` | `{ "value": "3,5" }` (raw string; parsed server-side, localized comma/dot accepted) |
| `fill_blanks` | `{ "blanks": { "1": "transform", "2": "" } }` |
| `match` | `{ "matches": { "p1": "p3", "p2": "p1" } }` (leftPairId → rightPairId; right side shown shuffled) |
| `ordering` | `{ "order": ["i3", "i1", "i2"] }` (all item ids) |
| `pins` | `{ "points": { "z1": {"x": 0.31, "y": 0.42} } }` (normalized 0..1 coordinates) |
| `long_answer` | `{ "text": "..." }` |

**Scoring semantics per type:**

- `multiple_choice`: single → full points iff selected id is the unique correct choice. Multi: `partialCredit` true → `clamp((correctSelected - wrongSelected) / correctCount, 0, 1) * points`; false → points only for exact set match. `correct` = full credit. `detail = {selected, correctIds, missingIds, wrongIds}` (teacher-only; NEVER sent to students).
- `short_answer`: normalize (trim / collapse spaces / optional lowercase / optional punctuation stripping) both response and each accepted value; full points on first match. `detail = {normalized}`.
- `numeric`: parse localized number (`"1.234,5"`→1234.5, `"3,5"`→3.5, `"4.2e3"`, strip currency symbols/spaces/unit letters). Full points iff `|given-answer| <= tolerance` (percent: `|answer|*tolerance/100`). Unparseable/empty ⇒ 0.
- `fill_blanks`: per-blank equal weight; blank correct iff normalized response equals one of `accepted` (normalization: trim, collapse spaces, case-insensitive unless `caseSensitive`). Unfilled/missing blank ⇒ wrong. `autoScore = round(points * correct/total, 4)`. `correct` = all blanks.
- `match`: per-pair equal weight; correct iff `matches[leftId] === leftId`'s own pair id (a pair pairs with itself). Missing/wrong ⇒ 0 for that pair. `correct` = all pairs.
- `ordering`: `mode:"positions"` → `points * (correctPositions/total)`, all positions correct ⇒ full; `mode:"exact"` → full only or 0. `correct` = full. `detail = {correctPositions, total}`.
- `pins`: each zone's point correct iff Euclidean distance in normalized coordinates `<= r` (compare on `x`,`y` in 0..1). `points * correct/total`. `correct` = all zones. `detail = {hit:[ids],miss:[ids]}`.
- `long_answer`: `autoScore = min(points, sum(hint.points for matched hints))`, matching is case-insensitive substring of the student text (including `alternatives`); `needsManual = true` **always** (rubric/teacher decision); `correct = false` until a teacher sets a manual score ≥ points. Hints and rubric never reach the student.

**`shared/items/<type>.js` exports** (all pure, importable from browser and Node):

```js
export const type = 'multiple_choice';
export const meta = { label: { en: 'Multiple choice', de: 'Multiple Choice' }, scoreable: true, category: 'assessment' };
export function defaultConfig() {}                     // fresh config object
export function defaultPoints() {}                     // number
export function createItem({ id, points } = {}) {}     // full item object with defaults
export function normalizeItem(item) {}                 // fill missing fields, stable ids; returns new item
export function validateItem(item) {}                  // returns string[] of errors ([] = ok)
export function normalizeResponse(item, raw) {}        // canonical response; may throw new Error(msg)
export function score(item, response) {}               // { autoScore, maxScore, correct, needsManual, correctParts, totalParts, detail }
export function sanitizeItem(item) {}                  // student-safe copy: no answers/hints/rubric/feedback-to-answers
export function summarizeResponse(item, response) {}   // short human string for teacher tables (e.g. "A, C")
export function editSchema() {}                        // [{ key, kind:'text'|'textarea'|'number'|'switch'|'select'|'list', label:{en,de}, help?, options?, itemSchema?, min?, max? }]
```

`shared/items/index.js` exports: `itemTypes` (array of type modules), `getType(type)`, `itemTypeMeta()` (for palette), `createItem(type, opts)`, `normalizeItem`, `validateItem`, `scoreItem(item, response)` (handles unknown type ⇒ `{autoScore:0, ...}`), `sanitizeItem`, `summarizeResponse`. Items with `type:"text"` normalize/score trivially; `scoreItem` for unknown type must not throw.

**`shared/activity.js` exports:** `createDefinition({template, locale, title})`, `validateActivity(definition)` ⇒ `{ok:boolean, errors:[{path, message}]}`, `sanitizeActivity(definition)` (per-item sanitize), `activityStats(definition)` ⇒ `{itemCount, scoreableCount, maxScore}`, `emptyDefinition()`.

**`shared/util.js` exports:** `normalizeText(s, {caseSensitive, trim, collapseSpaces, ignorePunctuation})`, `parseLocalizedNumber(s)`, `deepClone(v)`, `seededShuffle(array, seed)`, `hashString(s)` (32-bit FNV-1a), `clamp(n,min,max)`, `eqScore(a,b)` (epsilon 1e-9), `shortId(prefix)`.

## 5. Server API

Base path `/api`. JSON in/out (`Content-Type: application/json`), UTF-8. Errors are `{"error":{"code":"snake_case","message":"human readable (already localized by client? no — English fine)"}}` with matching HTTP status. Common codes: `unauthorized` 401, `forbidden` 403, `not_found` 404, `invalid_request` 400, `validation_failed` 400 (with `details:[{path,message}]`), `conflict` 409, `rate_limited` 429, `payload_too_large` 413.

**Auth**: teacher endpoints require the `ow_session` cookie (HttpOnly, SameSite=Lax, Secure when HTTPS, Path=/). Session token = 32 random bytes base64url; DB stores SHA-256. Sliding expiry. Every state-changing request must be same-origin (Origin/Referer check server-side).

**Student auth**: header `X-Participant-Token: <opaque token>` (raw token from join; DB stores SHA-256). 401 `invalid_participant_token` otherwise. Student endpoints never leak answer keys or other participants' data.

### 5.1 Auth (Lead)
| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | `{email,password}` | `{user}` + cookie; 401 `invalid_credentials`; 429 after 10 fails/15min per IP |
| POST | `/api/auth/logout` | — | 204 |
| GET | `/api/me` | — | `{user}` or 401 |
| PATCH | `/api/me` | `{name?, locale?, currentPassword?, password?}` | `{user}` |

`user` = `{id, email, name, role, locale, createdAt, lastLoginAt}` (never password_hash).

### 5.2 Activities (server-dev)
| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/activities` | — | `{activities:[{id,title,description,template,locale,status,revision,itemCount,maxScore,updatedAt,createdAt,assignmentCount}]}` (own only; admins see all) |
| POST | `/api/activities` | `{title?, template?, locale?}` | `{activity}` (full, revision 1, draft) |
| GET | `/api/activities/:id` | — | `{activity:{...,definition}}` |
| PUT | `/api/activities/:id` | `{title, description, template, locale, definition, revision}` | `{activity}`; 409 `revision_conflict` if `revision` stale; 400 `validation_failed` with `details` |
| DELETE | `/api/activities/:id` | `?force=1` | 204; 409 `has_assignments` unless `force=1` |
| POST | `/api/activities/:id/duplicate` | — | `{activity}` (title + " (Kopie)", new item ids, revision 1) |
| GET | `/api/activities/:id/export` | — | `application/json` attachment `openwidgets-<slug>.json`, envelope `{format:"openwidgets.activity",formatVersion:1,exportedAt,activity:{title,description,template,locale,settings,items}}` |
| POST | `/api/activities/import` | export envelope or bare activity | `{activity}` (validated; missing ids regenerated) |

### 5.3 Assignments & live (server-dev)
| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| POST | `/api/activities/:id/publish` | `{title?, dueAt?}` | `{assignment}`; 400 `activity_invalid` if definition invalid |
| GET | `/api/assignments` | — | `{assignments:[{id,title,code,status,activityId,activityTitle,template,participantCount,createdAt,dueAt,maxScore}]}` |
| GET | `/api/assignments/:id` | — | `{assignment:{...,activity:{id,title,definition,sanitized? no — raw for teacher},settings,itemOrder}}` |
| PATCH | `/api/assignments/:id` | `{status?, title?, dueAt?}` | `{assignment}` |
| DELETE | `/api/assignments/:id` | — | 204 (cascade participants/responses/events) |
| GET | `/api/assignments/:id/live` | — | `{assignment:{id,title,code,status}, items:[{id,type,points,label}], players:[{id,name,status,score,maxScore,lastSeenAt,online,items:{[itemId]:state},flags:[itemId],submittedAt}]}`; `state` ∈ `unanswered|correct|partial|incorrect|manual`; `online` = seen ≤ 35 s ago |
| GET | `/api/assignments/:id/stream` | SSE, teacher cookie | see §5.6 |
| GET | `/api/assignments/:id/results` | — | `{assignment, items, players:[{...live player fields, responses:[{itemId,response,autoScore,maxScore,manualScore,needsManual,correct,feedback,updatedAt}]}]}` (teacher review; include raw responses) |
| GET | `/api/assignments/:id/export.csv` | — | CSV (`text/csv; charset=utf-8`, BOM for Excel): participant, status, score, max_score, started_at, submitted_at, then per item `item_<index>` score + `item_<index>_state`; columns ordered by item order |

### 5.4 Participants / student (server-dev)
| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/join/:code` | — | `{assignment:{code,title,template,locale,status,requireName}, activity:{title,description}}`; 404 `invalid_code` |
| POST | `/api/join` | `{code, name}` | `{participantToken, participant:{id,name}, assignment:{code,title,template,locale,settings}, activity:{title,description,settings,items:[sanitized items]}, responses:[], flags:[]}`; errors: `invalid_code`, `assignment_closed`, `name_required` |
| GET | `/api/participant` | token header | `{participant:{id,name,status,score,maxScore,startedAt,submittedAt}, assignment:{...}, activity:{sanitized}, responses:[{itemId,response,result:{correct,autoScore,maxScore,needsManual}}], flags:[]}` |
| PUT | `/api/participant/responses/:itemId` | `{response}` | `{saved:true, result:{correct,autoScore,maxScore,needsManual}, score, maxScore}`; 409 `attempt_submitted` / `time_expired` (server auto-submits on deadline); 400 `invalid_response` |
| POST | `/api/participant/heartbeat` | — | `{ok:true}`; updates `last_seen_at`; publishes SSE presence at most every 15 s per participant |
| POST | `/api/participant/flags` | `{flags:[itemId...]}` | `{flags}`; publishes SSE `flags` event |
| POST | `/api/participant/submit` | `{confirm:true}` | `{participant:{status,score,maxScore}, result:{showResults,showAnswers,items:[{itemId,correct,autoScore,maxScore,needsManual,response?,answer?}]}}`; 409 if already submitted |
| GET | `/api/participant/result` | token header | same result payload; 403 `not_submitted` before submit |

Time limit: `started_at + timeLimitMinutes`; a 60 s grace applies on save. Past grace: mark submitted server-side, return 409 `time_expired` (client shows result if `showResults`).

### 5.5 Grading & admin (server-dev)
| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/participants/:id/review` | — | `{participant, assignment, activity:{raw definition}, responses:[...]}` (teacher) |
| PATCH | `/api/participants/:id/responses/:itemId` | `{manualScore?, feedback?}` | `{response, participantTotals:{score,maxScore}}`; `manualScore` null clears manual override |
| POST | `/api/participants/:id/submit` | — | force submit (teacher) |
| POST | `/api/participants/:id/reset` | — | clears responses + sets `in_progress` (teacher; confirm in UI) |
| DELETE | `/api/participants/:id` | — | 204 |
| GET | `/api/admin/users` | — | `{users:[...]}` (admin) |
| POST | `/api/admin/users` | `{email,name,role,password}` | `{user}` |
| PATCH | `/api/admin/users/:id` | `{name?,role?,disabled?,password?}` | `{user}` |
| DELETE | `/api/admin/users/:id` | — | 204; cannot delete self or last admin |
| GET | `/api/admin/stats` | — | `{users,activities,assignments,participants,assets,dbBytes,assetsBytes,version}` |
| POST | `/api/assets?filename=<name>` | raw bytes, `Content-Type` allowlist | `{asset:{id,url,filename,mime,size}}`; 400 `unsupported_type`; 413 too large |
| GET | `/assets/:id/:filename` | — | bytes; `Cache-Control: public, max-age=31536000, immutable`; `Content-Disposition: inline` |
| DELETE | `/api/assets/:id` | — | 204 (owner/admin; 409 if referenced? not enforced in v0.1 — warn) |

Asset allowlist: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/wav`, `audio/webm`. **No SVG** (XSS). Filenames sanitized to `[A-Za-z0-9._-]`; stored filename is the asset id; original name kept in DB.

### 5.6 SSE (teacher live dashboard)

`GET /api/assignments/:id/stream` — teacher cookie. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Every message: `data: <json>\n\n` (no named events), JSON has `type`. Keepalive comment `:ping\n\n` every 25 s. Client must reconnect with `EventSource` (auto).

| type | payload |
| --- | --- |
| `snapshot` | `{type, at, items:[{id,index,points,label}], players:[...live player...]}` sent once on connect |
| `participant` | `{type, action:"joined"\|"updated"\|"presence"\|"submitted"\|"reset"\|"flags", participant:{...live player...}}` |
| `response` | `{type, participantId, itemId, state, autoScore, maxScore, needsManual, score, maxScoreTotal}` |
| `assignment` | `{type, action:"closed"\|"opened"\|"deleted"}` |
| `ping` | `{type, t}` |

Live-player shape (single source of truth, used by `/live`, SSE and results):
`{id, name, status, score, maxScore, lastSeenAt, online, items:{ [itemId]: "unanswered"|"correct"|"partial"|"incorrect"|"manual" }, flags:[itemId], submittedAt}`.
`state` derivation: no response ⇒ `unanswered`; `needs_manual` ⇒ `manual`; `auto_score >= max_score-ε` ⇒ `correct`; `<= ε` ⇒ `incorrect`; else `partial`.

### 5.7 System (Lead)
- `GET /api/health` → `{status:"ok", version, uptime, db:"ok"}` 200; 503 if DB probe fails.
- `GET /api/capabilities` → `{version, itemTypes:[{type,label,scoreable}], features:{sse:true,print:true,importExport:true,timeLimit:true}, maxUploadMb}`.
- `GET /` → `public/index.html`; `GET /login` → `public/login.html`; `GET /teacher`, `/teacher/*` → `public/teacher/index.html`; `GET /a/:code` → `public/student.html`. Unknown non-API paths: static file from `public/`, else 404 page (`/404.html` if present).

## 6. Client architecture

Page loaders:
- `/` (`public/index.html`): landing, teacher login link, student code entry → `/a/<CODE>`.
- `/login` (`public/login.html` + `login.js`): teacher login form.
- `/teacher/...` (`public/teacher/index.html` + `teacher/app.js`): teacher SPA (hash-free path routing via `location.pathname`).
  Views: `#/dashboard` (own activities + assignments), `#/edit?id=`, `#/assignment?id=`, `#/grade?assignment=&participant=`, `#/admin`, `#/print?activity=` | `#/print?assignment=&participant=`. Use `history.pushState` + path prefix `/teacher/...`; server serves index.html for all `/teacher/*`.
- `/a/:code` (`public/student.html` + `student.js`): join (name form), player, submit, result/review. Reads code from `location.pathname`.

Shared browser libs (Lead owns, do not edit):
- `public/lib/api.js` — `api(path, {method, body, headers})` throws `ApiError {status, code, message, details}`; helpers `get/post/put/patch/del`, participant token store (`getParticipantToken(code)`, `setParticipantToken(code, token)`), `apiUrl()`.
- `public/lib/dom.js` — `h(tag, props, ...children)` (supports `"div.card#id"` selector syntax, `{class,dataset,style,on:{click:fn}}`), `qs/qsa`, `debounce`, `escapeHtml`, `renderRichText(container, text)` (markdown-lite: `**b**`, `*i*`, line breaks, `- ` lists), `toast(msg, kind?)`, `confirmDialog({title,message,confirmLabel,danger})`, `modal({title, body, actions})`, `fmtDate`, `fmtTime`, `fmtDuration`, `fmtScore(n)`, `loading(el)`/`emptyState(...)`. All user text via `textContent`.
- `public/lib/i18n.js` — `registerMessages({en:{},de:{}})`, `t(key, vars?)` with `{name}` interpolation, `getLocale()`, `setLocale(locale)` (persists `ow_locale`, applies `[data-i18n]` and `[data-i18n-placeholder]`), `applyI18n(root?)`, `onLocaleChange(fn)`. Keys namespaced: `common.*`, `landing.*`, `login.*`, `student.*`, `teacher.*`, `item.<type>.*`, `errors.*`.
- `public/lib/icons.js` — `icon(name, {size})` ⇒ inline SVG string (names: plus, edit, trash, copy, link, play, users, chart, check, x, clock, download, upload, printer, arrow-left, arrow-right, chevron-down, search, settings, logout, eye, eye-off, refresh, star, warning, info, book, clipboard, image, flag, preview, external, sparkle). Use in trusted templates only.
- `public/app.css` — design tokens (`--bg --surface --surface-2 --text --text-muted --border --primary --success --danger --warning --radius ...`), buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-icon`), `.card`, `.field`/`.input`/`.textarea`/`.select`/`.switch`, `.badge`, `.table`, `.tabs`/`.tab`, `.toolbar`, `.empty`, `.spinner`, `.toast`, `.modal`, `.segmented`, `.chip`, `.progress`, layout utilities (`.row .col .wrap .gap-1..4 .mt-* .mb-* .muted .small .sr-only`), focus-visible outlines, print baseline (`@media print` hides `.no-print`), responsive breakpoints. Dark mode via `[data-theme=dark]` tokens is optional; keep light-first.

**Renderer contract** (`public/render/`), owned by client-dev:

```js
// public/render/<type>.js
export const type = 'multiple_choice';
export const label = { en: 'Multiple choice', de: 'Multiple Choice' };
export function mount(container, ctx) {
  // ctx = { item, response, mode: 'student'|'preview'|'review', locale, seed, disabled, showAnswers }
  // container is a DOM element owned by the caller; clear it and render.
  return {
    getResponse(),        // canonical response object (§4.1)
    setResponse(response),
    setResult(result),    // {correct, autoScore, maxScore, needsManual} | null → visual feedback state
    focus(),
    destroy(),
  };
}
```
`public/render/index.js` exports `renderers` (Map), `getRenderer(type)`, `mountItem(container, ctx)` (unknown type ⇒ renders a fallback notice), `renderItemStatic(container, ctx)` alias. `public/render/render.css` holds item styles. Renderers must use `textContent` for any dynamic/message text; `icon()`/trusted static markup via `innerHTML` is fine. Renderers must work without answer keys (student) — all interactive data is in the sanitized config (e.g. matching shows right-hand options; ordering shuffles items via `seededShuffle(items, ctx.seed)`).

Uploads in authoring (pins image): `POST /api/assets?filename=...` raw body via `fetch` with `Content-Type` of the file. Never send base64 in JSON.

## 7. Security rules (must hold)

- Passwords: `scrypt` (N=16384,r=8,p=1), per-user salt, `timingSafeEqual`. Constant-time errors (`invalid_credentials` for unknown user or wrong password).
- Session cookies: `HttpOnly; SameSite=Lax; Path=/; Max-Age`. Set `Secure` when request is HTTPS (`X-Forwarded-Proto`).
- All teacher/asset endpoints require auth; every teacher resource checks ownership (`owner_id = user.id`) unless `role='admin'`. **Never trust IDs from the client for ownership.**
- State-changing requests: verify `Origin` (or `Referer`) host equals request host when present → else 403 `bad_origin`.
- Student token: per-assignment random 24-byte token; only SHA-256 stored; comparisons via `timingSafeEqual`.
- Rate-limit login (in-memory) and asset uploads (per user, 60/min).
- No directory traversal in static/asset serving (resolve + prefix check).
- The student payload omits: all answer keys, `long_answer.hints`, `long_answer.rubric`, `pins.zones[].r`, per-answer `feedback`, and teacher-only data. `sanitizeActivity()` is the only place that strips; do not hand-roll elsewhere.

## 8. Testing & definition of done

- Run: `npm test` (no deps). Server tests start the server on an ephemeral port with `DATA_DIR` pointing to a temp dir.
- Each shared item module: unit tests for scoring edge cases (empty, partial, localized numbers, shuffle independence).
- API tests: auth flow, activity create/update/validate/export/import, publish → join → save → submit → results, answer-stripping assertion (`JSON.stringify(studentPayload)` must not contain `"correct":true`/accepted answers), SSE smoke (connect, receive snapshot), CSV headers.
- Definition of done for each builder: `npm test` green; the app boots with `node server/index.js`; your pages work in a browser at `http://localhost:3000`; no console errors; all visible strings localized DE/EN; keyboard usable.
- QA (e2e, Playwright) runs after integration and must pass: teacher login → create activity → add items → publish → student join in second context → answer → submit → results visible → live dashboard updates → CSV export downloads.

## 9. Conventions & gotchas

- Indent 2 spaces; semicolons; single quotes in JS; German strings use proper umlauts (UTF-8, no escaping).
- Dates: store ISO strings; format client-side with `Intl` in `Europe/Vienna`.
- Numbers: scores are floats; compare with `eqScore`; round only for display (`fmtScore` → 2 decimals max).
- Activity `revision`: increment on each PUT; client editor sends last known revision; 409 → reload + toast ("Andere Person hat bearbeitet").
- Item ids: `it_` + 6 base36 chars. Pair/item ids inside configs: stable opaque ids (`c1`,`p1`,`i1` are fine but must be unique within item). On duplicate activity, regenerate all ids.
- Codes: uppercase 6 chars, no `I/O/0/1`.
- SSE: one connection per assignment dashboard; close on navigation; server cleans up on `req.close`.
- Never log passwords/tokens. Log errors with request id only when `NODE_ENV !== 'test'`.
- If a route is not listed in this contract, ask the Lead before adding it — the client pages already assume the listed shapes.
- When you finish your area: run `npm test`, boot the server, hit your pages, then report to the Lead with (a) files, (b) what works, (c) known gaps/risks.
