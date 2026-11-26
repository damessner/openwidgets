// Item type: vocabulary — a small vocab trainer inside a worksheet.
// Entries are stored inline (snapshot), so activities stay self-contained and
// export/import keeps working. Teachers can populate entries from a saved
// vocab list (see /api/vocab-lists) in the authoring UI.
//
// Modes:
//   - flashcards: flip card term <-> translation, self-rate known/unknown;
//     unknown cards are re-queued once at the end. Not auto-scored (points 0).
//   - translate:  show one side, type the other (direction config, "both"
//     alternates per entry). Auto-graded per entry.
//   - quiz:       trainer flow — one entry at a time, instant server-checked
//     feedback, streak + progress. Same answer model as translate.
//   - spell:      spelling trainer — show the translation, type the word
//     itself (the term is the only accepted answer). Media/example are
//     stripped from the student payload (they would reveal the term).
//   - listen:     play the entry's audio, type the word. Auto-graded.
//   - example:    example sentence with the term masked, type the word.
//   - match:      images on one side, terms as dropdown options on the other
//     ("Bilder ↔ Vokabeln zuordnen"). Response maps entryId -> term text; the
//     association never appears in the sanitized payload (images and terms are
//     emitted as separate shuffled lists).
//
// Sanitize strips the answer side per mode/direction (translation+alternatives
// or the term), so the student payload never leaks answers. Media that belongs
// to the answer side is stripped as well; prompt-side media stays.
import { normalizeText, seededShuffle } from '../util.js';
import {
  asArray,
  asBool,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  uniqueId,
  validateBaseItem,
} from './common.js';

export const type = 'vocabulary';

export const meta = {
  label: { en: 'Vocabulary trainer', de: 'Vokabeln' },
  scoreable: true,
  category: 'assessment',
};

export const MODES = ['flashcards', 'translate', 'quiz', 'spell', 'listen', 'example', 'match'];
export const DIRECTIONS = ['term_to_translation', 'translation_to_term', 'both'];

const MAX_ENTRIES = 60;

export function defaultConfig() {
  return {
    mode: 'translate',
    direction: 'term_to_translation',
    shuffle: true,
    caseSensitive: false,
    entries: [
      {
        id: 'e1',
        term: 'Haus',
        translation: 'house',
        alternatives: [],
        example: 'Das Haus ist groß.',
        imageAssetId: '',
        audioAssetId: '',
      },
    ],
  };
}

export function defaultPoints() {
  return 2;
}

function normalizeEntry(raw, used, index) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    id: uniqueId(src.id, 'e', used, index),
    term: asString(src.term).slice(0, 200),
    translation: asString(src.translation).slice(0, 200),
    alternatives: asArray(src.alternatives)
      .filter((value) => typeof value === 'string')
      .map((value) => value.slice(0, 200))
      .slice(0, 10),
    example: asString(src.example).slice(0, 1000),
    imageAssetId: asString(src.imageAssetId).trim().slice(0, 64),
    audioAssetId: asString(src.audioAssetId).trim().slice(0, 64),
  };
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const mode = MODES.includes(src.mode) ? src.mode : 'translate';
  const direction = DIRECTIONS.includes(src.direction) ? src.direction : 'term_to_translation';
  const used = new Set();
  const entries = asArray(src.entries).slice(0, MAX_ENTRIES).map((entry, index) => normalizeEntry(entry, used, index));
  return {
    mode,
    direction,
    shuffle: asBool(src.shuffle, true),
    caseSensitive: asBool(src.caseSensitive, false),
    entries,
  };
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  return normalizeBaseItem(src, type, normalizeConfig(src.config), defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  const config = normalizeConfig(item.config);
  if (!item.config || typeof item.config !== 'object' || Array.isArray(item.config)) return errors;

  if (!MODES.includes(config.mode)) errors.push('config.mode: must be flashcards|translate|quiz|spell|listen|example|match');
  if (!DIRECTIONS.includes(config.direction)) errors.push('config.direction: invalid');
  if (typeof config.shuffle !== 'boolean') errors.push('config.shuffle: must be a boolean');
  if (typeof config.caseSensitive !== 'boolean') errors.push('config.caseSensitive: must be a boolean');

  if (config.entries.length < 1) errors.push('config.entries: at least one entry is required');
  if (config.entries.length > MAX_ENTRIES) errors.push(`config.entries: at most ${MAX_ENTRIES} entries are allowed`);
  config.entries.forEach((entry, index) => {
    const label = `config.entries[${index}]`;
    if (!entry.term.trim()) errors.push(`${label}.term: must not be empty`);
    if (config.mode !== 'listen' && config.mode !== 'match' && !entry.translation.trim()) {
      errors.push(`${label}.translation: must not be empty (needed for mode "${config.mode}")`);
    }
    if (config.mode === 'listen' && !entry.audioAssetId) {
      errors.push(`${label}.audioAssetId: an audio recording is required in listen mode`);
    }
    if (config.mode === 'example' && !entry.example.trim()) {
      errors.push(`${label}.example: an example sentence is required in example mode`);
    }
    if (config.mode === 'match' && !entry.imageAssetId) {
      errors.push(`${label}.imageAssetId: an image is required in match mode`);
    }
  });
  return errors;
}

