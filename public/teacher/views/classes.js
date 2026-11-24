// Teacher view: list of classes (bundles of assignments) + create dialog.
import { get, post, del, errorMessage } from '/lib/api.js';
import { h, qs, clear, toast, confirmDialog, modal, emptyState, copyText } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { navigate, statusBadge } from '../lib/core.js';
import { openCredentialsDialog } from '../lib/dialogs.js';

function modeBadge(orderMode) {
  return h(
    `span.badge.${orderMode === 'sequence' ? 'badge-primary' : 'badge-info'}`,
    t(orderMode === 'sequence' ? 'teacher.class_mode_sequence' : 'teacher.class_mode_free'),
  );
}

function classUrl(code) {
  return `${window.location.origin}/c/${encodeURIComponent(String(code || '').toUpperCase())}`;
}

function openCreateClassDialog({ onCreated } = {}) {
  return new Promise((resolve) => {
    const nameInput = h('input.input', { type: 'text', maxlength: 120, value: t('teacher.new_class') });
    const descriptionInput = h('textarea.textarea', { maxlength: 2000, rows: 3 });
    const namesInput = h('textarea.textarea#new-class-names', { rows: 4, placeholder: t('teacher.roster_names_placeholder') });
    const percentInput = h('input.input', { type: 'number', min: '0', max: '100', step: '5', value: '0', style: 'max-width:110px' });
    percentInput.id = 'new-class-percent';

    let orderMode = 'free';
    const segmented = h('div.segmented', { role: 'group', 'aria-label': t('teacher.class_order_mode') });
    const freeBtn = h('button', { type: 'button', class: 'is-active' }, t('teacher.order_free'));
    const seqBtn = h('button', { type: 'button' }, t('teacher.order_sequence'));
    const help = h('p.help', { text: t('teacher.order_free_help') });
    const syncSegmented = () => {
      freeBtn.classList.toggle('is-active', orderMode === 'free');
      seqBtn.classList.toggle('is-active', orderMode === 'sequence');
      help.textContent = t(orderMode === 'sequence' ? 'teacher.order_sequence_help' : 'teacher.order_free_help');
    };
    freeBtn.addEventListener('click', () => { orderMode = 'free'; syncSegmented(); });
    seqBtn.addEventListener('click', () => { orderMode = 'sequence'; syncSegmented(); });
    segmented.append(freeBtn, seqBtn);

    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const createButton = h('button.btn.btn-primary', { type: 'submit' }, t('teacher.create_class'));

    const form = h(
      'form',
      h('div.field', h('label.label', { for: 'new-class-name' }, t('teacher.class_name')), nameInput),
      h('div.field', h('label.label', { for: 'new-class-desc' }, t('teacher.class_description')), descriptionInput),
      h(
        'div.field',
        h('label.label', { for: 'new-class-names' }, t('teacher.roster_add_names_optional')),
        namesInput,
        h('p.help', { text: t('teacher.roster_names_help') }),
      ),
      h('div.field', h('label.label', { for: 'new-class-mode' }, t('teacher.class_order_mode')), segmented, help),
      h(
        'div.field',
        h('label.label', { for: 'new-class-percent' }, t('teacher.unlock_min_percent')),
        percentInput,
        h('p.help', { text: t('teacher.unlock_min_percent_help') }),
      ),
      errorBox,
      h('div.row.end.gap-2', cancelButton, createButton),
    );
    nameInput.id = 'new-class-name';
    descriptionInput.id = 'new-class-desc';
    segmented.id = 'new-class-mode';

    const dialog = modal({ title: t('teacher.create_class'), body: form, actions: [] });
    const close = (result) => { dialog.close(); resolve(result || null); };
    cancelButton.addEventListener('click', () => close(null));
    dialog.dialog.addEventListener('close', () => resolve(null));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      createButton.disabled = true;
      try {
        const data = await post('/api/classes', {
          name: nameInput.value.trim(),
          description: descriptionInput.value.trim(),
          orderMode,
          unlockMinPercent: Number(percentInput.value) || 0,
        });
        const cls = data && data.class;
        if (cls) {
          // Optional: create student accounts right away from the name list.
          const names = namesInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
          let credentials = null;
          if (names.length > 0) {
            try {
              const studentData = await post(`/api/classes/${encodeURIComponent(cls.id)}/students`, { names });
              if (Array.isArray(studentData.credentials) && studentData.credentials.length > 0) credentials = studentData.credentials;
            } catch { /* roster can be added later in the class view */ }
          }
          if (typeof onCreated === 'function') onCreated(cls);
          close(cls);
          // Route changes close all open modals (app.js) and only one modal can
          // be open at a time — show the credentials dialog after both settled.
          if (credentials) setTimeout(() => openCredentialsDialog(credentials, { className: cls.name }), 400);
        } else close(null);
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
        createButton.disabled = false;
      }
    });
    nameInput.focus();
    nameInput.select();
  });
}

