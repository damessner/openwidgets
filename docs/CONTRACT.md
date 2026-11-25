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
- `participants(id, assignment_id, class_participant_id NULL, name, token_hash UNIQUE, status 'in_progress'|'submitted'|'graded', started_at, submitted_at, last_seen_at, score, max_score, flags TEXT JSON (starred item ids), ip, user_agent)` — `class_participant_id` (schema v2) links a participant to a class participant when joined via a class bundle
- `classes(id, owner_id, code UNIQUE NULL, name, description, order_mode 'free'|'sequence', unlock_min_percent REAL 0–100, status 'draft'|'published', created_at, updated_at)` (schema v2; `code` is set on publish)
- `class_items(id, class_id, assignment_id, position INT, UNIQUE(class_id,assignment_id), UNIQUE(class_id,position))`
- `class_participants(id, class_id, name, token_hash UNIQUE, created_at, last_seen_at)`
- `responses(id, participant_id, item_id, response TEXT JSON, auto_score REAL, max_score REAL, correct INT, needs_manual INT, feedback TEXT, manual_score REAL, updated_at, UNIQUE(participant_id,item_id))`
- `events(id INTEGER PK AUTOINCREMENT, assignment_id, participant_id, kind, payload TEXT JSON, created_at)`
- `assets(id, owner_id, filename, mime, size, sha256, created_at)`
- `vocab_lists(id, owner_id, title, description, source_lang, target_lang, created_at, updated_at)` (schema v4)
- `vocab_entries(id, list_id, position, term, translation, alternatives TEXT JSON, example, image_asset_id, audio_asset_id, notes)`
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
| `text` | no (yes with `<<gaps>>`) | Textblock | `{ "text": "... <<answer|alt>> ...", "caseSensitive": false, "trim": true, "collapseSpaces": true, "ignorePunctuation": true }` — markdown-lite (`**bold**`, `*italic*`, `- ` lists), tables (`| a | b |` + `| --- |` header), inline images `![alt](/assets/…)`, gaps `<<answer|alternative>>`; ≥1 gap + points>0 ⇒ scoreable |
| `multiple_choice` | yes | Multiple Choice | `{ "multi": false, "choices": [{"id":"c1","text":"...","correct":true}], "shuffle": false, "partialCredit": true }` |
| `short_answer` | yes | Kurze Antwort | `{ "accepted": ["antwort", "..."], "caseSensitive": false, "trim": true, "collapseSpaces": true, "ignorePunctuation": true }` |
| `numeric` | yes | Numerische Antwort | `{ "answer": 3.5, "tolerance": 0.01, "toleranceType": "absolute" \| "percent" }` |
| `fill_blanks` | yes | Lückentext | `{ "text": "Platten gleiten an {{1}} Grenzen. {{2}} ...", "blanks": { "1": { "accepted": ["transform"] }, "2": { "accepted": ["divergent"] } }, "caseSensitive": false }` |
| `match` | yes | Zuordnen | `{ "pairs": [{"id":"p1","left": side, "right": side}], "shuffle": true }` where `side` = `"text"` (legacy) or `{ "kind": "text", "text": "..." }` \| `{ "kind": "image", "assetId": "...", "alt": "..." }` \| `{ "kind": "audio", "assetId": "..." }` |
| `ordering` | yes | Reihenfolge | `{ "items": [{"id":"i1","text":"..."}], "mode": "positions" \| "exact" }` |
| `pins` | yes | Bild markieren | `{ "image": {"assetId": "...", "alt": ""}, "zones": [{"id":"z1","label":"Transform-Rand","x":0.32,"y":0.44,"r":0.05}] }` |
| `image_boxes` | yes | Kästchen im Bild | `{ "image": {"assetId": "...", "alt": ""}, "boxes": [{"id":"b1","x":0.1,"y":0.1,"w":0.2,"h":0.15,"label":"...","accepted":["..."]}], "inputMode": "type" \| "drag", "wordBank": ["..."], "caseSensitive": false, "trim": true, "collapseSpaces": true, "ignorePunctuation": true }` — box geometry in normalized 0..1 coords; drag mode requires every accepted word ∈ wordBank |
| `long_answer` | yes (manual) | Freitext | `{ "hints": [{"text":"photosynthese","alternatives":[],"points":1}], "rubric": [{"criterion":"Fachliche Richtigkeit","levels":[{"label":"...","points":0}]}], "minWords": 0, "maxWords": 3000 }` |
| `hotspot` | yes | Hotspot-Bild (TipToi) | `{ "image": {"assetId","alt"}, "prompt": {"text","audioAssetId"}, "zones": [{"id","label","shape":"rect"\|"circle","x","y","w","h" (rect) \| "r" (circle),"correct":bool,"feedback":{"text","imageAssetId","audioAssetId"},"link":{"type":"none"\|"assignment"\|"url","value"}}] }` — zone geometry in normalized 0..1 coords; ≤30 zones; sanitize strips only `correct` |
| `table` | yes | Tabelle (ausfüllen / Matrix) | `{ "mode": "fill"\|"choice", "multi": bool, "columns": [{"id","label"}], "rows": [{"id","label","cells": {"<colId>": {"kind":"static","text"} \| {"kind":"gap","answers":[...]} \| {"kind":"option","text","correct":bool}}}] }` — ≤12 columns, ≤30 rows |
| `groups` | yes | In Zonen gruppieren | `{ "zones": [{"id","label"}], "items": [{"id","side": side, "zoneId": "<correct zone id>"}], "shuffle": bool }` — `side` same as `match` (text/image/audio); sanitize strips `zoneId` |
| `mark_sentence` | yes | Satz markieren / Wörter streichen | `{ "mode": "mark"\|"correct", "words": [{"text","target":"none"\|"mark"\|"wrong","fix":""}] }` — ≤120 words; ≥1 word with target ≠ none |
| `audio_answer` | yes (manual) | Audio-Antwort (Aufnahme) | `{ "maxDurationSec": 120 }` (5..3600); response references an uploaded audio asset; `needsManual = true` always |
| `vocabulary` | yes (flashcards: no) | Vokabeln | `{ "mode": "flashcards"\|"translate"\|"listen"\|"example"\|"match", "direction": "term_to_translation"\|"translation_to_term"\|"both", "shuffle": true, "caseSensitive": false, "entries": [{"id","term","translation","alternatives":[...],"example","imageAssetId","audioAssetId"}] }` — ≤60 entries; translate needs `translation`, listen needs `audioAssetId`, example needs `example`, match needs `imageAssetId` per entry |
| `hangman` | yes | Galgenmännchen | `{ "word": "BAUM", "alternatives": ["TREE"], "hint": "...", "maxAttempts": 8, "caseSensitive": false }` — word 2..40 letters (A-ZÄÖÜ); sanitize strips `word`/`alternatives`, keeps hint + lengths |
| `crossword` | yes | Kreuzworträtsel | `{ "title": "...", "words": [{"id","word","clue","row","col","direction":"across"\|"down"}] }` — ≤20 words, 2..15 letters, grid ≤20×20, no letter conflicts (`buildGrid`); `autoLayout(entries)` computes placements; sanitize strips `word`, keeps clue+row+col+direction+length |