/** Direction used for the entry at `index` ("both" alternates). */
export function entryDirection(config, index) {
  if (config.direction !== 'both') return config.direction;
  return index % 2 === 0 ? 'term_to_translation' : 'translation_to_term';
}

/** Prompt side and accepted answers for a typed-mode entry. */
export function promptOf(config, entry, index) {
  const dir = entryDirection(config, index);
  if (config.mode === 'listen') return { kind: 'audio', audioAssetId: entry.audioAssetId };
  if (config.mode === 'example') return { kind: 'example', text: maskTerm(entry.example, entry.term) };
  // spell: the prompt is always the translation — the term (the answer) is typed
  if (config.mode === 'spell') return { kind: 'text', text: entry.translation };
  if (dir === 'translation_to_term') return { kind: 'text', text: entry.translation };
  return { kind: 'text', text: entry.term };
}

export function acceptedOf(config, entry, index) {
  const dir = entryDirection(config, index);
  if (config.mode === 'listen' || config.mode === 'example') return [entry.term];
  // spell: strict — only the term itself counts (it is a spelling exercise)
  if (config.mode === 'spell') return [entry.term];
  if (dir === 'translation_to_term') return [entry.term];
  return [entry.translation, ...entry.alternatives].filter((value) => value.trim() !== '');
}

/** Replace occurrences of the term in the example with a blank (for prompts). */
export function maskTerm(example, term) {
  const text = asString(example);
  const needle = asString(term).trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), '_____');
}

