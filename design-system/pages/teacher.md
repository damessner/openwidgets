# Teacher Studio Override — OpenWidgets

> Overrides/extends `design-system/MASTER.md` for `public/teacher/index.html` and `public/teacher/teacher.css`.

- **Density:** Compact scannable workspace (`table` rows, editor panels, live classroom grid, grading view) with `tabular-nums` on counts/scores/timestamps.
- **KPI Stat Cards:** Semantic icon tile coding (`:nth-child(1)` teal, `:nth-child(2)` emerald, `:nth-child(3)` warm amber, `:nth-child(4)` sky blue) with soft tinted borders.
- **Page Heading:** Restrained `40px × 3px` solid `--primary` accent underline on `.page-title::after`.
- **Interactive Canvas & Print:** Editor image-boxes and ghost outlines use `color-mix(in srgb, var(--primary) ...)` instead of hardcoded hex; `@media print` stays crisp white/black paper.
