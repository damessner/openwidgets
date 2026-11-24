# Critical Evaluation — "Architectural Deconstruction of das proprietäre Originalprodukt and Engineering Blueprint for OpenWidget Engine"

| | |
|---|---|
| **Reviewer** | research-critic (independent; did not write the research document, the contract, or app code) |
| **Date of review** | 2026-11-09 (Europe/Vienna) |
| **Primary source under review** | [`docs/USER-RESEARCH.md`](USER-RESEARCH.md) (archived verbatim user research, 370 lines) |
| **Architecture under scrutiny (our build)** | [`docs/CONTRACT.md`](CONTRACT.md) — OpenWidgets v0.1, single Node 24 process, zero runtime deps, SQLite, SSE, ~9 item types, single LXC |
| **Web evidence** | gathered live 2026-11-09, ~33 fetches; every URL below was fetched in this session unless explicitly marked otherwise. Vendor pages that are client-rendered are called out. |
| **Verdict in one line** | The research is a useful *product inventory* of das proprietäre Originalprodukt and its commercial facts are mostly right, but its **engineering blueprint is 5–10× too large for the deployment that actually exists** and contains internal contradictions; the team's MVP is the **right shape** and far better matched to one Austrian secondary school, but it is under-engineered in a handful of classroom-critical places. |

---

## 0. Executive summary

**What the research gets right (and should be used):**

