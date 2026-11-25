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
import { uploadAsset, get } from '/lib/api.js';
import { icon } from '/lib/icons.js';
import { autoLayout, buildGrid, lettersOf } from '/shared/items/crossword.js';
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
  for (const match of String(text || '').matchAll(/<<\s*(\d+)\s*>>|\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(match[1] || match[2]);
    if (Number.isFinite(n) && n > 0) numbers.add(n);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

function renderFillBlanksEditor(container, { item, onChange }) {
  const config = item.config;
  if (!config.blanks || typeof config.blanks !== 'object') config.blanks = {};
  if (config.mode !== 'drag') config.mode = 'input';
  if (!Array.isArray(config.wordBank)) config.wordBank = [];
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
  const modeHost = h('div');

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
                    config.text = String(config.text || '')
                      .replace(new RegExp(`<<\\s*${n}\\s*>>`), '')
                      .replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`), '');
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
    const placeholder = `<<${next}>>`;
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

  function renderMode() {
    clear(modeHost);
    const segmented = h('div.segmented', { role: 'group', 'aria-label': t('teacher.blanks_mode') });
    const typeBtn = h('button', { type: 'button' }, t('teacher.blanks_mode_input'));
    const dragBtn = h('button', { type: 'button' }, t('teacher.blanks_mode_drag'));
    typeBtn.classList.toggle('is-active', config.mode === 'input');
    dragBtn.classList.toggle('is-active', config.mode === 'drag');
    typeBtn.addEventListener('click', () => { config.mode = 'input'; renderMode(); onChange(); });
    dragBtn.addEventListener('click', () => { config.mode = 'drag'; renderMode(); onChange(); });
    segmented.append(typeBtn, dragBtn);
    modeHost.appendChild(
      h('div.field.field-sm', h('label.label', t('teacher.blanks_mode')), segmented, h('p.help', t(config.mode === 'drag' ? 'teacher.blanks_mode_drag_help' : 'teacher.blanks_mode_input_help'))),
    );
    if (config.mode === 'drag') {
      const bankId = uid('blanks-bank');
      const bankArea = h('textarea.textarea', {
        id: bankId,
        rows: 3,
        on: {
          input: (event) => {
            config.wordBank = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            onChange();
          },
        },
      });
      bankArea.value = config.wordBank.join('\n');
      const fillBtn = h('button.btn.btn-sm.btn-ghost', {
        type: 'button',
        on: {
          click: () => {
            const answers = new Set();
            for (const n of blankNumbersFromText(config.text)) {
              for (const a of (config.blanks[n] && config.blanks[n].accepted) || []) {
                if (String(a).trim()) answers.add(String(a).trim());
              }
            }
            const existing = new Set(config.wordBank);
            for (const a of answers) if (!existing.has(a)) config.wordBank.push(a);
            bankArea.value = config.wordBank.join('\n');
            onChange();
          },
        },
      }, t('teacher.blanks_bank_autofill'));
      modeHost.appendChild(
        h('div.field.field-sm', h('label.label', { for: bankId }, t('teacher.blanks_bank')), bankArea, h('p.help', t('teacher.blanks_bank_help')), fillBtn),
      );
    }
  }

  syncBlanks();
  renderMode();
  container.appendChild(
    h(
      'div.field',
      h('label.label', { for: textId }, t('teacher.blanks_text_label')),
      textarea,
      h('p.help', t('teacher.blanks_text_help')),
    ),
  );
  container.appendChild(blanksHost);
  container.appendChild(modeHost);
  container.appendChild(
    h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: addBlank } }, t('teacher.blanks_add')),
  );
}

// ---------------------------------------------------------------------------
// writing custom editor (criteria with weights, grade level, source text)
// ---------------------------------------------------------------------------

function renderWritingEditor(container, { item, onChange }) {
  const config = item.config;
  if (!Array.isArray(config.criteria) || !config.criteria.length) {
    config.criteria = [{ id: 'c1', label: 'Inhalt', weight: 40, description: '' }];
  }
  if (typeof config.gradeLevel !== 'string') config.gradeLevel = '';
  if (typeof config.sourceText !== 'string') config.sourceText = '';
  if (typeof config.minWords !== 'number') config.minWords = 0;
  if (typeof config.maxWords !== 'number') config.maxWords = 3000;
  if (typeof config.allowLoops !== 'boolean') config.allowLoops = true;

  const gradeId = uid('wr-grade');
  const gradeInput = h('input.input', {
    id: gradeId,
    type: 'text',
    value: config.gradeLevel,
    placeholder: 'z. B. 7. Klasse',
    on: { input: (event) => { config.gradeLevel = event.target.value; onChange(); } },
  });

  const sourceId = uid('wr-source');
  const sourceArea = h('textarea.textarea', {
    id: sourceId,
    rows: 5,
    placeholder: 'Hintergrundtext / Quelle, auf die sich die Aufgabe bezieht …',
    on: { input: (event) => { config.sourceText = event.target.value; onChange(); } },
  });
  sourceArea.value = config.sourceText;

  const minId = uid('wr-min');
  const minInput = h('input.input.input-sm', {
    id: minId, type: 'number', min: 0, step: 10, value: String(config.minWords),
    on: { input: (event) => { config.minWords = Math.max(0, Number(event.target.value) || 0); onChange(); } },
  });
  const maxId = uid('wr-max');
  const maxInput = h('input.input.input-sm', {
    id: maxId, type: 'number', min: 1, step: 50, value: String(config.maxWords),
    on: { input: (event) => { config.maxWords = Math.max(1, Number(event.target.value) || 1); onChange(); } },
  });

  const loopsId = uid('wr-loops');
  const loopsInput = h('input', {
    id: loopsId,
    type: 'checkbox',
    checked: config.allowLoops !== false,
    on: { change: (event) => { config.allowLoops = event.target.checked; onChange(); } },
  });

  const criteriaHost = h('div.writing-criteria-editor');

  function renderCriteria() {
    clear(criteriaHost);
    config.criteria.forEach((criterion, index) => {
      const rowId = uid('wr-c');
      const labelInput = h('input.input', {
        type: 'text', value: criterion.label, placeholder: t('teacher.wr_criterion_label_ph'),
        on: { input: (event) => { criterion.label = event.target.value; onChange(); } },
      });
      const weightInput = h('input.input.input-sm.wr-weight', {
        type: 'number', min: 0, max: 100, step: 5, value: String(criterion.weight),
        title: t('teacher.wr_weight'),
        on: { input: (event) => { criterion.weight = Math.max(0, Math.min(100, Number(event.target.value) || 0)); onChange(); } },
      });
      const descInput = h('input.input', {
        type: 'text', value: criterion.description || '', placeholder: t('teacher.wr_criterion_desc_ph'),
        on: { input: (event) => { criterion.description = event.target.value; onChange(); } },
      });
      const removeBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button', title: t('common.remove'), 'aria-label': t('common.remove'),
        on: {
          click: () => {
            config.criteria.splice(index, 1);
            renderCriteria();
            onChange();
          },
        },
      }, h('span', { html: '✕' }));
      criteriaHost.appendChild(
        h('div.list-row.wr-criterion-row',
          h('div.row.gap-1.wrap',
            h('span.list-index', String(index + 1)),
            labelInput,
            weightInput,
            h('span.tiny.muted', '%'),
          ),
          h('div.row.gap-1', descInput, removeBtn),
        ),
      );
    });
    const total = config.criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
    criteriaHost.appendChild(h('p.help.mt-1', total !== 100 ? t('teacher.wr_weight_sum', { sum: total }) : t('teacher.wr_weight_ok')));
  }

  const addBtn = h('button.btn.btn-sm.btn-secondary', {
    type: 'button',
    on: {
      click: () => {
        const n = config.criteria.length + 1;
        config.criteria.push({ id: `c${Date.now().toString(36)}${n}`, label: '', weight: 0, description: '' });
        renderCriteria();
        onChange();
      },
    },
  }, h('span', { html: icon('plus', { size: 14 }) }), ' ', t('teacher.wr_add_criterion'));

  renderCriteria();
  container.append(
    h('div.field.field-sm', h('label.label', { for: gradeId }, t('teacher.wr_grade')), gradeInput, h('p.help', t('teacher.wr_grade_help'))),
    h('div.field.field-sm', h('label.label', { for: sourceId }, t('teacher.wr_source')), sourceArea, h('p.help', t('teacher.wr_source_help'))),
    h('div.row.gap-2.wrap',
      h('div.field.field-sm.mb-0', h('label.label', { for: minId }, t('teacher.wr_min_words')), minInput),
      h('div.field.field-sm.mb-0', h('label.label', { for: maxId }, t('teacher.wr_max_words')), maxInput),
    ),
    h('div.field.field-sm', h('label.switch.setting-row', loopsInput, h('span.track', { 'aria-hidden': 'true' }), h('span.setting-text', h('span.small', t('teacher.wr_allow_loops'))))),
    h('div.field.field-sm', h('label.label', t('teacher.wr_criteria')), criteriaHost, addBtn, h('p.help', t('teacher.wr_criteria_help'))),
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
// text custom editor (rich text: <<gaps>>, inline images, tables, Ctrl+V)
// ---------------------------------------------------------------------------

function insertAtCursor(textarea, snippet, selectFrom, selectTo) {
  const current = String(textarea.value || '');
  const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : current.length;
  const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
  const before = current.slice(0, start);
  const after = current.slice(end);
  textarea.value = before + snippet + after;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  const cursor = before.length + (selectFrom ?? snippet.length);
  const selEnd = before.length + (selectTo ?? snippet.length);
  if (typeof textarea.setSelectionRange === 'function') textarea.setSelectionRange(cursor, selEnd);
}

async function uploadImageFile(file) {
  const result = await uploadAsset(file);
  if (result && result.asset) {
    rememberAssetUrl(result.asset);
    return result.asset;
  }
  return null;
}

function renderTextEditor(container, { item, onChange }) {
  const config = item.config;
  if (typeof config.text !== 'string') config.text = '';
  const textId = uid('text-block');
  const textarea = h('textarea.textarea.rt-editor', { id: textId, rows: 8 });
  textarea.value = config.text;
  textarea.addEventListener('input', () => {
    config.text = textarea.value;
    onChange();
  });
  // Ctrl+V with an image in the clipboard → upload + insert as markdown image
  textarea.addEventListener('paste', async (event) => {
    const files = event.clipboardData && event.clipboardData.files;
    const image = files && Array.from(files).find((file) => file.type && file.type.startsWith('image/'));
    if (!image) return; // let plain text paste through
    event.preventDefault();
    try {
      const asset = await uploadImageFile(image);
      if (asset) {
        const url = assetUrl(asset.id);
        insertAtCursor(textarea, `![${asset.filename || 'Bild'}](${url})`);
      }
    } catch (error) {
      const { toast } = await import('/lib/dom.js');
      const { errorMessage } = await import('/lib/api.js');
      toast(errorMessage(error), 'error');
    }
  });

  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const asset = await uploadImageFile(file);
      if (asset) insertAtCursor(textarea, `![${asset.filename || 'Bild'}](${assetUrl(asset.id)})`);
    } catch (error) {
      const { toast } = await import('/lib/dom.js');
      const { errorMessage } = await import('/lib/api.js');
      toast(errorMessage(error), 'error');
    }
  });

  const gapButton = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, '<<Lücke>>');
  gapButton.addEventListener('click', () => {
    insertAtCursor(textarea, '<<Antwort>>', 2, 9); // preselect "Antwort"
  });
  const imageButton = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.text_insert_image'));
  imageButton.addEventListener('click', () => fileInput.click());
  const tableButton = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.text_insert_table'));
  tableButton.addEventListener('click', () => {
    insertAtCursor(textarea, '\n| Spalte 1 | Spalte 2 |\n| --- | --- |\n|  |  |\n');
  });
  const pasteHint = h('p.help', t('teacher.text_paste_hint'));

  container.appendChild(
    h('div.field',
      h('label.label', { for: textId }, t('teacher.text_label')),
      h('div.row.wrap.gap-2.mb-2', gapButton, imageButton, tableButton, fileInput),
      textarea,
      h('p.help', t('teacher.text_help')),
      pasteHint,
    ),
  );
}

// ---------------------------------------------------------------------------
// image_boxes custom editor (draw rectangles on the image)
// ---------------------------------------------------------------------------

function renderImageBoxesEditor(container, { item, onChange }) {
  const config = item.config;
  if (!config.image || typeof config.image !== 'object') config.image = { assetId: '', alt: '' };
  if (!Array.isArray(config.boxes)) config.boxes = [];
  if (!['type', 'drag'].includes(config.inputMode)) config.inputMode = 'type';
  if (!Array.isArray(config.wordBank)) config.wordBank = [];

  const imageHost = h('div.ib-editor-image-wrap');
  const boxesHost = h('div.ib-editor-boxes');
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr-only' });
  let selectedBoxId = null;

  async function pickImage(file) {
    try {
      const asset = await uploadImageFile(file);
      if (asset) {
        config.image = { assetId: asset.id, alt: config.image.alt || asset.filename || '' };
        renderImage();
        onChange();
      }
    } catch (error) {
      const { toast } = await import('/lib/dom.js');
      const { errorMessage } = await import('/lib/api.js');
      toast(errorMessage(error), 'error');
    }
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) pickImage(file);
  });

  function boxElFor(id) {
    return imageHost.querySelector(`[data-box-id="${CSS.escape(String(id))}"]`);
  }

  function refreshBox(box) {
    const el = boxElFor(box.id);
    if (!el) return;
    el.style.left = `${(Number(box.x) || 0) * 100}%`;
    el.style.top = `${(Number(box.y) || 0) * 100}%`;
    el.style.width = `${(Number(box.w) || 0.2) * 100}%`;
    el.style.height = `${(Number(box.h) || 0.15) * 100}%`;
    el.classList.toggle('is-selected', selectedBoxId === box.id);
    const num = el.querySelector('.ib-edit-box-num');
    if (num) num.textContent = String(config.boxes.indexOf(box) + 1);
  }

  function buildBoxEl(box) {
    const el = h('div.ib-edit-box', { dataset: { boxId: String(box.id) } });
    el.appendChild(h('span.ib-edit-box-num', { 'aria-hidden': 'true', text: '?' }));
    el.appendChild(h('span.ib-edit-box-grip', { 'aria-hidden': 'true' }));
    el.addEventListener('pointerdown', (event) => beginBoxDrag(event, box, event.target.classList.contains('ib-edit-box-grip') ? 'resize' : 'move'));
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      selectedBoxId = String(box.id);
      config.boxes.forEach(refreshBox);
      renderBoxes();
    });
    refreshBox(box);
    return el;
  }

  function appendBoxEl(box) {
    const layer = imageHost.querySelector('.pins-layer');
    if (layer) layer.appendChild(buildBoxEl(box));
  }

  function addBox() {
    if (!config.image || !config.image.assetId) {
      fileInput.click();
      return;
    }
    const box = {
      id: nextConfigId(config.boxes, 'b'),
      x: 0.4,
      y: 0.4,
      w: 0.2,
      h: 0.15,
      label: '',
      accepted: [],
    };
    config.boxes.push(box);
    selectedBoxId = String(box.id);
    appendBoxEl(box);
    config.boxes.forEach(refreshBox);
    renderBoxes();
    onChange();
  }

  function renderImage() {
    clear(imageHost);
    const assetId = config.image && config.image.assetId;
    if (!assetId) {
      imageHost.appendChild(
        h('div.pins-placeholder',
          h('p.small.muted', t('teacher.ib_no_image')),
          h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_upload')),
          fileInput,
        ),
      );
      return;
    }
    const image = h('img.pins-image', { src: assetUrl(assetId), alt: config.image.alt || '', draggable: false });
    const layer = h('div.pins-layer');
    for (const box of config.boxes) {
      layer.appendChild(buildBoxEl(box));
    }
    imageHost.appendChild(h('div.pins-canvas', image, layer));
    imageHost.appendChild(
      h('div.row.wrap.gap-2.mt-2',
        h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: addBox } }, '+ ', t('teacher.ib_add_box')),
        h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_replace')),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { config.image = { assetId: '', alt: config.image.alt || '' }; config.boxes = []; renderImage(); renderBoxes(); onChange(); } } }, t('teacher.pins_remove_image')),
        fileInput,
      ),
    );
    // click/drag on empty canvas area draws a new rectangle
    imageHost.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.ib-edit-box, button, input, label, a')) return;
      const canvas = event.target.closest('.pins-canvas');
      if (!canvas) return;
      const img = canvas.querySelector('img');
      if (!img) return;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const startX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const startY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const ghost = h('div.ib-edit-ghost');
      const layerEl = canvas.querySelector('.pins-layer');
      layerEl.appendChild(ghost);
      let moved = false;
      const onMove = (moveEvent) => {
        moved = true;
        const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
        ghost.style.left = `${Math.min(startX, x) * 100}%`;
        ghost.style.top = `${Math.min(startY, y) * 100}%`;
        ghost.style.width = `${Math.abs(x - startX) * 100}%`;
        ghost.style.height = `${Math.abs(y - startY) * 100}%`;
      };
      const onUp = (upEvent) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        ghost.remove();
        const x = Math.min(1, Math.max(0, (upEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (upEvent.clientY - rect.top) / rect.height));
        const w = Math.abs(x - startX);
        const hh = Math.abs(y - startY);
        if (moved && w > 0.01 && hh > 0.01) {
          const box = {
            id: nextConfigId(config.boxes, 'b'),
            x: Math.round(Math.min(startX, x) * 1000) / 1000,
            y: Math.round(Math.min(startY, y) * 1000) / 1000,
            w: Math.round(Math.max(w, 0.03) * 1000) / 1000,
            h: Math.round(Math.max(hh, 0.03) * 1000) / 1000,
            label: '',
            accepted: [],
          };
          config.boxes.push(box);
          selectedBoxId = String(box.id);
          // incremental update: append only the new box, no full re-render (no flicker)
          appendBoxEl(box);
          config.boxes.forEach(refreshBox);
          renderBoxes();
          onChange();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  function beginBoxDrag(event, box, mode) {
    event.preventDefault();
    event.stopPropagation();
    selectedBoxId = String(box.id);
    const canvas = imageHost.querySelector('.pins-canvas');
    const img = canvas && canvas.querySelector('img');
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const orig = { x: box.x, y: box.y, w: box.w, h: box.h };
    let moved = false;
    const onMove = (moveEvent) => {
      moved = true;
      const dx = (moveEvent.clientX - startClientX) / rect.width;
      const dy = (moveEvent.clientY - startClientY) / rect.height;
      if (mode === 'move') {
        box.x = Math.min(1 - box.w, Math.max(0, orig.x + dx));
        box.y = Math.min(1 - box.h, Math.max(0, orig.y + dy));
      } else {
        box.w = Math.min(1 - box.x, Math.max(0.03, orig.w + dx));
        box.h = Math.min(1 - box.y, Math.max(0.03, orig.h + dy));
      }
      refreshBox(box);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (moved) {
        box.x = Math.round(box.x * 1000) / 1000;
        box.y = Math.round(box.y * 1000) / 1000;
        box.w = Math.round(box.w * 1000) / 1000;
        box.h = Math.round(box.h * 1000) / 1000;
        config.boxes.forEach(refreshBox);
        onChange();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function renderBoxes() {
    clear(boxesHost);
    boxesHost.appendChild(h('p.help', t('teacher.ib_hint')));
    config.boxes.forEach((box, index) => {
      const labelId = uid('ib-label');
      const acceptedId = uid('ib-accepted');
      const labelInput = h('input.input', {
        id: labelId,
        type: 'text',
        value: box.label || '',
        placeholder: t('teacher.ib_box_label_ph'),
        on: { input: (event) => { box.label = event.target.value; onChange(); } },
      });
      const acceptedArea = h('textarea.textarea', {
        id: acceptedId,
        rows: 2,
        placeholder: t('teacher.ib_accepted_ph'),
        on: {
          input: (event) => {
            box.accepted = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            onChange();
          },
        },
      });
      acceptedArea.value = Array.isArray(box.accepted) ? box.accepted.join('\n') : '';
      const row = h('div.list-row.ib-editor-box-row',
        h('div.list-row-head',
          h('span.list-index', String(index + 1)),
          h('div.row.gap-1.ml-auto',
            h('button.btn.btn-icon.btn-sm.btn-ghost', {
              type: 'button',
              'aria-label': t('common.remove'),
              title: t('common.remove'),
              on: {
                click: () => {
                  config.boxes.splice(index, 1);
                  if (selectedBoxId === String(box.id)) selectedBoxId = null;
                  const el = boxElFor(box.id);
                  if (el) el.remove();
                  config.boxes.forEach(refreshBox);
                  renderBoxes();
                  onChange();
                },
              },
            }, h('span', { html: '✕' })),
          ),
        ),
        h('div.pins-zone-fields',
          h('div.field.field-sm', h('label.label', { for: labelId }, t('teacher.ib_box_label')), labelInput),
          h('div.field.field-sm', h('label.label', { for: acceptedId }, t('teacher.ib_box_accepted')), acceptedArea, h('p.help', t('teacher.ib_box_accepted_help'))),
        ),
      );
      if (selectedBoxId === String(box.id)) row.classList.add('is-selected');
      boxesHost.appendChild(row);
    });
  }

  // input mode + word bank
  let inputMode = config.inputMode;
  const modeHost = h('div');
  function renderMode() {
    clear(modeHost);
    const segmented = h('div.segmented', { role: 'group', 'aria-label': t('teacher.ib_input_mode') });
    const typeBtn = h('button', { type: 'button' }, t('teacher.ib_mode_type'));
    const dragBtn = h('button', { type: 'button' }, t('teacher.ib_mode_drag'));
    typeBtn.classList.toggle('is-active', inputMode === 'type');
    dragBtn.classList.toggle('is-active', inputMode === 'drag');
    typeBtn.addEventListener('click', () => { inputMode = 'type'; config.inputMode = 'type'; renderMode(); onChange(); });
    dragBtn.addEventListener('click', () => { inputMode = 'drag'; config.inputMode = 'drag'; renderMode(); onChange(); });
    segmented.append(typeBtn, dragBtn);
    modeHost.appendChild(h('div.field.field-sm', h('label.label', t('teacher.ib_input_mode')), segmented, h('p.help', t(inputMode === 'drag' ? 'teacher.ib_mode_drag_help' : 'teacher.ib_mode_type_help'))));
    if (inputMode === 'drag') {
      const bankId = uid('ib-bank');
      const bankArea = h('textarea.textarea', {
        id: bankId,
        rows: 3,
        on: {
          input: (event) => {
            config.wordBank = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            onChange();
          },
        },
      });
      bankArea.value = config.wordBank.join('\n');
      modeHost.appendChild(h('div.field.field-sm', h('label.label', { for: bankId }, t('teacher.ib_word_bank')), bankArea, h('p.help', t('teacher.ib_word_bank_help'))));
    }
  }

  const altId = uid('ib-alt');
  const altInput = h('input.input', {
    id: altId,
    type: 'text',
    value: (config.image && config.image.alt) || '',
    on: { input: (event) => { if (!config.image) config.image = { assetId: '', alt: '' }; config.image.alt = event.target.value; onChange(); } },
  });

  renderImage();
  renderBoxes();
  renderMode();
  container.appendChild(h('div.pins-editor.ib-editor', imageHost, boxesHost, modeHost));
  container.appendChild(h('div.field.field-sm', h('label.label', { for: altId }, t('teacher.image_alt')), altInput));
}

// ---------------------------------------------------------------------------
// match custom editor (text / image / audio per side)
// ---------------------------------------------------------------------------

function renderMatchEditor(container, { item, onChange }) {
  const config = item.config;
  if (!Array.isArray(config.pairs)) config.pairs = [];
  if (typeof config.shuffle !== 'boolean') config.shuffle = true;

  function normalizeSide(side) {
    if (typeof side === 'string') return { kind: 'text', text: side };
    if (!side || typeof side !== 'object') return { kind: 'text', text: '' };
    const kind = side.kind === 'image' || side.kind === 'audio' ? side.kind : 'text';
    if (kind === 'text') return { kind, text: String(side.text ?? '') };
    return { kind, assetId: String(side.assetId || ''), ...(kind === 'image' ? { alt: String(side.alt || '') } : {}) };
  }

  const pairsHost = h('div');
  const audioAccept = 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm';

  function sideEditor(side, onSideChange, labelText) {
    const wrap = h('div.match-side');
    const kindSelect = h('select.select.select-sm', { 'aria-label': labelText });
    for (const [value, labelKey] of [['text', 'teacher.match_kind_text'], ['image', 'teacher.match_kind_image'], ['audio', 'teacher.match_kind_audio']]) {
      const opt = h('option', { value }, t(labelKey));
      kindSelect.appendChild(opt);
    }
    kindSelect.value = side.kind || 'text';
    kindSelect.addEventListener('change', () => {
      const kind = kindSelect.value;
      const next = kind === 'text' ? { kind, text: side.text || '' } : { kind, assetId: '', ...(kind === 'image' ? { alt: '' } : {}) };
      onSideChange(next);
      rerender();
    });

    const body = h('div.match-side-body');
    if ((side.kind || 'text') === 'text') {
      const input = h('input.input', {
        type: 'text',
        value: side.text || '',
        placeholder: labelText,
        on: { input: (event) => onSideChange({ kind: 'text', text: event.target.value }) },
      });
      body.appendChild(input);
    } else {
      const fileInput = h('input', { type: 'file', accept: side.kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : audioAccept, class: 'sr-only' });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try {
          const asset = await uploadImageFile(file);
          if (asset) {
            onSideChange(side.kind === 'image' ? { kind: 'image', assetId: asset.id, alt: side.alt || asset.filename || '' } : { kind: 'audio', assetId: asset.id });
            rerender();
            onChange();
          }
        } catch (error) {
          const { toast } = await import('/lib/dom.js');
          const { errorMessage } = await import('/lib/api.js');
          toast(errorMessage(error), 'error');
        }
      });
      if (side.assetId) {
        if (side.kind === 'image') {
          body.appendChild(h('img.media-thumb', { src: assetUrl(side.assetId), alt: side.alt || '' }));
          const altInput = h('input.input.input-sm', {
            type: 'text',
            value: side.alt || '',
            placeholder: t('teacher.image_alt'),
            on: { input: (event) => onSideChange({ ...side, alt: event.target.value }) },
          });
          body.appendChild(altInput);
        } else {
          body.appendChild(h('audio', { controls: true, preload: 'metadata', src: assetUrl(side.assetId), class: 'match-audio-preview' }));
        }
        body.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { onSideChange(side.kind === 'image' ? { kind: 'image', assetId: '', alt: '' } : { kind: 'audio', assetId: '' }); rerender(); onChange(); } } }, t('common.remove')));
      }
      body.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, side.assetId ? t('teacher.pins_replace') : (side.kind === 'image' ? t('teacher.pins_upload') : t('teacher.upload_audio'))));
      body.appendChild(fileInput);
    }
    wrap.appendChild(kindSelect);
    wrap.appendChild(body);
    return wrap;
  }

  function rerender() {
    clear(pairsHost);
    if (config.pairs.length === 0) {
      pairsHost.appendChild(h('p.help', t('teacher.list_empty')));
    }
    config.pairs.forEach((pair, index) => {
      pair.left = normalizeSide(pair.left);
      pair.right = normalizeSide(pair.right);
      const row = h('div.list-row.match-pair-row',
        h('div.list-row-head',
          h('span.list-index', String(index + 1)),
          h('div.row.gap-1.ml-auto',
            h('button.btn.btn-icon.btn-sm.btn-ghost', {
              type: 'button',
              'aria-label': t('common.remove'),
              title: t('common.remove'),
              on: {
                click: () => {
                  config.pairs.splice(index, 1);
                  rerender();
                  onChange();
                },
              },
            }, h('span', { html: '✕' })),
          ),
        ),
        h('div.match-pair-sides',
          sideEditor(pair.left, (next) => { pair.left = next; onChange(); }, t('teacher.match_left')),
          h('span.item-match-arrow', { 'aria-hidden': 'true', text: '→' }),
          sideEditor(pair.right, (next) => { pair.right = next; onChange(); }, t('teacher.match_right')),
        ),
      );
      pairsHost.appendChild(row);
    });
  }
  rerender();

  const addBtn = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.list_add'));
  addBtn.addEventListener('click', () => {
    config.pairs.push({ id: nextConfigId(config.pairs, 'p'), left: { kind: 'text', text: '' }, right: { kind: 'text', text: '' } });
    rerender();
    onChange();
  });

  const shuffleId = uid('match-shuffle');
  const shuffle = h('input', { id: shuffleId, type: 'checkbox' });
  if (config.shuffle) shuffle.checked = true;
  shuffle.addEventListener('change', () => { config.shuffle = shuffle.checked; onChange(); });

  container.appendChild(h('div.match-editor', pairsHost, h('div.row.gap-2.mt-2', addBtn)));
  container.appendChild(h('div.field.field-sm', h('label.label.check-label', { for: shuffleId }, shuffle, h('span', { text: t('teacher.shuffle_right') }))));
}

// ---------------------------------------------------------------------------
// hotspot editor (TipToi): image + drawable zones + per-zone feedback/link
// ---------------------------------------------------------------------------

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm';

async function pickAssetFile(file) {
  const result = await uploadAsset(file);
  if (result && result.asset) {
    rememberAssetUrl(result.asset);
    return result.asset;
  }
  return null;
}

async function pickAssetOrToast(file) {
  try {
    return await pickAssetFile(file);
  } catch (error) {
    const { toast } = await import('/lib/dom.js');
    const { errorMessage } = await import('/lib/api.js');
    toast(errorMessage(error), 'error');
    return null;
  }
}

function zoneEditorStyle(zone) {
  if (zone.shape === 'circle') {
    const r = Math.max(0.02, Number(zone.r) || 0.08);
    return {
      left: `${(Number(zone.x) - r) * 100}%`,
      top: `${(Number(zone.y) - r) * 100}%`,
      width: `${r * 2 * 100}%`,
      height: `${r * 2 * 100}%`,
      borderRadius: '50%',
    };
  }
  return {
    left: `${(Number(zone.x) || 0) * 100}%`,
    top: `${(Number(zone.y) || 0) * 100}%`,
    width: `${Math.max(0.02, Number(zone.w) || 0.2) * 100}%`,
    height: `${Math.max(0.02, Number(zone.h) || 0.15) * 100}%`,
  };
}

function renderHotspotEditor(container, { item, onChange }) {
  const config = item.config;
  if (!config.image || typeof config.image !== 'object') config.image = { assetId: '', alt: '' };
  if (!config.prompt || typeof config.prompt !== 'object') config.prompt = { text: '', audioAssetId: '' };
  if (!Array.isArray(config.zones)) config.zones = [];
  let selectedZoneId = null;

  const imageHost = h('div.pins-image-wrap');
  const zonesHost = h('div.hs-zones');
  const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'sr-only' });
  const audioInput = h('input', { type: 'file', accept: AUDIO_ACCEPT, class: 'sr-only' });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const asset = await pickAssetOrToast(file);
    if (asset) {
      config.image = { assetId: asset.id, alt: config.image.alt || asset.filename || '' };
      renderImage();
      onChange();
    }
  });
  audioInput.addEventListener('change', async () => {
    const file = audioInput.files && audioInput.files[0];
    audioInput.value = '';
    if (!file) return;
    const asset = await pickAssetOrToast(file);
    if (asset) {
      config.prompt.audioAssetId = asset.id;
      renderPrompt();
      onChange();
    }
  });

  function renderPrompt() {
    clear(promptHost);
    const textId = uid('hs-prompt-text');
    promptHost.appendChild(h('div.field.field-sm',
      h('label.label', { for: textId }, t('teacher.hs_prompt_text')),
      h('input.input', {
        id: textId,
        type: 'text',
        value: config.prompt.text || '',
        placeholder: t('teacher.hs_prompt_text_ph'),
        on: { input: (event) => { config.prompt.text = event.target.value; onChange(); } },
      }),
    ));
    const row = h('div.row.gap-2.wrap.align-center');
    if (config.prompt.audioAssetId) {
      row.appendChild(h('audio', { controls: true, preload: 'metadata', src: assetUrl(config.prompt.audioAssetId), class: 'match-audio-preview' }));
      row.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => audioInput.click() } }, t('teacher.pins_replace')));
      row.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { config.prompt.audioAssetId = ''; renderPrompt(); onChange(); } } }, t('common.remove')));
    } else {
      row.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => audioInput.click() } }, t('teacher.hs_upload_prompt_audio')));
    }
    row.appendChild(audioInput);
    promptHost.appendChild(h('div.field.field-sm', h('label.label', t('teacher.hs_prompt_audio')), row));
  }

  const promptHost = h('div.hs-prompt');
  renderPrompt();
  container.appendChild(promptHost);

  function zoneElFor(id) {
    return imageHost.querySelector(`[data-zone-id="${CSS.escape(String(id))}"]`);
  }

  function refreshZone(zone) {
    const el = zoneElFor(zone.id);
    if (!el) return;
    Object.assign(el.style, zoneEditorStyle(zone));
    el.classList.toggle('is-selected', selectedZoneId === zone.id);
    el.classList.toggle('is-correct', zone.correct === true);
    const num = el.querySelector('.hs-edit-zone-num');
    if (num) num.textContent = String(config.zones.indexOf(zone) + 1);
  }

  function renderImage() {
    clear(imageHost);
    const assetId = config.image && config.image.assetId;
    if (!assetId) {
      imageHost.appendChild(h('div.pins-placeholder',
        h('p.small.muted', t('teacher.pins_no_image')),
        h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_upload')),
        fileInput,
      ));
      return;
    }
    const image = h('img.pins-image', { src: assetUrl(assetId), alt: config.image.alt || t('teacher.pins_image_alt'), draggable: false });
    const layer = h('div.pins-layer');
    for (const zone of config.zones) {
      const el = h('div.hs-edit-zone', { dataset: { zoneId: String(zone.id) } });
      el.appendChild(h('span.hs-edit-zone-num', { 'aria-hidden': 'true', text: '?' }));
      el.addEventListener('pointerdown', (event) => beginZoneDrag(event, zone));
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedZoneId = String(zone.id);
        config.zones.forEach(refreshZone);
        renderZones();
      });
      layer.appendChild(el);
      refreshZone(zone);
    }
    imageHost.appendChild(h('div.pins-canvas', image, layer));
    imageHost.appendChild(h('div.row.wrap.gap-2.mt-2',
      h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, t('teacher.pins_replace')),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { config.image = { assetId: '', alt: config.image.alt || '' }; config.zones = []; renderImage(); renderZones(); onChange(); } } }, t('teacher.pins_remove_image')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => addZone('rect') } }, t('teacher.hs_add_rect')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => addZone('circle') } }, t('teacher.hs_add_circle')),
      fileInput,
    ));
    // drag on empty canvas draws a new rectangle
    imageHost.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.hs-edit-zone, button, input, label, a')) return;
      const canvas = event.target.closest('.pins-canvas');
      if (!canvas) return;
      const img = canvas.querySelector('img');
      if (!img) return;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const startX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const startY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const ghost = h('div.ib-edit-ghost');
      canvas.querySelector('.pins-layer').appendChild(ghost);
      let moved = false;
      const onMove = (moveEvent) => {
        moved = true;
        const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
        ghost.style.left = `${Math.min(startX, x) * 100}%`;
        ghost.style.top = `${Math.min(startY, y) * 100}%`;
        ghost.style.width = `${Math.abs(x - startX) * 100}%`;
        ghost.style.height = `${Math.abs(y - startY) * 100}%`;
      };
      const onUp = (upEvent) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        ghost.remove();
        const x = Math.min(1, Math.max(0, (upEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (upEvent.clientY - rect.top) / rect.height));
        const w = Math.abs(x - startX);
        const hh = Math.abs(y - startY);
        if (moved && w > 0.01 && hh > 0.01) {
          const zone = {
            id: nextConfigId(config.zones, 'z'),
            label: '',
            shape: 'rect',
            x: Math.round(Math.min(startX, x) * 1000) / 1000,
            y: Math.round(Math.min(startY, y) * 1000) / 1000,
            w: Math.round(Math.max(w, 0.04) * 1000) / 1000,
            h: Math.round(Math.max(hh, 0.04) * 1000) / 1000,
            correct: false,
            feedback: { text: '', imageAssetId: '', audioAssetId: '' },
            link: { type: 'none', value: '' },
          };
          config.zones.push(zone);
          selectedZoneId = String(zone.id);
          renderImage();
          renderZones();
          onChange();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  function addZone(shape) {
    const zone = {
      id: nextConfigId(config.zones, 'z'),
      label: '',
      shape,
      x: 0.4,
      y: 0.4,
      w: shape === 'rect' ? 0.2 : undefined,
      h: shape === 'rect' ? 0.15 : undefined,
      r: shape === 'circle' ? 0.08 : undefined,
      correct: false,
      feedback: { text: '', imageAssetId: '', audioAssetId: '' },
      link: { type: 'none', value: '' },
    };
    config.zones.push(zone);
    selectedZoneId = String(zone.id);
    renderImage();
    renderZones();
    onChange();
  }

  function beginZoneDrag(event, zone) {
    event.preventDefault();
    event.stopPropagation();
    selectedZoneId = String(zone.id);
    const canvas = imageHost.querySelector('.pins-canvas');
    const img = canvas && canvas.querySelector('img');
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const origX = Number(zone.x) || 0;
    const origY = Number(zone.y) || 0;
    let moved = false;
    const onMove = (moveEvent) => {
      moved = true;
      const dx = (moveEvent.clientX - startClientX) / rect.width;
      const dy = (moveEvent.clientY - startClientY) / rect.height;
      zone.x = Math.min(1, Math.max(0, origX + dx));
      zone.y = Math.min(1, Math.max(0, origY + dy));
      refreshZone(zone);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (moved) {
        zone.x = Math.round(zone.x * 1000) / 1000;
        zone.y = Math.round(zone.y * 1000) / 1000;
        config.zones.forEach(refreshZone);
        onChange();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function renderZones() {
    clear(zonesHost);
    zonesHost.appendChild(h('p.help', t('teacher.hs_hint')));
    config.zones.forEach((zone, index) => {
      if (!zone.feedback || typeof zone.feedback !== 'object') zone.feedback = { text: '', imageAssetId: '', audioAssetId: '' };
      if (!zone.link || typeof zone.link !== 'object') zone.link = { type: 'none', value: '' };
      const card = h('div.list-row.hs-zone-card', { dataset: { zoneId: String(zone.id) } });
      if (selectedZoneId === String(zone.id)) card.classList.add('is-selected');
      const head = h('div.list-row-head',
        h('span.list-index', String(index + 1)),
        h('button.btn.btn-sm.btn-ghost.ml-auto', {
          type: 'button',
          on: {
            click: () => {
              if (selectedZoneId === String(zone.id)) selectedZoneId = null;
              else selectedZoneId = String(zone.id);
              config.zones.forEach(refreshZone);
              renderZones();
            },
          },
        }, zone.label || t('teacher.hs_zone_n', { n: index + 1 })),
        h('button.btn.btn-icon.btn-sm.btn-ghost', {
          type: 'button',
          'aria-label': t('common.remove'),
          title: t('common.remove'),
          on: {
            click: () => {
              config.zones.splice(index, 1);
              if (selectedZoneId === String(zone.id)) selectedZoneId = null;
              renderImage();
              renderZones();
              onChange();
            },
          },
        }, h('span', { html: '✕' })),
      );
      card.appendChild(head);
      if (selectedZoneId === String(zone.id)) {
        const labelId = uid('hs-label');
        const shapeId = uid('hs-shape');
        const correctId = uid('hs-correct');
        const fbTextId = uid('hs-fbtext');
        const linkTypeId = uid('hs-linktype');
        const linkValueId = uid('hs-linkvalue');
        const shapeSelect = h('select.select.select-sm', { id: shapeId });
        for (const [value, key] of [['rect', 'teacher.hs_shape_rect'], ['circle', 'teacher.hs_shape_circle']]) {
          shapeSelect.appendChild(h('option', { value, selected: zone.shape === value }, t(key)));
        }
        shapeSelect.addEventListener('change', () => {
          zone.shape = shapeSelect.value === 'circle' ? 'circle' : 'rect';
          if (zone.shape === 'rect') {
            if (!Number(zone.w)) zone.w = 0.2;
            if (!Number(zone.h)) zone.h = 0.15;
            delete zone.r;
          } else {
            if (!Number(zone.r)) zone.r = 0.08;
            delete zone.w;
            delete zone.h;
          }
          renderImage();
          renderZones();
          onChange();
        });
        const sizeInput = h('input.input.input-sm', {
          type: 'number',
          min: '0.02',
          max: zone.shape === 'circle' ? '0.5' : '1',
          step: '0.01',
          value: String(zone.shape === 'circle' ? zone.r : zone.w),
          style: 'max-width:90px',
          'aria-label': t('teacher.hs_size'),
          on: {
            input: (event) => {
              const n = Number(event.target.value);
              if (!Number.isFinite(n)) return;
              if (zone.shape === 'circle') zone.r = Math.min(0.5, Math.max(0.02, n));
              else zone.w = Math.min(1, Math.max(0.02, n));
              refreshZone(zone);
              onChange();
            },
          },
        });
        const correctCheck = h('input', { id: correctId, type: 'checkbox' });
        correctCheck.checked = zone.correct === true;
        correctCheck.addEventListener('change', () => { zone.correct = correctCheck.checked; refreshZone(zone); onChange(); });

        card.appendChild(h('div.grid.grid-2.gap-2.mt-1',
          h('div.field.field-sm.mb-0', h('label.label', { for: labelId }, t('teacher.hs_zone_label')),
            h('input.input', { id: labelId, type: 'text', value: zone.label || '', placeholder: t('teacher.hs_zone_label_ph'), on: { input: (e) => { zone.label = e.target.value; renderZones(); onChange(); } } })),
          h('div.field.field-sm.mb-0', h('label.label', { for: shapeId }, t('teacher.hs_shape')), h('div.row.gap-2', shapeSelect, sizeInput)),
        ));
        card.appendChild(h('div.field.field-sm.mt-2', h('label.label.check-label', { for: correctId }, correctCheck, h('span', { text: t('teacher.hs_correct') }))));

        // feedback
        card.appendChild(h('div.field.field-sm.mt-2', h('label.label', { for: fbTextId }, t('teacher.hs_feedback_text')),
          h('textarea.textarea', {
            id: fbTextId,
            rows: 2,
            placeholder: t('teacher.hs_feedback_text_ph'),
            on: { input: (e) => { zone.feedback.text = e.target.value; onChange(); } },
          }, zone.feedback.text || ''),
        ));
        const fbRow = h('div.row.gap-2.wrap.align-center');
        const fbImgInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'sr-only' });
        const fbAudioInput = h('input', { type: 'file', accept: AUDIO_ACCEPT, class: 'sr-only' });
        fbImgInput.addEventListener('change', async () => {
          const file = fbImgInput.files && fbImgInput.files[0];
          fbImgInput.value = '';
          if (!file) return;
          const asset = await pickAssetOrToast(file);
          if (asset) { zone.feedback.imageAssetId = asset.id; renderZones(); onChange(); }
        });
        fbAudioInput.addEventListener('change', async () => {
          const file = fbAudioInput.files && fbAudioInput.files[0];
          fbAudioInput.value = '';
          if (!file) return;
          const asset = await pickAssetOrToast(file);
          if (asset) { zone.feedback.audioAssetId = asset.id; renderZones(); onChange(); }
        });
        if (zone.feedback.imageAssetId) {
          fbRow.appendChild(h('img.media-thumb', { src: assetUrl(zone.feedback.imageAssetId), alt: '' }));
          fbRow.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { zone.feedback.imageAssetId = ''; renderZones(); onChange(); } } }, t('common.remove')));
        }
        fbRow.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fbImgInput.click() } }, zone.feedback.imageAssetId ? t('teacher.pins_replace') : t('teacher.hs_feedback_image')));
        fbRow.appendChild(fbImgInput);
        if (zone.feedback.audioAssetId) {
          fbRow.appendChild(h('audio', { controls: true, preload: 'metadata', src: assetUrl(zone.feedback.audioAssetId), class: 'match-audio-preview' }));
          fbRow.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { zone.feedback.audioAssetId = ''; renderZones(); onChange(); } } }, t('common.remove')));
        }
        fbRow.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fbAudioInput.click() } }, zone.feedback.audioAssetId ? t('teacher.pins_replace') : t('teacher.hs_feedback_audio')));
        fbRow.appendChild(fbAudioInput);
        card.appendChild(h('div.field.field-sm.mt-2', h('label.label', t('teacher.hs_feedback_media')), fbRow));

        // link (learning path)
        const linkTypeSelect = h('select.select.select-sm', { id: linkTypeId });
        for (const [value, key] of [['none', 'teacher.hs_link_none'], ['assignment', 'teacher.hs_link_assignment'], ['url', 'teacher.hs_link_url']]) {
          linkTypeSelect.appendChild(h('option', { value, selected: zone.link.type === value }, t(key)));
        }
        linkTypeSelect.addEventListener('change', () => { zone.link.type = linkTypeSelect.value; renderZones(); onChange(); });
        const linkValue = h('input.input.input-sm', {
          id: linkValueId,
          type: 'text',
          value: zone.link.value || '',
          placeholder: zone.link.type === 'assignment' ? t('teacher.hs_link_assignment_ph') : zone.link.type === 'url' ? t('teacher.hs_link_url_ph') : '',
          on: { input: (e) => { zone.link.value = e.target.value; onChange(); } },
        });
        card.appendChild(h('div.field.field-sm.mt-2', h('label.label', { for: linkTypeId }, t('teacher.hs_link')), h('div.row.gap-2', linkTypeSelect, linkValue)));
      }
      zonesHost.appendChild(card);
    });
  }

  renderImage();
  container.appendChild(imageHost);
  renderZones();
  container.appendChild(zonesHost);
}

// ---------------------------------------------------------------------------
// table editor (fill gaps / matrix choice)
// ---------------------------------------------------------------------------

function renderTableEditor(container, { item, onChange }) {
  const config = item.config;
  if (!['fill', 'choice'].includes(config.mode)) config.mode = 'fill';
  if (typeof config.multi !== 'boolean') config.multi = false;
  if (!Array.isArray(config.columns) || config.columns.length === 0) config.columns = [{ id: nextConfigId([], 'c'), label: '' }];
  if (!Array.isArray(config.rows) || config.rows.length === 0) config.rows = [{ id: nextConfigId([], 'r'), label: '', cells: {} }];
  for (const row of config.rows) {
    if (!row.cells || typeof row.cells !== 'object' || Array.isArray(row.cells)) row.cells = {};
    for (const col of config.columns) {
      if (!row.cells[col.id] || typeof row.cells[col.id] !== 'object') row.cells[col.id] = { kind: 'static', text: '', answers: [], correct: false };
    }
  }

  function rerender() {
    clear(host);
    const modeId = uid('tbl-mode');
    const multiId = uid('tbl-multi');
    const modeSelect = h('select.select.select-sm', { id: modeId });
    modeSelect.appendChild(h('option', { value: 'fill', selected: config.mode === 'fill' }, t('teacher.tbl_mode_fill')));
    modeSelect.appendChild(h('option', { value: 'choice', selected: config.mode === 'choice' }, t('teacher.tbl_mode_choice')));
    modeSelect.addEventListener('change', () => { config.mode = modeSelect.value; if (config.mode !== 'choice') config.multi = false; rerender(); onChange(); });
    const multiCheck = h('input', { id: multiId, type: 'checkbox' });
    multiCheck.checked = config.multi === true;
    multiCheck.addEventListener('change', () => { config.multi = multiCheck.checked; onChange(); });
    host.appendChild(h('div.row.gap-3.wrap.align-center.mb-2',
      h('div.field.field-sm.mb-0', h('label.label', { for: modeId }, t('teacher.tbl_mode')), modeSelect),
      config.mode === 'choice' ? h('label.label.check-label', { for: multiId }, multiCheck, h('span', { text: t('teacher.tbl_multi') })) : null,
    ));

    // columns
    host.appendChild(h('div.row.between.wrap.gap-2',
      h('span.label', t('teacher.tbl_columns')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', disabled: config.columns.length >= 12, on: { click: () => { config.columns.push({ id: nextConfigId(config.columns, 'c'), label: '' }); rerender(); onChange(); } } }, t('teacher.tbl_add_column')),
    ));
    const colRow = h('div.row.gap-2.wrap');
    config.columns.forEach((col, index) => {
      colRow.appendChild(h('div.row.gap-1.align-center',
        h('input.input.input-sm', {
          type: 'text',
          value: col.label || '',
          placeholder: t('teacher.tbl_col_ph', { n: index + 1 }),
          style: 'max-width:180px',
          on: { input: (e) => { col.label = e.target.value; onChange(); } },
        }),
        h('button.btn.btn-icon.btn-sm.btn-ghost', {
          type: 'button',
          'aria-label': t('common.remove'),
          disabled: config.columns.length <= 1,
          on: { click: () => { config.columns.splice(index, 1); for (const row of config.rows) delete row.cells[col.id]; rerender(); onChange(); } },
        }, h('span', { html: '✕' })),
      ));
    });
    host.appendChild(colRow);

    // grid
    host.appendChild(h('div.row.between.wrap.gap-2.mt-3',
      h('span.label', t('teacher.tbl_rows')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', disabled: config.rows.length >= 30, on: { click: () => {
        const row = { id: nextConfigId(config.rows, 'r'), label: '', cells: {} };
        for (const col of config.columns) row.cells[col.id] = { kind: config.mode === 'choice' ? 'option' : 'gap', text: '', answers: [], correct: false };
        config.rows.push(row);
        rerender();
        onChange();
      } } }, t('teacher.tbl_add_row')),
    ));
    const table = h('table.tbl-editor-table');
    const thead = h('thead');
    const headRow = h('tr', h('th', { text: '' }));
    config.columns.forEach((col) => headRow.appendChild(h('th', { text: col.label || col.id })));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = h('tbody');
    config.rows.forEach((row, rowIndex) => {
      const tr = h('tr');
      const labelCell = h('th.tbl-row-head',
        h('input.input.input-sm', {
          type: 'text',
          value: row.label || '',
          placeholder: t('teacher.tbl_row_ph', { n: rowIndex + 1 }),
          on: { input: (e) => { row.label = e.target.value; onChange(); } },
        }),
        h('button.btn.btn-icon.btn-sm.btn-ghost', {
          type: 'button',
          'aria-label': t('common.remove'),
          disabled: config.rows.length <= 1,
          on: { click: () => { config.rows.splice(rowIndex, 1); rerender(); onChange(); } },
        }, h('span', { html: '✕' })),
      );
      tr.appendChild(labelCell);
      for (const col of config.columns) {
        const cell = row.cells[col.id];
        const td = h('td.tbl-cell');
        const kindSelect = h('select.select.select-sm.tbl-kind', { 'aria-label': t('teacher.tbl_cell_kind') });
        for (const [value, key] of [['static', 'teacher.tbl_kind_static'], ['gap', 'teacher.tbl_kind_gap'], ['option', 'teacher.tbl_kind_option']]) {
          kindSelect.appendChild(h('option', { value, selected: cell.kind === value }, t(key)));
        }
        kindSelect.addEventListener('change', () => {
          cell.kind = kindSelect.value;
          if (cell.kind === 'gap' && !Array.isArray(cell.answers)) cell.answers = [];
          rerender();
          onChange();
        });
        td.appendChild(kindSelect);
        if (cell.kind === 'static') {
          td.appendChild(h('input.input.input-sm.tbl-cell-input', {
            type: 'text',
            value: cell.text || '',
            placeholder: t('teacher.tbl_static_ph'),
            on: { input: (e) => { cell.text = e.target.value; onChange(); } },
          }));
        } else if (cell.kind === 'gap') {
          td.appendChild(h('textarea.textarea.tbl-cell-input', {
            rows: 2,
            placeholder: t('teacher.tbl_answers_ph'),
            on: { input: (e) => { cell.answers = e.target.value.split('\n').map((v) => v.trim()).filter(Boolean); onChange(); } },
          }, (cell.answers || []).join('\n')));
        } else {
          const cid = uid('tbl-correct');
          const check = h('input', { id: cid, type: 'checkbox' });
          check.checked = cell.correct === true;
          check.addEventListener('change', () => { cell.correct = check.checked; onChange(); });
          td.appendChild(h('label.label.check-label', { for: cid }, check, h('span', { text: t('teacher.tbl_correct') })));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(h('div.table-scroll.mt-2', table));
  }

  const host = h('div.tbl-editor');
  rerender();
  container.appendChild(host);
}

// ---------------------------------------------------------------------------
// groups editor (drag & drop into zones)
// ---------------------------------------------------------------------------

function renderGroupsEditor(container, { item, onChange }) {
  const config = item.config;
  if (!Array.isArray(config.zones) || config.zones.length === 0) config.zones = [{ id: nextConfigId([], 'z'), label: '' }];
  if (!Array.isArray(config.items)) config.items = [];
  if (typeof config.shuffle !== 'boolean') config.shuffle = true;
  for (const entry of config.items) {
    if (typeof entry.side === 'string') entry.side = { kind: 'text', text: entry.side };
    if (!entry.side || typeof entry.side !== 'object') entry.side = { kind: 'text', text: '' };
    if (!config.zones.some((z) => z.id === entry.zoneId)) entry.zoneId = config.zones[0].id;
  }

  function sideEditor(entry, index) {
    const side = entry.side;
    const wrap = h('div.match-side');
    const kindSelect = h('select.select.select-sm');
    for (const [value, key] of [['text', 'teacher.match_kind_text'], ['image', 'teacher.match_kind_image'], ['audio', 'teacher.match_kind_audio']]) {
      kindSelect.appendChild(h('option', { value, selected: side.kind === value }, t(key)));
    }
    kindSelect.addEventListener('change', () => {
      const kind = kindSelect.value;
      entry.side = kind === 'text' ? { kind, text: side.text || '' } : { kind, assetId: '', ...(kind === 'image' ? { alt: '' } : {}) };
      rerender();
      onChange();
    });
    const body = h('div.match-side-body');
    if (side.kind !== 'image' && side.kind !== 'audio') {
      body.appendChild(h('input.input', {
        type: 'text',
        value: side.text || '',
        placeholder: t('teacher.grp_item_text_ph'),
        on: { input: (e) => { entry.side = { kind: 'text', text: e.target.value }; onChange(); } },
      }));
    } else {
      const fileInput = h('input', { type: 'file', accept: side.kind === 'image' ? IMAGE_ACCEPT : AUDIO_ACCEPT, class: 'sr-only' });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        const asset = await pickAssetOrToast(file);
        if (asset) {
          entry.side = side.kind === 'image' ? { kind: 'image', assetId: asset.id, alt: side.alt || asset.filename || '' } : { kind: 'audio', assetId: asset.id };
          rerender();
          onChange();
        }
      });
      if (side.assetId) {
        if (side.kind === 'image') body.appendChild(h('img.media-thumb', { src: assetUrl(side.assetId), alt: side.alt || '' }));
        else body.appendChild(h('audio', { controls: true, preload: 'metadata', src: assetUrl(side.assetId), class: 'match-audio-preview' }));
        body.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { entry.side = { kind: side.kind, assetId: '', ...(side.kind === 'image' ? { alt: '' } : {}) }; rerender(); onChange(); } } }, t('common.remove')));
      }
      body.appendChild(h('button.btn.btn-sm.btn-secondary', { type: 'button', on: { click: () => fileInput.click() } }, side.assetId ? t('teacher.pins_replace') : (side.kind === 'image' ? t('teacher.pins_upload') : t('teacher.upload_audio'))));
      body.appendChild(fileInput);
    }
    wrap.appendChild(kindSelect);
    wrap.appendChild(body);
    return wrap;
  }

  function rerender() {
    clear(host);
    // zones
    host.appendChild(h('div.row.between.wrap.gap-2',
      h('span.label', t('teacher.grp_zones')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', disabled: config.zones.length >= 12, on: { click: () => { config.zones.push({ id: nextConfigId(config.zones, 'z'), label: '' }); rerender(); onChange(); } } }, t('teacher.grp_add_zone')),
    ));
    const zoneRow = h('div.row.gap-2.wrap');
    config.zones.forEach((zone, index) => {
      zoneRow.appendChild(h('div.row.gap-1.align-center',
        h('input.input.input-sm', {
          type: 'text',
          value: zone.label || '',
          placeholder: t('teacher.grp_zone_ph', { n: index + 1 }),
          style: 'max-width:200px',
          on: { input: (e) => { zone.label = e.target.value; onChange(); } },
        }),
        h('button.btn.btn-icon.btn-sm.btn-ghost', {
          type: 'button',
          'aria-label': t('common.remove'),
          disabled: config.zones.length <= 1,
          on: {
            click: () => {
              config.zones.splice(index, 1);
              for (const entry of config.items) if (entry.zoneId === zone.id) entry.zoneId = config.zones[0].id;
              rerender();
              onChange();
            },
          },
        }, h('span', { html: '✕' })),
      ));
    });
    host.appendChild(zoneRow);

    // shuffle
    const shuffleId = uid('grp-shuffle');
    const shuffle = h('input', { id: shuffleId, type: 'checkbox' });
    shuffle.checked = config.shuffle === true;
    shuffle.addEventListener('change', () => { config.shuffle = shuffle.checked; onChange(); });
    host.appendChild(h('div.field.field-sm.mt-2', h('label.label.check-label', { for: shuffleId }, shuffle, h('span', { text: t('teacher.shuffle_right') }))));

    // items
    host.appendChild(h('div.row.between.wrap.gap-2.mt-3',
      h('span.label', t('teacher.grp_items')),
      h('button.btn.btn-sm.btn-secondary', { type: 'button', disabled: config.items.length >= 40, on: { click: () => { config.items.push({ id: nextConfigId(config.items, 'i'), side: { kind: 'text', text: '' }, zoneId: config.zones[0].id }); rerender(); onChange(); } } }, t('teacher.grp_add_item')),
    ));
    config.items.forEach((entry, index) => {
      const zoneSelect = h('select.select.select-sm', { 'aria-label': t('teacher.grp_correct_zone') });
      for (const zone of config.zones) zoneSelect.appendChild(h('option', { value: String(zone.id), selected: entry.zoneId === zone.id }, zone.label || zone.id));
      zoneSelect.addEventListener('change', () => { entry.zoneId = zoneSelect.value; onChange(); });
      const row = h('div.list-row.grp-item-row',
        h('div.list-row-head',
          h('span.list-index', String(index + 1)),
          h('div.row.gap-2.ml-auto.align-center',
            h('span.small.muted', t('teacher.grp_correct_zone')),
            zoneSelect,
            h('button.btn.btn-icon.btn-sm.btn-ghost', {
              type: 'button',
              'aria-label': t('common.remove'),
              title: t('common.remove'),
              on: { click: () => { config.items.splice(index, 1); rerender(); onChange(); } },
            }, h('span', { html: '✕' })),
          ),
        ),
        sideEditor(entry, index),
      );
      host.appendChild(row);
    });
    if (config.items.length === 0) host.appendChild(h('p.help', t('teacher.list_empty')));
  }

  const host = h('div.grp-editor');
  rerender();
  container.appendChild(host);
}

// ---------------------------------------------------------------------------
// mark_sentence editor (word chips)
// ---------------------------------------------------------------------------

function renderMarkSentenceEditor(container, { item, onChange }) {
  const config = item.config;
  if (!['mark', 'correct'].includes(config.mode)) config.mode = 'mark';
  if (!Array.isArray(config.words)) config.words = [];

  function rerender() {
    clear(host);
    const modeId = uid('ms-mode');
    const modeSelect = h('select.select.select-sm', { id: modeId });
    modeSelect.appendChild(h('option', { value: 'mark', selected: config.mode === 'mark' }, t('teacher.ms_mode_mark')));
    modeSelect.appendChild(h('option', { value: 'correct', selected: config.mode === 'correct' }, t('teacher.ms_mode_correct')));
    modeSelect.addEventListener('change', () => { config.mode = modeSelect.value; rerender(); onChange(); });
    host.appendChild(h('div.field.field-sm', h('label.label', { for: modeId }, t('teacher.ms_mode')), modeSelect));

    // sentence input + take-words
    const textId = uid('ms-text');
    const currentSentence = config.words.map((w) => w.text).join(' ');
    const textarea = h('textarea.textarea', { id: textId, rows: 2 });
    textarea.value = currentSentence;
    const takeBtn = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.ms_take_words'));
    takeBtn.addEventListener('click', () => {
      const parts = textarea.value.split(/\s+/).filter(Boolean).slice(0, 120);
      const old = config.words || [];
      config.words = parts.map((text, index) => {
        const prev = old[index] && old[index].text === text ? old[index] : null;
        return { text, target: prev ? prev.target : 'none', fix: prev && prev.target === 'wrong' ? prev.fix || '' : '' };
      });
      rerender();
      onChange();
    });
    host.appendChild(h('div.field.field-sm', h('label.label', { for: textId }, t('teacher.ms_sentence')), textarea));
    host.appendChild(h('div.row.gap-2.mt-1', takeBtn));

    // chips
    host.appendChild(h('div.row.wrap.gap-2.mt-2',
      ...config.words.map((word, index) => {
        const chip = h('span.ms-chip', { dataset: { target: word.target } },
          h('button.btn.btn-sm.btn-ghost.ms-chip-word', {
            type: 'button',
            title: t(`teacher.ms_target_${word.target}`),
            'aria-pressed': word.target !== 'none' ? 'true' : 'false',
            on: {
              click: () => {
                const cycle = config.mode === 'mark' ? ['none', 'mark'] : ['none', 'wrong'];
                const next = cycle[(cycle.indexOf(word.target) + 1) % cycle.length];
                word.target = next;
                if (next !== 'wrong') word.fix = '';
                rerender();
                onChange();
              },
            },
          }, word.text),
          h('button.btn.btn-icon.btn-sm.btn-ghost', {
            type: 'button',
            'aria-label': t('common.remove'),
            on: { click: () => { config.words.splice(index, 1); rerender(); onChange(); } },
          }, h('span', { html: '✕' })),
        );
        if (config.mode === 'correct' && word.target === 'wrong') {
          chip.appendChild(h('input.input.input-sm.ms-fix-input', {
            type: 'text',
            value: word.fix || '',
            placeholder: t('teacher.ms_fix_ph'),
            'aria-label': t('teacher.ms_fix_label', { word: word.text }),
            on: { input: (e) => { word.fix = e.target.value; onChange(); } },
          }));
        }
        return chip;
      }),
    ));
    if (config.words.length === 0) host.appendChild(h('p.help', t('teacher.ms_empty')));

    // add word
    const wordId = uid('ms-newword');
    const wordInput = h('input.input.input-sm', { id: wordId, type: 'text', placeholder: t('teacher.ms_word_ph'), style: 'max-width:200px' });
    host.appendChild(h('div.row.gap-2.mt-2.align-center',
      h('label.label.mb-0', { for: wordId }, t('teacher.ms_add_word')),
      wordInput,
      h('button.btn.btn-sm.btn-secondary', {
        type: 'button',
        on: {
          click: () => {
            const text = wordInput.value.trim();
            if (!text) return;
            config.words.push({ text: text.slice(0, 200), target: 'none', fix: '' });
            rerender();
            onChange();
          },
        },
      }, t('teacher.list_add')),
    ));
  }

  const host = h('div.ms-editor');
  rerender();
  container.appendChild(host);
}

// ---------------------------------------------------------------------------
// Crossword editor (v0.8): word rows + auto-layout + solution preview grid.
// ---------------------------------------------------------------------------

function renderCrosswordEditor(container, { item, onChange }) {
  const config = item.config;
  if (typeof config.title !== 'string') config.title = '';
  if (!Array.isArray(config.words)) config.words = [];

  function rerender() {
    clear(host);

    const titleId = uid('cw-title');
    const titleInput = h('input.input.input-sm', { id: titleId, type: 'text', value: config.title, placeholder: t('teacher.cw_title_ph') });
    titleInput.addEventListener('input', () => { config.title = titleInput.value; onChange(); });
    host.appendChild(h('div.field.field-sm', h('label.label', { for: titleId }, t('teacher.cw_title')), titleInput));

    // auto-layout button
    const autoBtn = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.cw_autolayout'));
    autoBtn.addEventListener('click', () => {
      const placed = autoLayout(config.words);
      if (!placed) {
        host.querySelector('.cw-error').textContent = t('teacher.cw_autolayout_failed');
        return;
      }
      config.words = config.words.slice(0, placed.length).map((word, index) => ({
        ...word,
        row: placed[index].row,
        col: placed[index].col,
        direction: placed[index].direction,
      }));
      rerender();
      onChange();
    });
    host.appendChild(h('div.row.gap-2.align-center.mb-2',
      autoBtn,
      h('p.error-text.cw-error', { role: 'alert', hidden: false, style: 'margin:0' }),
    ));

    // word rows
    const list = h('div.cw-word-list');
    config.words.forEach((word, index) => {
      const row = h('div.list-row.cw-word-row', { dataset: { index: String(index) } });
      const wordInput = h('input.input.input-sm.cw-word', { type: 'text', value: word.word, placeholder: t('teacher.cw_word_ph'), 'aria-label': t('teacher.cw_word_ph') });
      wordInput.addEventListener('input', () => { word.word = wordInput.value; onChange(); });
      const clueInput = h('input.input.input-sm.cw-clue', { type: 'text', value: word.clue, placeholder: t('teacher.cw_clue_ph'), 'aria-label': t('teacher.cw_clue_ph') });
      clueInput.addEventListener('input', () => { word.clue = clueInput.value; onChange(); });
      const rowInput = h('input.input.input-sm.cw-pos', { type: 'number', min: '0', max: '19', value: String(word.row), title: t('teacher.cw_row') });
      rowInput.addEventListener('input', () => { word.row = Number(rowInput.value) || 0; onChange(); });
      const colInput = h('input.input.input-sm.cw-pos', { type: 'number', min: '0', max: '19', value: String(word.col), title: t('teacher.cw_col') });
      colInput.addEventListener('input', () => { word.col = Number(colInput.value) || 0; onChange(); });
      const dirSelect = h('select.select.select-sm.cw-dir');
      dirSelect.appendChild(h('option', { value: 'across', selected: word.direction !== 'down' }, t('teacher.cw_across')));
      dirSelect.appendChild(h('option', { value: 'down', selected: word.direction === 'down' }, t('teacher.cw_down')));
      dirSelect.addEventListener('change', () => { word.direction = dirSelect.value; rerender(); onChange(); });
      const delBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button',
        'aria-label': t('common.remove'),
        on: { click: () => { config.words.splice(index, 1); rerender(); onChange(); } },
      }, h('span', { html: '✕' }));
      row.append(wordInput, clueInput, rowInput, colInput, dirSelect, delBtn);
      list.appendChild(row);
    });
    host.appendChild(list);
    host.appendChild(h('div.row.gap-2.mt-2',
      h('button.btn.btn-sm.btn-secondary', {
        type: 'button',
        on: {
          click: () => {
            config.words.push({ id: nextConfigId(config.words, 'w'), word: '', clue: '', row: 0, col: 0, direction: 'across' });
            rerender();
            onChange();
          },
        },
      }, t('teacher.cw_add_word')),
    ));

    // preview grid (teacher sees the solution)
    const grid = buildGrid(config.words.filter((w) => lettersOf(w.word).length >= 2));
    if (grid && grid.cells.size > 0) {
      const table = h('table.cw-preview-grid');
      for (let r = 0; r < grid.rows; r += 1) {
        const tr = h('tr');
        for (let c = 0; c < grid.cols; c += 1) {
          const cell = grid.cells.get(`${r},${c}`);
          const td = h('td', cell ? { text: cell.letter, class: 'cw-preview-cell' } : { class: 'cw-preview-block' });
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      host.appendChild(h('div.cw-preview.mt-2', h('p.help.mb-1', t('teacher.cw_preview')), table));
    } else if (config.words.length > 0) {
      host.appendChild(h('p.error-text', t('teacher.cw_conflict')));
    }
  }

  const host = h('div.cw-editor');
  rerender();
  container.appendChild(host);
}

// ---------------------------------------------------------------------------
// Vocabulary editor (v0.7): mode/direction switches + entry grid with media
// pickers + "load from saved vocab list".
// ---------------------------------------------------------------------------

const VOCAB_MODES = ['flashcards', 'translate', 'listen', 'example', 'match'];
const VOCAB_DIRECTIONS = ['term_to_translation', 'translation_to_term', 'both'];

function renderVocabularyEditor(container, { item, onChange }) {
  const config = item.config;
  if (!VOCAB_MODES.includes(config.mode)) config.mode = 'translate';
  if (!VOCAB_DIRECTIONS.includes(config.direction)) config.direction = 'term_to_translation';
  if (typeof config.shuffle !== 'boolean') config.shuffle = true;
  if (typeof config.caseSensitive !== 'boolean') config.caseSensitive = false;
  if (!Array.isArray(config.entries)) config.entries = [];

  function rerender() {
    clear(host);

    // --- mode / direction / options --------------------------------------
    const modeId = uid('vc-mode');
    const modeSelect = h('select.select.select-sm', { id: modeId });
    for (const value of VOCAB_MODES) {
      modeSelect.appendChild(h('option', { value, selected: config.mode === value }, t(`teacher.vc_mode_${value}`)));
    }
    modeSelect.addEventListener('change', () => { config.mode = modeSelect.value; rerender(); onChange(); });

    const dirId = uid('vc-dir');
    const dirSelect = h('select.select.select-sm', { id: dirId });
    for (const value of VOCAB_DIRECTIONS) {
      dirSelect.appendChild(h('option', { value, selected: config.direction === value }, t(`teacher.vc_dir_${value}`)));
    }
    dirSelect.addEventListener('change', () => { config.direction = dirSelect.value; rerender(); onChange(); });

    const shuffleId = uid('vc-shuf');
    const shuffleBox = h('input', { id: shuffleId, type: 'checkbox', checked: config.shuffle === true });
    shuffleBox.addEventListener('change', () => { config.shuffle = shuffleBox.checked; onChange(); });
    const caseId = uid('vc-case');
    const caseBox = h('input', { id: caseId, type: 'checkbox', checked: config.caseSensitive === true });
    caseBox.addEventListener('change', () => { config.caseSensitive = caseBox.checked; onChange(); });

    host.appendChild(h('div.row.wrap.gap-3',
      h('div.field.field-sm', h('label.label', { for: modeId }, t('teacher.vc_mode')), modeSelect),
      h('div.field.field-sm', h('label.label', { for: dirId }, t('teacher.vc_direction')), dirSelect),
      h('label.switch.field-row', shuffleBox, h('span.track', { 'aria-hidden': 'true' }), h('span.small', t('teacher.vc_shuffle'))),
      h('label.switch.field-row', caseBox, h('span.track', { 'aria-hidden': 'true' }), h('span.small', t('teacher.vc_case'))),
    ));

    // --- load from a saved vocab list -------------------------------------
    const listId = uid('vc-list');
    const listSelect = h('select.select.select-sm', { id: listId });
    listSelect.appendChild(h('option', { value: '' }, t('teacher.vc_pick_list')));
    const loadBtn = h('button.btn.btn-sm.btn-secondary', { type: 'button' }, t('teacher.vc_load_list'));
    loadBtn.addEventListener('click', async () => {
      const listIdValue = listSelect.value;
      if (!listIdValue) return;
      loadBtn.disabled = true;
      try {
        const data = await get(`/api/vocab-lists/${encodeURIComponent(listIdValue)}`);
        const incoming = Array.isArray(data.entries) ? data.entries : [];
        config.entries = incoming.slice(0, 60).map((entry) => ({
          id: nextConfigId(config.entries, 'e'),
          term: String(entry.term || ''),
          translation: String(entry.translation || ''),
          alternatives: Array.isArray(entry.alternatives) ? entry.alternatives.map(String) : [],
          example: String(entry.example || ''),
          imageAssetId: String(entry.imageAssetId || ''),
          audioAssetId: String(entry.audioAssetId || ''),
        }));
        rerender();
        onChange();
      } catch {
        /* toast handled by api layer */
      } finally {
        loadBtn.disabled = false;
      }
    });
    get('/api/vocab-lists')
      .then((data) => {
        for (const list of data.lists || []) {
          listSelect.appendChild(h('option', { value: list.id }, `${list.title} (${list.entryCount})`));
        }
      })
      .catch(() => {});
    host.appendChild(h('div.field.field-sm',
      h('label.label', { for: listId }, t('teacher.vc_from_list')),
      h('div.row.gap-2.align-center', listSelect, loadBtn),
    ));

    // --- entries grid -------------------------------------------------------
    const grid = h('div.vocab-entry-grid');
    config.entries.forEach((entry, index) => {
      const row = h('div.list-row.vocab-entry-row', { dataset: { index: String(index) } });
      const termInput = h('input.input.input-sm.vc-term', { type: 'text', value: entry.term, placeholder: t('teacher.vc_term'), 'aria-label': t('teacher.vc_term') });
      termInput.addEventListener('input', () => { entry.term = termInput.value; onChange(); });
      const transInput = h('input.input.input-sm.vc-trans', { type: 'text', value: entry.translation, placeholder: t('teacher.vc_translation'), 'aria-label': t('teacher.vc_translation') });
      transInput.addEventListener('input', () => { entry.translation = transInput.value; onChange(); });
      const altInput = h('input.input.input-sm.vc-alt', { type: 'text', value: (entry.alternatives || []).join(', '), placeholder: t('teacher.vc_alternatives'), 'aria-label': t('teacher.vc_alternatives') });
      altInput.addEventListener('input', () => {
        entry.alternatives = altInput.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        onChange();
      });
      const exInput = h('input.input.input-sm.vc-example', { type: 'text', value: entry.example, placeholder: t('teacher.vc_example'), 'aria-label': t('teacher.vc_example') });
      exInput.addEventListener('input', () => { entry.example = exInput.value; onChange(); });

      const imgInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'sr-only' });
      imgInput.addEventListener('change', async () => {
        const file = imgInput.files && imgInput.files[0];
        if (!file) return;
        const asset = await pickAssetOrToast(file);
        if (asset) { entry.imageAssetId = asset.id; rerender(); onChange(); }
      });
      const audioInput = h('input', { type: 'file', accept: AUDIO_ACCEPT, class: 'sr-only' });
      audioInput.addEventListener('change', async () => {
        const file = audioInput.files && audioInput.files[0];
        if (!file) return;
        const asset = await pickAssetOrToast(file);
        if (asset) { entry.audioAssetId = asset.id; rerender(); onChange(); }
      });
      const imgBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button',
        title: entry.imageAssetId ? t('teacher.pins_replace') : t('teacher.pins_upload'),
        'aria-label': t('teacher.vc_image'),
        on: { click: () => imgInput.click() },
      }, h('span', { html: icon('image', { size: 16 }) }));
      if (entry.imageAssetId) imgBtn.classList.add('has-asset');
      const audioBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button',
        title: entry.audioAssetId ? t('teacher.pins_replace') : t('teacher.upload_audio'),
        'aria-label': t('teacher.vc_audio'),
        on: { click: () => audioInput.click() },
      }, h('span', { html: icon('mic', { size: 16 }) }));
      if (entry.audioAssetId) audioBtn.classList.add('has-asset');
      const delBtn = h('button.btn.btn-icon.btn-sm.btn-ghost', {
        type: 'button',
        'aria-label': t('common.remove'),
        on: { click: () => { config.entries.splice(index, 1); rerender(); onChange(); } },
      }, h('span', { html: '✕' }));

      row.append(
        h('div.row.gap-2.align-center', termInput, transInput, altInput),
        h('div.row.gap-2.align-center', exInput),
        h('div.row.gap-1.align-center', imgBtn, audioBtn, imgInput, audioInput, delBtn),
      );
      grid.appendChild(row);
    });
    host.appendChild(grid);
    if (config.entries.length === 0) host.appendChild(h('p.help', t('teacher.vc_empty')));

    host.appendChild(h('div.row.gap-2.mt-2',
      h('button.btn.btn-sm.btn-secondary', {
        type: 'button',
        on: {
          click: () => {
            config.entries.push({ id: nextConfigId(config.entries, 'e'), term: '', translation: '', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' });
            rerender();
            onChange();
          },
        },
      }, t('teacher.vc_add_entry')),
    ));
  }

  const host = h('div.vocab-editor');
  rerender();
  container.appendChild(host);
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
  if (item.type === 'writing') {
    renderWritingEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'pins') {
    renderPinsEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'image_boxes') {
    renderImageBoxesEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'match') {
    renderMatchEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'text') {
    renderTextEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'hotspot') {
    renderHotspotEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'table') {
    renderTableEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'groups') {
    renderGroupsEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'mark_sentence') {
    renderMarkSentenceEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'vocabulary') {
    renderVocabularyEditor(container, { item, onChange: change });
    return;
  }
  if (item.type === 'crossword') {
    renderCrosswordEditor(container, { item, onChange: change });
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
