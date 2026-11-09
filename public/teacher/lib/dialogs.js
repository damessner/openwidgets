// Reusable teacher dialogs: create activity and publish activity.
import { h, modal, toast, copyText } from '/lib/dom.js';
import { post, errorMessage } from '/lib/api.js';
import { t } from '/lib/i18n.js';
import { localInputToIso, joinUrlForCode } from './core.js';

/**
 * Create a new draft activity. Resolves with the created activity or null.
 * @param {{onCreated?: (activity: object) => void}} options
 */
export function openCreateActivityDialog({ onCreated } = {}) {
  return new Promise((resolve) => {
    const titleInput = h('input.input', { type: 'text', value: t('teacher.new_activity_title'), maxlength: 200 });
    const templateSelect = h(
      'select.select',
      h('option', { value: 'worksheet', selected: true }, t('teacher.template_worksheet')),
      h('option', { value: 'quiz' }, t('teacher.template_quiz')),
    );
    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const createButton = h('button.btn.btn-primary', { type: 'submit' }, t('teacher.create_activity'));

    const form = h(
      'form',
      h('div.field', h('label.label', { for: 'new-activity-title' }, t('common.title')), titleInput),
      h(
        'div.field',
        h('label.label', { for: 'new-activity-template' }, t('teacher.template')),
        templateSelect,
        h('p.help', t('teacher.template_help')),
      ),
      errorBox,
      h('div.row.end.gap-2', cancelButton, createButton),
    );
    titleInput.id = 'new-activity-title';
    templateSelect.id = 'new-activity-template';

    const dialog = modal({ title: t('teacher.create_activity'), body: form, actions: [] });
    const close = (result) => {
      dialog.close();
      resolve(result || null);
    };
    cancelButton.addEventListener('click', () => close(null));
    dialog.dialog.addEventListener('close', () => resolve(null));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      if (!title) {
        errorBox.textContent = t('teacher.title_required');
        errorBox.hidden = false;
        titleInput.focus();
        return;
      }
      createButton.disabled = true;
      createButton.textContent = t('common.loading');
      errorBox.hidden = true;
      try {
        const data = await post('/api/activities', { title, template: templateSelect.value });
        const activity = data && data.activity;
        if (activity) {
          if (typeof onCreated === 'function') onCreated(activity);
          close(activity);
        } else {
          close(null);
        }
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
        createButton.disabled = false;
        createButton.textContent = t('teacher.create_activity');
      }
    });

    titleInput.focus();
    titleInput.select();
  });
}

function renderPublishSuccess(body, assignment) {
  body.replaceChildren();
  const code = String(assignment.code || '');
  const url = assignment.url ? new URL(assignment.url, window.location.origin).href : joinUrlForCode(code);
  const linkInput = h('input.input.mono', { type: 'text', value: url, readOnly: true });
  linkInput.addEventListener('focus', () => linkInput.select());
  const copyButton = h('button.btn.btn-primary', { type: 'button' }, t('common.copy'));
  copyButton.addEventListener('click', async () => {
    const ok = await copyText(url);
    toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
  });
  const liveButton = h(
    'a.btn.btn-secondary',
    { href: `/teacher/assignment?id=${encodeURIComponent(assignment.id || '')}` },
    t('teacher.open_live'),
  );
  const doneButton = h('button.btn.btn-ghost', { type: 'button' }, t('common.close'));
  doneButton.addEventListener('click', () => {
    const dialog = body.closest('dialog');
    if (dialog) dialog.close();
  });
  body.append(
    h('p.strong', t('teacher.publish_success')),
    h('div.publish-code', h('span.tiny.muted', t('teacher.code')), h('div.publish-code-value', code)),
    h('div.field', h('label.label', t('teacher.join_link')), h('div.input-row', linkInput, copyButton), h('p.help', t('teacher.join_link_help'))),
    h('div.row.wrap.gap-2.mt-3', liveButton, doneButton),
  );
}

/**
 * Publish dialog: POST /api/activities/:id/publish, then show code + join URL.
 * Resolves with the assignment or null.
 */
export function openPublishDialog({ activityId, defaultTitle, onPublished } = {}) {
  return new Promise((resolve) => {
    const titleInput = h('input.input', { type: 'text', value: defaultTitle || '', maxlength: 200 });
    const dueInput = h('input.input', { type: 'datetime-local' });
    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const publishButton = h('button.btn.btn-primary', { type: 'submit' }, t('common.publish'));

    const form = h(
      'form',
      h(
        'div.field',
        h('label.label', { for: 'publish-title' }, t('common.title')),
        titleInput,
        h('p.help', t('teacher.publish_title_help')),
      ),
      h(
        'div.field',
        h('label.label', { for: 'publish-due' }, t('teacher.due_date')),
        dueInput,
        h('p.help', t('teacher.due_date_help')),
      ),
      errorBox,
      h('div.row.end.gap-2', cancelButton, publishButton),
    );
    titleInput.id = 'publish-title';
    dueInput.id = 'publish-due';

    const dialog = modal({ title: t('teacher.publish_activity'), body: form, actions: [] });
    let settled = false;
    const finish = (assignment) => {
      if (settled) return;
      settled = true;
      resolve(assignment || null);
    };
    cancelButton.addEventListener('click', () => {
      finish(null);
      dialog.close();
    });
    dialog.dialog.addEventListener('close', () => finish(null));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      publishButton.disabled = true;
      publishButton.textContent = t('common.loading');
      errorBox.hidden = true;
      const body = {};
      const title = titleInput.value.trim();
      if (title) body.title = title;
      const dueAt = localInputToIso(dueInput.value);
      if (dueAt) body.dueAt = dueAt;
      try {
        const data = await post(`/api/activities/${encodeURIComponent(activityId)}/publish`, body);
        const assignment = data && data.assignment;
        if (!assignment) throw new Error('missing assignment');
        if (typeof onPublished === 'function') onPublished(assignment);
        dialog.body.replaceChildren();
        renderPublishSuccess(dialog.body, assignment);
        setTimeout(() => {
          const input = dialog.body.querySelector('input');
          if (input) input.select();
        }, 50);
        finish(assignment);
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
        publishButton.disabled = false;
        publishButton.textContent = t('common.publish');
      }
    });

    titleInput.focus();
    titleInput.select();
  });
}