export function isFlashcards(config) {
  return config && config.mode === 'flashcards';
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const entryIds = new Set(config.entries.map((entry) => entry.id));

  if (isFlashcards(config)) {
    const rawRatings = source.ratings && typeof source.ratings === 'object' && !Array.isArray(source.ratings) ? source.ratings : {};
    const ratings = {};
    for (const [entryId, value] of Object.entries(rawRatings)) {
      if (!entryIds.has(entryId)) continue;
      if (value === 'known' || value === 'unknown') ratings[entryId] = value;
    }
    return { ratings };
  }

  if (config.mode === 'match') {
    const rawMatches = source.matches && typeof source.matches === 'object' && !Array.isArray(source.matches) ? source.matches : {};
    const matches = {};
    for (const entry of config.entries) {
      const value = rawMatches[entry.id];
      if (value === undefined || value === null) matches[entry.id] = '';
      else if (typeof value === 'string') {
        matches[entry.id] = value.slice(0, 200);
      } else if (typeof value === 'number' && Number.isFinite(value)) matches[entry.id] = String(value);
      else throw new Error(`vocabulary match for entry "${entry.id}" must be a string`);
    }
    return { matches };
  }

  const rawAnswers = source.answers && typeof source.answers === 'object' && !Array.isArray(source.answers) ? source.answers : {};
  const answers = {};
  for (const entry of config.entries) {
    const value = rawAnswers[entry.id];
    if (value === undefined || value === null) answers[entry.id] = '';
    else if (typeof value === 'string') answers[entry.id] = value.slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) answers[entry.id] = String(value);
    else throw new Error(`vocabulary answer for entry "${entry.id}" must be a string`);
  }
  return { answers };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const entries = config.entries;
  const total = entries.length;

  if (isFlashcards(config)) {
    const ratings = response && response.ratings && typeof response.ratings === 'object' ? response.ratings : {};
    let known = 0;
    const detailRatings = {};
    for (const entry of entries) {
      const value = ratings[entry.id] === 'known' ? 'known' : ratings[entry.id] === 'unknown' ? 'unknown' : null;
      if (value === 'known') known += 1;
      detailRatings[entry.id] = value;
    }
    return makeResult({
      autoScore: 0,
      maxScore: 0, // self-rated practice is not part of the scoreable total
      correct: total > 0 && known === total,
      needsManual: false,
      correctParts: known,
      totalParts: total,
      detail: { mode: 'flashcards', ratings: detailRatings },
    });
  }

  const options = {
    caseSensitive: config.caseSensitive,
    trim: true,
    collapseSpaces: true,
    ignorePunctuation: false,
  };
  if (config.mode === 'match') {
    const matches = response && response.matches && typeof response.matches === 'object' ? response.matches : {};
    const options = { caseSensitive: config.caseSensitive, trim: true, collapseSpaces: true, ignorePunctuation: true };
    const detail = { mode: 'match', matches: {} };
    let correctCount = 0;
    for (const entry of entries) {
      const givenText = normalizeText(matches[entry.id] || '', options);
      const correct = givenText !== '' && givenText === normalizeText(entry.term, options);
      if (correct) correctCount += 1;
      detail.matches[entry.id] = { given: givenText, correct };
    }
    const maxScore = normalized.points;
    const autoScore = total > 0 ? roundScore((maxScore * correctCount) / total) : 0;
    return makeResult({
      autoScore,
      maxScore,
      correct: total > 0 && correctCount === total,
      needsManual: false,
      correctParts: correctCount,
      totalParts: total,
      detail,
    });
  }

  const given = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
  const detail = { mode: config.mode, answers: {} };
  let correctCount = 0;
  entries.forEach((entry, index) => {
    const accepted = acceptedOf(config, entry, index).map((value) => normalizeText(value, options)).filter((value) => value !== '');
    const normalizedGiven = normalizeText(given[entry.id], options);
    const correct = normalizedGiven !== '' && accepted.includes(normalizedGiven);
    if (correct) correctCount += 1;
    detail.answers[entry.id] = { correct, given: normalizedGiven };
  });
  const maxScore = normalized.points;
  const autoScore = total > 0 ? roundScore((maxScore * correctCount) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && correctCount === total,
    needsManual: false,
    correctParts: correctCount,
    totalParts: total,
    detail,
  });
}

/** Student-safe score detail: per-entry given/correct (never the answers). */
export function safeDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const out = {};
  for (const key of ['answers', 'matches']) {
    if (detail[key] && typeof detail[key] === 'object') {
      const per = {};
      for (const [id, info] of Object.entries(detail[key])) {
        if (!info || typeof info !== 'object') continue;
        per[id] = { given: asString(info.given), correct: info.correct === true };
      }
      out[key] = per;
    }
  }
  if (detail.ratings && typeof detail.ratings === 'object') out.ratings = detail.ratings;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Student-safe config: keep the prompt side, strip the answer side per
 * mode/direction (see header comment).
 */
