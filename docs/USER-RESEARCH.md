# User-supplied research (archived verbatim input)

> Archived from the user's initial request so the critique can cite exact claims. This is NOT our engineering contract and NOT endorsed by the team. It is the material under review.

## Architectural Deconstruction of BookWidgets and Engineering Blueprint for an Open-Source, Self-Hosted Alternative

### Architectural Foundations, Capabilities, and Pedagogical Applications of BookWidgets

BookWidgets functions as a proprietary digital learning platform designed to streamline the authoring, delivery, and real-time evaluation of interactive educational exercises. Operating primarily as a software-as-a-service application, it enables educational institutions to transition from static, paper-based workflows into interactive, media-rich, and automatically graded digital activities. The platform's underlying premise relies on modular, configurable activity templates—designated as widgets—that encapsulate specialized instructional logic and presentation behaviors, allowing teachers to build exercises without software development expertise.

The platform organizes its library of over forty templates across six core functional domains, each aligned with distinct cognitive goals and instructional formats.

| Functional Category | Primary Widget Templates | Instructional and Evaluative Mechanism |
| --- | --- | --- |
| Summative & Formative Assessment | Quiz, Worksheet, Split Worksheet, Video Quiz | Delivers up to 37 interactive question types with real-time response processing, deterministic automated grading, and comprehensive analytics. |
| Gamification & Micro-Practice | Crossword, Word Search, Jigsaw Puzzle, Pair Matching, Memory, Bingo Card, Snowman (Hangman) | Rule-based procedural game mechanics designed for vocabulary acquisition, retrieval practice, and low-stakes consolidation. |
| Visual Media & Exploration | Hotspot Image, Before/After Slider, Image Carousel, Image Viewer, Timeline, Frame Sequence | Spatial and chronological exploration supporting high-resolution image panning, split-slider comparisons, interactive multimedia popups, and geo-referencing via Google Maps. |
| STEM & Data Modeling | Active Plot, Arithmetic Practice, Chart, Spreadsheet-driven bar plots | Parameter-driven mathematical graphing, algorithmic calculation drilling, and dynamic visualization of tabular datasets. |
| Organization & Metacognition | Digital Whiteboard, Split Whiteboard, Mind Map, Interactive Planner, Checklist | Freeform vector and raster sketching, procedural task management, graphic organization, and metacognitive self-regulation. |
| Structured Inquiry | WebQuest, Web Embed | Multi-step problem-based inquiry modules embedding curated web assets, secondary widgets, and external digital resources. |

The core assessment templates—Quiz, Worksheet, Split Worksheet, and Video Quiz—represent the operational foundation of the system. Within these four templates, the runtime engine supports 37 distinct question interaction types, 30 of which feature deterministic auto-grading capabilities.