export async function mount(root, ctx) {
  let disposed = false;
  ctx.setTitle(t('teacher.nav_classes'));
  const wrapper = h('div.classes-view');
  clear(root);
  root.appendChild(wrapper);
  const contentHost = h('div');
  wrapper.appendChild(contentHost);

  ctx.onLocaleChange(() => { if (!disposed) renderContent(); });

  let classes = [];
  let loadError = null;

  async function load({ silent = false } = {}) {
    if (!silent) renderContent();
    try {
      const data = await get('/api/classes', { signal: ctx.signal });
      if (disposed) return;
      classes = Array.isArray(data && data.classes) ? data.classes : [];
      loadError = null;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      loadError = error;
    } finally {
      if (!disposed) renderContent();
    }
  }

  async function publishClass(cls) {
    try {
      await post(`/api/classes/${encodeURIComponent(cls.id)}/publish`);
      toast(t('teacher.class_published'), 'success');
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function unpublishClass(cls) {
    try {
      await post(`/api/classes/${encodeURIComponent(cls.id)}/unpublish`);
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function deleteClass(cls) {
    const ok = await confirmDialog({
      title: t('teacher.delete_class'),
      message: t('teacher.confirm_delete_class'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/classes/${encodeURIComponent(cls.id)}`);
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function renderContent() {
    clear(contentHost);
    contentHost.appendChild(
      h(
        'div.row.between.wrap.mb-4',
        h(
          'div',
          h('h1.page-title', t('teacher.classes_title')),
          h('p.muted.mb-0', t('teacher.classes_subtitle')),
        ),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          const created = await openCreateClassDialog();
          if (created && created.id) navigate(`/teacher/class?id=${encodeURIComponent(created.id)}`);
        } } },
          h('span', { html: icon('plus', { size: 18 }) }),
          h('span', { text: t('teacher.new_class') }),
        ),
      ),
    );

    if (loadError) {
      contentHost.appendChild(emptyState(t('common.error'), errorMessage(loadError)));
      return;
    }
    if (classes.length === 0) {
      contentHost.appendChild(emptyState(t('teacher.classes_empty_title'), t('teacher.classes_empty_hint')));
      return;
    }

    const grid = h('div.grid.grid-3');
    for (const cls of classes) {
      const card = h('article.card.landing-feature');
      card.appendChild(
        h('div.row.gap-2.wrap',
          modeBadge(cls.orderMode),
          statusBadge(cls.status, t(cls.status === 'published' ? 'teacher.class_status_published' : 'teacher.class_status_draft')),
        ),
      );
      card.appendChild(h('h3.card-title', { text: cls.name }));
      if (cls.description) card.appendChild(h('p.small.muted', { text: cls.description }));
      card.appendChild(
        h('div.row.gap-3.small.muted',
          h('span', { text: t('teacher.class_items_count', { n: cls.itemCount }) }),
          h('span', { text: t('teacher.class_participants', { n: cls.participantCount }) }),
        ),
      );
      if (cls.status === 'published' && cls.code) {
        const url = classUrl(cls.code);
        const codeChip = h(
          'button.code-chip',
          { type: 'button', title: t('teacher.copy_link'), on: { click: async () => {
            const ok = await copyText(url);
            toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
          } } },
          h('span.mono', { text: cls.code }),
          h('span', { html: icon('copy', { size: 13 }) }),
        );
        card.appendChild(h('div.row.gap-2.mt-2', codeChip, h('a.btn.btn-ghost.btn-sm', { href: url, target: '_blank', rel: 'noopener' }, t('teacher.open_class_link'))));
      }
      const actions = h('div.row.gap-1.mt-3',
        h('a.btn.btn-sm.btn-secondary', { href: `/teacher/class?id=${encodeURIComponent(cls.id)}` }, t('common.edit')),
        cls.status === 'published'
          ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => unpublishClass(cls) } }, t('teacher.unpublish_class'))
          : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => publishClass(cls) } }, t('teacher.publish_class')),
        h('button.btn.btn-sm.btn-soft-danger', { type: 'button', on: { click: () => deleteClass(cls) } }, h('span', { html: icon('trash', { size: 15 }) })),
      );
      card.appendChild(actions);
      grid.appendChild(card);
    }
    contentHost.appendChild(grid);
  }

  renderContent();
  await load();
  return () => { disposed = true; };
}
