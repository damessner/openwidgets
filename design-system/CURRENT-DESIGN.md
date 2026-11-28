# Current Design — OpenWidgets (as deployed)

**Status:** live on prod since commit `7efbb57` (2026-11-28) —
https://openwidgets.smiletelfs.dpdns.org
**v2.4 redesign ported:** the mockups in `design-system/mockups/` are now in the
real app (token-based, CSP-safe — sections marked „redesign v2.4" in
`public/app.css`, `student.css`, `landing.css`, `teacher.css`, `render/render.css`).
**Sources of truth:** `public/app.css` (tokens + shared components),
`public/landing.css`, `public/student.css`, `public/teacher/teacher.css`,
`public/render/render.css`; rules documented in `design-system/MASTER.md` +
`design-system/pages/{landing,student,teacher}.md`.
This file is the *review snapshot* of what is actually shipped — check the CSS
files for exact values when editing.

---

## 1. Surfaces (what exists)

| Surface | Files | Audience |
|---|---|---|
| Landing / feature page | `public/index.html` + `landing.css` | public visitors |
| Login (teacher + student mode toggle) | `public/login.html` | both |
| Teacher SPA (dashboard, classes, editor, grading, admin/LLM) | `public/teacher/index.html` + `teacher/teacher.css` | teachers |
| Student player (join by code, class lobby, worksheet, results) | `public/student.html` + `student.css` | pupils |
| Item renderers inside the player | `public/render/render.css` | pupils |
| Print views (roster, worksheet, results) | `@media print` in `app.css` | teacher paper |

Layout shell: `--content-max: 1180px` centered container, sticky app header
(`scroll-padding-top: 76px` so anchors/focus are never hidden under it).

## 2. Design language in one paragraph

**"Classroom Editorial + Soft UI Evolution"** (from the ui-ux-pro-max LMS
profile): calm, trustworthy, structured — deep **teal** as the primary
(instead of generic SaaS indigo/purple), warm **amber** reserved for rewards
(⭐ bonus, highlights), off-white paper-mint background with a very subtle
fixed radial teal/amber glow, crisp white cards with 1px borders and soft
shadows. Flat with gentle elevation; motion is subtle (150–250 ms), fully
disabled under `prefers-reduced-motion`. Light **and** dark mode ship
(`prefers-color-scheme: dark` parity, see §3).

## 3. Design tokens (`public/app.css` `:root`)

### Color

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f4f7f6` | `#0b1315` | page background (+ fixed radial glow) |
| `--surface` | `#ffffff` | `#121e21` | cards, buttons-secondary |
| `--surface-2` / `-3` | `#edf3f1` / `#dce7e4` | `#18272b` / `#22353a` | input wells, table headers, tracks |
| `--text` | `#0f2422` | `#edf7f5` | body text |
| `--text-muted` / `--text-faint` | `#425956` / `#576e6b` | `#a2bab6` / `#819c97` | secondary text (≥ 4.5:1) |
| `--border` / `--border-strong` | `#d5e2df` / `#a7c0ba` | `#243a40` / `#35545c` | card + input borders |
| `--primary` | `#0f766e` | `#2dd4bf` | primary buttons (white text 5.48:1 in light; dark-ink `#042f2e` on mint in dark) |
| `--primary-2` / `--primary-hover` | `#0d9488` / `#115e59` | `#14b8a6` / `#5eead4` | icons, focus, hovers |
| `--primary-soft` | `#e3f5f2` | `rgb(45 212 191 / 15%)` | active pills, item-number pills |
| `--accent` (+`-soft`) | `#d97706` / `#fef3c7` | `#fbbf24` / 15% | ⭐ bonus, reward chips, highlights |
| `--success` / `--danger` / `--warning` / `--info` (+`-soft`) | `#15803d` / `#c2261c` / `#a55a00` / `#0369a1` | `#4ade80` / `#f87171` / `#fbbf24` / `#38bdf8` | grading states, badges, toasts |
| `--gradient-primary` | `linear-gradient(135deg, #0f766e, #0d9488)` | same | hero CTA / brand moments |
| `--focus-ring` | `0 0 0 3px rgb(15 118 110 / 32%)` | `… rgb(45 212 191 / 42%)` | visible keyboard focus (≥ 3:1) |

Semantic colors are always paired with icons/text (✓/✗ + label) — never
color alone.

### Typography

- `--font-sans`: **Plus Jakarta Sans** (variable, weights 200–800), self-hosted
  woff2 in `public/fonts/` (latin + latin-ext subsets, `font-display: swap`),
  fallback `system-ui, -apple-system, 'Segoe UI', Roboto, …`. CSP is
  `font-src 'self'` — **no external font CDNs**.
- `--font-mono`: system mono stack, `tabular-nums` for join codes (e.g. `QSZWAD`),
  timers, scores.
- Scale: base 16px, body `line-height: 1.55` (student reading blocks 1.6),
  headings 1.25 / weight 700 / `letter-spacing: -0.015em`, `h1 1.9rem → h4 1rem`,
  `text-wrap: balance` on h1/h2. Student font-size toggle A−/A/A+
  (`--student-font-scale`) preserved.