| Question Interaction Type | Input Modality & Client Behavior | Automated Evaluation & Scoring Mechanism |
| --- | --- | --- |
| Text Block | Non-scorable container embedding instructional text, HTML, audio, or video assets. | Informational only; bypassed by the scoring engine. |
| Multiple Choice | Single-selection radio button interaction against arbitrary distractor sets. | Deterministic match against a single correct identifier key. |
| Multiple Choice (Multi-Answer) | Multi-selection checkbox interaction across options. | Set-based matching with partial credit algorithms and negative penalty options. |
| Short Answer | Single-line alphanumeric text input field. | String normalization matching against exact keys, synonyms, or regular expressions. |
| Long Answer | Multi-line plain text area for open-ended synthesis. | Manual grading or heuristic keyword extraction with point weights. |
| Rich Text Paragraph | Client WYSIWYG editor supporting bold, italics, lists, and formatting. | Manual grading supported by structured evaluative scoring rubrics. |
| Fill in the Blanks | Inline text input boxes embedded directly within continuous prose passages. | Token-level string matching supporting multiple alternate synonyms per blank. |
| Mark Sentence | Clickable token spans in a sentence to highlight parts of speech or errors. | Exact match of selected token indexes against teacher-defined coordinate arrays. |
| Drag Words in Sentence | Drag-and-drop cloze interaction moving word pills into text gaps. | Categorical slot-identifier matching upon drop event. |
| Correct Words in Sentence | Direct text manipulation modifying erroneous words inline. | Character or token sequence difference matching against target corrections. |
| Fill in the Table | Structured two-dimensional data entry matrix. | Cell-by-cell coordinate matching against numeric or textual solutions. |
| Question Table (Single Answer) | Grid associating row items with column choices via radio selections. | Vector matching across column indices per row. |
| Question Table (Multi-Answer) | Grid associating row items with column choices via multi-select checkboxes. | Multi-dimensional matrix comparison verifying checked cell coordinates. |
| Annotate Picture | Coordinate-mapped text input labels positioned over a raster image. | Spatial pin validation matching input strings to target pin coordinates. |
| Whiteboard | HTML5 Canvas drawing interface supporting brushes, shapes, and text insertion. | Manual qualitative review within the teacher grading dashboard. |
| Photo Upload | Hardware camera capture or local filesystem image upload interface. | Manual grading supported by rubric evaluation. |
| Word & Sentence Ordering | Drag-and-drop linear sorting of text tokens or complete clauses. | Levenshtein distance or exact sequential array comparison. |
| Crossword Item | Interactive alphanumeric puzzle grid driven by clue definitions. | Real-time letter matrix evaluation against compiled answer keys. |
| Picture Ordering | Drag-and-drop horizontal or vertical sequencing of visual cards. | Array permutation matching against predetermined image sequence keys. |
| Picture Multiple Choice | Image card grid selection accepting a single target image. | Deterministic match against target image asset identifier. |
| Picture Multi-Answer | Image card grid selection accepting multiple target images. | Set matching against multiple target image asset identifiers. |
| Audio Recording | In-browser WebRTC microphone recorder capturing audio responses. | Asynchronous manual grading via teacher audio playback and rubric scoring. |
| Text Match | Node-to-node line drawing or drop-pairing linking text fragments. | Relational tuple evaluation comparing submitted pairs against answer pairs. |
| Text-to-Picture Match | Interactive line drawing linking text strings to target visual assets. | Relational tuple validation between string identifiers and image IDs. |
| Picture-to-Picture Match | Relational interface pairing two corresponding graphic cards. | Relational tuple validation between dual image asset IDs. |
| Audio-to-Text Match | Audio player triggers mapped to textual definitions or transcriptions. | Relational tuple validation between audio asset IDs and text keys. |
| Audio-to-Picture Match | Audio player triggers mapped to corresponding visual representations. | Relational tuple validation between audio asset IDs and image IDs. |
| Text Drag & Drop | Spatial sorting moving textual tokens into categorical bin containers. | Category-membership set evaluation per drop container. |
| Picture Drag & Drop | Visual sorting moving image tokens into categorical bin containers. | Category-membership set evaluation for graphic asset keys. |
| Picture Count Drag & Drop | Dragging specified quantities of duplicated image tokens into targets. | Integer tally validation of cloned items placed within target dropzones. |
| Group Items | Unstructured grouping associating related words, graphics, or audio assets. | Cluster-membership graph matching against target relational groups. |
| Rated Multiple Choice | Scaled single-choice survey item with differential point weightings. | Accumulative point allocation determined by chosen option weights. |
| Numeric Answer | Formatted numeric input accepting integers, floats, scientific notation, and units. | Mathematical equivalence parsing with configurable error tolerances. |
| Equations | MathQuill-backed LaTeX input palette for algebraic formulas. | Symbolic computer algebra evaluation comparing mathematical equivalence. |
| Balance Chemical Equation | Interactive chemical reactant and product equation field. | Stoichiometric integer balancing verification across atomic species. |
| Ionic Compound Builder | Cation and anion selection interface to construct neutral compounds. | Valence net-charge neutrality and chemical formula parsing. |
| Rubric | Standalone multi-criteria analytic evaluation grid. | Direct teacher scoring matrix with point weighting per performance level. |

The architectural divergence between the Quiz and Worksheet templates reflects differing cognitive paradigms. The Quiz widget presents items sequentially—one question per viewport—which limits peripheral distractions, helps learners manage cognitive load, and supports focused formative checks. Conversely, the Worksheet widget renders all items in a single, vertical scrollable layout, providing learners with a continuous document view that allows them to scan ahead, plan their time, and answer questions in their preferred order.

The Split Worksheet and Split Whiteboard expand this model by implementing a dual-pane viewport. The left pane renders a scrollable reference document—such as a rich text excerpt, a multi-page PDF, an audio passage, or a video stream—while the right pane hosts interactive questions or a drawing canvas. This split design minimizes the working-memory burden of tab switching during reading comprehension, document analysis, and scientific chart interpretation.

### Practical Teacher Experience: Authoring, Orchestration, and Evaluation Workflows

The teacher-side authoring interface relies on a top-down, form-driven design rather than an unconstrained visual canvas. Authoring proceeds through structured configuration panels: "About" metadata (titles, descriptions, internal version tracking), "Questions" or "Items", and "General" environmental settings. Within the assessment templates, educators can organize exercises into structured, multi-page sections using "Question Pages". This feature groups related questions together and pins specific multimedia resources to those sub-pages, keeping prompts and contextual media aligned throughout complex exams.

To speed up content generation, BookWidgets includes a document ingestion tool that parses uploaded PDF or Microsoft Word documents, using heuristic text extraction to transform static text blocks into interactive questions. An integrated AI Assistant supports generative drafting, producing full question blocks, distractor options, and rubrics based on user prompts or source text. To maintain instructional control, the platform enforces a human-in-the-loop validation step: AI-generated suggestions are never committed directly to the widget configuration without explicit teacher preview, modification, and approval.

