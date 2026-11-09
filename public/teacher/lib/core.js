// Small shared helpers for the teacher app: auth redirects, asset URLs, number
// and date formatting helpers that have no natural home in public/lib/*.
import { getLocale, t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { h } from '/lib/dom.js';

export function redirectToLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.replace('/login?next=' + encodeURIComponent(next));
}

/**
 * Navigate the SPA. `replace` avoids an extra history entry (used for
 * canonicalising URLs). Views never touch location directly.
 */
export function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('ow:navigate', { detail: { path } }));
}

/** Download a JSON/file response returned by api(..., { raw: true }). */
export async function downloadResponse(response, fallbackName) {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  let name = fallbackName;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  if (match && match[1]) name = match[1];
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Build a fully qualified URL path for an assignment code. */
export function joinUrlForCode(code) {
  return `${window.location.origin}/a/${encodeURIComponent(String(code || '').toUpperCase())}`;
}

export function apiBaseUrl() {
  return window.location.origin;
}

// ---------------------------------------------------------------------------
// Asset URLs. The canonical media object only stores `assetId`; the upload
// endpoint returns the served URL which we remember for the session (and in
// localStorage so authoring survives a reload). The generic fallback route
// uses the asset id as the filename, which the server accepts.
// ---------------------------------------------------------------------------

const ASSET_URL_STORAGE = 'ow_asset_urls';

function readAssetUrls() {
  try {
    const raw = localStorage.getItem(ASSET_URL_STORAGE);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberAssetUrl(asset) {
  if (!asset || !asset.id) return;
  const url = asset.url || `/assets/${asset.id}/${encodeURIComponent(asset.filename || asset.id)}`;
  try {
    const all = readAssetUrls();
    all[asset.id] = url;
    localStorage.setItem(ASSET_URL_STORAGE, JSON.stringify(all));
  } catch {
    /* quota/private mode — fallback route still works */
  }
}

export function assetUrl(assetId) {
  if (!assetId) return '';
  const remembered = readAssetUrls()[assetId];
  if (remembered) return remembered;
  return `/assets/${assetId}/${assetId}`;
}

/** Resolve the media object of an item to an absolute URL (or '' for none). */
export function mediaUrl(media) {
  if (!media || media.type === 'none') return '';
  if (media.type === 'video') return media.url || '';
  return assetUrl(media.assetId);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const locale = getLocale() === 'en' ? 'en-US' : 'de-AT';
  try {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(current)} ${units[index]}`;
  } catch {
    return `${Math.round(current * 10) / 10} ${units[index]}`;
  }
}

/** ISO → value for <input type="datetime-local"> in the local timezone. */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO string (or null). */
export function localInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function todayStartLocalIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

/** Localized, human friendly relative "saved" time for the editor toolbar. */
export function relativeSavedLabel(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return t('teacher.just_now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('teacher.minutes_ago', { n: minutes });
  return t('teacher.at_time', { time: new Date(iso).toLocaleTimeString(getLocale() === 'en' ? 'en-GB' : 'de-AT', { hour: '2-digit', minute: '2-digit' }) });
}

/** Parse a definition that may arrive as an object or a JSON string. */
export function parseDefinition(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** Human label for an activity template. */
export function templateLabel(template) {
  return t(template === 'quiz' ? 'teacher.template_quiz' : 'teacher.template_worksheet');
}

export function statusBadge(kind, label) {
  const map = {
    open: 'badge-success',
    closed: 'badge-danger',
    draft: 'badge',
    published: 'badge-success',
    in_progress: 'badge-warning',
    submitted: 'badge-primary',
    graded: 'badge-success',
  };
  return h(`span.badge.${map[kind] || 'badge'}`, label);
}

export function typeIconPlaceholder() {
  return h('span', { html: icon('sparkle', { size: 16 }) });
}
