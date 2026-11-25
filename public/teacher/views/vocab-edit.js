// Teacher view: edit one vocabulary list — title/langs, entry grid with
// image/audio pickers, CSV import, save (PUT replaces entries), delete.
import { get, post, put, del } from '/lib/api.js';
import { h, clear, toast, confirmDialog, modal } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { uploadAsset } from '/lib/api.js';
import { assetUrl } from '../lib/core.js';
import { navigate } from '../lib/core.js';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm';

let uidCounter = 0;
function uid(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function mount(root, ctx) {
  const listId = ctx.params.get('id');
  ctx.setTitle(t('teacher.vocab_edit_title'));
  if (!listId) {
    navigate('/teacher/vocab', { replace: true });
    return;
  }
  root.appendChild(h('div.loading-block', { role: 'status' }, h('span.spinner.spinner-sm', { 'aria-hidden': 'true' })));

  let data;
  try {
    data = await get(`/api/vocab-lists/${encodeURIComponent(listId)}`);
  } catch (error) {
    clear(root);
    root.appendChild(h('div.card.error-card',
      h('h2', t('common.error')),
      h('p.muted', String(error && error.message ? error.message : error)),
      h('a.btn.btn-primary', { href: '/teacher/vocab' }, t('teacher.back_to_vocab')),
    ));
    return;
  }

  const state = {
    title: data.list.title,
    description: data.list.description || '',
    sourceLang: data.list.sourceLang || 'de',
    targetLang: data.list.targetLang || 'en',
    entries: (data.entries || []).map((entry) => ({
      id: entry.id,
      term: entry.term,
      translation: entry.translation,
      alternatives: Array.isArray(entry.alternatives) ? entry.alternatives : [],
      example: entry.example || '',
      imageAssetId: entry.imageAssetId || '',
      audioAssetId: entry.audioAssetId || '',
      notes: entry.notes || '',
    })),
  };

  let saving = false;

  async function save() {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    try {
      const payload = {
        title: state.title,
        description: state.description,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang,
        entries: state.entries.map((entry) => ({
          term: entry.term,
          translation: entry.translation,
          alternatives: entry.alternatives,
          example: entry.example,
          imageAssetId: entry.imageAssetId,
          audioAssetId: entry.audioAssetId,
          notes: entry.notes,
        })),
      };
      await put(`/api/vocab-lists/${encodeURIComponent(listId)}`, payload);
      toast(t('teacher.vocab_saved'), 'success');
    } catch (error) {
      toast(String(error && error.message ? error.message : error), 'error');
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  const titleInput = h('input.input', { type: 'text', maxlength: 200, value: state.title });
  titleInput.addEventListener('input', () => { state.title = titleInput.value; });
  const descInput = h('textarea.textarea', { rows: 2, maxlength: 2000, value: state.description });
  descInput.addEventListener('input', () => { state.description = descInput.value; });
  const srcInput = h('input.input', { type: 'text', maxlength: 10, value: state.sourceLang, style: 'max-width:90px' });
  srcInput.addEventListener('input', () => { state.sourceLang = srcInput.value; });
  const tgtInput = h('input.input', { type: 'text', maxlength: 10, value: state.targetLang, style: 'max-width:90px' });
  tgtInput.addEventListener('input', () => { state.targetLang = tgtInput.value; });

  const gridHost = h('div.vocab-entry-grid');
  const saveBtn = h('button.btn.btn-primary', { type: 'button', on: { click: () => save() } }, h('span', { html: icon('save', { size: 16 }) }), ' ', t('teacher.vocab_save'));

  function renderGrid() {
    clear(gridHost);
    state.entries.forEach((entry, index) => {
      const row = h('div.list-row.vocab-entry-row.card', { dataset: { index: String(index) } });
      const termInput = h('input.input.input-sm.vc-term', { type: 'text', value: entry.term, placeholder: t('teacher.vc_term'), 'aria-label': t('teacher.vc_term') });
      termInput.addEventListener('input', () => { entry.term = termInput.value; });
      const transInput = h('input.input.input-sm.vc-trans', { type: 'text', value: entry.translation, placeholder: t('teacher.vc_translation'), 'aria-label': t('teacher.vc_translation') });
      transInput.addEventListener('input', () => { entry.translation = transInput.value; });
      const altInput = h('input.input.input-sm.vc-alt', { type: 'text', value: entry.alternatives.join(', '), placeholder: t('teacher.vc_alternatives'), 'aria-label': t('teacher.vc_alternatives') });
      altInput.addEventListener('input', () => { entry.alternatives = altInput.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10); });
      const exInput = h('input.input.input-sm.vc-example', { type: 'text', value: entry.example, placeholder: t('teacher.vc_example'), 'aria-label': t('teacher.vc_example') });
      exInput.addEventListener('input', () => { entry.example = exInput.value; });

      const imgInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'sr-only' });
      imgInput.addEventListener('change', async () => {
        const file = imgInput.files && imgInput.files[0];
        if (!file) return;
        try {
          const asset = await uploadAsset(file);
          entry.imageAssetId = asset.id;
          renderGrid();
        } catch (error) {
          toast(String(error && error.message ? error.message : error), 'error');
        }
      });
      const audioInput = h('input', { type: 'file', accept: AUDIO_ACCEPT, class: 'sr-only' });
      audioInput.addEventListener('change', async () => {
        const file = audioInput.files && audioInput.files[0];
        if (!file) return;
        try {
          const asset = await uploadAsset(file);
          entry.audioAssetId = asset.id;
          renderGrid();
        } catch (error) {
          toast(String(error && error.message ? error.message : error), 'error');
        }
      });
      const imgBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', { type: 'button', title: t('teacher.vc_image'), 'aria-label': t('teacher.vc_image'), on: { click: () => imgInput.click() } }, h('span', { html: icon('image', { size: 16 }) }));
      if (entry.imageAssetId) {
        imgBtn.classList.add('has-asset');
        imgBtn.title = t('teacher.pins_replace');
      }
      const audioBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', { type: 'button', title: t('teacher.vc_audio'), 'aria-label': t('teacher.vc_audio'), on: { click: () => audioInput.click() } }, h('span', { html: icon('mic', { size: 16 }) }));
      if (entry.audioAssetId) {
        audioBtn.classList.add('has-asset');
        audioBtn.title = t('teacher.pins_replace');
      }
      const mediaPreview = h('span.row.gap-1.align-center',
        entry.imageAssetId ? h('img.vc-thumb', { src: assetUrl(entry.imageAssetId), alt: '' }) : null,
        entry.audioAssetId ? h('audio.vc-audio', { controls: true, preload: 'none', src: assetUrl(entry.audioAssetId) }) : null,
      );
      const delBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button',
        'aria-label': t('common.remove'),
        on: { click: () => { state.entries.splice(index, 1); renderGrid(); } },
      }, h('span', { html: '✕' }));

      row.append(
        h('div.row.gap-2.align-center.wrap', termInput, transInput, altInput),
        h('div.row.gap-2.align-center.wrap', exInput),
        h('div.row.gap-1.align-center', imgBtn, audioBtn, imgInput, audioInput, mediaPreview, delBtn),
      );
      gridHost.appendChild(row);
    });
    if (state.entries.length === 0) gridHost.appendChild(h('p.help', t('teacher.vc_empty')));
  }

  function openImportDialog() {
    return new Promise((resolve) => {
      const csvInput = h('textarea.textarea#vocab-import-csv', { rows: 8, placeholder: t('teacher.vocab_csv_ph') });
      const errorBox = h('p.error-text', { role: 'alert', hidden: true });
      const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
      const importButton = h('button.btn.btn-primary', { type: 'submit' }, t('teacher.vocab_import'));
      const form = h('form',
        h('div.field', h('label.label', { for: 'vocab-import-csv' }, t('teacher.vocab_csv_label')), csvInput, h('p.help', { text: t('teacher.vocab_csv_help') })),
        errorBox,
        h('div.row.end.gap-2', cancelButton, importButton),
      );
      const dialog = modal({ title: t('teacher.vocab_import'), body: form, actions: [] });
      const close = (result) => { dialog.dialog.close(); resolve(result); };
      cancelButton.addEventListener('click', () => close(null));
      dialog.dialog.addEventListener('close', () => resolve(null));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        importButton.disabled = true;
        try {
          const result = await post(`/api/vocab-lists/${encodeURIComponent(listId)}/import`, { csv: csvInput.value });
          const fresh = await get(`/api/vocab-lists/${encodeURIComponent(listId)}`);
          state.entries = (fresh.entries || []).map((entry) => ({
            id: entry.id, term: entry.term, translation: entry.translation,
            alternatives: Array.isArray(entry.alternatives) ? entry.alternatives : [],
            example: entry.example || '', imageAssetId: entry.imageAssetId || '', audioAssetId: entry.audioAssetId || '', notes: entry.notes || '',
          }));
          renderGrid();
          toast(t('teacher.vocab_imported', { n: String(result.added || 0) }), 'success');
          close(true);
        } catch (error) {
          errorBox.textContent = String(error && error.message ? error.message : error);
          errorBox.hidden = false;
          importButton.disabled = false;
        }
      });
      dialog.dialog.showModal();
    });
  }

  function render() {
    clear(root);
    ctx.setTitle(`${t('teacher.vocab_edit_title')} — ${state.title || data.list.title}`);
    root.appendChild(h('div.row.between.wrap.mb-4',
      h('div', h('h1.page-title', t('teacher.vocab_edit_title')), h('p.muted.mb-0', h('a', { href: '/teacher/vocab' }, t('teacher.back_to_vocab')))),
      h('div.row.gap-2',
        h('button.btn.btn-secondary', { type: 'button', on: { click: () => openImportDialog() } }, t('teacher.vocab_import')),
        h('button.btn.btn-danger', {
          type: 'button',
          on: {
            click: async () => {
              const ok = await confirmDialog({
                title: t('teacher.vocab_delete'),
                message: t('teacher.vocab_delete_confirm', { title: state.title }),
                confirmLabel: t('common.delete'),
                danger: true,
              });
              if (!ok) return;
              try {
                await del(`/api/vocab-lists/${encodeURIComponent(listId)}`);
                toast(t('teacher.vocab_deleted'), 'success');
                navigate('/teacher/vocab');
              } catch (error) {
                toast(String(error && error.message ? error.message : error), 'error');
              }
            },
          },
        }, t('common.delete')),
        saveBtn,
      ),
    ));

    root.appendChild(h('div.card.mb-4',
      h('div.field', h('label.label', t('teacher.vocab_title_field')), titleInput),
      h('div.field', h('label.label', t('teacher.vocab_description')), descInput),
      h('div.row.gap-2',
        h('div.field', h('label.label', t('teacher.vocab_source_lang')), srcInput),
        h('div.field', h('label.label', t('teacher.vocab_target_lang')), tgtInput),
      ),
    ));

    root.appendChild(h('h2.section-title', t('teacher.vocab_entries')));
    renderGrid();
    root.appendChild(gridHost);
    root.appendChild(h('div.row.gap-2.mt-2',
      h('button.btn.btn-sm.btn-secondary', {
        type: 'button',
        on: {
          click: () => {
            state.entries.push({ id: uid('e'), term: '', translation: '', alternatives: [], example: '', imageAssetId: '', audioAssetId: '', notes: '' });
            renderGrid();
          },
        },
      }, h('span', { html: icon('plus', { size: 14 }) }), ' ', t('teacher.vc_add_entry')),
    ));
    root.appendChild(h('div.row.gap-2.mt-4', saveBtn));
  }

  render();
}
