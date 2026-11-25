// Matching item: two columns — left entries (words) and right entries
// (pictures / audio / words), each shown once. The pupil taps one card on
// either side, then taps the matching card on the other side; a line is
// drawn between them (SVG overlay). Tapping a connected card again removes
// the connection.
//
// Two config shapes must be supported:
//  - raw item (preview/review in the teacher app):
//      { pairs: [{id, left, right}], shuffle }
//    right-hand options are derived and shuffled here (deterministic seed).
//  - sanitized student item:
//      { shuffle, lefts: [{id, text}], rights: [{id, text}] }
//    `rights` are already deterministically shuffled server-side and their ids
//    ARE the pair ids, so they are rendered as-is.
// Canonical response: { matches: { <leftPairId>: <rightPairId> } }.
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
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'match';
export const label = { en: 'Matching', de: 'Zuordnen' };

registerMessages({
  de: {
    'item.match.legend': 'Verbinden Sie jedes Wort mit dem passenden Bild — tippen Sie zuerst ein Kärtchen an, dann das passende auf der anderen Seite.',
    'item.match.select_label': 'Zuordnung für: {left}',
    'item.match.empty': 'Für diese Aufgabe sind keine Zuordnungen hinterlegt.',
    'item.match.image_option': 'Bild',
    'item.match.audio_option': 'Audio',
    'item.match.connect_hint': 'Zuerst ein Kärtchen antippen, dann das passende auf der anderen Seite.',
  },
  en: {
    'item.match.legend': 'Connect each word with the matching picture — tap one card, then the matching one on the other side.',
    'item.match.select_label': 'Match for: {left}',
    'item.match.empty': 'No matching pairs are configured for this item.',
    'item.match.image_option': 'Image',
    'item.match.audio_option': 'Audio',
    'item.match.connect_hint': 'Tap a card first, then the matching one on the other side.',
  },
});

let instanceCounter = 0;

// A side is { kind: 'text', text } | { kind: 'image', assetId?, url?, alt } |
// { kind: 'audio', assetId?, url? }. Legacy plain strings are text.
function asSide(raw, fallback = '') {
  if (typeof raw === 'string') return { kind: 'text', text: raw };
  if (!raw || typeof raw !== 'object') return { kind: 'text', text: fallback };
  const kind = raw.kind === 'image' || raw.kind === 'audio' ? raw.kind : 'text';
  if (kind === 'text') return { kind, text: String(raw.text ?? fallback) };
  return { kind, assetId: raw.assetId, url: raw.url, alt: raw.alt };
}

function sideUrl(side) {
  if (typeof side.url === 'string' && side.url) return side.url;
  if (side.assetId) return `/assets/${encodeURIComponent(String(side.assetId))}/${encodeURIComponent(String(side.assetId))}`;
  return null;
}

function sideLabel(side, index) {
  if (!side) return '';
  if (side.kind === 'image') return side.alt || `${t('item.match.image_option')} ${index + 1}`;
  if (side.kind === 'audio') return `${t('item.match.audio_option')} ${index + 1}`;
  return side.text || '';
}

function sideBlock(side, index) {
  if (!side) return null;
  if (side.kind === 'image') {
    const url = sideUrl(side);
    if (!url) return null;
    return h('img.item-match-img', { src: url, alt: String(side.alt || sideLabel(side, index)), loading: 'lazy' });
  }
  if (side.kind === 'audio') {
    const url = sideUrl(side);
    if (!url) return null;
    return h('audio.item-match-audio', { controls: true, preload: 'metadata', src: url });
  }
  return h('span.item-match-text', { text: side.text || '' });
}

