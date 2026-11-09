// Declarative config forms for the authoring editor.
//
// `renderConfigForm()` walks the `editSchema()` returned by the shared item
// registry (or the local fallback in lib/items.js) and renders controls for the
// six contract kinds: text | textarea | number | switch | select | list.
// Two types need custom editors regardless of how the shared schema is worded:
//   - fill_blanks: blanks live in a keyed object, edited per placeholder,
//   - pins: zones are placed by clicking on the image.
// Every change mutates `item.config` and calls onChange() — the editor view
// owns persistence.
import { h, clear } from '/lib/dom.js';
import { t, getLocale } from '/lib/i18n.js';
import { uploadAsset } from '/lib/api.js';
import { assetUrl, rememberAssetUrl } from './core.js';
import { nextConfigId, newRandomId } from './items.js';

let uidCounter = 0;
function uid(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}-${newRandomId().slice(0, 4)}`;
}

function localized(label, fallbackText) {
  if (label && typeof label === 'object') return getLocale() === 'en' ? String(label.en ?? label.de ?? '') : String(label.de ?? label.en ?? '');
  if (typeof label === 'string' && label) {
    const translated = t(label);
    return translated === label ? fallbackText || label : translated;
  }
  return fallbackText || '';
}

function fieldLabel(descriptor) {
  return localized(descriptor && descriptor.label, descriptor && descriptor.key);
}

function fieldHelp(descriptor) {
  if (!descriptor || !descriptor.help) return '';
  if (typeof descriptor.help === 'object') return localized(descriptor.help);
  return localized(descriptor.help) || '';
}

function isSwitchOn(value) {
  return value === true || value === 1 || value === 'true';
}

// ---------------------------------------------------------------------------
// Primitive controls
// ---------------------------------------------------------------------------

function textControl({ value, type = 'text', onInput, id, placeholder, ariaLabel, attrs = {} }) {
  return h('input.input', {
    id,
    type,
    value: value === null || value === undefined ? '' : String(value),
    placeholder: placeholder || undefined,
    'aria-label': ariaLabel || undefined,
    on: { input: (event) => onInput(event.target.value) },
    ...attrs,
  });
}

function renderSwitch(descriptor, target, onChange) {
  const id = uid('switch');
  const input = h('input', {
    id,
    type: 'checkbox',
    checked: isSwitchOn(target[descriptor.key]),
    on: {
      change: (event) => {
        target[descriptor.key] = event.target.checked;
        onChange();
      },
    },
  });
  return h(
    'label.switch.field-row',
    input,
    h('span.track', { 'aria-hidden': 'true' }),
    h('span.small', fieldLabel(descriptor)),
  );
}

function renderNumber(descriptor, target, onChange) {
  const id = uid('num');
  const value = target[descriptor.key];
  const input = h('input.input', {
    id,
    type: 'number',
    value: value === null || value === undefined || value === '' ? '' : String(value),
    min: descriptor.min !== undefined ? descriptor.min : undefined,
    max: descriptor.max !== undefined ? descriptor.max : undefined,
    step: descriptor.step !== undefined ? descriptor.step : 'any',
    on: {
      input: (event) => {
        const raw = event.target.value;
        if (raw === '') {
          target[descriptor.key] = null;
        } else {
          const parsed = Number(raw);
          target[descriptor.key] = Number.isFinite(parsed) ? parsed : null;
        }
        onChange();
      },
    },
  });
  const help = fieldHelp(descriptor);
  return h(
    'div.field.field-sm',
    h('label.label', { for: id }, fieldLabel(descriptor)),
    input,
    help ? h('p.help', help) : null,
  );
}

function renderSelect(descriptor, target, onChange) {
  const id = uid('select');
  const options = Array.isArray(descriptor.options) ? descriptor.options : [];
  const current = target[descriptor.key];
  const select = h(
    'select.select',
    {
      id,
      on: {
        change: (event) => {
          const selected = options[event.target.selectedIndex];
          target[descriptor.key] = selected ? selected.value : event.target.value;
          onChange();
        },
      },
    },
    options.map((option) => {
      const optionValue = option && typeof option === 'object' ? option.value : option;
      const optionLabel = option && typeof option === 'object' ? localized(option.label, String(optionValue)) : String(option);
      const isSelected = current !== undefined && current !== null && String(current) === String(optionValue);
      return h('option', { value: String(optionValue), selected: isSelected }, optionLabel);
    }),
  );
  // Apply selection explicitly — some engines need the property after insert.
  for (const option of Array.from(select.options)) {
    if (option.value === String(current ?? '')) option.selected = true;
  }
  const help = fieldHelp(descriptor);
  return h(
    'div.field.field-sm',
    h('label.label', { for: id }, fieldLabel(descriptor)),
    select,
    help ? h('p.help', help) : null,
  );
}

// ---------------------------------------------------------------------------
// List / repeatable editors
// ---------------------------------------------------------------------------

const ID_PREFIXES = {
  choices: 'c',
  pairs: 'p',
  items: 'i',
  zones: 'z',
  hints: 'h',
  rubric: 'r',
  levels: 'l',
  blanks: 'b',
};

function needsId(key) {
  return ['choices', 'pairs', 'items', 'zones'].includes(key);
}

function fieldsForList(descriptor) {
  if (Array.isArray(descriptor.fields)) return descriptor.fields;
  const schema = descriptor.itemSchema;
  if (Array.isArray(schema)) return schema;
  if (schema && typeof schema === 'object') {
    if (Array.isArray(schema.fields)) return schema.fields;
    const converted = [];
    for (const [key, value] of Object.entries(schema)) {
      if (Array.isArray(value)) {
        converted.push({ key, kind: 'list', itemSchema: { fields: value } });
      } else if (value && typeof value === 'object' && (value.kind || value.label || value.options)) {
        converted.push({ key, ...value });
      } else if (typeof value === 'string') {
        converted.push({ key, kind: 'text', label: { de: key, en: key } });
      }
    }
    if (converted.length) return converted;
  }
  const key = descriptor.key;
  if (key === 'choices') {
    return [
      { key: 'text', kind: 'text', label: { de: 'Text', en: 'Text' } },
      { key: 'correct', kind: 'switch', label: { de: 'Richtig', en: 'Correct' } },
    ];
  }
  if (key === 'pairs') {
    return [
      { key: 'left', kind: 'text', label: { de: 'Links', en: 'Left' } },
      { key: 'right', kind: 'text', label: { de: 'Rechts', en: 'Right' } },
    ];
  }
  if (key === 'zones') return [{ key: 'label', kind: 'text', label: { de: 'Bezeichnung', en: 'Label' } }];
  return [{ key: 'text', kind: 'text', label: { de: 'Text', en: 'Text' } }];
}

/** Heuristic: string-array descriptors ("accepted") use a line editor. */
function isPrimitiveLines(descriptor, value) {
  if (descriptor && (descriptor.primitive === 'lines' || descriptor.itemKind === 'lines')) return true;
  if (descriptor && ['accepted', 'alternatives'].includes(descriptor.key)) return true;
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')) return true;
  return false;
}

function renderLinesEditor(descriptor, target, onChange) {
  const id = uid('lines');
  const current = Array.isArray(target[descriptor.key]) ? target[descriptor.key] : [];
  const textarea = h('textarea.textarea', {
    id,
    rows: 3,
    on: {
      input: (event) => {
        target[descriptor.key] = event.target.value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        onChange();
      },
    },
  });
  textarea.value = current.join('\n');
  const help = fieldHelp(descriptor) || t('teacher.one_per_line');
  return h(
    'div.field.field-sm',
    h('label.label', { for: id }, fieldLabel(descriptor)),
    textarea,
    h('p.help', help),
  );
}

function makeListEntry(descriptor, list) {
  const key = descriptor.key;
  const entry = {};
  const prefix = ID_PREFIXES[key] || 'x';
  if (needsId(key)) entry.id = nextConfigId(list, prefix);
  if (key === 'choices') {
    entry.text = '';
    entry.correct = false;
  } else if (key === 'pairs') {
    entry.left = '';
    entry.right = '';
  } else if (key === 'items') {
    entry.text = '';
  } else if (key === 'zones') {
    entry.label = t('teacher.zone_default', { n: list.length + 1 });
    entry.x = 0.5;
    entry.y = 0.5;
    entry.r = 0.05;
  } else if (key === 'hints') {
    entry.text = '';
    entry.alternatives = [];
    entry.points = 1;
  } else if (key === 'rubric') {
    entry.criterion = '';
    entry.levels = [];
  } else if (key === 'levels') {
    entry.label = '';
    entry.points = 0;
  } else {
    entry.text = '';
  }
  return entry;
}

function ensureEntryIds(descriptor, list) {
  if (!needsId(descriptor.key)) return;
  const prefix = ID_PREFIXES[descriptor.key] || 'x';
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.id || seen.has(entry.id)) {
      entry.id = nextConfigId(list.filter((other) => other !== entry), prefix);
    }
    seen.add(entry.id);
  }
}

function moveInArray(list, index, delta) {
  const next = index + delta;
  if (next < 0 || next >= list.length) return false;
  const [entry] = list.splice(index, 1);
  list.splice(next, 0, entry);
  return true;
}

/**
 * Repeatable list editor. `value` is the array to edit; `onChange` is called
 * after value mutations. The editor re-renders itself on structural changes
 * (add/remove/move) and leaves inputs alone while typing.
 */
function renderListInto(container, descriptor, target, onChange, depth = 0) {
  const key = descriptor.key;
  if (!Array.isArray(target[key])) target[key] = [];
  const list = target[key];
  const fields = fieldsForList(descriptor);
  const primitive = fields.length === 1 && fields[0] && fields[0].key === '$value';
  if (isPrimitiveLines(descriptor, list) || primitive) {
    container.replaceChildren(renderLinesEditor(descriptor, target, onChange));
    return;
  }
  ensureEntryIds(descriptor, list);
  const wrapper = h('div.list-editor');
  const rows = h('div.list-rows');
  const head = h(
    'div.list-head',
    h('span.label', fieldLabel(descriptor)),
    h(
      'button.btn.btn-sm.btn-secondary',
      {
        type: 'button',
        on: {
          click: () => {
            list.push(makeListEntry(descriptor, list));
            renderRows();
            onChange();
          },
        },
      },
      t('teacher.list_add'),
    ),
  );
  const help = fieldHelp(descriptor);
  wrapper.appendChild(head);
  if (help) wrapper.appendChild(h('p.help', help));
  wrapper.appendChild(rows);
  container.replaceChildren(wrapper);

  function renderRows() {
    clear(rows);
    if (list.length === 0) {
      rows.appendChild(h('p.small.muted.empty-inline', t('teacher.list_empty')));
      return;
    }
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        list[index] = {};
        entry = list[index];
      }
      const removeButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        {
          type: 'button',
          title: t('common.remove'),
          'aria-label': t('common.remove'),
          on: {
            click: () => {
              list.splice(index, 1);
              renderRows();
              onChange();
            },
          },
        },
        h('span', { html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' }),
      );
      const upButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        {
          type: 'button',
          title: t('teacher.move_up'),
          'aria-label': t('teacher.move_up'),
          disabled: index === 0,
          on: {
            click: () => {
              if (moveInArray(list, index, -1)) {
                renderRows();
                onChange();
              }
            },
          },
        },
        h('span', { html: '▲' }),
      );
      const downButton = h(
        'button.btn.btn-icon.btn-sm.btn-ghost',
        {
          type: 'button',
          title: t('teacher.move_down'),
          'aria-label': t('teacher.move_down'),
          disabled: index === list.length - 1,
          on: {
            click: () => {
              if (moveInArray(list, index, 1)) {
                renderRows();
                onChange();
              }
            },
          },
        },
        h('span', { html: '▼' }),
      );

      const fieldWrap = h('div.list-fields');
      for (const sub of fields) {
        if (!sub || !sub.key) continue;
        if (sub.kind === 'list') {
          const nestedHost = h('div.list-nested');
          fieldWrap.appendChild(nestedHost);
          if (depth < 2) renderListInto(nestedHost, sub, entry, onChange, depth + 1);
          else nestedHost.appendChild(h('p.help', t('teacher.nested_too_deep')));
          continue;
        }
        if (sub.kind === 'switch') {
          const id = uid('cb');
          fieldWrap.appendChild(
            h(
              'label.checkbox-row.switch-inline',
              h('input', {
                id,
                type: 'checkbox',
                checked: isSwitchOn(entry[sub.key]),
                on: {
                  change: (event) => {
                    entry[sub.key] = event.target.checked;
                    onChange();
                  },
                },
              }),
              h('span.small', fieldLabel(sub)),
            ),
          );
          continue;
        }
        if (sub.kind === 'textarea') {
          const id = uid('ta');
          const area = h('textarea.textarea', {
            id,
            rows: 2,
            on: {
              input: (event) => {
                entry[sub.key] = event.target.value;
                onChange();
              },
            },
          });
          area.value = entry[sub.key] === null || entry[sub.key] === undefined ? '' : String(entry[sub.key]);
          fieldWrap.appendChild(h('div.field.field-sm', h('label.label', { for: id }, fieldLabel(sub)), area));
          continue;
        }
        if (sub.kind === 'number') {
          const id = uid('num');
          fieldWrap.appendChild(
            h(
              'div.field.field-sm',
              h('label.label', { for: id }, fieldLabel(sub)),
              h('input.input', {
                id,
                type: 'number',
                min: sub.min !== undefined ? sub.min : undefined,
                max: sub.max !== undefined ? sub.max : undefined,
                step: sub.step !== undefined ? sub.step : 'any',
                value: entry[sub.key] === null || entry[sub.key] === undefined ? '' : String(entry[sub.key]),
                on: {
                  input: (event) => {
                    const raw = event.target.value;
                    entry[sub.key] = raw === '' ? null : Number(raw);
                    onChange();
                  },
                },
              }),
            ),
          );
          continue;
        }
        if (sub.kind === 'select') {
          const options = Array.isArray(sub.options) ? sub.options : [];
          const current = entry[sub.key];
          const select = h(
            'select.select',
            {
              on: {
                change: (event) => {
                  const selected = options[event.target.selectedIndex];
                  entry[sub.key] = selected ? selected.value : event.target.value;
                  onChange();
                },
              },
            },
            options.map((option) => {
              const optionValue = option && typeof option === 'object' ? option.value : option;
              const optionLabel = option && typeof option === 'object' ? localized(option.label, String(optionValue)) : String(option);
              return h('option', { value: String(optionValue), selected: String(current) === String(optionValue) }, optionLabel);
            }),
          );
          fieldWrap.appendChild(h('div.field.field-sm', h('label.label', fieldLabel(sub)), select));
          continue;
        }
        // default: text input
        const id = uid('text');
        fieldWrap.appendChild(
          h(
            'div.field.field-sm',
            h('label.label', { for: id }, fieldLabel(sub)),
            h('input.input', {
              id,
              type: 'text',
              value: entry[sub.key] === null || entry[sub.key] === undefined ? '' : String(entry[sub.key]),
              on: {
                input: (event) => {
                  entry[sub.key] = event.target.value;
                  onChange();
                },
              },
            }),
          ),
        );
      }

      rows.appendChild(
        h(
          'div.list-row',
          h(
            'div.list-row-head',
            h('span.list-index', String(index + 1)),
            h('div.row.gap-1.ml-auto', upButton, downButton, removeButton),
          ),
          fieldWrap,
        ),
      );
    });
  }

  renderRows();
}

// ---------------------------------------------------------------------------
// fill_blanks custom editor (blanks are a keyed object, not an array)
// ---------------------------------------------------------------------------

function blankNumbersFromText(text) {
  const numbers = new Set();
  for (const match of String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) numbers.add(n);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

function renderFillBlanksEditor(container, { item, onChange }) {
  const config = item.config;
  if (!config.blanks || typeof config.blanks !== 'object') config.blanks = {};
  const textId = uid('blanks-text');
  const textarea = h('textarea.textarea', {
    id: textId,
    rows: 5,
    on: {
      input: (event) => {
        config.text = event.target.value;
        syncBlanks();
        onChange();
      },
    },
  });
  textarea.value = String(config.text || '');
  const blanksHost = h('div.blanks-editor');

  function syncBlanks() {
    const numbers = blankNumbersFromText(config.text);
    let changed = false;
    for (const n of numbers) {
      if (!config.blanks[n] || typeof config.blanks[n] !== 'object') {
        config.blanks[n] = { accepted: [] };
        changed = true;
      }
    }
    for (const key of Object.keys(config.blanks)) {
      if (!numbers.includes(Number(key))) {
        delete config.blanks[key];
        changed = true;
      }
    }
    if (changed) renderBlanks();
  }

  function renderBlanks() {
    clear(blanksHost);
    const numbers = blankNumbersFromText(config.text);
    if (numbers.length === 0) {
      blanksHost.appendChild(h('p.help', t('teacher.blanks_none')));
      return;
    }
    for (const n of numbers) {
      const blank = config.blanks[n] || { accepted: [] };
      const id = uid('blank');
      const area = h('textarea.textarea', {
        id,
        rows: 2,
        on: {
          input: (event) => {
            blank.accepted = event.target.value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            config.blanks[n] = blank;
            onChange();
          },
        },
      });
      area.value = Array.isArray(blank.accepted) ? blank.accepted.join('\n') : '';
      blanksHost.appendChild(
        h(
          'div.blank-row',
          h(
            'div.row.between',
            h('span.label', t('teacher.blank_n', { n })),
            h(
              'button.btn.btn-sm.btn-ghost',
              {
                type: 'button',
                on: {
                  click: () => {
                    config.text = String(config.text || '').replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`), '');
                    textarea.value = config.text;
                    syncBlanks();
                    onChange();
                  },
                },
              },
              t('common.remove'),
            ),
          ),
          area,
          h('p.help', t('teacher.blank_accepted_hint')),
        ),
      );
    }
  }

  function addBlank() {
    const numbers = blankNumbersFromText(config.text);
    const next = numbers.length ? Math.max(...numbers) + 1 : 1;
    const placeholder = `{{${next}}}`;
    const currentText = String(config.text || '');
    const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : currentText.length;
    const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
    const before = currentText.slice(0, start);
    const after = currentText.slice(end);
    const spaceBefore = before && !/\s$/.test(before) ? ' ' : '';
    const spaceAfter = after && !/^\s/.test(after) ? ' ' : '';
    config.text = `${before}${spaceBefore}${placeholder}${spaceAfter}${after}`;
    textarea.value = config.text;
    const cursor = before.length + spaceBefore.length + placeholder.length;
    textarea.focus();
    if (typeof textarea.setSelectionRange === 'function') textarea.setSelectionRange(cursor, cursor);
    syncBlanks();
    onChange();
  }

  syncBlanks();
  container.appendChild(
    h(
      'div.field',
      h('label.label', { for: textId }, t('teacher.blanks_text_label')),
      textarea,
      h('p.help', t('teacher.blanks_text_help')),
    ),
  );
  container.appendChild(blanksHost);
  container.appendChild(
    h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: addBlank } }, t('teacher.blanks_add')),
  );
}