Teacher Authoring Form Pipeline:
1. Activity Metadata Configuration (Title, descriptions, version tags)
2. Structural Content Assembly (Ingestion, AI drafting, question pages)
3. Question Item Construction (37 interaction types, point allocation)
4. Scoring Logic Configuration (Keywords, regex, rubrics, tolerances)
5. Environmental Delivery Settings (Accessibility tools, lockdown flags)

The platform's operational monitoring engine—Live Widgets—provides real-time telemetry over student cohorts as they work through published activities. This infrastructure feeds an administrative dashboard that updates dynamically as students engage with the material.

| Telemetry Component | Real-Time Mechanism | Pedagogical Intervention Enabled |
| --- | --- | --- |
| Activity Status & Recency | Client heartbeats ping server endpoints. Dashboard cells display bright yellow during active interaction and transition to white after periods of inactivity. | Detects learners experiencing cognitive blockages, disengagement, or client network dropouts in real time. |
| Continuous Score Matrix | Auto-graded questions update student scores continuously as responses are committed. | Facilitates ad-hoc instructional differentiation, allowing immediate pull-out groups or peer-assisted learning. |
| Item-Level State Grid | Per-question numbered grid cells update dynamically: green (correct), red (incorrect), orange (partial credit), blue (manual grading required). | Allows teachers to assess class-wide misconceptions at a glance and intervene before assignment completion. |
| Aggregated Item Heatmaps | Aggregates all cohort submissions across individual items on a single screen. | Enables teachers to diagnose poorly calibrated assessment items or systemic classroom errors on the fly. |
| Intervention Controls | Remote administrative overrides accessible via a contextual menu per learner row. | Allows teachers to remotely force-submit a forgotten assessment or clear attempts to allow a clean reset. |
| Privacy Anonymization Mode | Client-side visual toggle masking student identifying strings with randomized pseudonyms or blurred filters. | Permits real-time classroom projection of the dashboard for communal debriefing without violating student privacy. |

The evaluation architecture handles both deterministic automated scoring and asynchronous post-submission evaluation. For subjective open-ended prompts, such as Long Answer items, the auto-scoring engine uses rule-based keyword matching. Teachers can specify target keywords, configure alternate acceptable spellings using double-hash delimiters (such as `father##dad`), and assign specific point weights to individual terms (such as `photosynthesis##2`) up to the question's point cap.

Evaluation & Feedback Hierarchy:
1. Assignment Level (Global commentary, total score overrides, letter grades)
2. Question Level (Item-specific comments, reusable shorthand correction codes)
3. Inline Response Level (Highlighter annotations, direct text commentary)
4. Student Return Gate (Selective release of scores, corrections, and model answers)

For subjective assignments, BookWidgets provides a centralized Grading Dashboard with a three-tier feedback hierarchy: assignment-level summary comments, item-specific feedback blocks, and inline text annotations or highlighting across student responses. Teachers can define and insert reusable "evaluation codes" (standardized rubrics or shorthand correction keys) to speed up marking workflows. The review interface allows filtering by question (grading an item across all students sequentially) or by student. When returning work, teachers can selectively configure what students see: releasing raw scores, suppressing grades while retaining qualitative feedback, or selectively revealing model answer keys.

BookWidgets supports three primary assignment distribution channels: direct URL and QR-code routing, embedded Learning Management System (LMS) placement, and community spaces. Teachers collaborate via "Teacher Groups" organized by subject, grade level, or institutional department. Any widget shared to a group can be duplicated, modified, and redistributed by other members without altering the author's original asset.

The platform connects to LMS environments—including Google Classroom, Microsoft Teams, Canvas, Moodle, Schoology, itslearning, and D2L Brightspace—using native integrations and the IMS Global/1EdTech Learning Tools Interoperability (LTI) standard. This allows assignments to be embedded directly into course modules, while scores synchronize automatically with the host LMS gradebook without requiring manual CSV exports.

### Practical Pupil Experience: Client Interaction, Accessibility, and Exam Environments

On the pupil side, widgets run as responsive web applications delivered through modern mobile and desktop browsers, including Google Chrome, Mozilla Firefox, Apple Safari, and Microsoft Edge. The client runtime adapts its layout dynamically across varying form factors, including Apple iPads, Chromebooks, desktop monitors, and mobile smartphones.

Student access models can operate with or without authentication. In standalone deployments, students access activities via short URLs, alpha-numeric session codes, or QR codes, submitting work under manually entered identifying names. In managed deployments, the widget launches through an LMS iframe or single-sign-on (SSO) gateway (such as Google OAuth, Microsoft Entra ID, Clever, or ClassLink), which automatically captures and binds verified learner identities to their submission states.

To accommodate diverse student needs and maintain Universal Design for Learning (UDL) principles, BookWidgets includes integrated client-side accessibility mechanisms.

