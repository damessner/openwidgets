// Prompt builders and response sanitizers for the LLM features.
// Pure module — unit-testable without network.
import { itemTypes, getType, createItem, normalizeItem, validateItem, sanitizeItem, answerText } from '../../shared/items/index.js';
import { createDefinition, normalizeActivity, validateActivity } from '../../shared/activity.js';
import { shortId } from '../../shared/util.js';
import { HttpError } from '../lib/http.js';

export const LENGTH_PRESETS = {
  short: { min: 6, max: 9, minutes: '5–10' },
  medium: { min: 10, max: 14, minutes: '10–15' },
  long: { min: 15, max: 20, minutes: '15–20' },
};

export const MIX_PRESETS = {
  simple: ['multiple_choice', 'short_answer', 'numeric', 'fill_blanks', 'match'],
  normal: ['multiple_choice', 'short_answer', 'numeric', 'fill_blanks', 'match', 'ordering', 'table', 'groups', 'mark_sentence', 'long_answer', 'vocabulary'],
  diverse: null, // all types
};

// Types that normally need an uploaded image/audio. The model may still use
// them in "diverse" mode, but must keep them text-describable (media none);
// anything that fails server-side validation is dropped before saving.
const MEDIA_TYPES = new Set(['pins', 'image_boxes', 'hotspot', 'audio_answer']);

const localeName = (locale) => (locale === 'en' ? 'English' : 'German');

function typeCatalog(locale, onlyTypes = null) {
  const list = onlyTypes ? itemTypes.filter((m) => onlyTypes.includes(m.type)) : itemTypes;
  return list.map((m) => {
    let example = null;
    try {
      example = createItem(m.type);
    } catch {
      example = null;
    }
    return {
      type: m.type,
      label: (m.meta && m.meta.label && (m.meta.label[locale] || m.meta.label.en)) || m.type,
      scoreable: !!(m.meta && m.meta.scoreable),
      mediaDependent: MEDIA_TYPES.has(m.type),
      example,
    };
  });
}

export function buildWorksheetPrompt({ topic, subject = '', grade = '', locale = 'de', length = 'medium', mix = 'normal', template = 'worksheet', title = '' } = {}) {
  const preset = LENGTH_PRESETS[length] || LENGTH_PRESETS.medium;
  const allowed = MIX_PRESETS[mix] === null ? null : (MIX_PRESETS[mix] || MIX_PRESETS.normal);
  const lang = localeName(locale);
  const catalog = typeCatalog(locale, allowed);

  const system = [
    `You are an expert school teacher creating a ${template === 'quiz' ? 'quiz' : 'worksheet'} in ${lang}.`,
    'Answer with a single JSON object and NOTHING else (no markdown fences, no commentary):',
    '{"title": string, "description": string, "items": [item, ...]}',
    'Each item has the shape: {"id": string, "type": string, "points": number, "stem": string, "help": string, "media": {"type": "none"}, "config": {...}, "feedback": {"correct": string, "incorrect": string}}',
    'Rules:',
    `- Write ALL student-facing text (title, description, stems, choices, feedback) in ${lang}.`,
    `- Create between ${preset.min} and ${preset.max} items (target ${Math.round((preset.min + preset.max) / 2)}), so a pupil needs roughly ${preset.minutes} minutes.`,
    `- "type" must be one of the types listed below; use a good variety within the allowed set.`,
    '- "points": 1 for easy items, 2 for demanding ones.',
    '- Provide meaningful "feedback.correct" and "feedback.incorrect" for scoreable items.',
    '- For scoreable items the config must contain the correct answers exactly as shown in the type\'s example structure (choices with "correct": true, blanks with "answers", pairs, etc.).',
    '- Media-dependent types (pins, image_boxes, hotspot, audio_answer): only use them if you can describe the zones/boxes in text; set "media" to {"type":"none"} and describe the picture in the stem. The teacher attaches real media later.',
    '- fill_blanks with mode "drag": config.wordBank holds ONLY distractor words (the accepted answers of the <<n>> gaps are added to the word box automatically).',
    '- "text" items may contain inline gaps like <<Haus|house>> — the accepted answers are written directly inside the <<>> markers; "fill_blanks" uses <<1>>-style keys with config.blanks["1"].accepted = [...].',
    'Available item types with an example each:',
    JSON.stringify(catalog, null, 1),
  ].join('\n');

  const user = [
    `Topic: ${topic}`,
    subject ? `Subject: ${subject}` : '',
    grade ? `Grade / age group: ${grade}` : '',
    `Template: ${template}`,
    `Length: ${length} (${preset.minutes} minutes, ${preset.min}–${preset.max} items)`,
    `Type mix: ${mix}${allowed ? ` — prefer these types: ${allowed.join(', ')}` : ' — use a diverse mix of ALL listed types'}`,
    title ? `Suggested title: ${title}` : '',
    `Language: ${lang} (locale "${locale}")`,
  ].filter(Boolean).join('\n');

  return { system, user };
}

