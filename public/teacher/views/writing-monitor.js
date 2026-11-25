// Teacher monitor for a live writing assignment: per participant — draft
// snippet, loop count, latest criteria feedback with progress bars.
import { get, errorMessage } from '/lib/api.js';
import { h, clear, toast } from '/lib/dom.js';
import { t, formatDateTime } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';

export async function mount(root, ctx) {
  ctx.setTitle(t('teacher.writing_monitor_title'));
  const assignmentId = ctx.params.get('id');
  const wrapper = h('div.writing-monitor-view');
  clear(root);
  root.appendChild(wrapper);
  if (!assignmentId) {
    wrapper.appendChild(h('div.card.error-card', h('p', t('teacher.writing_monitor_missing'))));
    return () => {};
  }

  let disposed = false;
  let timer = null;

  ctx.onLocaleChange(() => {
    if (!disposed) load();
  });

  async function load() {
    try {
      const data = await get(`/api/writing/monitor/${encodeURIComponent(assignmentId)}`, { signal: ctx.signal });
      if (disposed) return;
      render(data);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (disposed) return;
      clear(wrapper);
      wrapper.appendChild(h('div.card.error-card',
        h('p.muted', errorMessage(error)),
        h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: load } }, t('common.retry')),
      ));
    }
  }

  function render(data) {
    if (disposed) return;
    clear(wrapper);
    const participants = data.participants || [];
    wrapper.appendChild(
      h('div.row.between.wrap.mt-4.mb-4',
        h('div',
          h('h1.page-title', t('teacher.writing_monitor_title')),
          h('p.muted.mb-0', `${data.activityTitle || ''} · ${data.assignment ? `${t('teacher.code')}: ${data.assignment.code}` : ''} · ${participants.length} ${t('teacher.writing_participants')}`),
        ),
        h('button.btn.btn-secondary.btn-sm', { type: 'button', on: { click: load } }, h('span', { html: icon('refresh', { size: 16 }) }), ' ', t('teacher.refresh')),
      ),
    );
    if (!participants.length) {
      wrapper.appendChild(h('div.card', h('p.help', t('teacher.writing_monitor_empty'))));
      return;
    }
    for (const participant of participants) {
      const card = h('div.card.compact.mb-2.writing-monitor-card');
      card.appendChild(h('div.row.between.wrap',
        h('div',
          h('span.strong', participant.name || '—'),
          h('span.badge.tiny.ml-2', { class: participant.status === 'submitted' ? 'badge-success' : 'badge-info', text: participant.status }),
        ),
        h('span.tiny.muted', participant.lastSeenAt ? formatDateTime(participant.lastSeenAt) : ''),
      ));
      for (const item of participant.items || []) {
        const box = h('div.writing-monitor-item.mt-2');
        box.appendChild(h('div.row.between.wrap',
          h('span.small.strong', item.stem || item.itemId),
          h('span.tiny.muted', t('teacher.writing_loops', { n: item.loopCount }) + (item.draftWords ? ` · ${item.draftWords} Wörter` : '')),
        ));
        if (item.draft) box.appendChild(h('p.small.muted.writing-draft', { text: item.draft + (item.draft.length >= 400 ? ' …' : '') }));
        const latest = item.latestFeedback;
        if (latest) {
          if (latest.summary) box.appendChild(h('p.small', { text: latest.summary }));
          if (Array.isArray(latest.criteria)) {
            for (const criterion of latest.criteria) {
              const pct = Math.max(0, Math.min(1, Number(criterion.met) || 0)) * 100;
              const row = h('div.writing-monitor-criterion');
              row.appendChild(h('div.row.between', h('span.tiny', { text: criterion.label }), h('span.tiny.muted', { text: `${Math.round(pct)} %` })));
              const bar = h('div.progress.progress-sm', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) });
              const fill = h('span');
              fill.style.width = `${pct.toFixed(1)}%`;
              bar.appendChild(fill);
              row.appendChild(bar);
              box.appendChild(row);
            }
          }
        } else {
          box.appendChild(h('p.tiny.muted', { text: t('teacher.writing_no_feedback_yet') }));
        }
        card.appendChild(box);
      }
      wrapper.appendChild(card);
    }
  }

  load();
  timer = setInterval(() => {
    if (!disposed) load();
  }, 15000);
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
  };
}
