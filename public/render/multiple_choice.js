// Multiple choice item: native radio/checkbox inputs styled as large cards.
// Correct-answer marking only happens when the item still carries the keys
// (teacher preview/review); student payloads never do.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  fieldset,
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'multiple_choice';
export const label = { en: 'Multiple choice', de: 'Multiple Choice' };

registerMessages({
  de: {
    'item.multiple_choice.legend_single': 'Wählen Sie genau eine Antwort aus.',
    'item.multiple_choice.legend_multi': 'Wählen Sie eine oder mehrere Antworten aus.',
    'item.multiple_choice.no_choices': 'Für diese Frage sind keine Antwortmöglichkeiten hinterlegt.',
    'item.multiple_choice.correct_answer': 'richtige Antwort',
    'item.multiple_choice.selected': 'ausgewählt',
  },
  en: {
    'item.multiple_choice.legend_single': 'Select exactly one answer.',
    'item.multiple_choice.legend_multi': 'Select one or more answers.',
    'item.multiple_choice.no_choices': 'No answer options are configured for this question.',
    'item.multiple_choice.correct_answer': 'correct answer',
    'item.multiple_choice.selected': 'selected',
  },
});

let instanceCounter = 0;

function choiceDomId(groupName, choiceId) {
  return `${groupName}-${String(choiceId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const multi = config.multi === true;
  const allChoices = Array.isArray(config.choices) ? config.choices : [];
  const choices = allChoices.filter(
    (choice) => choice && typeof choice === 'object' && choice.id !== undefined && choice.id !== null,
  );
  const ordered = config.shuffle === true ? shuffled(choices, ctx, 'choices') : choices;
  const groupName = `ow-mc-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  const field = fieldset(
    t(multi ? 'item.multiple_choice.legend_multi' : 'item.multiple_choice.legend_single'),
  );
  const list = h('div.item-choices');
  /** @type {Array<{input: HTMLInputElement, choice: object, choiceLabel: HTMLElement}>} */
  const entries = [];

  for (const [choiceIndex, choice] of ordered.entries()) {
    const inputId = choiceDomId(groupName, choice.id);
    const input = h('input.item-choice-input', {
      type: multi ? 'checkbox' : 'radio',
      name: groupName,
      id: inputId,
      value: String(choice.id),
    });
    if (readonly) input.disabled = true;

    const text = h('span.item-choice-text');
    text.textContent = String(choice.text === undefined || choice.text === null ? '' : choice.text);

    // redesign v2.4: letter chip A/B/C… rendered via .item-choice::before
    const choiceLabel = h('label.item-choice', {
      htmlFor: inputId,
      dataset: { letter: String.fromCharCode(65 + choiceIndex) },
    }, input, text);

    if (ctx.showAnswers && choice.correct === true) {
      choiceLabel.classList.add('is-correct-answer');
      const mark = h('span.item-choice-mark', { html: icon('check', { size: 16 }) });
      choiceLabel.appendChild(mark);
      choiceLabel.appendChild(h('span.sr-only', t('item.multiple_choice.correct_answer')));
    }

    input.addEventListener('change', () => syncSelection());
    entries.push({ input, choice, choiceLabel });
    list.appendChild(choiceLabel);
  }

  if (!choices.length) {
    root.appendChild(notice(t('item.multiple_choice.no_choices'), 'warning'));
  } else {
    field.appendChild(list);
    root.appendChild(field);
  }

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function selectedEntries() {
    return entries.filter((entry) => entry.input.checked);
  }

  function syncSelection() {
    if (!multi) {
      // Native radios already enforce single selection; keep classes in sync.
    }
    for (const entry of entries) {
      entry.choiceLabel.classList.toggle('is-selected', entry.input.checked);
    }
  }

  function setResponse(response) {
    const selected = new Set(
      response && Array.isArray(response.selected) ? response.selected.map((id) => String(id)) : [],
    );
    for (const entry of entries) {
      entry.input.checked = selected.has(String(entry.choice.id));
    }
    syncSelection();
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { selected: selectedEntries().map((entry) => entry.choice.id) };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'input:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