/**
 * Validate and normalize a model-generated worksheet definition.
 * Invalid items are dropped (counted); ids are made unique; the result is a
 * canonical activity definition that passes validateActivity.
 * @returns {{definition: object, dropped: number, total: number}}
 */
export function sanitizeGeneratedDefinition(raw, { locale = 'de', template = 'worksheet', maxItems = 24 } = {}) {
  const source = raw && typeof raw === 'object' && raw.definition && typeof raw.definition === 'object' ? raw.definition : raw;
  const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const rawItems = Array.isArray(src.items) ? src.items : [];

  const base = createDefinition({ template, locale });
  base.title = String(src.title || '').trim().slice(0, 200) || (locale === 'en' ? 'AI-generated worksheet' : 'KI-generiertes Arbeitsblatt');
  base.description = String(src.description || '').trim().slice(0, 2000);

  const seen = new Set();
  const items = [];
  let dropped = 0;
  for (const rawItem of rawItems.slice(0, Math.min(rawItems.length, maxItems + 10))) {
    if (items.length >= maxItems) break;
    let item = null;
    try {
      item = normalizeItem(rawItem);
    } catch {
      dropped += 1;
      continue;
    }
    if (!item || !getType(item.type)) {
      dropped += 1;
      continue;
    }
    if (!item.id || seen.has(item.id)) item = { ...item, id: shortId('it') };
    seen.add(item.id);
    if (validateItem(item).length > 0) {
      dropped += 1;
      continue;
    }
    items.push(item);
  }
  if (items.length === 0) {
    throw new HttpError(502, 'llm_invalid_output', 'The model did not return any valid items');
  }
  const definition = normalizeActivity({ ...base, items });
  const check = validateActivity(definition);
  if (!check.ok) {
    throw new HttpError(502, 'llm_invalid_output', 'Generated worksheet failed validation');
  }
  return { definition, dropped, total: rawItems.length };
}

// ---------------------------------------------------------------------------
// Student feedback + revision exercises
// ---------------------------------------------------------------------------

const EXERCISE_TYPES = ['multiple_choice', 'short_answer', 'fill_blanks', 'match', 'ordering', 'numeric', 'mark_sentence'];

/**
 * @param results pseudonymized per-item results:
 *   [{ stem, type, correct, autoScore, maxScore, needsManual }]
 */
export function buildFeedbackPrompt({ locale = 'de', activityTitle = '', results = [] } = {}) {
  const lang = localeName(locale);
  const weak = results.filter((r) => !r.correct || r.needsManual);
  const system = [
    `You are a friendly, encouraging tutor writing feedback for a school pupil in ${lang}.`,
    'Answer with a single JSON object and NOTHING else:',
    '{"summary": string, "tips": [string, ...], "exercises": [item, ...]}',
    'Rules:',
    `- "summary": 2–4 short sentences in ${lang}, addressed to the pupil ("du" form in German), naming what went well and what to practise. Encouraging tone, no grades jargon.`,
    `- "tips": 2–4 concrete, actionable tips in ${lang} targeting the weak areas.`,
    `- "exercises": 2–3 short practice items in ${lang} that target the areas where the pupil lost points. Only use these types: ${EXERCISE_TYPES.join(', ')}.`,
    '- Exercise items must be valid: same shape as in the catalog below (id, type, points: 0, stem, config with the correct answers, feedback).',
    'Item catalog (with examples):',
    JSON.stringify(typeCatalog(locale, EXERCISE_TYPES), null, 1),
  ].join('\n');

  const lines = results.map((r, i) => {
    const score = `${r.autoScore}/${r.maxScore}`;
    const status = r.needsManual ? 'manual' : r.correct ? 'correct' : 'incorrect';
    return `${i + 1}. [${r.type}] (${status}, ${score}) ${String(r.stem || '').replace(/\s+/g, ' ').slice(0, 140)}`;
  });
  const user = [
    `Worksheet: ${activityTitle || (locale === 'en' ? 'untitled' : 'unbenannt')}`,
    `Language: ${lang} (locale "${locale}")`,
    `Pupil's results per item:`,
    lines.join('\n') || (locale === 'en' ? '(no scoreable items)' : '(keine bewertbaren Aufgaben)'),
    weak.length
      ? `${locale === 'en' ? 'Focus the exercises on these weak items:' : 'Konzentriere die Übungen auf diese schwachen Stellen:'} ${weak.map((w) => w.type).join(', ')}`
      : (locale === 'en' ? 'All items correct — give praise and one consolidation exercise.' : 'Alles richtig — lobe und gib eine Festigungsaufgabe.'),
  ].join('\n');

  return { system, user };
}

// ---------------------------------------------------------------------------
// Writing task feedback (criteria-based, formative, pseudonymized)
// ---------------------------------------------------------------------------