function asEntryList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => entry && typeof entry === 'object' && entry.id !== undefined && entry.id !== null)
    .map((entry) => ({ id: entry.id, side: asSide(entry) }));
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const groupName = `ow-match-${++instanceCounter}`;

  // Resolve the two supported shapes.
  let lefts = [];
  let rights = [];
  if (Array.isArray(config.lefts) || Array.isArray(config.rights)) {
    lefts = asEntryList(config.lefts);
    rights = asEntryList(config.rights);
  } else if (Array.isArray(config.pairs)) {
    const pairs = config.pairs.filter(
      (pair) => pair && typeof pair === 'object' && pair.id !== undefined && pair.id !== null,
    );
    lefts = pairs.map((pair) => ({ id: pair.id, side: asSide(pair.left) }));
    const rightEntries = pairs.map((pair) => ({ id: pair.id, side: asSide(pair.right) }));
    rights = config.shuffle === false ? rightEntries : shuffled(rightEntries, ctx, 'match-rights');
  }

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!lefts.length) {
    root.appendChild(notice(t('item.match.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() {
        return { matches: {} };
      },
      setResponse() {
        /* nothing to set */
      },
      setResult() {
        /* nothing to mark */
      },
      focus() {
        focusRoot(root);
      },
      destroy() {
        container.replaceChildren();
      },
    };
  }

  const field = fieldset(t('item.match.legend'));
  if (!readonly) field.appendChild(h('p.help.item-match-hint', { text: t('item.match.connect_hint') }));

  // ---- board: SVG line overlay + two columns of cards ---------------------
  const board = h('div.item-match-board');
  const svg = h('svg.item-match-lines', { 'aria-hidden': 'true', focusable: 'false' });
  const cols = h('div.item-match-cols');
  const leftCol = h('div.item-match-col.item-match-col-left', { role: 'group', 'aria-label': t('item.match.legend') });
  const rightCol = h('div.item-match-col.item-match-col-right');
  cols.append(leftCol, rightCol);
  board.append(svg, cols);

  /** leftId -> rightId */
  const selected = new Map();
  /** pending card: { side: 'left'|'right', id: string } | null */
  let pending = null;
  let lastResult = null;

  const leftCards = new Map(); // leftId -> element
  const rightCards = new Map(); // rightId -> element

  function cardContent(entry, index) {
    const media = sideBlock(entry.side, index);
    // pictures/audio stand alone; text cards show their text
    if (media) return media;
    return h('span.item-match-text', { text: sideLabel(entry.side, index) || `#${index + 1}` });
  }

  function makeCard(side, entry, index) {
    const id = String(entry.id);
    const btn = h('button.item-match-card', {
      type: 'button',
      'data-side': side,
      'data-id': id,
      'aria-pressed': 'false',
      'aria-label': sideLabel(entry.side, index) || `#${index + 1}`,
      disabled: readonly || undefined,
    });
    btn.appendChild(cardContent(entry, index));
    btn.addEventListener('click', () => onCardClick(side, id));
    return btn;
  }

  function onCardClick(side, id) {
    if (readonly) return;
    if (!pending) {
      pending = { side, id };
    } else if (pending.side === side && pending.id === id) {
      pending = null; // tap again to deselect
    } else if (pending.side === side) {
      pending = { side, id }; // move selection within the same column
    } else {
      // opposite sides: connect them
      const leftId = side === 'left' ? id : pending.id;
      const rightId = side === 'right' ? id : pending.id;
      // a right card can only be connected to one left card
      for (const [l, r] of selected) {
        if (r === rightId && l !== leftId) selected.delete(l);
      }
      selected.set(leftId, rightId);
      pending = null;
    }
    updateCardStates();
    drawLines();
  }

  function updateCardStates() {
    for (const [id, el] of leftCards) {
      const matched = selected.has(id);
      const isPending = pending && pending.side === 'left' && pending.id === id;
      el.classList.toggle('is-matched', matched);
      el.classList.toggle('is-selected', !!isPending);
      el.setAttribute('aria-pressed', matched || isPending ? 'true' : 'false');
    }
    for (const [id, el] of rightCards) {
      const matched = [...selected.values()].includes(id);
      const isPending = pending && pending.side === 'right' && pending.id === id;
      el.classList.toggle('is-matched', matched);
      el.classList.toggle('is-selected', !!isPending);
      el.setAttribute('aria-pressed', matched || isPending ? 'true' : 'false');
    }
  }

  function drawLines() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const boardRect = board.getBoundingClientRect();
    if (!boardRect.width) return;
    svg.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    const hits = lastResult && Array.isArray(lastResult.detail && lastResult.detail.hits) ? lastResult.detail.hits : null;
    for (const [leftId, rightId] of selected) {
      const leftEl = leftCards.get(leftId);
      const rightEl = rightCards.get(rightId);
      if (!leftEl || !rightEl) continue;
      const a = leftEl.getBoundingClientRect();
      const b = rightEl.getBoundingClientRect();
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.right - boardRect.left));
      line.setAttribute('y1', String(a.top + a.height / 2 - boardRect.top));
      line.setAttribute('x2', String(b.left - boardRect.left));
      line.setAttribute('y2', String(b.top + b.height / 2 - boardRect.top));
      line.setAttribute('class', 'item-match-line');
      if (hits) line.classList.add(hits.includes(leftId) ? 'is-correct' : 'is-incorrect');
      svg.appendChild(line);
    }
  }

  lefts.forEach((entry, index) => {
    const card = makeCard('left', entry, index);
    leftCards.set(String(entry.id), card);
    leftCol.appendChild(card);
  });
  rights.forEach((entry, index) => {
    const card = makeCard('right', entry, index);
    rightCards.set(String(entry.id), card);
    rightCol.appendChild(card);
  });

  // keep lines attached when layout changes (images loading, resize, font scale)
  const onResize = () => drawLines();
  window.addEventListener('resize', onResize);
  board.addEventListener('load', onResize, true); // capture: img/audio loads

  field.appendChild(board);
  root.appendChild(field);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const matches =
      response && response.matches && typeof response.matches === 'object' ? response.matches : {};
    selected.clear();
    pending = null;
    for (const { id } of lefts) {
      const value = matches[id] === undefined || matches[id] === null ? '' : String(matches[id]);
      if (value && rightCards.has(value)) selected.set(String(id), value);
    }
    updateCardStates();
    drawLines();
  }

  setResponse(ctx.response);
  container.replaceChildren(root);
  // initial draw after layout settles
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(drawLines);
  else drawLines();

  return {
    getResponse() {
      const matches = {};
      for (const [leftId, rightId] of selected) matches[leftId] = rightId;
      return { matches };
    },
    setResponse,
    setResult(result) {
      lastResult = result || null;
      applyResult(root, resultRegion, result);
      drawLines();
    },
    focus() {
      if (!focusFirst(root, 'button.item-match-card:enabled')) focusRoot(root);
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      container.replaceChildren();
    },
  };
}
