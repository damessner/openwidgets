// Item-type registry bridge for the authoring UI.
//
// The canonical item definitions live in `shared/items/index.js` (server-dev).
// We import that module dynamically because the client cannot assume it is
// ready yet; if it is missing we degrade gracefully:
//   1. palette + labels come from `GET /api/capabilities`,
//   2. authoring forms use the local fallback schemas below (mirroring §4.1 of
//      docs/CONTRACT.md),
//   3. items are created with local default configs.
// The fallback is only an authoring convenience — the server always validates
// whatever we save.
import { get } from '/lib/api.js';
import { getLocale, t } from '/lib/i18n.js';

export const CANONICAL_TYPE_ORDER = [
  'text',
  'multiple_choice',
  'short_answer',
  'numeric',
  'fill_blanks',
  'match',
  'ordering',
  'pins',
  'image_boxes',
  'long_answer',
  'hotspot',
  'table',
  'groups',
  'mark_sentence',
  'audio_answer',
  'vocabulary',
  'hangman',
  'crossword',
];

/** Emoji shown on the palette buttons (one per item type). */
export const TYPE_EMOJIS = {
  text: '📝',
  multiple_choice: '☑️',
  short_answer: '✏️',
  numeric: '🔢',
  fill_blanks: '🧩',
  match: '🔗',
  ordering: '🔀',
  pins: '📍',
  image_boxes: '🖼️',
  long_answer: '📄',
  hotspot: '🎯',
  table: '🧮',
  groups: '🗂️',
  mark_sentence: '🖍️',
  audio_answer: '🎙️',
  vocabulary: '📚',
  hangman: '😶',
  crossword: '🔤',
};

export function typeEmoji(type) {
  return TYPE_EMOJIS[type] || '▫️';
}

const FALLBACK_META = {
  text: { label: { de: 'Textblock', en: 'Text block' }, scoreable: false, category: 'structure', points: 0 },
  multiple_choice: { label: { de: 'Multiple Choice', en: 'Multiple choice' }, scoreable: true, category: 'assessment', points: 1 },
  short_answer: { label: { de: 'Kurze Antwort', en: 'Short answer' }, scoreable: true, category: 'assessment', points: 1 },
  numeric: { label: { de: 'Numerische Antwort', en: 'Numeric answer' }, scoreable: true, category: 'assessment', points: 1 },
  fill_blanks: { label: { de: 'Lückentext', en: 'Fill in the blanks' }, scoreable: true, category: 'assessment', points: 1 },
  match: { label: { de: 'Zuordnen', en: 'Matching' }, scoreable: true, category: 'interactive', points: 1 },
  ordering: { label: { de: 'Reihenfolge', en: 'Ordering' }, scoreable: true, category: 'interactive', points: 1 },
  pins: { label: { de: 'Bild markieren', en: 'Mark on image' }, scoreable: true, category: 'interactive', points: 1 },
  image_boxes: { label: { de: 'Kästchen im Bild', en: 'Label boxes on image' }, scoreable: true, category: 'assessment', points: 2 },
  long_answer: { label: { de: 'Freitext', en: 'Long answer' }, scoreable: true, category: 'manual', points: 3 },
  hotspot: { label: { de: 'Hotspot-Bild (TipToi)', en: 'Hotspot image (TipToi)' }, scoreable: true, category: 'interactive', points: 2 },
  table: { label: { de: 'Tabelle (ausfüllen / Matrix)', en: 'Table (fill / matrix question)' }, scoreable: true, category: 'assessment', points: 2 },
  groups: { label: { de: 'In Zonen gruppieren (Drag & Drop)', en: 'Group into zones (drag & drop)' }, scoreable: true, category: 'interactive', points: 2 },
  mark_sentence: { label: { de: 'Satz markieren / Wörter streichen', en: 'Mark / correct words in a sentence' }, scoreable: true, category: 'assessment', points: 2 },
  audio_answer: { label: { de: 'Audio-Antwort (Aufnahme)', en: 'Audio answer (record)' }, scoreable: true, category: 'manual', points: 3 },
  vocabulary: { label: { de: 'Vokabeln', en: 'Vocabulary trainer' }, scoreable: true, category: 'assessment', points: 2 },
  hangman: { label: { de: 'Galgenmännchen', en: 'Hangman' }, scoreable: true, category: 'assessment', points: 2 },
  crossword: { label: { de: 'Kreuzworträtsel', en: 'Crossword' }, scoreable: true, category: 'interactive', points: 3 },
};