**Canonical responses** (what the client sends, stored as-is after `normalizeResponse`):

| type | response |
| --- | --- |
| `text` | `{ "gaps": { "g1": "...", "g2": "..." } }` (gap ids `g1..gN` in order of appearance; `{}` when the text has no gaps) |
| `multiple_choice` | `{ "selected": ["c2"] }` (array; single choice ⇒ length ≤ 1) |
| `short_answer` | `{ "text": "..." }` |
| `numeric` | `{ "value": "3,5" }` (raw string; parsed server-side, localized comma/dot accepted) |
| `fill_blanks` | `{ "blanks": { "1": "transform", "2": "" } }` |
| `match` | `{ "matches": { "p1": "r:p1", "p2": "r:p2" } }` (leftId → right entry id `r:<pairId>`; right side shown shuffled; legacy bare-pair-id values still accepted) |
| `ordering` | `{ "order": ["i3", "i1", "i2"] }` (all item ids) |
| `pins` | `{ "points": { "z1": {"x": 0.31, "y": 0.42} } }` (normalized 0..1 coordinates) |
| `image_boxes` | `{ "answers": { "b1": "...", "b2": "..." } }` (boxId → word; type mode and drag mode share this shape) |
| `long_answer` | `{ "text": "..." }` |
| `hotspot` | `{ "tapped": ["z1", ...] }` (zone ids; ≤30) |
| `table` | fill: `{ "cells": { "<rowId>|<colId>": "..." } }`; choice: `{ "choices": { "<rowId>": "<colId>" }` or `[...ids]` when `multi` |
| `groups` | `{ "placement": { "<itemId>": "<zoneId>" } }` (every item placed) |
| `mark_sentence` | `{ "selected": [wordIndex, ...], "fixes": { "<wordIndex>": "correction" } }` |
| `audio_answer` | `{ "assetId": "...", "durationMs": 12345, "mime": "audio/webm" }` — mime must be in the audio allowlist |
| `vocabulary` | typed modes: `{ "answers": { "<entryId>": "..." } }`; flashcards: `{ "ratings": { "<entryId>": "known"\|"unknown" } }`; match: `{ "matches": { "<entryId>": "<term text>" } }` |
| `hangman` | `{ "letters": ["B","A"] }` (uppercase, unique, ≤40) |
| `crossword` | `{ "cells": { "<row>,<col>": "X" } }` (single uppercase letter per grid cell) |

