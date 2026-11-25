// Item type: hangman (Galgenmännchen). The student guesses the word letter by
// letter (German alphabet incl. ÄÖÜ). Scoring: won => full points; lost =>
// half of the per-letter share of correctly revealed unique letters (so a
// nearly-solved word still earns partial credit). The word itself is the
// answer key and never reaches the student payload.
import {
  asArray,
  asBool,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'hangman';

export const meta = {
  label: { en: 'Hangman', de: 'Galgenmännchen' },
  scoreable: true,
  category: 'assessment',
};

/** German letter set for the on-screen keyboard (ÄÖÜ included). */
export const ALPHABET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ü'];

export const DEFAULT_MAX_ATTEMPTS = 8;

/** Letters of the word (uppercased, only A-ZÄÖÜ kept as guessable cells). */
export function wordLetters(word) {
  return asString(word)
    .toUpperCase()
    .split('')
    .filter((ch) => ALPHABET.includes(ch));
}

export function defaultConfig() {
  return {
    word: 'Baum',
    alternatives: [],
    hint: '',
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    caseSensitive: false,
  };
}

export function defaultPoints() {
  return 2;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const maxAttempts = Number(src.maxAttempts);
  return {
    word: asString(src.word).slice(0, 60),
    alternatives: asArray(src.alternatives).filter((v) => typeof v === 'string').map((v) => v.slice(0, 60)).slice(0, 5),
    hint: asString(src.hint).slice(0, 500),
    maxAttempts: Number.isFinite(maxAttempts) ? Math.min(20, Math.max(3, Math.round(maxAttempts))) : DEFAULT_MAX_ATTEMPTS,
    caseSensitive: asBool(src.caseSensitive, false),
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
  if (wordLetters(config.word).length < 2) errors.push('config.word: needs at least 2 letters (A-Z, ÄÖÜ)');
  if (wordLetters(config.word).length > 40) errors.push('config.word: at most 40 letters');
  if (typeof config.hint !== 'string') errors.push('config.hint: must be a string');
  if (typeof config.maxAttempts !== 'number') errors.push('config.maxAttempts: must be a number');
  if (typeof config.caseSensitive !== 'boolean') errors.push('config.caseSensitive: must be a boolean');
  return errors;
}

/** All accepted words (main + alternatives). */
export function acceptedWords(item) {
  const normalized = normalizeItem(item);
  return [normalized.config.word, ...normalized.config.alternatives]
    .map((w) => asString(w).trim())
    .filter((w) => wordLetters(w).length >= 2);
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawLetters = asArray(source.letters).filter((v) => typeof v === 'string');
  const letters = [...new Set(rawLetters.map((v) => v.toUpperCase().slice(0, 1)).filter((ch) => ALPHABET.includes(ch)))].slice(0, 40);
  return { letters };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const maxScore = normalized.points;
  const letters = new Set(asArray(response && response.letters).map((v) => String(v).toUpperCase()));

  let won = false;
  let bestRevealed = 0;
  let bestUnique = 1;
  let bestRevealedLetters = [];
  let bestUniqueSet = new Set();
  for (const word of acceptedWords(normalized)) {
    const wordL = wordLetters(word);
    if (wordL.length === 0) continue;
    const unique = new Set(wordL);
    // wordLetters() uppercases, normalizeResponse() uppercases — plain set lookup
    const revealed = [...unique].filter((ch) => letters.has(ch));
    if (revealed.length === unique.size) won = true;
    const ratio = revealed.length / unique.size;
    if (ratio > bestRevealed / bestUnique) {
      bestRevealed = revealed.length;
      bestUnique = unique.size;
      bestRevealedLetters = revealed;
      bestUniqueSet = unique;
    }
  }

  const revealedRatio = bestUnique > 0 ? bestRevealed / bestUnique : 0;
  const wrongLetters = [...letters].filter((ch) => !bestUniqueSet.has(ch));
  const autoScore = won ? maxScore : roundScore(maxScore * 0.5 * revealedRatio);
  return makeResult({
    autoScore,
    maxScore,
    correct: won,
    needsManual: false,
    correctParts: bestRevealed,
    totalParts: bestUnique,
    detail: { letters: [...letters], revealed: bestRevealedLetters, wrong: wrongLetters, won, revealedRatio },
  });
}

/**
 * Student-safe subset of the score detail: which guessed letters are in the
 * word (progressive reveal) and which were wrong. The word itself stays secret.
 */
export function safeDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  return {
    revealed: asArray(detail.revealed).filter((v) => typeof v === 'string'),
    wrong: asArray(detail.wrong).filter((v) => typeof v === 'string'),
    won: detail.won === true,
  };
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  // The word (and alternatives) are the answer key — strip them. The hint is
  // the prompt and stays.
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      hint: normalized.config.hint,
      maxAttempts: normalized.config.maxAttempts,
      caseSensitive: normalized.config.caseSensitive,
      wordLength: wordLetters(normalized.config.word).length,
      uniqueLetters: new Set(wordLetters(normalized.config.word)).size,
    },
  };
}

export function summarizeResponse(item, response) {
  const letters = asArray(response && response.letters).map((v) => String(v).toUpperCase());
  return letters.join(' ').slice(0, 120) || '–';
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  return { word: normalized.config.word, alternatives: normalized.config.alternatives };
}

export function answerText(item) {
  return acceptedWords(item);
}

export function editSchema() {
  return [
    { key: 'word', kind: 'text', label: { en: 'Word to guess', de: 'Zu erratendes Wort' } },
    {
      key: 'alternatives',
      kind: 'list',
      label: { en: 'Alternative accepted words', de: 'Alternativ akzeptierte Wörter' },
      itemSchema: [{ key: '$value', kind: 'text', label: { en: 'Word', de: 'Wort' } }],
    },
    { key: 'hint', kind: 'textarea', label: { en: 'Hint / clue', de: 'Hinweis / Rätselfrage' } },
    { key: 'maxAttempts', kind: 'number', label: { en: 'Max. wrong guesses', de: 'Max. Fehlversuche' }, min: 3, max: 20 },
    { key: 'caseSensitive', kind: 'switch', label: { en: 'Case-sensitive', de: 'Groß-/Kleinschreibung beachten' } },
  ];
}