1. das proprietäre Originalprodukt really is a broad, mature proprietary authoring + assessment tool; "40+ widget types" and "30 auto-graded question types" are accurate ([question-types page](https://www.das proprietäre Originalprodukt.com/question-types), [widget library](https://www.das proprietäre Originalprodukt.com/widget-library), [sitemap](https://www.das proprietäre Originalprodukt.com/sitemap.xml)).
2. It really has **no open-standard activity interchange**: the vendor states that exported data **cannot be re-imported** and offers only results exports (CSV, PDF, ZIP) and print/PDF of activities ([KB U080](https://kb.das proprietäre Originalprodukt.com/article/187-about-archiving-and-exporting), [KB U008](https://kb.das proprietäre Originalprodukt.com/article/19-how-can-i-print-a-quiz-widget-with-or-without-answers)). There is no QTI/H5P export and no activity import format. The *lock-in conclusion is correct* even though the document's absolute phrasing is wrong.
3. The Live Widgets feature description is **substantially accurate**, down to the yellow/white presence cells and the green/red/orange/blue per-item state colours ([vendor Live Widgets teacher guide](https://www.das proprietäre Originalprodukt.com/blog/2023/09/how-to-monitor-student-progress-with-live-widgets-the-complete-teacher-guide)).
4. Data-sovereignty reasoning (student data on a US/cloud SaaS vs. self-hosted in Austria) is directionally correct and is the strongest argument for this project.
5. Exam-lockdown thinking is legitimate: das proprietäre Originalprodukt does integrate with Safe Exam Browser and does have real limitations there — but the research describes the mechanism incorrectly (see §3.6).

**What is wrong, unverifiable, or materially misleading (do not build on it):**

1. **The blueprint targets hardware the school does not have.** Kubernetes, PostgreSQL 16, Redis 7, a MinIO cluster, BullMQ workers, and a **self-hosted LLM** on a single ~2 vCPU / 2 GB LXC is not "a deployment", it's a wish. The LLM alone needs more RAM than the entire container. The document never once asks what the school's Proxmox host actually has.
2. **The blueprint is internally contradictory on grading and cheating.** It promises (a) client-side auto-grading for instant feedback, (b) server-side authoritative re-scoring "to prevent score manipulation", and (c) offline-first operation where the client keeps working without a server. (a) and (c) require answer keys on the client; that is *exactly* the attack (b) claims to defend against. das proprietäre Originalprodukt itself has a public KB article about students reading solutions from the browser console ([KB U063](https://kb.das proprietäre Originalprodukt.com/article/147-can-students-see-solutions-in-the-browsers-developer-view)) — the failure mode is real, and the blueprint's own design walks into it.
3. **CRDT/Yjs is the wrong tool** for single-writer student attempts, and the described "authoritative merge" is not a CRDT operation. This is cargo-culted offline-first architecture.
4. **The 37-question-type number is not what the vendor says.** das proprietäre Originalprodukt' own page says **36** question types (30 auto-graded); its widget library says "over 35". The page happens to list 37 entries if you count "Rubric", which is arguably a scoring instrument, not a question type. The research's own table has 37 rows — so it is defensible only as a row count, not as a vendor fact.
5. **Several implementation-mechanism claims are invented.** MathQuill + symbolic CAS, Levenshtein distance for word ordering, WebRTC audio recording, "cryptographic configuration key" SEB handshake, and Chromebook "Exam Links/Exam Codes" have **no public documentation** and in two cases are technically wrong (audio capture is `MediaRecorder`/`getUserMedia`, not WebRTC; das proprietäre Originalprodukt' documented SEB integration is two plaintext passwords plus an *unencrypted* config template, and the vendor explicitly says SEB is **not available on Chromebooks**). These are presented as architecture facts; they are guesses.
6. **The "3 out of 5 stars accessibility audit" is unverifiable.** The vendor publishes a VPAT and an ADA statement that *self-admits* keyboard-inaccessible widget types; no third-party 3/5 rating could be found. The underlying critique (complex interactions fail keyboard/ARIA) is **more defensible than the citation**, and is confirmed by the vendor's own statement.
7. **"No export/import mechanism at all" is false as written** — results export to CSV/PDF/ZIP exists and activities print to PDF. The correct claim is narrower: *no open-standard activity export and no import at all.* The difference matters for our roadmap (see §4).
8. **The blueprint's "Full WCAG 2.2 AA compliance" is an unfalsifiable promise**, not a design. Shadow DOM does not create accessibility; drag-and-drop, canvas, piano, 3D and whiteboard widgets cannot be made AA-compliant cheaply. Claiming AA before a test plan is the same mistake the research criticises das proprietäre Originalprodukt for.
9. **Effort is never estimated.** The four phases, as written, are a 1–2 engineer-year programme (40–80+ person-weeks) plus hardware, AI, and ongoing maintenance. The document reads as if a school teacher with a Proxmox box can ship it. That gap is the single most expensive error in the document.

**What this means for OpenWidgets v0.1:** keep the MVP scope in [`CONTRACT.md`](CONTRACT.md). Do **not** import any of the blueprint's infrastructure (K8s/Postgres/Redis/MinIO/LLM/QTI) into v0.1. Do close the MVP's five real classroom gaps (§5) and the three security/data-protection gaps (§7). The honest effort to "80 % of everyday classroom use" is **~15–20 person-weeks** for a competent solo developer with this contract and no design system; the blueprint equivalent is **~50–80+ person-weeks** before it is even operable on the target hardware.

---

## 1. Scope, method, and honesty about limits

**What was verified:** das proprietäre Originalprodukt marketing/pricing/library/question-types/Live/accessibility/AI pages, the public knowledge base (Help Scout), the sitemap, one third-party pricing review, Proxmox LXC documentation, and the Node.js v24 SQLite API docs. URLs are cited inline; the full source list is in §10.

**What could not be verified — stated rather than guessed:**

| Thing | Why not | Status |
|---|---|---|
| Current prices on the vendor page | `https://www.das proprietäre Originalprodukt.com/pricing` returns HTTP 200 but **renders no prices at all** (client-side/Javascript pricing widget). The Wayback snapshot of 2026-01-14 is equally blank. | Price numbers are corroborated only by a third-party review that says it read the vendor's pricing-page data on 2026-10-04 ([Conversion Gems](https://www.conversiongems.com/tools/das proprietäre Originalprodukt)). Treat as **secondary, not primary**. |
| VPAT contents | `https://www.das proprietäre Originalprodukt.com/resources/vpat.pdf` is served as `application/pdf`, which the fetch tool cannot decode. | Content **unknown**; only the link's existence is verified ([accessibility page](https://www.das proprietäre Originalprodukt.com/accessibility)). |
| "3 out of 5 stars" third-party accessibility rating | No trace on the vendor site, the public KB, Common Sense Education (whose edtech review programme was paused in January 2026 — [their FAQ](https://www.commonsense.org/education/reviews/FAQ)), or the one review site that could be fetched. | **Unverifiable.** |
| Keyword scoring syntax `father##dad` / `photosynthesis##2` | Not in any public KB article; KB search returns nothing; external search returns nothing. It may exist in in-product help. | **Unverifiable.** |
| Internal algorithms (MathQuill, CAS, Levenshtein, stoichiometry, heartbeat mechanism) | Vendor publishes marketing and teacher help, not implementation. | **Unverifiable / inferred.** |
| Chromebook "Exam Links"/"Exam Codes" | No vendor documentation found; vendor KB says SEB is **not available on Chromebooks**; ChromeOS kiosk mode is a Google Admin feature, not a das proprietäre Originalprodukt documented one. | **Unverified and contradicted in part.** |
| Clever / ClassLink SSO | Vendor's integration pages list Google Classroom, Microsoft Teams, Canvas, Schoology, Moodle, Blackboard, Brightspace, itslearning. No Clever/ClassLink evidence found. | **Unverifiable.** |
| The school's actual Proxmox host, network, DNS, device fleet, LMS | Outside this review; deployment doc makes explicit assumptions ([`DEPLOY-LXC.md`](DEPLOY-LXC.md)). | Assumption, not fact. |

**Fetch-failure disclosure:** `https://edtechimpact.com/products/das proprietäre Originalprodukt/` failed to fetch (network error), and the KB's GET search endpoint returns "no articles" even for terms that certainly exist, so absence of a hit is weak evidence. I did not bypass any login, paywall, or robots restriction, and I did not run the app or install anything.

**Evidence-staleness warning:** das proprietäre Originalprodukt' site carries `lastmod 2026-11-08` and `© 2013-2026`, i.e. it is actively changing. Any fact here is a snapshot of 2026-11-09. Pricing/marketing claims are the kind of thing that changes without notice; re-check before quoting in a parent letter or a procurement document.

---

## 2. Fact-check table

Legend: **VERIFIED** = found in a primary vendor source fetched in this session · **VERIFIED (SECONDARY)** = only third-party corroboration · **PARTLY TRUE** = core is right, wording/number/detail is wrong · **FALSE** = contradicted by a primary source · **OUTDATED** = was true, no longer is · **UNVERIFIABLE** = no public source; explicitly not confirmed.

| # | Claim as researched | Status | Evidence (URL) | Implication for OpenWidgets |
|---|---|---|---|---|
| 1 | Individual teacher plan $11.95/month or $67/year | **VERIFIED (SECONDARY)** | Vendor pricing page renders **no prices** ([pricing](https://www.das proprietäre Originalprodukt.com/pricing)); third-party review states exactly these figures and says "checked 4 October 2026" ([Conversion Gems](https://www.conversiongems.com/tools/das proprietäre Originalprodukt)) | Use as a ballpark, not a citable primary fact. For an Austrian school the useful argument is structural (per-seat recurring cost, no self-hosting), not the exact dollar figure. |
| 2 | 5-teacher group: $67/teacher/year, $335 annual minimum | **VERIFIED (SECONDARY)** | Same third-party source ("Teacher Group (5 teachers) $67 per teacher/yr ($335)") | Same. Note VAT excluded for EU per that source; EUR list exists. |
| 3 | 10+ group: $49.50/teacher/year | **VERIFIED (SECONDARY)** | Same source | Same. |
| 4 | Individual plan limited to Google Classroom + Microsoft Teams | **VERIFIED (SECONDARY)** | Same source: Teacher plan = "Google Classroom and Teams; das proprietäre Originalprodukt logo shown"; group plan = "Any LTI LMS, no logo, full design options" | Supports the "LTI is effectively enterprise-tier" argument, but see #5. |
| 5 | Full LTI 1.3 only on group/site plans | **UNVERIFIABLE (plausible)** | LTI 1.3 registration is real and **sales-mediated**: admin emails `sales@das proprietäre Originalprodukt.com` for a per-LMS-instance JWKS URL ([KB T008](https://kb.das proprietäre Originalprodukt.com/article/504-adding-das proprietäre Originalprodukt-to-an-lms-as-an-lti-1-3-tool)); [Moodle page](https://www.das proprietäre Originalprodukt.com/moodle) says "contact us to get the necessary credentials". **No public page states the tier restriction.** | The practical point stands (LTI = sales conversation), but do not quote a tier rule as vendor policy. |
| 6 | 30-day free trial | **VERIFIED** | [pricing page](https://www.das proprietäre Originalprodukt.com/pricing): "We offer a free, 30-day trial" | n/a |
| 7 | "Over 40 templates across 6 domains" | **PARTLY TRUE** | 40+ **VERIFIED** ([widget-library](https://www.das proprietäre Originalprodukt.com/widget-library): "over 40 widget types"; [question-types](https://www.das proprietäre Originalprodukt.com/question-types): same). Sitemap lists **42** widget-type pages ([sitemap.xml](https://www.das proprietäre Originalprodukt.com/sitemap.xml)). The "6 domains" grouping is the researcher's own taxonomy, not a vendor statement; the table omits at least a dozen real widgets (PDF viewer, YouTube/Vimeo player, web embed, Google Maps, Wikipedia browser, image viewer/carousel, before-after, frame sequence, spot-the-difference, randomness, random images, piano, 3D, bingo, exit slip, form/survey, tiptiles) | "40+" is safe to cite. Do not present our 9 item types as covering "the library" — we will cover a chosen slice. |
| 8 | Quiz/Worksheet/Split Worksheet/Video Quiz: "37 question types, 30 auto-graded" | **PARTLY TRUE / WRONG NUMBER** | Vendor's own text: "**36** question types. **30** of them can get automatically graded" ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)); widget library says "over 35 question types - 30 with auto-grading" ([widget-library](https://www.das proprietäre Originalprodukt.com/widget-library)). The page lists 37 entries **if Rubric is counted**. The research table has exactly 37 rows (Rubric included) | 30 auto-graded = correct. "37" is defensible only as a row count, contradicts vendor prose. Our MVP's 9 types ≈ a **quarter** of the vendor's scope; say so honestly. |
| 9 | No native export to QTI/H5P, no export/import mechanism at all | **PARTLY TRUE — absolute half is FALSE** | QTI/H5P: **verified absence** — the vendor's own export article lists only archives, CSV grades, print/PDF, PDF submissions, ZIP results exports, and states: "Exported data **cannot be re-imported** into das proprietäre Originalprodukt" ([KB U080](https://kb.das proprietäre Originalprodukt.com/article/187-about-archiving-and-exporting)); print/PDF + answer key release-print is a documented workflow ([KB U008](https://kb.das proprietäre Originalprodukt.com/article/19-how-can-i-print-a-quiz-widget-with-or-without-answers)). So: **no open-standard activity interchange** ✔; **"no export/import at all"** ✘ | Important distinction for our roadmap: QTI *import* would not rescue a das proprietäre Originalprodukt migration anyway (source can't export). The real migration cost is **re-authoring**, which argues for a paste-first authoring UX, not for QTI in v0.1. |
| 10 | Accessibility: third-party audits rate "3 out of 5 stars" | **UNVERIFIABLE** | No such rating found. Vendor publishes an ADA statement and a VPAT link; no star rating ([accessibility](https://www.das proprietäre Originalprodukt.com/accessibility)) | Do not repeat the 3/5 claim in any school-facing material. |
| 11 | Complex interactions fail semantic DOM/ARIA/keyboard audit | **PARTLY VERIFIED — via vendor self-admission, not audits** | Vendor: "some widgets or question types... have a function which can't be controlled by a keyboard, e.g. drawing in the whiteboard widget"; "dragging and dropping of images..."; ADA compliance is delegated to the creator ([accessibility](https://www.das proprietäre Originalprodukt.com/accessibility)). No third-party audit text found | The **critique** is fair; the **sourcing** is wrong. This is also a warning for us: our drag-drop item types inherit the same problem unless we ship keyboard alternatives (our contract does require them — §5). |
| 12 | Live Widgets: heartbeat presence (yellow active / white idle) | **VERIFIED** | Vendor teacher guide, verbatim: "the box will be _bright yellow_. When your students have stopped working for a few minutes, the _yellow will diminish and become white_." ([blog](https://www.das proprietäre Originalprodukt.com/blog/2023/09/how-to-monitor-student-progress-with-live-widgets-the-complete-teacher-guide)) | Matches our SSE presence design (35 s "online", heartbeat ≤ every 15 s) — our mechanism is documented in `CONTRACT.md` §5.6. |
| 13 | Continuous score matrix | **VERIFIED** | Same guide: "Score... at the moment your students are going through your activity", progress bar, envelope on submit | Our live dashboard shows per-player score/maxScore continuously. |
| 14 | Per-item state colours green/red/orange/blue | **VERIFIED, exact mapping** | Same guide: red = "answered completely incorrectly", green = correct, orange = "anything in between", blue = "not auto-graded" | Our `state` enum is `unanswered|correct|partial|incorrect|manual` (`CONTRACT.md` §5.6). Colours need to be **assigned in CSS with labels/icons too** — colour alone fails WCAG 1.4.1 (see §7). |
| 15 | Aggregated item heatmaps | **PARTLY TRUE** | Vendor has a per-question **"open the question view for all your students"** and **"average auto-graded score for each question"** (same guide). It is not described as a heatmap. | "Heatmap" is an embellishment. Our per-item aggregate view is a reasonable v0.2 feature; not needed for parity claims. |
| 16 | Remote force-submit / reset | **VERIFIED** | Same guide, cogwheel: "submit the work of a student yourself" and "delete the student... resetting their widget". Our API: `POST /api/participants/:id/submit`, `POST /api/participants/:id/reset` (`CONTRACT.md` §5.5) | We have parity in v0.1. |
| 17 | Privacy anonymization toggle | **VERIFIED (with correction)** | Same guide: "eye icon to _blur_ the students' names". It is a **blur toggle**, not "randomized pseudonyms or blurred filters" | Our contract does not have it. Low effort (CSS class + a11y: blurred text must not be in the accessibility tree if truly anonymised). Nice cheap win. |
| 18 | Long-answer keyword syntax `father##dad` (alternatives) and `photosynthesis##2` (weights) | **UNVERIFIABLE** | Not in the public KB; KB search yields nothing; external search yields nothing. May live in in-product help. | Do **not** copy the cryptic `##` syntax. Our contract uses structured `{text, alternatives, points}`; if teachers want shortcuts, add a parser later — a syntax that produces silently-wrong grading is worse than a form. |
| 19 | SEB via "cryptographic configuration key or password handshake" | **FALSE / MISLEADING** | Documented integration = **Settings password** + **Quit/unlock password** + optional upload of an **unencrypted `.SEB` configuration template**; requirement: "Widgets must be shared inside a supported LMS integration"; only Quiz/Worksheet/Split Worksheet/Video Quiz support it ([KB U036](https://kb.das proprietäre Originalprodukt.com/article/42-using-widgets-in-safe-exam-browser)). No BEK/CK (Browser/Config Key) verification is documented. | If we ever do SEB, the honest design is: SEB config file distribution + a server check of a **hash/header** we control; SEB's real Browser Exam Key mechanism is a server-side config-hash check — but be aware students can be handed the config, so it is deterrence, not security. |
| 20 | SEB locks macOS/Windows/iOS; Chromebook kiosk "Exam Links"/"Exam Codes" | **PARTLY TRUE + FALSE for Chromebook** | SEB platforms are iOS/Windows/macOS, and the vendor explicitly says: "**Safe Exam Browser is not available for Chromebooks**" ([KB U036](https://kb.das proprietäre Originalprodukt.com/article/42-using-widgets-in-safe-exam-browser)). No "Exam Links"/"Exam Codes" found | Big one for a school with Chromebooks: the blueprint's Phase-3 Chromebook-kiosk routing is solving a problem that the named technology does not solve. Chromebook exam lockdown = Google Admin **managed guest session / kiosk app**, not SEB. |
| 21 | Students can access without login: short URL, session code, QR; plus SSO (Google, Entra, Clever, ClassLink) | **PARTLY TRUE** | Short links and **shortcodes** exist; shortcode sharing is **disabled by default** and has explicit limitations: no Live Widgets, students must type names, results not LMS-synced ([KB U078](https://kb.das proprietäre Originalprodukt.com/article/183-what-does-the-dot-in-a-widgets-shortcode-mean)). Deep links look like `https://www.das proprietäre Originalprodukt.com/play/t:...` (examples in vendor blog). **No "session code" or QR feature found.** Google/Microsoft SSO verified via Classroom/Teams pages; CLAIMED Clever/ClassLink not found; LTI list verified via KB/Moodle page | Our anonymous join-by-6-char-code + name **is already better than das proprietäre Originalprodukt' anonymous mode** (their anonymous mode loses Live and gradebook). No QR in our MVP (Lead confirmed); that is the one gap vs the research's claim. |
| 22 | Split worksheet dual-pane viewport (left reference doc, right questions) | **VERIFIED (existence) / PARTLY for specifics** | Split Worksheet is a real library widget ([sitemap](https://www.das proprietäre Originalprodukt.com/sitemap.xml), [widget-library](https://www.das proprietäre Originalprodukt.com/widget-library)); the dual-pane description matches the product's name and teacher-facing material. The exact pane content types (rich text, multi-page PDF, audio, video) were not re-verified on the dedicated page | We cut split-worksheet from v0.1. Reasonable: it is the single most expensive "layout" widget. Revisit in v0.3 with PDF viewer. |
| 23 | "Question pages" with pinned media | **UNVERIFIABLE** | Not found in public KB/marketing pages fetched. Plausible feature. | Do not put in a parity matrix as "missing" without a caveat; treat as unverified. |
| 24 | PDF/Word ingestion into questions (heuristic text extraction) | **PARTLY TRUE / MISCHARACTERISED** | The capability exists, but it is the **AI Assistant** (launched ~Nov 2026): "Turn .docx and PDF worksheets into interactive widgets" ([ai-assistant](https://www.das proprietäre Originalprodukt.com/ai-assistant)). "Heuristic text extraction" is the researcher's guess and likely wrong — it is AI-assisted and brand new. | If we ever do ingestion: a deterministic "paste → split into items" helper for v0.2 is cheap and has no LLM/DSGVO questions; AI ingestion is explicitly out. |
| 25 | AI assistant with human-in-the-loop approval | **VERIFIED** | "Every AI proposal must be reviewed, can be changed, and must be explicitly accepted before it is added" ([ai-assistant](https://www.das proprietäre Originalprodukt.com/ai-assistant)) | Out of scope for v0.1; if added, the human gate must be *in the UI*, not a promise. |
| 26 | Levenshtein distance used for word-ordering grading | **UNVERIFIABLE** | No public source. The research itself hedges ("Levenshtein distance **or** exact sequential array comparison"). | Irrelevant to our design: our ordering scorer uses position/exact modes (`CONTRACT.md` §4.1) — simpler and explainable to teachers. |
| 27 | MathQuill + symbolic computer algebra for equations | **UNVERIFIABLE** | Vendor documents LaTeX support and an "equations" question type with a symbol palette ([KB U070](https://kb.das proprietäre Originalprodukt.com/article/161-using-the-formula-editor)); **no mention of MathQuill, KaTeX, or CAS**. The equations type is documented as "strictly for numerical, non-textual answers" | Do not assume CAS equivalence is table stakes. A plain numeric item with tolerance + a LaTeX-rendering *later* is a defensible 80/20. |
| 28 | Stoichiometric chemical-equation balancing verification | **QUESTION TYPE VERIFIED, algorithm unverifiable** | "Balance chemical equation" is a listed question type ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)) | Cut for v0.1; if ever, it is a self-contained algorithmic item (~1 week with tests). |
| 29 | Audio recording via WebRTC | **PARTLY TRUE — WRONG TECHNOLOGY** | "Audio recording" question type is verified ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)). Browser microphone capture is `navigator.mediaDevices.getUserMedia` + `MediaRecorder`; **WebRTC** (peer connections) is not required or implied | If we add "record answer" in v0.3: it is ~1–2 pw including storage, playback, *and the DSGVO consent/retention story for minors' voices* — the last part is bigger than the feature. |
| 30 | "Rubric" standalone widget | **PARTLY TRUE — not standalone** | Rubric is a listed **question type** inside Quiz/Worksheet/Split Worksheet/Video Quiz ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)); it is not in the widget library's widget-type list ([sitemap](https://www.das proprietäre Originalprodukt.com/sitemap.xml)) | Our `long_answer.rubric` config gives teacher-side rubrics without pretending to be a separate activity. Fine. |
| 31 | "Rated multiple choice" | **VERIFIED** | Listed as a question type ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)) | Not in v0.1; low value for us. |
| 32 | 36–37 item "mechanism" column of the table generally | **UNVERIFIABLE — inferred** | Vendor documents *what* the types do, not *how*. Several mechanism descriptions are plausible reverse engineering, some are wrong (SEB, WebRTC, Chromebook, ingestion) | Treat the whole "Automated Evaluation & Scoring Mechanism" column as hypothesis, not evidence. Our build should be driven by the contract, not by these guesses. |
| 33 | Subscription lapse: editing freezes, LTI endpoints stop, data trapped | **PARTLY TRUE** | Third-party review: account/widgets/submissions saved, but editor closed and LMS integrations/grade sync/Live stop ([Conversion Gems](https://www.conversiongems.com/tools/das proprietäre Originalprodukt)); vendor says results remain accessible and downloadable, "no limit has been set" on storage ([KB U080](https://kb.das proprietäre Originalprodukt.com/article/187-about-archiving-and-exporting)) | The lock-in argument should be "you cannot hand the *authoring* to another tool", not "your data is deleted". Accuracy here protects our credibility. |
| 34 | No offline-first architecture; network drops cause failures | **LIKELY TRUE / UNVERIFIED** | No vendor offline/PWA documentation found; the absence of an offline mode is consistent with all evidence | Our MVP has the same fundamental weakness (autosave retry queue only). Do not market "offline"; market "no data loss on reload" (localStorage retry queue + server-autosave). |

**Scorecard:** of the ~34 claims examined, roughly **12 verified, 10 partly true/number-or-wording-wrong, 2 false as written (SEB crypto handshake; "no export/import at all"), 1 technically wrong (WebRTC), 1 wrong for the target hardware (Chromebook SEB), and ~9 unverifiable implementation details.** For a document presented as an "architectural deconstruction", the verified surface is marketing + help-centre knowledge, and the architectural layer is invention. That is acceptable as *research input*; it is not a basis for an engineering plan without the corrections above.

---

## 3. Findings that actually change decisions

### 3.1 Pricing is directionally right but not primary-sourced; it should not be quoted to a head teacher as fact

The vendor's own pricing page is a Javascript shell that renders no numbers (`https://www.das proprietäre Originalprodukt.com/pricing`, fetched 2026-11-09, HTTP 200; the 2026-01-14 Wayback capture is equally empty). The only corroboration found is a third-party review that explicitly claims to have read the pricing page on 2026-10-04 and matches the researched tiers, including the "single teacher = Classroom + Teams only" restriction and a $295/yr commercial tier the research did not mention ([Conversion Gems](https://www.conversiongems.com/tools/das proprietäre Originalprodukt)).

**Action:** cite the *structure* (per-teacher annual licence; group tier needed for LTI; 30-day trial), keep the dollar figures as "reported" with a re-check date, and avoid the "3/5 stars" claim entirely.

### 3.2 The count is 36 (officially), not 37 — and the library is bigger than the research's six-domain table

Vendor prose is unambiguous: "36 question types. 30 of them can get automatically graded" ([question-types](https://www.das proprietäre Originalprodukt.com/question-types)). The widget library's own prose is "over 35 question types" and "over 40 widget types" ([widget-library](https://www.das proprietäre Originalprodukt.com/widget-library)). The sitemap enumerates **42** widget-type pages ([sitemap.xml](https://www.das proprietäre Originalprodukt.com/sitemap.xml)). Note the vendor's own internal inconsistency (36 vs 37 on the same page; 42 widgets in the sitemap vs "over 40" in prose) — this is a marketing site, not a spec.

**Action:** in our docs and UI copy, never claim "exactly matches das proprietäre Originalprodukt". Say: "covers the most-used item types; see the comparison table."

### 3.3 Lock-in is real, but the mechanism is "no activity interchange", not "no export at all"

Verified: activity content cannot leave the platform in any machine-readable, re-importable form. Results can be exported as CSV, per-submission PDFs, or a ZIP; activities can be printed/PDF'd, including answer keys ([KB U080](https://kb.das proprietäre Originalprodukt.com/article/187-about-archiving-and-exporting), [KB U008](https://kb.das proprietäre Originalprodukt.com/article/19-how-can-i-print-a-quiz-widget-with-or-without-answers)). The vendor states outright that exported data **cannot be re-imported**.

**Action (roadmap):** QTI 3.0 import is *not* the migration answer, because the source cannot produce QTI. Migration is re-authoring, so invest in (a) fast structured authoring, (b) a *paper/PDF-side* workbook so teachers can print a blank worksheet and use it side-by-side, and (c) eventually a plain-JSON export that other tools could consume. A "paste from Word" sanitizer is worth more to teachers than a QTI transpiler. If we later need Moodle interop, a **QTI import of a *subset*** is the cheaper half compared to export.

### 3.4 Live Widgets is the strongest product idea and our SSE design is honest parity — with a differentiator

Verified feature-by-feature in §2 rows 12–17. Critically, das proprietäre Originalprodukt' Live Widgets **requires an LMS integration and identified students** — the anonymous shortcode path explicitly loses Live Widgets ([KB U078](https://kb.das proprietäre Originalprodukt.com/article/183-what-does-the-dot-in-a-widgets-shortcode-mean)). Our v0.1 gives a live dashboard to *anonymous code-joining students*, which is a genuine advantage for a school without a class-roster integration.

**Action:** keep SSE (`flush_interval -1` on Caddy — see deployment doc), keep force-submit/reset, add the cheap "blur names" toggle, and **add labels/icons to the green/orange/red/blue states** so we do not repeat das proprietäre Originalprodukt' colour-only accessibility problem.

### 3.5 The exam-security claims are the weakest part of the research and must not shape our roadmap

- SEB integration is thin and password-based; it is **not available on Chromebooks** (vendor says so) and requires an LMS ([KB U036](https://kb.das proprietäre Originalprodukt.com/article/42-using-widgets-in-safe-exam-browser)).
- "Cryptographic key/handshake" and "Exam Links/Exam Codes" are not documented anywhere; they appear to be invented composites of SEB's real (separate) Browser Exam Key mechanism and Google's ChromeOS kiosk feature.
- The research's own blueprint then proposes `seb_config_hash` in the DB — which is at least the right *shape* (verify a hash the server knows), but note the honest threat model: a determined student with the config file and dev tools can replay the header; SEB is deterrence for low-stakes and a *supported environment*, not an anti-cheat guarantee.

**Action:** for v0.1/v0.2 do **not** promise exam lockdown. Instead ship: per-assignment time limit (already in `CONTRACT.md`), submission window close, server-authoritative timing, force-submit, and a documented "classroom exam" checklist (devices charged, WiFi tested, teacher in room). If the school needs Summative/„Schularbeit" lockdown, the realistic answer is *managed Chromebook kiosk sessions run by the school's Google Admin* + our plain web app in them, or continue paper. This is an * organisational* answer, not a feature.

### 3.6 Accessibility: the research criticises das proprietäre Originalprodukt' accessibility with an unverifiable citation — and then promises "Full WCAG 2.2 AA", which is worse

Verified vendor position: compatibility depends on the widget type and configuration; some types are inherently not keyboard-operable; ADA/accessibility responsibility is pushed to the content creator ([accessibility](https://www.das proprietäre Originalprodukt.com/accessibility)). That is a fair basis for criticism — no star rating needed.

**Action for us:** `CONTRACT.md` says "WCAG 2.1 AA target; do not overclaim 2.2 AA" — keep exactly that discipline. Ship a written **accessibility conformance note** that says what was tested (keyboard-only pass on all 9 item types, screen-reader smoke test with NVDA/Orca, focus order, colour-not-only), what was not tested, and what is known-not-AA (coordinate pins without an equivalent, if any). Never ship a "full AA" claim.

### 3.7 The AI assistant exists and is newer than the research assumes

The AI Assistant is real, launched around November 2026, transforms `.docx`/PDF worksheets, generates questions/rubrics/images, and enforces an explicit teacher-approval gate ([ai-assistant](https://www.das proprietäre Originalprodukt.com/ai-assistant)). Two implications: (a) the research's "heuristic text extraction" is out of date/wrong; (b) AI authoring is a **current competitive pressure on teacher time** — which is the main reason a self-hosted tool without AI must still be *fast to author*, not just free. For our school, an LLM is still the wrong v0.1 answer (RAM/GPU, DSGVO, quality in German, maintenance); a good clipboard/paste path and duplicate-and-edit is the right answer.

---

## 4. Architectural critique of the blueprint

The blueprint's target topology (USER-RESEARCH §"OpenWidget Multi-Tier System Topology" and the Docker/Kubernetes paragraph) versus the actual deployment target:

| Blueprint component | What it implies on a 2 vCPU / 2 GB / 16 GB LXC | Verdict |
|---|---|---|
| Kubernetes (+ ingress) | A control plane alone typically wants ~1.5–2 GB RAM; k3s in an unprivileged LXC needs nesting/keyctl and is not what Proxmox documents as the supported pattern ([Proxmox LXC docs](https://pve.proxmox.com/wiki/Linux_Container)) | **Overkill by 2 orders of magnitude.** Cut. One systemd service. |
| Traefik/NGINX edge + LTI gateway (Fastify/Ltijs) | A second framework process + cert management | **Overkill**; Caddy does TLS + reverse proxy in one static binary. LTI later, not now. |
| Fastify/Go + GraphQL API | Two API paradigms at once; GraphQL brings schema/resolver/N+1 work with no client need | **Overkill.** `node:http` + JSON REST is in `CONTRACT.md` and is right for ~10 endpoints of internal use. |
| PostgreSQL 16 (+ JSONB) | A DB server process (~100–300 MB + cache) + connection pooling + backups, for a single-school dataset measured in tens of MB | **Overkill.** SQLite (WAL) is the correct choice; `node:sqlite` is built in. Single-writer is *not* a constraint at 1 school (see §5.3 for the one real caveat). |
| Redis 7 (presence cache + pub/sub) | Another daemon, persistence policy, a second source of truth for presence | **Overkill.** In-process `Map` + SSE fan-out; presence is ephemeral by definition — losing it on restart is fine. |
| MinIO cluster (S3) | "Cluster" implies ≥4 drives for erasure coding; even single-node MinIO is a daemon + bucket/user management | **Overkill.** Local filesystem + content-addressed asset ids (contract: `${DATA_DIR}/assets/<assetId>`) is enough; backups capture it. |
| BullMQ worker pool | A queue daemon + workers for work that is currently *milliseconds* (auto-grading) | **Overkill.** Grading is pure functions; the only async-ish work is future PDF/audio processing. |
| Yjs CRDT + Service Worker + IndexedDB | Offline-first is a multi-month subsystem; CRDT is for *concurrent multi-writer* editing, not one student's attempt | **Wrong tool + scope explosion.** See §4.1. |
| Self-hosted LLM (Ollama/vLLM; Llama 3/Mistral/Qwen) on "internal server GPUs" | The deployment target is one LXC on a Proxmox host with **no GPU mentioned**; a 7–8 B model wants ~8–16 GB RAM/VRAM and still writes mediocre German distractors | **Not deployable on the target.** Cut. If ever, run it on a *separate* machine with a GPU, opt-in per school, and document the data flow. |
| QTI 3.0 bi-directional + H5P export + PCI + xAPI | QTI 3.0 is a large spec; mapping 37 interaction types to `qti-assessment-item` + response/outcome processing is months; H5P export for games means re-implementing each H5P content type's semantics | **Phase-4 vanity project.** Cut for v0.x; add QTI **import** later if LMS interop becomes a requirement. |
| LTI 1.3 Advantage full suite (OIDC/JWT/Deep Linking/AGS/NRPS) | Real deliverable — but only valuable if a supported LMS is in use *and* an admin will do the registration dance | **Defer, don't delete.** For one school, direct links + code are enough in v0.1. |
| Lit Web Components + Shadow DOM for 37 item types + plugin SDK running third-party JS | Third-party JS executing inside a school's exam tool is a security/support liability; Shadow DOM adds ARIA boundary pitfalls | **Over-engineered.** Native ESM + plain DOM modules (our contract) is simpler and more auditable; defer plugins indefinitely. |
| Block-based WYSIWYG canvas with slash commands + MathQuill/KaTeX previews + Unsplash/Openverse | A rich-text/block editor is a multi-month project on its own; media-repo integration brings licensing + network dependencies | **Overkill for v0.x.** Form-driven authoring with *very good* defaults is faster for teachers once templates exist. |

### 4.1 The three internal contradictions that matter most

**(a) Offline-first vs server-authoritative grading vs "prevent manipulation".**
The document says all three:
- client buffers events, "Auto-gradable interactions are checked client-side for immediate user feedback";
- "authoritative backend worker pool that re-evaluates the submission ... to prevent score manipulation";
- offline mode where "`User interactions` ... continue operating smoothly without data loss" and CRDT ops sync later.

Client-side grading requires *the answer key and the scoring logic on the client*. If the client can grade, the client can be read (the vendor's own console-leak article shows this is a known, real class of bug — [KB U063](https://kb.das proprietäre Originalprodukt.com/article/147-can-students-see-solutions-in-the-browsers-developer-view)). And an offline-capable device cannot ask the server "is this right?" — so the key must be local. You cannot have instant offline correctness feedback and secret answers. The contract's design — strip answers, grade server-side, return only `{correct, autoScore, maxScore, needsManual}` per response (`CONTRACT.md` §0.8) — is the *sound* resolution of this trade-off: instant feedback when online (a server round-trip on save), no answer keys on the client, no offline grading. Keep it.

**(b) "CRDT reconciliation" vs "authoritative merge".**
A CRDT is a data type whose merge is commutative/associative/idempotent *without* an authority. A single student's attempt is **single-writer** with a stable server-side attempt id — there is no concurrency to merge. And "server-side worker ... authoritative merge" is not a CRDT; it is last-write-wins/op-log replay with server ordering. For our case: autosave `PUT /api/participant/responses/:itemId` (per-item last-write-wins), a localStorage outbox for retries, server timestamp on submit, and one monotonic per-item `updated_at` is sufficient and testable. If we ever add collaborative editing (two teachers co-authoring), *that* is where CRDTs might earn their keep.

**(c) "Module isolation via Shadow DOM" vs accessibility claims.**
Shadow DOM isolates CSS — true — but it also complicates label/`aria-labelledby` references across boundaries, focus order and form association, and it does nothing for ARIA semantics or keyboard operability. The blueprint lists "semantic Shadow DOM" as an accessibility feature; there is no such thing. Accessibility comes from semantic elements + ARIA + keyboard handling + testing, in any DOM architecture.

### 4.2 Other blueprint problems worth naming

- **No ops model at all.** No backups (the DB is the school's assessment history!), no restore drill, no upgrade path, no monitoring, no retention/deletion policy, no answer to "what happens on the Monday of a Schularbeit when the LXC is down?". For a school tool, this is *the* requirement, not an afterthought. Our deployment doc exists precisely because this gap is fatal.
- **No German/Austrian reality.** The school is Austrian, teachers teach in German, and school law + DSGVO paperwork are part of "shipping". The blueprint has no i18n plan, no DSGVO records (Verzeichnis von Verarbeitungstätigkeiten, Löschkonzept, TOMs), no parent-information story. Our contract is German-first; the deployment doc carries the DSGVO notes.
- **No teacher-time model.** The whole value proposition is saving teacher time; a slash-command canvas may look modern but a teacher converting a Word worksheet wants two clicks: paste text → mark blanks → done. The blueprint optimises *novelty* of authoring, not *speed*.
- **No maintenance/sustainability model.** "Open source" is not a maintenance plan. Who patches Node/Caddy? Who answers a teacher at 07:45? Our docs must say: ~0.2–0.4 FTE/year steady-state for a school deployment.
- **No cost model.** GPU-capable host, MinIO disks, K8s overhead — none is priced; the comparison table's "no recurring per-seat fees" hides the real TCO (hardware + admin time).
- **Licence ambiguity.** The comparison table says "Open-source (AGPLv3/Apache 2.0)" — those are incompatible choices; our project chose AGPL-3.0-or-later (`CONTRACT.md` §0). The research should not be quoted on licensing.
- **The blueprint's own sample JSON leaks the design intent:** `interaction.reactants[].coefficient` and `products[].coefficient` in the item definition are the *answer* (they must be hidden server-side); `step`/`blanks` mixing an answer map into the item is fine *only if* sanitization is enforced in one place. Our contract's `sanitizeActivity()` single choke-point (`CONTRACT.md` §0.8, §7) is the right response; the blueprint doesn't say where stripping happens.

### 4.3 What the blueprint gets right

Credit where due: (1) declarative, versioned JSON activity definitions with strict validation — correct, and it is what we do (`v:1`); (2) server-side authoritative scoring with client-side preview — correct in intent; (3) deep-linking/share codes and a live teacher dashboard — correct product priorities; (4) agnostic asset abstraction (one day S3, one day local FS) — fine as an interface, just don't deploy MinIO; (5) explicit human-in-the-loop for AI — correct; (6) data-sovereignty motivation — correct. The *direction* is good; the *mass* is wrong.

---

## 5. Critique of the MVP architecture we are actually building

Reviewed against `docs/CONTRACT.md` (the real, current contract), not the original task summary. Where the task summary and the contract differ, the contract wins; I flag the differences.

### 5.1 What is right (do not "improve" these away)

1. **Zero runtime deps + `node:http` + `node:sqlite` + native ESM.** For a school, the supply-chain surface is the security story. `npm install` produces a tree of transitive packages nobody reviews; this design has none. It also makes the LXC deployment a `git pull` + `systemctl restart`.
2. **Single process, single origin.** One thing to run, one thing to back up, no CORS, one CSP, one origin for cookies/CSRF checks.
3. **Answer stripping + server-authoritative grading + one sanitization choke point.** The correct resolution of the offline/instant-feedback trade-off (§4.1a). The contract even prescribes the payload assertion in tests (`JSON.stringify(studentPayload)` must not contain answer keys) — excellent.
4. **Anonymous participants by code + random token.** Matches the real school workflow (no LMS roster needed) and is *better* than das proprietäre Originalprodukt' anonymous mode (which loses Live + gradebook).
5. **SQLite WAL + JSON columns + ISO timestamps.** Correct scale, correct backup unit. `VACUUM INTO`/`node:sqlite` backup is a consistent snapshot without stopping the service.
6. **SSE, not WebSocket.** One-way server→teacher updates; EventSource auto-reconnects; no protocol upgrade through Caddy; no auth handshake dance. Correct.
7. **Local FS for assets.** Correct. MinIO would add a daemon, a bucket policy model and a backup path for zero benefit at this size.
8. **Print via CSS, no server-side PDF.** Correct v0.1: PDF rendering needs Chromium/LaTeX and becomes the biggest deployment artifact. Printing a browser-rendered page is what teachers already do.
9. **JSON import/export for activities.** Cheap, gives teachers a backup and cross-school sharing, and it is the one piece of "interoperability" that pays for itself in v0.1.
10. **Admin-seeded accounts, no self-signup.** Correct for a school: the IT teacher creates 40 accounts; no email infrastructure, no password-reset emails, no abuse surface.
11. **German-first i18n with keys in the contract.** Correct, and the contract keeps `t()` mandatory. (Check: server error `message` strings may be English; the UI must map codes. Fine.)
12. **Time limit + submission window + force submit are in v0.1.** The task prompt omitted them; the contract has `timeLimitMinutes` with a 60 s grace and server-side auto-submit. That is a classroom-critical feature and it is already in scope. Keep it.

### 5.2 Where the MVP is still over-engineered (relative to one school)

Be honest: the contract is *mostly* lean. The over-engineering that exists:

| Item | Why it's more than needed now | Recommendation |
|---|---|---|
| `match`, `ordering`, `pins` item types | These are the three most expensive renderers/graders (drag/connect/coordinate UI, touch and keyboard parity, extensive edge cases). They are ~40 % of the item-type effort for maybe 10–15 % of everyday use; fill-blanks/MC/short-answer/numeric carry most worksheets. | Build them **last**, behind a flag, only after the core 6 types are used in a real classroom. If time runs out, ship 6 types. |
| Optimistic-locking `revision` + 409 conflict flow | Real concurrent edits by two teachers are rare in a single-school instance; the editor is one user at a time in practice. | Cheap enough to keep, but don't build a merge UI. A 409 + "reload" toast is enough (contract already says that). |
| Per-item `feedback.correct/incorrect` + instant feedback + `showAnswers` + `allowReview` matrix | Four independent visibility switches is a lot of UI/QA for v0.1; teachers will use defaults. | Keep the data model, expose only "instant feedback" + "show results/answers after submit" in v0.1 UI; defer the rest. |
| `media` on *every* item (image/audio/video-URL) + `pins.image` | Audio URL/video URL adds provider dependencies and DSGVO questions (YouTube embeds = Google) before any item needs it. | v0.1: image only. Audio/video URL in v0.2 with a privacy note. |
| `fontScale`, `tts`, `starQuestions` accessibility settings in the definition | `tts` is a browser API and a QA/training burden; `starQuestions` needs dashboard parity. | Ship `fontScale` + keyboard/focus basics; defer TTS/stars to v0.2. |
| Full `admin` user-management UI | One admin, a handful of changes per year. | The `npm run admin:create` CLI is enough in v0.1; keep a read-only user list in the UI. |
| Per-item CSV `item_<index>_state` columns + BOM + `max_score` etc. | Column explosion makes the CSV hard for teachers to open; Austrian school administration does not import our CSV automatically. | Keep `participant,status,score,max_score,started_at,submitted_at`; per-item columns as an opt-in export. |
| `HOST` default `0.0.0.0` in production | Not "over-engineered" but a deployment footgun: it silently exposes 3000 to the LAN if Caddy is misconfigured. | Deployment sets `HOST=127.0.0.1` (see `DEPLOY-LXC.md`); consider changing the default in a later minor. |

**Discrepancy to fix between the task brief and the contract:** the task brief said "short answer with synonyms/regex". The contract (`CONTRACT.md` §4.1) correctly has **only an accepted-answers list, no regex**. Keep it that way in v0.1 — teacher-supplied regex in a Node process is a **ReDoS** and correctness trap. If regex is ever requested, run it against a length-capped input with a complexity guard (no backtracking-prone patterns, or a linear-time engine), never raw `new RegExp(user)` unguarded.

### 5.3 Where the MVP is under-engineered and **will bite in real classrooms**

Ordered by how soon it will hurt. "Bite" = a teacher stops using the tool, or a pupil loses work.

| # | Gap | Why it will bite | Severity | Cheap fix |
|---|---|---|---|---|
| U1 | **No QR code / printable link sheet** (Lead confirmed: cut) | The real distribution ritual is "put a link/QR on the board or in Teams". Typing a 6-char code is fine, but a QR/print sheet is 30–60 min of work and saves every lesson's first 2 minutes. | Medium | Tiny QR encoder module in `public/lib/` (no deps; ~300 lines) or print-code sheet with big code + short URL. Do **not** call an external QR image API — that leaks student/assignment URLs to a third party. |
| U2 | **Touch/tablet ergonomics for match/ordering/pins** | School fleets are iPads/Chromebooks/touch laptops; HTML5 drag-and-drop does not work reliably on touch. Contract requires keyboard alternatives ("no drag-only"), which is the right baseline, but the *touch* path also needs tap-to-select-then-tap-target or move buttons; coordinate pins need a tolerant hit area and a way to place without fine motor precision. | High (for the 3 types) | Implement "tap source → tap target" as the primary interaction, drag as enhancement; 44 px targets; test on a real iPad/Chromebook. |
| U3 | **Print quality for interactive items** | The contract has print views, but print must degrade: MC → boxes, blanks → underscores, matching → lines/letters, ordering → numbered shuffle, pins → labelled image. Teachers *will* print for subs/absence/„Stundenplan"; a broken print gives a bad first impression. | High | An explicit `print` renderer per item type + teacher-side answer-key print. This is small but must be *tested on paper*, not just in the DOM. |
| U4 | **No rich text/HTML; markdown-lite only** | Language teachers bold/underline parts of a stem and use tables in worksheets. Plain text + `**bold**`/`*italic*`/lists is enough for many but not for "read the table and answer". | Medium–High for language/social subjects | Keep markdown-lite (XSS-safe), add `- ` lists already; consider a small, allowlisted table syntax only if teachers ask. Do not add HTML. |
| U5 | **No audio/photo responses** | Language teachers' most-used das proprietäre Originalprodukt feature is "record yourself reading/speaking". We cut it — defensible, but it is a real scope gap for the *language* department, which is a big part of a Mittelschule. | Medium (dept-specific) | v0.3: `MediaRecorder` capture → upload to assets → manual grading; needs consent + retention policy for minors' voices. Do not add until DSGVO text exists. |
| U6 | **Video only as external URL** | If the school blocks YouTube or DSGVO forbids embeds without consent, video questions are unusable. Local video upload is excluded by the asset allowlist (and should be, at 10 MB max). | Medium | Document the limitation; v0.2 `MEDIA_ALLOW_VIDEO` with size limits and school-policy note; prefer self-hosted MP4 on school NAS. |
| U7 | **No LMS integration (Teams/Google Classroom/Moodle)** | If teachers' workflow is "assignment in Teams", a raw link is a workaround; some will not adopt. | Medium (adoption, not correctness) | v0.2: Teams/Google "link-out" documentation first (paste link, no grades), LTI 1.3 only if a real LMS is in use. |
| U8 | **Data-protection documentation (code gaps closed in v0.1)** — at review time: participant `ip`/`user_agent` stored, no retention/deletion job, no Löschkonzept | **Update:** v0.1 never populates participant IP/UA (columns stay NULL), join/save/submit rate limits and a 500-participants-per-assignment cap are implemented, and retention tooling ships (`scripts/prune.mjs`, `POST /api/admin/purge`, dry-run + annual calendar in `DEPLOY-LXC.md` §12.5). What remains is **school-side**: the written Löschkonzept/Verzeichnis, a retention-cutoff decision and DSB sign-off. | Low (code) / residual process risk (school) | Do the process: DSB review, pick the cutoff (e.g. 365 days), add the annual purge to the runbook (`DEPLOY-LXC.md` §12.5) and note backup-rotation lag in the Löschkonzept. |
| U9 | **No upload hardening beyond MIME allowlist/size** | The contract has max size + MIME allowlist + no SVG (good). It does not re-encode images (EXIF/GPS from phone photos can leak the school's location; image bombs can be huge pixel dimensions with small file size). | Medium–Low (teacher uploads only in v0.1) | Re-encode/strip metadata on upload if an image library is ever allowed (no deps → do it client-side in canvas before upload, or document). At minimum enforce dimensions and reject decompression bombs. |
| U10 | **Backup/restore implemented and rehearsed** (gap closed since review) | At review time the deploy scripts depended on not-yet-written `scripts/backup.mjs`/`restore.mjs` — "backups" was a promise. v0.1 now ships both CLIs plus the `deploy/backup.sh`, `deploy/restore.sh` and `deploy/upgrade.sh` wrappers, and the flow was rehearsed **end-to-end on a live instance** (192 KiB database + 4 uploaded assets; restore verified matching participant/response counts and assets, health OK). | Low (residual: recurring drill) | Keep the termly restore drill and the mandatory pre-upgrade backup in `upgrade.sh` (`DEPLOY-LXC.md` §8.5/§11). |
| U11 | **`node:sqlite` is a Release Candidate, not stable** | Verified in Node 24.22 docs: "Stability: **1.2 — Release candidate**"; SQLite became RC in v24.15.0 ([nodejs.org docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)). API churn is unlikely but possible; Debian 12 ships Node 18 where the module does not exist at all. | Medium (pin Node 24.x, test upgrades) | Pin an exact Node minor in deploy (e.g. 24.x via NodeSource) and **never auto-major-upgrade**. Add a boot smoke test (`node -e "import('node:sqlite')"`). |
| U12 | **Synchronous DB calls on the single event loop** | `DatabaseSync` blocks; a big activity import / CSV export / backup while 30 pupils save answers will cause visible latency (and SSE stalls). At one school it's seconds, not minutes — but during an exam that is noticeable. | Medium | Keep payload limits small (activity JSON ≤ ~1 MB), batch exports, run backup off-hours (cron), monitor event-loop lag; if it ever matters, move backup to `sqlite.backup()`/child process. |
| U13 | **No rate limiting on participant join/save/submit** | Contract rate-limits login and asset uploads only. Join-by-code is a 6-char code; saves are cheap but unbounded per token; a pupil with dev tools can spam. | Low–Medium | Add per-IP join limit and per-token save throttle (in-memory, like the login limiter). Also cap participants per assignment. |
| U14 | **No observability beyond `/api/health`** | A school has no pager. You need to know *before* the teacher does: disk full, DB locked, SSE connections stuck, TLS expiry. | Medium | In deployment: systemd `Restart=on-failure`, a cron health check that writes a log/email, disk threshold alarm, cert expiry check, and a Friday "integrity_check + backup verify" job. |
| U15 | **No schema migration story** | `server/db.js` initialises schema; v0.1 fine, but the first upgrade to v0.2 with an altered column will hit existing DBs. | Medium (future) | Establish a `PRAGMA user_version` migration ladder now (even if it is just "user_version = 1"); `upgrade.sh` must call a documented migration path, and backup before upgrade. |
| U16 | **Accessibility evidence now exists; test coverage remains partial** | At review time this was a target with no evidence. v0.1 ships [`ACCESSIBILITY.md`](ACCESSIBILITY.md) as an honest statement — **no conformance claim**, what was implemented (keyboard alternatives for ordering/match/pins, focus rings, semantics, colour-not-alone, text scaling, print, touch targets), what was tested (browser pass + manual screenshot review), and known limitations (image pins). Still untested: screen reader (NVDA/Orca), axe-core, forced-colours and 400 % zoom. | Medium (legal/ethical) | Run the remaining checks before relying on it for pupils with assistive tech; keep the "no conformance claim" language and update the statement afterwards. |

### 5.4 Two design tensions to decide *now*, not later

1. **Instant feedback vs answer secrecy.** The contract returns `{correct, autoScore…}` on save. That means a pupil *can* brute-force a multiple-choice answer by trying all options and watching the response — even without seeing the key. This is inherent to instant feedback. It is acceptable for formative use; for summative use the teacher must be able to disable instant feedback (contract has `instantFeedback: false`) — **document that the default should be OFF for graded work**, and make the UI warn when instant feedback is on for an assignment that will be graded. (das proprietäre Originalprodukt solves this by... also having the setting; same trade-off.)
2. **Autosave + `localStorage` retry queue vs shared devices.** On a shared classroom PC, a queued response for pupil A must never be replayed into pupil B's attempt. The queue key must be `(assignment code, participant token)`, and the token must be cleared on submit/reset and on "new pupil". The contract stores the participant token in `localStorage` per code (`public/lib/api.js`), so ensure the queue is scoped the same way and is purged after successful submit. This is a real data-leak bug class in school labs.

### 5.5 Honest effort to reach ~80 % of das proprietäre Originalprodukt' everyday classroom use

**Definition used for "80 %":** a German-first web tool in which an average teacher can, without training beyond a 30-minute intro, (a) create a worksheet/quiz from scratch or by duplicating, using ~6 item types; (b) publish it and get pupils onto it in under a minute via code/link/QR; (c) trust autosave and auto-grading; (d) watch the class live and help struggling pupils; (e) manually grade long answers and release results; (f) print a paper version and export grades; (g) have the whole thing backed up and restorable. Explicitly excluded from the 80 %: LMS integration, exam lockdown, audio/photo responses, PDF/Word ingestion, AI, QTI, games (crossword/jigsaw/etc.), split worksheet, rich text, multi-tenancy.

| Workstream (contract-based) | Person-weeks (low) | Person-weeks (high) | Notes |
|---|---|---|---|
| Core server: config, db, HTTP router, static serving, auth/sessions, origin checks, rate limits, health/capabilities, SSE hub | 2.5 | 3.5 | Zero-dep HTTP means hand-rolled multipart/static/range handling; that's the hidden cost of "no deps". |
| Activities/assignments/participant/grading/admin APIs incl. validation, revisioning, export/import, CSV | 2.5 | 3.5 | The contract's API surface is ~30 endpoints; tests are as much work as endpoints. |
| 9 item types as shared scoring modules + unit tests | 2.0 | 3.0 | `pins`, `match`, `ordering` are ~half of this; text/MC/short/numeric are quick. |
| Student client (join, player, autosave queue, submit, results) | 2.0 | 3.0 | Touch/keyboard parity and reload-safety are the effort. |
| Teacher SPA (dashboard, editor with 9 declarative forms, publish, live dashboard, grading, admin, print) | 4.5 | 6.5 | Biggest single chunk; the editor UX is the product. |
| German/English i18n pass + copywriting + design/CSS polish + print CSS | 1.5 | 2.5 | Partly overlaps above; don't underestimate German copy for teacher-facing errors. |
| QA: API/shared/e2e tests, CSP/XSS/answer-leak checks, accessibility pass, real-device smoke (iPad, Chromebook, projector) | 2.0 | 3.0 | The contract's definition-of-done already demands most of this. |
| Deployment artifacts + docs + backup/restore/upgrade rehearsal | 1.0 | 1.5 | This deliverable; rehearsal is the part people skip. |
| **Total ("80 % use", one competent dev)** | **~17.5** | **~26.5** | |
| **Realistic range after reuse/parallelism** | **~15** | **~20** | Two devs: ~8–11 calendar weeks (UI work is partly serial). One dev: ~16–22 calendar weeks. |
| **Of which is the *minimum* to first real classroom pilot** (6 item types, no match/ordering/pins, no admin UI, no CSV per-item) | **~10** | **~13** | Ship a pilot in ~3 months solo, learn, then finish. |
| **Blueprint equivalent (all four phases as written, on target hardware)** | **~50** | **~80+** | Before GPU hardware purchase, LTI registrations, and ops. Add ~0.2–0.4 FTE/yr maintenance for either version. |

**How to read these numbers:** the v0.1 build in this repository was produced in a single agent session with parallel AI assistance — that is an artifact of the build method, not a realistic human estimate, and it must not be read as evidence that the person-week ranges are too high; they remain the planning numbers for a human team (with normal review, testing and deployment overhead).

**Blueprint phase estimates (the user's four phases, as literally written, one competent full-stack developer; excludes hardware, DPO paperwork, ops and onboarding):**

| Phase (as specified in the research) | Contents | Person-weeks |
|---|---|---|
| Phase 1 — Core Foundation & Execution Runtime | Lit Web Component runtime + JSON Schema + declarative item types, PostgreSQL schema, MinIO, Fastify REST | **10–16** |
| Phase 2 — Offline-First PWA & Real-Time Telemetry | Service Worker caching, IndexedDB, Yjs CRDT sync, Redis pub/sub + WebSocket telemetry, accessibility bar | **10–16** |
| Phase 3 — Enterprise Interoperability & Assessment Security | Full LTI 1.3 Advantage (OIDC/JWT, Deep Linking, AGS, NRPS), SEB verification, Chromebook kiosk routing, grading dashboard | **12–20** |
| Phase 4 — Modern Ecosystem Enhancements | Block-based WYSIWYG canvas + slash commands + MathQuill/KaTeX, self-hosted LLM pipeline, QTI 3.0/H5P bi-directional transpilers, plugin SDK | **18–35** |
| **Total** | | **~50–87** |

That total is *before* the parts a school actually needs: backups/restore/upgrade, monitoring, German UI, DSGVO records, teacher training, and a maintenance budget (~0.2–0.4 FTE/year). It is also unbuildable-as-described on the target 2 vCPU/2 GB LXC — Phases 1–2 alone would not fit in RAM.

Sanity check on the "80 %" framing: das proprietäre Originalprodukt has ~15 years of accumulated polish and 36 item types with an unknown-size team; 80 % of *classroom use* (not 80 % of features) is genuinely reachable with ~6–9 item types because worksheets dominate. But the last 20 % (games, media responses, AI ingestion, LMS, lockdown) is most of the remaining value for some departments — so set expectations per-department, not school-wide.

---

## 6. Top 5 things to CUT from the four-phase blueprint

| Rank | Cut | Why (and what to do instead) |
|---|---|---|
| 1 | **Kubernetes + microservices + Redis + MinIO cluster** (Phases 1–2) | Unsupportable on one LXC; adds daemons, backups and failure modes. Instead: **one systemd service + Caddy + SQLite + local FS**, deployed by `deploy/provision.sh` and backed up by `deploy/backup.sh` (this deliverable). |
| 2 | **Offline-first PWA + Yjs CRDT + IndexedDB sync** (Phase 2) | Solves a single-writer problem with a multi-writer tool; creates the answer-key-on-client contradiction; months of work for a school whose rooms mostly have WiFi. Instead: **server autosave + `localStorage` retry queue** (already in contract), honest "reload-safe, not offline" claim. |
| 3 | **Self-hosted LLM (Ollama/vLLM) on school hardware** (Phase 4) | Needs GPU/RAM the target lacks, German quality risk, DSGVO/retention questions for pupil text, and an ongoing model-maintenance burden. Instead: **deterministic paste/import helpers**; revisit only with a GPU host + explicit school decision + DSB sign-off. |
| 4 | **Bi-directional QTI 3.0 + H5P + xAPI transpilers** (Phase 4) | Months of spec work; QTI *cannot* rescue a das proprietäre Originalprodukt migration (source has no export); H5P game export means re-implementing H5P content types. Instead: **plain-JSON export/import** (in contract) and, only if an LMS requirement appears, **QTI import of a small subset** later. |
| 5 | **Lit Web Components + Shadow DOM + third-party plugin SDK + block-canvas authoring** (Phases 1/4) | A build-free plain-DOM app is simpler to audit; third-party JS inside an exam tool is a liability; a block editor is a multi-month project that may be slower for teachers than a great form. Instead: **native ESM modules + declarative `editSchema` forms** (contract) and invest the saved months in print, mobile and pilot feedback. |

*(Also cut: multi-tenant `organizations` tables, GraphQL, BullMQ, Traefik, "full WCAG 2.2 AA" claims.)*

## 7. Top 5 things missing from the blueprint (that we must add)

| Rank | Missing | Why it matters to a teacher in Telfs | Where it lands |
|---|---|---|---|
| 1 | **Operations reality: backup, restore, upgrade, monitoring, retention, and a rollback plan** | The DB is the school's assessment history; a dead SD card or a bad upgrade must be a 20-minute recovery, not a disaster. The blueprint has zero ops. | `docs/DEPLOY-LXC.md` + `deploy/backup.sh|restore.sh|upgrade.sh` (this deliverable), and `scripts/backup.mjs|restore.mjs` (Lead). |
| 2 | **German-first UI + Austrian DSGVO package** | Teachers won't adopt an English tool; the school's DSB needs a Verzeichnis entry, a Löschkonzept, TOMs and a story for pupils' data (minimisation, retention, no US transfer, no vendor processor). Nothing in the blueprint. | Contract i18n (§0.6) + `DEPLOY-LXC.md` §DSGVO; plus the U8 data-minimisation fixes above. |
| 3 | **Classroom delivery rituals: QR/print code sheet, paper print of activities, grade export, mobile/touch parity** | Adoption is won in the first lesson: link on the board, pupils in within 60 s, printable backup for a sub, grades out to the school's system. The blueprint mentions none of these. | v0.2 scope (QR + print + mobile), CSV export already in contract. |
| 4 | **A migration plan that faces the truth: pupils' content cannot be imported from das proprietäre Originalprodukt** | QTI does not solve it. The migration cost is *re-authoring*, so the plan must be: run both tools for a term, re-author the top-10 most-used activities, keep das proprietäre Originalprodukt for the long tail, then retire. The blueprint promises "bi-directional QTI" instead of a migration plan. | `CRITICAL-EVALUATION.md` §3.3 + roadmap; teacher onboarding doc later. |
| 5 | **An honest integrity/accessibility threat model instead of a compliance claim** | Exam lockdown on school Chromebooks is not SEB; "full WCAG 2.2 AA" without testing is the same sin the research criticises. Schools need "what this protects against, what it doesn't, what we tested". | v0.1 checklist (time limit, force submit), accessibility conformance note (U16), and *no* lockdown marketing. |

---

## 8. Risk register (MVP + deployment)

Likelihood/Impact: H/M/L. Owner abbreviations: Lead (server/code), client-dev, authoring-dev, server-dev, research-critic (deploy/docs), school IT.

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | **Answer-key leak** via a missed sanitize path (new item type, feedback, pins radius) | M | H | Single choke point `sanitizeActivity()`; test asserts `JSON.stringify(studentPayload)` contains no keys; add a test per new item type; red-team review before pilot. | Lead + server-dev |
| R2 | **Data loss** (disk full, crash, bad upgrade, no verified backup) | M | H | Nightly `backup.sh` with integrity check + off-site copy; quarterly restore drill; `upgrade.sh` takes a pre-upgrade backup and health-checks; disk threshold alarm. | research-critic + school IT |
| R3 | **`node:sqlite` RC churn** / Node upgrade breaks DB layer | M | M | Pin exact Node 24.x; test upgrade on a copy; never auto-major; snapshot before Node upgrades. | Lead + research-critic |
| R4 | **Single-process outage during a lesson** | M | M | systemd restart + health check; documented "what to do now" (paper fallback); keep the tool off critical-path grading (grades also in school system). | school IT |
| R5 | **XSS via teacher content or filenames** | L | H | CSP `script-src 'self'`, no `innerHTML` for untrusted text, markdown-lite renderer, asset filename sanitising, no SVG. Add a small XSS test corpus. | Lead + client-dev |
| R6 | **CSRF/session theft on shared classroom PCs** | M | M | HttpOnly/SameSite cookies, origin checks on state-changing requests, Secure behind TLS, short session TTL where practical, "log out" prominent; pupils never have teacher sessions. | Lead |
| R7 | **DSGVO complaint / DSB objection** (names + IP/UA + indefinite retention + minors) | M | H | Minimise (drop IP/UA), retention job, documented Löschkonzept/Verzeichnis, no external processors, school DSB review before pilot; parent info text. | school IT + research-critic |
| R8 | **WiFi/device heterogeneity** (Chromebook/iPad/old Windows, projector) | H | M | Real-device test matrix; touch-first interactions; no heavy assets; autosave retry; printed fallback; school tests in one classroom first. | client-dev + school IT |
| R9 | **Teacher non-adoption** (too slow to author, missing audio/photo, no LMS) | M | H | Pilot with 2–3 volunteers; measure time-to-first-activity; prioritise authoring speed/duplicate/templates; plan audio v0.3 if language dept needs it. | Lead + user |
| R10 | **TLS/DNS internal-CA pain** (pupil devices don't trust the cert) | M | M | Prefer existing school wildcard cert or public DNS-01 cert; internal CA only for managed devices; document cert rollout. | research-critic + school IT |
| R11 | **No migrations + upgrade breaks old DB** | M | M | Add `PRAGMA user_version` ladder now; backup before upgrade; upgrade script refuses to proceed without backup. | Lead |
| R12 | **Bus factor / maintenance burden** | H | M | Everything documented (contract + deploy doc); routine ops ≤ 1 h/month + security patches; assign a second staff member; AGPL so another school can fork/maintain. | school IT + Lead |
| R13 | **Scope creep back toward the blueprint** (someone asks for K8s/LLM/QTI "while we're at it") | M | H | This document + §6 cut list as the standing decision record; every addition must name the classroom problem it solves and its person-weeks. | Lead |
| R14 | **Exam-integrity expectations** ("we'll do Schularbeiten in it") | M | H | Do not promise lockdown; server-authoritative timing + device policy + supervision; recommend paper/managed-kiosk for high-stakes until v0.3 decision. | Lead + school |
| R15 | **Regulatory/AI changes** (vendor AI push, procurement rules) | L | M | Re-check vendor pricing/features before any procurement comparison; keep our claims dated. | user + Lead |

---

## 9. Recommended roadmap (concrete, value-ordered)

**v0.1 — "pilotable" (shipped in this build; ~10–13 person-weeks minimum slice for a human team).**
Ship: login/admin seed, activity editor for **6 item types** (text, MC single/multi, short answer, numeric, fill blanks, long answer), publish with code, student join/save/submit, server grading, time limit, live dashboard (SSE, force submit/reset), manual grading for long answers, results + CSV, print views, JSON export/import, `backup.sh`/`restore.sh` rehearsed, plus **retention tooling + DSGVO docs** (`scripts/prune.mjs`, `POST /api/admin/purge`, `DEPLOY-LXC.md` §12) and the **accessibility conformance note** (`docs/ACCESSIBILITY.md`) — which makes **no conformance claim** and lists what is tested **and what is not tested**. *Gate to pilot: answer-leak test, real-device smoke, one real lesson.*

**v0.2 — "adoptable" (~6–10 person-weeks).**
QR/print code sheet, touch-first interaction polish, print-per-item-type + answer-key print, blur-names live toggle, admin UI trim, migration ladder (`user_version`), monitoring/alerts. Then add `match`/`ordering` only if pilot teachers ask.

**v0.3 — "department-complete" (~8–14 person-weeks, decide with data).**
Audio recording item (with consent/retention text), image-in-stem everywhere, pins, split-worksheet/PDF reference pane, Teams/Google link-out docs, optional QTI **import** subset, LTI 1.3 only if the school adopts a real LMS. Explicitly *not*: K8s, MinIO, LLM, H5P export, plugins.

**Decision gates:** after the pilot, measure (a) teacher minutes to author a 10-item worksheet, (b) pupil join friction, (c) items per activity by type, (d) failures per lesson. Cut or add based on those numbers, not on feature envy.

---

## 10. Sources (all fetched 2026-11-09 unless noted)

**das proprietäre Originalprodukt primary:**
1. Pricing — https://www.das proprietäre Originalprodukt.com/pricing (HTTP 200, **no prices rendered**)
2. Pricing, archived — https://web.archive.org/web/20260114095931/https://www.das proprietäre Originalprodukt.com/pricing (no prices)
3. Widget library — https://www.das proprietäre Originalprodukt.com/widget-library
4. Question types — https://www.das proprietäre Originalprodukt.com/question-types
5. Accessibility — https://www.das proprietäre Originalprodukt.com/accessibility (VPAT linked at /resources/vpat.pdf; PDF **not readable** by this tool)
6. Live Widgets — https://www.das proprietäre Originalprodukt.com/live
7. Live Widgets teacher guide — https://www.das proprietäre Originalprodukt.com/blog/2023/09/how-to-monitor-student-progress-with-live-widgets-the-complete-teacher-guide
8. AI Assistant — https://www.das proprietäre Originalprodukt.com/ai-assistant
9. Moodle integration — https://www.das proprietäre Originalprodukt.com/moodle
10. Support hub — https://www.das proprietäre Originalprodukt.com/support
11. Sitemap — https://www.das proprietäre Originalprodukt.com/sitemap.xml

**das proprietäre Originalprodukt knowledge base (Help Scout):**
12. Index — https://kb.das proprietäre Originalprodukt.com/
13. U036 Safe Exam Browser — https://kb.das proprietäre Originalprodukt.com/article/42-using-widgets-in-safe-exam-browser
14. U008 print/PDF + answer key — https://kb.das proprietäre Originalprodukt.com/article/19-how-can-i-print-a-quiz-widget-with-or-without-answers
15. U080 archiving/exporting — https://kb.das proprietäre Originalprodukt.com/article/187-about-archiving-and-exporting
16. U078 shortcode sharing — https://kb.das proprietäre Originalprodukt.com/article/183-what-does-the-dot-in-a-widgets-shortcode-mean
17. U070 formula editor / LaTeX — https://kb.das proprietäre Originalprodukt.com/article/161-using-the-formula-editor
18. T008 LTI 1.3 setup — https://kb.das proprietäre Originalprodukt.com/article/504-adding-das proprietäre Originalprodukt-to-an-lms-as-an-lti-1-3-tool
19. U063 student console view — https://kb.das proprietäre Originalprodukt.com/article/147-can-students-see-solutions-in-the-browsers-developer-view

**Third party:**
20. Pricing review (secondary) — https://www.conversiongems.com/tools/das proprietäre Originalprodukt ("checked 4 October 2026")
21. Common Sense Education reviews paused — https://www.commonsense.org/education/reviews/FAQ

**Platform/runtime:**
22. Proxmox VE Linux Container — https://pve.proxmox.com/wiki/Linux_Container
23. Node.js v24 `node:sqlite` (Stability 1.2, RC) — https://nodejs.org/docs/latest-v24.x/api/sqlite.html

**Failed / inaccessible:** https://edtechimpact.com/products/das proprietäre Originalprodukt/ (network error); https://www.das proprietäre Originalprodukt.com/resources/vpat.pdf (binary not decodable by tool); KB GET search (returns no results for known terms); DuckDuckGo queries for the `##` keyword syntax (no results).

---

## 11. Bottom line

- **Of the research document:** keep it as a product inventory and a *motivation*; correct the numbers (36 not 37, no QR/session-code evidence, "no export at all" is false), delete the invented implementation details (MathQuill/CAS, Levenshtein, WebRTC, SEB crypto handshake, Chromebook exam codes), and above all **do not adopt its architecture**. Its four phases are a well-written description of a 40–80+ person-week enterprise platform that cannot run on the target hardware and whose ops story is missing entirely.
- **Of our MVP:** the shape is right and unusually disciplined (zero deps, answer stripping, SSE, SQLite, single origin, German-first). Its risks are not architectural; they are the last-mile classroom ones (touch, print, QR, rich text, audio, retention/DSGVO) plus the node:sqlite RC and the not-yet-written backup scripts. Fix those, pilot with two teachers, and the project can honestly claim a meaningful open, self-hosted subset of das proprietäre Originalprodukt for one Austrian secondary school — **not** "das proprietäre Originalprodukt, but open" as a feature-parity claim.
- **The one number to remember:** ~15–20 person-weeks for the 80 % MVP (and ~10–13 to a pilot), versus ~50–80+ for the researched blueprint. That ratio is the whole review.
