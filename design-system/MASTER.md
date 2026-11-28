# Design System Master File — OpenWidgets

> **LOGIC:** When building or restyling a specific surface, first check `design-system/pages/[page-name].md` if present.
> If that file exists, its rules **override** this Master file. Otherwise, strictly follow the rules below.

---

**Project:** OpenWidgets (Self-Hosted School Interactive Worksheets & Learning Platform)
**Generated:** 2026-11-28 (via `ui-ux-pro-max-skill` knowledge base)
**Primary Matched Category:** `LMS (Learning Management System)` (No. 179, confidence `0.93`) + `Educational App` (No. 9)
**Design Dials:** Variance `4/10` (Balanced / Structured) | Motion `3/10` (Subtle micro-interactions, `prefers-reduced-motion` compliant) | Density `5/10` (Standard for student/landing, `8/10` compact for teacher tables/editor)

---

## Global Rules

### Resolved Aesthetic Direction
- **Primary Style:** `Flat Design` + `Accessible & Ethical` + `Soft UI Evolution` (subtle elevation, crisp 1px borders, clear semantic surface separation, 4.5:1+ normal text contrast, ≥ 3:1 UI/focus contrast, 44×44px touch targets for student interactive controls).
- **Why this direction for OpenWidgets:**
  - `ui-reasoning.csv` (No. 179, LMS): *"learning systems must stay structured, legible, and reminder-driven across devices"* — avoid hidden assignments, cluttered navigation, and low-contrast muted text.
  - Moves OpenWidgets away from generic SaaS indigo-purple (`#4f46e5` / `#9333ea`) toward a **calm, trustworthy school-editorial palette**: **Deep Teal (`#0F766E` / `#0D9488`)** primary + **Warm Classroom Paper (`#F6FAF9` / `#F8FAFC`)** background + **Crisp White (`#FFFFFF`)** cards + **Warm Amber (`#D97706` / `#B45309`)** accent for bonus stars (`⭐`), highlights, and callouts.

### Color Palette (Light Mode & Dark Mode Parity)

> Note on contrast: `colors.csv` No. 179 specifies `#0D9488` with `#000000` foreground (`On Primary`), because white text on `#0D9488` is ~3.74:1. For primary buttons with white text (`--primary-contrast: #FFFFFF`), we darken `--primary` to **`#0F766E`** (contrast **5.48:1** on white) while keeping `#0D9488` / `#14B8A6` for icons, focus rings, and non-text borders, and `#0D9488` with `#042F2E` text where teal fills use dark ink.

| Role | Light Mode Hex | Dark Mode Hex | CSS Variable | Notes |
|------|----------------|---------------|--------------|-------|
| Primary (White text safe) | `#0F766E` | `#2DD4BF` | `--primary` | 5.48:1 w/ `#FFFFFF` in light; `#042F2E` on `#2DD4BF` in dark |
| Primary Hover | `#115E59` | `#5EEAD4` | `--primary-hover` | Deeper teal in light, brighter mint in dark |
| Primary Soft (Tint) | `#CCFBF1` / `#E6F7F5` | `rgb(45 212 191 / 16%)` | `--primary-soft` | Subtle active pill / highlight fill |
| Primary Contrast (On Primary) | `#FFFFFF` | `#042F2E` | `--primary-contrast` | High-contrast ink on filled primary buttons |
| Secondary / Accent | `#B45309` / `#D97706` | `#FBBF24` | `--accent` | Warm amber for ⭐ bonus, streak/progress highlights |
| Background | `#F4F8F7` | `#0B1315` | `--bg` | Calm paper-mint off-white (light) / deep slate-teal (dark) |
| Foreground / Text | `#0F2422` | `#ECFDF9` | `--text` | High-contrast deep pine-slate (light) / crisp mist (dark) |
| Muted Text | `#425855` | `#A7C0BC` | `--text-muted` | ≥ 4.5:1 against both `--bg` and `--surface` |
| Faint Text | `#526A67` | `#84A19C` | `--text-faint` | ≥ 4.5:1 on white/card |
| Card Surface | `#FFFFFF` | `#121E21` | `--surface` | Crisp separation from `--bg` |
| Surface 2 (Subtle Well) | `#EDF4F2` | `#18272B` | `--surface-2` | Input wells, segmented tracks, table headers |
| Surface 3 (Elevated/Track) | `#DCEAE6` | `#22363B` | `--surface-3` | Progress tracks, subtle chips |
| Border | `#D1E2DE` | `#243B40` | `--border` | Visible in both light and dark modes |
| Border Strong | `#9EC0B9` | `#35545B` | `--border-strong` | Input borders, interactive card outlines |
| Success | `#15803D` | `#4ADE80` | `--success` | Grade green, correct answer state |
| Destructive / Danger | `#C2261C` | `#F87171` | `--danger` | Incorrect / delete action |
| Warning | `#A55A00` | `#FBBF24` | `--warning` | Partial credit, timer urgent, demo notice |
| Info | `#0369A1` | `#38BDF8` | `--info` | Classroom info, status badges |
| Focus Ring | `0 0 0 3px rgb(15 118 110 / 32%)` | `0 0 0 3px rgb(45 212 191 / 42%)` | `--focus-ring` | ≥ 3:1 visible keyboard focus indicator |

### Typography
- **Primary Skill Pairings Considered:**
  - `Friendly SaaS` (No. 13): `Plus Jakarta Sans` (clean, warm geometric-humanist, great German umlaut & punctuation metrics, legible at small dashboard table sizes AND large worksheet headings).
  - `Corporate Trust` (No. 16): `Lexend` + `Source Sans 3` (reading-fluency optimized).
  - `Accessibility First` (No. 48): `Atkinson Hyperlegible` (designed for maximum character distinction — e.g., `I` / `l` / `1`, `0` / `O` — ideal for German/English vocabulary & gap-fill worksheets).
