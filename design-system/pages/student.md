# Student Player & Item Renderers Override — OpenWidgets

> Overrides/extends `design-system/MASTER.md` for `public/student.html`, `public/student.css`, and `public/render/render.css`.

- **Focus:** Calm, distraction-free worksheet readability (`line-height: 1.6` on reading blocks, `scroll-padding-top: 76px`, `scroll-padding-bottom: 96px`).
- **Touch & Interaction:** Minimum `44px–46px` choice rows and interactive targets; `42px × 42px` icon buttons; tap-to-place/keyboard alternatives retained alongside drag-and-drop.
- **Visual Hierarchy:** Calm teal item-number pills (`--primary-soft` / `--primary-hover` with subtle border) instead of glowing orbs; `4px` teal top accent bar on `.student-join` and `.student-result-hero`.
- **Accessibility:** Never use color alone for graded feedback; pair `--success` / `--danger` with check/cross icons and text labels; keep `--student-font-scale` (`A- / A / A+`) and `@media print` intact.
