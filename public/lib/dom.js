// DOM helpers shared by all pages. Everything user-provided is inserted as text
// nodes; `h(..., { html })` exists only for trusted, developer-authored markup
// (icons, static templates) and must never receive user/teacher content.
import { t, formatNumber, formatDateTime, formatDate, getLocale } from './i18n.js';

export { formatNumber, formatDateTime, formatDate, getLocale };

const SELECTOR_RE = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][A-Za-z0-9_-]+)*)$/;
const PROP_KEYS = new Set([
  'value',
  'checked',
  'disabled',
  'hidden',
  'selected',
  'readOnly',
  'multiple',
  'required',
  'open',
  'indeterminate',
  'htmlFor',
  'id',
  'type',
  'min',
  'max',
  'step',
  'placeholder',
]);

function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
      continue;
    }
    if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/**
 * Hyperscript: h('div.card', { class: 'extra', on: { click } }, 'text', childNode)
 * Selector syntax supports tag, .classes and #id.
 */
export function h(spec, props, ...children) {
  let tag = 'div';
  const classes = [];
  let id = null;
  const match = String(spec || 'div').match(SELECTOR_RE);
  if (match) {
    if (match[1]) tag = match[1];
    if (match[2]) {
      for (const part of match[2].matchAll(/([.#])([A-Za-z0-9_-]+)/g)) {
        if (part[1] === '.') classes.push(part[2]);
        else id = part[2];
      }
    }
  } else {
    tag = String(spec);
  }

  const el = document.createElement(tag);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');

  // Allow h('div', 'text') / h('div', childNode) call styles.
  if (props !== null && props !== undefined) {
    const isChild =
      props instanceof Node ||
      Array.isArray(props) ||
      typeof props === 'string' ||
      typeof props === 'number';
    if (isChild) {
      children.unshift(props);
      props = null;
    }
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) {
        if (value === false && PROP_KEYS.has(key)) el[key] = false;
        continue;
      }
      switch (key) {
        case 'class':
        case 'className': {
          const extra = Array.isArray(value) ? value.join(' ') : String(value);
          if (extra) el.className = [el.className, extra].filter(Boolean).join(' ');
          break;
        }
        case 'dataset':
          for (const [dataKey, dataValue] of Object.entries(value)) {
            if (dataValue !== null && dataValue !== undefined) el.dataset[dataKey] = String(dataValue);
          }
          break;
        case 'style':
          if (typeof value === 'string') {
            el.setAttribute('style', value);
          } else {
            for (const [styleKey, styleValue] of Object.entries(value)) {
              if (styleValue !== null && styleValue !== undefined) el.style.setProperty(styleKey, String(styleValue));
            }
          }
          break;
        case 'on':
          for (const [eventName, listener] of Object.entries(value)) {
            if (typeof listener === 'function') el.addEventListener(eventName, listener);
          }
          break;
        case 'text':
          el.textContent = String(value);
          break;
        case 'html':
          // Trusted developer markup only (icons / static templates).
          el.innerHTML = String(value);
          break;
        default:
          if (PROP_KEYS.has(key)) el[key] = value;
          else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  appendChildren(el, children);
  return el;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function on(target, eventName, handler, options) {
  target.addEventListener(eventName, handler, options);
  return () => target.removeEventListener(eventName, handler, options);
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function debounce(fn, waitMs = 300) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, waitMs);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    fn(...(lastArgs || []));
  };
  return debounced;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// ---------------------------------------------------------------------------
// Markdown-lite rich text: **bold**, *italic*, __bold__, _italic_, "- " lists,
// blank lines as paragraph breaks. Everything becomes real DOM text nodes.
// ---------------------------------------------------------------------------

/** Safe image URL for inline rich text: only /assets/… or http(s). */
export function safeImageUrl(url) {
  const value = String(url ?? '').trim();
  if (/^\/assets\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) return value;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(value)) return value;
  return null;
}

function appendImage(parent, alt, url) {
  const src = safeImageUrl(url);
  if (!src) return;
  const img = document.createElement('img');
  img.className = 'rt-image';
  img.src = src;
  img.alt = String(alt || '');
  img.loading = 'lazy';
  parent.appendChild(img);
}

function appendInline(parent, text, options) {
  // images ![alt](url) first (start with "!"), then gaps <<…>>, then bold/italic
  const pattern = /(!\[[^\]]*\]\([^)]+\))|(<<[^<>]*>>)|(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match;
  let gapCounter = options && options.gapCounter ? options.gapCounter : { n: 0 };
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (match[1]) {
      const imgMatch = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      appendImage(parent, imgMatch ? imgMatch[1] : '', imgMatch ? imgMatch[2] : '');
    } else if (match[2]) {
      gapCounter.n += 1;
      const gapId = `g${gapCounter.n}`;
      if (options && options.editableGaps) {
        const input = document.createElement('input');
        input.className = 'rt-gap';
        input.type = 'text';
        input.dataset.gap = gapId;
        input.setAttribute('aria-label', options.gapLabel ? options.gapLabel(gapId, gapCounter.n) : `Lücke ${gapCounter.n}`);
        const values = options.gapValues || {};
        input.value = values[gapId] !== undefined && values[gapId] !== null ? String(values[gapId]) : '';
        if (options.readonlyGaps) input.disabled = true;
        if (typeof options.onGapInput === 'function') {
          input.addEventListener('input', () => options.onGapInput(gapId, input.value));
        }
        parent.appendChild(input);
      } else {
        // plain rendering: show the gap marker literally (teacher preview /
        // print). Never render the raw answer as an input.
        parent.appendChild(document.createTextNode('⟨⟩'));
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function isTableSeparator(line) {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-') && line.replace(/[|\s:\-]/g, '').length === 0;
}

function renderTable(container, rows) {
  // rows: [{ cells: string[], separator: bool }]
  const table = document.createElement('table');
  table.className = 'rt-table';
  const hasHeader = rows.length > 1 && !!rows[1].separator;
  let head = null;
  let body = null;
  rows.forEach((row, rowIndex) => {
    if (row.separator) return;
    const tr = document.createElement('tr');
    const isHeadRow = hasHeader && rowIndex === 0;
    if (isHeadRow && !head) {
      head = document.createElement('thead');
      table.appendChild(head);
    } else if (!body) {
      body = document.createElement('tbody');
      table.appendChild(body);
    }
    for (const cell of row.cells) {
      const td = document.createElement(isHeadRow ? 'th' : 'td');
      appendInline(td, cell);
      tr.appendChild(td);
    }
    (isHeadRow ? head : body).appendChild(tr);
  });
  container.appendChild(table);
}

function splitTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/**
 * Markdown-lite rich text: **bold**, *italic*, __bold__, _italic_, "- " lists,
 * tables ("| a | b |" lines with an optional |---| separator row), inline
 * images ![alt](url) (only /assets/… or http(s) URLs), and answer gaps
 * <<answer>>. With options.editableGaps the <<…>> markers become text inputs
 * (gap ids g1..gN in order of appearance); gap answers stay hidden otherwise.
 */
export function renderRichText(container, text, options = null) {
  if (!container) return container;
  clear(container);
  const lines = String(text ?? '').split(/\r?\n/);
  let list = null;
  let tableRows = null;
  const flushTable = () => {
    if (tableRows && tableRows.length) renderTable(container, tableRows);
    tableRows = null;
  };
  for (const line of lines) {
    if (/^\s*\|/.test(line) && line.includes('|', 1)) {
      list = null;
      if (!tableRows) tableRows = [];
      tableRows.push({ cells: splitTableRow(line), separator: isTableSeparator(line) });
      continue;
    }
    flushTable();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement('ul');
        container.appendChild(list);
      }
      const item = document.createElement('li');
      appendInline(item, bullet[1], options);
      list.appendChild(item);
      continue;
    }
    list = null;
    if (line.trim() === '') {
      const spacer = document.createElement('div');
      spacer.className = 'rt-spacer';
      container.appendChild(spacer);
      continue;
    }
    const paragraph = document.createElement('div');
    paragraph.className = 'rt-line';
    appendInline(paragraph, line, options);
    container.appendChild(paragraph);
  }
  flushTable();
  return container;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtScore(score, max) {
  const round = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return formatNumber(Math.round(n * 100) / 100);
  };
  if (max === undefined || max === null) return round(score);
  return `${round(score)} / ${round(max)}`;
}

export function fmtPercent(part, total) {
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return '0 %';
  const percent = Math.max(0, Math.min(100, (Number(part) / totalNum) * 100));
  return `${formatNumber(Math.round(percent))} %`;
}

export function fmtDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diffSeconds = Math.round((Date.now() - ms) / 1000);
  if (diffSeconds < 40) return t('common.online');
  if (diffSeconds < 120) return t('common.online');
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return formatDateTime(iso);
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

function toastContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }
  return container;
}

export function toast(message, kind = 'info', durationMs = 4000) {
  const container = toastContainer();
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.textContent = String(message);
  container.appendChild(node);
  setTimeout(() => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 250);
  }, durationMs);
  return node;
}

