// #/assignment?id= — live classroom dashboard.
//
// Initial grid comes from GET /api/assignments/:id/live; updates stream in via
// EventSource(/api/assignments/:id/stream). SSE event shapes: see CONTRACT §5.6.
// States are never communicated by colour alone: every cell carries an icon,
// a screen-reader label and a title; a legend explains the symbols.
import { get, post, put, patch, del, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog, copyText } from '/lib/dom.js';
import { t, formatDateTime, getLocale } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { joinUrlForCode } from '../lib/core.js';
import { qrSvg } from '/lib/qr.js';

const ANON_KEY = 'ow_teacher_anonymize';
const BLUR_KEY = 'ow_teacher_blur_names';

const STATE_META = {
  unanswered: { symbol: '–', iconName: 'minus', key: 'teacher.state_unanswered', cls: 'state-unanswered' },
  correct: { symbol: '✓', iconName: 'check', key: 'teacher.state_correct', cls: 'state-correct' },
  partial: { symbol: '◐', iconName: 'partial', key: 'teacher.state_partial', cls: 'state-partial' },
  incorrect: { symbol: '✕', iconName: 'x', key: 'teacher.state_incorrect', cls: 'state-incorrect' },
  manual: { symbol: '!', iconName: 'info', key: 'teacher.state_manual', cls: 'state-manual' },
};

const STATUS_KEYS = {
  in_progress: { key: 'teacher.status_in_progress', cls: 'badge-warning' },
  submitted: { key: 'teacher.status_submitted', cls: 'badge-primary' },
  graded: { key: 'teacher.status_graded', cls: 'badge-success' },
};

function readBool(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function stateText(state) {
  const meta = STATE_META[state] || STATE_META.unanswered;
  return t(meta.key);
}

/** /live item labels are {en,de} objects; fall back to the type id. */
function liveItemLabel(item) {
  const label = item && item.label;
  if (label && typeof label === 'object') {
    return getLocale() === 'en' ? String(label.en || label.de || item.type || '') : String(label.de || label.en || item.type || '');
  }
  if (typeof label === 'string' && label) return label;
  return (item && item.type) || '';
}

function absoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  try {
    return new URL(pathOrUrl, window.location.origin).href;
  } catch {
    return String(pathOrUrl);
  }
}

function itemColumnTitle(item, index) {
  const label = liveItemLabel(item);
  const points = Number(item && item.points) || 0;
  const stem = String((item && item.stem) || '').trim();
  const shortStem = stem.length > 90 ? `${stem.slice(0, 90)} …` : stem;
  return `${index + 1}. ${label} · ${points} ${t('teacher.points_abbr')}${shortStem ? ` — ${shortStem}` : ''}`;
}

