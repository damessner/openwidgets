// #/edit?id= — activity authoring: item list, generated config forms, live
// preview, settings and debounced autosave with revision-conflict handling.
import { get, put, uploadAsset, ApiError, errorMessage } from '/lib/api.js';
import { h, clear, toast, confirmDialog, debounce, modal } from '/lib/dom.js';
import { t, getLocale } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import {
  parseDefinition,
  relativeSavedLabel,
  assetUrl,
  rememberAssetUrl,
} from '../lib/core.js';
import {
  loadPalette,
  createItem,
  normalizeItemForEditor,
  editSchemaFor,
  typeLabel,
  typeEmoji,
  categoryLabel,
  isScoreableType,
  hasSharedRegistry,
  regenerateItemIds,
  newItemId,
} from '../lib/items.js';
import { renderConfigForm } from '../lib/fields.js';
import { mountItemSafe } from '../lib/preview.js';
import { openPublishDialog } from '../lib/dialogs.js';

const SAVE_DEBOUNCE_MS = 1200;
const PREVIEW_DEBOUNCE_MS = 350;

function defaultSettings() {
  return {
    instantFeedback: true,
    shuffleItems: false,
    showResults: true,
    allowReview: true,
    showAnswers: false,
    warnUnanswered: true,
    timeLimitMinutes: null,
    requireName: true,
    accessibility: { tts: true, starQuestions: true, fontScale: true },
  };
}