**Scoring semantics per type:**

- `multiple_choice`: single → full points iff selected id is the unique correct choice. Multi: `partialCredit` true → `clamp((correctSelected - wrongSelected) / correctCount, 0, 1) * points`; false → points only for exact set match. `correct` = full credit. `detail = {selected, correctIds, missingIds, wrongIds}` (teacher-only; NEVER sent to students).
- `short_answer`: normalize (trim / collapse spaces / optional lowercase / optional punctuation stripping) both response and each accepted value; full points on first match. `detail = {normalized}`.
- `numeric`: parse localized number (`"1.234,5"`→1234.5, `"3,5"`→3.5, `"4.2e3"`, strip currency symbols/spaces/unit letters). Full points iff `|given-answer| <= tolerance` (percent: `|answer|*tolerance/100`). Unparseable/empty ⇒ 0.
- `text` (with gaps): per-gap equal weight; gap correct iff normalized response equals one of the gap's accepted alternatives (`<<a|b>>`). `autoScore = round(points * correct/total, 4)`. Without gaps the item is content-only (`maxScore = 0`). `detail = {hit, miss, gaps: {gN: {given, correct}}}`. Sanitized text masks gaps to `<<>>`.
- `fill_blanks`: per-blank equal weight; blank correct iff normalized response equals one of `accepted` (normalization: trim, collapse spaces, case-insensitive unless `caseSensitive`). Unfilled/missing blank ⇒ wrong. `autoScore = round(points * correct/total, 4)`. `correct` = all blanks.
- `match`: per-pair equal weight; correct iff `matches[leftId]` equals the right entry id `r:<pairId>` (legacy responses with the bare pair id are still accepted). Missing/wrong ⇒ 0 for that pair. `correct` = all pairs. Sides may be text/image/audio; sanitize emits `{lefts:[{id: pairId, ...side}], rights:[{id: "r:"+pairId, ...side}]}` in **separate id namespaces** (rights seeded-shuffled; server fills `url` from the assets table), so the student payload never reveals which right side belongs to which pair.
- `ordering`: `mode:"positions"` → `points * (correctPositions/total)`, all positions correct ⇒ full; `mode:"exact"` → full only or 0. `correct` = full. `detail = {correctPositions, total}`.
- `pins`: each zone's point correct iff Euclidean distance in normalized coordinates `<= r` (compare on `x`,`y` in 0..1). `points * correct/total`. `correct` = all zones. `detail = {hit:[ids],miss:[ids]}`.
- `image_boxes`: per-box equal weight; box correct iff normalized response equals one of `box.accepted`. `autoScore = round(points * correct/total, 4)`. `correct` = all boxes. `detail = {hit, miss, boxes: {boxId: {given, correct}}}`. Sanitize keeps geometry+label (+ wordBank in drag mode) but strips `accepted`; `answerZones` returns rects+accepted for review (gated by showAnswers).
- `long_answer`: `autoScore = min(points, sum(hint.points for matched hints))`, matching is case-insensitive substring of the student text (including `alternatives`); `needsManual = true` **always** (rubric/teacher decision); `correct = false` until a teacher sets a manual score ≥ points. Hints and rubric never reach the student.
- `hotspot`: `autoScore = round(points * max(0, hit - wrong) / correctCount, 4)` where hit = correct zones tapped, wrong = tapped non-correct zones; `correct` iff all correct zones tapped and none wrong. Sanitize strips `correct` per zone (geometry/label/feedback/link stay visible); `answerZones` returns correct-zone geometry for review when `showAnswers`.
- `table`: fill mode — per gap cell equal weight, normalized text match against `cell.answers`; choice mode — per row, the picked option set must equal the row's correct option set (`multi`) or its single correct option. `autoScore = round(points * correct/total, 4)`; `correct` = all cells/rows. Sanitize strips gap `answers` and option `correct`.
- `groups`: per item equal weight; correct iff `placement[itemId] === item.zoneId`. `autoScore = round(points * correct/total, 4)`; `correct` = all placed correctly. Sanitize strips `zoneId` from items.
- `mark_sentence`: mode `mark` — per target word (`target==="mark"`) equal weight; selected set must equal the target set (wrong selections cancel hits). Mode `correct` — additionally every `target==="wrong"` word needs `fixes[idx]` matching `fix` after normalization. `autoScore = round(points * correct/total, 4)`. Sanitize strips `target` and `fix`.
- `audio_answer`: `autoScore = 0`, `needsManual = true` always; the response asset is an audio upload via `POST /api/participant/assets` (audio-only); the grading view plays it back (`/assets/<id>/<id>`).
- `vocabulary`: typed modes — per entry equal weight; accepted = answer side per direction (`translation`+`alternatives` for term→translation, `term` for translation→term/listen/example; `both` alternates per entry index); normalized text match; `autoScore = round(points * correct/total, 4)`. Match mode — per image entry, `matches[entryId]` must equal the entry's `term` (normalized); sanitize emits `entries` as images only (`{id,imageAssetId}`) plus a separate seeded-shuffled `terms` string list, so the pairing is never in the payload. Flashcards — `maxScore = 0`, ratings stored, `correct` = all known. Sanitize strips the answer side per mode/direction (never sends `translation`/`alternatives` when they are the answer, nor `term` when it is; in example mode the term is masked to `_____` inside the example; prompt-side media stays, answer-side media is stripped).
- `hangman`: `won` = all unique letters of an accepted word (word + alternatives) guessed ⇒ full points; otherwise `autoScore = round(points * 0.5 * revealedRatio, 4)`. `detail = {letters, revealed, wrong, won}`; `safeDetail` exposes `{revealed, wrong, won}` to the student for progressive reveal (the word never leaves the server).
- `crossword`: per letter equal weight over all grid cells; `autoScore = round(points * correctLetters/totalLetters, 4)`; `correct` = every letter right. `detail = {cells: {"r,c": {given, correct}}, words: {...}}`; `safeDetail` exposes only `{cells: {given, correct}}` (no letters). Sanitize keeps clue/placement/length only.

