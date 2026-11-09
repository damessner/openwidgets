// Item type: numeric — a number typed by the student, accepted with absolute or
// percent tolerance. The expected value is stripped from student payloads.
import { eqScore, parseLocalizedNumber } from '../util.js';
import {
  asFiniteNumber,
  asString,
  makeResult,
  normalizeBaseItem,
  roundScore,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'numeric';
export const meta = {
  label: { en: 'Numeric answer', de: 'Numerische Antwort' },
  scoreable: true,
  category: 'assessment',
};

export function defaultConfig() {
  return { answer: null, tolerance: 0.01, toleranceType: 'absolute' };
}

export function defaultPoints() {
  return 1;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawAnswer = src.answer;
  // `Number(null)` is 0 — do not let an unanswered draft become the value 0.
  const answer =
    rawAnswer === null || rawAnswer === undefined || rawAnswer === ''
      ? null
      : asFiniteNumber(rawAnswer, null);
  const tolerance = asFiniteNumber(src.tolerance, 0.01);
  return {
    answer,
    tolerance: tolerance >= 0 ? tolerance : 0.01,
    toleranceType: src.toleranceType === 'percent' ? 'percent' : 'absolute',
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
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return errors;

  if (config.answer !== null && !Number.isFinite(config.answer)) {
    errors.push('config.answer: must be a number (or empty while drafting)');
  }
  if (!Number.isFinite(config.tolerance) || config.tolerance < 0) {
    errors.push('config.tolerance: must be a number >= 0');
  }
  if (config.tolerance > 1000000) errors.push('config.tolerance: value is unreasonably large');
  if (config.toleranceType !== 'absolute' && config.toleranceType !== 'percent') {
    errors.push('config.toleranceType: must be "absolute" or "percent"');
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const value = source.value !== undefined ? source.value : typeof raw === 'string' ? raw : '';
  if (value !== '' && typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('numeric response needs { value: "raw text" }');
  }
  return { value: String(value).slice(0, 64) };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const maxScore = normalized.points;
  const given = parseLocalizedNumber(response && response.value);
  const answer = config.answer;
  let correct = false;
  let tolerance = null;
  if (given !== null && Number.isFinite(answer)) {
    tolerance = config.toleranceType === 'percent' ? (Math.abs(answer) * config.tolerance) / 100 : config.tolerance;
    correct = Math.abs(given - answer) <= tolerance + 1e-9;
  }
  const autoScore = correct ? roundScore(maxScore) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: correct && eqScore(autoScore, maxScore),
    needsManual: false,
    correctParts: correct ? 1 : 0,
    totalParts: 1,
    // detail is teacher-only (never sent to students) — it may contain the answer
    detail: { given, answer, tolerance },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  // The expected value and the tolerance are the answer — strip both.
  return { ...sanitizeBaseItem(normalized), config: {} };
}

export function summarizeResponse(item, response) {
  return String((response && response.value) || '').slice(0, 40);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  if (normalized.config.answer === null) return null;
  return { value: String(normalized.config.answer) };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  if (normalized.config.answer === null) return [];
  return [String(normalized.config.answer)];
}

export function editSchema() {
  return [
    {
      key: 'answer',
      kind: 'number',
      label: { en: 'Correct value', de: 'Richtiger Wert' },
      help: { en: 'Decimal point or comma both work.', de: 'Dezimalpunkt oder -komma sind erlaubt.' },
    },
    {
      key: 'tolerance',
      kind: 'number',
      label: { en: 'Tolerance', de: 'Toleranz' },
      min: 0,
      max: 1000000,
      help: { en: 'How far off the answer may be.', de: 'Wie weit die Antwort danebenliegen darf.' },
    },
    {
      key: 'toleranceType',
      kind: 'select',
      label: { en: 'Tolerance type', de: 'Toleranzart' },
      options: [
        { value: 'absolute', label: { en: 'Absolute', de: 'Absolut' } },
        { value: 'percent', label: { en: 'Percent', de: 'Prozent' } },
      ],
    },
  ];
}
