// Shared test fixtures: canonical responses for every item type, derived from
// the raw (unsanitized) item definition the test owns.

export function correctResponse(item) {
  const config = item.config || {};
  switch (item.type) {
    case 'multiple_choice':
      return { selected: (config.choices || []).filter((choice) => choice.correct).map((choice) => choice.id) };
    case 'short_answer':
      return { text: (config.accepted || [''])[0] };
    case 'numeric':
      return { value: String(config.answer) };
    case 'fill_blanks': {
      const blanks = {};
      for (const [key, blank] of Object.entries(config.blanks || {})) blanks[key] = (blank.accepted || [''])[0];
      return { blanks };
    }
    case 'match': {
      const matches = {};
      for (const pair of config.pairs || []) matches[pair.id] = pair.id;
      return { matches };
    }
    case 'ordering':
      return { order: (config.items || []).map((entry) => entry.id) };
    case 'pins': {
      const points = {};
      for (const zone of config.zones || []) points[zone.id] = { x: zone.x, y: zone.y };
      return { points };
    }
    case 'long_answer':
      return { text: 'An einer konvergenten Plattengrenze taucht eine Platte unter die andere (Subduktion), dabei entsteht Magma.' };
    default:
      return {};
  }
}

/** A deliberately wrong answer for the auto-graded types (used for live states). */
export function wrongResponse(item) {
  const config = item.config || {};
  switch (item.type) {
    case 'multiple_choice': {
      if (config.multi) {
        // Select only wrong choices when they exist, otherwise a single correct one.
        const wrong = (config.choices || []).filter((choice) => !choice.correct).map((choice) => choice.id);
        return { selected: wrong.length > 0 ? wrong.slice(0, 1) : [] };
      }
      const wrongChoice = (config.choices || []).find((choice) => !choice.correct);
      return { selected: wrongChoice ? [wrongChoice.id] : [] };
    }
    case 'short_answer':
      return { text: 'völlig falsche antwort' };
    case 'numeric':
      return { value: String((Number(config.answer) || 0) + 1234) };
    case 'fill_blanks': {
      const blanks = {};
      for (const key of Object.keys(config.blanks || {})) blanks[key] = 'falsch';
      return { blanks };
    }
    case 'match': {
      const pairs = config.pairs || [];
      const matches = {};
      pairs.forEach((pair, index) => {
        matches[pair.id] = pairs[(index + 1) % pairs.length].id;
      });
      return { matches };
    }
    case 'ordering':
      return { order: (config.items || []).map((entry) => entry.id).reverse() };
    case 'pins': {
      const points = {};
      for (const zone of config.zones || []) points[zone.id] = { x: 0.02, y: 0.02 };
      return { points };
    }
    case 'long_answer':
      return { text: 'Keine Ahnung.' };
    default:
      return {};
  }
}

/** Answer only some parts correctly (produces partial credit + gaps). */
export function partialResponse(item) {
  const config = item.config || {};
  switch (item.type) {
    case 'multiple_choice': {
      const correct = (config.choices || []).filter((choice) => choice.correct).map((choice) => choice.id);
      return { selected: correct.slice(0, Math.max(1, Math.ceil(correct.length / 2))) };
    }
    case 'fill_blanks': {
      const entries = Object.entries(config.blanks || {});
      const blanks = {};
      entries.forEach(([key, blank], index) => {
        blanks[key] = index === 0 ? (blank.accepted || [''])[0] : 'falsch';
      });
      return { blanks };
    }
    case 'match': {
      const pairs = config.pairs || [];
      const matches = {};
      pairs.forEach((pair, index) => {
        matches[pair.id] = index % 2 === 0 ? pair.id : pairs[(index + 1) % pairs.length].id;
      });
      return { matches };
    }
    default:
      return correctResponse(item);
  }
}

/** Names used for synthetic live-dashboard participants. */
export const DEMO_STUDENTS = ['Anna Berger', 'Ben Hofer', 'Clara Moser'];