**`safeDetail(detail)` (optional export):** item modules may expose a student-safe subset of `score().detail`. The server includes it as `result.detail` in `PUT /api/participant/responses/:itemId` and in `resultPayload` — only when the module defines it. Never put answer keys in it.

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
| GET | `/api/join/:code` | — | `{assignment:{code,title,template,locale,status,requireName,classCode|null}, activity:{title,description}}`; 404 `invalid_code`. `classCode` is set when the assignment is gated by a published sequence class |
| POST | `/api/join` | `{code, name, classToken?}` | `{participantToken, participant:{id,name}, assignment:{...}, activity:{...}, responses:[], flags:[], class:{id,code,name,orderMode}|null}`; errors: `invalid_code`, `assignment_closed`, `name_required`, **403 `class_required` {details:{classCode}}**, **409 `item_locked` {details:{position,blockingPosition,classCode}}** (assignment is in a published sequence class and not unlocked for this class token) |
| GET | `/api/participant` | token header | same as before + `class:{id,code,name,orderMode}|null` |
| PUT | `/api/participant/responses/:itemId` | `{response}` | `{saved:true, result:{correct,autoScore,maxScore,needsManual}, score, maxScore}`; 409 `attempt_submitted` / `time_expired` (server auto-submits on deadline); 400 `invalid_response` |
| POST | `/api/participant/heartbeat` | — | `{ok:true}`; updates `last_seen_at`; publishes SSE presence at most every 15 s per participant |
| POST | `/api/participant/flags` | `{flags:[itemId...]}` | `{flags}`; publishes SSE `flags` event |
| POST | `/api/participant/submit` | `{confirm:true}` | `{participant:{status,score,maxScore}, result:{showResults,showAnswers,items:[{itemId,correct,autoScore,maxScore,needsManual,response?,answer?}]}}`; 409 if already submitted |
| GET | `/api/participant/result` | token header | same result payload; 403 `not_submitted` before submit |
| POST | `/api/participant/assets?filename=<name>` | raw audio bytes (`audio/webm|ogg|mpeg|mp4|wav`), token header **or** student session cookie | 201 `{asset:{id,url,filename,mime,size}}`; 400 `unsupported_type` (audio only), 413 too large (cap `min(maxUploadBytes, 15 MB)`), 429 after 20 uploads/min per participant. Used by the `audio_answer` renderer (MediaRecorder) so students can record answers from the mic; stored with `owner_id` = student id or NULL |

