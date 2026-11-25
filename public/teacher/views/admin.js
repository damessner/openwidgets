// #/admin — instance administration: users + stats.
import { get, post, patch, put, del, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog, modal, emptyState } from '/lib/dom.js';
import { t, formatDateTime } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { formatBytes } from '../lib/core.js';

function fieldId(key) {
  return `admin-${key}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Small generic dialog form. `fields`: [{key,label,type,value,required,help,options,placeholder}]
 * onSubmit(values) → Promise<true|string>; return true to close, a string to
 * show as an error message.
 */
function openFormDialog({ title, fields, submitLabel, onSubmit }) {
  return new Promise((resolve) => {
    const controls = new Map();
    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const form = h('form');
    for (const field of fields) {
      const id = fieldId(field.key);
      let control;
      if (field.type === 'select') {
        control = h(
          'select.select',
          (field.options || []).map((option) => h('option', { value: option.value, selected: option.value === field.value }, option.label)),
        );
      } else {
        control = h('input.input', {
          type: field.type || 'text',
          value: field.value === undefined || field.value === null ? '' : String(field.value),
          required: field.required ? true : undefined,
          placeholder: field.placeholder || undefined,
          autocomplete: field.autocomplete || 'off',
        });
      }
      control.id = id;
      controls.set(field.key, control);
      form.appendChild(
        h(
          'div.field',
          h(
            'label.label',
            { for: id },
            field.label,
            field.required ? null : h('span.optional', t('common.optional')),
          ),
          control,
          field.help ? h('p.help', field.help) : null,
        ),
      );
    }
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const submitButton = h('button.btn.btn-primary', { type: 'submit' }, submitLabel || t('common.save'));
    form.append(errorBox, h('div.row.end.gap-2', cancelButton, submitButton));

    const dialog = modal({ title, body: form, actions: [] });
    cancelButton.addEventListener('click', () => {
      dialog.close();
      resolve(false);
    });
    dialog.dialog.addEventListener('close', () => resolve(false));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = {};
      for (const field of fields) values[field.key] = controls.get(field.key).value;
      submitButton.disabled = true;
      submitButton.textContent = t('common.loading');
      errorBox.hidden = true;
      try {
        const result = await onSubmit(values);
        if (result === true || result === undefined) {
          resolve(true);
          dialog.close();
          return;
        }
        errorBox.textContent = String(result);
        errorBox.hidden = false;
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel || t('common.save');
      }
    });

    const first = form.querySelector('input, select');
    if (first) {
      first.focus();
      if (typeof first.select === 'function') first.select();
    }
  });
}

export async function mount(root, ctx) {
  if (!ctx.user || ctx.user.role !== 'admin') {
    clear(root);
    root.appendChild(
      h(
        'div.card.error-card',
        h('h2', t('errors.forbidden')),
        h('p.muted', t('teacher.admin_only')),
        h('a.btn.btn-primary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
      ),
    );
    return () => {};
  }

  const state = { users: [], stats: null, llm: null, loading: true, error: null };
  let disposed = false;
  const wrapper = h('div.admin-view');
  clear(root);
  root.appendChild(wrapper);

  ctx.setTitle(t('teacher.nav_admin'));
  ctx.onLocaleChange(() => {
    if (!disposed) render();
  });

  async function load({ silent = false } = {}) {
    if (!silent) {
      state.loading = true;
      render();
    }
    try {
      const [usersData, statsData, llmConfig] = await Promise.all([
        get('/api/admin/users', { signal: ctx.signal }),
        get('/api/admin/stats', { signal: ctx.signal }),
        get('/api/llm/config', { signal: ctx.signal }).catch(() => null),
      ]);
      if (disposed) return;
      state.users = (usersData && Array.isArray(usersData.users) ? usersData.users : []).slice();
      state.stats = (statsData && statsData.stats) || statsData || null;
      state.llm = llmConfig || null;
      state.error = null;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      if (disposed) return;
      state.error = error;
    } finally {
      if (!disposed) {
        state.loading = false;
        render();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function createUser() {
    const created = await openFormDialog({
      title: t('teacher.create_user'),
      submitLabel: t('common.create'),
      fields: [
        { key: 'email', label: t('common.email'), type: 'email', required: true, autocomplete: 'off' },
        { key: 'name', label: t('common.name'), type: 'text', required: true },
        {
          key: 'role',
          label: t('teacher.role'),
          type: 'select',
          value: 'teacher',
          options: [
            { value: 'teacher', label: t('teacher.role_teacher') },
            { value: 'admin', label: t('teacher.role_admin') },
          ],
        },
        {
          key: 'password',
          label: t('common.password'),
          type: 'password',
          required: true,
          help: t('teacher.password_min_hint'),
          autocomplete: 'new-password',
        },
      ],
      onSubmit: async (values) => {
        if (!values.email.trim() || !values.name.trim()) return t('teacher.fill_all_fields');
        if (String(values.password || '').length < 10) return t('teacher.password_too_short');
        await post('/api/admin/users', {
          email: values.email.trim(),
          name: values.name.trim(),
          role: values.role,
          password: values.password,
        });
        toast(t('teacher.user_created'), 'success');
        await load({ silent: true });
        return true;
      },
    });
    return created;
  }

  async function toggleDisabled(user) {
    const disabling = !user.disabled;
    const ok = await confirmDialog({
      title: disabling ? t('teacher.disable_user') : t('teacher.enable_user'),
      message: disabling ? t('teacher.disable_user_confirm', { name: user.name }) : t('teacher.enable_user_confirm', { name: user.name }),
      confirmLabel: disabling ? t('teacher.disable_user') : t('teacher.enable_user'),
      danger: disabling,
    });
    if (!ok) return;
    try {
      await patch(`/api/admin/users/${encodeURIComponent(user.id)}`, { disabled: disabling });
      toast(t('common.saved'), 'success');
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetPassword(user) {
    await openFormDialog({
      title: t('teacher.reset_password_title', { name: user.name }),
      submitLabel: t('teacher.reset_password'),
      fields: [
        {
          key: 'password',
          label: t('common.password'),
          type: 'password',
          required: true,
          help: t('teacher.password_min_hint'),
          autocomplete: 'new-password',
        },
      ],
      onSubmit: async (values) => {
        if (String(values.password || '').length < 10) return t('teacher.password_too_short');
        await patch(`/api/admin/users/${encodeURIComponent(user.id)}`, { password: values.password });
        toast(t('teacher.password_reset_done'), 'success');
        return true;
      },
    });
  }

  async function deleteUser(user) {
    const ok = await confirmDialog({
      title: t('teacher.delete_user'),
      message: t('teacher.delete_user_confirm', { name: user.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/api/admin/users/${encodeURIComponent(user.id)}`);
      toast(t('teacher.deleted'), 'success');
      await load({ silent: true });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function statCard(iconName, label, value, hint) {
    return h(
      'div.card.compact.stat-card',
      h('span.stat-icon', { html: icon(iconName, { size: 20 }) }),
      h(
        'div.stat',
        h('span.stat-value', String(value)),
        h('span.stat-label', label),
        hint ? h('span.tiny.muted', hint) : null,
      ),
    );
  }

  function renderStats() {
    const stats = state.stats || {};
    const grid = h('div.grid.grid-4.mb-4');
    grid.append(
      statCard('users', t('teacher.stat_users'), stats.users ?? '—'),
      statCard('book', t('teacher.stat_activities'), stats.activities ?? '—'),
      statCard('play', t('teacher.stat_assignments'), stats.assignments ?? '—'),
      statCard('clipboard', t('teacher.stat_participants'), stats.participants ?? '—'),
      statCard('image', t('teacher.stat_assets'), stats.assets ?? '—'),
      statCard('chart', t('teacher.stat_db_size'), formatBytes(stats.dbBytes)),
      statCard('download', t('teacher.stat_assets_size'), formatBytes(stats.assetsBytes)),
      statCard('info', t('teacher.stat_version'), stats.version || ctx.version || '—'),
    );
    return grid;
  }

  function renderUsersCard() {
    const card = h('div.card.compact');
    card.appendChild(
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.users')), h('p.card-subtitle', t('teacher.users_hint'))),
        h(
          'button.btn.btn-primary.btn-sm',
          { type: 'button', on: { click: createUser } },
          h('span', { html: icon('plus', { size: 16 }) }),
          t('teacher.create_user'),
        ),
      ),
    );
    if (state.users.length === 0) {
      card.appendChild(emptyState(t('teacher.no_users'), t('teacher.no_users_hint')));
      return card;
    }
    const rows = state.users.map((user) => {
      const isSelf = ctx.user && user.id === ctx.user.id;
      const statusBadge = user.disabled
        ? h('span.badge.badge-danger', t('teacher.user_disabled'))
        : h('span.badge.badge-success', t('teacher.user_active'));
      const roleBadge = h(
        `span.badge.${user.role === 'admin' ? 'badge-primary' : 'badge'}`,
        t(user.role === 'admin' ? 'teacher.role_admin' : 'teacher.role_teacher'),
      );
      const toggleButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        {
          type: 'button',
          disabled: isSelf,
          title: user.disabled ? t('teacher.enable_user') : t('teacher.disable_user'),
          'aria-label': user.disabled ? t('teacher.enable_user') : t('teacher.disable_user'),
        },
        h('span', { html: icon(user.disabled ? 'play' : 'lock', { size: 16 }) }),
      );
      toggleButton.addEventListener('click', () => toggleDisabled(user));
      const resetButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        { type: 'button', title: t('teacher.reset_password'), 'aria-label': t('teacher.reset_password') },
        h('span', { html: icon('refresh', { size: 16 }) }),
      );
      resetButton.addEventListener('click', () => resetPassword(user));
      const deleteButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost.text-danger',
        { type: 'button', disabled: isSelf, title: t('teacher.delete_user'), 'aria-label': t('teacher.delete_user') },
        h('span', { html: icon('trash', { size: 16 }) }),
      );
      deleteButton.addEventListener('click', () => deleteUser(user));
      return h(
        'tr',
        h(
          'td',
          h('div.strong', user.name || '—'),
          isSelf ? h('span.badge.badge-info.tiny', t('teacher.you')) : null,
        ),
        h('td', user.email || '—'),
        h('td', roleBadge),
        h('td', statusBadge),
        h('td.nowrap.small.muted', user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t('teacher.never')),
        h('td.nowrap.small.muted', user.createdAt ? formatDateTime(user.createdAt) : '—'),
        h('td', h('div.row.gap-1', toggleButton, resetButton, deleteButton)),
      );
    });
    card.appendChild(
      h(
        'div.table-wrap',
        h(
          'table.table',
          h(
            'thead',
            h(
              'tr',
              h('th', t('common.name')),
              h('th', t('common.email')),
              h('th', t('teacher.role')),
              h('th', t('common.status')),
              h('th', t('teacher.last_login')),
              h('th', t('teacher.created')),
              h('th', t('common.actions')),
            ),
          ),
          h('tbody', rows),
        ),
      ),
    );
    return card;
  }

  function renderLlmCard() {
    const llm = state.llm || {};
    const providers = llm.providers || {};
    const providerSelect = h(
      'select.select',
      Object.entries(providers).map(([id, p]) =>
        h('option', { value: id, selected: id === (llm.provider || 'gemini') }, `${p.label} (${id})`),
      ),
    );
    const keyInput = h('input.input', {
      type: 'password',
      autocomplete: 'off',
      placeholder: llm.apiKeyMasked || '',
    });
    const modelInput = h('input.input', { type: 'text', list: 'admin-llm-models', value: llm.model || '', placeholder: (providers[llm.provider || 'gemini'] || {}).defaultModel || '' });
    const modelList = h(
      'datalist',
      { id: 'admin-llm-models' },
      ((providers[llm.provider || 'gemini'] || {}).models || []).map((m) => h('option', { value: m })),
    );
    const baseUrlInput = h('input.input', { type: 'text', value: llm.baseUrl || '', placeholder: 'https://…' });
    const enabledInput = h('input', { type: 'checkbox' });
    if (llm.active !== false) enabledInput.checked = true;

    const statusBadgeEl = h(
      'span.badge.tiny',
      { class: llm.enabled ? 'badge-success' : 'badge-warning', text: llm.enabled ? t('teacher.llm_enabled') : t('teacher.llm_disabled') },
    );
    const saveButton = h('button.btn.btn-primary.btn-sm', { type: 'button' }, t('common.save'));
    const testButton = h('button.btn.btn-secondary.btn-sm', { type: 'button' }, t('teacher.llm_test'));
    const note = h('p.help', { text: t('teacher.llm_privacy_note') });
    const resultBox = h('p.small.muted', { role: 'status' });

    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      resultBox.textContent = '';
      try {
        const saved = await put('/api/llm/config', {
          provider: providerSelect.value,
          apiKey: keyInput.value.trim(), // empty keeps the stored key
          model: modelInput.value.trim(),
          baseUrl: baseUrlInput.value.trim(),
          enabled: enabledInput.checked,
        });
        state.llm = saved;
        keyInput.value = '';
        keyInput.placeholder = saved.apiKeyMasked || '';
        toast(t('teacher.llm_saved'), 'success');
        render();
      } catch (error) {
        resultBox.textContent = errorMessage(error);
      } finally {
        saveButton.disabled = false;
      }
    });

    testButton.addEventListener('click', async () => {
      testButton.disabled = true;
      resultBox.textContent = t('teacher.llm_testing');
      try {
        // save the current form first so "test" always tests what is shown
        const saved = await put('/api/llm/config', {
          provider: providerSelect.value,
          apiKey: keyInput.value.trim(),
          model: modelInput.value.trim(),
          baseUrl: baseUrlInput.value.trim(),
          enabled: enabledInput.checked,
        });
        state.llm = saved;
        keyInput.value = '';
        keyInput.placeholder = saved.apiKeyMasked || '';
        const res = await post('/api/llm/test', {});
        resultBox.textContent = t('teacher.llm_test_ok', { model: res.model || '', ms: res.latencyMs || 0 });
      } catch (error) {
        resultBox.textContent = errorMessage(error);
      } finally {
        testButton.disabled = false;
      }
    });

    providerSelect.addEventListener('change', () => {
      const models = (providers[providerSelect.value] || {}).models || [];
      modelList.replaceChildren(...models.map((m) => h('option', { value: m })));
      modelInput.placeholder = (providers[providerSelect.value] || {}).defaultModel || '';
    });

    return h(
      'div.card.compact',
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.llm_title')), h('p.card-subtitle', t('teacher.llm_subtitle'))),
        statusBadgeEl,
      ),
      h('div.row.gap-2.wrap',
        h('div.field', h('label.label', t('teacher.llm_provider')), providerSelect),
        h('div.field', h('label.label', t('teacher.llm_enabled_label')), h('label.row.gap-1', enabledInput, h('span.small', t('teacher.llm_enabled_checkbox')))),
      ),
      h('div.row.gap-2.wrap',
        h('div.field', h('label.label', t('teacher.llm_api_key')), keyInput, h('p.help', llm.keySource === 'env' ? t('teacher.llm_key_from_env') : t('teacher.llm_key_help'))),
        h('div.field', h('label.label', t('teacher.llm_model')), modelInput, modelList),
      ),
      h('div.field', h('label.label', t('teacher.llm_base_url')), baseUrlInput, h('p.help', t('teacher.llm_base_url_help'))),
      h('div.row.gap-2', saveButton, testButton),
      resultBox,
      note,
    );
  }

  function render() {
    if (disposed) return;
    clear(wrapper);
    if (state.loading) {
      wrapper.appendChild(
        h('div.loading-block', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', t('common.loading'))),
      );
      return;
    }
    wrapper.appendChild(
      h(
        'div.row.between.wrap.mt-4.mb-4',
        h('div', h('h1.page-title', t('teacher.admin_title')), h('p.muted.mb-0', t('teacher.admin_subtitle'))),
        h(
          'button.btn.btn-secondary.btn-sm',
          { type: 'button', on: { click: () => load() } },
          h('span', { html: icon('refresh', { size: 16 }) }),
          t('teacher.refresh'),
        ),
      ),
    );
    if (state.error) {
      wrapper.appendChild(
        h(
          'div.card.error-card',
          h('h2', t('teacher.load_failed')),
          h('p.muted', errorMessage(state.error)),
          h('button.btn.btn-primary', { type: 'button', on: { click: () => load() } }, t('common.retry')),
        ),
      );
      return;
    }
    wrapper.appendChild(renderStats());
    wrapper.appendChild(renderUsersCard());
    wrapper.appendChild(renderLlmCard());
  }

  render();
  await load();

  return () => {
    disposed = true;
  };
}