| Accessibility / Support Feature | Functional Mechanism | Targeted Pedagogical Need |
| --- | --- | --- |
| Question Bookmarking ("Star Questions") | Student-toggled star icon pinning questions to a dedicated review filter; flags sync in real time to the teacher dashboard. | Metacognitive pacing, self-monitoring, and rapid identification of student confusion by instructors. |
| Synthetic Text-to-Speech (TTS) | Integrated browser speech synthesis reading instructions and questions aloud on demand. | Scaffolding for students with dyslexia, visual impairments, or emerging second-language literacy. |
| Active Text Highlighting | Client-side highlighter overlay allowing students to annotate reading sources; highlights persist into the teacher grading view. | Active reading strategies, document analysis, and diagnostic visibility into student comprehension processes. |
| Multilingual Virtual Keyboard | Dynamic on-screen input palette injecting accented characters and diacritical marks without requiring operating system changes. | World language acquisition, accurate phonetic spelling, and second-language testing. |
| Embedded STEM Scaffolding | Integrated on-screen scientific calculator, LaTeX symbol keyboard, and freehand drawing scratchpad. | In-viewport calculation and scratch work for science and mathematics assessments. |
| Submission Completeness Guards | Pre-submission validation routines that warn students if questions remain unvisited or unanswered. | Prevents accidental early submissions and reinforces thorough review habits. |

For high-stakes summative testing, the student client can be locked down to prevent unauthorized browsing and digital communication. The platform integrates with Safe Exam Browser (SEB), an open-source lockdown environment that transforms client machines across macOS, Windows, and iOS into secure kiosks. When enabled, the widget requires a cryptographic configuration key or password handshake; launching the activity in an unauthorized browser fails with an access error.

For institutional deployments utilizing managed Google ChromeOS hardware, BookWidgets generates specialized "Exam Links" and "Exam Codes" designed to launch within Chromebook Kiosk Mode, locking the learner into the active assessment viewport without access to supplemental tabs, terminal utilities, or external applications.

### Architectural Constraints, Commercial Bottlenecks, and Criticisms of BookWidgets

Despite its instructional breadth, BookWidgets presents architectural constraints, commercial overheads, and functional trade-offs that drive the demand for an open-source, self-hosted alternative.

The platform operates a proprietary subscription model characterized by steep licensing tiers. The single-teacher plan restricts LMS connectivity to Google Classroom and Microsoft Teams, locking out direct LTI-based LMS integrations with Canvas, Moodle, Blackboard, and Schoology unless institutions upgrade to group or site licenses. Furthermore, when an individual or institutional subscription lapses, all widget editing capabilities freeze, and active LTI integration endpoints cease functioning, creating an administrative barrier for long-term curriculum maintenance.

| Subscription Tier | Approximate Baseline Cost | Permitted LMS Connections | Institutional Constraints & Trade-offs |
| --- | --- | --- | --- |
| 30-Day Free Trial | Free for 30 calendar days. | Full LMS integration suite enabled during trial window. | Hard account lock upon expiration; all widget authoring and editing capabilities cease. |
| Individual Teacher Plan | $11.95/month or $67/year. | Google Classroom and Microsoft Teams only. | Excludes enterprise LTI connections (Canvas, Moodle, Schoology locked out); BookWidgets branding enforced. |
| Teacher Group (5 Licenses) | $67 per teacher/year ($335 annual minimum). | Unlocks full LTI 1.3 LMS integrations; white-label branding. | Minimum cost threshold for institutions running modern LMS environments. |
| Teacher Group (10+ Licenses) | $49.50 per teacher/year. | Enterprise LTI integration and administrative reporting dashboards. | Requires continuous annual line-item commitments from institutional budgets. |

The platform's cloud-hosted architecture introduces significant vendor lock-in and data sovereignty risks. Activity schemas, media files, and student submission histories reside on proprietary infrastructure. The platform provides no native export mechanism to convert interactive activities into open standards, such as IMS Question and Test Interoperability (QTI) packages or H5P bundles. As a result, schools cannot easily migrate their exercise libraries to alternative systems, effectively binding years of authoring effort to an ongoing commercial subscription.

A further operational challenge stems from the platform's reliance on constant, low-latency network connectivity. The real-time monitoring engine, automated grading routines, and submission pipelines assume uninterrupted internet access. In school environments with intermittent Wi-Fi, high packet loss, or saturated campus networks, client connections can drop unexpectedly. Network drops during a summative test can cause submission failures, lost input buffers, or inaccurate status indicators on the teacher's Live View dashboard. The platform lacks an offline-first architecture capable of caching responses locally and reconciling them once connectivity is restored.

User evaluations also point to authoring bottlenecks and accessibility gaps. The authoring interface remains anchored to nested configuration forms, requiring instructors to switch between tabbed views, modal windows, and separate preview screens to build complex activities. In institutional accessibility audits, BookWidgets has historically received middling ratings (such as 3 out of 5 stars), with audits noting that complex visual interactions—including image annotation, coordinate matching, and whiteboard tasks—often fail to expose accessible semantic DOM structures, ARIA live regions, or full keyboard-navigable operational paths for assistive screen readers.