Asset `url` enrichment: server-side, the student payload (join + participant) walks every item recursively and fills `url` next to every `assetId` (generic — covers `pins.image`, `image_boxes.image`, `match` sides, `hotspot.config.image` / prompt & feedback audio, `groups` item sides, media). Never hand-roll per-type enrichment.

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

### 5.6 Classes — bundles of assignments ("Klassen"/Lernpfade, schema v2)

A class bundles assignments in an order. `order_mode='free'`: all items open immediately. `order_mode='sequence'`: an item unlocks only when every previous item is submitted/graded and (if `unlock_min_percent>0`) reached that score percentage (`maxScore<=0` counts as passed). Unlock logic is pure in `shared/classes.js` (`computeItemStates`, `firstBlockingPosition`); enforcement for direct assignment joins lives in `server/api/classes.js` (`enforceClassUnlock`, called from `POST /api/join`).

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/classes` | — | `{classes:[{id,code,name,description,orderMode,unlockMinPercent,status,itemCount,participantCount,assignmentIds,createdAt,updatedAt}]}` (teacher: own; admin: all) |
| POST | `/api/classes` | `{name, description?, orderMode, unlockMinPercent}` | 201 `{class}` (draft, `code=null`); 400 `invalid_class` with details |
| GET | `/api/classes/:id` | — | `{class:{...listItem, items:[{id,position,assignmentId,code,title,activityTitle,template,status,participantCount}]}}` (owner/admin) |
| PUT | `/api/classes/:id` | `{name?, description?, orderMode?, unlockMinPercent?}` | `{class}` (full detail) |
| DELETE | `/api/classes/:id` | — | 204; detaches `participants.class_participant_id` |
| PUT | `/api/classes/:id/items` | `{assignmentIds:[...]}` (≤50, unique, owned) | `{class}` with reordered items; 400 `duplicate_items`/`too_many_items`, 404 `assignment_not_found` |
| POST | `/api/classes/:id/publish` | — | `{class, url:"/c/<CODE>"}`; generates 6-char code; 409 `class_empty` without items |
| POST | `/api/classes/:id/unpublish` | — | `{class}` (status back to `draft`; code kept but lobby 404s) |
| GET | `/api/classes/join/:code` | — | public `{class:{code,name,description,orderMode,unlockMinPercent,itemCount}}`; 404 `invalid_code` when unknown/unpublished |
| POST | `/api/classes/join` | `{code, name}` | `{classToken, class:{...lobby payload}, participant:{id,name}}`; 400 `name_required`/`invalid_name`; rate-limited 30/min/IP |
| GET | `/api/classes/:code/participant` | `X-Class-Token` header | `{class:{...lobby payload}, participant:{id,name}}`; 401 `invalid_class_token`. Lobby items: `{position,assignmentId,title,template,state:'done'|'open'|'locked',status,score,maxScore,blockedBy,code}` — **`code` is null while locked** (no enumeration of gated assignments) |
| GET | `/api/classes/:id/stats` | — | teacher (owner/admin): `{class, items:[{assignmentId,position,title,code,status}], students:[{participantId,studentId,name,username,hasAccount,lastLoginAt,cells:{assignmentId:{state,status,score,maxScore,percent,submittedAt}},total:{score,maxScore,percent}}]}` — matrix for the class statistics page. Attempts in **free-order** classes are linked to the roster entry too (via class token or student account), so they appear here |

Pages: `GET /c/:code` → `public/student.html` (class join → lobby → `/a/<code>?c=<classCode>` per item; the `?c=` param sends the class token on `POST /api/join`, redirects to `/c/<code>` on `class_required`, shows the lock error on `item_locked`).

### 5.7 SSE (teacher live dashboard)

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

### 5.9 Vocabulary lists (teacher-only, owner-scoped; admin sees all)
| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/vocab-lists` | — | `{lists:[{id,title,description,sourceLang,targetLang,entryCount,createdAt,updatedAt}]}` |
| POST | `/api/vocab-lists` | `{title, description?, sourceLang?, targetLang?, entries?}` | 201 `{list, entries}`; 400 `validation_failed` |
| GET | `/api/vocab-lists/:id` | — | `{list, entries:[{id,position,term,translation,alternatives,example,imageAssetId,audioAssetId,notes}]}`; 404 / 403 `not_your_list` |
| PUT | `/api/vocab-lists/:id` | same as POST; when `entries` present they replace all rows in one transaction | 200 `{list, entries}` |
| DELETE | `/api/vocab-lists/:id` | — | 204 |
| POST | `/api/vocab-lists/:id/import` | `{csv}` (≤512 KB; one row per line `term;translation;example;note`, `;` or tab, header row auto-skipped, ≤500 rows) | 200 `{added, entries}`; 400 `empty_csv`/`no_rows`/`too_many_entries` |

