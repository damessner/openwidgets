// Fill-in-the-blanks item: text with inline inputs parsed from {{n}}
// placeholders. Canonical response: { blanks: { "1": "…", "2": "…" } }.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  fieldset,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'fill_blanks';
export const label = { en: 'Fill in the blanks', de: 'Lückentext' };

registerMessages({
  de: {
    'item.fill_blanks.legend': 'Füllen Sie die Lücken aus.',
    'item.fill_blanks.blank_label': 'Lücke {number}',
    'item.fill_blanks.empty': 'Für diesen Lückentext ist kein Text hinterlegt.',
  },
  en: {
    'item.fill_blanks.legend': 'Fill in the blanks.',
    'item.fill_blanks.blank_label': 'Blank {number}',
    'item.fill_blanks.empty': 'No text is configured for this fill-in-the-blanks item.',
  },
});

const BLANK_PATTERN = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

function extractBlankIds(text, blanksConfig) {
  const ids = [];
  const seen = new Set();
  const regex = new RegExp(BLANK_PATTERN.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  for (const id of Object.keys(blanksConfig || {})) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

let instanceCounter = 0;

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const text = String(config.text || '');
  const blanksConfig = config.blanks && typeof config.blanks === 'object' ? config.blanks : {};
  const blankIds = extractBlankIds(text, blanksConfig);
  const groupName = `ow-fb-${++instanceCounter}`;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  /** @type {Map<string, HTMLInputElement[]>} */
  const blankInputs = new Map();

  function makeBlank(id) {
    const inputId = `${groupName}-blank-${id}`;
    const input = h('input.input.item-blank-input', {
      type: 'text',
      id: inputId,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': t('item.fill_blanks.blank_label', { number: id }),
    });
    if (readonly) input.disabled = true;
    const list = blankInputs.get(id);
    if (list) list.push(input);
    else blankInputs.set(id, [input]);
    return input;
  }

  const field = fieldset(t('item.fill_blanks.legend'));
  const body = h('div.item-blank-text');

  if (text.trim()) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const lineEl = h('div.item-text-line');
      const regex = new RegExp(BLANK_PATTERN.source, 'g');
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          lineEl.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
        }
        lineEl.appendChild(makeBlank(match[1]));
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        lineEl.appendChild(document.createTextNode(line.slice(lastIndex)));
      }
      if (!lineEl.childNodes.length) lineEl.appendChild(document.createTextNode('\u00a0'));
      body.appendChild(lineEl);
    }
    field.appendChild(body);
  }

  if (!blankIds.length) {
    root.appendChild(notice(t('item.fill_blanks.empty'), 'warning'));
  } else {
    // Blanks that are configured but not present as placeholders in the text.
    const placeholderIds = new Set();
    const regex = new RegExp(BLANK_PATTERN.source, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) placeholderIds.add(match[1]);
    const extras = blankIds.filter((id) => !placeholderIds.has(id));
    if (extras.length) {
      const extraList = h('div.item-blank-extra');
      for (const id of extras) {
        const row = h('div.item-field');
        row.appendChild(
          h('label.label', { htmlFor: `${groupName}-blank-${id}`, text: t('item.fill_blanks.blank_label', { number: id }) }),
        );
        row.appendChild(makeBlank(id));
        extraList.appendChild(row);
      }
      field.appendChild(extraList);
    }
    root.appendChild(field);
  }

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const blanks =
      response && response.blanks && typeof response.blanks === 'object' ? response.blanks : {};
    for (const [id, inputs] of blankInputs) {
      const value = blanks[id] === undefined || blanks[id] === null ? '' : String(blanks[id]);
      for (const input of inputs) input.value = value;
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      const blanks = {};
      for (const [id, inputs] of blankInputs) {
        const withValue = inputs.find((input) => input.value !== '') || inputs[0];
        blanks[id] = withValue ? withValue.value : '';
      }
      return { blanks };
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