### Open Educational Standards Benchmark: Foundations for an Alternative Architecture

Developing an open-source, self-hosted alternative requires standardizing item definitions, data interchange, scoring mechanics, and authentication pipelines using open educational specifications.

Educational Interoperability Standards Layering:
1. Enterprise LMS Integration (1EdTech LTI 1.3 Advantage): LTI Core (OIDC + signed JWT); Deep Linking 2.0; Assignment and Grade Services 2.0; Names and Role Provisioning Services 2.0.
2. Assessment Item Definition & Packaging (1EdTech QTI 3.0 / H5P): QTI 3.0 ASI; Response & Outcome Declarations; Portable Custom Interactions (PCI); H5P Package Spec (`h5p.json`, `semantics.json`, `content/content.json`).
3. Granular Telemetry Streaming (ADL xAPI): Actor-Verb-Object streams.

| Specification | Governance Body | Architectural Role in the Self-Hosted Alternative | Structural Standard & Mechanism |
| --- | --- | --- | --- |
| H5P Specification | Joubel / H5P Community | Informs client-side packaging, modular asset delivery, and dynamic form generation. | Packaged as .h5p zip containers featuring h5p.json (metadata/dependencies), semantics.json (dynamic form generation schema), and content/content.json (author data parameters). |
| 1EdTech QTI 3.0 | 1EdTech (formerly IMS Global) | Provides standard underlying schemas for assessment questions, scoring logic, and interoperable item banking. | Eliminates proprietary question encodings using web-component-friendly declarative XML/JSON structures; defines qti-assessment-item, responseDeclaration, outcomeDeclaration, and Portable Custom Interactions (PCI). |
| 1EdTech LTI Advantage (v1.3) | 1EdTech (formerly IMS Global) | Handles secure Single Sign-On, activity placement, and automated gradebook synchronization. | Built upon OAuth2, OpenID Connect (OIDC), and signed JSON Web Tokens (JWT). Encompasses Assignment and Grade Services (AGS), Deep Linking, and Names and Role Provisioning Services (NRPS). |
| xAPI (Experience API) | Advanced Distributed Learning (ADL) | Underpins the real-time teacher telemetry engine, capturing micro-interactions beyond binary grade submission. | Emits standardized JSON actor-verb-object-result statements capturing fine-grained interactions. |

H5P's architectural strength lies in decoupling content data from rendering libraries. An activity package contains three core files: h5p.json declares platform dependencies and versioning; semantics.json provides a declarative schema describing every configurable field an editor must render; and content/content.json houses the raw JSON payload populated by the educator, which is validated against the semantics schema before saving. This pattern allows a self-hosted platform to introduce new widget types simply by defining a semantics.json schema and a rendering Web Component, without modifying core server code.

While H5P excels at media presentation and casual practice, 1EdTech QTI 3.0 provides the standard for formal testing. QTI 3.0 unifies the data model for Assessment, Section, and Item (ASI), defining standardized interaction targets such as choiceInteraction, textEntryInteraction, extendedTextInteraction, matchInteraction, and hotspotInteraction. Adopting QTI 3.0 compliance ensures the self-hosted alternative can export item banks directly into institutional platforms (Canvas, Moodle) or import legacy standardized items without data translation loss. Furthermore, QTI 3.0's Portable Custom Interaction (PCI) standard provides a sandboxed JavaScript API for extending assessments with custom interactive widgets (such as chemistry builders or piano keyboards) while preserving scoring pipelines across standardized assessment runners.

To match BookWidgets' LMS integration without commercial licensing fees, the self-hosted engine implements the complete LTI Advantage suite:
- LTI Core (OIDC + JWT): Authenticates launches securely via asymmetric RSA-signed JWT assertions, eliminating manual user account synchronization.
- Deep Linking (v2.0): Allows instructors browsing their LMS course builder to launch an embedded widget picker and link specific exercises directly into course modules.
- Assignment and Grade Services (AGS v2.0): Automatically synchronizes scores, submission states, and qualitative feedback directly into the LMS gradebook.
- Names and Role Provisioning Services (NRPS v2.0): Synchronizes course rosters to monitor non-completing students without requiring prior platform sign-ups.

### Engineering Blueprint for an Open-Source, Self-Hosted Alternative

The proposed self-hosted platform—named OpenWidget Engine—is architected as a modular, containerized application designed for high concurrency, data isolation, and deployment flexibility.

OpenWidget Multi-Tier System Topology:
1. Client Presentation Tier: Lit-based Web Components (Encapsulated Shadow DOM); Offline Service Worker & IndexedDB Caching Engine; Bidirectional WebSocket & SSE Telemetry Clients.
2. Edge Gateway & Ingress Tier: Reverse Proxy & TLS Termination (Traefik / NGINX); LTI 1.3 OIDC Authentication Gateway (Fastify / Ltijs).
3. Application Services Tier: Core REST & GraphQL API Engine (Node.js Fastify or Go); Real-Time Telemetry & Presence Hub (Redis-backed WebSocket); Authoritative Scoring & Validation Engine (Worker Pool); Asynchronous Ingestion & Transpilation Workers (BullMQ).
4. Persistent Storage Tier: PostgreSQL 16+ (Relational metadata & JSONB item schemas); Redis 7+ (In-memory presence cache & pub/sub telemetry channels); MinIO Cluster (S3-compatible object storage for audio/PDF assets).

