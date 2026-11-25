// Hangman (Galgenmännchen) renderer. The word never reaches the student (the
// sanitized config has only hint + lengths); correctly guessed letters are
// revealed from the server-computed result detail (instant feedback) and the
// final reveal happens after submit / in review.
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
  liveRegion,
  announce,
} from './_shared.js';

export const type = 'hangman';
export const label = { en: 'Hangman', de: 'Galgenmännchen' };

registerMessages({
  de: {
    'item.hangman.legend': 'Errate das Wort Buchstabe für Buchstabe.',
    'item.hangman.wrong': 'Fehlversuche: {n} / {max}',
    'item.hangman.won': 'Gewonnen! Das Wort ist erraten.',
    'item.hangman.lost': 'Verloren — das Wort wurde nicht erraten.',
    'item.hangman.used': 'schon getippt',
    'item.hangman.hint': 'Hinweis',
  },
  en: {
    'item.hangman.legend': 'Guess the word letter by letter.',
    'item.hangman.wrong': 'Wrong guesses: {n} / {max}',
    'item.hangman.won': 'Won! The word was guessed.',
    'item.hangman.lost': 'Lost — the word was not guessed.',
    'item.hangman.used': 'already used',
    'item.hangman.hint': 'Hint',
  },
});

const ALPHABET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ü'];

// 6 body parts drawn progressively: head, body, left arm, right arm, left leg, right leg
const PARTS = [
  '<circle cx="70" cy="32" r="7"/>',
  '<path d="M70 39 V70"/>',
  '<path d="M70 48 L58 58"/>',
  '<path d="M70 48 L82 58"/>',
  '<path d="M70 70 L60 90"/>',
  '<path d="M70 70 L80 90"/>',
];

function galgenSvg(stage) {
  const parts = PARTS.slice(0, Math.max(0, Math.min(6, stage)))
    .map((p) => p)
    .join('');
  return (
    '<svg class="item-hangman-svg" viewBox="0 0 100 120" role="img" aria-hidden="true" focusable="false">' +
    '<g stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round">' +
    '<path d="M10 110 H50"/><path d="M30 110 V10"/><path d="M30 10 H70"/><path d="M70 10 V25"/>' +
    parts +
    '</g></svg>'
  );
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const wordLength = Number(config.wordLength) || 0;
  const maxAttempts = Number(config.maxAttempts) || 8;

  const guessed = new Set();
  let revealed = new Set(); // letters of the word that were guessed correctly
  let wrongLetters = [];
  let won = false;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  if (config.hint) {
    root.appendChild(h('p.item-hangman-hint', h('strong', `${t('item.hangman.hint')}: `), config.hint));
  }
  root.appendChild(h('p.small.muted', t('item.hangman.legend')));

  const body = h('div.item-hangman-body');
  const svgHost = h('div.item-hangman-galgen');
  const right = h('div.item-hangman-right');
  const wordRow = h('div.item-hangman-word', { 'aria-label': 'Wort' });
  const statusLine = h('p.item-hangman-status.small');
  const banner = h('div.item-hangman-banner', { hidden: true, role: 'status' });
  const keys = h('div.item-hangman-keys', { role: 'group', 'aria-label': 'Buchstaben' });
  right.append(wordRow, statusLine, banner, keys);
  body.append(svgHost, right);
  root.appendChild(body);

  const live = liveRegion();
  const resultRegion = createResultRegion();
  root.appendChild(live);
  root.appendChild(resultRegion);

  const letterButtons = new Map();
  for (const ch of ALPHABET) {
    const btn = h('button.item-hangman-key', {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': ch,
      disabled: readonly || undefined,
    }, ch);
    btn.addEventListener('click', () => {
      if (readonly || guessed.has(ch) || gameOver()) return;
      guessed.add(ch);
      sync();
    });
    letterButtons.set(ch, btn);
    keys.appendChild(btn);
  }

  function gameOver() {
    return won || wrongLetters.length >= maxAttempts;
  }

  function renderWord() {
    clear(wordRow);
    for (let i = 0; i < wordLength; i += 1) {
      const slot = h('span.item-hangman-slot', { text: ' ' });
      wordRow.appendChild(slot);
    }
    // reveal positions: we only know WHICH letters are in the word, not where.
    // Show revealed letters as a sorted strip under the blanks instead.
    const strip = h('div.item-hangman-revealed', {
      text: [...revealed].sort().join(' '),
    });
    wordRow.title = [...revealed].sort().join(' ');
    if (revealed.size > 0) wordRow.appendChild(strip);
  }

  function sync() {
    const wrong = wrongLetters.length;
    const stage = Math.round((wrong / maxAttempts) * 6);
    svgHost.innerHTML = galgenSvg(stage);
    for (const [ch, btn] of letterButtons) {
      const used = guessed.has(ch);
      btn.disabled = readonly || used || gameOver();
      btn.setAttribute('aria-pressed', used ? 'true' : 'false');
      btn.classList.toggle('is-hit', used && revealed.has(ch));
      btn.classList.toggle('is-miss', used && !revealed.has(ch));
    }
    statusLine.textContent = t('item.hangman.wrong', { n: String(wrong), max: String(maxAttempts) });
    banner.hidden = !gameOver();
    if (gameOver()) {
      banner.textContent = won ? t('item.hangman.won') : t('item.hangman.lost');
      banner.classList.toggle('is-won', won);
      banner.classList.toggle('is-lost', !won);
    }
    renderWord();
    announce(live, `${statusLine.textContent} ${[...revealed].sort().join(' ')}`);
  }

  function setResponse(response) {
    guessed.clear();
    const given = response && Array.isArray(response.letters) ? response.letters : [];
    for (const value of given) {
      const ch = String(value).toUpperCase().slice(0, 1);
      if (ALPHABET.includes(ch)) guessed.add(ch);
    }
    sync();
  }

  function setResult(result) {
    applyResult(root, resultRegion, result);
    const detail = result && result.detail && typeof result.detail === 'object' ? result.detail : {};
    revealed = new Set(Array.isArray(detail.revealed) ? detail.revealed : []);
    wrongLetters = Array.isArray(detail.wrong) ? detail.wrong : [...guessed].filter((ch) => !revealed.has(ch));
    won = detail.won === true || result.correct === true;
    sync();
  }

  setResponse(ctx.response);
  if (ctx.result) setResult(ctx.result);
  else sync();
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { letters: [...guessed] };
    },
    setResponse,
    setResult,
    focus() {
      if (!focusFirst(root, 'button.item-hangman-key:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