/**
 * Accessible modal dialog. `body` may be a Node or a string (plain text).
 * actions: [{ label, kind: 'primary'|'secondary'|'danger', onClick(close) }]
 */
export function modal({ title, body, actions = [], size = 'md', dismissible = true } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `modal modal-${size}`;
  const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
  dialog.setAttribute('aria-labelledby', titleId);

  const header = h('div.modal-header', h('h2.modal-title', { id: titleId }, String(title || '')));
  const closeButton = h(
    'button.btn.btn-icon.btn-ghost',
    {
      type: 'button',
      'aria-label': t('common.close'),
      on: { click: () => close() },
    },
    h('span', { html: iconLikeX() }),
  );

  const content = h('div.modal-body');
  if (body instanceof Node) content.appendChild(body);
  else if (body !== undefined && body !== null) content.textContent = String(body);

  const footer = h('div.modal-footer');
  function close(result) {
    try {
      dialog.close();
    } catch {
      /* already closed */
    }
    dialog.remove();
    if (typeof dialog._resolve === 'function') {
      const resolve = dialog._resolve;
      dialog._resolve = null;
      resolve(result);
    }
  }

  for (const action of actions) {
    footer.appendChild(
      h(
        `button.btn.btn-${action.kind || 'secondary'}`,
        {
          type: 'button',
          on: {
            click: () => {
              const result = action.onClick ? action.onClick(close) : undefined;
              if (action.closeOnClick !== false && result !== false) close(action.value);
            },
          },
        },
        action.label,
      ),
    );
  }

  dialog.appendChild(header);
  dialog.appendChild(content);
  if (actions.length > 0) dialog.appendChild(footer);
  header.appendChild(closeButton);
  if (!dismissible) {
    dialog.addEventListener('cancel', (event) => event.preventDefault());
  }
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && dismissible) close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  return { dialog, body: content, close };
}

function iconLikeX() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
}

export function confirmDialog({
  title = t('common.confirm'),
  message = '',
  confirmLabel = t('common.confirm'),
  cancelLabel = t('common.cancel'),
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const dialog = modal({
      title,
      body: message,
      actions: [
        { label: cancelLabel, kind: 'secondary', onClick: () => resolve(false), closeOnClick: false, value: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true },
      ],
    });
    dialog.dialog._resolve = resolve;
    dialog.dialog.addEventListener('close', () => resolve(false));
  });
}

/** Disable a button and show a busy spinner while an async action runs. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add('is-busy');
  button.innerHTML = '<span class="spinner spinner-sm" aria-hidden="true"></span>';
  try {
    return await fn();
  } finally {
    button.disabled = wasDisabled;
    button.classList.remove('is-busy');
    button.innerHTML = original;
  }
}

export function spinner(size = 'md') {
  return h(`span.spinner.spinner-${size}`, { 'aria-hidden': 'true' });
}

export function emptyState(title, hint) {
  return h(
    'div.empty',
    h('p.empty-title', title),
    hint ? h('p.empty-hint.small.muted', hint) : null,
  );
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function setPageTitle(title) {
  document.title = title ? `${title} — OpenWidgets` : 'OpenWidgets';
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