The client layer relies on standard Web Components built with Lit, providing strict Shadow DOM encapsulation that prevents external LMS styling sheets from interfering with widget mechanics. Every question type is developed as an independent custom element (such as `<widget-choice-interaction>` or `<widget-chemical-balancer>`), loading only the specific component scripts required by an active activity's declarative schema.

Activities in OpenWidget Engine are structured as declarative, version-controlled JSON documents validated against a strict JSON Schema specification. Example (verbatim):

```json
{
  "$schema": "https://openwidget.org/v1/widget.json",
  "widgetId": "w-geo-80211",
  "version": "1.2.0",
  "templateType": "split_worksheet",
  "metadata": { "title": "Plate Tectonics & Continental Drift", "locale": "en-US", "createdAt": "2026-11-09T08:00:00Z" },
  "layout": { "splitRatio": "50/50", "resourcePane": { "type": "pdf_viewer", "src": "/assets/geology_plate_boundaries.pdf", "tools": { "highlighting": true, "tts": true } } },
  "settings": {
    "scaffolding": { "starQuestions": true, "textToSpeech": true, "onScreenKeyboard": "none", "scratchpad": true },
    "security": { "requireSafeExamBrowser": false, "lockdownBrowserHash": null, "warnUnansweredOnSubmit": true }
  },
  "items": [
    { "id": "item-01", "type": "fill_in_the_blanks", "points": 2, "stem": "Complete the boundary definitions:", "interaction": { "text": "At a [blank:1] boundary, plates slide horizontally past one another.", "blanks": { "1": { "acceptableResponses": ["transform", "conservative"], "caseSensitive": false, "weight": 2 } } } },
    { "id": "item-02", "type": "chemical_equation", "points": 3, "stem": "Balance the reaction for iron oxidation:", "interaction": { "reactants": [{ "formula": "Fe", "coefficient": 4 }, { "formula": "O2", "coefficient": 3 }], "products": [{ "formula": "Fe2O3", "coefficient": 2 }] } }
  ]
}
```

The real-time telemetry pipeline handles event dispatching and scoring without overloading the primary database. As a student interacts with a widget, the client Web Component buffers interaction events and streams them over an encrypted WebSocket connection to the API gateway. Auto-gradable interactions are checked client-side for immediate user feedback while being sent asynchronously to an authoritative backend worker pool that re-evaluates the submission against the stored answer key to prevent score manipulation.

The backend worker updates the student's active attempt state in an in-memory Redis store and publishes the event to an assignment-specific Redis Pub/Sub channel. The teacher's live dashboard subscribes to this channel via Server-Sent Events (SSE) or WebSockets, updating the monitoring grid, status indicators, and score heatmaps in real time.

The relational database architecture uses PostgreSQL 16+, taking advantage of its JSONB features to handle dynamic question structures while maintaining strict relational consistency for institutional accounts, courses, attempts, and grades:

```sql
-- Institutional Tenancy and Single Sign-On Configurations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    lti_consumer_key VARCHAR(128) UNIQUE,
    lti_client_id VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Core User Directory
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'instructor', 'student')),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Declarative Widget Configurations
CREATE TABLE widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    template_type VARCHAR(64) NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
    definition JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Collaborative Shared Spaces for Teachers
CREATE TABLE widget_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_public BOOLEAN DEFAULT FALSE
);

CREATE TABLE widget_group_memberships (
    group_id UUID REFERENCES widget_groups(id) ON DELETE CASCADE,
    widget_id UUID REFERENCES widgets(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, widget_id)
);

-- Published Assignment Instances
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    widget_id UUID REFERENCES widgets(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id),
    lti_lineitem_url TEXT,
    require_seb BOOLEAN DEFAULT FALSE,
    seb_config_hash VARCHAR(128),
    settings_override JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Student Session Attempts and Evaluative Summaries
CREATE TABLE assessment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    state VARCHAR(32) NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'submitted', 'graded', 'reset')),
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE,
    raw_score NUMERIC(6, 2),
    max_score NUMERIC(6, 2),
    feedback_summary TEXT,
    CONSTRAINT unique_active_attempt UNIQUE (assignment_id, user_id, started_at)
);

-- Question-Level Student Submissions and Marking Audit Trails
CREATE TABLE response_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL,
    student_response JSONB NOT NULL,
    auto_score NUMERIC(6, 2),
    manual_score NUMERIC(6, 2),
    is_flagged BOOLEAN DEFAULT FALSE,
    annotations JSONB DEFAULT '[]'::jsonb,
    item_feedback TEXT,
    graded_by UUID REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_item_per_attempt UNIQUE (attempt_id, item_id)
);

-- Relational Indices Supporting Telemetry and Query Concurrency
CREATE INDEX idx_widget_definition ON widgets USING gin (definition);
CREATE INDEX idx_attempts_active ON assessment_attempts (assignment_id, state);
CREATE INDEX idx_response_attempt ON response_records (attempt_id);
```

