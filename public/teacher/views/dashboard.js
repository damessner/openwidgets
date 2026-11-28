// #/dashboard — my activities and my assignments.
import { get, post, del, api, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog, emptyState, copyText } from '/lib/dom.js';
import { t, formatDateTime } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { joinUrlForCode, downloadResponse, navigate, templateLabel, statusBadge } from '../lib/core.js';
import { openCreateActivityDialog, openPublishDialog } from '../lib/dialogs.js';
import { openAiWizard } from '../lib/ai-wizard.js';

function iconButton(iconName, label, { kind = 'ghost', onClick, href, extraClass = '' } = {}) {
  const content = h('span', { html: icon(iconName, { size: 16 }) });
  const props = { title: label, 'aria-label': label, class: `btn btn-sm btn-${kind} btn-icon ${extraClass}`.trim() };
  if (href) return h('a', { ...props, href }, content);
  return h('button', { ...props, type: 'button', on: { click: onClick } }, content);
}

function actionRow(...children) {
  return h('div.row.gap-1', ...children);
}

function templateBadge(template) {
  return h(`span.badge.${template === 'quiz' ? 'badge-primary' : 'badge-info'}`, templateLabel(template));
}

export async function mount(root, ctx) {
  let disposed = false;
  ctx.setTitle(t('teacher.nav_dashboard'));

  const wrapper = h('div.dashboard-view');
  clear(root);
  root.appendChild(wrapper);

  const contentHost = h('div');
  wrapper.appendChild(contentHost);

  let activities = [];
  let assignments = [];
  let loading = true;
  let loadError = null;
  let llmEnabled = false;

  ctx.onLocaleChange(() => {
    if (!disposed) renderContent();
  });

  async function load({ silent = false } = {}) {
    if (!silent) {
      loading = true;
      loadError = null;
      renderContent();
    }
    try {
      const [activitiesData, assignmentsData, llmConfig] = await Promise.all([
        get('/api/activities', { signal: ctx.signal }),
        get('/api/assignments', { signal: ctx.signal }),
        get('/api/llm/config', { signal: ctx.signal }).catch(() => null),
      ]);
      if (disposed) return;
      activities = Array.isArray(activitiesData && activitiesData.activities) ? activitiesData.activities : [];
      assignments = Array.isArray(assignmentsData && assignmentsData.assignments) ? assignmentsData.assignments : [];
      llmEnabled = !!(llmConfig && llmConfig.enabled);
      loadError = null;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.status === 401) throw error;
      if (disposed) return;
      loadError = error;
    } finally {
      if (!disposed) {
        loading = false;
        renderContent();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function createActivity() {
    const activity = await openCreateActivityDialog();
    if (activity && activity.id) navigate(`/teacher/edit?id=${encodeURIComponent(activity.id)}`);
  }

  async function createWithAi() {
    const activity = await openAiWizard();
    if (activity && activity.id) load({ silent: true });
  }

  async function importActivity(file) {
    if (!file) return;
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch {
      toast(t('teacher.import_invalid_json'), 'error');
      return;
    }
    try {
      const data = await post('/api/activities/import', payload);
      const activity = data && data.activity;
      toast(t('teacher.import_success'), 'success');
      if (activity && activity.id) navigate(`/teacher/edit?id=${encodeURIComponent(activity.id)}`);
      else await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function duplicateActivity(activity) {
    try {
      const data = await post(`/api/activities/${encodeURIComponent(activity.id)}/duplicate`);
      toast(t('teacher.duplicated'), 'success');
      await load({ silent: true });
      const copy = data && data.activity;
      if (copy && copy.id) toast(t('teacher.duplicate_open_hint'), 'info');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function deleteActivity(activity) {
    const confirmed = await confirmDialog({
      title: t('teacher.delete_activity'),
      message: t('teacher.delete_activity_confirm', { title: activity.title }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await del(`/api/activities/${encodeURIComponent(activity.id)}`);
      toast(t('teacher.deleted'), 'success');
      await load({ silent: true });
    } catch (error) {
      if (error && error.code === 'has_assignments') {
        const force = await confirmDialog({
          title: t('teacher.delete_activity'),
          message: t('teacher.delete_activity_force'),
          confirmLabel: t('teacher.delete_anyway'),
          danger: true,
        });
        if (!force) return;
        try {
          await del(`/api/activities/${encodeURIComponent(activity.id)}?force=1`);
          toast(t('teacher.deleted'), 'success');
          await load({ silent: true });
        } catch (forceError) {
          toast(errorMessage(forceError), 'error');
        }
        return;
      }
      toast(errorMessage(error), 'error');
    }
  }

  async function exportActivity(activity) {
    try {
      const response = await api(`/api/activities/${encodeURIComponent(activity.id)}/export`, { raw: true });
      if (!response.ok) {
        let code = 'http_error';
        try {
          const data = await response.json();
          code = (data && data.error && data.error.code) || code;
        } catch {
          /* ignore */
        }
        toast(t('errors.unknown'), 'error');
        void code;
        return;
      }
      const slug = String(activity.title || 'activity')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      await downloadResponse(response, `openwidgets-${slug || 'activity'}.json`);
      toast(t('teacher.exported'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function publishActivity(activity) {
    const assignment = await openPublishDialog({
      activityId: activity.id,
      defaultTitle: activity.title,
      onPublished: () => {
        load({ silent: true });
      },
    });
    if (assignment) await load({ silent: true });
  }

  async function toggleAssignmentStatus(assignment) {
    const nextStatus = assignment.status === 'open' ? 'closed' : 'open';
    const confirmed = await confirmDialog({
      title: nextStatus === 'closed' ? t('teacher.close_assignment') : t('teacher.open_assignment'),
      message: nextStatus === 'closed' ? t('teacher.close_assignment_confirm') : t('teacher.open_assignment_confirm'),
      confirmLabel: nextStatus === 'closed' ? t('teacher.close_assignment') : t('teacher.open_assignment'),
      danger: nextStatus === 'closed',
    });
    if (!confirmed) return;
    try {
      await api(`/api/assignments/${encodeURIComponent(assignment.id)}`, { method: 'PATCH', body: { status: nextStatus } });
      toast(t('teacher.saved'), 'success');
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function deleteAssignment(assignment) {
    const confirmed = await confirmDialog({
      title: t('teacher.delete_assignment'),
      message: t('teacher.delete_assignment_confirm', { title: assignment.title }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await del(`/api/assignments/${encodeURIComponent(assignment.id)}`);
      toast(t('teacher.deleted'), 'success');
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function copyJoinLink(assignment) {
    const ok = await copyText(joinUrlForCode(assignment.code));
    toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderStats() {
    const participants = assignments.reduce((sum, assignment) => sum + (Number(assignment.participantCount) || 0), 0);
    const openAssignments = assignments.filter((assignment) => assignment.status === 'open').length;
    const cards = [
      { label: t('teacher.stat_activities'), value: activities.length, iconName: 'book' },
      { label: t('teacher.stat_assignments'), value: assignments.length, iconName: 'play' },
      { label: t('teacher.stat_open'), value: openAssignments, iconName: 'users' },
      { label: t('teacher.stat_participants'), value: participants, iconName: 'users' },
    ];
    return h(
      'div.grid.grid-4.mb-4.kpi-grid',
      cards.map((card) =>
        h(
          'div.card.compact.stat-card.kpi-card',
          h('div.stat', h('span.stat-label.kpi-label', card.label), h('span.stat-value.kpi-value', String(card.value))),
          h('span.stat-icon.icon-tile', { html: icon(card.iconName, { size: 20 }) }),
        ),
      ),
    );
  }

  function activityRow(activity) {
    return h(
      'tr',
      h(
        'td',
        h('div.strong', activity.title || t('common.empty')),
        h('div.row.gap-2.mt-1', templateBadge(activity.template), h('span.small.muted', t('teacher.item_count', { n: activity.itemCount ?? 0 }))),
      ),
      h('td', statusBadge(activity.status === 'published' ? 'published' : 'draft', t(activity.status === 'published' ? 'teacher.status_published' : 'teacher.status_draft'))),
      h('td.num', String(activity.maxScore ?? 0)),
      h('td.nowrap.small.muted', formatDateTime(activity.updatedAt) || '—'),
      h(
        'td',
        actionRow(
          iconButton('edit', t('common.edit'), {
            kind: 'secondary',
            onClick: () => navigate(`/teacher/edit?id=${encodeURIComponent(activity.id)}`),
          }),
          iconButton('play', t('teacher.publish_activity'), { kind: 'secondary', onClick: () => publishActivity(activity) }),
          iconButton('printer', t('teacher.print_worksheet'), {
            onClick: () => window.open(`/teacher/print?activity=${encodeURIComponent(activity.id)}`, '_blank'),
          }),
          iconButton('copy', t('teacher.duplicate'), { onClick: () => duplicateActivity(activity) }),
          iconButton('download', t('teacher.export'), { onClick: () => exportActivity(activity) }),
          iconButton('trash', t('common.delete'), { kind: 'soft-danger', onClick: () => deleteActivity(activity) }),
        ),
      ),
    );
  }

  function assignmentRow(assignment) {
    const pc = Number(assignment.participantCount) || 0;
    const sc = Number(assignment.submittedCount) || 0;
    const pct = pc > 0 ? Math.round((sc / pc) * 100) : 0;
    return h(
      'tr',
      h(
        'td',
        h('div.strong', assignment.title || t('common.empty')),
        h('div.small.muted', assignment.activityTitle || ''),
      ),
      h(
        'td',
        h(
          'button.code-chip.pin-chip',
          { type: 'button', title: t('teacher.copy_join_link'), on: { click: () => copyJoinLink(assignment) } },
          h('span.mono', assignment.code || '—'),
          h('span', { html: icon('copy', { size: 13 }) }),
        ),
      ),
      h('td', { style: 'min-width: 180px' },
        h('div.row.gap-2', { style: 'align-items: center' },
          h('div.progress.sm', {
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-valuenow': String(pct),
            style: 'flex: 1 1 auto',
          }, h('span', { style: `width:${pct}%` })),
          h('span.small.muted', { style: 'font-variant-numeric: tabular-nums; white-space: nowrap' }, `${pct}%`),
        ),
        h('div.small.muted', t('teacher.submitted_of', { submitted: sc, total: pc })),
      ),
      h(
        'td',
        statusBadge(assignment.status === 'open' ? 'open' : 'closed', t(assignment.status === 'open' ? 'teacher.status_open' : 'teacher.status_closed')),
        assignment.dueAt ? h('div.small.muted', t('teacher.due_short', { date: formatDateTime(assignment.dueAt) })) : null,
      ),
      h('td.num', String(assignment.participantCount ?? 0)),
      h('td.nowrap.small.muted', formatDateTime(assignment.createdAt) || '—'),
      h(
        'td',
        actionRow(
          iconButton('chart', t('teacher.open_live'), {
            kind: 'secondary',
            onClick: () => navigate(`/teacher/assignment?id=${encodeURIComponent(assignment.id)}`),
          }),
          iconButton('link', t('teacher.copy_join_link'), { onClick: () => copyJoinLink(assignment) }),
          iconButton('clipboard', t('teacher.grade'), {
            onClick: () => navigate(`/teacher/grade?assignment=${encodeURIComponent(assignment.id)}`),
          }),
          h(
            'a.btn.btn-sm.btn-ghost.btn-icon',
            { href: `/api/assignments/${encodeURIComponent(assignment.id)}/export.csv`, download: '', title: t('teacher.export_csv'), 'aria-label': t('teacher.export_csv') },
            h('span', { html: icon('download', { size: 16 }) }),
          ),
          iconButton(assignment.status === 'open' ? 'lock' : 'play', assignment.status === 'open' ? t('teacher.close_assignment') : t('teacher.open_assignment'), {
            onClick: () => toggleAssignmentStatus(assignment),
          }),
          iconButton('trash', t('common.delete'), { kind: 'soft-danger', onClick: () => deleteAssignment(assignment) }),
        ),
      ),
    );
  }

  function renderActivitiesCard() {
    const card = h('div.card.compact.mb-4');
    card.appendChild(
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.my_activities')), h('p.card-subtitle', t('teacher.my_activities_hint'))),
      ),
    );
    if (activities.length === 0) {
      card.appendChild(
        emptyState(
          t('teacher.no_activities'),
          t('teacher.no_activities_hint'),
        ),
      );
    } else {
      card.appendChild(
        h(
          'div.table-wrap',
          h(
            'table.table',
            h(
              'thead',
              h(
                'tr',
                h('th', t('teacher.col_activity')),
                h('th', t('common.status')),
                h('th.num', t('teacher.col_points')),
                h('th', t('teacher.col_updated')),
                h('th', t('common.actions')),
              ),
            ),
            h('tbody', activities.map(activityRow)),
          ),
        ),
      );
    }
    return card;
  }

  function renderAssignmentsCard() {
    const card = h('div.card.compact');
    card.appendChild(
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.my_assignments')), h('p.card-subtitle', t('teacher.my_assignments_hint'))),
      ),
    );
    if (assignments.length === 0) {
      card.appendChild(emptyState(t('teacher.no_assignments'), t('teacher.no_assignments_hint')));
    } else {
      card.appendChild(
        h(
          'div.table-wrap',
          h(
            'table.table.data-table',
            h(
              'thead',
              h(
                'tr',
                h('th', t('teacher.col_assignment')),
                h('th', t('teacher.code')),
                h('th', t('teacher.col_progress')),
                h('th', t('common.status')),
                h('th.num', t('common.students')),
                h('th', t('teacher.col_created')),
                h('th', t('common.actions')),
              ),
            ),
            h('tbody', assignments.map(assignmentRow)),
          ),
        ),
      );
    }
    return card;
  }

  function renderContent() {
    clear(contentHost);
    if (loading) {
      contentHost.appendChild(
        h('div.loading-block', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', t('common.loading'))),
      );
      return;
    }
    contentHost.appendChild(
      h(
        'div.row.between.wrap.mt-4.mb-4',
        h(
          'div',
          h('h1.page-title', t('teacher.dashboard_title')),
          h('p.muted.mb-0', t('teacher.dashboard_subtitle')),
        ),
        h(
          'div.row.gap-2',
          llmEnabled
            ? h(
                'button.btn.btn-secondary.ai-wizard-button',
                { type: 'button', on: { click: createWithAi } },
                h('span', { html: icon('sparkle', { size: 18 }) }),
                t('teacher.ai_wizard_button'),
              )
            : null,
          h(
            'button.btn.btn-secondary',
            { type: 'button', on: { click: () => triggerImport() } },
            h('span', { html: icon('upload', { size: 18 }) }),
            t('teacher.import'),
          ),
          h(
            'button.btn.btn-primary',
            { type: 'button', on: { click: createActivity } },
            h('span', { html: icon('plus', { size: 18 }) }),
            t('teacher.create_activity'),
          ),
        ),
      ),
    );
    if (loadError) {
      contentHost.appendChild(
        h(
          'div.card.compact.error-card',
          h('h2', t('common.error')),
          h('p.muted', errorMessage(loadError)),
          h(
            'button.btn.btn-primary',
            { type: 'button', on: { click: () => load() } },
            t('common.retry'),
          ),
        ),
      );
      return;
    }
    contentHost.appendChild(renderStats());
    contentHost.appendChild(renderActivitiesCard());
    contentHost.appendChild(renderAssignmentsCard());
  }

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) importActivity(file);
  });
  wrapper.appendChild(fileInput);

  function triggerImport() {
    fileInput.click();
  }

  renderContent();
  await load();

  return () => {
    disposed = true;
  };
}
