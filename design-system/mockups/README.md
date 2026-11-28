# Redesign mockups v2.4 (pasted HTML, 2026-11-28)

Static full-page mockups of the new redesign, saved verbatim for review.
Open each file directly in a browser.

| File | Surface |
|---|---|
| `teacher-studio.html` | Teacher Studio: KPI cards, live session table with PINs + progress bars, split live-grading view (submission viewer + quick-grade well + roster telemetry), create-unit modal |
| `landing-join.html` | Landing & Join: trust bar, hero with join-PIN card, upright worksheet preview mock (SVG pyramid + MC widget + TTS bar), teacher/student perspective toggle, 4-pillar feature grid, testimonial + stats |
| `login.html` | Login: brand card, teacher/student segmented switch, teacher form (email/pw + SSO tiles Schulportal/IServ/WebUntis), student 6-digit PIN boxes + name + QR alternative, DSGVO footer |
| `student-worksheet-fullscreen.html` | iPad landscape worksheet, **fixed** header (task navigator pills, progress 37%, timer, Vorlesen + 🐢, A−/A/A+, PIN chip) + bottom action rail (Vorherige / Hilfe / Speichern & Weiter) |
| `student-worksheet-sticky.html` | same worksheet, **sticky** header variant with „Aufgabe 3 von 8" chip and play/pause Vorlesen button |
| `student-dashboard.html` | Student dashboard: greeting + daily focus, PIN quick-join card, metric cards (tasks, ⭐ stars, open units, pacing ring), task cards with progress + thumbnails, week timeline, teacher feedback + audio memo, weekly goal, quick tools |

## ⚠️ Not production-ready as-is

These mockups use **`cdn.tailwindcss.com`, Google Fonts, Material Symbols CDN
and `lh3.googleusercontent.com` images** — all blocked/against policy in the
real app:

- CSP in `server/lib/http.js` is `font-src 'self'` (and no external scripts/
  images) → fonts/icons/CDN scripts would be blocked on prod.
- DSGVO stance (MASTER.md anti-patterns): no third-party CDNs / trackers.

## Porting checklist (to make these the real UI)

1. Replace Tailwind CDN classes with the existing token classes in
   `public/app.css` + page CSS — the mockup color names map 1:1 to M3-style
   tokens (`surface-container-lowest` → `--surface`, `primary-container` →
   `--primary-soft`/`--primary`, `on-surface-variant` → `--text-muted`,
   `outline-variant` → `--border`, `secondary-container` → amber `--accent`…).
   Add missing tokens to `:root` (light + dark + print) where needed.
2. Replace Google Fonts with the already self-hosted Plus Jakarta Sans
   (`public/fonts/`, `@font-face` in `app.css`).
3. Replace Material Symbols with inline SVGs from `public/lib/icons.js`
   (stroke-width 2 outline style per MASTER.md); keep ⭐/🐢/✋ only as
   content markers, not chrome.
4. Replace external images (logo, avatars, worksheet thumbnails) with local
   assets uploaded via the asset library or inline SVG; the pyramid diagram
   is already inline SVG and can be kept.
5. Wire data instead of hardcoded demo data (Lukas M., 7b, QSZWAD…): teacher
   dashboard ↔ `/api/classes`, grading ↔ grade view APIs; student dashboard
   ↔ `/api/student/me`; worksheet ↔ existing render pipeline (the mockup
   layout maps to `.student-items` + navigator + bottom rail).
6. Keep all E2E selectors/IDs/`data-*` stable; keep de+en i18n keys.
7. Preserve `@media print`, `prefers-reduced-motion`, 44px touch targets,
   focus rings, dark mode.

See `design-system/CURRENT-DESIGN.md` for the currently deployed design and
`design-system/MASTER.md` + `pages/*.md` for the rules these mockups follow.