The deployment infrastructure uses Docker and Kubernetes container orchestration:
- Edge Routing: Traefik or NGINX handles SSL/TLS termination, routes LTI launches, and manages persistent WebSocket sessions.
- Application Services: Stateless Fastify Node.js or Go application servers scale horizontally behind the edge proxy.
- Worker Pools: Redis-backed BullMQ workers handle asynchronous PDF ingestion, raster image processing, and bulk gradebook sync.
- Asset Storage: MinIO clusters provide S3-compatible object storage for learner audio recordings, camera uploads, and instructional reference files.
- Data Sovereignty: Hosting the entire stack on internal institutional servers or sovereign European cloud providers ensures compliance with GDPR and student data privacy regulations.

### Transformative Improvements Over Legacy BookWidgets

OpenWidget Engine addresses the major operational and technical limitations of proprietary assessment software by implementing an offline-first foundation, open data formats, local machine learning models, and modern authoring interfaces.

An offline-first design solves the connectivity vulnerabilities common in school network environments. Using Progressive Web App (PWA) Service Workers, all client libraries, Web Components, question assets, and reference media are cached locally upon launch. User interactions, text input, and drawings are stored immediately in browser IndexedDB storage. Conflict-Free Replicated Data Types (CRDTs), implemented via Yjs, manage state changes across sessions. If a student loses connection during an exam, their client continues operating smoothly without data loss. Once connectivity returns, a background synchronization worker streams the cached CRDT operations to the server, reconciling differences automatically and avoiding submission errors.

Offline Resilience & CRDT State Reconciliation:
1. Initial Launch: PWA Service Worker caches schemas, assets, and Web Components
2. Disconnected Operation: Inputs commit immediately to browser IndexedDB
3. CRDT Mutation Log: State changes append to local Yjs operational journals
4. Connectivity Restoration: Background sync worker detects network recovery
5. Authoritative Merge: Server-side worker reconciles changes and updates telemetry

The platform also provides open export and import pipelines, eliminating the proprietary lock-in that characterizes commercial platforms. Tests can be exported as standard QTI 3.0 zip packages, mapping questions to standard qti-assessment-item declarations that can be loaded into Canvas, Moodle, or national testing engines. Game-based exercises export directly to standard H5P packages. In addition, activity configurations are stored as clean JSON/YAML files, enabling academic departments to manage versioning and collaborative curriculum design using Git repositories.

To safeguard student privacy and eliminate recurring cloud API costs, OpenWidget Engine replaces external generative AI services with self-hosted language models. The architecture integrates containerized inference runtimes—such as Ollama or vLLM—running open-weight models (including Llama 3, Mistral, or Qwen) on internal server GPUs. This local pipeline generates multiple-choice distractors, adjusts reading passage complexity, and drafts analytic rubrics without sending institutional data to third-party endpoints. For subjective evaluation, a local assistive grading co-pilot analyzes long-form answers against configured rubrics and suggests baseline scores and qualitative comments, speeding up teacher review while keeping final grading decisions in the instructor's hands.

Self-Hosted AI Assistance Workflow:
1. Contextual Ingestion: Teacher inputs source material or syllabus prompt
2. Local Inference: Self-hosted LLM (Ollama/vLLM) generates item drafts locally
3. Verification Gate: Teacher reviews, edits, and explicitly confirms suggestions
4. Evaluative Co-Pilot: Open-response submissions receive private, local rubric feedback

The authoring experience replaces multi-tabbed configuration forms with an interactive, block-based visual canvas. Teachers compose worksheets directly on the editing surface, adding question types through slash commands (/multiple-choice, /whiteboard, /chemical-balance) in the style of modern document editors. The canvas renders using the same Lit Web Components that students see, eliminating the need to toggle between separate authoring and preview modes. Built-in media tools provide integrated access to open media repositories (such as Unsplash and Openverse), in-browser microphone recording for language prompts, and real-time LaTeX previews via MathQuill and KaTeX.

An open Web Component plugin architecture allows the community to extend the platform without modifying core code. Developers can package new widgets with an open Software Development Kit (SDK) by providing a component manifest and a Web Component bundle implementing standard lifecycle methods (render(), serializeResponse(), evaluate()). Custom widgets execute within a sandboxed runtime, enabling specialized disciplines to contribute interactive modules—such as 3D molecular viewers (Three.js), electronic circuit simulators, interactive coding sandboxes (Monaco Editor), or sheet music notation editors—while protecting core platform stability and security.