Entry validation: `term` required (≤200 chars), `translation` ≤200, `alternatives` ≤10 strings ≤200, `example` ≤1000, `notes` ≤500, `imageAssetId`/`audioAssetId` must exist in `assets` (400 otherwise). CSV parsing lives in `shared/vocab-csv.js` (`parseVocabCsv`) so server and tests share it. Lists are an **authoring library**: a `vocabulary` item stores a snapshot of entries, so editing/deleting a list never breaks saved activities.

### 5.8 System (Lead)
- `GET /api/health` → `{status:"ok", version, uptime, db:"ok"}` 200; 503 if DB probe fails.
- `GET /api/capabilities` → `{version, itemTypes:[{type,label,scoreable}], features:{sse:true,print:true,importExport:true,timeLimit:true,classes:true}, maxUploadMb}`.
- `GET /` → `public/index.html`; `GET /login` → `public/login.html`; `GET /teacher`, `/teacher/*` → `public/teacher/index.html`; `GET /a/:code` and `GET /c/:code` → `public/student.html`. Unknown non-API paths: static file from `public/`, else 404 page (`/404.html` if present).

## 6. Client architecture

Page loaders:
- `/` (`public/index.html`): landing, teacher login link, student code entry → `/a/<CODE>`.
- `/login` (`public/login.html` + `login.js`): teacher login form.
- `/teacher/...` (`public/teacher/index.html` + `teacher/app.js`): teacher SPA (hash-free path routing via `location.pathname`).
  Views: `#/dashboard` (own activities + assignments), `#/edit?id=`, `#/assignment?id=`, `#/grade?assignment=&participant=`, `#/classes`, `#/class?id=`, `#/vocab`, `#/vocab-edit?id=`, `#/admin`, `#/print?activity=` | `#/print?assignment=&participant=`. Use `history.pushState` + path prefix `/teacher/...`; server serves index.html for all `/teacher/*`.
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
- The student payload omits: all answer keys, `long_answer.hints`, `long_answer.rubric`, `pins.zones[].r`, `image_boxes.boxes[].accepted`, text gap answers (masked to `<<>>`), per-answer `feedback`, `hotspot.zones[].correct`, `table` gap `answers` + option `correct`, `groups.items[].zoneId`, `mark_sentence.words[].target/fix`, `vocabulary` answer side per mode/direction, `hangman` word/alternatives, `crossword` word letters (see §4.1), and teacher-only data. `sanitizeActivity()` is the only place that strips; do not hand-roll elsewhere. Media `url`s are enriched from the assets table server-side, generically for every `assetId` found in an item.
- `/api/capabilities` is **minimal for anonymous callers** (feature flags, maxUploadMb, demoMode only). Version, baseUrl and the item-type list require a teacher session. `/api/health` stays public for the updater/monitoring.
- **Student accounts (schema v3):** table `students` (owner teacher, name, unique `username`, scrypt `password_hash`; plaintext generated passwords are returned exactly once at creation/reset and never stored) + `student_sessions` (separate `ow_student` cookie). `class_participants.student_id` links roster entries to accounts; `participants.student_id` links assignment attempts. A logged-in student joining a class or assignment is linked automatically (name taken from the account; class unlock rules enforced). Teacher roster endpoints: `GET/POST /api/classes/:id/students`, `POST .../students/:studentId/reset`, `DELETE .../students/:studentId`, `GET .../stats`; student: `POST /api/auth/student-login`, `POST /api/auth/student-logout`, `GET /api/student/me`. Initial passwords are one-time only (returned at creation/reset) — the UI offers copy-as-CSV and a printable sheet at that moment.
- **Practice mode:** `settings.practice: true` on an activity/assignment. Practice attempts are flagged (`participants.flags` contains `"practice"`) and excluded from results, CSV export, grading and the live dashboard; `POST /api/participant/reopen` allows retrying (practice only).

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

