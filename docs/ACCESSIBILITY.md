# Accessibility statement (OpenWidgets v0.1)

**This is an honest engineering note, not a conformance claim.** We do not claim "full
WCAG 2.2 AA". OpenWidgets *aims* at WCAG 2.1 AA for the core flows and documents what was
implemented, what was tested, and what is known to be insufficient.

Why this exists: the researched blueprint promised "Full WCAG 2.2 AA compliance" as an
architectural feature. That is not how accessibility works — it is a property of the
rendered UI and its interaction model, and it has to be tested. BookWidgets is criticised
in the same research for keyboard-inaccessible widget types; we must not repeat that with a
button-click promise. See [CRITICAL-EVALUATION.md](CRITICAL-EVALUATION.md) §3.6.

## What is implemented

| Area | Implementation |
| --- | --- |
| Keyboard operation | Every input, choice, dropdown, ordering control and button is a native focusable element. Drag is never the only way to do something: ordering has up/down buttons, matching uses `<select>`, image pins can be placed with the pointer and fine-tuned with arrow keys. |
| Focus visibility | Global `:focus-visible` ring (`public/app.css`); no focus traps outside modal dialogs; `dialog` elements use the browser's modal focus handling. |
| Semantics | `fieldset`/`legend` per item, real `<label for>` on joins/inputs, `aria-label` on icon-only buttons, `role="status"`/`aria-live="polite"` for save status and item feedback, skip links on student and teacher pages. |
| Language | `<html lang>` switches with the DE/EN toggle; TTS uses the matching voice locale. |
| Colour not alone | Live dashboard states are shown with icon **and** text label plus a legend (not just green/red), so colour-blind users can read the grid. Item feedback uses icon + text + ARIA state. |
| Text scaling | Student player has A− / A / A+ controls; layout is `rem`/relative-width based and reflows at mobile widths; long content wraps without horizontal scrolling at 320 px. |
| Motion | `prefers-reduced-motion` disables transitions/animations. |
| TTS | Read-aloud per item via `speechSynthesis` where the browser provides a matching voice (client-side; no audio leaves the device). |
| Printing | A dedicated print stylesheet renders each item type in a paper-friendly form (boxes, underscores, letter blanks, numbered ordering, labelled image regions). |
| Touch | Touch targets ~44 px on the student UI; the student player was screenshot-verified at 390 px width. |

## What was tested during this build

- Automated browser pass (Playwright/Edge) over landing, login, teacher dashboard, editor,
  live dashboard, grading, admin, print, student join, worksheet, mobile worksheet:
  no uncaught JS errors and no 5xx responses.
- API-level answer-leak tests (a security property, not accessibility).
- Manual review of the rendered screenshots for layout, contrast of state colours and
  touch-target size.
- **Not done:** no screen-reader session (NVDA/Orca), no automated axe-core audit, no
  high-contrast/forced-colours test, no zoom-400 % reflow test, no formal WCAG audit, no
  testing with real assistive-technology users.

## Known limitations (do not claim AA for these)

1. **Image-pin items** (`pins`) are inherently spatial. A keyboard alternative (arrow-key
   nudging of a selected pin) exists, but a screen-reader user cannot meaningfully "find"
   a region on a raster image from its alternative text. Use this item type as enrichment,
   not as the only assessment of a learning objective.
2. **Matching** is a series of dropdowns; that is keyboard-usable but verbose for screen
   readers on long lists. Prefer ≤ 8 pairs.
3. **No rich-text/tables** in item stems (markdown-lite only) — this *helps* accessibility
   (no arbitrary layout), but teachers cannot make visual tables.
4. The live dashboard is an information-dense grid; the anonymize ("Namen ausblenden")
   mode is visual (CSS), so it hides names from a projector, **not** from assistive tech.
5. **No audio/photo response items** yet (thus no captions/transcripts/consent story).
6. Labels for choice letters like "A/B/C" in print are visual only; the digital UI uses
   native radio/checkbox semantics.

## Recommended next steps before relying on this in an exam context

1. Run a keyboard-only pass per item type with the actual pupil devices.
2. Run one NVDA (Windows) or Orca (Linux) session per page with a teacher and a pupil.
3. Add axe-core to the Playwright suite (dev-only dependency) and triage results.
4. Decide formally whether pins/ordering remain permitted in graded work under the
   school's inclusion policy.

If accessibility is a hard procurement requirement, treat OpenWidgets as **partially
conformant and unaudited** until the steps above are done — the same standard we apply to
vendors.
