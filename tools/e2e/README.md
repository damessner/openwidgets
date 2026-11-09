# Browser end-to-end verification

Dev-only tooling. The application itself has **zero runtime dependencies**; everything
here is for verification and screenshots.

## How it is built

- `@playwright/test` + Edge (installed channel) — no Chromium download required.
- `harness.js` boots a throwaway server (`DATA_DIR` in `.data/`, own port) and provides
  an API client with a cookie jar plus an anonymous student session helper.
- `fixtures.mjs` builds canonical correct/wrong/partial responses per item type.
- `api-check.mjs` — dependency-free API integration check (teacher → publish → student →
  submit → grade → CSV → import/export → answer-leak assertions). No browser needed.
- `screenshots.mjs` — browser run that seeds a live class, screenshots every view
  (landing, login, dashboard, editor, live dashboard, grading, admin, print, student
  worksheet, mobile) into `screenshots/` and copies the public ones to `docs/screenshots/`.
  Fails on uncaught page errors or 5xx responses.
- `specs/` — Playwright specs for the interactive UI flows; `run.mjs` is the entry point
  (`npm run e2e` in the repository root).

## Commands

```bash
# API-only check against a throwaway server
node tools/e2e/api-check.mjs

# API-only check against a running dev server
node tools/e2e/api-check.mjs --base-url http://127.0.0.1:3999 --admin admin@school.at --password '...'

# Screenshots (needs a seeded instance — npm run demo:seed)
node tools/e2e/screenshots.mjs --base-url http://127.0.0.1:3999

# Full browser suite
npm run e2e
```

## Known environment constraints (Windows + Edge)

- Chromium cannot be downloaded here (`spawn EPERM` under sandboxed stdio); use
  `channel: 'msedge'`.
- Set `PLAYWRIGHT_BROWSERS_PATH` to `tools/e2e/.browsers` only if you have downloaded
  browsers; the Edge channel works without it.
- Screenshots are gitignored under `screenshots/`; the curated ones in
  `docs/screenshots/` are committed for the README.
