// Builds a multi-level vocabulary "course" from a vocabulary list (v0.9).
// Pure module — importable from server and tests. The levels escalate from
// recognition to spelling; the final level is a quiz that tests every word
// (typed translation + crossword/hangman for spelling).
import { createDefinition, normalizeActivity, validateActivity } from './activity.js';
import { createItem } from './items/index.js';
import { autoLayout } from './items/crossword.js';
import { shortId } from './util.js';

const FINAL_QUIZ_MAX_ENTRIES = 12;
const CROSSWORD_MAX_WORDS = 8;
const HANGMAN_MAX_WORDS = 6;

function toVocabEntries(entries) {
  return entries.map((entry, index) => ({
    id: `e${index + 1}`,
    term: String(entry.term || ''),
    translation: String(entry.translation || ''),
    alternatives: Array.isArray(entry.alternatives) ? entry.alternatives.filter((v) => typeof v === 'string') : [],
    example: String(entry.example || ''),
    imageAssetId: String(entry.imageAssetId || ''),
    audioAssetId: String(entry.audioAssetId || ''),
  }));
}

function vocabItem(mode, entries, direction = 'term_to_translation', points = 2) {
  const item = createItem('vocabulary', { id: shortId('vi'), points });
  item.stem = '';
  item.config = {
    mode,
    direction,
    shuffle: true,
    caseSensitive: false,
    entries,
  };
  return item;
}

function levelDefinition({ title, description, template = 'worksheet', items }) {
  const definition = createDefinition({ template, locale: 'de', title });
  definition.description = description || '';
  definition.items = items;
  return normalizeActivity(definition);
}

/**
 * @param {{title: string, description?: string, sourceLang?: string, targetLang?: string, entries: Array}} input
 * @returns {{levels: object[], levelTitles: string[]}} canonical activity definitions
 */