- **Recommended System:**
  - **UI & Headings (`--font-sans`):** `'Plus Jakarta Sans'` (or `'Lexend'`/`'Atkinson Hyperlegible'` option for student reading mode), self-hosted `.woff2` under `public/fonts/` with clean system fallback (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`).
  - **Monospace (`--font-mono`):** `'JetBrains Mono'` or system `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` with `tabular-nums` for join codes (`QSZWAD`), timers, and scores.
- **CSP Constraint (Mandatory):** `server/lib/http.js` sets `font-src 'self'`. Never use external `fonts.googleapis.com` `@import` or `<link>` tags. Bundle only local `@font-face` `.woff2` files in `public/fonts/` (or fall back to system fonts if offline font download is skipped).
- **Type Scale & Measure:**
  - Base `16px` (`1rem`), line-height `1.55`–`1.65` for body/worksheets, `1.2`–`1.25` for headings.
  - Use `text-wrap: balance` on hero/section headings (`max-inline-size` bounded) to prevent orphan words.
  - Support existing `--student-font-scale` (`A- / A / A+`) and readable prose measure (`max-width: 68ch` on worksheet prompts/texts).

### Spacing, Radii & Shadows
- **Spacing Scale (4/8px rhythm):** `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 24px`, `--space-6: 32px`, `--space-7: 48px`.
- **Radii:** `--radius-sm: 8px`, `--radius: 12px`, `--radius-lg: 18px` (consistent nested curvature).
- **Shadow Depths (Soft UI Evolution):**
  - `--shadow-sm: 0 1px 2px rgb(15 36 34 / 6%), 0 1px 2px rgb(15 36 34 / 4%)`
  - `--shadow: 0 6px 20px rgb(15 36 34 / 8%), 0 1px 3px rgb(15 36 34 / 5%)`
  - `--shadow-lg: 0 20px 50px rgb(15 36 34 / 16%), 0 4px 12px rgb(15 36 34 / 6%)`

---

## Component & Surface Specs

1. **Buttons & Interactive Controls**
   - `cursor: pointer` on all interactive buttons, tabs, clickable cards, and options.
   - Minimum `44px` tap target height on student interactive buttons/choices/chips; compact `34px–38px` allowed for dense teacher toolbar actions (still ≥ `24px` WCAG AA minimum).
   - Pressed/hover states use color, border, or subtle elevation (`150–200ms ease`) without shifting layout bounds.
2. **Badges, Chips & Pills (`ux-guidelines.csv` No. 116 + `html-tailwind` No. 59)**
   - Keep compact status pills single-line (`white-space: nowrap`) with `flex-wrap: wrap` on collections and `min-width: 0` on shrinkable labels so badges never awkwardly wrap inside a pill or clip silently.
3. **Icons (`icons.csv` No. 105)**
   - Consistent outline SVG style (`stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`) in `public/lib/icons.js`.
   - No structural emojis in chrome/navigation/buttons (replace decorative emojis where appropriate while keeping educational content markers like ⭐ bonus intact).
   - Decorative icons beside text carry `aria-hidden="true"`; icon-only buttons carry `aria-label`.
4. **Forms & Auth (`ux-guidelines.csv` No. 107, 109)**
   - Visible labels, clear inline errors + `role="alert"` error banners, `autocomplete` attributes intact, paste never blocked (`Accessible Authentication`).
5. **Drag & Drop + Interactive Items (`ux-guidelines.csv` No. 103)**
   - Keep tap-to-place / keyboard alternatives alongside drag-and-drop in `match`, `groups`, `ordering`, and `fill_blanks`.
   - Never indicate correctness by color alone — pair `--success`/`--danger` with icons/labels (`✓`, `✗`, text feedback).
6. **Print & Accessibility Modes**
   - Preserve `@media print` clean white paper output for teacher print views and student rosters.
   - Preserve `@media (prefers-reduced-motion: reduce)` and `scroll-padding-top` so sticky headers never obscure focused elements (`Focus Not Obscured`).

---

## Anti-Patterns to Avoid (from `ui-reasoning.csv` + `ux-guidelines.csv`)
- No hidden assignments, cluttered navigation, or poor mobile ergonomics on student/class views.
- No generic AI-purple gradients or neon glow clutter on learning surfaces.
- No external CDN fonts or third-party trackers (violates `font-src 'self'` CSP & school DSGVO).
- No color-only feedback on graded answers, and no muted gray text below 4.5:1 contrast.
- No fixed-height badges/chips that clip or wrap to two lines.

## Pre-Delivery Checklist
- [ ] No emojis as structural chrome icons (consistent SVG icons with `aria-hidden="true"` or `aria-label`)
- [ ] `cursor: pointer` on all clickable elements
- [ ] Hover/focus transitions smooth (`150–250ms`) and disabled under `prefers-reduced-motion`
- [ ] Light mode & Dark mode: normal text contrast ≥ 4.5:1; UI/borders/focus ≥ 3:1
- [ ] Focus states (`:focus-visible`) clearly visible and never obscured by sticky headers
- [ ] All Playwright E2E selectors, IDs, `data-*` attributes, and `de`/`en` i18n keys preserved
- [ ] `@media print` verified clean (no headers/nav/shadows/blobs printed)
- [ ] Responsive verified at `375px`, `768px`, `1024px`, `1440px`
