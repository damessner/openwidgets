// Item type: long_answer — free text, auto-scored only by keyword hints and
// always needing a teacher's manual score/rubric decision. Hints and rubric
// never reach the student.
import {
  asArray,
  asFiniteNumber,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'long_answer';
export const meta = {
  label: { en: 'Long answer', de: 'Freitext' },
  scoreable: true,
  category: 'assessment',
};

export function defaultConfig() {
  return {
    hints: [],
    rubric: [],
    minWords: 0,
    maxWords: 3000,
  };
}

export function defaultPoints() {
  return 5;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const hints = asArray(src.hints)
    .slice(0, 100)
    .map((entry) => {
      const hint = entry && typeof entry === 'object' ? entry : {};
      const points = asFiniteNumber(hint.points, 1);
      return {
        text: asString(hint.text),
        alternatives: asArray(hint.alternatives)
          .filter((value) => typeof value === 'string')
          .slice(0, 20),
        points: points >= 0 ? points : 1,
      };
    });
  const rubric = asArray(src.rubric)
    .slice(0, 20)
    .map((entry) => {
      const criterion = entry && typeof entry === 'object' ? entry : {};
      return {
        criterion: asString(criterion.criterion),
        levels: asArray(criterion.levels)
          .slice(0, 10)
          .map((level) => {
            const value = level && typeof level === 'object' ? level : {};
            return {
              label: asString(value.label),
              points: Math.max(0, asFiniteNumber(value.points, 0)),
            };
          }),
      };
    });
  const minWords = Math.max(0, Math.round(asFiniteNumber(src.minWords, 0)));
  let maxWords = Math.round(asFiniteNumber(src.maxWords, 3000));
  if (!Number.isFinite(maxWords) || maxWords <= 0) maxWords = 3000;
  maxWords = Math.min(20000, maxWords);
  return { hints, rubric, minWords, maxWords };
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
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return errors;

  const hints = asArray(config.hints);
  if (hints.length > 100) errors.push('config.hints: at most 100 hints are allowed');
  hints.forEach((hint, index) => {
    if (!hint || typeof hint !== 'object') {
      errors.push(`config.hints[${index}]: must be an object`);
      return;
    }
    if (typeof hint.text !== 'string') errors.push(`config.hints[${index}].text: must be a string`);
    if (!Number.isFinite(hint.points) || hint.points < 0) {
      errors.push(`config.hints[${index}].points: must be a number >= 0`);
    }
    const alternatives = asArray(hint.alternatives);
    alternatives.forEach((value, altIndex) => {
      if (typeof value !== 'string') {
        errors.push(`config.hints[${index}].alternatives[${altIndex}]: must be a string`);
      }
    });
  });

  const rubric = asArray(config.rubric);
  if (rubric.length > 20) errors.push('config.rubric: at most 20 criteria are allowed');
  rubric.forEach((criterion, index) => {
    if (!criterion || typeof criterion !== 'object') {
      errors.push(`config.rubric[${index}]: must be an object`);
      return;
    }
    if (typeof criterion.criterion !== 'string') {
      errors.push(`config.rubric[${index}].criterion: must be a string`);
    }
    asArray(criterion.levels).forEach((level, levelIndex) => {
      if (!level || typeof level !== 'object') {
        errors.push(`config.rubric[${index}].levels[${levelIndex}]: must be an object`);
        return;
      }
      if (typeof level.label !== 'string') {
        errors.push(`config.rubric[${index}].levels[${levelIndex}].label: must be a string`);
      }
      if (!Number.isFinite(level.points) || level.points < 0) {
        errors.push(`config.rubric[${index}].levels[${levelIndex}].points: must be a number >= 0`);
      }
    });
  });

  if (!Number.isInteger(config.minWords) || config.minWords < 0) {
    errors.push('config.minWords: must be an integer >= 0');
  }
  if (!Number.isInteger(config.maxWords) || config.maxWords < 0) {
    errors.push('config.maxWords: must be an integer >= 0');
  }
  if (Number.isInteger(config.minWords) && Number.isInteger(config.maxWords) && config.maxWords < config.minWords) {
    errors.push('config.maxWords: must be greater than or equal to minWords');
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (source.text !== undefined && typeof source.text !== 'string') {
    throw new Error('long_answer response needs { text: string }');
  }
  if (typeof raw === 'string') return { text: raw.slice(0, 50000) };
  return { text: asString(source.text).slice(0, 50000) };
}

function countWords(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const text = String((response && response.text) || '');
  const lower = text.toLowerCase();
  const matchedHints = [];
  let hintPoints = 0;
  for (const hint of normalized.config.hints) {
    const terms = [hint.text, ...hint.alternatives]
      .map((value) => String(value || '').toLowerCase().trim())
      .filter((value) => value !== '');
    if (terms.some((term) => lower.includes(term))) {
      hintPoints += hint.points;
      matchedHints.push(hint.text);
    }
  }
  const autoScore = roundScore(Math.min(normalized.points, hintPoints));
  return makeResult({
    autoScore,
    maxScore: normalized.points,
    // A long answer never counts as "correct" on its own — a teacher decides.
    correct: false,
    needsManual: true,
    correctParts: matchedHints.length,
    totalParts: normalized.config.hints.length,
    detail: { matchedHints, wordCount: countWords(text) },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: { minWords: normalized.config.minWords, maxWords: normalized.config.maxWords },
  };
}

export function summarizeResponse(item, response) {
  return String((response && response.text) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const texts = normalized.config.hints.map((hint) => hint.text).filter((value) => value.trim() !== '');
  if (texts.length === 0) return null;
  return { text: texts.join(', ') };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  const texts = normalized.config.hints.map((hint) => hint.text).filter((value) => value.trim() !== '');
  if (texts.length > 0) return texts;
  return normalized.config.rubric.map((criterion) => criterion.criterion).filter((value) => value.trim() !== '');
}

export function editSchema() {
  return [
    {
      key: 'hints',
      kind: 'list',
      label: { en: 'Required terms (auto hints)', de: 'Erwartete Begriffe (Auto-Hinweise)' },
      help: {
        en: 'Each matched term adds its points automatically (capped at the item points).',
        de: 'Jeder gefundene Begriff gibt automatisch seine Punkte (maximal die Item-Punkte).',
      },
      max: 100,
      itemSchema: [
        { key: 'text', kind: 'text', label: { en: 'Term', de: 'Begriff' } },
        {
          key: 'alternatives',
          kind: 'list',
          label: { en: 'Alternatives', de: 'Alternativen' },
          itemSchema: [{ key: '$value', kind: 'text', label: { en: 'Alternative', de: 'Alternative' } }],
        },
        { key: 'points', kind: 'number', label: { en: 'Points', de: 'Punkte' }, min: 0, max: 1000 },
      ],
    },
    {
      key: 'rubric',
      kind: 'list',
      label: { en: 'Rubric', de: 'Bewertungsraster' },
      max: 20,
      itemSchema: [
        { key: 'criterion', kind: 'text', label: { en: 'Criterion', de: 'Kriterium' } },
        {
          key: 'levels',
          kind: 'list',
          label: { en: 'Levels', de: 'Stufen' },
          itemSchema: [
            { key: 'label', kind: 'text', label: { en: 'Level label', de: 'Bezeichnung' } },
            { key: 'points', kind: 'number', label: { en: 'Points', de: 'Punkte' }, min: 0, max: 1000 },
          ],
        },
      ],
    },
    {
      key: 'minWords',
      kind: 'number',
      label: { en: 'Minimum words', de: 'Mindestanzahl Wörter' },
      min: 0,
      max: 20000,
    },
    {
      key: 'maxWords',
      kind: 'number',
      label: { en: 'Maximum words', de: 'Maximale Anzahl Wörter' },
      min: 0,
      max: 20000,
    },
  ];
}