/**
 * @param criteria [{id, label, weight, description}]
 * @param text the student's current draft (truncated server-side)
 */
export function buildWritingFeedbackPrompt({ locale = 'de', gradeLevel = '', criteria = [], sourceText = '', text = '', loop = 1, previous = null, requiredWords = [] } = {}) {
  const lang = localeName(locale);
  const words = (Array.isArray(requiredWords) ? requiredWords : []).map((w) => String(w).trim()).filter(Boolean);
  const system = [
    `You are a supportive school teacher giving formative feedback on a pupil's written text in ${lang}.`,
    'Answer with a single JSON object and NOTHING else:',
    '{"summary": string, "criteria": [{"id": string, "label": string, "met": number, "comment": string, "tip": string}]}',
    'Rules:',
    `- "summary": 2–4 sentences in ${lang}, addressed to the pupil ("du"), naming strengths and the most important next step. Encouraging, no grades.`,
    `- "criteria": exactly one entry per criterion id given below, same order. "met" is a number 0..1 (how well the criterion is met in THIS draft).`,
    `- "comment": 1–2 sentences per criterion in ${lang}, specific to the text. "tip": one concrete, actionable revision tip per criterion.`,
    '- Base everything strictly on the pupil\'s text and the criteria. Do not invent content the pupil did not write.',
    gradeLevel ? `- Target grade level: ${gradeLevel} — calibrate vocabulary and expectations accordingly.` : '',
    words.length
      ? `- The pupil MUST use these words/phrases in the text (word box): ${JSON.stringify(words)}. Check each one: if it is missing, say so explicitly in the summary and in the most relevant criterion comment, and give a tip how to include it naturally.`
      : '',
    `This is feedback loop ${loop}${previous ? ' (a previous feedback round exists — acknowledge progress if the draft improved)' : ''}.`,
    'Criteria (id, label, weight %, description):',
    JSON.stringify(criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight, description: c.description || '' })), null, 1),
  ].filter(Boolean).join('\n');

  const user = [
    sourceText ? `Source material:\n${sourceText.slice(0, 6000)}` : '',
    `Pupil's text (${String(text || '').trim().split(/\s+/).filter(Boolean).length} words):`,
    String(text || '').slice(0, 12000),
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

/** Sanitize a model-generated writing feedback object for storage/display. */
export function sanitizeWritingFeedback(raw, criteria = []) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const summary = String(src.summary || '').trim().slice(0, 1500);
  const byId = new Map((Array.isArray(criteria) ? criteria : []).map((c) => [String(c.id), c]));
  const outCriteria = [];
  const rawCriteria = Array.isArray(src.criteria) ? src.criteria : [];
  for (const c of rawCriteria) {
    const entry = c && typeof c === 'object' ? c : {};
    const id = String(entry.id || '');
    const base = byId.get(id) || {};
    const met = Number(entry.met);
    outCriteria.push({
      id,
      label: String(entry.label || base.label || id).slice(0, 120),
      met: Number.isFinite(met) ? Math.max(0, Math.min(1, met)) : 0,
      comment: String(entry.comment || '').trim().slice(0, 600),
      tip: String(entry.tip || '').trim().slice(0, 400),
    });
  }
  // keep only criteria the teacher defined
  const filtered = outCriteria.filter((c) => byId.has(c.id));
  if (!summary && filtered.length === 0) {
    throw new HttpError(502, 'llm_invalid_output', 'The model returned an empty writing feedback');
  }
  return { summary, criteria: filtered };
}

/** Sanitize a model-generated feedback object for storage/display. */
export function sanitizeFeedback(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const summary = String(src.summary || '').trim().slice(0, 1500);
  const tips = (Array.isArray(src.tips) ? src.tips : [])
    .map((tip) => String(tip || '').trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 6);
  const exercises = [];
  const rawExercises = Array.isArray(src.exercises) ? src.exercises : [];
  const seen = new Set();
  for (const rawItem of rawExercises.slice(0, 4)) {
    let item = null;
    try {
      item = normalizeItem(rawItem);
    } catch {
      continue;
    }
    if (!item || !EXERCISE_TYPES.includes(item.type)) continue;
    if (!item.id || seen.has(item.id)) item = { ...item, id: shortId('ex') };
    seen.add(item.id);
    if (validateItem(item).length > 0) continue;
    item = { ...item, points: 0 };
    const safe = sanitizeItem(item);
    let solution = [];
    try {
      solution = answerText(item);
    } catch {
      solution = [];
    }
    exercises.push({ item: safe, solution });
  }
  if (!summary && tips.length === 0 && exercises.length === 0) {
    throw new HttpError(502, 'llm_invalid_output', 'The model returned an empty feedback');
  }
  return { summary, tips, exercises, generatedAt: new Date().toISOString() };
}