const CATEGORY_LABELS = {
  structure: { de: 'Struktur', en: 'Structure' },
  content: { de: 'Inhalt', en: 'Content' },
  assessment: { de: 'Wissensabfrage', en: 'Assessment' },
  interactive: { de: 'Interaktiv', en: 'Interactive' },
  manual: { de: 'Manuelle Bewertung', en: 'Manual grading' },
  media: { de: 'Medien', en: 'Media' },
};

// ---------------------------------------------------------------------------
// Registry loading (cached)
// ---------------------------------------------------------------------------

let registryPromise = null;
let registry = null;
let capabilitiesPromise = null;

export function loadItemRegistry() {
  if (!registryPromise) {
    registryPromise = import('/shared/items/index.js')
      .then((mod) => {
        registry = mod && typeof mod === 'object' ? mod : null;
        return registry;
      })
      .catch(() => {
        registry = null;
        return null;
      });
  }
  return registryPromise;
}

export function getItemRegistry() {
  return registry;
}

export function loadCapabilities() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = get('/api/capabilities').catch(() => null);
  }
  return capabilitiesPromise;
}

function labelFromValue(label, type) {
  if (label && typeof label === 'object') {
    return { en: String(label.en || label.de || type), de: String(label.de || label.en || type) };
  }
  if (typeof label === 'string' && label) {
    const text = t(label);
    return { en: text, de: text };
  }
  const fallback = FALLBACK_META[type] ? FALLBACK_META[type].label : { de: type, en: type };
  return { ...fallback };
}

function normalizeMeta(entry) {
  const type = (entry && (entry.type || entry.id)) || 'text';
  const fallback = FALLBACK_META[type] || { label: { de: type, en: type }, scoreable: true, category: 'content', points: 1 };
  return {
    type,
    label: labelFromValue(entry && entry.label, type),
    scoreable: entry && entry.scoreable !== undefined ? Boolean(entry.scoreable) : fallback.scoreable,
    category: (entry && entry.category) || fallback.category,
    points: entry && Number.isFinite(Number(entry.points)) ? Number(entry.points) : fallback.points,
  };
}

let palettePromise = null;
let paletteByType = null; // normalized palette entries by type, set by loadPalette()

/** Palette entries: [{type,label:{en,de},scoreable,category}] in canonical order. */
export function loadPalette() {
  if (!palettePromise) {
    palettePromise = (async () => {
      await loadItemRegistry();
      let entries = [];
      if (registry && typeof registry.itemTypeMeta === 'function') {
        try {
          const meta = registry.itemTypeMeta();
          if (Array.isArray(meta)) entries = meta;
        } catch {
          /* fall through to capabilities */
        }
      }
      if (entries.length === 0) {
        const caps = await loadCapabilities();
        if (caps && Array.isArray(caps.itemTypes)) entries = caps.itemTypes;
      }
      if (entries.length === 0) {
        entries = CANONICAL_TYPE_ORDER.map((type) => ({ type, ...FALLBACK_META[type] }));
      }
      // De-duplicate by type, then prefer a canonical order.
      const byType = new Map();
      for (const entry of entries) {
        const meta = normalizeMeta(entry);
        if (!byType.has(meta.type)) byType.set(meta.type, meta);
      }
      const ordered = [];
      for (const type of CANONICAL_TYPE_ORDER) {
        const meta = byType.get(type);
        if (meta) {
          ordered.push(meta);
          byType.delete(type);
        }
      }
      for (const meta of byType.values()) ordered.push(meta);
      paletteByType = new Map(ordered.map((meta) => [meta.type, meta]));
      return ordered;
    })();
  }
  return palettePromise;
}