### Spacing / radii / shadows / motion

- Spacing: `--space-1..7` = 4/8/12/16/24/32/48 px.
- Radii: `--radius-sm 8px`, `--radius 12px`, `--radius-lg 16px`.
- Shadows: `--shadow-sm`, `--shadow`, `--shadow-lg`, `--shadow-primary`
  (soft, low-alpha pine `rgb(15 36 34 / …)`; dark mode switches to black).
- Transitions 150–250 ms ease; `@media (prefers-reduced-motion: reduce)`
  disables them.

## 4. Core components (in `app.css`)

- **Buttons** `.btn` + variants: `.btn-primary` (teal fill, white text,
  `--shadow-primary` glow on hover), `.btn-secondary` (white surface, border),
  `.btn-ghost` (transparent → surface-2 hover), `.btn-danger`; sizes
  `.btn-sm` (teacher toolbars) / `.btn-lg`; disabled states; 44px min height on
  student-facing controls.
- **Cards** `.card` (+ `.card-header`, `.card-title`, `.card-subtitle`,
  `.compact`): white surface, 1px `--border`, `--radius`, `--shadow`.
- **Badges/pills** `.badge` (+ `.badge-success/-warning/-info/-accent`,
  `.tiny`): single-line `nowrap`, soft tinted backgrounds.
- **Inputs** `.input` / `textarea.input` / `select`: `--surface-2` well,
  `--border-strong` border, `--focus-ring` on `:focus-visible`; labels always
  visible; paste never blocked.
- **Toasts** bottom stack, semantic variants (success/error/warning).
- **Switch** (toggle) with track/knob, **icon tiles** `.icon-tile-*`
  (teal/emerald/amber/sky semantic KPI tiles on teacher dashboard).
- **Progress bars**: `--surface-3` track, `--primary`/`--gradient-primary` fill.

## 5. Per-surface notes (page overrides + v2.4 port)

- **Landing/Login** (`landing.md`): trust bar (DSGVO/OSS/no-CDN), asymmetric
  7/5 hero with upright worksheet preview (letter-chip mock choices), prominent
  join card with accent top bar + 56px mono code input, 4-across feature grid;
  login card with segmented teacher/student toggle + compliance strip.
- **Student player** (`student.md`): 72px header with Beenden button, progress %,
  PIN chip, countdown, A−/A/A+; **task-navigator pills** over all items
  (worksheet scrolls / quiz jumps, done = ✓ pill); item cards with 4px gradient
  top accent, number pill, points chip; MC choices = 52px rows with A/B/C letter
  chips and primary-fixed selected state; **fixed bottom action rail** with
  autosave status + submit; audio player with ▶ Normal / 🐢 Langsam toggle,
  VORLESETEXT as collapsed „📖 Text zum Mitlesen".
- **Teacher studio** (`teacher.md`): compact dense workspace (tables, editor,
  grading grid), `tabular-nums` on numbers, KPI cards with semantic icon
  tiles, 40×3px primary underline on page titles, editor canvas uses
  `color-mix(in srgb, var(--primary) …)` (theme-safe), print stays crisp B/W.
- **Print** (`@media print` in `app.css`): white paper, shadows off,
  header/nav/toasts/modals hidden, 11.5pt.
- **Dark mode**: full token parity via `prefers-color-scheme: dark`
  (teal → mint `#2dd4bf` with dark ink, deeper surfaces, black shadows).

## 6. Accessibility & hard constraints

- Contrast ≥ 4.5:1 text, ≥ 3:1 UI/focus (primary button uses darkened
  `#0f766e` for white text).
- `font-src 'self'` CSP — only local woff2; no trackers (school DSGVO).
- 44×44px student touch targets; `:focus-visible` rings; `scroll-padding-top`
  under sticky header; `prefers-reduced-motion`; never color-only feedback.
- E2E selectors/IDs/`data-*` and de+en i18n keys must stay stable when restyling.

## 7. How to change things

1. Global look → edit tokens in `public/app.css` `:root` (light) and the
   `@media (prefers-color-scheme: dark)` block (dark). Everything downstream
   (buttons, cards, badges, renderers) follows automatically.
2. One surface → edit its page CSS (`landing.css`, `student.css`,
   `teacher/teacher.css`, `render/render.css`).
3. New surface → add `design-system/pages/<name>.md` (overrides MASTER.md).
4. Verify: `node --test`, visual check at 375/768/1024/1440px, light+dark,
   print preview, then commit → push `main` → LXC auto-deploys
   (`systemctl start openwidgets-update.service`).

## 8. Review checklist for you

- [ ] Palette feels right for a school product (teal/amber vs. something else)?
- [ ] Plus Jakarta Sans everywhere — or a more "readable for kids" face
      (e.g. Atkinson Hyperlegible) for the student reading mode?
- [ ] Dark mode: keep auto-only, or add a manual light/dark toggle in the header?
- [ ] Landing hero preview: keep the worksheet mock, or swap in a real screenshot?
- [ ] Density: teacher compact OK, student roomy OK?
- [ ] Anything from the old design (`backup/old-design` branch) worth bringing back?