export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const base = { mode: config.mode, direction: config.direction, shuffle: config.shuffle, caseSensitive: config.caseSensitive };

  if (isFlashcards(config)) {
    // self-rated practice: both sides are shown on the card anyway
    return {
      ...sanitizeBaseItem(normalized),
      config: { ...base, entries: config.entries.map((entry) => ({ ...entry, alternatives: [...entry.alternatives] })) },
    };
  }

  if (config.mode === 'match') {
    // images and terms are decoupled: images keep entry ids (response keys),
    // terms go to a separate seeded-shuffled list — the pairing is the secret.
    const images = config.entries.map((entry) => ({ id: entry.id, imageAssetId: entry.imageAssetId }));
    const terms = seededShuffle(
      config.entries.map((entry) => entry.term),
      `vocab-match:${normalized.id}`,
    );
    return {
      ...sanitizeBaseItem(normalized),
      config: { ...base, entries: images, terms },
    };
  }

  const entries = config.entries.map((entry, index) => {
    const dir = entryDirection(config, index);
    if (config.mode === 'spell') {
      // answer is the term: strip term, example and media (they reveal it) —
      // the translation is the prompt
      return { id: entry.id, term: '', translation: entry.translation, alternatives: [], example: '', imageAssetId: '', audioAssetId: '' };
    }
    if (config.mode === 'listen') {
      return { id: entry.id, term: '', translation: '', alternatives: [], example: '', imageAssetId: '', audioAssetId: entry.audioAssetId };
    }
    if (config.mode === 'example') {
      return {
        id: entry.id,
        term: '',
        translation: '',
        alternatives: [],
        example: maskTerm(entry.example, entry.term),
        imageAssetId: entry.imageAssetId,
        audioAssetId: '',
      };
    }
    if (dir === 'translation_to_term') {
      // answer is the term: strip everything that could reveal it
      return { id: entry.id, term: '', translation: entry.translation, alternatives: [], example: '', imageAssetId: '', audioAssetId: '' };
    }
    // answer is the translation: term + example + media are the prompt
    return {
      id: entry.id,
      term: entry.term,
      translation: '',
      alternatives: [],
      example: entry.example,
      imageAssetId: entry.imageAssetId,
      audioAssetId: entry.audioAssetId,
    };
  });
  return { ...sanitizeBaseItem(normalized), config: { ...base, entries } };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  if (isFlashcards(config)) {
    const ratings = response && response.ratings && typeof response.ratings === 'object' ? response.ratings : {};
    const known = config.entries.filter((entry) => ratings[entry.id] === 'known').length;
    return `${known}/${config.entries.length} known`;
  }
  if (config.mode === 'match') {
    const matches = response && response.matches && typeof response.matches === 'object' ? response.matches : {};
    return config.entries.map((entry) => String(matches[entry.id] === undefined ? '' : matches[entry.id]).trim() || '–').join(' | ').slice(0, 120);
  }
  const answers = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
  return config.entries.map((entry) => String(answers[entry.id] === undefined ? '' : answers[entry.id]).trim()).join(' | ').slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  if (isFlashcards(config)) return null;
  if (config.mode === 'match') {
    const matches = {};
    config.entries.forEach((entry) => {
      matches[entry.id] = entry.term;
    });
    return { matches };
  }
  const answers = {};
  config.entries.forEach((entry, index) => {
    const accepted = acceptedOf(config, entry, index);
    answers[entry.id] = accepted[0] || '';
  });
  return { answers };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  if (isFlashcards(config)) return [];
  return config.entries.map((entry) => `${entry.term} — ${entry.translation}`);
}

export function editSchema() {
  return [
    {
      key: 'mode',
      kind: 'select',
      label: { en: 'Mode', de: 'Modus' },
      options: [
        { value: 'flashcards', label: { en: 'Flashcards (self-rated)', de: 'Karteikarten (selbst eingeschätzt)' } },
        { value: 'translate', label: { en: 'Translate (type it)', de: 'Übersetzen (tippen)' } },
        { value: 'quiz', label: { en: 'Quiz trainer (one word at a time, streaks)', de: 'Quiz-Trainer (ein Wort nach dem anderen, Streaks)' } },
        { value: 'spell', label: { en: 'Spelling (type the word itself)', de: 'Rechtschreibung (Wort selbst tippen)' } },
        { value: 'listen', label: { en: 'Listen and type', de: 'Hören und tippen' } },
        { value: 'example', label: { en: 'Example sentence with gap', de: 'Beispielsatz mit Lücke' } },
        { value: 'match', label: { en: 'Match images to words', de: 'Bilder den Wörtern zuordnen' } },
      ],
    },
    {
      key: 'direction',
      kind: 'select',
      label: { en: 'Direction', de: 'Richtung' },
      options: [
        { value: 'term_to_translation', label: { en: 'Term → translation', de: 'Begriff → Übersetzung' } },
        { value: 'translation_to_term', label: { en: 'Translation → term', de: 'Übersetzung → Begriff' } },
        { value: 'both', label: { en: 'Alternate', de: 'Wechseln' } },
      ],
    },
    { key: 'shuffle', kind: 'switch', label: { en: 'Shuffle entries', de: 'Einträge mischen' } },
    { key: 'caseSensitive', kind: 'switch', label: { en: 'Case-sensitive', de: 'Groß-/Kleinschreibung beachten' } },
  ];
}