export function buildVocabCourse({ title, description = '', sourceLang = 'de', targetLang = 'en', entries = [] } = {}) {
  const clean = (Array.isArray(entries) ? entries : []).filter((e) => e && String(e.term || '').trim());
  if (clean.length < 3) {
    throw new Error('At least 3 entries are needed to build a course');
  }
  const vocabEntries = toVocabEntries(clean);
  const base = String(title || 'Vokabeln').trim() || 'Vokabeln';
  const langLabel = String(targetLang || 'en');
  const levels = [];
  const levelTitles = [];

  const push = (levelTitle, def) => {
    const check = validateActivity(def);
    if (!check.ok) throw new Error(`generated level "${levelTitle}" is invalid: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    levels.push(def);
    levelTitles.push(levelTitle);
  };

  push(`${base} — Level 1: Kennenlernen`, levelDefinition({
    title: `${base} — Level 1: Kennenlernen`,
    description: 'Wörter kennenlernen (Karteikarten).',
    items: [vocabItem('flashcards', vocabEntries)],
  }));

  // Level 2: matching needs images per entry; example mode needs example
  // sentences; otherwise fall back to bidirectional typing.
  const withImage = vocabEntries.filter((e) => e.imageAssetId);
  const withExample = vocabEntries.filter((e) => e.example.trim());
  if (withImage.length >= 3) {
    push(`${base} — Level 2: Bilder zuordnen`, levelDefinition({
      title: `${base} — Level 2: Bilder zuordnen`,
      description: 'Ordne die Bilder den Wörtern zu.',
      items: [vocabItem('match', withImage)],
    }));
  } else if (withExample.length >= 3) {
    push(`${base} — Level 2: Beispielsätze`, levelDefinition({
      title: `${base} — Level 2: Beispielsätze`,
      description: 'Ergänze das fehlende Wort im Beispielsatz.',
      items: [vocabItem('example', withExample)],
    }));
  } else {
    push(`${base} — Level 2: Beidseitiges Quiz`, levelDefinition({
      title: `${base} — Level 2: Beidseitiges Quiz`,
      template: 'quiz',
      description: 'Übersetze in beide Richtungen — ein Wort nach dem anderen.',
      items: [vocabItem('quiz', vocabEntries, 'both', 2)],
    }));
  }

  push(`${base} — Level 3: Vokabel-Quiz (${sourceLang} → ${targetLang})`, levelDefinition({
    title: `${base} — Level 3: Vokabel-Quiz`,
    template: 'quiz',
    description: `Quiz-Trainer: ein Wort nach dem anderen übersetzen — mit Sofort-Check, Serie und Fortschritt.`,
    items: [vocabItem('quiz', vocabEntries, 'term_to_translation', 3)],
  }));

  push(`${base} — Level 4: Rückwärts-Quiz (${targetLang} → ${sourceLang})`, levelDefinition({
    title: `${base} — Level 4: Rückwärts-Quiz`,
    template: 'quiz',
    description: `Quiz-Trainer rückwärts: Übersetze zurück ins ${sourceLang}.`,
    items: [vocabItem('quiz', vocabEntries, 'translation_to_term', 3)],
  }));

  push(`${base} — Level 5: Buchstabieren`, levelDefinition({
    title: `${base} — Level 5: Buchstabieren`,
    template: 'quiz',
    description: 'Rechtschreib-Trainer: Sieh die Übersetzung und tippe das Wort selbst richtig.',
    items: [vocabItem('spell', vocabEntries, 'translation_to_term', 3)],
  }));

  const withAudio = vocabEntries.filter((e) => e.audioAssetId);
  if (withAudio.length >= 3) {
    push(`${base} — Level 6: Hören & Schreiben`, levelDefinition({
      title: `${base} — Level 6: Hören & Schreiben`,
      description: 'Höre das Wort und schreibe es richtig (Aussprache + Rechtschreibung).',
      items: [vocabItem('listen', withAudio, 'term_to_translation', 3)],
    }));
  }

  // Final level: spelling/meaning quiz — typed translation per word + crossword (spelling)
  const finalItems = [];
  for (const entry of vocabEntries.slice(0, FINAL_QUIZ_MAX_ENTRIES)) {
    const item = createItem('short_answer', { id: shortId('it'), points: 1 });
    item.stem = `Schreibe das ${langLabel}-Wort zu „${entry.term}“ (Rechtschreibung zählt):`;
    item.config = {
      accepted: [entry.translation, ...entry.alternatives].filter((v) => v && v.trim()),
      caseSensitive: false,
      trim: true,
      collapseSpaces: true,
      ignorePunctuation: true,
    };
    item.feedback = { correct: 'Richtig!', incorrect: `Richtig wäre: ${entry.translation}` };
    finalItems.push(item);
  }

  const crossEntries = vocabEntries
    .filter((e) => /^[A-Za-zÄÖÜäöüß]+$/.test(e.term.trim()) && e.term.trim().length >= 3)
    .slice(0, CROSSWORD_MAX_WORDS)
    .map((e) => ({ word: e.term.trim().toUpperCase(), clue: e.translation || e.term }));
  const layout = autoLayout(crossEntries);
  if (layout && layout.length >= 2) {
    const cross = createItem('crossword', { id: shortId('it'), points: 3 });
    cross.stem = 'Kreuzworträtsel: Löse die Begriffe (Rechtschreibung).';
    cross.config = {
      title: `${base} — Abschluss`,
      words: layout.map((w, index) => ({ id: `w${index + 1}`, word: w.word, clue: w.clue, row: w.row, col: w.col, direction: w.direction })),
    };
    finalItems.push(cross);
  } else {
    for (const entry of vocabEntries.slice(0, HANGMAN_MAX_WORDS)) {
      const hang = createItem('hangman', { id: shortId('it'), points: 1 });
      hang.stem = `Errate das Wort: ${entry.translation || ''}`;
      hang.config = { word: entry.term.trim(), alternatives: entry.alternatives, hint: entry.example || '', maxAttempts: 6, caseSensitive: false };
      finalItems.push(hang);
    }
  }

  push(`${base} — Abschluss-Test`, levelDefinition({
    title: `${base} — Abschluss-Test`,
    description: 'Abschlusstest: alle Vokabeln schreiben und buchstabieren.',
    template: 'quiz',
    items: finalItems,
  }));

  return { levels, levelTitles };
}
