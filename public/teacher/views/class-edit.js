// Teacher view: edit one class — settings (name/order mode/unlock threshold),
// ordered assignment items, publish (join code + link).
import { get, post, put, errorMessage } from '/lib/api.js';
import { h, qs, clear, toast, copyText } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { navigate, statusBadge, templateLabel } from '../lib/core.js';

function classUrl(code) {
  return `${window.location.origin}/c/${encodeURIComponent(String(code || '').toUpperCase())}`;
}

export async function mount(root, ctx) {
  let disposed = false;
  const classId = ctx.params.get('id');
  if (!classId) {
    navigate('/teacher/classes', { replace: true });
    return;
  }

  const wrapper = h('div.class-edit-view');
  clear(root);
  root.appendChild(wrapper);
  const host = h('div');
  wrapper.appendChild(host);

  let cls = null;
  let assignments = [];
  // Local working copy of ordered assignment ids (persisted via PUT items).
  let itemIds = [];

  ctx.onLocaleChange(() => { if (!disposed) renderAll(); });

  async function load() {
    const [classData, assignmentsData] = await Promise.all([
      get(`/api/classes/${encodeURIComponent(classId)}`, { signal: ctx.signal }),
      get('/api/assignments', { signal: ctx.signal }),
    ]);
    if (disposed) return;
    cls = classData.class;
    assignments = Array.isArray(assignmentsData.assignments) ? assignmentsData.assignments : [];
    itemIds = (cls.items || []).map((item) => item.assignmentId);
    ctx.setTitle(cls.name || t('teacher.edit_class'));
    renderAll();
  }

  async function saveSettings() {
    const name = qs('#class-name', host)?.value.trim();
    const description = qs('#class-description', host)?.value.trim() ?? '';
    const percent = Number(qs('#class-percent', host)?.value) || 0;
    const orderMode = host.querySelector('.segmented button.is-active')?.dataset.mode || 'free';
    try {
      const data = await put(`/api/classes/${encodeURIComponent(classId)}`, { name, description, orderMode, unlockMinPercent: percent });
      cls = data.class;
      itemIds = (cls.items || []).map((item) => item.assignmentId);
      toast(t('teacher.class_saved'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function saveItems() {
    try {
      const data = await put(`/api/classes/${encodeURIComponent(classId)}/items`, { assignmentIds: itemIds });
      cls = data.class;
      itemIds = (cls.items || []).map((item) => item.assignmentId);
      toast(t('teacher.items_saved'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function move(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= itemIds.length) return;
    const copy = [...itemIds];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    itemIds = copy;
    saveItems();
  }

  async function publish() {
    try {
      await post(`/api/classes/${encodeURIComponent(classId)}/publish`);
      toast(t('teacher.class_published'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function unpublish() {
    try {
      await post(`/api/classes/${encodeURIComponent(classId)}/unpublish`);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function removeItem(assignmentId) {
    itemIds = itemIds.filter((id) => id !== assignmentId);
    await saveItems();
  }

  function renderAll() {
    if (!cls) return;
    clear(host);
    host.appendChild(
      h('div.row.gap-2.mb-4',
        h('a.btn.btn-ghost.btn-sm', { href: '/teacher/classes' }, h('span', { html: icon('arrow-left', { size: 16 }) }), ' ', t('teacher.back_to_classes')),
        h('h1.page-title.grow', { text: cls.name }),
        statusBadge(cls.status, t(cls.status === 'published' ? 'teacher.class_status_published' : 'teacher.class_status_draft')),
        cls.status === 'published'
          ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: unpublish } }, t('teacher.unpublish_class'))
          : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: publish } }, t('teacher.publish_class')),
      ),
    );

    if (cls.status === 'published' && cls.code) {
      const url = classUrl(cls.code);
      host.appendChild(
        h('div.card.compact.mb-4',
          h('div.row.between.wrap.gap-3',
            h('div',
              h('div.strong', t('teacher.class_join_link')),
              h('div.row.gap-2.mt-1',
                h('span.code-chip', h('span.mono', { text: cls.code })),
                h('a.mono.small', { href: url, target: '_blank', rel: 'noopener', text: url }),
              ),
            ),
            h('button.btn.btn-secondary.btn-sm', { type: 'button', on: { click: async () => {
              const ok = await copyText(url);
              toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
            } } }, h('span', { html: icon('copy', { size: 15 }) }), ' ', t('teacher.copy_link')),
          ),
        ),
      );
    }

    // --- settings card ------------------------------------------------------
    let orderMode = cls.orderMode || 'free';
    const segmented = h('div.segmented', { role: 'group', 'aria-label': t('teacher.class_order_mode') });
    const freeBtn = h('button', { type: 'button', 'data-mode': 'free' }, t('teacher.order_free'));
    const seqBtn = h('button', { type: 'button', 'data-mode': 'sequence' }, t('teacher.order_sequence'));
    const help = h('p.help', { text: t(orderMode === 'sequence' ? 'teacher.order_sequence_help' : 'teacher.order_free_help') });
    const syncSegmented = () => {
      freeBtn.classList.toggle('is-active', orderMode === 'free');
      seqBtn.classList.toggle('is-active', orderMode === 'sequence');
      help.textContent = t(orderMode === 'sequence' ? 'teacher.order_sequence_help' : 'teacher.order_free_help');
    };
    freeBtn.addEventListener('click', () => { orderMode = 'free'; syncSegmented(); });
    seqBtn.addEventListener('click', () => { orderMode = 'sequence'; syncSegmented(); });
    segmented.append(freeBtn, seqBtn);
    syncSegmented();

    const settingsCard = h('div.card.mb-4',
      h('h2.card-title', t('teacher.edit_class')),
      h('div.grid.grid-2',
        h('div.field', h('label.label', { for: 'class-name' }, t('teacher.class_name')), h('input.input#class-name', { type: 'text', maxlength: 120, value: cls.name })),
        h('div.field', h('label.label', { for: 'class-percent' }, t('teacher.unlock_min_percent')), h('input.input#class-percent', { type: 'number', min: '0', max: '100', step: '5', value: String(cls.unlockMinPercent || 0), style: 'max-width:120px' })),
      ),
      h('div.field', h('label.label', { for: 'class-description' }, t('teacher.class_description')), h('textarea.textarea#class-description', { maxlength: 2000, rows: 3 }, cls.description || '')),
      h('div.field', h('label.label', { for: 'class-mode' }, t('teacher.class_order_mode')), segmented, help),
      h('div.row.end', h('button.btn.btn-primary', { type: 'button', on: { click: saveSettings } }, t('common.save'))),
    );
    host.appendChild(settingsCard);

    // --- items card ---------------------------------------------------------
    const itemsCard = h('div.card');
    itemsCard.appendChild(h('h2.card-title', t('teacher.class_items')));
    itemsCard.appendChild(h('p.card-subtitle', t('teacher.class_items_hint')));

    const byId = new Map(assignments.map((a) => [a.id, a]));
    const list = h('ul.item-order-list.class-item-list');
    itemIds.forEach((assignmentId, index) => {
      const a = byId.get(assignmentId);
      const row = h('li.item-order-row.class-item-row',
        h('span.item-order-number', { text: String(index + 1) }),
        h('div.grow.min-w-0',
          h('div.strong.truncate', { text: a ? a.title : assignmentId }),
          h('div.small.muted.row.gap-2',
            a ? h('span.badge', { text: templateLabel(a.template) }) : null,
            a ? statusBadge(a.status, t(a.status === 'open' ? 'teacher.status_open' : 'teacher.status_closed')) : null,
            a ? h('span', { text: t('teacher.class_participants', { n: a.participantCount || 0 }) }) : null,
          ),
        ),
        h('div.item-order-controls',
          h('button.btn.btn-ghost.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.move_up'), 'aria-label': t('teacher.move_up'), disabled: index === 0, on: { click: () => move(index, -1) } }, h('span', { html: icon('chevron-up', { size: 16 }) })),
          h('button.btn.btn-ghost.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.move_down'), 'aria-label': t('teacher.move_down'), disabled: index === itemIds.length - 1, on: { click: () => move(index, 1) } }, h('span', { html: icon('chevron-down', { size: 16 }) })),
          h('button.btn.btn-soft-danger.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.remove_item'), 'aria-label': t('teacher.remove_item'), on: { click: () => removeItem(assignmentId) } }, h('span', { html: icon('trash', { size: 15 }) })),
        ),
      );
      list.appendChild(row);
    });
    if (itemIds.length === 0) {
      list.appendChild(h('li.empty-inline.small.muted', { text: t('teacher.classes_empty_hint') }));
    }
    itemsCard.appendChild(list);

    const available = assignments.filter((a) => !itemIds.includes(a.id));
    const select = h('select.select', { style: 'min-width:220px' },
      ...available.map((a) => h('option', { value: a.id }, `${a.title} (${a.code})`)),
    );
    itemsCard.appendChild(
      h('div.row.gap-2.mt-3.wrap',
        available.length > 0
          ? h('div.row.gap-2', select, h('button.btn.btn-secondary', { type: 'button', on: { click: () => { if (select.value) { itemIds = [...itemIds, select.value]; saveItems(); } } } }, h('span', { html: icon('plus', { size: 15 }) }), ' ', t('teacher.add_assignment')))
          : h('span.small.muted', t('teacher.no_assignments_available')),
      ),
    );
    host.appendChild(itemsCard);
  }

  try {
    await load();
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    clear(host);
    host.appendChild(h('div.card.error-card', h('h2', t('common.error')), h('p.muted', errorMessage(error))));
  }
  return () => { disposed = true; };
}
