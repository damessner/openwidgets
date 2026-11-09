// #/print?activity=<id>  — printable worksheet (+ optional answer key)
// #/print?assignment=<id>&participant=<id> — printable student result sheet
//
// The worksheet renders each item type as a static, print-friendly layout (no
// reliance on the interactive renderers). The result sheet reuses the shared
// review renderers so it matches what the teacher sees while grading.
import { get, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, renderRichText, toast } from '/lib/dom.js';
import { t, getLocale } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { apiBaseUrl, assetUrl, parseDefinition } from '../lib/core.js';
import { describeCorrect, typeLabel } from '../lib/items.js';
import { mountItemSafe } from '../lib/preview.js';

function seededShuffle(list, seed) {
  const source = Array.isArray(list) ? list.slice() : [];
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let i = source.length - 1; i > 0; i -= 1) {
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 2246822507);
    hash ^= hash >>> 15;
    const j = Math.abs(hash) % (i + 1);
    const tmp = source[i];
    source[i] = source[j];
    source[j] = tmp;
  }
  return source;
}

function richTextNode(text, className) {
  const node = h(`div${className ? `.${className}` : ''}.rt`);
  renderRichText(node, String(text || ''));
  return node;
}

function mediaBlock(media) {
  if (!media || media.type === 'none') return null;
  if (media.type === 'image' && media.assetId) {
    return h('div.print-media', h('img.print-media-image', { src: assetUrl(media.assetId), alt: media.alt || '' }));
  }
  if (media.type === 'audio') return h('p.print-media-note.small.muted', t('teacher.print_audio_note'));
  if (media.type === 'video') return h('p.print-media-note.small.muted', t('teacher.print_video_note', { url: media.url || '' }));
  return null;
}

function blankLine(number) {
  return h(
    'span.print-blank',
    h('span.print-blank-line'),
    number ? h('sup.print-blank-number', String(number)) : null,
  );
}

function answerLines(item) {
  return describeCorrect(item);
}