export function paletteEntry(type) {
  // Prefer the real registry/capabilities meta once the palette has loaded;
  // fall back to the local table so labels work even before loadPalette() ran.
  if (paletteByType && paletteByType.has(type)) return paletteByType.get(type);
  if (registry && typeof registry.itemTypeMeta === 'function') {
    try {
      const meta = registry.itemTypeMeta().find((entry) => entry && entry.type === type);
      if (meta) return normalizeMeta(meta);
    } catch {
      /* fall through to local fallback */
    }
  }
  return normalizeMeta({ type, ...(FALLBACK_META[type] || {}) });
}

export function typeLabel(type) {
  const meta = paletteEntry(type);
  return getLocale() === 'en' ? meta.label.en : meta.label.de;
}

export function isScoreableType(type) {
  return paletteEntry(type).scoreable;
}

export function defaultPointsForType(type) {
  return paletteEntry(type).points;
}

/** Localized category heading for the palette. */
export function categoryLabel(category) {
  const known = CATEGORY_LABELS[category];
  if (known) return getLocale() === 'en' ? known.en : known.de;
  const key = `teacher.category_${category}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return String(category || t('teacher.category_more'));
}

// ---------------------------------------------------------------------------
// Default item factories (fallback when shared/items is unavailable)
// ---------------------------------------------------------------------------

export function newRandomId() {
  let random = '';
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b.toString(36)).join('');
  } catch {
    random = Math.random().toString(36).slice(2);
  }
  return (random + 'zzzzzz').slice(0, 8);
}

export function newItemId() {
  return `it_${newRandomId().slice(0, 6)}`;
}

/** Next stable config id like c1/c2 for a list inside one item. */
export function nextConfigId(existing, prefix, startAt = 1) {
  const values = Array.isArray(existing) ? existing : [];
  let max = startAt - 1;
  for (const entry of values) {
    const id = entry && typeof entry === 'object' ? entry.id : null;
    if (typeof id !== 'string') continue;
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

export function fallbackConfig(type) {
  switch (type) {
    case 'text':
      return { text: '' };
    case 'multiple_choice':
      return {
        multi: false,
        shuffle: false,
        partialCredit: true,
        choices: [
          { id: 'c1', text: '', correct: false },
          { id: 'c2', text: '', correct: false },
        ],
      };
    case 'short_answer':
      return { accepted: [''], caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true };
    case 'numeric':
      return { answer: 0, tolerance: 0.01, toleranceType: 'absolute' };
    case 'fill_blanks':
      return { text: '', blanks: {}, caseSensitive: false };
    case 'match':
      return { pairs: [{ id: 'p1', left: '', right: '' }, { id: 'p2', left: '', right: '' }], shuffle: true };
    case 'ordering':
      return { items: [{ id: 'i1', text: '' }, { id: 'i2', text: '' }], mode: 'positions' };
    case 'pins':
      return { image: { assetId: '', alt: '' }, zones: [] };
    case 'long_answer':
      return {
        hints: [],
        rubric: [],
        minWords: 0,
        maxWords: 3000,
      };
    default:
      return {};
  }
}

export function fallbackItem(type, opts = {}) {
  const meta = FALLBACK_META[type] || FALLBACK_META.multiple_choice;
  return {
    id: opts.id || newItemId(),
    type,
    points: opts.points !== undefined ? Number(opts.points) : meta.points,
    stem: opts.stem !== undefined ? String(opts.stem) : '',
    help: '',
    media: { type: 'none' },
    config: fallbackConfig(type),
    feedback: { correct: '', incorrect: '' },
  };
}

/** Create a brand-new item with defaults (prefers the shared registry). */
export function createItem(type, opts = {}) {
  if (registry && typeof registry.createItem === 'function') {
    try {
      const item = registry.createItem(type, opts);
      if (item && typeof item === 'object') {
        if (!item.type) item.type = type;
        if (!item.id) item.id = newItemId();
        return item;
      }
    } catch {
      /* fall through */
    }
  }
  return fallbackItem(type, opts);
}

function deepMergeConfig(base, incoming) {
  const out = { ...(base || {}) };
  const source = incoming && typeof incoming === 'object' ? incoming : {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Ensure an item loaded from the server has every field the editor needs. */
export function normalizeItemForEditor(raw) {
  const type = raw && typeof raw.type === 'string' ? raw.type : 'text';
  const base = fallbackItem(type);
  const merged = {
    ...base,
    ...(raw || {}),
    type,
    media: raw && raw.media ? { ...raw.media } : { type: 'none' },
    config: deepMergeConfig(base.config, raw && raw.config),
    feedback: { correct: '', incorrect: '', ...(raw && raw.feedback ? raw.feedback : {}) },
  };
  if (!merged.id) merged.id = newItemId();
  if (!Number.isFinite(Number(merged.points))) merged.points = base.points;
  if (registry && typeof registry.normalizeItem === 'function') {
    try {
      const normalized = registry.normalizeItem(merged);
      if (normalized && typeof normalized === 'object') return normalized;
    } catch {
      /* keep local normalization */
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Answer key description (used by print view and editor hints)
// ---------------------------------------------------------------------------

function canonicalCorrectResponse(item) {
  const config = item.config || {};
  switch (item.type) {
    case 'multiple_choice': {
      const selected = (config.choices || []).filter((choice) => choice && choice.correct).map((choice) => choice.id);
      return { selected };
    }
    case 'short_answer': {
      const accepted = Array.isArray(config.accepted) ? config.accepted : [];
      const first = accepted.find((entry) => typeof entry === 'string' && entry.trim());
      return { text: first || '' };
    }
    case 'numeric':
      return { value: config.answer === undefined || config.answer === null ? '' : String(config.answer) };
    case 'fill_blanks': {
      const blanks = config.blanks && typeof config.blanks === 'object' ? config.blanks : {};
      const out = {};
      for (const [key, value] of Object.entries(blanks)) {
        const accepted = value && Array.isArray(value.accepted) ? value.accepted : [];
        const first = accepted.find((entry) => typeof entry === 'string' && entry.trim());
        out[key] = first || '';
      }
      return { blanks: out };
    }
    case 'match': {
      const matches = {};
      for (const pair of config.pairs || []) {
        if (pair && pair.id) matches[pair.id] = pair.id;
      }
      return { matches };
    }
    case 'ordering':
      return { order: (config.items || []).filter((entry) => entry && entry.id).map((entry) => entry.id) };
    case 'pins': {
      const points = {};
      for (const zone of config.zones || []) {
        if (zone && zone.id) points[zone.id] = { x: Number(zone.x) || 0, y: Number(zone.y) || 0 };
      }
      return { points };
    }
    case 'long_answer': {
      const hints = Array.isArray(config.hints) ? config.hints : [];
      return { text: hints.map((hint) => (hint && hint.text) || '').join(' ') };
    }
    case 'text':
    default:
      return {};
  }
}

function localAnswerLines(item) {
  const config = item.config || {};
  const percent = (value) => `${Math.round(Number(value) || 0)} %`;
  switch (item.type) {
    case 'multiple_choice': {
      const correct = (config.choices || []).filter((choice) => choice && choice.correct).map((choice) => choice.text);
      return correct.length ? correct : [];
    }
    case 'short_answer':
      return (Array.isArray(config.accepted) ? config.accepted : []).filter((entry) => typeof entry === 'string' && entry.trim());
    case 'numeric':
      return config.answer === undefined || config.answer === null ? [] : [String(config.answer)];
    case 'fill_blanks': {
      const blanks = config.blanks && typeof config.blanks === 'object' ? config.blanks : {};
      const lines = [];
      for (const [key, value] of Object.entries(blanks)) {
        const accepted = value && Array.isArray(value.accepted) ? value.accepted.filter(Boolean) : [];
        lines.push(`${t('teacher.blank_n', { n: key })}: ${accepted.join(' / ') || '—'}`);
      }
      return lines;
    }
    case 'match':
      return (config.pairs || []).map((pair) => `${pair.left || '—'} → ${pair.right || '—'}`);
    case 'ordering':
      return [(config.items || []).map((entry) => entry.text || '—').join(' → ')];
    case 'pins':
      return (config.zones || []).map(
        (zone) => `${zone.label || t('teacher.zone_n', { n: zone.id })} (${percent((Number(zone.x) || 0) * 100)}, ${percent((Number(zone.y) || 0) * 100)}, r ${percent((Number(zone.r) || 0) * 100)})`,
      );
    case 'long_answer': {
      const lines = [];
      const hints = Array.isArray(config.hints) ? config.hints : [];
      if (hints.length) lines.push(hints.map((hint) => hint && hint.text).filter(Boolean).join(', '));
      for (const criterion of Array.isArray(config.rubric) ? config.rubric : []) {
        if (!criterion) continue;
        const levels = Array.isArray(criterion.levels) ? criterion.levels : [];
        lines.push(`${criterion.criterion || '—'}: ${levels.map((level) => `${level.label || ''} (${level.points ?? 0})`).join(' / ')}`);
      }
      return lines;
    }
    default:
      return [];
  }
}

/**
 * Human-readable correct answer lines for the answer key. Prefers the shared
 * registry's `answerText()` (canonical), then `summarizeResponse` on the
 * canonical correct response, then a local config reader.
 */
export function describeCorrect(item) {
  if (!item) return [];
  if (registry && typeof registry.answerText === 'function') {
    try {
      const lines = registry.answerText(item);
      if (Array.isArray(lines) && lines.length) return lines.map((line) => String(line)).filter((line) => line.trim() !== '');
      if (typeof lines === 'string' && lines.trim()) return [lines];
    } catch {
      /* fall back to summarize */
    }
  }
  if (registry && typeof registry.summarizeResponse === 'function') {
    try {
      const summarized = registry.summarizeResponse(item, canonicalCorrectResponse(item));
      if (typeof summarized === 'string' && summarized.trim()) return [summarized];
    } catch {
      /* fall back to local description */
    }
  }
  return localAnswerLines(item).filter((line) => String(line).trim() !== '');
}

/**
 * Fresh ids for a duplicated item (item id + all config sub-ids). Uses the
 * shared registry helper when available; otherwise just swaps the item id.
 */
export function regenerateItemIds(item) {
  if (registry && typeof registry.regenerateItemIds === 'function') {
    try {
      const copy = registry.regenerateItemIds(item);
      if (copy && typeof copy === 'object') return copy;
    } catch {
      /* fall back */
    }
  }
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = newItemId();
  return copy;
}

/** Short one-line summary of the correct answer (for editor chips). */
export function correctAnswerSummary(item) {
  const lines = describeCorrect(item);
  return lines.length ? lines.join(' · ') : '';
}

// ---------------------------------------------------------------------------
// Fallback edit schemas (§4.1 config shapes). Only used when
// `shared/items/index.js` cannot be imported; a JSON editor remains available
// for anything the generated form cannot cover.
// ---------------------------------------------------------------------------

const textField = (key, de, en, extra = {}) => ({ key, kind: 'text', label: { de, en }, ...extra });
const areaField = (key, de, en, extra = {}) => ({ key, kind: 'textarea', label: { de, en }, ...extra });
const switchField = (key, de, en, extra = {}) => ({ key, kind: 'switch', label: { de, en }, ...extra });
const numberField = (key, de, en, extra = {}) => ({ key, kind: 'number', label: { de, en }, ...extra });
const listField = (key, de, en, fields, extra = {}) => ({
  key,
  kind: 'list',
  label: { de, en },
  itemSchema: { fields },
  ...extra,
});

export const FALLBACK_SCHEMAS = {
  text: [areaField('text', 'Text', 'Text', { help: { de: 'Markdown-lite: **fett**, *kursiv*, - Listen', en: 'Markdown-lite: **bold**, *italic*, - lists' } })],
  multiple_choice: [
    switchField('multi', 'Mehrere Antworten erlaubt', 'Allow multiple answers'),
    switchField('shuffle', 'Antworten mischen', 'Shuffle answers'),
    switchField('partialCredit', 'Teilpunkte vergeben', 'Award partial credit'),
    listField('choices', 'Antwortoptionen', 'Answer choices', [
      textField('text', 'Text', 'Text'),
      switchField('correct', 'Richtig', 'Correct'),
    ]),
  ],
  short_answer: [
    {
      key: 'accepted',
      kind: 'list',
      primitive: 'lines',
      label: { de: 'Akzeptierte Antworten', en: 'Accepted answers' },
      help: { de: 'Eine Antwort pro Zeile.', en: 'One answer per line.' },
    },
    switchField('caseSensitive', 'Groß-/Kleinschreibung beachten', 'Case sensitive'),
    switchField('trim', 'Leerzeichen am Rand ignorieren', 'Trim whitespace'),
    switchField('collapseSpaces', 'Mehrfache Leerzeichen zusammenfassen', 'Collapse spaces'),
    switchField('ignorePunctuation', 'Satzzeichen ignorieren', 'Ignore punctuation'),
  ],
  numeric: [
    numberField('answer', 'Richtige Antwort', 'Correct answer', { step: 'any' }),
    numberField('tolerance', 'Toleranz', 'Tolerance', { step: 'any', min: 0 }),
    {
      key: 'toleranceType',
      kind: 'select',
      label: { de: 'Toleranz-Typ', en: 'Tolerance type' },
      options: [
        { value: 'absolute', label: { de: 'Absolut', en: 'Absolute' } },
        { value: 'percent', label: { de: 'Prozent', en: 'Percent' } },
      ],
    },
  ],
  fill_blanks: [],
  match: [
    switchField('shuffle', 'Rechte Spalte mischen', 'Shuffle right column'),
    listField('pairs', 'Paare', 'Pairs', [
      textField('left', 'Links', 'Left'),
      textField('right', 'Rechts', 'Right'),
    ]),
  ],
  ordering: [
    {
      key: 'mode',
      kind: 'select',
      label: { de: 'Bewertung', en: 'Scoring' },
      options: [
        { value: 'positions', label: { de: 'Teilpunkte pro Position', en: 'Partial credit per position' } },
        { value: 'exact', label: { de: 'Nur vollständig richtig', en: 'Exact order only' } },
      ],
    },
    listField('items', 'Elemente in richtiger Reihenfolge', 'Items in correct order', [textField('text', 'Text', 'Text')]),
  ],
  pins: [],
  long_answer: [
    listField('hints', 'Hinweise', 'Hints', [
      textField('text', 'Hinweis', 'Hint'),
      numberField('points', 'Punkte', 'Points', { min: 0, step: 1 }),
      {
        key: 'alternatives',
        kind: 'list',
        primitive: 'lines',
        label: { de: 'Alternativen', en: 'Alternatives' },
        help: { de: 'Eine Alternative pro Zeile.', en: 'One alternative per line.' },
      },
    ]),
    listField('rubric', 'Bewertungsraster', 'Rubric', [
      textField('criterion', 'Kriterium', 'Criterion'),
      {
        key: 'levels',
        kind: 'list',
        label: { de: 'Stufen', en: 'Levels' },
        itemSchema: {
          fields: [
            textField('label', 'Bezeichnung', 'Label'),
            numberField('points', 'Punkte', 'Points', { min: 0, step: 0.5 }),
          ],
        },
      },
    ]),
    numberField('minWords', 'Mindestwörter', 'Minimum words', { min: 0, step: 1 }),
    numberField('maxWords', 'Höchstwortzahl', 'Maximum words', { min: 0, step: 1 }),
  ],
};

/** Authoring schema for a type: shared registry first, local fallback second. */
export function editSchemaFor(type) {
  if (registry && typeof registry.getType === 'function') {
    try {
      const module = registry.getType(type);
      if (module && typeof module.editSchema === 'function') {
        const schema = module.editSchema();
        if (Array.isArray(schema) && schema.length) return schema;
      }
    } catch {
      /* fall back */
    }
  }
  if (registry && Array.isArray(registry.itemTypes)) {
    try {
      const match = registry.itemTypes.find((entry) => entry && entry.type === type);
      if (match && typeof match.editSchema === 'function') {
        const schema = match.editSchema();
        if (Array.isArray(schema) && schema.length) return schema;
      }
    } catch {
      /* fall back */
    }
  }
  const fallback = FALLBACK_SCHEMAS[type];
  return Array.isArray(fallback) ? fallback : [];
}

/** True when the shared registry is available (drives "advanced" hints). */
export function hasSharedRegistry() {
  return Boolean(registry);
}

export { FALLBACK_META, CATEGORY_LABELS };