export async function mount(root, ctx) {
  const assignmentId = String(ctx.params.get('id') || '').trim();
  ctx.setTitle(t('teacher.live_title'));
  if (!assignmentId) {
    ctx.navigate('/teacher/dashboard', { replace: true });
    return () => {};
  }

  const state = {
    assignment: null,
    items: [],
    players: [],
    loading: true,
    loadError: null,
    connection: 'connecting',
    lastEventAt: null,
    anonymize: readBool(ANON_KEY, false),
    blurNames: readBool(BLUR_KEY, false),
  };

  let disposed = false;
  let eventSource = null;
  const rowNodes = new Map();
  let pseudonymMap = new Map();

  const wrapper = h('div.live-view');
  clear(root);
  root.appendChild(wrapper);

  ctx.onLocaleChange(() => {
    if (!disposed) render();
  });

  function playersById() {
    const map = new Map();
    for (const player of state.players) map.set(player.id, player);
    return map;
  }

  function refreshPseudonyms() {
    pseudonymMap = new Map();
    const sorted = [...state.players].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
    sorted.forEach((player, index) => pseudonymMap.set(player.id, t('teacher.anon_player', { n: index + 1 })));
  }

  function displayName(player) {
    if (state.anonymize) return pseudonymMap.get(player.id) || t('teacher.anon_player', { n: '?' });
    return player.name || t('teacher.unknown_name');
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  async function loadLive({ silent = false } = {}) {
    if (!silent) {
      state.loading = true;
      render();
    }
    try {
      const [liveData, detailData] = await Promise.all([
        get(`/api/assignments/${encodeURIComponent(assignmentId)}/live`, { signal: ctx.signal }),
        get(`/api/assignments/${encodeURIComponent(assignmentId)}`, { signal: ctx.signal }).catch(() => null),
      ]);
      if (disposed) return;
      applySnapshot(liveData);
      const detailAssignment = detailData && detailData.assignment;
      if (detailAssignment && state.assignment) {
        state.assignment = {
          ...state.assignment,
          dueAt: detailAssignment.dueAt || state.assignment.dueAt || null,
          activityId: (detailAssignment.activity && detailAssignment.activity.id) || state.assignment.activityId || null,
          settings: detailAssignment.settings || state.assignment.settings || null,
          url: detailAssignment.url || state.assignment.url || null,
        };
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) throw error;
      if (disposed) return;
      state.loadError = error;
    } finally {
      if (!disposed) {
        state.loading = false;
        render();
      }
    }
  }

  function applySnapshot(data) {
    if (!data) return;
    if (data.assignment) state.assignment = data.assignment;
    if (Array.isArray(data.items)) state.items = data.items;
    if (Array.isArray(data.players)) state.players = data.players;
    refreshPseudonyms();
    state.lastEventAt = new Date().toISOString();
    if (!state.loading) {
      render();
    }
  }

  function upsertPlayer(player, { rebuild = false } = {}) {
    if (!player || !player.id) return;
    const index = state.players.findIndex((entry) => entry.id === player.id);
    if (index >= 0) state.players[index] = { ...state.players[index], ...player };
    else state.players.push(player);
    refreshPseudonyms();
    if (rebuild) {
      if (boardHost) renderBoard();
      else render();
    } else {
      updatePlayerRow(player.id);
    }
    renderStats();
  }

  function setConnection(value) {
    state.connection = value;
    renderConnection();
  }

  function connectStream() {
    if (disposed) return;
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        /* ignore */
      }
      eventSource = null;
    }
    setConnection('connecting');
    try {
      eventSource = new EventSource(`/api/assignments/${encodeURIComponent(assignmentId)}/stream`);
    } catch {
      setConnection('offline');
      return;
    }
    eventSource.onopen = () => {
      if (!disposed) setConnection('live');
    };
    eventSource.onerror = () => {
      if (!disposed) setConnection('reconnecting');
    };
    eventSource.onmessage = (event) => {
      if (disposed) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      handleStreamMessage(data);
    };
  }

  function handleStreamMessage(data) {
    if (!data || !data.type) return;
    state.lastEventAt = new Date().toISOString();
    if (data.type === 'snapshot') {
      applySnapshot({ items: data.items, players: data.players });
      setConnection('live');
      return;
    }
    if (data.type === 'participant') {
      const action = data.action;
      const player = data.participant;
      if (action === 'joined') upsertPlayer(player, { rebuild: true });
      else upsertPlayer(player, { rebuild: action === 'reset' || action === 'submitted' });
      return;
    }
    if (data.type === 'response') {
      const player = state.players.find((entry) => entry.id === data.participantId);
      if (!player) return;
      if (!player.items || typeof player.items !== 'object') player.items = {};
      player.items[data.itemId] = data.state;
      if (Number.isFinite(Number(data.score))) player.score = Number(data.score);
      if (Number.isFinite(Number(data.maxScoreTotal))) player.maxScore = Number(data.maxScoreTotal);
      updatePlayerRow(player.id);
      renderHeatmap();
      renderStats();
      return;
    }
    if (data.type === 'assignment') {
      if (data.action === 'deleted') {
        toast(t('teacher.assignment_deleted'), 'warning');
        if (eventSource) eventSource.close();
        navToDashboard();
        return;
      }
      if (data.action === 'closed' || data.action === 'opened') {
        if (state.assignment) state.assignment = { ...state.assignment, status: data.action === 'closed' ? 'closed' : 'open' };
        render();
      }
      return;
    }
    if (data.type === 'ping') {
      /* keepalive */
    }
  }

  function navToDashboard() {
    ctx.navigate('/teacher/dashboard');
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function forceSubmit(player) {
    const ok = await confirmDialog({
      title: t('teacher.force_submit'),
      message: t('teacher.force_submit_confirm', { name: player.name || '' }),
      confirmLabel: t('teacher.force_submit'),
    });
    if (!ok) return;
    try {
      await post(`/api/participants/${encodeURIComponent(player.id)}/submit`);
      toast(t('teacher.submitted'), 'success');
      await loadLive({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetParticipant(player) {
    const ok = await confirmDialog({
      title: t('teacher.reset_participant'),
      message: t('teacher.reset_participant_confirm', { name: player.name || '' }),
      confirmLabel: t('teacher.reset'),
      danger: true,
    });
    if (!ok) return;
    try {
      await post(`/api/participants/${encodeURIComponent(player.id)}/reset`);
      toast(t('teacher.participant_reset'), 'success');
      await loadLive({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function deleteParticipant(player) {
    const ok = await confirmDialog({
      title: t('teacher.delete_participant'),
      message: t('teacher.delete_participant_confirm', { name: player.name || '' }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/participants/${encodeURIComponent(player.id)}`);
      state.players = state.players.filter((entry) => entry.id !== player.id);
      refreshPseudonyms();
      render();
      toast(t('teacher.deleted'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function toggleStatus() {
    if (!state.assignment) return;
    const next = state.assignment.status === 'closed' ? 'open' : 'closed';
    const ok = await confirmDialog({
      title: next === 'closed' ? t('teacher.close_assignment') : t('teacher.open_assignment'),
      message: next === 'closed' ? t('teacher.close_assignment_confirm') : t('teacher.open_assignment_confirm'),
      confirmLabel: next === 'closed' ? t('teacher.close_assignment') : t('teacher.open_assignment'),
      danger: next === 'closed',
    });
    if (!ok) return;
    try {
      await patch(`/api/assignments/${encodeURIComponent(assignmentId)}`, { status: next });
      state.assignment = { ...state.assignment, status: next };
      render();
      toast(t('common.saved'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function copyJoinLink() {
    const code = state.assignment && state.assignment.code;
    if (!code) return;
    const ok = await copyText(joinUrlForCode(code));
    toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
  }

  function setAnonymize(value) {
    state.anonymize = value;
    writeBool(ANON_KEY, value);
    if (boardHost) renderBoard();
  }

  function setBlur(value) {
    state.blurNames = value;
    writeBool(BLUR_KEY, value);
    if (boardHost) renderBoard();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function render() {
    if (disposed) return;
    clear(wrapper);
    headerHost = null;
    shareHost = null;
    statsHost = null;
    boardHost = null;
    rowNodes.clear();
    if (state.loading) {
      wrapper.appendChild(
        h('div.loading-block', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', t('common.loading'))),
      );
      return;
    }
    if (state.loadError) {
      wrapper.appendChild(
        h(
          'div.card.error-card',
          h('h2', t('teacher.load_failed')),
          h('p.muted', errorMessage(state.loadError)),
          h(
            'div.row.gap-2',
            h('button.btn.btn-primary', { type: 'button', on: { click: () => loadLive() } }, t('common.retry')),
            h('a.btn.btn-secondary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
          ),
        ),
      );
      return;
    }
    renderHeader();
    renderShare();
    renderClasses();
    renderStats();
    renderBoard();
    startStreamOnce();
  }

  let streamStarted = false;
  function startStreamOnce() {
    if (streamStarted || disposed) return;
    streamStarted = true;
    connectStream();
  }

  let headerHost = null;
  let shareHost = null;
  let statsHost = null;
  let boardHost = null;

  function renderHeader() {
    headerHost = h('div.live-header.mt-4.mb-3');
    wrapper.appendChild(headerHost);
    const assignment = state.assignment || {};
    const statusBadge = h(
      `span.badge.${assignment.status === 'open' ? 'badge-success' : 'badge-danger'}`,
      t(assignment.status === 'open' ? 'teacher.status_open' : 'teacher.status_closed'),
    );
    const back = h(
      'a.btn.btn-ghost.btn-sm',
      { href: '/teacher/dashboard' },
      h('span', { html: icon('arrow-left', { size: 16 }) }),
      h('span', t('teacher.back_to_dashboard')),
    );
    const refresh = h(
      'button.btn.btn-secondary.btn-sm',
      { type: 'button', title: t('common.retry') },
      h('span', { html: icon('refresh', { size: 16 }) }),
      h('span', t('teacher.refresh')),
    );
    refresh.addEventListener('click', () => loadLive({ silent: true }));
    const toggle = h(
      'button.btn.btn-sm',
      { type: 'button', class: assignment.status === 'open' ? 'btn-soft-danger' : 'btn-primary' },
      h('span', { html: icon(assignment.status === 'open' ? 'lock' : 'play', { size: 16 }) }),
      h('span', t(assignment.status === 'open' ? 'teacher.close_assignment' : 'teacher.open_assignment')),
    );
    toggle.addEventListener('click', toggleStatus);
    const gradeLink = h(
      'a.btn.btn-sm.btn-secondary',
      { href: `/teacher/grade?assignment=${encodeURIComponent(assignmentId)}` },
      h('span', { html: icon('clipboard', { size: 16 }) }),
      h('span', t('teacher.grade')),
    );
    const csvLink = h(
      'a.btn.btn-sm.btn-secondary',
      { href: `/api/assignments/${encodeURIComponent(assignmentId)}/export.csv`, download: '' },
      h('span', { html: icon('download', { size: 16 }) }),
      h('span', t('teacher.export_csv')),
    );
    headerHost.append(
      h(
        'div.row.between.wrap.gap-2',
        h(
          'div',
          h('div.row.gap-2.wrap', back, h('h1.page-title.mb-0', assignment.title || t('teacher.live_title')), statusBadge, h('span#connection-badge')),
        ),
        h('div.row.gap-2.wrap', refresh, gradeLink, csvLink, toggle),
      ),
    );
    renderConnection();
  }

  function renderConnection() {
    const slot = wrapper.querySelector('#connection-badge');
    if (!slot) return;
    clear(slot);
    const map = {
      live: { cls: 'badge-success', label: t('teacher.live_connected') },
      connecting: { cls: 'badge-warning', label: t('teacher.live_connecting') },
      reconnecting: { cls: 'badge-warning', label: t('teacher.live_reconnecting') },
      offline: { cls: 'badge-danger', label: t('teacher.live_offline') },
    };
    const connection = map[state.connection] || map.connecting;
    slot.className = `badge ${connection.cls}`;
    clear(slot);
    slot.append(
      h('span.dot', { class: state.connection === 'live' ? 'dot-online' : 'dot-idle', 'aria-hidden': 'true' }),
      h('span', connection.label),
    );
    if (state.connection === 'reconnecting' || state.connection === 'offline') {
      const retry = h('button.btn.btn-sm.btn-ghost', { type: 'button' }, t('teacher.reconnect'));
      retry.addEventListener('click', () => {
        streamStarted = false;
        startStreamOnce();
      });
      slot.append(' ', retry);
    }
  }

  function renderShare() {
    const assignment = state.assignment || {};
    const code = assignment.code || '—';
    const link = assignment.url ? absoluteUrl(assignment.url) : assignment.code ? joinUrlForCode(assignment.code) : '';
    shareHost = h('div.card.compact.share-card.mb-4');
    const codeEl = h('div.join-code.mono', String(code));
    const copyButton = h(
      'button.btn.btn-primary.btn-sm',
      { type: 'button' },
      h('span', { html: icon('copy', { size: 16 }) }),
      t('teacher.copy_join_link'),
    );
    copyButton.addEventListener('click', copyJoinLink);
    const printLink =
      assignment.activityId
        ? h(
            'a.btn.btn-sm.btn-secondary',
            {
              href: `/teacher/print?activity=${encodeURIComponent(assignment.activityId)}`,
              target: '_blank',
              rel: 'noopener',
            },
            h('span', { html: icon('printer', { size: 16 }) }),
            t('teacher.print_worksheet'),
          )
        : null;
    shareHost.append(
      h(
        'div.row.between.wrap.gap-3',
        h(
          'div',
          h('p.tiny.muted.mb-1', t('teacher.join_code')),
          h('div.row.gap-3.wrap', codeEl),
        ),
        h(
          'div.grow',
          h('p.tiny.muted.mb-1', t('teacher.join_link')),
          h('div.join-url', link || '—'),
        ),
        link
          ? h('div.qr-wrap', qrSvg(link, { size: 116, title: link }))
          : null,
        h('div.row.gap-2', copyButton, printLink),
      ),
    );
    if (assignment.dueAt) {
      shareHost.appendChild(h('p.small.muted.mt-2.mb-0', t('teacher.due_short', { date: formatDateTime(assignment.dueAt) })));
    }
    wrapper.appendChild(shareHost);
  }

  // --- classes card: add/remove this assignment from classes -----------------
  let classesCache = null;

  async function renderClasses() {
    const host = h('div.card.compact.mb-4');
    host.appendChild(h('h2.card-title', t('teacher.assignment_classes_title')));
    host.appendChild(h('p.card-subtitle.mb-0', t('teacher.assignment_classes_hint')));
    const listBox = h('div.row.wrap.gap-2.mt-2');
    host.appendChild(listBox);
    wrapper.appendChild(host);
    if (!classesCache) {
      listBox.appendChild(h('span.small.muted', t('common.loading')));
      try {
        const data = await get('/api/classes');
        if (disposed) return;
        classesCache = Array.isArray(data && data.classes) ? data.classes : [];
      } catch {
        if (disposed) return;
        classesCache = [];
      }
    }
    clear(listBox);
    if (classesCache.length === 0) {
      listBox.appendChild(h('span.small.muted', t('teacher.assignment_classes_empty')));
      return;
    }
    const assignmentId = state.assignment && state.assignment.id;
    for (const cls of classesCache) {
      const checkbox = h('input', { type: 'checkbox', checked: Array.isArray(cls.assignmentIds) && cls.assignmentIds.includes(assignmentId) });
      const label = h('label.checkbox-row', checkbox, h('span', { text: `${cls.name}${cls.code ? ` (${cls.code})` : ''}` }));
      checkbox.addEventListener('change', async () => {
        const want = checkbox.checked;
        const current = Array.isArray(cls.assignmentIds) ? [...cls.assignmentIds] : [];
        const next = want ? [...new Set([...current, assignmentId])] : current.filter((id) => id !== assignmentId);
        checkbox.disabled = true;
        try {
          const data = await put(`/api/classes/${encodeURIComponent(cls.id)}/items`, { assignmentIds: next });
          cls.assignmentIds = ((data && data.class && data.class.items) || []).map((item) => item.assignmentId);
          toast(want ? t('teacher.assignment_added_to_class', { name: cls.name }) : t('teacher.assignment_removed_from_class', { name: cls.name }), 'success');
        } catch (error) {
          checkbox.checked = !want;
          toast(errorMessage(error), 'error');
        } finally {
          checkbox.disabled = false;
        }
      });
      listBox.appendChild(label);
    }
  }

  function renderStats() {
    if (!statsHost) {
      statsHost = h('div.grid.grid-4.mb-4.live-stats');
      wrapper.appendChild(statsHost);
    }
    clear(statsHost);
    const players = state.players;
    const submitted = players.filter((player) => player.status === 'submitted' || player.status === 'graded').length;
    const online = players.filter((player) => player.online).length;
    const scored = players.filter((player) => Number(player.maxScore) > 0);
    const average = scored.length
      ? scored.reduce((sum, player) => sum + (Number(player.score) || 0), 0) / scored.length
      : 0;
    const cards = [
      { label: t('teacher.stat_participants'), value: String(players.length), iconName: 'users' },
      { label: t('teacher.stat_submitted'), value: String(submitted), iconName: 'checkCircle' },
      { label: t('teacher.stat_online'), value: String(online), iconName: 'users' },
      { label: t('teacher.stat_average'), value: average ? average.toFixed(1).replace('.', ',') : '0', iconName: 'chart' },
    ];
    for (const card of cards) {
      statsHost.appendChild(
        h(
          'div.card.compact.stat-card',
          h('span.stat-icon', { html: icon(card.iconName, { size: 20 }) }),
          h('div.stat', h('span.stat-value', card.value), h('span.stat-label', card.label)),
        ),
      );
    }
  }

  function renderLegend() {
    const keys = ['unanswered', 'correct', 'partial', 'incorrect', 'manual'];
    return h(
      'div.legend.no-print',
      keys.map((key) => {
        const meta = STATE_META[key];
        return h(
          'span.legend-item',
          h(`span.cell-symbol.${meta.cls}`, { 'aria-hidden': 'true' }, meta.symbol),
          h('span.small.muted', t(meta.key)),
        );
      }),
    );
  }

  function renderBoard() {
    if (!boardHost) {
      boardHost = h('div.card.compact.live-board');
      wrapper.appendChild(boardHost);
    }
    clear(boardHost);
    const assignment = state.assignment || {};
    const toggles = h(
      'div.board-toggles.no-print',
      (() => {
        const label = h('label.switch', h('input', {
          type: 'checkbox',
          checked: state.anonymize,
          on: {
            change: (event) => setAnonymize(event.target.checked),
          },
        }), h('span.track', { 'aria-hidden': 'true' }), h('span.small', t('teacher.anonymize_names')));
        return label;
      })(),
      (() => {
        const label = h('label.switch', h('input', {
          type: 'checkbox',
          checked: state.blurNames,
          on: {
            change: (event) => setBlur(event.target.checked),
          },
        }), h('span.track', { 'aria-hidden': 'true' }), h('span.small', t('teacher.blur_names')));
        return label;
      })(),
    );
    boardHost.appendChild(
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.live_grid')), h('p.card-subtitle', t('teacher.live_grid_hint'))),
        toggles,
      ),
    );
    boardHost.appendChild(renderLegend());

    if (state.players.length === 0) {
      boardHost.appendChild(
        h(
          'div.empty.live-empty',
          h('p.empty-title', t('teacher.no_participants')),
          h('p.empty-hint.small.muted', t('teacher.no_participants_hint')),
          h(
            'button.btn.btn-primary.mt-3',
            { type: 'button', on: { click: copyJoinLink } },
            h('span', { html: icon('copy', { size: 16 }) }),
            t('teacher.copy_join_link'),
          ),
        ),
      );
      return;
    }

    const table = h('table.table.live-table');
    const thead = h(
      'thead',
      h(
        'tr',
        h('th.col-name', t('teacher.col_student')),
        h('th.col-status', t('common.status')),
        h('th.col-scores', t('common.score')),
        state.items.map((item, index) =>
          h(
            'th.item-col',
            { title: itemColumnTitle(item, index) },
            h('span.item-col-index', String(index + 1)),
            h('span.item-col-points', String(item.points)),
          ),
        ),
        h('th.col-actions.no-print', t('common.actions')),
      ),
    );
    const tbody = h('tbody');
    const tfoot = h('tfoot');
    table.append(thead, tbody, tfoot);
    const tableWrap = h('div.table-wrap.live-table-wrap', table);
    boardHost.appendChild(tableWrap);

    rowNodes.clear();
    for (const player of state.players) {
      const row = buildPlayerRow(player);
      rowNodes.set(player.id, row);
      tbody.appendChild(row);
    }
    buildHeatmapRow(tfoot);
  }

  function buildPlayerRow(player) {
    const name = displayName(player);
    const nameText = h(
      `span.player-name${state.blurNames ? '.is-blurred' : ''}`,
      { title: state.anonymize ? t('teacher.anonymized_hint') : player.name },
      name,
    );
    const presence = h('span.dot', {
      class: player.online ? 'dot-online' : player.status === 'submitted' || player.status === 'graded' ? 'dot-idle' : 'dot-offline',
      title: player.online ? t('common.online') : t('common.offline'),
      'aria-hidden': 'true',
    });
    const flagCount = Array.isArray(player.flags) ? player.flags.length : 0;
    const nameCell = h(
      'td.col-name',
      h(
        'div.row.gap-2',
        presence,
        h('a.player-link', { href: `/teacher/grade?assignment=${encodeURIComponent(assignmentId)}&participant=${encodeURIComponent(player.id)}` }, nameText),
        flagCount ? h('span.player-flags', { title: t('teacher.starred_count', { n: flagCount }) }, h('span', { html: icon('star', { size: 14 }) })) : null,
      ),
    );
    const statusMeta = STATUS_KEYS[player.status] || STATUS_KEYS.in_progress;
    const statusCell = h('td.col-status', h(`span.badge.${statusMeta.cls}`, t(statusMeta.key)));
    const scoreCell = h(
      'td.col-scores.nowrap',
      h('span.strong', String(Math.round((Number(player.score) || 0) * 10) / 10)),
      ' / ',
      String(Math.round((Number(player.maxScore) || 0) * 10) / 10),
    );
    const cells = state.items.map((item) => buildStateCell(player, item));
    const actionsCell = h(
      'td.col-actions.no-print',
      h(
        'div.row.gap-1',
        iconAction('checkCircle', t('teacher.force_submit'), () => forceSubmit(player)),
        iconAction('refresh', t('teacher.reset'), () => resetParticipant(player), 'text-warning'),
        iconAction('trash', t('common.delete'), () => deleteParticipant(player), 'text-danger'),
      ),
    );
    return h('tr.player-row', { 'data-player-id': player.id }, nameCell, statusCell, scoreCell, ...cells, actionsCell);
  }

  function buildStateCell(player, item) {
    const stateValue = (player.items && player.items[item.id]) || 'unanswered';
    const meta = STATE_META[stateValue] || STATE_META.unanswered;
    const label = t('teacher.item_state_label', { n: stateText(stateValue) });
    return h(
      `td.item-cell.${meta.cls}`,
      { title: `${stateText(stateValue)} — ${liveItemLabel(item)}`, 'aria-label': stateText(stateValue) },
      h('span.cell-symbol', { 'aria-hidden': 'true' }, meta.symbol),
      h('span.sr-only', label),
    );
  }

  function iconAction(iconName, label, onClick, extraClass = '') {
    const button = h(
      'button.btn.btn-icon.btn-sm.btn-ghost',
      { type: 'button', title: label, 'aria-label': label },
      h('span', { html: icon(iconName, { size: 16 }) }),
    );
    if (extraClass) button.classList.add(extraClass);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function updatePlayerRow(playerId) {
    if (!boardHost) return;
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) return;
    const oldRow = rowNodes.get(playerId);
    const newRow = buildPlayerRow(player);
    if (oldRow && oldRow.parentNode) oldRow.replaceWith(newRow);
    else if (boardHost) {
      const tbody = boardHost.querySelector('tbody');
      if (tbody) tbody.appendChild(newRow);
    }
    rowNodes.set(playerId, newRow);
  }

  function itemCorrectCounts() {
    const correct = new Map();
    const answered = new Map();
    for (const item of state.items) {
      let correctCount = 0;
      let answeredCount = 0;
      for (const player of state.players) {
        const value = (player.items && player.items[item.id]) || 'unanswered';
        if (value !== 'unanswered') answeredCount += 1;
        if (value === 'correct') correctCount += 1;
      }
      correct.set(item.id, correctCount);
      answered.set(item.id, answeredCount);
    }
    return { correct, answered };
  }

  function buildHeatmapRow(tfoot) {
    clear(tfoot);
    const { correct, answered } = itemCorrectCounts();
    const total = state.players.length;
    const cells = state.items.map((item) => {
      const correctCount = correct.get(item.id) || 0;
      const answeredCount = answered.get(item.id) || 0;
      const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
      const level = percent >= 75 ? 'heat-high' : percent >= 40 ? 'heat-mid' : 'heat-low';
      return h(
        `td.item-cell.heatmap-cell.${level}`,
        { title: t('teacher.heatmap_title', { correct: correctCount, answered: answeredCount, total }) },
        h('span.heatmap-value', `${percent} %`),
      );
    });
    tfoot.appendChild(
      h(
        'tr.heatmap-row',
        h('td.col-name.small.strong', t('teacher.heatmap')),
        h('td.col-status'),
        h('td.col-scores'),
        ...cells,
        h('td.col-actions.no-print'),
      ),
    );
  }

  function renderHeatmap() {
    if (!boardHost) return;
    const tfoot = boardHost.querySelector('tfoot');
    if (tfoot) buildHeatmapRow(tfoot);
  }

  // -------------------------------------------------------------------------
  // Boot / cleanup
  // -------------------------------------------------------------------------
  render();
  await loadLive();

  return () => {
    disposed = true;
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        /* ignore */
      }
      eventSource = null;
    }
  };
}
