// Vocabulary trainer renderer: flashcards (self-rated, unknown cards repeat
// once at the end) or typed modes (translate / listen / example). The student
// payload is already sanitized per mode — the answer side is not present here.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  notice,
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
  liveRegion,
  announce,
} from './_shared.js';

export const type = 'vocabulary';
export const label = { en: 'Vocabulary trainer', de: 'Vokabeln' };

registerMessages({
  de: {
    'item.vocab.legend': 'Vokabeln',
    'item.vocab.flip': 'Umdrehen',
    'item.vocab.known': 'Gewusst',
    'item.vocab.unknown': 'Nicht gewusst',
    'item.vocab.next': 'Weiter',
    'item.vocab.progress': 'Karte {n} von {total}',
    'item.vocab.done': 'Fertig — {known} von {total} gewusst',
    'item.vocab.play': 'Abspielen',
    'item.vocab.answer_ph': 'Deine Antwort …',
    'item.vocab.example_prompt': 'Ergänze das fehlende Wort:',
    'item.vocab.no_audio': 'Kein Audio hinterlegt.',
    'item.vocab.review_rating_known': 'gewusst',
    'item.vocab.review_rating_unknown': 'nicht gewusst',
    'item.vocab.review_rating_none': 'nicht bewertet',
  },
  en: {
    'item.vocab.legend': 'Vocabulary',
    'item.vocab.flip': 'Flip',
    'item.vocab.known': 'Known',
    'item.vocab.unknown': 'Not known',
    'item.vocab.next': 'Next',
    'item.vocab.progress': 'Card {n} of {total}',
    'item.vocab.done': 'Done — {known} of {total} known',
    'item.vocab.play': 'Play',
    'item.vocab.answer_ph': 'Your answer …',
    'item.vocab.example_prompt': 'Fill in the missing word:',
    'item.vocab.no_audio': 'No audio available.',
    'item.vocab.review_rating_known': 'known',
    'item.vocab.review_rating_unknown': 'not known',
    'item.vocab.review_rating_none': 'not rated',
  },
});

function assetUrlOf(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return `/assets/${encodeURIComponent(ref)}/${encodeURIComponent(ref)}`;
  if (typeof ref.url === 'string' && ref.url) return ref.url;
  if (ref.assetId) {
    const id = encodeURIComponent(String(ref.assetId));
    return `/assets/${id}/${id}`;
  }
  return null;
}

function entriesOf(config) {
  return Array.isArray(config.entries) ? config.entries.filter((e) => e && typeof e === 'object' && e.id != null) : [];
}

function entryDirection(config, index) {
  if (config.direction !== 'both') return config.direction;
  return index % 2 === 0 ? 'term_to_translation' : 'translation_to_term';
}

function promptTextOf(config, entry, index) {
  const dir = entryDirection(config, index);
  if (config.mode === 'example') return entry.example || '';
  if (dir === 'translation_to_term') return entry.translation || '';
  return entry.term || '';
}

