// Browser API client. Thin fetch wrapper + participant token storage.
// Throws ApiError with the server's error code so callers can localize via
// `errorMessage(err)` (keys errors.<code>).
import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * api('/api/me') / api('/api/activities', { method: 'POST', body: {...} })
 * Returns parsed JSON, or null for 204. Throws ApiError.
 */
export async function api(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal, raw = false } = options;
  const finalHeaders = { Accept: 'application/json', ...headers };
  const fetchOptions = { method, credentials: 'same-origin', headers: finalHeaders, signal };

  if (body !== undefined && body !== null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      fetchOptions.body = body;
    } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
      fetchOptions.body = body;
    } else if (body instanceof ArrayBuffer) {
      fetchOptions.body = body;
    } else if (typeof body === 'string' && finalHeaders['Content-Type']) {
      fetchOptions.body = body;
    } else {
      finalHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }
  }

  let response;
  try {
    response = await fetch(path, fetchOptions);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'Network error');
  }

  if (response.status === 204) return null;
  if (raw) return response;

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = '';
    }
  }

  if (!response.ok) {
    const error = (data && data.error) || {};
    throw new ApiError(
      response.status,
      error.code || 'http_error',
      error.message || `HTTP ${response.status}`,
      error.details,
    );
  }
  return data;
}

export const get = (path, options) => api(path, { ...options, method: 'GET' });
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const put = (path, body, options) => api(path, { ...options, method: 'PUT', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const del = (path, options) => api(path, { ...options, method: 'DELETE' });

// ---------------------------------------------------------------------------
// Participant (student) token — per assignment code, survives reloads/devices.
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = 'ow_pt_';

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function getParticipantToken(code) {
  try {
    return localStorage.getItem(TOKEN_PREFIX + normalizeCode(code));
  } catch {
    return null;
  }
}

export function setParticipantToken(code, token) {
  try {
    localStorage.setItem(TOKEN_PREFIX + normalizeCode(code), token);
  } catch {
    /* private mode / quota — token stays in memory only for this page */
  }
}

export function clearParticipantToken(code) {
  try {
    localStorage.removeItem(TOKEN_PREFIX + normalizeCode(code));
  } catch {
    /* ignore */
  }
}

export function participantHeaders(token) {
  return token ? { 'X-Participant-Token': token } : {};
}

// ---------------------------------------------------------------------------
// Class (bundle) token — per class code, survives reloads/devices.
// ---------------------------------------------------------------------------

const CLASS_TOKEN_PREFIX = 'ow_ct_';
const CLASS_NAME_PREFIX = 'ow_cn_';

export function getClassToken(code) {
  try {
    return localStorage.getItem(CLASS_TOKEN_PREFIX + normalizeCode(code));
  } catch {
    return null;
  }
}

export function setClassToken(code, token) {
  try {
    localStorage.setItem(CLASS_TOKEN_PREFIX + normalizeCode(code), token);
  } catch {
    /* private mode / quota — token stays in memory only for this page */
  }
}

export function clearClassToken(code) {
  try {
    localStorage.removeItem(CLASS_TOKEN_PREFIX + normalizeCode(code));
    localStorage.removeItem(CLASS_NAME_PREFIX + normalizeCode(code));
  } catch {
    /* ignore */
  }
}

export function getClassName(code) {
  try {
    return localStorage.getItem(CLASS_NAME_PREFIX + normalizeCode(code));
  } catch {
    return null;
  }
}

export function setClassName(code, name) {
  try {
    localStorage.setItem(CLASS_NAME_PREFIX + normalizeCode(code), String(name || ''));
  } catch {
    /* ignore */
  }
}

export function classHeaders(token) {
  return token ? { 'X-Class-Token': token } : {};
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function joinUrl(code) {
  return `${window.location.origin}/a/${encodeURIComponent(normalizeCode(code))}`;
}

/** Upload a file via the raw-body asset endpoint. Returns {asset}. */
export async function uploadAsset(file) {
  const response = await fetch(`/api/assets?filename=${encodeURIComponent(file.name || 'upload')}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data && data.error) || {};
    throw new ApiError(response.status, error.code || 'upload_failed', error.message || 'Upload failed', error.details);
  }
  return data;
}

/**
 * Upload a student's audio recording (participant token or student session).
 * Returns {asset}. Used by the audio_answer renderer via ctx.uploadAudio.
 */
export async function uploadParticipantAsset(blob, token, filename = 'aufnahme.webm') {
  const headers = { 'Content-Type': blob.type || 'audio/webm' };
  if (token) headers['X-Participant-Token'] = token;
  const response = await fetch(`/api/participant/assets?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: blob,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data && data.error) || {};
    throw new ApiError(response.status, error.code || 'upload_failed', error.message || 'Upload failed', error.details);
  }
  return data;
}

const ERROR_MESSAGE_KEYS = {
  network_error: 'errors.network_error',
  invalid_credentials: 'errors.invalid_credentials',
  unauthorized: 'errors.unauthorized',
  forbidden: 'errors.forbidden',
  not_found: 'errors.not_found',
  validation_failed: 'errors.validation_failed',
  invalid_request: 'errors.invalid_request',
  revision_conflict: 'errors.revision_conflict',
  rate_limited: 'errors.rate_limited',
  payload_too_large: 'errors.payload_too_large',
  unsupported_type: 'errors.unsupported_type',
  assignment_closed: 'errors.assignment_closed',
  invalid_code: 'errors.invalid_code',
  invalid_participant_token: 'errors.invalid_participant_token',
  attempt_submitted: 'errors.attempt_submitted',
  time_expired: 'errors.time_expired',
  bad_origin: 'errors.bad_origin',
  upload_failed: 'errors.upload_failed',
  name_required: 'errors.name_required',
  invalid_name: 'errors.invalid_name',
  class_required: 'errors.class_required',
  item_locked: 'errors.item_locked',
  invalid_class_token: 'errors.invalid_class_token',
  class_empty: 'errors.class_empty',
  not_in_class: 'errors.not_in_class',
};

/** Localized human message for an ApiError (falls back to a generic message). */
export function errorMessage(error) {
  const code = error && error.code;
  const key = code && ERROR_MESSAGE_KEYS[code];
  if (key) {
    const message = t(key);
    if (message && message !== key) return message;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return t('errors.network_error');
  // Server HttpError messages are user-facing by design (validation, LLM
  // provider details, …) — show them instead of a generic "something went
  // wrong", otherwise e.g. "model not found" is invisible.
  if (error && typeof error.message === 'string' && error.message && !(error instanceof TypeError)) {
    return error.message;
  }
  return t('errors.unknown');
}