---

## Appendix A — Implementation notes (v0.1 as built)

This appendix records where the shipped code deliberately extends or pins down the contract above. Treat it as part of the contract.

1. **Teacher routes are concrete paths:** `/teacher/dashboard`, `/teacher/edit?id=`, `/teacher/assignment?id=`, `/teacher/grade?assignment=&participant=`, `/teacher/admin`, `/teacher/print?activity=` (or `?assignment=&participant=`). The server serves `public/teacher/index.html` for extensionless `/teacher/*`; anything with a file extension (`app.js`, `teacher.css`, …) is served as a static file.
2. **Endpoints added during implementation:** `POST /api/admin/purge {olderThanDays, dryRun}` (DSGVO retention, admin-only); asset GET is `GET /assets/:id/:filename` where the filename segment is cosmetic (assets are served by id, immutable cache); `POST /api/activities/:id/publish` also accepts `dueAt`.
3. **Student result payload:** per-item `answerText: string[]`, plus canonical `answer` and — for pins — `answerZones:[{id,label,x,y,r}]`, all gated by effective `showAnswers = settings.showAnswers && settings.allowReview`. Student payloads never contain: correct flags, accepted-answer arrays, numeric answer/tolerance, blanks answers, hints/rubric, item feedback, pin zone coordinates (zones arrive as `{id,label}`), or teacher-only data. Pins `image.url` is enriched from the assets table.
4. **Rate limits and caps (in-memory):** login 10 failures/15 min/IP; student join 30/min/IP; response saves 120/min/participant token; submit 5/min/token; 500 participants per assignment (409 `participant_limit_reached`). Participants never store IP or user-agent (data minimisation) — those columns stay NULL.
5. **Database migrations:** `server/db.js` reads `PRAGMA user_version` and applies the `MIGRATIONS` ladder (currently schema v1). The app refuses to start against a newer schema; add a migration step for every schema change.
6. **Time limit:** server-authoritative `started_at + timeLimitMinutes` with a 60 s grace; the client renders a countdown and handles the resulting 409 `time_expired` by fetching the result.
7. **Verification shipped with the code:** `node --test` (63 unit/integration tests), `node tools/e2e/api-check.mjs` (50 API assertions incl. answer-leak checks), `node tools/e2e/screenshots.mjs` (browser render + console-error check, writes `docs/screenshots/`), and the Playwright suite `npm run e2e` (14 specs: login, authoring/publish, student flow, live dashboard, grading, admin, print, security).
8. **Fixed in v0.3:** the `match` item now uses separate left/right id namespaces (`r:<pairId>`), so pair structure is no longer observable in the student payload; legacy responses are still accepted when scoring.
9. **New internal module:** `server/api/_helpers.js` centralises shared API logic for the route modules; `server/index.js` only mounts `register(router)` exports.
10. **Demo mode (test-only, off by default):** with `OW_DEMO_MODE=1`, the seeded admin may use a short throwaway password (`admin`), login also accepts a bare username (`admin` → `admin@schule.local`), `/api/capabilities` reports `demoMode: true`, and the login page + teacher shell show a warning banner. With `OW_SEED_DEMO=1`, `server/demo-seed.js` seeds four demo activities and assignments on first boot (idempotent — only when no activities exist). Started by `start-demo.bat`; never enable in production.
