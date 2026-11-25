// Teacher area "Texte": list of writing tasks (activities containing a
// `writing` item), create from a built-in template, open editor, publish,
// and jump to the monitor of a published assignment.
import { get, post, put, del, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog, emptyState, modal } from '/lib/dom.js';
import { t, getLocale, formatDateTime } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { navigate, statusBadge } from '../lib/core.js';
import { WRITING_TEMPLATES } from '/shared/writing-templates.js';

export async function mount(root, ctx) {
  ctx.setTitle(t('teacher.writing_title'));
  const wrapper = h('div.writing-view');
  clear(root);
  root.appendChild(wrapper);

  let disposed = false;
  let activities = [];
  let assignments = [];
  let loading = true;
  let loadError = null;

  ctx.onLocaleChange(() => {
    if (!disposed) render();
  });

  async function load() {
    loading = true;
    loadError = null;
    render();
    try {
      const [actData, asgData] = await Promise.all([
        get('/api/activities', { signal: ctx.signal }),
        get('/api/assignments', { signal: ctx.signal }),
      ]);
      if (disposed) return;
      const all = Array.isArray(actData && actData.activities) ? actData.activities : [];
      activities = all.filter((activity) => {
        const items = activity.definition && Array.isArray(activity.definition.items) ? activity.definition.items : [];
        return items.some((item) => item && item.type === 'writing');
      });
      assignments = Array.isArray(asgData && asgData.assignments) ? asgData.assignments : [];
      loading = false;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (disposed) return;
      loadError = error;
      loading = false;
    }
    render();
  }

  function assignmentsFor(activityId) {
    return assignments.filter((assignment) => assignment.activityId === activityId);
  }

  function openTemplateDialog() {
    const locale = getLocale() === 'en' ? 'en' : 'de';
    const cards = WRITING_TEMPLATES.map((tpl) => {
      const button = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.writing_use_template'));
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const definition = tpl.build({ title: tpl.label[locale] || tpl.label.de, locale });
          const created = await post('/api/activities', {
            title: definition.title,
            template: definition.template,
            locale: definition.locale,
          });
          const activity = created && created.activity;
          if (!activity || !activity.id) throw new Error('activity not created');
          // POST creates an empty draft — the template definition goes in via PUT.
          await put(`/api/activities/${encodeURIComponent(activity.id)}`, {
            title: definition.title,
            description: definition.description || '',
            template: definition.template,
            locale: definition.locale,
            definition,
            revision: activity.revision,
          });
          toast(t('teacher.writing_created'), 'success');
          navigate(`/teacher/edit?id=${encodeURIComponent(activity.id)}`);
        } catch (error) {
          toast(errorMessage(error), 'error');
          button.disabled = false;
        }
      });
      return h('div.card.compact.writing-template-card',
        h('h3.card-title', tpl.label[locale] || tpl.label.de),
        h('p.small.muted.mb-1', tpl.subject[locale] || tpl.subject.de),
        button,
      );
    });
    const body = h('div.writing-template-grid', cards);
    modal({ title: t('teacher.writing_new_from_template'), body, actions: [] });
  }

  function render() {
    if (disposed) return;
    clear(wrapper);
    wrapper.appendChild(
      h('div.row.between.wrap.mt-4.mb-4',
        h('div',
          h('h1.page-title', t('teacher.writing_title')),
          h('p.muted.mb-0', t('teacher.writing_subtitle')),
        ),
        h('div.row.gap-2',
          h('button.btn.btn-primary', { type: 'button', on: { click: openTemplateDialog } },
            h('span', { html: icon('sparkle', { size: 18 }) }), ' ', t('teacher.writing_new_from_template')),
        ),
      ),
    );
    if (loading) {
      wrapper.appendChild(h('div.loading-block', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', t('common.loading'))));
      return;
    }
    if (loadError) {
      wrapper.appendChild(h('div.card.error-card', h('p.muted', errorMessage(loadError))));
      return;
    }
    if (!activities.length) {
      wrapper.appendChild(emptyState(t('teacher.writing_empty'), t('teacher.writing_empty_hint')));
      return;
    }
    const list = h('div.list');
    for (const activity of activities) {
      const asgs = assignmentsFor(activity.id);
      const row = h('div.list-row.writing-row',
        h('div',
          h('div.strong', activity.title || '—'),
          h('div.small.muted', `${activity.itemCount || 0} ${t('teacher.writing_items')} · ${formatDateTime(activity.updatedAt)}`),
        ),
        statusBadge(activity.status === 'published' ? 'success' : '', activity.status === 'published' ? t('teacher.status_published') : t('teacher.status_draft')),
        h('div.row.gap-1.ml-auto',
          h('a.btn.btn-sm.btn-secondary', { href: `/teacher/edit?id=${encodeURIComponent(activity.id)}` }, t('common.edit')),
          asgs.length
            ? h('a.btn.btn-sm.btn-secondary', { href: `/teacher/writing-monitor?id=${encodeURIComponent(asgs[0].id)}` }, t('teacher.writing_monitor'))
            : null,
          h('button.btn.btn-sm.btn-ghost.text-danger', {
            type: 'button',
            title: t('common.delete'),
            on: {
              click: async () => {
                const ok = await confirmDialog({
                  title: t('teacher.writing_delete_title'),
                  message: t('teacher.writing_delete_confirm', { title: activity.title || '' }),
                  confirmLabel: t('common.delete'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await del(`/api/activities/${encodeURIComponent(activity.id)}`);
                  toast(t('teacher.deleted'), 'success');
                  load();
                } catch (error) {
                  toast(errorMessage(error), 'error');
                }
              },
            },
          }, h('span', { html: icon('trash', { size: 16 }) })),
        ),
      );
      list.appendChild(row);
    }
    wrapper.appendChild(list);
  }

  render();
  await load();
  return () => {
    disposed = true;
  };
}
