// Writing task item: textarea with word count + AI feedback loop.
// ctx.requestFeedback(text) (provided by the student player) calls
// POST /api/llm/writing-feedback and resolves with the sanitized feedback
// { summary, criteria: [{id,label,met,comment,tip}], loop }. In review mode
// ctx.writingFeedback shows the stored final feedback.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear, renderRichText } from '../lib/dom.js';
import { findUsedWords } from '/shared/items/writing.js';
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

export const type = 'writing';
export const label = { en: 'Writing task (AI feedback)', de: 'Schreibaufgabe (KI-Feedback)' };

registerMessages({
  de: {
    'item.writing.legend': 'Schreibe deinen Text.',
    'item.writing.source': 'Quellmaterial',
    'item.writing.words': '{count} Wörter',
    'item.writing.min_words': 'mind. {n} Wörter',
    'item.writing.feedback_button': 'Zwischenfeedback holen (KI)',
    'item.writing.feedback_loading': 'KI erstellt Feedback …',
    'item.writing.feedback_title': 'Feedback (Zwischenstand {loop})',
    'item.writing.feedback_summary': 'Zusammenfassung',
    'item.writing.criteria_met': 'erfüllt',
    'item.writing.criteria_partly': 'teilweise',
    'item.writing.criteria_open': 'offen',
    'item.writing.tip': 'Tipp',
    'item.writing.no_feedback_yet': 'Noch kein Feedback — hol dir eines, bevor du abgibst.',
    'item.writing.feedback_error': 'Das Feedback konnte nicht geladen werden. Versuch es erneut.',
    'item.writing.loops_disabled': 'Zwischenfeedback ist für diese Aufgabe deaktiviert.',
    'item.writing.final_feedback_title': 'Abschlussfeedback',
    'item.writing.locked': 'Diese Aufgabe ist bereits abgegeben.',
    'item.writing.wordbox': 'Wortbox — verwende diese Wörter in deinem Text:',
    'item.writing.wordbox_used': '{used} von {total} verwendet',
    'item.writing.hints_title': 'So gehst du vor — Schritt für Schritt',
    'item.writing.hints_step': 'Schritt {current} von {total}',
    'item.writing.hints_next': 'Weiter',
    'item.writing.hints_start': 'Los geht’s — Text schreiben',
    'item.writing.wordbox_feedback': 'Wortbox: verwendet: {used} · fehlt noch: {missing}',
  },
  en: {
    'item.writing.legend': 'Write your text.',
    'item.writing.source': 'Source material',
    'item.writing.words': '{count} words',
    'item.writing.min_words': 'min. {n} words',
    'item.writing.feedback_button': 'Get interim feedback (AI)',
    'item.writing.feedback_loading': 'AI is creating feedback …',
    'item.writing.feedback_title': 'Feedback (draft {loop})',
    'item.writing.feedback_summary': 'Summary',
    'item.writing.criteria_met': 'met',
    'item.writing.criteria_partly': 'partly',
    'item.writing.criteria_open': 'open',
    'item.writing.tip': 'Tip',
    'item.writing.no_feedback_yet': 'No feedback yet — get some before submitting.',
    'item.writing.feedback_error': 'The feedback could not be loaded. Try again.',
    'item.writing.loops_disabled': 'Interim feedback is disabled for this task.',
    'item.writing.final_feedback_title': 'Final feedback',
    'item.writing.locked': 'This task has already been submitted.',
    'item.writing.wordbox': 'Word box — use these words in your text:',
    'item.writing.wordbox_used': '{used} of {total} used',
    'item.writing.hints_title': 'How to approach this — step by step',
    'item.writing.hints_step': 'Step {current} of {total}',
    'item.writing.hints_next': 'Next',
    'item.writing.hints_start': 'Let’s go — start writing',
    'item.writing.wordbox_feedback': 'Word box: used: {used} · still missing: {missing}',
  },
});

