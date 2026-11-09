// Item type: multiple_choice — single or multiple correct choices, optional
// partial credit. Answer keys never leave the server via sanitizeItem().
import { clamp, eqScore } from '../util.js';
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

export const type = 'multiple_choice';

export const meta = {
  label: { en: 'Multiple choice', de: 'Multiple Choice' },
  scoreable: true,
  category: 'assessment',
};

function defaultChoices() {
  return [
    { id: 'c1', text: '', correct: true },
    { id: 'c2', text: '', correct: false },
  ];
}

export function defaultConfig() {
  return { multi: false, choices: defaultChoices(), shuffle: false, partialCredit: true };
}

export function defaultPoints() {
  return 1;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const rawChoices = asArray(src.choices);
  const source = rawChoices.length > 0 ? rawChoices : defaultChoices();
  const used = new Set();
  const choices = source.slice(0, 50).map((choice, index) => {
    const c = choice && typeof choice === 'object' ? choice : {};
    return {
      id: uniqueId(c.id, 'c', used, index),
      text: asString(c.text),
      correct: asBool(c.correct, false),
    };
  });
  return {
    multi: asBool(src.multi, false),
    choices,
    shuffle: asBool(src.shuffle, false),
    partialCredit: asBool(src.partialCredit, true),
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

  const choices = asArray(config.choices);
  if (choices.length < 2) errors.push('config.choices: at least two choices are required');
  if (choices.length > 50) errors.push('config.choices: at most 50 choices are allowed');

  const ids = new Set();
  choices.forEach((choice, index) => {
    if (!choice || typeof choice !== 'object') {
      errors.push(`config.choices[${index}]: must be an object`);
      return;
    }
    if (typeof choice.id !== 'string' || !choice.id) {
      errors.push(`config.choices[${index}].id: must be a non-empty string`);
    } else if (ids.has(choice.id)) {
      errors.push(`config.choices[${index}].id: duplicate choice id "${choice.id}"`);
    } else {
      ids.add(choice.id);
    }
    if (typeof choice.text !== 'string') errors.push(`config.choices[${index}].text: must be a string`);
    else if (choice.text.length > 2000) errors.push(`config.choices[${index}].text: at most 2000 characters`);
    if (typeof choice.correct !== 'boolean') errors.push(`config.choices[${index}].correct: must be a boolean`);
  });

  const correctCount = choices.filter((choice) => choice && choice.correct === true).length;
  if (correctCount === 0) errors.push('config.choices: mark at least one choice as correct');
  if (!config.multi && correctCount > 1) {
    errors.push('config.choices: a single-choice item needs exactly one correct choice');
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const selectedRaw = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? raw.selected : undefined;
  if (!Array.isArray(selectedRaw)) {
    throw new Error('multiple_choice response needs { selected: [choiceId] }');
  }
  const known = new Set(asArray(item.config.choices).map((choice) => choice.id));
  const selected = [];
  for (const value of selectedRaw) {
    if (typeof value !== 'string') continue;
    if (!known.has(value)) continue;
    if (!selected.includes(value)) selected.push(value);
  }
  const multi = !!item.config.multi;
  return { selected: multi ? selected : selected.slice(0, 1) };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const config = normalized.config;
  const maxScore = normalized.points;
  const correctIds = config.choices.filter((choice) => choice.correct).map((choice) => choice.id);
  const knownIds = new Set(config.choices.map((choice) => choice.id));
  const selected = asArray(response && response.selected)
    .filter((id) => typeof id === 'string' && knownIds.has(id))
    .filter((id, index, list) => list.indexOf(id) === index);
  const wrongIds = selected.filter((id) => !correctIds.includes(id));
  const missingIds = correctIds.filter((id) => !selected.includes(id));
  const correctSelected = selected.filter((id) => correctIds.includes(id)).length;

  let ratio = 0;
  if (correctIds.length > 0) {
    if (!config.multi) {
      ratio = selected.length === 1 && correctIds.includes(selected[0]) ? 1 : 0;
    } else if (config.partialCredit) {
      ratio = clamp((correctSelected - wrongIds.length) / correctIds.length, 0, 1);
    } else {
      const exact =
        selected.length === correctIds.length && correctIds.every((id) => selected.includes(id));
      ratio = exact ? 1 : 0;
    }
  }

  const autoScore = roundScore(maxScore * ratio);
  return makeResult({
    autoScore,
    maxScore,
    correct: eqScore(autoScore, maxScore) && correctIds.length > 0,
    needsManual: false,
    correctParts: config.multi ? correctSelected : correctSelected === 1 && ratio === 1 ? 1 : 0,
    totalParts: config.multi ? correctIds.length : 1,
    detail: { selected, correctIds, missingIds, wrongIds },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      multi: normalized.config.multi,
      shuffle: normalized.config.shuffle,
      partialCredit: normalized.config.partialCredit,
      choices: normalized.config.choices.map((choice) => ({ id: choice.id, text: choice.text })),
    },
  };
}

function letterFor(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`;
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const selected = asArray(response && response.selected);
  const parts = [];
  for (const choice of normalized.config.choices) {
    if (selected.includes(choice.id)) parts.push(choice.text.trim() || letterFor(normalized.config.choices.indexOf(choice)));
  }
  return parts.join(', ').slice(0, 120);
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  return { selected: normalized.config.choices.filter((choice) => choice.correct).map((choice) => choice.id) };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return normalized.config.choices
    .map((choice, index) => ({ choice, index }))
    .filter((entry) => entry.choice.correct)
    .map((entry) => entry.choice.text.trim() || letterFor(entry.index));
}

export function editSchema() {
  return [
    {
      key: 'multi',
      kind: 'switch',
      label: { en: 'Multiple answers', de: 'Mehrere Antworten erlaubt' },
      help: {
        en: 'Students may select more than one choice.',
        de: 'Schüler:innen dürfen mehrere Antworten auswählen.',
      },
    },
    {
      key: 'partialCredit',
      kind: 'switch',
      label: { en: 'Partial credit', de: 'Teilpunkte' },
      help: {
        en: 'Give a share of the points when only some choices are right.',
        de: 'Anteilige Punkte, wenn nur ein Teil der Antworten richtig ist.',
      },
    },
    {
      key: 'shuffle',
      kind: 'switch',
      label: { en: 'Shuffle choices', de: 'Antworten mischen' },
    },
    {
      key: 'choices',
      kind: 'list',
      label: { en: 'Choices', de: 'Antwortmöglichkeiten' },
      min: 2,
      max: 50,
      itemSchema: [
        { key: 'text', kind: 'text', label: { en: 'Choice text', de: 'Antworttext' } },
        { key: 'correct', kind: 'switch', label: { en: 'Correct', de: 'Richtig' } },
      ],
    },
  ];
}
