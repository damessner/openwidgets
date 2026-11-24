// Mark-sentence item: the sentence is shown as tappable word chips.
// mode "mark":    tap the words that should be marked (highlight).
// mode "correct": tap the wrong words (strike-through) and optionally type the
//                 correction in the small input that appears.
// Student payload (sanitized): words without target/fix flags.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  notice,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'mark_sentence';
export const label = { en: 'Mark / correct words in a sentence', de: 'Satz markieren / Wörter streichen' };

registerMessages({
  de: {
    'item.mark.legend_mark': 'Tippe alle Wörter an, die markiert werden sollen.',
    'item.mark.legend_correct': 'Streiche die falschen Wörter an und korrigiere sie.',
    'item.mark.empty': 'Für diese Aufgabe ist kein Satz hinterlegt.',
    'item.mark.word': 'Wort {n}',
    'item.mark.fix_label': 'Korrektur für „{word}“',
    'item.mark.fix_placeholder': 'Richtiges Wort …',
    'item.mark.selected': '{n} Wörter markiert',
  },
  en: {
    'item.mark.legend_mark': 'Tap all words that should be marked.',
    'item.mark.legend_correct': 'Strike the wrong words and correct them.',
    'item.mark.empty': 'No sentence is configured for this item.',
    'item.mark.word': 'Word {n}',
    'item.mark.fix_label': 'Correction for “{word}”',
    'item.mark.fix_placeholder': 'Correct word …',
    'item.mark.selected': '{n} words marked',
  },
});

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const mode = config.mode === 'correct' ? 'correct' : 'mark';
  const words = Array.isArray(config.words) ? config.words.filter((w) => w && typeof w === 'object') : [];

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  const selected = new Set();
  const fixes = {};

  if (words.length === 0) {
    root.appendChild(notice(t('item.mark.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() { return { selected: [], fixes: {} }; },
      setResponse() {},
      setResult() {},
      focus() { focusRoot(root); },
      destroy() { container.replaceChildren(); },
    };
  }

  const fs = h('fieldset.item-fieldset');
  fs.appendChild(h('legend.item-legend.sr-only', { text: mode === 'correct' ? t('item.mark.legend_correct') : t('item.mark.legend_mark') }));

  const sentence = h('div.item-mark-sentence');
  const wordButtons = [];
  const fixInputs = new Map();

  words.forEach((word, index) => {
    const text = String(word.text ?? '');
    const btn = h('button.item-mark-word', {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': `${text || t('item.mark.word', { n: index + 1 })}`,
    }, h('span', { text }));
    if (readonly) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (selected.has(index)) {
        selected.delete(index);
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('is-selected');
        const fixRow = fixInputs.get(index);
        if (fixRow) fixRow.remove();
        delete fixes[index];
      } else {
        selected.add(index);
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('is-selected');
        if (mode === 'correct') {
          const fixRow = h('span.item-mark-fix',
            h('input.input.input-sm.item-mark-fix-input', {
              type: 'text',
              placeholder: t('item.mark.fix_placeholder'),
              'aria-label': t('item.mark.fix_label', { word: text }),
              value: fixes[index] || '',
              on: {
                input: (event) => { fixes[index] = event.target.value; },
              },
            }),
          );
          if (readonly) fixRow.querySelector('input').disabled = true;
          fixInputs.set(index, fixRow);
          btn.after(fixRow);
        }
      }
      live.textContent = t('item.mark.selected', { n: selected.size });
    });
    wordButtons.push({ index, btn });
    sentence.appendChild(btn);
    if (index < words.length - 1) sentence.appendChild(document.createTextNode(' '));
  });

  fs.appendChild(sentence);
  root.appendChild(fs);

  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  root.appendChild(live);
  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    selected.clear();
    for (const key of Object.keys(fixes)) delete fixes[key];
    const resp = response && typeof response === 'object' ? response : {};
    const givenSelected = Array.isArray(resp.selected) ? resp.selected.map(Number) : [];
    const givenFixes = resp.fixes && typeof resp.fixes === 'object' ? resp.fixes : {};
    for (const { index, btn } of wordButtons) {
      const on = givenSelected.includes(index);
      if (on) selected.add(index);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-selected', on);
      // fix inputs are rebuilt lazily on click; in readonly mode restore them statically
      if (on && mode === 'correct') {
        const fixValue = typeof givenFixes[index] === 'string' ? givenFixes[index] : '';
        fixes[index] = fixValue;
        if (readonly && !fixInputs.get(index)) {
          const fixRow = h('span.item-mark-fix',
            h('input.input.input-sm.item-mark-fix-input', {
              type: 'text',
              value: fixValue,
              disabled: true,
              'aria-label': t('item.mark.fix_label', { word: String(words[index].text || '') }),
            }),
          );
          fixInputs.set(index, fixRow);
          btn.after(fixRow);
        }
      } else if (!on) {
        const fixRow = fixInputs.get(index);
        if (fixRow) fixRow.remove();
        fixInputs.delete(index);
      }
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { selected: [...selected].sort((a, b) => a - b), fixes: { ...fixes } };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, '.item-mark-word:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
