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

// ---------------------------------------------------------------------------
// Login-credential sheets. Plaintext passwords exist only at creation/reset
// time, so the sheet can be copied or printed right from the dialog — but is
// never stored or shown again later.
// ---------------------------------------------------------------------------

export function credentialsCsv(credentials) {
  const header = 'name;username;password';
  const rows = credentials
    .map((c) => [c.name, c.username, c.password].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  return ['﻿' + header, ...rows].join('\r\n');
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function sheetHtml({ title, subtitle, head, rows, footnote }) {
  const headCells = head.map((cell) => `<th>${escHtml(cell)}</th>`).join('');
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td${cell && cell.mono ? ' class="mono"' : ''}>${escHtml(cell && cell.text !== undefined ? cell.text : cell)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #17202b; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: #5b6572; font-size: 13px; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #c9d2dd; padding: 8px 12px; text-align: left; }
  th { background: #eef2f7; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .footnote { color: #5b6572; font-size: 12px; margin-top: 16px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
${subtitle ? `<p class="subtitle">${escHtml(subtitle)}</p>` : ''}
<table>
<thead><tr>${headCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
${footnote ? `<p class="footnote">${escHtml(footnote)}</p>` : ''}
</body>
</html>`;
}

/** Opens a self-contained print window and triggers the print dialog. */
export function printSheet(html) {
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) {
    toast(t('teacher.popup_blocked'), 'warning');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 300);
  return true;
}

/** Printable sheet with the initial login credentials (shown only once). */
export function printCredentialsSheet(credentials, { className = '' } = {}) {
  return printSheet(sheetHtml({
    title: t('teacher.roster_credentials_print_title'),
    subtitle: `${className ? `${className} — ` : ''}${t('teacher.roster_credentials_print_subtitle')}`,
    head: [t('teacher.roster_name'), t('teacher.roster_username'), t('teacher.roster_password')],
    rows: credentials.map((c) => [{ text: c.name }, { text: c.username, mono: true }, { text: c.password, mono: true }]),
    footnote: t('teacher.roster_credentials_note'),
  }));
}

/** Printable class roster (names + usernames, no passwords). */
export function printRosterSheet(className, students) {
  return printSheet(sheetHtml({
    title: t('teacher.roster_print_title'),
    subtitle: className || '',
    head: [t('teacher.roster_name'), t('teacher.roster_username'), t('teacher.roster_print_login')],
    rows: students.map((s) => [
      { text: s.name },
      { text: s.username || '—', mono: true },
      { text: s.username ? `${window.location.origin}/` : '—' },
    ]),
    footnote: t('teacher.roster_print_note'),
  }));
}

/**
 * Dialog listing freshly generated login credentials with copy (CSV) and
 * print actions. Used after roster creation and after a password reset.
 */
export function openCredentialsDialog(credentials, { className = '' } = {}) {
  const table = h(
    'table.roster-cred-table',
    h('thead', h('tr', h('th', t('teacher.roster_name')), h('th', t('teacher.roster_username')), h('th', t('teacher.roster_password')))),
    h('tbody', ...credentials.map((c) => h(
      'tr',
      h('td', { text: c.name }),
      h('td', h('span.mono', { text: c.username })),
      h('td', h('span.mono.strong', { text: c.password })),
    ))),
  );
  const note = h('p.small.muted', t('teacher.roster_credentials_note'));
  modal({
    title: t('teacher.roster_credentials_title'),
    size: 'lg',
    body: h('div', note, table),
    actions: [
      {
        label: t('teacher.roster_copy_csv'),
        kind: 'secondary',
        onClick: async () => {
          const ok = await copyText(credentialsCsv(credentials));
          toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
          return false; // keep open so the list can be copied/printed again
        },
      },
      {
        label: t('common.print'),
        kind: 'secondary',
        onClick: () => {
          printCredentialsSheet(credentials, { className });
          return false;
        },
      },
      { label: t('common.close'), kind: 'primary' },
    ],
  });
}