function wordCount(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Highlight every occurrence of `used` words inside the escaped text HTML. */
function highlightUsedWords(escapedText, usedWords) {
  let out = escapedText;
  for (const word of usedWords) {
    const escaped = escapeHtml(word);
    if (!escaped) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^\\p{L}\\p{N}]|$)`, 'giu');
    out = out.replace(pattern, (match, prefix) => `${prefix}<mark class="writing-mark">${match.slice(prefix.length)}</mark>`);
  }
  return `${out}\n`;
}

function metLabel(met) {
  if (met >= 0.85) return t('item.writing.criteria_met');
  if (met >= 0.4) return t('item.writing.criteria_partly');
  return t('item.writing.criteria_open');
}

function renderFeedbackPanel(host, feedback, titleKey) {
  clear(host);
  if (!feedback) return;
  const title = titleKey === 'item.writing.final_feedback_title'
    ? t('item.writing.final_feedback_title')
    : t('item.writing.feedback_title', { loop: feedback.loop || 1 });
  host.appendChild(h('div.ai-feedback-head.row.gap-2', { style: 'align-items:center' },
    h('span.icon-tile', { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/></svg>' }),
    h('strong', { text: title }),
  ));
  if (feedback.summary) {
    host.appendChild(h('p', { text: feedback.summary }));
  }
  if (feedback.requiredWords && (feedback.requiredWords.used.length || feedback.requiredWords.missing.length)) {
    const missing = feedback.requiredWords.missing || [];
    const used = feedback.requiredWords.used || [];
    host.appendChild(h('p.small.mt-1', {
      text: t('item.writing.wordbox_feedback', { used: used.join(', ') || '—', missing: missing.join(', ') || '—' }),
      class: missing.length ? '' : 'writing-wordbox-ok',
    }));
  }
  if (Array.isArray(feedback.criteria) && feedback.criteria.length) {
    for (const criterion of feedback.criteria) {
      const met = Number(criterion.met);
      const card = h('div.ai-exercise.writing-criterion');
      const pct = Math.max(0, Math.min(1, Number.isFinite(met) ? met : 0));
      card.appendChild(h('div.row.between.wrap',
        h('span.strong', { text: criterion.label || '' }),
        h('span.badge.tiny', { class: pct >= 0.85 ? 'badge-success' : pct >= 0.4 ? 'badge-warning' : 'badge-danger', text: metLabel(met) }),
      ));
      const bar = h('div.progress.mt-1', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct * 100) });
      const fill = h('span');
      fill.style.width = `${(pct * 100).toFixed(1)}%`;
      bar.appendChild(fill);
      card.appendChild(bar);
      if (criterion.comment) card.appendChild(h('p.small.mt-1.mb-0', { text: criterion.comment }));
      if (criterion.tip) card.appendChild(h('p.small.muted.mb-0', h('strong', { text: `${t('item.writing.tip')}: ` }), criterion.tip));
      host.appendChild(card);
    }
  }
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const criteria = Array.isArray(config.criteria) ? config.criteria : [];
  const minWords = Number(config.minWords) || 0;
  const maxWords = Number(config.maxWords) || 0;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  // criteria overview (transparent rubric)
  if (criteria.length) {
    const critBox = h('div.writing-criteria-overview');
    critBox.appendChild(h('p.label.mb-1', { text: t('item.writing.legend') }));
    critBox.appendChild(
      h('ul.writing-criteria-list',
        criteria.map((c) => h('li', { text: `${c.label}${Number(c.weight) > 0 ? ` (${c.weight} %)` : ''}` })),
      ),
    );
    root.appendChild(critBox);
  }

  // source material
  if (String(config.sourceText || '').trim()) {
    const details = h('details.writing-source.mt-1');
    details.appendChild(h('summary', { text: t('item.writing.source') }));
    const srcBox = h('div.rt.writing-source-text');
    renderRichText(srcBox, String(config.sourceText));
    details.appendChild(srcBox);
    root.appendChild(details);
  }

  const field = fieldset(t('item.writing.legend'));
  const textareaId = `writing-${item.id || 'x'}`;
  const requiredWords = Array.isArray(config.requiredWords) ? config.requiredWords.filter((w) => String(w).trim()) : [];
  const hints = Array.isArray(config.hints) ? config.hints.filter((entry) => String(entry).trim()) : [];

  // Word box: required words as chips; used ones get struck through, and their
  // occurrences in the text are highlighted green via the backdrop layer.
  let wordChips = [];
  let wordUsedEl = null;
  if (requiredWords.length) {
    const box = h('div.writing-wordbox.mb-1');
    box.appendChild(h('p.label.mb-1', { text: t('item.writing.wordbox') }));
    const chipRow = h('div.row.gap-1.wrap.writing-wordbox-chips');
    for (const word of requiredWords) {
      const chip = h('span.writing-word-chip', { text: String(word) });
      chipRow.appendChild(chip);
      wordChips.push({ word: String(word), chip });
    }
    wordUsedEl = h('span.tiny.muted.ml-1', { text: t('item.writing.wordbox_used', { used: 0, total: requiredWords.length }) });
    box.append(chipRow, h('div.mt-1', wordUsedEl));
    field.appendChild(box);
  }

  const editorWrap = h('div.writing-editor-wrap');
  const backdrop = h('div.writing-highlight', { 'aria-hidden': 'true' });
  const textarea = h('textarea.textarea.writing-textarea', {
    id: textareaId,
    rows: 12,
    placeholder: '…',
    disabled: readonly || undefined,
  });
  editorWrap.append(backdrop, textarea);
  const metaRow = h('div.row.between.wrap.mt-1');
  const countEl = h('span.small.muted', { text: t('item.writing.words', { count: 0 }) });
  const minEl = minWords > 0 ? h('span.tiny.muted', { text: t('item.writing.min_words', { n: minWords }) }) : null;
  metaRow.append(countEl, minEl);
  field.append(editorWrap, metaRow);
  root.appendChild(field);

  // Step-by-step hints before writing starts (only on a fresh, empty attempt).
  const initialText = String((ctx.response && ctx.response.text) || '');
  if (hints.length && !readonly && ctx.mode !== 'review' && !initialText.trim()) {
    let step = 0;
    const stepText = h('p.writing-hint-text');
    const stepCounter = h('span.tiny.muted');
    const nextBtn = h('button.btn.btn-primary.btn-sm', { type: 'button' });
    const card = h('div.card.writing-hints-card.mb-2',
      h('p.label.mb-1', { text: t('item.writing.hints_title') }),
      stepText,
      h('div.row.between.wrap.mt-2', stepCounter, nextBtn),
    );
    const renderStep = () => {
      stepText.textContent = String(hints[step]);
      stepCounter.textContent = t('item.writing.hints_step', { current: step + 1, total: hints.length });
      nextBtn.textContent = step + 1 >= hints.length ? t('item.writing.hints_start') : t('item.writing.hints_next');
    };
    nextBtn.addEventListener('click', () => {
      if (step + 1 >= hints.length) {
        card.remove();
        textarea.disabled = false;
        textarea.focus();
      } else {
        step += 1;
        renderStep();
      }
    });
    renderStep();
    textarea.disabled = true;
    root.insertBefore(card, field);
  }

  // feedback loop (student mode only, when enabled and not readonly)
  const feedbackHost = h('div.writing-feedback.mt-2');
  root.appendChild(feedbackHost);
  let loop = 0;

  // custom callbacks are passed on the raw ctx (normalizeCtx keeps only the core fields)
  const requestFeedback = typeof rawCtx.requestFeedback === 'function' ? rawCtx.requestFeedback : null;
  const storedFeedback = rawCtx.writingFeedback && typeof rawCtx.writingFeedback === 'object' ? rawCtx.writingFeedback : null;

  if (ctx.mode === 'review') {
    if (storedFeedback) renderFeedbackPanel(feedbackHost, storedFeedback, 'item.writing.final_feedback_title');
    else if (config.allowLoops !== false) feedbackHost.appendChild(h('p.small.muted', { text: t('item.writing.no_feedback_yet') }));
  } else if (!readonly && config.allowLoops !== false && requestFeedback) {
    const button = h('button.btn.btn-secondary.btn-sm.writing-feedback-button', { type: 'button' },
      h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/></svg>' }),
      t('item.writing.feedback_button'),
    );
    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    button.addEventListener('click', async () => {
      const text = textarea.value;
      button.disabled = true;
      button.textContent = t('item.writing.feedback_loading');
      errorBox.hidden = true;
      try {
        const feedback = await requestFeedback(text);
        loop = Number(feedback && feedback.loop) || loop + 1;
        renderFeedbackPanel(feedbackHost, feedback, 'item.writing.feedback_title');
      } catch (error) {
        errorBox.textContent = t('item.writing.feedback_error');
        errorBox.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = t('item.writing.feedback_button');
      }
    });
    field.appendChild(h('div.row.gap-2.mt-2', button));
    feedbackHost.appendChild(errorBox);
  } else if (!readonly && config.allowLoops === false) {
    feedbackHost.appendChild(h('p.small.muted', { text: t('item.writing.loops_disabled') }));
  }

  if (readonly && ctx.mode !== 'review') {
    root.appendChild(notice(t('item.writing.locked'), 'info'));
  }

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function updateCount() {
    const count = wordCount(textarea.value);
    countEl.textContent = t('item.writing.words', { count });
    countEl.classList.toggle('text-danger', maxWords > 0 && count > maxWords);
  }

  function updateWordbox() {
    if (!wordChips.length) return;
    const { used, missing } = findUsedWords(textarea.value, requiredWords);
    const usedSet = new Set(used.map((w) => w.toLowerCase()));
    for (const { word, chip } of wordChips) {
      chip.classList.toggle('is-used', usedSet.has(word.toLowerCase()));
    }
    if (wordUsedEl) wordUsedEl.textContent = t('item.writing.wordbox_used', { used: used.length, total: requiredWords.length });
    // green highlight of used words in the backdrop behind the textarea
    backdrop.innerHTML = highlightUsedWords(escapeHtml(textarea.value), used);
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
    return missing;
  }
  textarea.addEventListener('input', () => {
    updateCount();
    updateWordbox();
  });
  textarea.addEventListener('scroll', () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  });

  function setResponse(response) {
    textarea.value = response && typeof response.text === 'string' ? response.text : '';
    updateCount();
    updateWordbox();
  }
  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { text: textarea.value };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'textarea:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