| Architectural Dimension | BookWidgets (Proprietary SaaS) | OpenWidget Engine (Open-Source Architecture) |
| --- | --- | --- |
| Hosting Model | Proprietary multi-tenant cloud. | Self-hosted containerized deployment on institutional infrastructure. |
| Licensing & Cost | Proprietary subscription ($11.95/mo per teacher; group fees for LTI). | Open-source (AGPLv3/Apache 2.0); no recurring per-seat fees. |
| Data Interoperability | Closed proprietary JSON schema; no open exports. | Native bi-directional QTI 3.0, H5P packages, and declarative JSON. |
| Offline Performance | Requires continuous low-latency connection; drops cause errors. | Offline-first PWA with IndexedDB caching and CRDT state reconciliation. |
| AI Integration | Cloud-dependent API integrations. | Self-hosted local LLMs (Ollama/vLLM) protecting data privacy. |
| Authoring Workflow | Multi-tab form configuration panels and modal windows. | Visual block-based WYSIWYG canvas with slash commands and live preview. |
| Accessibility Compliance | Proprietary UI; mixed ratings (3/5 stars in EdTech audits). | Full WCAG 2.2 AA compliance, ARIA live regions, and semantic Shadow DOM. |
| LMS Connectivity | Restricts standard LTI integrations to paid group tiers. | Built-in LTI 1.3 Advantage (Deep Linking, AGS, NRPS) enabled by default. |

### Phased Implementation and Strategic Roadmap

Deploying OpenWidget Engine involves a structured four-phase engineering plan that balances core runtime stability with advanced features.

- Phase 1: Core Foundation & Execution Runtime — Lit Web Components runtime with Shadow DOM style encapsulation; Declarative JSON Schema definitions for baseline question types; PostgreSQL schema, MinIO object storage, and Fastify REST API.
- Phase 2: Offline-First PWA & Real-Time Telemetry — Service Worker asset caching and IndexedDB persistent storage; Redis Pub/Sub WebSocket gateway for live teacher monitoring; Student accessibility bar (TTS, highlighter, star bookmarking).
- Phase 3: Enterprise Interoperability & Assessment Security — 1EdTech LTI 1.3 Advantage suite (Deep Linking, AGS, NRPS); Safe Exam Browser verification and Chromebook Kiosk routing; Multi-tier grading dashboard with keyword scoring and rubrics.
- Phase 4: Modern Ecosystem Enhancements — Visual block-based WYSIWYG authoring canvas with slash commands; Self-hosted local LLM pipeline (Ollama/vLLM) for question generation; Bi-directional QTI 3.0 / H5P transpilers and third-party plugin SDK.

Phase 1 focuses on the core execution engine and rendering foundation. Engineering teams build the base Web Components library using Lit, ensuring complete Shadow DOM encapsulation to isolate widget styles from host pages. This phase delivers the JSON Schema definitions and deterministic auto-grading modules for the primary question types—such as Multiple Choice, Fill-in-the-Blanks, Short Answer, Matching, and Numeric Input. In parallel, teams establish the database schema on PostgreSQL, configure MinIO for file storage, and set up the Fastify API services.

Phase 2 implements offline resilience and the real-time telemetry infrastructure. Engineers configure the PWA Service Worker caching strategies and IndexedDB storage routines, ensuring exercises run smoothly offline and reconcile state changes via CRDT operations upon reconnection. The WebSocket and Redis Pub/Sub event pipeline is deployed during this phase to drive the live teacher monitoring dashboard, surfacing student presence, recency indicators, and real-time question status heatmaps. The pupil client also receives its accessibility toolset, including synthetic speech, text highlighting, and question-starring mechanisms.

Phase 3 establishes institutional interoperability and assessment security. The platform implements the 1EdTech LTI 1.3 Advantage suite, providing secure OIDC SSO launches, Deep Linking for course authoring, and automated gradebook writeback via Assignment and Grade Services. This phase introduces exam security integrations, including cryptographic handshakes for Safe Exam Browser and deep linking for managed Chromebook Kiosk Mode. The teacher grading workspace is built out with multi-tier feedback tools, keyword scoring rules, evaluation codes, and rubric assessment interfaces.

Phase 4 expands the platform with modern authoring ergonomics and extensible integrations. The nested form interface is replaced by the visual, block-based WYSIWYG canvas with slash-command menus. Self-hosted local language models (via Ollama or vLLM) are integrated to assist with question drafting, distractor generation, and rubric creation without external data transfers. Finally, the platform delivers bi-directional QTI 3.0 and H5P import/export tools alongside the public Web Component plugin SDK, establishing an extensible, community-driven ecosystem.

This open architecture provides educational institutions with a sustainable alternative to proprietary assessment software. By combining open educational standards, offline-first reliability, and sovereign data governance, OpenWidget Engine delivers the instructional breadth of BookWidgets while establishing an extensible, accessible, and resilient platform for modern digital learning.
