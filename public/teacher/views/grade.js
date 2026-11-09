// #/grade?assignment=&participant= — teacher review / manual grading.
//
// Each response is rendered read-only through the shared renderers in
// mode:'review'. Items that need manual grading get a score input and a
// feedback box; saving PATCHes /api/participants/:id/responses/:itemId.
import { get, post, patch, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog } from '/lib/dom.js';
import { t, formatDateTime } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { parseDefinition } from '../lib/core.js';
import { typeLabel } from '../lib/items.js';
import { mountItemSafe } from '../lib/preview.js';

const EPSILON = 1e-9;

function responseState(response) {
  if (!response) return 'unanswered';
  const manual = response.manualScore;
  const score = manual === null || manual === undefined ? Number(response.autoScore) || 0 : Number(manual);
  const max = Number(response.maxScore) || 0;
  if (response.needsManual && (manual === null || manual === undefined)) return 'manual';
  if (max > 0 && score >= max - EPSILON) return 'correct';
  if (score > EPSILON) return 'partial';
  return 'incorrect';
}

function effectiveScore(response) {
  if (!response) return 0;
  const manual = response.manualScore;
  return manual === null || manual === undefined ? Number(response.autoScore) || 0 : Number(manual);
}

function effectiveResult(response) {
  if (!response) return null;
  const manual = response.manualScore;
  const hasManual = manual !== null && manual !== undefined;
  const max = Number(response.maxScore) || 0;
  const score = hasManual ? Number(manual) : Number(response.autoScore) || 0;
  return {
    correct: hasManual ? score >= max - EPSILON : Boolean(response.correct),
    autoScore: score,
    maxScore: max,
    needsManual: hasManual ? false : Boolean(response.needsManual),
  };
}

const STATE_BADGE = {
  unanswered: { cls: 'badge', key: 'common.unanswered', iconName: 'minus' },
  correct: { cls: 'badge-success', key: 'common.correct', iconName: 'checkCircle' },
  partial: { cls: 'badge-warning', key: 'common.partial', iconName: 'partial' },
  incorrect: { cls: 'badge-danger', key: 'common.incorrect', iconName: 'xCircle' },
  manual: { cls: 'badge-info', key: 'common.manual', iconName: 'info' },
};

function extractDefinition(review) {
  const activity = review && review.activity;
  if (!activity) return null;
  if (activity.definition) {
    const definition = parseDefinition(activity.definition);
    if (definition) return definition;
  }
  if (Array.isArray(activity.items)) return activity;
  return parseDefinition(activity);
}

function formatPoints(value) {
  const number = Number(value) || 0;
  return String(Math.round(number * 100) / 100).replace('.', ',');
}

