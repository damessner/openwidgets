// Item type: image_boxes — editable rectangles over a picture, each with one
// or more accepted words. inputMode "type": an input sits inside every box.
// inputMode "drag": word chips from the bank are dragged onto the boxes
// (click chip → click box works too, for touch/keyboard). Canonical response:
// { answers: { <boxId>: word } }. Box geometry is student-visible; the accepted
// words are not (they arrive only via the result/review payload).
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
  mediaUrl,
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'image_boxes';
export const label = { en: 'Label boxes on image', de: 'Kästchen im Bild' };

registerMessages({
  de: {
    'item.ib.legend': 'Beschriften Sie die Kästchen im Bild.',
    'item.ib.type_hint': 'Tippen Sie das passende Wort in jedes Kästchen.',
    'item.ib.drag_hint': 'Ziehen Sie jedes Wort aus der Wortbank auf das passende Kästchen (oder: Wort antippen, dann Kästchen antippen).',
    'item.ib.bank_label': 'Wortbank:',
    'item.ib.no_image': 'Für diese Aufgabe ist kein Bild hinterlegt.',
    'item.ib.no_boxes': 'Für diese Aufgabe sind keine Kästchen hinterlegt.',
    'item.ib.image_alt': 'Bild mit Kästchen',
    'item.ib.box_label': 'Kästchen {n}',
    'item.ib.box_input_label': 'Antwort für Kästchen {n}',
    'item.ib.empty_answer': '—',
    'item.ib.assign': '{word} auf Kästchen {n} legen',
    'item.ib.unassign': '{word} von Kästchen {n} zurücklegen',
  },
  en: {
    'item.ib.legend': 'Label the boxes in the image.',
    'item.ib.type_hint': 'Type the matching word into each box.',
    'item.ib.drag_hint': 'Drag each word from the word bank onto the matching box (or tap a word, then tap a box).',
    'item.ib.bank_label': 'Word bank:',
    'item.ib.no_image': 'No image is configured for this item.',
    'item.ib.no_boxes': 'No boxes are configured for this item.',
    'item.ib.image_alt': 'Image with boxes',
    'item.ib.box_label': 'Box {n}',
    'item.ib.box_input_label': 'Answer for box {n}',
    'item.ib.empty_answer': '—',
    'item.ib.assign': 'Move {word} to box {n}',
    'item.ib.unassign': 'Return {word} from box {n}',
  },
});

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const image = config.image && typeof config.image === 'object' ? config.image : {};
  const boxes = (Array.isArray(config.boxes) ? config.boxes : []).filter(
    (box) => box && typeof box === 'object' && box.id !== undefined && box.id !== null,
  );
  const inputMode = config.inputMode === 'drag' ? 'drag' : 'type';
  const wordBank = Array.isArray(config.wordBank) ? config.wordBank.filter((w) => typeof w === 'string' && w.trim()) : [];

  /** @type {Record<string, string>} boxId -> word */
  const answers = {};
  let selectedWord = null;
  let refreshBoxValues = () => {};
  let renderBank = () => {};
  const boxInputs = new Map(); // boxId -> input element (type mode)
  const boxEls = new Map(); // boxId -> box element

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!boxes.length) {
    root.appendChild(notice(t('item.ib.no_boxes'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse: () => ({ answers: {} }),
      setResponse() {},
      setResult() {},
      focus() { focusRoot(root); },
      destroy() { container.replaceChildren(); },
    };
  }

  const field = h('fieldset.item-field');
  field.appendChild(h('legend.sr-only', t('item.ib.legend')));

  const imageUrl = mediaUrl(image);
  if (!imageUrl) {
    field.appendChild(notice(t('item.ib.no_image'), 'warning'));
  } else {
    const stage = h('div.ib-stage');
    const img = h('img.ib-image', { src: imageUrl, alt: String(image.alt || t('item.ib.image_alt')), draggable: false });
    const layer = h('div.ib-layer');

    boxes.forEach((box, index) => {
      const boxId = String(box.id);
      const boxEl = h('div.ib-box', {
        dataset: { boxId },
        style: {
          left: `${(Number(box.x) || 0) * 100}%`,
          top: `${(Number(box.y) || 0) * 100}%`,
          width: `${(Number(box.w) || 0.2) * 100}%`,
          height: `${(Number(box.h) || 0.15) * 100}%`,
        },
      });
      boxEl.appendChild(h('span.ib-box-num', { 'aria-hidden': 'true', text: String(index + 1) }));
      if (inputMode === 'type' && !readonly) {
        const input = h('input.ib-box-input', {
          type: 'text',
          'aria-label': t('item.ib.box_input_label', { n: index + 1 }),
          autocomplete: 'off',
        });
        input.addEventListener('input', () => { answers[boxId] = input.value; });
        boxInputs.set(boxId, input);
        boxEl.appendChild(input);
      } else {
        const value = h('span.ib-box-value', { text: t('item.ib.empty_answer') });
        boxEl.appendChild(value);
      }
      if (inputMode === 'drag' && !readonly) {
        boxEl.classList.add('ib-droppable');
        boxEl.addEventListener('click', () => {
          if (selectedWord) assignWord(boxId, selectedWord);
        });
        boxEl.addEventListener('dragover', (event) => {
          event.preventDefault();
          boxEl.classList.add('ib-drag-over');
        });
        boxEl.addEventListener('dragleave', () => boxEl.classList.remove('ib-drag-over'));
        boxEl.addEventListener('drop', (event) => {
          event.preventDefault();
          boxEl.classList.remove('ib-drag-over');
          const word = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
          if (word) assignWord(boxId, word);
        });
      }
      boxEls.set(boxId, boxEl);
      layer.appendChild(boxEl);
    });

    stage.appendChild(img);
    stage.appendChild(layer);
    field.appendChild(stage);
    field.appendChild(h('p.item-help', t(inputMode === 'drag' ? 'item.ib.drag_hint' : 'item.ib.type_hint')));

    // --- drag mode: word bank ---------------------------------------------
    let bankHost = null;
    const chipEls = new Map(); // word -> chip element
    renderBank = function renderBank() {
      if (!bankHost) return;
      bankHost.replaceChildren();
      const remaining = wordBank.filter((word) => !Object.values(answers).includes(word));
      if (!remaining.length) {
        bankHost.appendChild(h('span.small.muted', '✓'));
        return;
      }
      for (const word of shuffled(remaining, ctx, 'ib-bank')) {
        const chip = h('button.ib-chip', {
          type: 'button',
          draggable: !readonly ? 'true' : 'false',
          dataset: { word },
          'aria-pressed': selectedWord === word ? 'true' : 'false',
          'aria-label': t('item.ib.assign', { word, n: '' }).trim(),
        }, word);
        chip.addEventListener('click', () => {
          selectedWord = selectedWord === word ? null : word;
          for (const [w, el] of chipEls) el.setAttribute('aria-pressed', w === selectedWord ? 'true' : 'false');
        });
        chip.addEventListener('dragstart', (event) => {
          if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', word);
            event.dataTransfer.effectAllowed = 'move';
          }
          selectedWord = word;
        });
        chipEls.set(word, chip);
        bankHost.appendChild(chip);
      }
    }
    function assignWord(boxId, word) {
      // a word can only sit in one box
      for (const [otherId, w] of Object.entries(answers)) {
        if (w === word && otherId !== boxId) delete answers[otherId];
      }
      answers[boxId] = word;
      selectedWord = null;
      refreshBoxValues();
      renderBank();
    }
    refreshBoxValues = function refreshBoxValues() {
      for (const [boxId, boxEl] of boxEls) {
        const valueEl = boxEl.querySelector('.ib-box-value');
        const word = answers[boxId] || '';
        if (valueEl) valueEl.textContent = word || t('item.ib.empty_answer');
        if (inputMode === 'drag') {
          boxEl.classList.toggle('ib-filled', !!word);
          boxEl.setAttribute('aria-label', `${t('item.ib.box_label', { n: boxId })}: ${word || '—'}`);
        }
      }
    }

    if (inputMode === 'drag') {
      bankHost = h('div.ib-bank', h('span.ib-bank-label', t('item.ib.bank_label')));
      field.appendChild(bankHost);
      if (!readonly) renderBank();
    }

    // reviewZones: solution rectangles (only sent when showAnswers is on)
    if (Array.isArray(ctx.reviewZones) && ctx.reviewZones.length) {
      const solLayer = h('div.ib-layer.ib-solution-layer');
      ctx.reviewZones.forEach((zone, index) => {
        const sol = h('div.ib-solution-box', {
          style: {
            left: `${(Number(zone.x) || 0) * 100}%`,
            top: `${(Number(zone.y) || 0) * 100}%`,
            width: `${(Number(zone.w) || 0.2) * 100}%`,
            height: `${(Number(zone.h) || 0.15) * 100}%`,
          },
        }, `${index + 1}${zone.label ? ` · ${zone.label}` : ''}${Array.isArray(zone.accepted) && zone.accepted.length ? ` (${zone.accepted.join('/')})` : ''}`);
        solLayer.appendChild(sol);
      });
      stage.appendChild(solLayer);
    }
  }

  root.appendChild(field);
  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const given = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
    for (const box of boxes) {
      const boxId = String(box.id);
      const value = typeof given[boxId] === 'string' ? given[boxId] : '';
      answers[boxId] = value;
      const input = boxInputs.get(boxId);
      if (input) input.value = value;
    }
    if (inputMode === 'drag' && typeof refreshBoxValues === 'function') {
      refreshBoxValues();
      renderBank();
    }
  }
  setResponse(ctx.response);

  container.replaceChildren(root);

  return {
    getResponse() {
      const out = {};
      if (inputMode === 'type') {
        for (const [boxId, input] of boxInputs) out[boxId] = input.value;
      } else {
        for (const box of boxes) out[String(box.id)] = answers[String(box.id)] || '';
      }
      return { answers: out };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
      const detail = result && result.detail && typeof result.detail === 'object' ? result.detail : {};
      const perBox = detail.boxes && typeof detail.boxes === 'object' ? detail.boxes : {};
      for (const [boxId, boxEl] of boxEls) {
        const entry = perBox[boxId];
        boxEl.classList.remove('is-correct', 'is-incorrect');
        if (entry && entry.correct) boxEl.classList.add('is-correct');
        else if (entry && entry.given) boxEl.classList.add('is-incorrect');
      }
    },
    focus() {
      if (inputMode === 'type' && boxInputs.size) {
        const first = boxInputs.values().next().value;
        if (first) { first.focus(); return; }
      }
      if (!focusFirst(root, '.ib-box, .ib-chip')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