function renderAnswers(item) {
  const lines = answerLines(item);
  if (!lines.length) return null;
  return h(
    'div.print-answer-key',
    h('span.print-answer-key-label', t('teacher.answer')),
    h(
      'ul.print-answer-key-list',
      lines.map((line) => h('li', line)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Worksheet item rendering per type
// ---------------------------------------------------------------------------

function worksheetItemBody(item, showAnswers) {
  const config = item.config || {};
  const body = h('div.print-item-body');
  switch (item.type) {
    case 'text': {
      if (config.text) body.appendChild(richTextNode(config.text, 'print-text-block'));
      break;
    }
    case 'multiple_choice': {
      const choices = Array.isArray(config.choices) ? config.choices : [];
      const multi = config.multi === true;
      const list = h('ul.print-choices');
      for (const choice of choices) {
        if (!choice) continue;
        const mark = h(`span.print-choice-box.${multi ? 'is-multi' : 'is-single'}`, { 'aria-hidden': 'true' });
        const line = h('li.print-choice', mark, h('span.print-choice-text', String(choice.text || '')));
        if (showAnswers && choice.correct === true) {
          line.appendChild(h('span.print-choice-correct', '✓'));
        }
        list.appendChild(line);
      }
      body.appendChild(list);
      body.appendChild(
        h('p.print-instruction.small.muted', multi ? t('teacher.print_mc_multi') : t('teacher.print_mc_single')),
      );
      break;
    }
    case 'short_answer': {
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_short_answer')));
      body.appendChild(h('div.print-answer-lines', h('div.print-answer-line'), h('div.print-answer-line')));
      break;
    }
    case 'numeric': {
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_numeric')));
      body.appendChild(h('div.print-answer-lines', h('div.print-answer-line.print-answer-line-short')));
      break;
    }
    case 'fill_blanks': {
      const text = String(config.text || '');
      const paragraph = h('p.print-blanks-text');
      const parts = text.split(/(\{\{\s*\d+\s*\}\})/g);
      let blankCounter = 0;
      for (const part of parts) {
        const match = /^\{\{\s*(\d+)\s*\}\}$/.exec(part);
        if (match) {
          blankCounter += 1;
          paragraph.appendChild(blankLine(match[1]));
        } else if (part) {
          paragraph.appendChild(document.createTextNode(part));
        }
      }
      if (blankCounter === 0) paragraph.appendChild(blankLine(null));
      body.appendChild(paragraph);
      break;
    }
    case 'match': {
      const pairs = Array.isArray(config.pairs) ? config.pairs : [];
      const left = pairs.map((pair, index) => ({ id: pair.id, text: pair.left, letter: String.fromCharCode(65 + index) }));
      const rightSource = pairs.map((pair) => ({ id: pair.id, text: pair.right }));
      const right = seededShuffle(rightSource, `match:${item.id}`).map((pair, index) => ({
        id: pair.id,
        text: pair.text,
        number: index + 1,
      }));
      const table = h(
        'table.print-match',
        h('thead', h('tr', h('th', t('teacher.print_match_left')), h('th', t('teacher.print_match_answer')), h('th', t('teacher.print_match_right')))),
        h(
          'tbody',
          left.map((entry, index) =>
            h(
              'tr',
              h('td.print-match-left', h('span.print-match-letter', entry.letter), h('span', String(entry.text || ''))),
              h('td.print-match-answer', h('span.print-write-box')),
              h('td.print-match-right', right[index] ? h('span.print-match-number', String(right[index].number)) : null, h('span', String(right[index] ? right[index].text : ''))),
            ),
          ),
        ),
      );
      body.appendChild(table);
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_match_hint')));
      break;
    }
    case 'ordering': {
      const items = Array.isArray(config.items) ? config.items : [];
      const shuffled = seededShuffle(items, `ordering:${item.id}`);
      const list = h('ol.print-ordering');
      for (const entry of shuffled) {
        list.appendChild(
          h(
            'li.print-ordering-item',
            h('span.print-write-box'),
            h('span', String(entry && entry.text ? entry.text : '')),
          ),
        );
      }
      body.appendChild(list);
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_ordering_hint', { n: items.length })));
      break;
    }
    case 'pins': {
      const image = config.image && config.image.assetId ? config.image : null;
      const zones = Array.isArray(config.zones) ? config.zones : [];
      if (image) {
        const canvas = h('div.print-pins-canvas');
        canvas.appendChild(h('img.print-pins-image', { src: assetUrl(image.assetId), alt: image.alt || '' }));
        if (showAnswers) {
          zones.forEach((zone, index) => {
            canvas.appendChild(
              h(
                'span.print-pin-marker',
                {
                  style: {
                    left: `${(Number(zone.x) || 0) * 100}%`,
                    top: `${(Number(zone.y) || 0) * 100}%`,
                    width: `${Math.max(2.5, Math.min(30, (Number(zone.r) || 0.05) * 200))}%`,
                  },
                },
                String(index + 1),
              ),
            );
          });
        }
        body.appendChild(canvas);
      }
      const list = h('ol.print-pins-zones');
      for (const zone of zones) {
        list.appendChild(h('li', h('span.print-pins-zone-label', String((zone && zone.label) || ''))));
      }
      if (zones.length) body.appendChild(list);
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_pins_hint')));
      break;
    }
    case 'long_answer': {
      const configData = item.config || {};
      const minWords = Number(configData.minWords) || 0;
      const lineCount = Math.max(5, Math.min(18, Math.round((minWords || 40) / 8)));
      body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_long_answer')));
      const lines = h('div.print-writing-lines');
      for (let i = 0; i < lineCount; i += 1) lines.appendChild(h('div.print-writing-line'));
      body.appendChild(lines);
      if (minWords > 0) body.appendChild(h('p.print-instruction.small.muted', t('teacher.print_min_words', { n: minWords })));
      break;
    }
    default:
      body.appendChild(h('p.small.muted', t('item.unknown_type')));
  }
  if (showAnswers) {
    const answers = renderAnswers(item);
    if (answers) body.appendChild(answers);
  }
  return body;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export async function mount(root, ctx) {
  const activityId = String(ctx.params.get('activity') || '').trim();
  const assignmentId = String(ctx.params.get('assignment') || '').trim();
  const participantId = String(ctx.params.get('participant') || '').trim();
  const isResult = Boolean(participantId);
  const mode = isResult ? 'result' : activityId ? 'worksheet' : '';

  const state = {
    loading: true,
    error: null,
    title: '',
    description: '',
    definition: null,
    review: null,
    showAnswers: false,
    responses: new Map(),
  };

  let disposed = false;
  const wrapper = h('div.print-view');
  clear(root);
  root.appendChild(wrapper);

  ctx.setTitle(t(isResult ? 'teacher.print_result_title' : 'teacher.print_worksheet_title'));

  function showAnswersToggle() {
    return h(
      'label.switch',
      h('input', {
        type: 'checkbox',
        checked: state.showAnswers,
        on: {
          change: (event) => {
            state.showAnswers = event.target.checked;
            renderSheet();
          },
        },
      }),
      h('span.track', { 'aria-hidden': 'true' }),
      h('span.small', t('teacher.show_answers')),
    );
  }

  function renderToolbar() {
    const backHref = isResult
      ? `/teacher/grade?assignment=${encodeURIComponent(assignmentId)}&participant=${encodeURIComponent(participantId)}`
      : activityId
        ? `/teacher/edit?id=${encodeURIComponent(activityId)}`
        : '/teacher/dashboard';
    const printButton = h(
      'button.btn.btn-primary.btn-sm',
      { type: 'button' },
      h('span', { html: icon('printer', { size: 16 }) }),
      t('common.print'),
    );
    printButton.addEventListener('click', () => window.print());
    return h(
      'div.print-toolbar.no-print',
      h(
        'div.container.row.between.wrap.gap-2',
        h(
          'div.row.gap-2.wrap',
          h(
            'a.btn.btn-ghost.btn-sm',
            { href: backHref },
            h('span', { html: icon('arrow-left', { size: 16 }) }),
            h('span', t('common.back')),
          ),
          h('span.strong', state.title || t(isResult ? 'teacher.print_result_title' : 'teacher.print_worksheet_title')),
        ),
        h('div.row.gap-3.wrap', showAnswersToggle(), printButton),
      ),
    );
  }

  function worksheetHeader() {
    const definition = state.definition || {};
    const items = Array.isArray(definition.items) ? definition.items : [];
    const maxScore = items.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
    return h(
      'header.print-doc-header',
      h('h1.print-doc-title', state.title || t('teacher.untitled')),
      state.description ? richTextNode(state.description, 'print-doc-description') : null,
      h(
        'div.print-doc-meta',
        h('span', t('teacher.print_meta_items', { n: items.length })),
        h('span', t('teacher.print_meta_points', { n: maxScore })),
        h('span', t(definition.template === 'quiz' ? 'teacher.template_quiz' : 'teacher.template_worksheet')),
      ),
      h(
        'div.print-name-fields',
        h('div.print-name-field', h('span.print-name-label', t('teacher.print_name')), h('span.print-name-line')),
        h('div.print-name-field', h('span.print-name-label', t('teacher.print_class')), h('span.print-name-line')),
        h('div.print-name-field', h('span.print-name-label', t('teacher.print_date')), h('span.print-name-line.print-name-line-short')),
      ),
    );
  }

  function worksheetItems() {
    const definition = state.definition || {};
    const items = Array.isArray(definition.items) ? definition.items : [];
    const container = h('div.print-items');
    items.forEach((item, index) => {
      const article = h('article.print-item', { 'data-item-id': item.id });
      const points = Number(item.points) || 0;
      article.appendChild(
        h(
          'div.print-item-head',
          h('span.print-item-number', String(index + 1)),
          h('span.print-item-type', typeLabel(item.type)),
          item.type !== 'text' ? h('span.print-item-points', t('teacher.print_points_abbr', { n: points })) : null,
        ),
      );
      if (item.stem) article.appendChild(richTextNode(item.stem, 'print-item-stem'));
      if (item.help) article.appendChild(richTextNode(item.help, 'print-item-help'));
      const media = mediaBlock(item.media);
      if (media) article.appendChild(media);
      article.appendChild(worksheetItemBody(item, state.showAnswers));
      container.appendChild(article);
    });
    return container;
  }

  function resultHeader() {
    const review = state.review || {};
    const participant = review.participant || {};
    const assignment = review.assignment || {};
    const responses = state.responses;
    let score = 0;
    let max = 0;
    for (const [, response] of responses) {
      score += response.manualScore !== null && response.manualScore !== undefined ? Number(response.manualScore) : Number(response.autoScore) || 0;
      max += Number(response.maxScore) || 0;
    }
    if (responses.size === 0) {
      score = Number(participant.score) || 0;
      max = Number(participant.maxScore) || 0;
    }
    const percent = max > 0 ? Math.round((score / max) * 100) : 0;
    return h(
      'header.print-doc-header',
      h('h1.print-doc-title', assignment.title || state.title || ''),
      h(
        'div.print-result-meta',
        h('div.print-result-row', h('span.print-result-label', t('common.student')), h('span.print-result-value', participant.name || '—')),
        h('div.print-result-row', h('span.print-result-label', t('teacher.code')), h('span.print-result-value.mono', assignment.code || '—')),
        h(
          'div.print-result-row',
          h('span.print-result-label', t('common.status')),
          h('span.print-result-value', t(participant.status === 'submitted' || participant.status === 'graded' ? 'teacher.status_submitted' : 'teacher.status_in_progress')),
        ),
        h('div.print-result-row', h('span.print-result-label', t('teacher.result_date')), h('span.print-result-value', new Date().toLocaleDateString(getLocale() === 'en' ? 'en-GB' : 'de-AT'))),
        h('div.print-result-row.print-result-score', h('span.print-result-label', t('teacher.result_score')), h('span.print-result-value', `${Math.round(score * 100) / 100} / ${Math.round(max * 100) / 100} (${percent} %)`)),
      ),
    );
  }

  async function mountResultItems() {
    const items = resultItems();
    for (const item of items) {
      const card = wrapper.querySelector(`[data-item-id="${item.id}"] .print-result-render`);
      if (!card || disposed) continue;
      const response = state.responses.get(item.id);
      try {
        const instance = await mountItemSafe(card, {
          item,
          response: response ? response.response : null,
          mode: 'review',
          locale: (state.definition && state.definition.locale) || 'de',
          seed: 42,
          disabled: true,
          showAnswers: state.showAnswers,
          result: response
            ? {
                correct: Boolean(response.correct),
                autoScore: response.manualScore !== null && response.manualScore !== undefined ? Number(response.manualScore) : Number(response.autoScore) || 0,
                maxScore: Number(response.maxScore) || 0,
                needsManual: response.manualScore === null || response.manualScore === undefined ? Boolean(response.needsManual) : false,
              }
            : null,
        });
        state.instances.push(instance);
      } catch {
        card.appendChild(h('p.small.muted', t('teacher.renderer_missing_review')));
      }
    }
  }

  function resultItems() {
    const definition = state.definition || {};
    return Array.isArray(definition.items) ? definition.items : [];
  }

  function resultItemsSection() {
    const items = resultItems();
    const container = h('div.print-items');
    for (const item of items) {
      const response = state.responses.get(item.id);
      const article = h('article.print-item.print-result-item', { 'data-item-id': item.id });
      const manual = response && response.manualScore !== null && response.manualScore !== undefined;
      const scoreValue = response ? (manual ? Number(response.manualScore) : Number(response.autoScore) || 0) : 0;
      const maxScore = response ? Number(response.maxScore) || 0 : Number(item.points) || 0;
      const stateKey = !response
        ? 'unanswered'
        : response.needsManual && !manual
          ? 'manual'
          : scoreValue >= maxScore - 1e-9
            ? 'correct'
            : scoreValue > 0
              ? 'partial'
              : 'incorrect';
      article.appendChild(
        h(
          'div.print-item-head',
          h('span.print-item-number', String(items.indexOf(item) + 1)),
          h('span.print-item-type', typeLabel(item.type)),
          h('span.print-item-points', `${Math.round(scoreValue * 100) / 100} / ${Math.round(maxScore * 100) / 100} ${t('teacher.points_abbr')}`),
          h('span.print-result-state', { class: `is-${stateKey}` }, t(`teacher.state_${stateKey}`)),
        ),
      );
      const renderHost = h('div.print-result-render');
      article.appendChild(renderHost);
      const feedback = response && String(response.feedback || '').trim();
      if (feedback) {
        article.appendChild(h('div.print-feedback', h('span.print-feedback-label', t('teacher.feedback')), h('span', feedback)));
      }
      container.appendChild(article);
    }
    return container;
  }

  function renderSheet() {
    if (disposed) return;
    clear(wrapper);
    state.instances.forEach((instance) => {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    state.instances = [];
    wrapper.appendChild(renderToolbar());
    if (state.loading) {
      wrapper.appendChild(
        h('div.loading-block', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', t('common.loading'))),
      );
      return;
    }
    if (state.error) {
      wrapper.appendChild(
        h(
          'div.card.error-card',
          h('h2', t('teacher.load_failed')),
          h('p.muted', errorMessage(state.error)),
          h('a.btn.btn-primary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
        ),
      );
      return;
    }
    const sheet = h('div.print-sheet');
    if (isResult) {
      sheet.appendChild(resultHeader());
      sheet.appendChild(resultItemsSection());
      sheet.appendChild(
        h(
          'footer.print-doc-footer',
          h('span', t('teacher.print_footer_status', { status: t('teacher.print_grade_note') })),
          h('span.mono', `${apiBaseUrl()}/a/${encodeURIComponent((state.review && state.review.assignment && state.review.assignment.code) || '')}`),
        ),
      );
    } else {
      sheet.appendChild(worksheetHeader());
      sheet.appendChild(worksheetItems());
      const stamp = new Date().toLocaleDateString(getLocale() === 'en' ? 'en-GB' : 'de-AT');
      sheet.appendChild(
        h('footer.print-doc-footer', h('span', `${t('teacher.print_generated')} · ${stamp}`), h('span', apiBaseUrl())),
      );
    }
    wrapper.appendChild(sheet);
    if (isResult) mountResultItems();
  }

  async function load() {
    state.loading = true;
    state.error = null;
    renderSheet();
    try {
      if (!mode) throw new Error('missing params');
      if (isResult) {
        const data = await get(`/api/participants/${encodeURIComponent(participantId)}/review`, { signal: ctx.signal });
        if (disposed) return;
        state.review = data;
        const reviewDefinition = (() => {
          const activity = data && data.activity;
          if (!activity) return null;
          if (activity.definition) return parseDefinition(activity.definition);
          if (Array.isArray(activity.items)) return activity;
          return parseDefinition(activity);
        })();
        state.definition = reviewDefinition || { items: [], locale: 'de', template: 'worksheet' };
        state.title = (data.assignment && data.assignment.title) || (reviewDefinition && reviewDefinition.title) || '';
        state.responses = new Map();
        for (const response of (data && Array.isArray(data.responses) ? data.responses : [])) {
          if (response && response.itemId) state.responses.set(response.itemId, response);
        }
      } else {
        const data = await get(`/api/activities/${encodeURIComponent(activityId)}`, { signal: ctx.signal });
        if (disposed) return;
        const activity = data && data.activity;
        state.definition = parseDefinition(activity && activity.definition) || { items: [], template: 'worksheet', locale: 'de' };
        state.title = (activity && activity.title) || state.definition.title || '';
        state.description = (activity && activity.description) || state.definition.description || '';
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      if (disposed) return;
      state.error = error;
    } finally {
      if (!disposed) {
        state.loading = false;
        renderSheet();
      }
    }
  }

  state.instances = [];
  renderSheet();
  await load();

  return () => {
    disposed = true;
    state.instances.forEach((instance) => {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    state.instances = [];
  };
}
