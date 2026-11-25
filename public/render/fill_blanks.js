// Fill-in-the-blanks item: text with inline gaps parsed from <<n>>
// placeholders (legacy {{n}} still rendered). Canonical response:
// { blanks: { "1": "…", "2": "…" } }.
// config.mode "drag": words are dragged from a word box (config.wordBank)
// into the gaps; click-to-select + click-gap works as a fallback.
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
    'item.fill_blanks.wordbox': 'Wortbox — Wörter in die Lücken ziehen (oder antippen und Lücke anklicken)',
    'item.fill_blanks.word_used': 'schon verwendet',
    'item.fill_blanks.clear_gap': 'Lücke leeren',
  },
  en: {
    'item.fill_blanks.legend': 'Fill in the blanks.',
    'item.fill_blanks.blank_label': 'Blank {number}',
    'item.fill_blanks.empty': 'No text is configured for this fill-in-the-blanks item.',
    'item.fill_blanks.wordbox': 'Word box — drag words into the blanks (or tap a word, then a blank)',
    'item.fill_blanks.word_used': 'already used',
    'item.fill_blanks.clear_gap': 'Clear blank',
  },
});

const BLANK_PATTERN = /<<\s*([A-Za-z0-9_-]+)\s*>>|\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

function extractBlankIds(text, blanksConfig) {
  const ids = [];
  const seen = new Set();
  const regex = new RegExp(BLANK_PATTERN.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    const id = match[1] || match[2];
    if (id && !seen.has(id)) {
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
  const dragMode = config.mode === 'drag';
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

  /** @type {Map<string, HTMLInputElement[]>} input-mode blanks */
  const blankInputs = new Map();
  /** @type {Map<string, HTMLElement[]>} drag-mode gap drop zones */
  const blankZones = new Map();
  /** @type {Map<string, HTMLElement>} gap id -> filled word chip inside the gap */
  const gapFills = new Map();
  let selectedWord = null;

  function makeBlankInput(id) {
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

  function clearGap(id) {
    const fill = gapFills.get(id);
    if (fill) {
      fill.remove();
      gapFills.delete(id);
    }
    const zone = blankZones.get(id);
    if (zone) zone.forEach((z) => z.classList.remove('is-filled'));
    const chip = wordChips.get(id);
    if (chip) chip.classList.remove('is-used');
  }

  /** word chips keyed by the gap they currently fill (null = unused) */
  const wordChips = new Map(); // gapId|null -> chip element... we track reverse below
  const chipByWord = new Map(); // chip element -> word
  const chipGap = new Map(); // chip element -> gap id | null

  function makeWordChip(word) {
    const chip = h('span.item-word-chip', { text: word, draggable: String(!readonly) });
    chip.dataset.word = word;
    chip.setAttribute('role', 'button');
    chip.tabIndex = readonly ? -1 : 0;
    chipByWord.set(chip, word);
    chipGap.set(chip, null);
    if (!readonly) {
      chip.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', word);
        event.dataTransfer.effectAllowed = 'move';
        selectedWord = chip;
        chip.classList.add('is-dragging');
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('is-dragging');
        selectedWord = null;
      });
      chip.addEventListener('click', () => {
        if (selectedWord === chip) {
          selectedWord = null;
          chip.classList.remove('is-selected');
          return;
        }
        document.querySelectorAll('.item-word-chip.is-selected').forEach((el) => el.classList.remove('is-selected'));
        selectedWord = chip;
        chip.classList.add('is-selected');
      });
    }
    return chip;
  }

  function assignWordToGap(chip, gapId) {
    const word = chipByWord.get(chip);
    // remove word from a previous gap
    const prevGap = chipGap.get(chip);
    if (prevGap) clearGap(prevGap);
    clearGap(gapId);
    const zone = (blankZones.get(gapId) || [])[0];
    if (!zone) return;
    const fill = h('span.item-gap-word', { text: word });
    fill.dataset.word = word;
    fill.appendChild(h('button.item-gap-clear', {
      type: 'button',
      title: t('item.fill_blanks.clear_gap'),
      'aria-label': t('item.fill_blanks.clear_gap'),
      text: '×',
    }));
    fill.querySelector('.item-gap-clear').addEventListener('click', (event) => {
      event.stopPropagation();
      clearGap(gapId);
    });
    zone.appendChild(fill);
    zone.classList.add('is-filled');
    gapFills.set(gapId, fill);
    chipGap.set(chip, gapId);
    wordChips.set(gapId, chip);
    chip.classList.add('is-used');
    chip.classList.remove('is-selected');
    selectedWord = null;
  }

  function makeGapZone(id) {
    const zone = h('span.item-blank-gap', {
      'data-gap-id': id,
      role: 'button',
      tabindex: readonly ? -1 : 0,
      'aria-label': t('item.fill_blanks.blank_label', { number: id }),
    });
    zone.appendChild(h('span.item-blank-gap-placeholder', { text: `‹${id}›`, 'aria-hidden': 'true' }));
    const list = blankZones.get(id);
    if (list) list.push(zone);
    else blankZones.set(id, [zone]);
    if (!readonly) {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        zone.classList.add('is-drag-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('is-drag-over');
        const word = event.dataTransfer.getData('text/plain');
        const chip = [...chipByWord.entries()].find(([, w]) => w === word)?.[0];
        if (chip) assignWordToGap(chip, id);
      });
      zone.addEventListener('click', () => {
        if (selectedWord) assignWordToGap(selectedWord, id);
        else if (gapFills.has(id)) clearGap(id);
      });
    }
    return zone;
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
        const gapId = match[1] || match[2];
        lineEl.appendChild(dragMode ? makeGapZone(gapId) : makeBlankInput(gapId));
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
    while ((match = regex.exec(text)) !== null) placeholderIds.add(match[1] || match[2]);
    const extras = blankIds.filter((id) => !placeholderIds.has(id));
    if (extras.length) {
      const extraList = h('div.item-blank-extra');
      for (const id of extras) {
        const row = h('div.item-field');
        row.appendChild(
          h('label.label', { htmlFor: `${groupName}-blank-${id}`, text: t('item.fill_blanks.blank_label', { number: id }) }),
        );
        row.appendChild(dragMode ? makeGapZone(id) : makeBlankInput(id));
        extraList.appendChild(row);
      }
      field.appendChild(extraList);
    }
    root.appendChild(field);

    // Drag mode: word box above the text
    if (dragMode) {
      const bank = Array.isArray(config.wordBank) ? config.wordBank.filter((w) => typeof w === 'string' && w.trim() !== '') : [];
      if (bank.length) {
        const shuffled = [...bank];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const wordBox = h('div.item-word-box', { role: 'group', 'aria-label': t('item.fill_blanks.wordbox') });
        for (const word of shuffled) wordBox.appendChild(makeWordChip(word));
        const legend = h('p.small.muted.mb-1', { text: t('item.fill_blanks.wordbox') });
        root.insertBefore(wordBox, field);
        root.insertBefore(legend, wordBox);
      }
    }
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
    if (dragMode) {
      for (const id of blankIds) clearGap(id);
      for (const [id, value] of Object.entries(blanks)) {
        if (value && blankZones.has(id)) {
          const word = String(value);
          const chip = [...chipByWord.entries()].find(([, w]) => w === word)?.[0];
          if (chip) assignWordToGap(chip, id);
        }
      }
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      const blanks = {};
      if (dragMode) {
        for (const id of blankIds) {
          const fill = gapFills.get(id);
          blanks[id] = fill && fill.dataset.word ? fill.dataset.word : '';
        }
      } else {
        for (const [id, inputs] of blankInputs) {
          const withValue = inputs.find((input) => input.value !== '') || inputs[0];
          blanks[id] = withValue ? withValue.value : '';
        }
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
