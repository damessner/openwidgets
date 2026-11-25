// Teacher view: vocabulary lists (word libraries). Lists are authoring
// helpers — a `vocabulary` item stores a snapshot of the entries, so lists
// can be edited/deleted without breaking saved activities.
import { get, post, del } from '/lib/api.js';
import { h, clear, toast, confirmDialog, modal, emptyState } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { navigate } from '../lib/core.js';

function openCreateListDialog() {
  return new Promise((resolve) => {
    const titleInput = h('input.input#new-vocab-title', { type: 'text', maxlength: 200, value: t('teacher.vocab_new') });
    const sourceInput = h('input.input', { type: 'text', maxlength: 10, value: 'de', style: 'max-width:90px' });
    const targetInput = h('input.input', { type: 'text', maxlength: 10, value: 'en', style: 'max-width:90px' });
    const csvInput = h('textarea.textarea#new-vocab-csv', { rows: 5, placeholder: t('teacher.vocab_csv_ph') });
    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const createButton = h('button.btn.btn-primary', { type: 'submit' }, t('teacher.vocab_create'));
    const form = h(
      'form',
      h('div.field', h('label.label', { for: 'new-vocab-title' }, t('teacher.vocab_title_field')), titleInput),
      h('div.row.gap-2',
        h('div.field', h('label.label', { for: 'new-vocab-src' }, t('teacher.vocab_source_lang')), sourceInput),
        h('div.field', h('label.label', { for: 'new-vocab-tgt' }, t('teacher.vocab_target_lang')), targetInput),
      ),
      h('div.field', h('label.label', { for: 'new-vocab-csv' }, t('teacher.vocab_csv_import_optional')), csvInput, h('p.help', { text: t('teacher.vocab_csv_help') })),
      errorBox,
      h('div.row.end.gap-2', cancelButton, createButton),
    );
    sourceInput.id = 'new-vocab-src';
    targetInput.id = 'new-vocab-tgt';
    const dialog = modal({ title: t('teacher.vocab_new'), body: form, actions: [] });
    const close = (result) => { dialog.dialog.close(); resolve(result || null); };
    cancelButton.addEventListener('click', () => close(null));
    dialog.dialog.addEventListener('close', () => resolve(null));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      createButton.disabled = true;
      try {
        const body = {
          title: titleInput.value,
          sourceLang: sourceInput.value,
          targetLang: targetInput.value,
        };
        const csv = csvInput.value.trim();
        const created = await post('/api/vocab-lists', body);
        if (created && created.list && csv) {
          await post(`/api/vocab-lists/${encodeURIComponent(created.list.id)}/import`, { csv });
        }
        close(created);
      } catch (error) {
        errorBox.textContent = String(error && error.message ? error.message : error);
        errorBox.hidden = false;
        createButton.disabled = false;
      }
    });
    dialog.dialog.showModal();
  });
}

export async function mount(root, ctx) {
  ctx.setTitle(t('teacher.vocab_title'));
  root.appendChild(h('div.loading-block', { role: 'status' }, h('span.spinner.spinner-sm', { 'aria-hidden': 'true' })));

  let lists = [];
  try {
    const data = await get('/api/vocab-lists');
    lists = data.lists || [];
  } catch {
    /* error card below */
  }

  function renderContent() {
    clear(root);
    root.appendChild(
      h('div.row.between.wrap.mb-4',
        h('div', h('h1.page-title', t('teacher.vocab_title')), h('p.muted.mb-0', t('teacher.vocab_subtitle'))),
        h('button.btn.btn-primary', {
          type: 'button',
          on: {
            click: async () => {
              const created = await openCreateListDialog();
              if (created && created.list && created.list.id) {
                navigate(`/teacher/vocab-edit?id=${encodeURIComponent(created.list.id)}`);
              }
            },
          },
        }, h('span', { html: icon('plus', { size: 16 }) }), ' ', t('teacher.vocab_new')),
      ),
    );

    if (lists.length === 0) {
      root.appendChild(emptyState(t('teacher.vocab_empty_title'), t('teacher.vocab_empty_hint')));
      return;
    }

    const table = h('div.card', h('table.table.vocab-table',
      h('thead', h('tr',
        h('th', t('teacher.vocab_title_field')),
        h('th', t('teacher.vocab_langs')),
        h('th', t('teacher.vocab_entries')),
        h('th', t('teacher.vocab_updated')),
        h('th', { class: 'ta-right' }, t('teacher.vocab_actions')),
      )),
      h('tbody', ...lists.map((list) => h('tr',
        h('td', h('a', { href: `/teacher/vocab-edit?id=${encodeURIComponent(list.id)}` }, list.title)),
        h('td', h('span.badge.badge-info', `${list.sourceLang} → ${list.targetLang}`)),
        h('td', String(list.entryCount)),
        h('td.small.muted', new Date(list.updatedAt).toLocaleString()),
        h('td.ta-right', h('div.row.gap-1.end',
          h('button.btn.btn-sm.btn-secondary', {
            type: 'button',
            on: { click: () => navigate(`/teacher/vocab-edit?id=${encodeURIComponent(list.id)}`) },
          }, t('common.edit')),
          h('button.btn.btn-sm.btn-danger', {
            type: 'button',
            on: {
              click: async () => {
                const ok = await confirmDialog({
                  title: t('teacher.vocab_delete'),
                  message: t('teacher.vocab_delete_confirm', { title: list.title }),
                  confirmLabel: t('common.delete'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await del(`/api/vocab-lists/${encodeURIComponent(list.id)}`);
                  lists = lists.filter((entry) => entry.id !== list.id);
                  toast(t('teacher.vocab_deleted'), 'success');
                  renderContent();
                } catch (error) {
                  toast(String(error && error.message ? error.message : error), 'error');
                }
              },
            },
          }, t('common.delete')),
        )),
      ))),
    ));
    root.appendChild(table);
  }

  renderContent();
}