function deepClone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export async function mount(root, ctx) {
  const activityId = String(ctx.params.get('id') || '').trim();
  ctx.setTitle(t('teacher.edit_title'));
  if (!activityId) {
    ctx.navigate('/teacher/dashboard', { replace: true });
    return () => {};
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const state = {
    revision: 1,
    status: 'draft',
    updatedAt: null,
    doc: {
      title: '',
      description: '',
      template: 'worksheet',
      locale: getLocale(),
      settings: defaultSettings(),
      items: [],
    },
    selectedItemId: null,
    collapsed: new Set(),
    saveState: 'saved',
    lastSavedAt: null,
    dirty: false,
    conflict: false,
    validationErrors: [],
    palette: [],
    paletteReady: false,
    loading: true,
    loadError: null,
  };

  let disposed = false;
  let saveChain = Promise.resolve();
  let previewToken = 0;
  let previewInstance = null;

  const saveDebounced = debounce(() => {
    requestSave();
  }, SAVE_DEBOUNCE_MS);
  const previewDebounced = debounce(() => {
    renderPreview();
  }, PREVIEW_DEBOUNCE_MS);

  const wrapper = h('div.editor-view');
  clear(root);
  root.appendChild(wrapper);

  let toolbarHost = null;
  let saveStatusEl = null;
  let errorsHost = null;
  let mainHost = null;
  let sideHost = null;
  let metaHost = null;
  let paletteHost = null;
  let itemListHost = null;
  let previewHost = null;
  let previewInfoHost = null;
  let settingsHost = null;

  ctx.onLocaleChange(() => {
    if (!disposed) renderAll();
  });

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  function applyActivity(activity) {
    const definition = parseDefinition(activity.definition) || {};
    const settings = { ...defaultSettings(), ...(definition.settings || {}) };
    settings.accessibility = { ...defaultSettings().accessibility, ...((definition.settings && definition.settings.accessibility) || {}) };
    state.revision = Number(activity.revision) || 1;
    state.status = activity.status || 'draft';
    state.updatedAt = activity.updatedAt || null;
    state.doc = {
      title: activity.title !== undefined && activity.title !== null ? activity.title : definition.title || '',
      description: activity.description !== undefined && activity.description !== null ? activity.description : definition.description || '',
      template: activity.template || definition.template || 'worksheet',
      locale: activity.locale || definition.locale || getLocale(),
      settings,
      items: (Array.isArray(definition.items) ? definition.items : []).map(normalizeItemForEditor),
    };
    for (const item of state.doc.items) {
      if (!isScoreableType(item.type)) item.points = 0;
    }
    state.selectedItemId = state.doc.items.length ? state.doc.items[0].id : null;
    state.lastSavedAt = activity.updatedAt || null;
  }

  async function loadActivity() {
    state.loading = true;
    state.loadError = null;
    renderAll();
    try {
      const data = await get(`/api/activities/${encodeURIComponent(activityId)}`, { signal: ctx.signal });
      if (disposed) return;
      if (!data || !data.activity) throw new Error('missing_activity');
      applyActivity(data.activity);
      state.dirty = false;
      setSaveState('saved');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (disposed) return;
      state.loadError = error;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) throw error;
    } finally {
      if (!disposed) {
        state.loading = false;
        renderAll();
      }
    }
  }

  async function loadPaletteData() {
    try {
      state.palette = await loadPalette();
    } catch {
      state.palette = [];
    } finally {
      state.paletteReady = true;
      if (!disposed) renderAll();
    }
  }

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------

  function setSaveState(value) {
    state.saveState = value;
    updateSaveStatus();
  }

  function updateSaveStatus() {
    if (!saveStatusEl) return;
    clear(saveStatusEl);
    saveStatusEl.className = `save-state save-${state.saveState}`;
    saveStatusEl.setAttribute('aria-live', 'polite');
    if (state.saveState === 'saving') {
      saveStatusEl.append(h('span.spinner.spinner-sm', { 'aria-hidden': 'true' }), h('span', t('common.saving')));
    } else if (state.saveState === 'pending') {
      saveStatusEl.append(h('span.save-dot', { 'aria-hidden': 'true' }), h('span', t('teacher.unsaved')));
    } else if (state.saveState === 'error') {
      saveStatusEl.append(h('span', { html: icon('warning', { size: 15 }) }), h('span', t('teacher.save_failed')));
    } else if (state.saveState === 'conflict') {
      saveStatusEl.append(h('span', { html: icon('warning', { size: 15 }) }), h('span', t('teacher.save_conflict_short')));
    } else {
      const label = state.lastSavedAt ? `${t('common.saved')} · ${relativeSavedLabel(state.lastSavedAt)}` : t('common.saved');
      saveStatusEl.append(h('span', { html: icon('checkCircle', { size: 15 }) }), h('span', label));
    }
  }

  function buildPayload() {
    const doc = state.doc;
    const definition = {
      v: 1,
      template: doc.template,
      title: doc.title,
      description: doc.description,
      locale: doc.locale,
      settings: doc.settings,
      items: doc.items,
    };
    return {
      title: doc.title,
      description: doc.description,
      template: doc.template,
      locale: doc.locale,
      definition,
      revision: state.revision,
    };
  }

  function scheduleChange() {
    if (state.conflict) {
      setSaveState('conflict');
      return;
    }
    state.dirty = true;
    setSaveState('pending');
    saveDebounced();
    previewDebounced();
  }

  function requestSave() {
    saveChain = saveChain.then(saveOnce, saveOnce);
    return saveChain;
  }

  async function saveOnce() {
    // No `disposed` guard: navigating away flushes a pending edit through the
    // save chain (the view is gone but the PUT is still valid).
    if (state.conflict || !state.dirty) return;
    state.dirty = false;
    const payload = buildPayload();
    setSaveState('saving');
    try {
      const data = await put(`/api/activities/${encodeURIComponent(activityId)}`, payload);
      const activity = data && data.activity;
      if (activity) {
        state.revision = Number(activity.revision) || state.revision;
        state.updatedAt = activity.updatedAt || new Date().toISOString();
      } else {
        state.revision += 1;
      }
      state.lastSavedAt = state.updatedAt || new Date().toISOString();
      state.validationErrors = [];
      renderErrors();
      setSaveState(state.dirty ? 'pending' : 'saved');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error instanceof ApiError && error.code === 'revision_conflict') {
        state.conflict = true;
        state.dirty = false;
        setSaveState('conflict');
        renderErrors();
        return;
      }
      if (error instanceof ApiError && error.code === 'validation_failed') {
        state.validationErrors = Array.isArray(error.details) ? error.details : [];
        state.dirty = true;
        setSaveState('error');
        renderErrors();
        return;
      }
      state.dirty = true;
      setSaveState('error');
      toast(errorMessage(error), 'error');
    }
    if (state.dirty && !state.conflict) requestSave();
  }

  async function flushSave() {
    saveDebounced.cancel();
    if (state.conflict) return false;
    if (state.dirty || state.saveState === 'saving') requestSave();
    await saveChain;
    return !state.conflict && !state.dirty;
  }

  async function reloadFromServer({ confirm = true } = {}) {
    if (confirm) {
      const ok = await confirmDialog({
        title: t('teacher.reload_title'),
        message: t('teacher.reload_confirm'),
        confirmLabel: t('teacher.reload'),
        danger: true,
      });
      if (!ok) return;
    }
    state.conflict = false;
    saveDebounced.cancel();
    await loadActivity();
  }

  // -------------------------------------------------------------------------
  // Rendering: shell
  // -------------------------------------------------------------------------

  function renderAll() {
    if (disposed) return;
    clear(wrapper);
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
            h('button.btn.btn-primary', { type: 'button', on: { click: () => loadActivity() } }, t('common.retry')),
            h('a.btn.btn-secondary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
          ),
        ),
      );
      return;
    }

    toolbarHost = h('div.editor-toolbar.card.compact.no-print');
    wrapper.appendChild(toolbarHost);
    buildToolbar();

    errorsHost = h('div.editor-errors');
    wrapper.appendChild(errorsHost);
    renderErrors();

    const layout = h('div.editor-layout');
    mainHost = h('div.editor-main');
    sideHost = h('aside.editor-side');
    layout.append(mainHost, sideHost);
    wrapper.appendChild(layout);

    buildMetaCard();
    buildPaletteCard();
    itemListHost = h('div.item-list');
    mainHost.appendChild(itemListHost);
    renderItemList();
    buildSide();
  }

  function buildToolbar() {
    clear(toolbarHost);
    saveStatusEl = h('div.save-state');
    const backLink = h(
      'a.btn.btn-ghost.btn-sm',
      { href: '/teacher/dashboard', title: t('teacher.back_to_dashboard') },
      h('span', { html: icon('arrow-left', { size: 16 }) }),
      h('span.hide-sm', t('teacher.back_to_dashboard')),
    );
    const previewButton = h(
      'button.btn.btn-secondary.btn-sm.worksheet-preview-button',
      { type: 'button', title: t('teacher.preview_worksheet_hint') },
      h('span', { html: icon('eye', { size: 16 }) }),
      h('span', t('common.preview')),
    );
    previewButton.addEventListener('click', () => {
      openWorksheetPreview();
    });
    const printButton = h(
      'button.btn.btn-secondary.btn-sm',
      { type: 'button', title: t('teacher.print_worksheet') },
      h('span', { html: icon('printer', { size: 16 }) }),
      h('span', t('common.print')),
    );
    printButton.addEventListener('click', () => window.open(`/teacher/print?activity=${encodeURIComponent(activityId)}`, '_blank'));
    const saveButton = h(
      'button.btn.btn-ghost.btn-sm',
      { type: 'button', title: t('teacher.save_now') },
      h('span', { html: icon('save', { size: 16 }) }),
    );
    saveButton.addEventListener('click', async () => {
      saveDebounced.cancel();
      await requestSave();
    });
    const publishButton = h(
      'button.btn.btn-primary.btn-sm',
      { type: 'button' },
      h('span', { html: icon('play', { size: 16 }) }),
      h('span', t('common.publish')),
    );
    publishButton.addEventListener('click', async () => {
      const saved = await flushSave();
      if (state.conflict) {
        toast(t('teacher.resolve_conflict_first'), 'warning');
        return;
      }
      if (!saved) {
        toast(t('teacher.save_failed'), 'warning');
        return;
      }
      await openPublishDialog({
        activityId,
        defaultTitle: state.doc.title,
        onPublished: () => {
          state.status = 'published';
        },
      });
    });
    const statusBadge = h(
      `span.badge.${state.status === 'published' ? 'badge-success' : 'badge'}`,
      t(state.status === 'published' ? 'teacher.status_published' : 'teacher.status_draft'),
    );
    toolbarHost.append(
      h(
        'div.row.between.wrap.gap-2',
        h(
          'div.row.gap-2.wrap',
          backLink,
          h('span.strong.editor-heading', t('teacher.edit_title')),
          statusBadge,
          saveStatusEl,
        ),
        h('div.row.gap-2', previewButton, saveButton, printButton, publishButton),
      ),
    );
    updateSaveStatus();
  }

  function renderErrors() {
    if (!errorsHost) return;
    clear(errorsHost);
    if (state.conflict) {
      const reloadButton = h('button.btn.btn-sm.btn-danger', { type: 'button' }, t('teacher.reload'));
      reloadButton.addEventListener('click', () => reloadFromServer({ confirm: true }));
      errorsHost.appendChild(
        h(
          'div.card.compact.conflict-banner',
          h('div.row.between.wrap.gap-2',
            h(
              'div',
              h('p.strong.mb-1', t('teacher.conflict_title')),
              h('p.small.muted.mb-0', t('teacher.conflict_message')),
            ),
            h('div.row.gap-2', reloadButton),
          ),
        ),
      );
      return;
    }
    if (state.validationErrors.length > 0) {
      errorsHost.appendChild(
        h(
          'div.card.compact.validation-banner',
          h('p.strong.mb-1', t('teacher.validation_failed')),
          h(
            'ul.small',
            state.validationErrors.map((detail) => {
              const path = detail && detail.path ? String(detail.path) : '';
              const message = detail && detail.message ? String(detail.message) : '';
              return h('li', path ? `${path}: ${message}` : message);
            }),
          ),
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Rendering: meta (title/description/template/locale)
  // -------------------------------------------------------------------------

  function buildMetaCard() {
    const titleId = 'activity-title';
    const titleInput = h('input.input.input-lg', {
      id: titleId,
      type: 'text',
      value: state.doc.title || '',
      placeholder: t('teacher.untitled'),
      maxlength: 200,
      on: {
        input: (event) => {
          state.doc.title = event.target.value;
          scheduleChange();
        },
      },
    });
    const descriptionInput = h('textarea.textarea', {
      rows: 2,
      value: state.doc.description || '',
      placeholder: t('teacher.description_placeholder'),
      on: {
        input: (event) => {
          state.doc.description = event.target.value;
          scheduleChange();
        },
      },
    });
    const templateSelect = h(
      'select.select',
      {
        on: {
          change: (event) => {
            state.doc.template = event.target.value;
            scheduleChange();
          },
        },
      },
      h('option', { value: 'worksheet', selected: state.doc.template === 'worksheet' }, t('teacher.template_worksheet')),
      h('option', { value: 'quiz', selected: state.doc.template === 'quiz' }, t('teacher.template_quiz')),
    );
    const localeSelect = h(
      'select.select',
      {
        on: {
          change: (event) => {
            state.doc.locale = event.target.value;
            scheduleChange();
          },
        },
      },
      h('option', { value: 'de', selected: state.doc.locale === 'de' }, t('teacher.locale_de')),
      h('option', { value: 'en', selected: state.doc.locale === 'en' }, t('teacher.locale_en')),
    );

    const card = h(
      'div.card.compact.editor-meta',
      h('div.field.mb-2', h('label.label', { for: titleId }, t('common.title')), titleInput),
      h('div.field.mb-2', h('label.label', t('common.description')), descriptionInput),
      h(
        'div.grid.grid-2',
        h('div.field.mb-0', h('label.label', t('teacher.template')), templateSelect, h('p.help', t('teacher.template_help'))),
        h('div.field.mb-0', h('label.label', t('teacher.activity_locale')), localeSelect, h('p.help', t('teacher.activity_locale_help'))),
      ),
    );
    mainHost.appendChild(card);
    metaHost = card;
  }

  // -------------------------------------------------------------------------
  // Rendering: palette + item list
  // -------------------------------------------------------------------------

  function buildPaletteCard() {
    const card = h(
      'div.card.compact.palette-card.no-print',
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('teacher.add_items')), h('p.card-subtitle', t('teacher.add_items_hint'))),
      ),
    );
    paletteHost = h('div.palette');
    card.appendChild(paletteHost);
    mainHost.appendChild(card);
    renderPalette();
  }

  function renderPalette() {
    if (!paletteHost) return;
    clear(paletteHost);
    if (!state.paletteReady) {
      paletteHost.appendChild(h('div.loading-block', { role: 'status' }, h('span.spinner.spinner-sm', { 'aria-hidden': 'true' }), h('span.small', t('common.loading'))));
      return;
    }
    const groups = new Map();
    for (const entry of state.palette) {
      const category = entry.category || 'content';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(entry);
    }
    for (const [category, entries] of groups) {
      paletteHost.appendChild(
        h(
          'div.palette-group',
          h('span.palette-title', categoryLabel(category)),
          h(
            'div.row.wrap.gap-2',
            entries.map((entry) => {
              const button = h(
                'button.btn.btn-sm.btn-secondary.palette-button',
                { type: 'button', title: t('teacher.add_item_hint', { type: typeLabel(entry.type) }) },
                h('span.palette-emoji', { 'aria-hidden': 'true', text: typeEmoji(entry.type) }),
                h('span', typeLabel(entry.type)),
              );
              button.addEventListener('click', () => addItem(entry.type));
              return button;
            }),
          ),
        ),
      );
    }
    if (state.palette.length === 0) paletteHost.appendChild(h('p.help', t('teacher.no_item_types')));
  }

  function addItem(type) {
    const item = createItem(type);
    item.id = newItemId();
    if (!isScoreableType(type)) item.points = 0;
    const selectedIndex = state.doc.items.findIndex((entry) => entry.id === state.selectedItemId);
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : state.doc.items.length;
    state.doc.items.splice(insertAt, 0, item);
    state.selectedItemId = item.id;
    scheduleChange();
    renderItemList();
    renderPreview();
    const node = itemListHost && itemListHost.querySelector(`[data-item-id="${item.id}"]`);
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function selectItem(itemId) {
    if (state.selectedItemId === itemId) return;
    state.selectedItemId = itemId;
    updateSelectionClasses();
    renderPreview();
  }

  function updateSelectionClasses() {
    if (!itemListHost) return;
    itemListHost.querySelectorAll('.item-card[data-item-id]').forEach((node) => {
      const isSelected = node.dataset.itemId === state.selectedItemId;
      node.classList.toggle('is-selected', isSelected);
    });
  }

  function moveItem(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= state.doc.items.length) return;
    const [item] = state.doc.items.splice(index, 1);
    state.doc.items.splice(next, 0, item);
    scheduleChange();
    renderItemList();
  }

  function duplicateItem(index) {
    const source = state.doc.items[index];
    if (!source) return;
    const copy = regenerateItemIds(deepClone(source));
    if (!copy.id) copy.id = newItemId();
    state.doc.items.splice(index + 1, 0, copy);
    state.selectedItemId = copy.id;
    scheduleChange();
    renderItemList();
    renderPreview();
  }

  function deleteItem(index) {
    const item = state.doc.items[index];
    if (!item) return;
    state.doc.items.splice(index, 1);
    if (state.selectedItemId === item.id) {
      state.selectedItemId = state.doc.items.length ? state.doc.items[Math.min(index, state.doc.items.length - 1)].id : null;
    }
    scheduleChange();
    renderItemList();
    renderPreview();
  }

  function renderItemList() {
    if (!itemListHost) return;
    clear(itemListHost);
    if (state.doc.items.length === 0) {
      itemListHost.appendChild(
        h(
          'div.empty.editor-empty',
          h('p.empty-title', t('teacher.no_items')),
          h('p.empty-hint.small.muted', t('teacher.no_items_hint')),
        ),
      );
      return;
    }
    state.doc.items.forEach((item, index) => {
      itemListHost.appendChild(buildItemCard(item, index));
    });
    // "Add item" button at the bottom of the list → jumps to the palette
    const addBottom = h(
      'button.btn.btn-secondary.btn-block.editor-add-bottom.no-print',
      { type: 'button', on: { click: () => focusPalette() } },
      h('span', { html: icon('plus', { size: 16 }) }),
      h('span', t('teacher.add_item_bottom')),
    );
    itemListHost.appendChild(h('div.editor-add-bottom-wrap.mt-2', addBottom));
    updateSelectionClasses();
  }

  function focusPalette() {
    const card = mainHost && mainHost.querySelector('.palette-card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('palette-flash');
    setTimeout(() => card.classList.remove('palette-flash'), 1600);
  }

  // -------------------------------------------------------------------------
  // Rendering: single item card
  // -------------------------------------------------------------------------

  function buildItemCard(item, index) {
    const collapsed = state.collapsed.has(item.id);
    const card = h('article.item-card', {
      'data-item-id': item.id,
      class: [state.selectedItemId === item.id ? 'is-selected' : '', collapsed ? 'is-collapsed' : ''].filter(Boolean).join(' '),
    });
    card.addEventListener('click', () => selectItem(item.id));
    card.addEventListener('focusin', () => selectItem(item.id));

    const typeBadge = h('span.badge.badge-primary.item-type-badge', typeLabel(item.type));
    const pointsBadge = h(
      'span.small.muted.item-points',
      isScoreableType(item.type) ? t('teacher.points_short', { n: item.points }) : t('teacher.no_points'),
    );

    const iconBtn = (iconName, label, onClick, { danger = false, disabled = false } = {}) => {
      const button = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        { type: 'button', title: label, 'aria-label': label, disabled },
        h('span', { html: icon(iconName, { size: 16 }) }),
      );
      button.classList.toggle('text-danger', danger);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!disabled) onClick();
      });
      return button;
    };

    const upButton = iconBtn('chevron-up', t('teacher.move_up'), () => moveItem(index, -1), { disabled: index === 0 });
    const downButton = iconBtn('chevron-down', t('teacher.move_down'), () => moveItem(index, 1), {
      disabled: index === state.doc.items.length - 1,
    });
    const duplicateButton = iconBtn('copy', t('teacher.duplicate_item'), () => duplicateItem(index));
    const collapseButton = iconBtn(collapsed ? 'chevron-down' : 'chevron-up', t(collapsed ? 'teacher.expand' : 'teacher.collapse'), () => {
      if (state.collapsed.has(item.id)) state.collapsed.delete(item.id);
      else state.collapsed.add(item.id);
      renderItemList();
    });
    const deleteButton = iconBtn('trash', t('teacher.delete_item'), () => deleteItem(index), { danger: true });

    const header = h(
      'header.item-head',
      h('span.item-number', String(index + 1)),
      typeBadge,
      pointsBadge,
      h('div.item-head-actions.ml-auto', upButton, downButton, duplicateButton, collapseButton, deleteButton),
    );

    const body = h('div.item-body');
    body.appendChild(buildItemFields(item));
    card.append(header, body);
    if (collapsed) body.hidden = true;
    return card;
  }

  function buildItemFields(item) {
    const body = h('div.item-fields');
    const stemId = `stem-${item.id}`;
    const stemInput = h('textarea.textarea', {
      id: stemId,
      rows: item.type === 'text' ? 4 : 3,
      value: item.stem || '',
      placeholder: t('teacher.stem_placeholder'),
      on: {
        input: (event) => {
          item.stem = event.target.value;
          scheduleChange();
        },
      },
    });
    const helpId = `help-${item.id}`;
    const helpInput = h('input.input', {
      id: helpId,
      type: 'text',
      value: item.help || '',
      placeholder: t('teacher.help_placeholder'),
      on: {
        input: (event) => {
          item.help = event.target.value;
          scheduleChange();
        },
      },
    });
    const pointsId = `points-${item.id}`;
    // text blocks may carry points once they contain <<gap>> markers
    const pointsDisabled = item.type === 'text' ? false : !isScoreableType(item.type);
    const pointsInput = h('input.input.input-sm', {
      id: pointsId,
      type: 'number',
      min: 0,
      step: 0.5,
      value: String(pointsDisabled ? 0 : item.points ?? 0),
      disabled: pointsDisabled,
      on: {
        input: (event) => {
          const parsed = Number(event.target.value);
          item.points = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
          scheduleChange();
          updatePointsBadges();
        },
      },
    });

    body.append(
      h('div.field', h('label.label', { for: stemId }, item.type === 'text' ? t('teacher.text_block') : t('teacher.stem')), stemInput),
      h(
        'div.grid.item-meta-grid',
        h('div.field.mb-0', h('label.label', { for: helpId }, t('teacher.help')), helpInput),
        h(
          'div.field.mb-0.field-points',
          h('label.label', { for: pointsId }, t('common.points')),
          pointsInput,
          item.type === 'text' ? h('p.help', t('teacher.text_points_hint')) : pointsDisabled ? h('p.help', t('teacher.text_no_points')) : null,
        ),
      ),
    );

    body.appendChild(buildMediaEditor(item, item.media || { type: 'none' }));

    const configHost = h('div.item-config');
    const schema = editSchemaFor(item.type);
    renderConfigForm(configHost, {
      item,
      schema,
      onChange: scheduleChange,
    });
    body.appendChild(h('div.field-label-row', h('span.label', t('teacher.type_config'))));
    body.appendChild(configHost);

    if (!hasSharedRegistry()) {
      body.appendChild(h('p.help.mt-1', t('teacher.registry_fallback_hint')));
    }

    body.appendChild(buildFeedbackEditor(item));
    body.appendChild(buildAdvancedJson(item));
    return body;
  }

  function updatePointsBadges() {
    if (!itemListHost) return;
    const items = state.doc.items;
    itemListHost.querySelectorAll('.item-card').forEach((node, index) => {
      const badge = node.querySelector('.item-points');
      const item = items[index];
      if (badge && item) {
        badge.textContent = isScoreableType(item.type) ? t('teacher.points_short', { n: item.points }) : t('teacher.no_points');
      }
    });
  }

  // -------------------------------------------------------------------------
  // Media editor
  // -------------------------------------------------------------------------

  function buildMediaEditor(item, media) {
    const host = h('div.media-editor');
    function paint() {
      clear(host);
      const current = item.media || { type: 'none' };
      host.appendChild(h('span.label', t('teacher.media')));
      if (current.type === 'image' && current.assetId) {
        host.appendChild(
          h(
            'div.media-preview',
            h('img.media-thumb', { src: assetUrl(current.assetId), alt: current.alt || '' }),
            h(
              'div.media-meta',
              h(
                'div.field.mb-2',
                h('label.label', t('teacher.image_alt')),
                (() => {
                  const altId = `alt-${item.id}`;
                  const alt = h('input.input', {
                    id: altId,
                    type: 'text',
                    value: current.alt || '',
                    on: {
                      input: (event) => {
                        item.media = { ...current, alt: event.target.value };
                        scheduleChange();
                      },
                    },
                  });
                  return alt;
                })(),
              ),
              h(
                'div.row.gap-2',
                h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => imageInput.click() } }, t('teacher.replace_image')),
                h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => setMedia({ type: 'none' }) } }, t('common.remove')),
              ),
            ),
          ),
        );
      } else if (current.type === 'audio' && current.assetId) {
        const audio = h('audio', { controls: true, src: assetUrl(current.assetId) });
        host.appendChild(
          h(
            'div.media-preview.media-preview-audio',
            audio,
            h(
              'div.row.gap-2',
              h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => audioInput.click() } }, t('teacher.replace_audio')),
              h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => setMedia({ type: 'none' }) } }, t('common.remove')),
            ),
          ),
        );
      } else if (current.type === 'video' && current.url) {
        const videoId = `video-${item.id}`;
        const input = h('input.input', {
          id: videoId,
          type: 'url',
          value: current.url,
          on: {
            input: (event) => {
              const url = event.target.value.trim();
              item.media = url ? { type: 'video', url } : { type: 'none' };
              scheduleChange();
            },
          },
        });
        host.appendChild(
          h(
            'div.media-preview',
            h('div.field.mb-2', h('label.label', { for: videoId }, t('teacher.video_url')), input),
            h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => setMedia({ type: 'none' }) } }, t('common.remove')),
          ),
        );
      } else {
        host.appendChild(
          h(
            'div.row.wrap.gap-2.media-actions',
            h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => imageInput.click() } }, t('teacher.upload_image')),
            h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => audioInput.click() } }, t('teacher.upload_audio')),
            h(
              'button.btn.btn-sm.btn-ghost',
              {
                type: 'button',
                on: {
                  click: () => {
                    item.media = { type: 'video', url: '' };
                    paint();
                    scheduleChange();
                  },
                },
              },
              t('teacher.add_video'),
            ),
          ),
        );
        host.appendChild(h('p.help', t('teacher.media_hint')));
      }
      host.appendChild(imageInput);
      host.appendChild(audioInput);
    }

    function setMedia(mediaObject) {
      item.media = mediaObject;
      paint();
      scheduleChange();
    }

    const imageInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only' });
    imageInput.addEventListener('change', async () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = '';
      if (!file) return;
      await uploadMedia(file, 'image');
    });
    const audioInput = h('input', { type: 'file', accept: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm', class: 'sr-only' });
    audioInput.addEventListener('change', async () => {
      const file = audioInput.files && audioInput.files[0];
      audioInput.value = '';
      if (!file) return;
      await uploadMedia(file, 'audio');
    });

    async function uploadMedia(file, kind) {
      host.classList.add('is-uploading');
      try {
        const result = await uploadAsset(file);
        if (result && result.asset) {
          rememberAssetUrl(result.asset);
          if (kind === 'image') item.media = { type: 'image', assetId: result.asset.id, alt: item.stem || '' };
          else item.media = { type: 'audio', assetId: result.asset.id };
          paint();
          scheduleChange();
          toast(t('teacher.media_uploaded'), 'success');
        }
      } catch (error) {
        toast(errorMessage(error), 'error');
      } finally {
        host.classList.remove('is-uploading');
      }
    }

    paint();
    return host;
  }

  // -------------------------------------------------------------------------
  // Feedback + advanced JSON
  // -------------------------------------------------------------------------

  function buildFeedbackEditor(item) {
    const details = h('details.item-extra', h('summary.small', t('teacher.feedback_optional')));
    if (!item.feedback || typeof item.feedback !== 'object') item.feedback = { correct: '', incorrect: '' };
    const correct = h('input.input', {
      type: 'text',
      value: item.feedback.correct || '',
      placeholder: t('teacher.feedback_correct_placeholder'),
      on: {
        input: (event) => {
          item.feedback.correct = event.target.value;
          scheduleChange();
        },
      },
    });
    const incorrect = h('input.input', {
      type: 'text',
      value: item.feedback.incorrect || '',
      placeholder: t('teacher.feedback_incorrect_placeholder'),
      on: {
        input: (event) => {
          item.feedback.incorrect = event.target.value;
          scheduleChange();
        },
      },
    });
    details.append(
      h('div.field.field-sm', h('label.label', t('teacher.feedback_correct')), correct),
      h('div.field.field-sm', h('label.label', t('teacher.feedback_incorrect')), incorrect),
    );
    return details;
  }

  function buildAdvancedJson(item) {
    const details = h('details.item-extra', h('summary.small', t('teacher.advanced_json')));
    const textarea = h('textarea.textarea.textarea-code', { rows: 6, spellcheck: 'false' });
    textarea.value = JSON.stringify(item.config, null, 2);
    const errorBox = h('p.error-text', { hidden: true });
    const applyButton = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.apply_json'));
    applyButton.addEventListener('click', (event) => {
      event.stopPropagation();
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch {
        errorBox.textContent = t('teacher.invalid_json');
        errorBox.hidden = false;
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errorBox.textContent = t('teacher.json_must_be_object');
        errorBox.hidden = false;
        return;
      }
      item.config = parsed;
      errorBox.hidden = true;
      scheduleChange();
      renderItemList();
      renderPreview();
      toast(t('teacher.json_applied'), 'success');
    });
    details.append(
      h('p.help', t('teacher.advanced_json_help')),
      textarea,
      h('div.row.gap-2.mt-2', applyButton),
      errorBox,
    );
    return details;
  }

  // -------------------------------------------------------------------------
  // Rendering: side panel (preview + settings)
  // -------------------------------------------------------------------------

  function buildSide() {
    clear(sideHost);
    const previewCard = h('div.card.compact.preview-card');
    previewCard.appendChild(
      h(
        'div.card-header',
        h('div', h('h2.card-title', t('common.preview')), h('p.card-subtitle', t('teacher.preview_hint'))),
      ),
    );
    previewInfoHost = h('div.preview-info');
    previewCard.appendChild(previewInfoHost);
    previewHost = h('div.preview-mount');
    previewCard.appendChild(previewHost);
    sideHost.appendChild(previewCard);

    const settingsCard = h('div.card.compact.settings-card');
    settingsCard.appendChild(h('div.card-header', h('div', h('h2.card-title', t('common.settings')))));
    settingsHost = h('div.settings-body');
    settingsCard.appendChild(settingsHost);
    sideHost.appendChild(settingsCard);
    renderSettings();
    renderPreview();
  }

  function renderSettings() {
    if (!settingsHost) return;
    clear(settingsHost);
    const settings = state.doc.settings;
    if (!settings.accessibility) settings.accessibility = defaultSettings().accessibility;

    const switchRow = (key, de, en, helpKey) => {
      const label = getLocale() === 'en' ? en : de;
      const input = h('input', {
        type: 'checkbox',
        checked: Boolean(settings[key]),
        on: {
          change: (event) => {
            settings[key] = event.target.checked;
            scheduleChange();
            if (key === 'showAnswers' || key === 'allowReview') renderPreview();
          },
        },
      });
      return h(
        'label.switch.setting-row',
        input,
        h('span.track', { 'aria-hidden': 'true' }),
        h('span.setting-text', h('span.small', label), helpKey ? h('span.tiny.muted.setting-help', helpKey) : null),
      );
    };

    settingsHost.appendChild(
      h(
        'div.settings-group',
        switchRow('instantFeedback', 'Sofortiges Feedback', 'Instant feedback', t('teacher.setting_instant_feedback_help')),
        switchRow('shuffleItems', 'Aufgaben mischen', 'Shuffle items'),
        switchRow('showResults', 'Ergebnis nach Abgabe zeigen', 'Show results after submit'),
        switchRow('allowReview', 'Erneut ansehen erlauben', 'Allow review after submit'),
        switchRow('showAnswers', 'Lösungen zeigen', 'Show answers', t('teacher.setting_show_answers_help')),
        switchRow('warnUnanswered', 'Bei offenen Fragen warnen', 'Warn about unanswered questions'),
        switchRow('requireName', 'Namen verlangen', 'Require name'),
        switchRow('practice', 'Übungsmodus (nicht gewertet)', 'Practice mode (not graded)', t('teacher.setting_practice_help')),
      ),
    );

    const timeLimitSwitch = h('input', {
      type: 'checkbox',
      checked: settings.timeLimitMinutes !== null && settings.timeLimitMinutes !== undefined,
      on: {
        change: (event) => {
          settings.timeLimitMinutes = event.target.checked ? 30 : null;
          renderSettings();
          scheduleChange();
        },
      },
    });
    const limitId = 'time-limit-minutes';
    const timeInput = h('input.input.input-sm', {
      id: limitId,
      type: 'number',
      min: 1,
      max: 600,
      step: 1,
      value: settings.timeLimitMinutes === null || settings.timeLimitMinutes === undefined ? '' : String(settings.timeLimitMinutes),
      disabled: settings.timeLimitMinutes === null || settings.timeLimitMinutes === undefined,
      on: {
        input: (event) => {
          const parsed = Number(event.target.value);
          settings.timeLimitMinutes = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
          scheduleChange();
        },
      },
    });
    settingsHost.appendChild(
      h(
        'div.settings-group',
        h(
          'label.switch.setting-row',
          timeLimitSwitch,
          h('span.track', { 'aria-hidden': 'true' }),
          h('span.setting-text', h('span.small', t('teacher.time_limit'))),
        ),
        h(
          'div.field.field-sm.mb-0',
          h('label.label', { for: limitId }, t('teacher.time_limit_minutes')),
          timeInput,
          h('p.help', t('teacher.time_limit_help')),
        ),
      ),
    );

    settingsHost.appendChild(
      h(
        'div.settings-group',
        h('p.label.mb-1', t('teacher.accessibility')),
        [
          ['tts', 'Vorlesen erlauben', 'Allow text-to-speech'],
          ['starQuestions', 'Fragen markieren erlauben', 'Allow starring questions'],
          ['fontScale', 'Schriftgröße anpassen erlauben', 'Allow font scaling'],
        ].map(([key, de, en]) => {
          const input = h('input', {
            type: 'checkbox',
            checked: settings.accessibility[key] !== false,
            on: {
              change: (event) => {
                settings.accessibility[key] = event.target.checked;
                scheduleChange();
              },
            },
          });
          return h(
            'label.switch.setting-row',
            input,
            h('span.track', { 'aria-hidden': 'true' }),
            h('span.setting-text', h('span.small', getLocale() === 'en' ? en : de)),
          );
        }),
      ),
    );
  }

  function selectedItem() {
    return state.doc.items.find((item) => item.id === state.selectedItemId) || null;
  }

  /**
   * Full-worksheet preview: mounts every item with the real student renderers
   * (interactive, local only) so the teacher can test the worksheet — including
   * drag & drop — before publishing. "Auswerten" scores locally via scoreItem.
   */
  async function openWorksheetPreview() {
    const doc = state.doc;
    const body = h('div.worksheet-preview');
    if (!doc.items.length) body.appendChild(h('p.help', t('teacher.preview_empty')));
    const evalButton = h('button.btn.btn-primary.btn-sm', { type: 'button' }, t('teacher.preview_evaluate'));
    const scoreOut = h('span.small.muted.ml-2');
    const footer = h('div.row.gap-2.mt-3.align-center', evalButton, scoreOut);
    const dialog = modal({
      title: `${t('common.preview')}: ${doc.title || t('teacher.edit_title')}`,
      body: h('div', body, footer),
      actions: [],
    });
    dialog.dialog.classList.add('worksheet-preview-dialog');

    const instances = [];
    for (const item of doc.items) {
      const card = h('div.card.compact.preview-item');
      card.appendChild(
        h('div.row.gap-2.mb-1',
          h('span.badge.badge-primary', `${typeEmoji(item.type)} ${typeLabel(item.type)}`)),
      );
      const mountEl = h('div.preview-mount-item');
      card.appendChild(mountEl);
      body.appendChild(card);
      const instance = await mountItemSafe(mountEl, {
        item: deepClone(item),
        mode: 'preview',
        locale: doc.locale,
        response: {},
      });
      instances.push({ item, instance });
    }

    evalButton.addEventListener('click', async () => {
      const { scoreItem } = await import('/shared/items/index.js');
      let score = 0;
      let max = 0;
      for (const { item, instance } of instances) {
        let response = {};
        try {
          response = instance && typeof instance.getResponse === 'function' ? instance.getResponse() : {};
        } catch {
          response = {};
        }
        const result = scoreItem(item, response || {});
        if (instance && typeof instance.setResult === 'function') instance.setResult(result);
        score += Number(result.autoScore) || 0;
        max += Number(result.maxScore) || 0;
      }
      scoreOut.textContent = t('teacher.preview_score', { score, max });
    });

    dialog.dialog.addEventListener('close', () => {
      for (const { instance } of instances) {
        if (instance && typeof instance.destroy === 'function') instance.destroy();
      }
    });
  }

  async function renderPreview() {
    if (!previewHost || disposed) return;
    const token = ++previewToken;
    if (previewInstance && typeof previewInstance.destroy === 'function') {
      try {
        previewInstance.destroy();
      } catch {
        /* ignore */
      }
    }
    previewInstance = null;
    clear(previewHost);
    clear(previewInfoHost);
    const item = selectedItem();
    if (!item) {
      previewInfoHost.appendChild(h('p.small.muted', t('teacher.preview_no_selection')));
      return;
    }
    const pointsText = isScoreableType(item.type) ? t('teacher.points_short', { n: item.points }) : t('teacher.no_points');
    previewInfoHost.append(
      h('div.row.wrap.gap-2', h('span.badge.badge-primary', typeLabel(item.type)), h('span.small.muted', pointsText)),
    );
    const previewItem = deepClone(item);
    previewHost.appendChild(h('div.preview-loading.small.muted', t('common.loading')));
    const instance = await mountItemSafe(previewHost, {
      item: previewItem,
      mode: 'preview',
      locale: state.doc.locale || getLocale(),
      seed: 1234,
      showAnswers: true,
      disabled: false,
    });
    if (disposed || token !== previewToken) {
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    previewInstance = instance;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  function onBeforeUnload(event) {
    if (state.dirty || state.saveState === 'saving') {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  // Ctrl+V with an image on the clipboard: when a text field is focused, the
  // field's own paste handler inserts it as markdown; anywhere else in the
  // editor we create a new "Kästchen im Bild" (image_boxes) item with the
  // pasted picture so the teacher can draw the boxes right away.
  const onPasteImage = async (event) => {
    if (disposed) return;
    const target = event.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const files = event.clipboardData && event.clipboardData.files;
    const image = files && Array.from(files).find((file) => file.type && file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    try {
      const result = await uploadAsset(image);
      if (result && result.asset) {
        rememberAssetUrl(result.asset);
        const item = createItem('image_boxes');
        item.id = newItemId();
        item.points = 2;
        item.stem = t('teacher.ib_default_stem');
        item.config.image = { assetId: result.asset.id, alt: result.asset.filename || '' };
        const selectedIndex = state.doc.items.findIndex((entry) => entry.id === state.selectedItemId);
        const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : state.doc.items.length;
        state.doc.items.splice(insertAt, 0, item);
        state.selectedItemId = item.id;
        scheduleChange();
        renderItemList();
        renderPreview();
        const node = itemListHost && itemListHost.querySelector(`[data-item-id="${item.id}"]`);
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        toast(t('teacher.image_pasted'), 'success');
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };
  document.addEventListener('paste', onPasteImage);

  renderAll();
  await Promise.all([loadActivity(), loadPaletteData()]);

  return () => {
    disposed = true;
    saveDebounced.cancel();
    previewDebounced.cancel();
    if (previewInstance && typeof previewInstance.destroy === 'function') {
      try {
        previewInstance.destroy();
      } catch {
        /* ignore */
      }
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('paste', onPasteImage);
    if (state.dirty) {
      saveDebounced.cancel();
      requestSave();
    }
  };
}