function answerTextOf(entry) {
  return entry.translation || entry.term || '';
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const mode = config.mode === 'flashcards' ? 'flashcards' : 'typed';
  const entries = entriesOf(config);
  const order = config.shuffle === false ? entries.map((e, i) => i) : shuffled(entries.map((e, i) => i), ctx, 'vocab');

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  if (entries.length === 0) root.appendChild(notice(t('item.vocab.legend'), 'warning'));

  const live = liveRegion();
  const resultRegion = createResultRegion();

  // ---------------------------------------------------------------------
  // Flashcards mode
  // ---------------------------------------------------------------------
  if (mode === 'flashcards') {
    const ratings = {}; // entryId -> 'known' | 'unknown'
    const queue = [...order];
    const repeated = new Set();
    let cursor = 0;
    let flipped = false;

    const stage = h('div.item-vocab-flashcards');
    const progress = h('p.item-vocab-progress.small.muted');
    const card = h('div.item-vocab-card', { role: 'group' });
    const cardSide = h('div.item-vocab-card-side');
    const cardMedia = h('div.item-vocab-card-media');
    const flipBtn = h('button.btn.btn-secondary', { type: 'button' }, t('item.vocab.flip'));
    const knownBtn = h('button.btn.btn-success', { type: 'button' }, t('item.vocab.known'));
    const unknownBtn = h('button.btn.btn-danger', { type: 'button' }, t('item.vocab.unknown'));
    const ratingRow = h('div.row.gap-2.mt-2', { hidden: true }, knownBtn, unknownBtn);
    const doneBox = h('div.item-vocab-done', { hidden: true });
    stage.append(card, h('div.row.gap-2.mt-2', flipBtn), ratingRow, progress, doneBox);
    root.appendChild(stage);

    function currentEntry() {
      const idx = queue[cursor];
      return idx === undefined ? null : entries[idx];
    }

    function renderCard() {
      const entry = currentEntry();
      clear(card);
      cardMedia.replaceChildren();
      if (!entry) {
        const known = Object.values(ratings).filter((v) => v === 'known').length;
        stage.classList.add('is-done');
        doneBox.hidden = false;
        doneBox.textContent = t('item.vocab.done', { known: String(known), total: String(entries.length) });
        progress.textContent = '';
        flipBtn.hidden = true;
        ratingRow.hidden = true;
        return;
      }
      const dir = entryDirection(config, cursor);
      const showAnswer = flipped;
      const text = showAnswer ? answerTextOf(entry) : promptTextOf(config, entry, cursor);
      cardSide.textContent = text || '—';
      cardSide.classList.toggle('is-answer', showAnswer);
      card.append(cardMedia, cardSide);
      const imgUrl = assetUrlOf(entry.imageAssetId);
      if (imgUrl) cardMedia.appendChild(h('img.item-vocab-img', { src: imgUrl, alt: '' }));
      const audioUrl = assetUrlOf(entry.audioAssetId);
      if (audioUrl && !showAnswer) {
        cardMedia.appendChild(h('audio.item-vocab-audio', { controls: true, preload: 'metadata', src: audioUrl }));
      }
      progress.textContent = t('item.vocab.progress', { n: String(cursor + 1), total: String(queue.length) });
      flipBtn.hidden = readonly || flipped;
      ratingRow.hidden = readonly || !flipped;
      announce(live, `${progress.textContent} ${text}`);
    }

    function advance(rating) {
      const entry = currentEntry();
      if (entry && rating) {
        ratings[entry.id] = rating;
        if (rating === 'unknown' && !repeated.has(entry.id) && cursor === queue.length - 1) {
          repeated.add(entry.id);
          queue.push(queue[cursor]); // re-queue once at the end
        }
      }
      flipped = false;
      cursor += 1;
      renderCard();
    }

    flipBtn.addEventListener('click', () => {
      flipped = true;
      renderCard();
    });
    knownBtn.addEventListener('click', () => advance('known'));
    unknownBtn.addEventListener('click', () => advance('unknown'));

    function setResponse(response) {
      const given = response && response.ratings && typeof response.ratings === 'object' ? response.ratings : {};
      for (const key of Object.keys(ratings)) delete ratings[key];
      for (const entry of entries) {
        if (given[entry.id] === 'known' || given[entry.id] === 'unknown') ratings[entry.id] = given[entry.id];
      }
      cursor = 0;
      flipped = false;
      if (readonly) {
        // review: list all cards with their rating
        clear(stage);
        const list = h('div.item-vocab-review-list');
        for (const index of order) {
          const entry = entries[index];
          const rating = ratings[entry.id];
          list.appendChild(
            h(
              'div.item-vocab-review-row',
              h('span.item-vocab-review-term', { text: entry.term || '—' }),
              h('span.muted', { text: '→' }),
              h('span.item-vocab-review-translation', { text: entry.translation || '—' }),
              h(
                'span.badge',
                { class: rating === 'known' ? 'badge-success' : rating === 'unknown' ? 'badge-danger' : 'badge-info' },
                t(
                  rating === 'known'
                    ? 'item.vocab.review_rating_known'
                    : rating === 'unknown'
                      ? 'item.vocab.review_rating_unknown'
                      : 'item.vocab.review_rating_none',
                ),
              ),
            ),
          );
        }
        stage.appendChild(list);
      } else {
        renderCard();
      }
    }

    setResponse(ctx.response);
    root.appendChild(live);
    root.appendChild(resultRegion);
    if (ctx.result) applyResult(root, resultRegion, ctx.result);
    const keyBlock = solutionBlock(item, ctx);
    if (keyBlock) root.appendChild(keyBlock);
    container.replaceChildren(root);

    return {
      getResponse() {
        return { ratings: { ...ratings } };
      },
      setResponse,
      setResult(result) {
        applyResult(root, resultRegion, result);
      },
      focus() {
        focusFirst(root, 'button:enabled, input:enabled') || focusRoot(root);
      },
      destroy() {
        container.replaceChildren();
      },
    };
  }

  // ---------------------------------------------------------------------
  // Typed modes (translate / listen / example)
  // ---------------------------------------------------------------------
  const answers = {}; // entryId -> string
  const rows = new Map(); // entryId -> { row, input, mark }
  const list = h('div.item-vocab-list');
  root.appendChild(list);

  order.forEach((entryIndex) => {
    const entry = entries[entryIndex];
    const row = h('div.item-vocab-row', { dataset: { entryId: String(entry.id) } });
    const promptBox = h('div.item-vocab-prompt');
    if (config.mode === 'listen') {
      const audioUrl = assetUrlOf(entry.audioAssetId);
      if (audioUrl) {
        promptBox.appendChild(h('audio.item-vocab-audio', { controls: true, preload: 'metadata', src: audioUrl, 'aria-label': t('item.vocab.play') }));
      } else {
        promptBox.appendChild(h('p.small.muted', { text: t('item.vocab.no_audio') }));
      }
    } else {
      if (config.mode === 'example') promptBox.appendChild(h('p.small.muted.mb-1', { text: t('item.vocab.example_prompt') }));
      const imgUrl = assetUrlOf(entry.imageAssetId);
      if (imgUrl) promptBox.appendChild(h('img.item-vocab-img', { src: imgUrl, alt: '' }));
      promptBox.appendChild(h('div.item-vocab-prompt-text', { text: promptTextOf(config, entry, entryIndex) || '—' }));
      if (config.mode === 'translate' && entry.audioAssetId) {
        const audioUrl = assetUrlOf(entry.audioAssetId);
        if (audioUrl) promptBox.appendChild(h('audio.item-vocab-audio', { controls: true, preload: 'metadata', src: audioUrl }));
      }
    }
    const input = h('input.input.item-vocab-input', {
      type: 'text',
      placeholder: t('item.vocab.answer_ph'),
      'aria-label': `${t('item.vocab.legend')} ${entryIndex + 1}`,
      autocomplete: 'off',
      disabled: readonly || undefined,
    });
    input.addEventListener('input', () => {
      answers[entry.id] = input.value;
    });
    const mark = h('span.item-vocab-mark', { 'aria-hidden': 'true' });
    row.append(promptBox, h('div.row.gap-2.align-center', input, mark));
    list.appendChild(row);
    rows.set(entry.id, { row, input, mark });
  });

  function setResponse(response) {
    const given = response && response.answers && typeof response.answers === 'object' ? response.answers : {};
    for (const key of Object.keys(answers)) delete answers[key];
    for (const entry of entries) {
      const value = typeof given[entry.id] === 'string' ? given[entry.id] : '';
      answers[entry.id] = value;
      const slot = rows.get(entry.id);
      if (slot) slot.input.value = value;
    }
  }

  function setResult(result) {
    applyResult(root, resultRegion, result);
    const detail = result && result.detail && typeof result.detail === 'object' ? result.detail : {};
    const perEntry = detail.answers && typeof detail.answers === 'object' ? detail.answers : {};
    for (const entry of entries) {
      const slot = rows.get(entry.id);
      if (!slot) continue;
      const info = perEntry[entry.id];
      slot.row.classList.toggle('is-correct', !!(info && info.correct));
      slot.row.classList.toggle('is-incorrect', !!(info && info.correct === false));
      slot.mark.textContent = info ? (info.correct ? '✓' : '✕') : '';
      slot.mark.classList.toggle('text-success', !!(info && info.correct));
      slot.mark.classList.toggle('text-danger', !!(info && info.correct === false));
    }
  }

  setResponse(ctx.response);
  root.appendChild(live);
  root.appendChild(resultRegion);
  if (ctx.result) setResult(ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { answers: { ...answers } };
    },
    setResponse,
    setResult,
    focus() {
      if (!focusFirst(root, 'input:enabled, button:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