// ---------------------------------------------------------------------------
// pins custom editor (click on the image to place zones)
// ---------------------------------------------------------------------------

function renderPinsEditor(container, { item, onChange }) {
  const config = item.config;
  if (!config.image || typeof config.image !== 'object') config.image = { assetId: '', alt: '' };
  if (!Array.isArray(config.zones)) config.zones = [];
  const imageHost = h('div.pins-image-wrap');
  const zonesHost = h('div.pins-zones');
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only' });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const result = await uploadAsset(file);
      if (result && result.asset) {
        rememberAssetUrl(result.asset);
        config.image = { assetId: result.asset.id, alt: config.image.alt || '' };
        renderImage();
        onChange();
      }
    } catch (error) {
      const { toast } = await import('/lib/dom.js');
      const { errorMessage } = await import('/lib/api.js');
      toast(errorMessage(error), 'error');
    }
  });

  function markerNodeFor(index) {
    return imageHost.querySelectorAll('.pin-marker')[index] || null;
  }

  function applyMarkerPosition(marker, zone) {
    if (!marker) return;
    marker.style.left = `${(Number(zone.x) || 0) * 100}%`;
    marker.style.top = `${(Number(zone.y) || 0) * 100}%`;
    marker.style.width = `${Math.max(3, Math.min(40, (Number(zone.r) || 0.05) * 200))}%`;
  }

  /** Drag a zone marker to fine-tune its position on the image. */
  function beginZoneDrag(event, zone, index) {
    event.preventDefault();
    event.stopPropagation();
    const canvas = imageHost.querySelector('.pins-canvas');
    const image = canvas && canvas.querySelector('img');
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let moved = false;
    const onMove = (moveEvent) => {
      moved = true;
      zone.x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
      zone.y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
      applyMarkerPosition(markerNodeFor(index), zone);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (moved) {
        zone.x = Math.round(zone.x * 1000) / 1000;
        zone.y = Math.round(zone.y * 1000) / 1000;
        onChange();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function zoneMarker(zone, index) {
    const marker = h(
      'button.pin-marker',
      {
        type: 'button',
        style: {
          left: `${(Number(zone.x) || 0) * 100}%`,
          top: `${(Number(zone.y) || 0) * 100}%`,
          width: `${Math.max(3, Math.min(40, (Number(zone.r) || 0.05) * 200))}%`,
          'aria-label': t('teacher.zone_drag_hint', { n: index + 1, label: zone.label || '' }),
          title: zone.label || t('teacher.zone_n', { n: index + 1 }),
        },
      },
      h('span.pin-marker-label', String(index + 1)),
    );
    marker.addEventListener('pointerdown', (event) => beginZoneDrag(event, zone, index));
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    return marker;
  }

  function renderImage() {
    clear(imageHost);
    const assetId = config.image && config.image.assetId;
    if (!assetId) {
      imageHost.appendChild(
        h(
          'div.pins-placeholder',
          h('p.small.muted', t('teacher.pins_no_image')),
          h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_upload')),
          fileInput,
        ),
      );
      return;
    }
    const image = h('img.pins-image', { src: assetUrl(assetId), alt: config.image.alt || t('teacher.pins_image_alt'), draggable: false });
    const layer = h('div.pins-layer');
    config.zones.forEach((zone, index) => layer.appendChild(zoneMarker(zone, index)));
    imageHost.appendChild(h('div.pins-canvas', image, layer));
    imageHost.appendChild(
      h(
        'div.row.wrap.gap-2.mt-2',
        h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_replace')),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { config.image = { assetId: '', alt: config.image.alt || '' }; renderImage(); renderZones(); onChange(); } } }, t('teacher.pins_remove_image')),
        fileInput,
      ),
    );
  }

  imageHost.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.pin-marker, button, input, label, a')) return;
    const canvas = event.target.closest('.pins-canvas');
    if (!canvas) return;
    const image = canvas.querySelector('img');
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    config.zones.push({
      id: nextConfigId(config.zones, 'z'),
      label: t('teacher.zone_default', { n: config.zones.length + 1 }),
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      r: 0.05,
    });
    renderImage();
    renderZones();
    onChange();
  });

  function renderZones() {
    clear(zonesHost);
    if (config.zones.length === 0) {
      zonesHost.appendChild(h('p.help', t('teacher.pins_hint')));
      return;
    }
    zonesHost.appendChild(h('p.help', t('teacher.pins_hint')));
    config.zones.forEach((zone, index) => {
      const labelId = uid('zone-label');
      const radiusId = uid('zone-radius');
      const label = h('input.input', {
        id: labelId,
        type: 'text',
        value: zone.label || '',
        on: {
          input: (event) => {
            zone.label = event.target.value;
            const marker = imageHost.querySelectorAll('.pin-marker')[index];
            if (marker) {
              marker.setAttribute('aria-label', zone.label || t('teacher.zone_n', { n: index + 1 }));
              marker.title = zone.label || t('teacher.zone_n', { n: index + 1 });
            }
            onChange();
          },
        },
      });
      const rPercent = Math.round((Number(zone.r) || 0.05) * 1000) / 10;
      const radiusValueLabel = h('span.small.muted.nowrap', `${rPercent} %`);
      const radius = h('input.radius-slider', {
        class: 'input',
        id: radiusId,
        type: 'range',
        min: '1',
        max: '15',
        step: '0.5',
        value: String(rPercent),
        'aria-valuetext': `${rPercent} %`,
        on: {
          input: (event) => {
            const percent = Number(event.target.value);
            zone.r = Math.min(0.15, Math.max(0.01, percent / 100));
            radiusValueLabel.textContent = `${percent} %`;
            event.target.setAttribute('aria-valuetext', `${percent} %`);
            applyMarkerPosition(markerNodeFor(index), zone);
            onChange();
          },
        },
      });
      const row = h(
        'div.list-row',
        h(
          'div.list-row-head',
          h('span.list-index', String(index + 1)),
          h(
            'div.row.gap-1.ml-auto',
            h(
              'button.btn.btn-icon.btn-sm.btn-ghost',
              {
                type: 'button',
                'aria-label': t('common.remove'),
                title: t('common.remove'),
                on: {
                  click: () => {
                    config.zones.splice(index, 1);
                    renderImage();
                    renderZones();
                    onChange();
                  },
                },
              },
              h('span', { html: '✕' }),
            ),
          ),
        ),
        h(
          'div.pins-zone-fields',
          h('div.field.field-sm', h('label.label', { for: labelId }, t('teacher.zone_label')), label),
          h(
            'div.field.field-sm',
            h('label.label', { for: radiusId }, t('teacher.zone_radius')),
            h('div.row.gap-2', radius, radiusValueLabel),
          ),
        ),
      );
      zonesHost.appendChild(row);
    });
  }

  const altId = uid('pins-alt');
  const altInput = h('input.input', {
    id: altId,
    type: 'text',
    value: (config.image && config.image.alt) || '',
    on: {
      input: (event) => {
        if (!config.image) config.image = { assetId: '', alt: '' };
        config.image.alt = event.target.value;
        onChange();
      },
    },
  });

  renderImage();
  renderZones();
  container.appendChild(h('div.pins-editor', imageHost, zonesHost));
  container.appendChild(h('div.field.field-sm', h('label.label', { for: altId }, t('teacher.image_alt')), altInput));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render the authoring form for an item's config into `container`.
 * Mutates item.config in place and calls onChange() after every edit.
 */
export function renderConfigForm(container, { item, schema, onChange }) {
  clear(container);
  const change = typeof onChange === 'function' ? onChange : () => {};
  if (!item || !item.config) return;

  if (item.type === 'fill_blanks') {
    renderFillBlanksEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'pins') {
    renderPinsEditor(container, { item, onChange: change });
    return;
  }

  const descriptorList = Array.isArray(schema) ? schema : [];
  let rendered = 0;
  for (const descriptor of descriptorList) {
    if (!descriptor || !descriptor.key) continue;
    if (descriptor.kind === 'list') {
      const host = h('div');
      container.appendChild(host);
      renderListInto(host, descriptor, item.config, change, 0);
      rendered += 1;
      continue;
    }
    if (descriptor.kind === 'switch') {
      container.appendChild(renderSwitch(descriptor, item.config, change));
      rendered += 1;
      continue;
    }
    if (descriptor.kind === 'number') {
      container.appendChild(renderNumber(descriptor, item.config, change));
      rendered += 1;
      continue;
    }
    if (descriptor.kind === 'select') {
      container.appendChild(renderSelect(descriptor, item.config, change));
      rendered += 1;
      continue;
    }
    if (descriptor.kind === 'textarea') {
      const id = uid('area');
      const area = h('textarea.textarea', {
        id,
        rows: 4,
        on: {
          input: (event) => {
            item.config[descriptor.key] = event.target.value;
            change();
          },
        },
      });
      area.value = item.config[descriptor.key] === null || item.config[descriptor.key] === undefined ? '' : String(item.config[descriptor.key]);
      const help = fieldHelp(descriptor);
      container.appendChild(h('div.field.field-sm', h('label.label', { for: id }, fieldLabel(descriptor)), area, help ? h('p.help', help) : null));
      rendered += 1;
      continue;
    }
    // default text
    const id = uid('text');
    const help = fieldHelp(descriptor);
    container.appendChild(
      h(
        'div.field.field-sm',
        h('label.label', { for: id }, fieldLabel(descriptor)),
        h('input.input', {
          id,
          type: 'text',
          value: item.config[descriptor.key] === null || item.config[descriptor.key] === undefined ? '' : String(item.config[descriptor.key]),
          on: {
            input: (event) => {
              item.config[descriptor.key] = event.target.value;
              change();
            },
          },
        }),
        help ? h('p.help', help) : null,
      ),
    );
    rendered += 1;
  }

  // Safety net: short_answer always supports accepted answers even if the
  // shared schema words it differently or omits it.
  if (item.type === 'short_answer' && !descriptorList.some((entry) => entry && entry.key === 'accepted')) {
    const host = h('div');
    container.appendChild(host);
    renderListInto(
      host,
      { key: 'accepted', kind: 'list', label: { de: 'Akzeptierte Antworten', en: 'Accepted answers' }, primitive: 'lines' },
      item.config,
      change,
      0,
    );
    rendered += 1;
  }

  if (rendered === 0) {
    container.appendChild(h('p.help', t('teacher.config_no_schema')));
  }
}