export async function mount(root, ctx) {
  const assignmentId = String(ctx.params.get('assignment') || '').trim();
  const participantId = String(ctx.params.get('participant') || '').trim();
  ctx.setTitle(t('teacher.grade_title'));

  const state = {
    review: null,
    players: [],
    loading: true,
    error: null,
    rendererInstances: new Map(),
    savingItems: new Set(),
  };

  let disposed = false;
  const wrapper = h('div.grade-view');
  clear(root);
  root.appendChild(wrapper);

  ctx.onLocaleChange(() => {
    if (!disposed) render();
  });

  function navigateToParticipant(id) {
    const next = new URLSearchParams();
    const effectiveAssignment = assignmentId || (state.review && state.review.assignment && state.review.assignment.id) || '';
    if (effectiveAssignment) next.set('assignment', effectiveAssignment);
    if (id) next.set('participant', id);
    ctx.navigate(`/teacher/grade?${next.toString()}`);
  }

  async function loadResults(assignment) {
    if (!assignment) return;
    try {
      const data = await get(`/api/assignments/${encodeURIComponent(assignment)}/results`, { signal: ctx.signal });
      if (disposed) return;
      if (data && Array.isArray(data.players)) state.players = data.players;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      /* player list is a convenience — ignore failures */
    }
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      if (participantId) {
        const data = await get(`/api/participants/${encodeURIComponent(participantId)}/review`, { signal: ctx.signal });
        if (disposed) return;
        state.review = data;
        const effectiveAssignment =
          assignmentId || (data.assignment && data.assignment.id) || (data.participant && data.participant.assignmentId) || '';
        await loadResults(effectiveAssignment);
      } else if (assignmentId) {
        await loadResults(assignmentId);
      } else {
        state.error = new Error('missing participant');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      state.error = error;
    } finally {
      if (!disposed) {
        state.loading = false;
        render();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Totals helpers
  // -------------------------------------------------------------------------

  function definitionItems() {
    const definition = extractDefinition(state.review);
    return definition && Array.isArray(definition.items) ? definition.items : [];
  }

  function responsesByItem() {
    const map = new Map();
    const responses = state.review && Array.isArray(state.review.responses) ? state.review.responses : [];
    for (const response of responses) {
      if (response && response.itemId) map.set(response.itemId, response);
    }
    return map;
  }

  function totals() {
    const items = definitionItems();
    const responses = responsesByItem();
    let score = 0;
    let max = 0;
    for (const item of items) {
      const response = responses.get(item.id);
      max += response && Number.isFinite(Number(response.maxScore)) ? Number(response.maxScore) : Number(item.points) || 0;
      score += effectiveScore(response);
    }
    if (items.length === 0 && state.review && state.review.participant) {
      return {
        score: Number(state.review.participant.score) || 0,
        max: Number(state.review.participant.maxScore) || 0,
      };
    }
    return { score, max };
  }

  function updateTotalsDisplay() {
    const host = wrapper.querySelector('#grade-totals');
    if (!host) return;
    const { score, max } = totals();
    clear(host);
    host.append(
      h('span.grade-total-value', `${formatPoints(score)} / ${formatPoints(max)}`),
      h('span.small.muted', t('teacher.points_total')),
    );
    if (state.review && state.review.participant) {
      const percent = max > 0 ? Math.round((score / max) * 100) : 0;
      const bar = wrapper.querySelector('#grade-progress');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))} %`;
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function saveManual(item, response, scoreInput, feedbackInput, card) {
    if (!state.review || !state.review.participant) return;
    const participant = state.review.participant;
    const rawScore = scoreInput.value;
    let manualScore = null;
    if (rawScore !== '') {
      const parsed = Number(rawScore.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        toast(t('teacher.invalid_score'), 'error');
        return;
      }
      manualScore = Math.max(0, Math.min(Number(response.maxScore) || 0, parsed));
    }
    const feedback = feedbackInput ? feedbackInput.value : '';
    state.savingItems.add(item.id);
    card.classList.add('is-saving');
    try {
      const data = await patch(
        `/api/participants/${encodeURIComponent(participant.id)}/responses/${encodeURIComponent(item.id)}`,
        { manualScore, feedback },
      );
      const updated = data && data.response;
      if (updated) {
        response.manualScore = updated.manualScore;
        response.feedback = updated.feedback;
        response.autoScore = updated.autoScore;
        response.maxScore = updated.maxScore;
        response.needsManual = updated.needsManual;
        response.correct = updated.correct;
      } else {
        response.manualScore = manualScore;
        response.feedback = feedback;
      }
      if (data && data.participantTotals) {
        participant.score = data.participantTotals.score;
        participant.maxScore = data.participantTotals.maxScore;
      }
      applyResultToRenderer(item.id, response);
      updateItemBadge(item.id, response);
      updateTotalsDisplay();
      toast(t('common.saved'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      state.savingItems.delete(item.id);
      card.classList.remove('is-saving');
    }
  }

  function applyResultToRenderer(itemId, response) {
    const instance = state.rendererInstances.get(itemId);
    if (!instance || typeof instance.setResult !== 'function') return;
    try {
      instance.setResult(effectiveResult(response));
    } catch {
      /* renderer-specific — ignore */
    }
  }

  function updateItemBadge(itemId, response) {
    const badgeHost = wrapper.querySelector(`[data-badge-for="${itemId}"]`);
    if (!badgeHost) return;
    const stateValue = responseState(response);
    const meta = STATE_BADGE[stateValue];
    clear(badgeHost);
    badgeHost.className = `badge ${meta.cls}`;
    badgeHost.append(h('span', { html: icon(meta.iconName, { size: 14 }) }), h('span', t(meta.key)));
  }

  async function forceSubmit() {
    if (!state.review || !state.review.participant) return;
    const participant = state.review.participant;
    const ok = await confirmDialog({
      title: t('teacher.force_submit'),
      message: t('teacher.force_submit_confirm', { name: participant.name || '' }),
      confirmLabel: t('teacher.force_submit'),
    });
    if (!ok) return;
    try {
      await post(`/api/participants/${encodeURIComponent(participant.id)}/submit`);
      toast(t('teacher.submitted'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetParticipant() {
    if (!state.review || !state.review.participant) return;
    const participant = state.review.participant;
    const ok = await confirmDialog({
      title: t('teacher.reset_participant'),
      message: t('teacher.reset_participant_confirm', { name: participant.name || '' }),
      confirmLabel: t('teacher.reset'),
      danger: true,
    });
    if (!ok) return;
    try {
      await post(`/api/participants/${encodeURIComponent(participant.id)}/reset`);
      toast(t('teacher.participant_reset'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function buildHeader() {
    const participant = state.review && state.review.participant;
    const assignment = state.review && state.review.assignment;
    const backLink = h(
      'a.btn.btn-ghost.btn-sm',
      { href: assignment && assignment.id ? `/teacher/assignment?id=${encodeURIComponent(assignment.id)}` : '/teacher/dashboard' },
      h('span', { html: icon('arrow-left', { size: 16 }) }),
      h('span', t('teacher.back_to_live')),
    );
    const heading = h(
      'div',
      h('h1.page-title.mb-0', participant ? participant.name || t('teacher.unknown_name') : t('teacher.grade_title')),
      h('p.small.muted.mb-0', assignment ? assignment.title || '' : t('teacher.grade_pick_student')),
    );
    const { score, max } = totals();
    const totalsHost = h(
      'div.grade-totals',
      h('div#grade-totals', h('span.grade-total-value', `${formatPoints(score)} / ${formatPoints(max)}`), h('span.small.muted', t('teacher.points_total'))),
      h('div.progress.grade-progress', h('span#grade-progress', { style: { width: `${max > 0 ? Math.round((score / max) * 100) : 0} %` } })),
    );

    const playerIndex = state.players.findIndex((player) => player.id === (participant && participant.id));
    const prevPlayer = playerIndex > 0 ? state.players[playerIndex - 1] : null;
    const nextPlayer = playerIndex >= 0 && playerIndex < state.players.length - 1 ? state.players[playerIndex + 1] : null;
    const prevButton = h(
      'button.btn.btn-sm.btn-secondary',
      { type: 'button', disabled: !prevPlayer, title: prevPlayer ? prevPlayer.name : '' },
      h('span', { html: icon('arrow-left', { size: 16 }) }),
      h('span', t('common.previous')),
    );
    if (prevPlayer) prevButton.addEventListener('click', () => navigateToParticipant(prevPlayer.id));
    const nextButton = h(
      'button.btn.btn-sm.btn-secondary',
      { type: 'button', disabled: !nextPlayer, title: nextPlayer ? nextPlayer.name : '' },
      h('span', t('common.next')),
      h('span', { html: icon('arrow-right', { size: 16 }) }),
    );
    if (nextPlayer) nextButton.addEventListener('click', () => navigateToParticipant(nextPlayer.id));

    const forceButton = h(
      'button.btn.btn-sm.btn-secondary',
      { type: 'button', disabled: !participant },
      h('span', { html: icon('checkCircle', { size: 16 }) }),
      h('span', t('teacher.force_submit')),
    );
    forceButton.addEventListener('click', forceSubmit);
    const resetButton = h(
      'button.btn.btn-sm.btn-ghost',
      { type: 'button', disabled: !participant },
      h('span', { html: icon('refresh', { size: 16 }) }),
      h('span', t('teacher.reset')),
    );
    resetButton.addEventListener('click', resetParticipant);
    const printButton = h(
      'button.btn.btn-sm.btn-secondary',
      { type: 'button', disabled: !participant || !assignment },
      h('span', { html: icon('printer', { size: 16 }) }),
      h('span', t('common.print')),
    );
    printButton.addEventListener('click', () => {
      if (!participant || !assignment) return;
      window.open(
        `/teacher/print?assignment=${encodeURIComponent(assignment.id)}&participant=${encodeURIComponent(participant.id)}`,
        '_blank',
        'noopener',
      );
    });

    return h(
      'div.grade-header.mt-4.mb-3',
      h(
        'div.row.between.wrap.gap-3',
        h('div.row.gap-2.wrap', backLink, heading),
        h('div.row.gap-2.wrap', totalsHost),
      ),
      h(
        'div.row.between.wrap.gap-2.mt-3',
        h('div.row.gap-2.wrap', prevButton, nextButton),
        h('div.row.gap-2.wrap', printButton, forceButton, resetButton),
      ),
    );
  }

  function buildItemCard(item, index) {
    const responses = responsesByItem();
    const response = responses.get(item.id);
    const stateValue = responseState(response);
    const meta = STATE_BADGE[stateValue];
    const card = h('article.card.compact.grade-item', { 'data-item-id': item.id });
    const badge = h(
      'span.badge',
      { 'data-badge-for': item.id },
      h('span', { html: icon(meta.iconName, { size: 14 }) }),
      h('span', t(meta.key)),
    );
    badge.className = `badge ${meta.cls}`;
    const pointsText = response
      ? t('teacher.item_score_of', { score: formatPoints(effectiveScore(response)), max: formatPoints(response.maxScore) })
      : t('teacher.item_points', { n: formatPoints(item.points) });
    card.appendChild(
      h(
        'div.grade-item-head',
        h('span.item-number', String(index + 1)),
        h('span.badge.badge-primary', typeLabel(item.type)),
        h('span.small.muted', pointsText),
        h('div.ml-auto', badge),
      ),
    );

    const mountHost = h('div.grade-item-render');
    card.appendChild(mountHost);

    if (!response) {
      card.appendChild(h('p.small.muted.mt-2', t('teacher.not_answered')));
      return card;
    }

    if (response.needsManual) {
      const scoreId = `manual-score-${item.id}`;
      const feedbackId = `manual-feedback-${item.id}`;
      const max = Number(response.maxScore) || 0;
      const scoreInput = h('input.input.input-sm', {
        id: scoreId,
        type: 'number',
        min: 0,
        max,
        step: 0.5,
        value: response.manualScore === null || response.manualScore === undefined ? '' : String(response.manualScore),
      });
      const feedbackInput = h('textarea.textarea', { id: feedbackId, rows: 2 });
      feedbackInput.value = response.feedback || '';
      const saveButton = h(
        'button.btn.btn-sm.btn-primary',
        { type: 'button' },
        h('span', { html: icon('save', { size: 16 }) }),
        h('span', t('common.save')),
      );
      saveButton.addEventListener('click', () => saveManual(item, response, scoreInput, feedbackInput, card));
      const clearButton = h('button.btn.btn-sm.btn-ghost', { type: 'button' }, t('teacher.clear_manual'));
      clearButton.addEventListener('click', () => {
        scoreInput.value = '';
        feedbackInput.value = '';
        saveManual(item, response, scoreInput, feedbackInput, card);
      });
      card.appendChild(
        h(
          'div.manual-grade',
          h('p.label.mb-2', t('teacher.manual_grade')),
          h(
            'div.manual-grade-grid',
            h(
              'div.field.field-sm.mb-0',
              h('label.label', { for: scoreId }, t('teacher.manual_score')),
              h('div.row.gap-2', scoreInput, h('span.small.muted', `/ ${formatPoints(max)}`)),
            ),
            h('div.field.field-sm.mb-0', h('label.label', { for: feedbackId }, t('teacher.feedback')), feedbackInput),
          ),
          h('div.row.gap-2.mt-2', saveButton, clearButton),
        ),
      );
    }

    return card;
  }

  function buildStudentPicker() {
    const card = h('div.card.compact.grade-picker');
    card.appendChild(h('div.card-header', h('div', h('h2.card-title', t('common.students')), h('p.card-subtitle', t('teacher.grade_pick_hint')))));
    if (state.players.length === 0) {
      card.appendChild(h('p.small.muted', t('teacher.no_participants')));
      return card;
    }
    const currentId = participantId;
    card.appendChild(
      h(
        'ul.student-list',
        state.players.map((player) => {
          const isCurrent = player.id === currentId;
          const link = h(
            'a.student-list-item',
            {
              href: `/teacher/grade?assignment=${encodeURIComponent(assignmentId || (state.review && state.review.assignment && state.review.assignment.id) || '')}&participant=${encodeURIComponent(player.id)}`,
            },
            h('span.dot', { class: player.online ? 'dot-online' : 'dot-offline', 'aria-hidden': 'true' }),
            h('span.grow.truncate', player.name || '—'),
            h('span.small.muted.nowrap', `${formatPoints(player.score)} / ${formatPoints(player.maxScore)}`),
          );
          if (isCurrent) link.classList.add('is-current');
          return h('li', link);
        }),
      ),
    );
    return card;
  }

  async function renderReview() {
    const items = definitionItems();
    const rendererHost = h('div.grade-items');
    wrapper.appendChild(buildHeader());

    if (!state.review || !state.review.participant) {
      if (state.players.length > 0) {
        wrapper.appendChild(buildStudentPicker());
      } else {
        wrapper.appendChild(
          h(
            'div.card.empty',
            h('p.empty-title', t('teacher.no_participant_selected')),
            h('p.empty-hint.small.muted', t('teacher.grade_pick_student')),
          ),
        );
      }
      return;
    }

    if (items.length === 0) {
      wrapper.appendChild(h('div.card.empty', h('p.empty-title', t('teacher.no_items'))));
      return;
    }

    const responses = responsesByItem();
    items.forEach((item, index) => {
      rendererHost.appendChild(buildItemCard(item, index));
    });
    wrapper.appendChild(rendererHost);

    // Mount renderers after the DOM is in place.
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const card = rendererHost.querySelector(`[data-item-id="${item.id}"]`);
      const host = card && card.querySelector('.grade-item-render');
      const response = responses.get(item.id);
      if (!host) continue;
      const instance = await mountItemSafe(host, {
        item,
        response: response ? response.response : null,
        mode: 'review',
        locale: definitionLocale(),
        seed: 42,
        disabled: true,
        showAnswers: true,
        result: effectiveResult(response),
      });
      if (disposed) {
        if (instance && typeof instance.destroy === 'function') instance.destroy();
        return;
      }
      state.rendererInstances.set(item.id, instance);
      if (response && typeof instance.setResult === 'function') {
        try {
          instance.setResult(effectiveResult(response));
        } catch {
          /* ignore */
        }
      }
    }
  }

  function definitionLocale() {
    const definition = extractDefinition(state.review);
    return (definition && definition.locale) || 'de';
  }

  function render() {
    if (disposed) return;
    clear(wrapper);
    state.rendererInstances.forEach((instance) => {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    state.rendererInstances.clear();

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
          h(
            'div.row.gap-2',
            h('button.btn.btn-primary', { type: 'button', on: { click: () => load() } }, t('common.retry')),
            h('a.btn.btn-secondary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
          ),
        ),
      );
      return;
    }
    renderReview();
  }

  render();
  await load();

  return () => {
    disposed = true;
    state.rendererInstances.forEach((instance) => {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch {
          /* ignore */
        }
      }
    });
    state.rendererInstances.clear();
  };
}
