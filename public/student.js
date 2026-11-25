// OpenWidgets — student player page (public/student.html).
//
// Flow: /a/<CODE> → resume (participant token) or join (name form) → worksheet
// (single scroll) or quiz (one item per screen) → autosave (debounced PUT with
// an offline retry queue) → submit → result/review. Server-authoritative
// grading: the client never sees answer keys except `ctx.answerText` /
// solution zones the server explicitly includes in the result payload.
import {
  registerMessages,
  initLocale,
  setLocale,
  getLocale,
  applyI18n,
  mountLanguageToggle,
  onLocaleChange,
  t,
} from './lib/i18n.js';
import {
  h,
  qs,
  clear,
  toast,
  confirmDialog,
  fmtScore,
  fmtDuration,
  fmtPercent,
  renderRichText,
  formatNumber,
  prefersReducedMotion,
} from './lib/dom.js';
import {
  get,
  post,
  put,
  errorMessage,
  getParticipantToken,
  setParticipantToken,
  clearParticipantToken,
  participantHeaders,
  getClassToken,
  setClassToken,
  clearClassToken,
  getClassName,
  setClassName,
  classHeaders,
  uploadParticipantAsset,
} from './lib/api.js';
import { icon } from './lib/icons.js';
import { mountItem, getRenderer } from './render/index.js';
import { hashString } from '../shared/util.js';

// ---------------------------------------------------------------------------
// i18n (DE first, EN second; keys are namespaced student.*)
// ---------------------------------------------------------------------------

registerMessages({
  de: {
    'student.skip': 'Zum Inhalt springen',
    'student.footer': 'OpenWidgets — selbst gehostet',
    'student.join_eyebrow': 'Aufgabe',
    'student.class_eyebrow': 'Klasse',
    'student.class_join_hint': 'Geben Sie Ihren Namen ein, um der Klasse beizutreten.',
    'student.class_join_button': 'Klasse beitreten',
    'student.class_progress': '{done} von {total} erledigt',
    'student.class_mode_free': 'Freie Reihenfolge',
    'student.class_mode_sequence': 'Feste Reihenfolge',
    'student.class_item_locked': 'Gesperrt — zuerst Nr. {position} erledigen',
    'student.class_item_open': 'Öffnen',
    'student.class_item_review': 'Ansehen',
    'student.class_item_done': 'Erledigt',
    'student.class_score': '{score} / {maxScore} P.',
    'student.class_back': 'Zur Klasse',
    'student.class_via_link': 'Diese Aufgabe gehört zu einer Klasse. Treten Sie über den Klassen-Link bei:',
    'student.class_open_link': 'Zur Klasse',
    'student.class_invalid_code_title': 'Klassen-Code ungültig',
    'student.class_invalid_code_text': 'Zu diesem Link gibt es keine Klasse. Bitte prüfen Sie den Code oder den Link.',
    'student.class_empty': 'In dieser Klasse sind noch keine Aufgaben.',
    'student.name_label': 'Ihr Name',
    'student.name_label_optional': 'Ihr Name (optional)',
    'student.name_placeholder': 'Vor- und Nachname',
    'student.name_required': 'Bitte geben Sie Ihren Namen ein.',
    'student.name_optional_hint': 'Die Angabe des Namens ist freiwillig.',
    'student.join_hint': 'Geben Sie Ihren Namen ein, um die Aufgabe zu starten.',
    'student.join_button': 'Aufgabe starten',
    'student.template_worksheet': 'Arbeitsblatt',
    'student.template_quiz': 'Quiz',
    'student.code_label': 'Code',
    'student.question_of': 'Frage {current} von {total}',
    'student.answered_of': '{answered} von {total} beantwortet',
    'student.answered_short': '{answered}/{total} beantwortet',
    'student.points_badge': '{points} P.',
    'student.item_label': 'Aufgabe {number}: {type}',
    'student.star': 'Frage markieren',
    'student.star_remove': 'Markierung entfernen',
    'student.read_aloud': 'Vorlesen',
    'student.stop_read_aloud': 'Vorlesen stoppen',
    'student.tts_unsupported': 'Vorlesen wird von diesem Browser nicht unterstützt.',
    'student.tts_choices': 'Antwortmöglichkeiten:',
    'student.tts_blank': 'Lücke {number}',
    'student.tts_match': 'Ordnen Sie zu.',
    'student.tts_options': 'Auswahlmöglichkeiten:',
    'student.tts_order': 'Elemente:',
    'student.tts_pins': 'Markieren Sie im Bild:',
    'student.font_size': 'Schriftgröße',
    'student.font_small': 'Kleine Schrift',
    'student.font_medium': 'Normale Schrift',
    'student.font_large': 'Große Schrift',
    'student.save_pending': 'Speichert …',
    'student.save_saved': 'Gespeichert',
    'student.save_offline': 'Offline gespeichert',
    'student.save_error': 'Nicht gespeichert',
    'student.offline_text': 'Sie sind offline. Antworten werden auf diesem Gerät gespeichert und übertragen, sobald die Verbindung wieder da ist.',
    'student.offline_pending': 'Offline — {count} Antwort(en) warten auf Übertragung.',
    'student.online_again': 'Verbindung wieder da — Antworten werden übertragen …',
    'student.submit': 'Abgeben',
    'student.submit_confirm_title': 'Aufgabe abgeben?',
    'student.submit_confirm_text': 'Nach der Abgabe können Sie Ihre Antworten nicht mehr ändern.',
    'student.submit_confirm_unanswered': 'Es gibt noch {count} unbeantwortete Aufgabe(n). Trotzdem abgeben?',
    'student.submit_pending_warning': 'Einige Antworten konnten noch nicht gespeichert werden. Trotzdem abgeben?',
    'student.submitting': 'Wird abgegeben …',
    'student.submitted_title': 'Abgegeben!',
    'student.practice_banner': 'Übungsmodus — diese Abgabe wird nicht gewertet. Du kannst beliebig oft neu versuchen.',
    'student.practice_note': 'Übungsmodus: Diese Abgabe zählt nicht für die Wertung.',
    'student.practice_retry': 'Erneut versuchen',
    'student.submitted_text': 'Ihre Antworten wurden gespeichert. Sie können diese Seite jetzt schließen.',
    'student.result_hidden': 'Ihre Lehrkraft hat entschieden, dass das Ergebnis nicht angezeigt wird.',
    'student.result_percent': '{percent} erreicht',
    'student.result_manual_note': 'Einige Aufgaben werden von Ihrer Lehrkraft manuell bewertet.',
    'student.result_review': 'Antworten ansehen',
    'student.result_back': 'Zum Ergebnis',
    'student.switch_person': 'Als andere Person beitreten',
    'student.review_title': 'Ihre Antworten',
    'student.review_note': 'Schreibgeschützte Ansicht nach der Abgabe. Ihre Antworten können nicht mehr geändert werden.',
    'student.breakdown_title': 'Auswertung',
    'student.solution_label': 'Lösung',
    'student.score_label': 'Punkte',
    'student.time_left': 'Zeit: {time}',
    'student.time_up_text': 'Die Bearbeitungszeit ist abgelaufen. Ihre Aufgabe wird abgegeben.',
    'student.auto_submit_pending': 'Die Abgabe wird automatisch erneut versucht …',
    'student.no_items': 'Diese Aufgabe enthält noch keine Inhalte.',
    'student.invalid_link': 'Dieser Aufgaben-Link ist ungültig.',
    'student.invalid_code_title': 'Code ungültig',
    'student.invalid_code_text': 'Zu diesem Link gibt es keine Aufgabe. Bitte prüfen Sie den Code oder den Link.',
    'student.assignment_closed_title': 'Aufgabe geschlossen',
    'student.assignment_closed_text': 'Diese Aufgabe ist derzeit geschlossen. Bitte wenden Sie sich an Ihre Lehrkraft.',
    'student.error_title': 'Etwas ist schiefgelaufen',
    'student.error_text': 'Die Aufgabe konnte nicht geladen werden.',
    'student.go_home': 'Zur Startseite',
    'student.retry': 'Erneut versuchen',
    'student.session_expired': 'Ihre Sitzung ist abgelaufen. Bitte treten Sie erneut bei.',
    'student.loading_assignment': 'Aufgabe wird geladen …',
    'student.answer_given': 'Antwort gespeichert.',
    'student.autosave_error': 'Antwort konnte nicht gespeichert werden.',
  },
  en: {
    'student.skip': 'Skip to content',
    'student.footer': 'OpenWidgets — self-hosted',
    'student.join_eyebrow': 'Assignment',
    'student.class_eyebrow': 'Class',
    'student.class_join_hint': 'Enter your name to join the class.',
    'student.class_join_button': 'Join class',
    'student.class_progress': '{done} of {total} done',
    'student.class_mode_free': 'Free order',
    'student.class_mode_sequence': 'Fixed sequence',
    'student.class_item_locked': 'Locked — finish no. {position} first',
    'student.class_item_open': 'Open',
    'student.class_item_review': 'Review',
    'student.class_item_done': 'Done',
    'student.class_score': '{score} / {maxScore} pts',
    'student.class_back': 'Back to class',
    'student.class_via_link': 'This assignment belongs to a class. Join via the class link:',
    'student.class_open_link': 'Open class',
    'student.class_invalid_code_title': 'Invalid class code',
    'student.class_invalid_code_text': 'There is no class for this link. Please check the code or link.',
    'student.class_empty': 'This class has no assignments yet.',
    'student.name_label': 'Your name',
    'student.name_label_optional': 'Your name (optional)',
    'student.name_placeholder': 'First and last name',
    'student.name_required': 'Please enter your name.',
    'student.name_optional_hint': 'Giving your name is optional.',
    'student.join_hint': 'Enter your name to start the assignment.',
    'student.join_button': 'Start assignment',
    'student.template_worksheet': 'Worksheet',
    'student.template_quiz': 'Quiz',
    'student.code_label': 'Code',
    'student.question_of': 'Question {current} of {total}',
    'student.answered_of': '{answered} of {total} answered',
    'student.answered_short': '{answered}/{total} answered',
    'student.points_badge': '{points} pts',
    'student.item_label': 'Item {number}: {type}',
    'student.star': 'Flag this question',
    'student.star_remove': 'Remove flag',
    'student.read_aloud': 'Read aloud',
    'student.stop_read_aloud': 'Stop reading',
    'student.tts_unsupported': 'Read-aloud is not supported by this browser.',
    'student.tts_choices': 'Answer options:',
    'student.tts_blank': 'Blank {number}',
    'student.tts_match': 'Match the following.',
    'student.tts_options': 'Options:',
    'student.tts_order': 'Items:',
    'student.tts_pins': 'Mark on the image:',
    'student.font_size': 'Font size',
    'student.font_small': 'Small font',
    'student.font_medium': 'Normal font',
    'student.font_large': 'Large font',
    'student.save_pending': 'Saving …',
    'student.save_saved': 'Saved',
    'student.save_offline': 'Saved offline',
    'student.save_error': 'Not saved',
    'student.offline_text': 'You are offline. Answers are stored on this device and sent as soon as the connection is back.',
    'student.offline_pending': 'Offline — {count} answer(s) waiting to be sent.',
    'student.online_again': 'Connection restored — sending answers …',
    'student.submit': 'Submit',
    'student.submit_confirm_title': 'Submit assignment?',
    'student.submit_confirm_text': 'After submitting you cannot change your answers.',
    'student.submit_confirm_unanswered': 'There are still {count} unanswered item(s). Submit anyway?',
    'student.submit_pending_warning': 'Some answers could not be saved yet. Submit anyway?',
    'student.submitting': 'Submitting …',
    'student.submitted_title': 'Submitted!',
    'student.practice_banner': 'Practice mode — this attempt is not graded. You can retry as often as you like.',
    'student.practice_note': 'Practice mode: this attempt does not count towards grading.',
    'student.practice_retry': 'Try again',
    'student.submitted_text': 'Your answers have been saved. You may close this page.',
    'student.result_hidden': 'Your teacher decided not to show the result.',
    'student.result_percent': '{percent} achieved',
    'student.result_manual_note': 'Some items will be graded manually by your teacher.',
    'student.result_review': 'View answers',
    'student.result_back': 'Back to result',
    'student.switch_person': 'Join as someone else',
    'student.review_title': 'Your answers',
    'student.review_note': 'Read-only view after submission. Your answers can no longer be changed.',
    'student.breakdown_title': 'Breakdown',
    'student.solution_label': 'Answer',
    'student.score_label': 'Points',
    'student.time_left': 'Time: {time}',
    'student.time_up_text': 'Time is up. Your assignment is being submitted.',
    'student.auto_submit_pending': 'Submission is being retried automatically …',
    'student.no_items': 'This assignment does not contain any content yet.',
    'student.invalid_link': 'This assignment link is invalid.',
    'student.invalid_code_title': 'Invalid code',
    'student.invalid_code_text': 'There is no assignment for this link. Please check the code or the link.',
    'student.assignment_closed_title': 'Assignment closed',
    'student.assignment_closed_text': 'This assignment is currently closed. Please contact your teacher.',
    'student.error_title': 'Something went wrong',
    'student.error_text': 'The assignment could not be loaded.',
    'student.go_home': 'Go to home page',
    'student.retry': 'Try again',
    'student.session_expired': 'Your session has expired. Please join again.',
    'student.loading_assignment': 'Loading assignment …',
    'student.answer_given': 'Answer saved.',
    'student.autosave_error': 'The answer could not be saved.',
  },
});

// ---------------------------------------------------------------------------
// Constants and module state
// ---------------------------------------------------------------------------

const SAVE_DEBOUNCE_MS = 800;
const HEARTBEAT_INTERVAL_MS = 25000;
const RETRY_INTERVAL_MS = 10000;
const QUEUE_PREFIX = 'ow_queue_';
const FONT_KEY = 'ow_font_scale';
const VALID_CODE_RE = /^[A-Z0-9]{4,12}$/;

function readPath() {
  const match = window.location.pathname.match(/^\/([ac])\/([^/]+)\/?$/i);
  if (!match) return { mode: '', code: '' };
  let code = '';
  try {
    code = decodeURIComponent(match[2]).trim().toUpperCase().replace(/\s+/g, '');
  } catch {
    code = '';
  }
  return { mode: String(match[1]).toLowerCase(), code };
}

const PATH = readPath();
// 'a' = single assignment (/a/CODE), 'c' = class bundle (/c/CODE)
const MODE = PATH.mode;
const CODE = PATH.code;
// When an assignment is opened from a class lobby, the class code rides along.
function readClassParam() {
  const raw = new URLSearchParams(window.location.search).get('c') || '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
const CLASS_PARAM = MODE === 'a' ? readClassParam() : '';

const app = qs('#app');
const activityTitleEl = qs('#activity-title');
const countdownEl = qs('#countdown');
const saveStatusEl = qs('#save-status');
const a11yBar = qs('#a11y-bar');
const offlineBanner = qs('#offline-banner');
const announcer = qs('#announcer');

const state = {
  screen: 'loading',
  code: CODE,
  mode: MODE,
  token: MODE === 'c' ? null : getParticipantToken(CODE),
  classToken: MODE === 'c' ? getClassToken(CODE) : null,
  joinInfo: null,
  classJoinInfo: null,
  classPayload: null,
  classInfo: null,
  participant: null,
  assignment: null,
  activity: null,
  settings: {},
  items: [],
  template: 'worksheet',
  answers: {},
  results: {},
  flags: [],
  currentIndex: 0,
  submitted: false,
  showResults: true,
  showAnswers: false,
  result: null,
  error: null,
  retry: null,
  pendingName: '',
  fontLevel: 2,
  offline: false,
  assignmentClosed: false,
  resumed: false,
  ttsItemId: null,
};

/** itemId → { item, section, content, renderer, starBtn, ttsBtn, mode, index } */
const views = new Map();
const dirty = new Set();
const inFlight = new Set();
const saveTimers = new Map();
const lastSaved = new Map();
/**
 * itemId → canonical response that failed to save and must be retried.
 * Scoped per assignment code AND per participant token (see queueStorageKey):
 * on a shared device one student's queued answers must never leak into the
 * next student's attempt. Purged after a successful submit.
 */
let pendingQueue = {};

let deadline = null;
let countdownTimer = null;
let heartbeatTimer = null;
let retryTimer = null;
let submitting = false;
let autoSubmitPending = false;
let sessionActive = false;
let ttsUtterance = null;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function safeStringify(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? '' : json;
  } catch {
    return '';
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function normalizeAnswerLines(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => String(entry === null || entry === undefined ? '' : entry).trim())
    .filter(Boolean);
}

function plainText(value) {
  return String(value || '')
    .replace(/[*_]{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    correct: result.correct === true,
    autoScore: Number(result.autoScore) || 0,
    maxScore: Number(result.maxScore) || 0,
    needsManual: result.needsManual === true,
    // student-safe per-type detail (hangman reveal, crossword cells, …) — the
    // server only sends this when the item type marks it safe via safeDetail
    detail: result.detail && typeof result.detail === 'object' && !Array.isArray(result.detail) ? result.detail : undefined,
  };
}

function resultStateOf(result) {
  if (!result) return null;
  if (result.needsManual) return 'manual';
  if (result.correct) return 'correct';
  if (Number(result.autoScore) > 0) return 'partial';
  return 'incorrect';
}

function setAnnouncement(text) {
  if (!announcer) return;
  announcer.textContent = '';
  window.setTimeout(() => {
    announcer.textContent = String(text || '');
  }, 30);
}

function scrollToTop() {
  try {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch {
    window.scrollTo(0, 0);
  }
}

function itemTypeLabel(item) {
  const renderer = getRenderer(item && item.type);
  if (renderer && renderer.label) {
    const locale = getLocale();
    return renderer.label[locale] || renderer.label.de || renderer.label.en || String(item.type);
  }
  return String((item && item.type) || '');
}

/** A text block becomes scoreable when it contains <<gap>> markers. */
function textHasGaps(item) {
  return Boolean(item) && item.type === 'text' && String((item.config && item.config.text) || '').includes('<<');
}

function isScoreable(item) {
  return Boolean(item) && (item.type !== 'text' || textHasGaps(item)) && Number(item.points) > 0;
}

function scoreableItems() {
  return state.items.filter((item) => item.type !== 'text' || textHasGaps(item));
}

function seedFor(item) {
  const participantId = (state.participant && state.participant.id) || 'participant';
  return `${state.code}:${participantId}:${item.id}`;
}

// ---------------------------------------------------------------------------
// Persistent offline queue (localStorage, scoped per assignment AND participant)
// ---------------------------------------------------------------------------

/**
 * localStorage key for the retry queue. The participant token is hashed into
 * the key so that two students sharing a device/assignment code can never
 * flush each other's queued answers. The legacy unscoped `ow_queue_<CODE>` key
 * is removed on load.
 */
function queueStorageKey(token) {
  if (!token) return null;
  return `${QUEUE_PREFIX}${CODE}_${hashString(String(token)).toString(36)}`;
}

function loadPendingQueue(token) {
  pendingQueue = {};
  try {
    // Legacy key (pre-token-scoping) may contain another participant's answers.
    localStorage.removeItem(QUEUE_PREFIX + CODE);
  } catch {
    /* ignore */
  }
  const key = queueStorageKey(token);
  if (!key) return;
  try {
    const parsed = parseJson(localStorage.getItem(key));
    pendingQueue = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    pendingQueue = {};
  }
}

function persistQueue() {
  const key = queueStorageKey(state.token);
  if (!key) return;
  try {
    if (Object.keys(pendingQueue).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pendingQueue));
  } catch {
    /* private mode / quota — keep the in-memory queue */
  }
}

/**
 * Forget every retry-queue entry for this assignment (all participant tokens +
 * the legacy unscoped key). Used when switching to a different person on a
 * shared device or when a stored token turned out to be stale.
 */
function removeQueueStorageKeys() {
  pendingQueue = {};
  try {
    const scopedPrefix = `${QUEUE_PREFIX}${CODE}_`;
    const doomed = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && (key === QUEUE_PREFIX + CODE || key.startsWith(scopedPrefix))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable — in-memory queue is already cleared */
  }
}

function queuedCount() {
  return Object.keys(pendingQueue).length;
}

function pendingCount() {
  return dirty.size + inFlight.size + queuedCount();
}

// ---------------------------------------------------------------------------
// Chrome (header, title, a11y bar, save status, offline banner)
// ---------------------------------------------------------------------------

function setActivityTitle(title) {
  const text = String(title || '').trim();
  if (activityTitleEl) {
    activityTitleEl.textContent = text;
    activityTitleEl.hidden = !text;
  }
  document.title = text ? `${text} — OpenWidgets` : 'OpenWidgets';
}

function currentActivityTitle() {
  if (MODE === 'c') {
    return (state.classPayload && state.classPayload.name) || (state.classJoinInfo && state.classJoinInfo.name) || '';
  }
  return (
    (state.assignment && state.assignment.title) ||
    (state.activity && state.activity.title) ||
    (state.joinInfo && state.joinInfo.assignment && state.joinInfo.assignment.title) ||
    ''
  );
}

// Language toggle is created exactly once (its listeners accumulate otherwise).
const langSlot = h('span.student-a11y-lang');
mountLanguageToggle(langSlot);

function applyFontLevel(level) {
  const safe = level === 1 || level === 3 ? level : 2;
  state.fontLevel = safe;
  const scale = safe === 1 ? 0.9 : safe === 3 ? 1.15 : 1;
  try {
    document.documentElement.style.setProperty('--student-font-scale', String(scale));
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(FONT_KEY, String(safe));
  } catch {
    /* ignore */
  }
}

function setupFontScale() {
  let stored = null;
  try {
    stored = localStorage.getItem(FONT_KEY);
  } catch {
    /* ignore */
  }
  const level = stored === '1' || stored === '3' ? Number(stored) : 2;
  applyFontLevel(level);
}

function buildA11yBar() {
  if (!a11yBar) return;
  clear(a11yBar);
  const settings = state.settings || {};
  const accessibility = settings.accessibility || {};
  if (accessibility.fontScale !== false) {
    const group = h('span.student-a11y-group', {
      role: 'group',
      'aria-label': t('student.font_size'),
    });
    const levels = [
      { level: 1, label: t('student.font_small'), short: 'A−' },
      { level: 2, label: t('student.font_medium'), short: 'A' },
      { level: 3, label: t('student.font_large'), short: 'A+' },
    ];
    for (const entry of levels) {
      const active = state.fontLevel === entry.level;
      const button = h('button.student-font-btn', {
        type: 'button',
        'aria-pressed': String(active),
        'aria-label': entry.label,
        title: entry.label,
        text: entry.short,
      });
      button.classList.toggle('is-active', active);
      button.addEventListener('click', () => {
        applyFontLevel(entry.level);
        buildA11yBar();
      });
      group.appendChild(button);
    }
    a11yBar.appendChild(group);
  }
  a11yBar.appendChild(langSlot);
}

function updateSaveStatus() {
  if (!saveStatusEl) return;
  const visible = state.screen === 'player' && !state.submitted;
  saveStatusEl.hidden = !visible;
  if (!visible) return;
  const pending = pendingCount();
  let stateName = 'saved';
  let text = t('student.save_saved');
  let iconName = 'check';
  if (pending > 0) {
    if (!isOnline() || queuedCount() > 0) {
      stateName = 'offline';
      text = t('student.save_offline');
      iconName = 'warning';
    } else {
      stateName = 'saving';
      text = t('student.save_pending');
      iconName = 'refresh';
    }
  }
  saveStatusEl.dataset.state = stateName;
  clear(saveStatusEl);
  saveStatusEl.appendChild(h('span', { html: icon(iconName, { size: 14 }) }));
  saveStatusEl.appendChild(h('span', { text }));
}

function updateOfflineUI() {
  if (!offlineBanner) return;
  const online = isOnline();
  const queued = queuedCount();
  state.offline = !online;
  if (!online) {
    offlineBanner.hidden = false;
    offlineBanner.classList.remove('is-online');
    offlineBanner.textContent = t('student.offline_text');
  } else if (queued > 0) {
    offlineBanner.hidden = false;
    offlineBanner.classList.remove('is-online');
    offlineBanner.textContent = t('student.offline_pending', { count: formatNumber(queued) });
  } else {
    offlineBanner.hidden = true;
    offlineBanner.textContent = '';
    offlineBanner.classList.remove('is-online');
  }
  updateSaveStatus();
}

function renderChrome() {
  setActivityTitle(currentActivityTitle());
  buildA11yBar();
  if (state.screen === 'player' && deadline) countdownEl.hidden = false;
  else countdownEl.hidden = true;
  if (MODE === 'c') saveStatusEl.hidden = true;
  else updateSaveStatus();
  updateOfflineUI();
}

// ---------------------------------------------------------------------------
// Saving responses (debounced PUT + retry queue)
// ---------------------------------------------------------------------------

function scheduleSave(itemId, delay = SAVE_DEBOUNCE_MS) {
  const existing = saveTimers.get(itemId);
  if (existing) clearTimeout(existing);
  const timer = window.setTimeout(() => {
    saveTimers.delete(itemId);
    saveItem(itemId);
  }, delay);
  saveTimers.set(itemId, timer);
  updateSaveStatus();
}

function captureAnswer(itemId) {
  const view = views.get(itemId);
  if (!view || !view.renderer) return;
  // Text blocks are not scoreable and must never be PUT to the responses API.
  if (!view.item || (view.item.type === 'text' && !textHasGaps(view.item))) return;
  let response;
  try {
    response = view.renderer.getResponse();
  } catch {
    return;
  }
  if (response === undefined || response === null) return;
  const previous = safeStringify(state.answers[itemId]);
  const next = safeStringify(response);
  if (previous === next) return;
  state.answers[itemId] = response;
  dirty.add(itemId);
  updatePlayerProgress();
  updateSaveStatus();
  scheduleSave(itemId);
}

function captureLiveAnswers() {
  for (const itemId of views.keys()) captureAnswer(itemId);
}

function onRendererChanged(itemId) {
  captureAnswer(itemId);
}

function applyItemResult(itemId, result) {
  const normalized = normalizeResult(result);
  if (!normalized) return;
  state.results[itemId] = { ...(state.results[itemId] || {}), ...normalized };
  if (state.settings.instantFeedback === false) return;
  const view = views.get(itemId);
  if (!view || view.mode !== 'student') return;
  try {
    view.renderer.setResult(normalized);
  } catch {
    /* renderer should not throw, ignore defensively */
  }
  const stateName = resultStateOf(normalized);
  if (stateName === 'correct') setAnnouncement(t('common.correct'));
  else if (stateName === 'incorrect') setAnnouncement(t('common.incorrect'));
  else if (stateName === 'partial') setAnnouncement(t('common.partial'));
  else setAnnouncement(t('common.manual'));
}

async function saveItem(itemId) {
  if (!state.token || state.submitted || !isSessionActive()) return;
  if (inFlight.has(itemId)) return;
  if (state.answers[itemId] === undefined && pendingQueue[itemId] !== undefined) {
    state.answers[itemId] = pendingQueue[itemId];
  }
  const response = state.answers[itemId];
  if (response === undefined) return;
  const json = safeStringify(response);
  if (lastSaved.get(itemId) === json) {
    dirty.delete(itemId);
    delete pendingQueue[itemId];
    persistQueue();
    updateSaveStatus();
    return;
  }
  dirty.delete(itemId);
  inFlight.add(itemId);
  updateSaveStatus();
  try {
    const data = await put(
      `/api/participant/responses/${encodeURIComponent(itemId)}`,
      { response },
      { headers: participantHeaders(state.token) },
    );
    lastSaved.set(itemId, json);
    delete pendingQueue[itemId];
    persistQueue();
    if (data && data.result) applyItemResult(itemId, data.result);
    if (safeStringify(state.answers[itemId]) !== json) dirty.add(itemId);
    if (data && Number.isFinite(Number(data.score))) {
      state.participant = { ...(state.participant || {}), score: Number(data.score) };
    }
  } catch (error) {
    if (handleSessionError(error)) return;
    if (error && error.code === 'invalid_response') {
      toast(errorMessage(error), 'error');
    } else {
      pendingQueue[itemId] = state.answers[itemId];
      persistQueue();
      updateOfflineUI();
    }
  } finally {
    inFlight.delete(itemId);
    updateSaveStatus();
    if (dirty.has(itemId) && !saveTimers.has(itemId)) scheduleSave(itemId, 300);
    updateOfflineUI();
  }
}

function isSessionActive() {
  return sessionActive && !state.submitted;
}

function persistDirtyToQueue() {
  let changed = false;
  for (const itemId of dirty) {
    if (state.answers[itemId] !== undefined) {
      pendingQueue[itemId] = state.answers[itemId];
      changed = true;
    }
  }
  for (const [itemId] of saveTimers) {
    if (state.answers[itemId] !== undefined) {
      pendingQueue[itemId] = state.answers[itemId];
      changed = true;
    }
  }
  if (changed) persistQueue();
}

async function flushAllPending() {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  const ids = new Set([...dirty, ...Object.keys(pendingQueue)]);
  if (!ids.size) {
    updateSaveStatus();
    return;
  }
  await Promise.all(
    Array.from(ids, (itemId) =>
      saveItem(itemId).catch(() => {
        /* handled inside saveItem */
      }),
    ),
  );
  updateSaveStatus();
}

function flushInBackground() {
  const ids = new Set([...dirty, ...Object.keys(pendingQueue)]);
  for (const itemId of ids) {
    saveItem(itemId).catch(() => {
      /* handled inside saveItem */
    });
  }
}

// ---------------------------------------------------------------------------
// Session error handling (409 time_expired / attempt_submitted, token loss)
// ---------------------------------------------------------------------------

function handleSessionError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.code === 'time_expired') {
    handleTimeExpired();
    return true;
  }
  if (error.code === 'attempt_submitted') {
    handleAlreadySubmitted();
    return true;
  }
  if (error.code === 'invalid_participant_token') {
    onSessionExpired();
    return true;
  }
  if (error.code === 'assignment_closed') {
    // The teacher closed the assignment while the student was working. Stop
    // retrying (answers cannot be saved any more) but keep the page usable.
    if (!state.assignmentClosed) {
      state.assignmentClosed = true;
      toast(errorMessage(error), 'warning');
      updateOfflineUI();
    }
    return true;
  }
  return false;
}

function handleTimeExpired() {
  if (state.submitted) return;
  stopSession();
  state.submitted = true;
  toast(errorMessage({ code: 'time_expired' }), 'warning');
  loadResultView({ fallbackTitle: t('student.time_up_text') });
}

function handleAlreadySubmitted() {
  if (state.submitted) return;
  stopSession();
  state.submitted = true;
  loadResultView({ fallbackTitle: t('student.submitted_title') });
}

function onSessionExpired() {
  stopSession();
  clearParticipantToken(CODE);
  state.token = null;
  removeQueueStorageKeys();
  state.submitted = false;
  state.joinInfo = null;
  state.resumed = false;
  toast(t('student.session_expired'), 'warning');
  // A stale/invalid participant token is not a dead end: clean up and show the
  // join form so the next person on the device can start fresh.
  state.screen = 'loading';
  startJoinFlow();
}

async function loadResultView({ fallbackTitle } = {}) {
  try {
    const data = await get('/api/participant/result', {
      headers: participantHeaders(state.token),
    });
    applySubmitPayload(data);
    state.screen = 'result';
    renderScreen();
    scrollToTop();
  } catch (error) {
    if (error && error.code === 'not_submitted') {
      state.screen = 'result';
      state.showResults = false;
      state.showAnswers = false;
      state.result = { showResults: false, showAnswers: false, items: [] };
      renderScreen();
      return;
    }
    showFatalError({
      title: fallbackTitle || t('student.submitted_title'),
      message: errorMessage(error),
      retry: () => loadResultView({ fallbackTitle }),
    });
  }
}

// ---------------------------------------------------------------------------
// Payload application
// ---------------------------------------------------------------------------

function resetResponseMaps() {
  state.answers = {};
  state.results = {};
  lastSaved.clear();
  dirty.clear();
  inFlight.clear();
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
}

function mergePendingQueue() {
  const knownItems = new Set(state.items.map((item) => item.id));
  const queue = pendingQueue && typeof pendingQueue === 'object' ? pendingQueue : {};
  for (const [itemId, response] of Object.entries(queue)) {
    if (!knownItems.has(itemId)) {
      delete pendingQueue[itemId];
      continue;
    }
    state.answers[itemId] = response;
    dirty.add(itemId);
  }
  persistQueue();
}

/**
 * Apply the payload shared by POST /api/join and GET /api/participant.
 * Returns true when the participant is already submitted/graded.
 */
function applyPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  state.participant = payload.participant || null;
  state.assignment = payload.assignment || null;
  state.activity = payload.activity || null;
  state.settings = (state.assignment && state.assignment.settings) || (state.activity && state.activity.settings) || {};
  state.items = Array.isArray(state.activity && state.activity.items) ? state.activity.items : [];
  const template =
    (state.assignment && state.assignment.template) || (state.activity && state.activity.template) || 'worksheet';
  state.template = template === 'quiz' ? 'quiz' : 'worksheet';
  state.flags = Array.isArray(payload.flags) ? payload.flags.slice() : [];
  state.showResults = state.settings.showResults !== false;
  state.showAnswers = false;
  state.result = null;
  state.error = null;
  state.assignmentClosed = false;
  state.classInfo = (payload.class && typeof payload.class === 'object' ? payload.class : null) || state.classInfo || null;

  resetResponseMaps();
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  for (const entry of responses) {
    if (!entry || !entry.itemId) continue;
    state.answers[entry.itemId] = entry.response === undefined ? null : entry.response;
    if (entry.result) {
      const normalized = normalizeResult(entry.result);
      if (normalized) state.results[entry.itemId] = normalized;
    }
    lastSaved.set(entry.itemId, safeStringify(entry.response));
  }
  mergePendingQueue();
  applyAssignmentLocale();
  const status = state.participant && state.participant.status;
  return status === 'submitted' || status === 'graded';
}

function applySubmitPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  if (payload.participant) {
    state.participant = { ...(state.participant || {}), ...payload.participant };
  }
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  state.result = result;
  state.showResults =
    result.showResults !== undefined ? result.showResults === true : state.settings.showResults !== false;
  state.showAnswers = result.showAnswers === true;
  const entries = Array.isArray(result.items) ? result.items : [];
  for (const entry of entries) {
    if (!entry || (!entry.itemId && !entry.id)) continue;
    const itemId = entry.itemId || entry.id;
    const normalized = normalizeResult(entry);
    if (normalized) state.results[itemId] = normalized;
    // Server may send `answerText: string[]` or a canonical `answer` object.
    // Only strings / string arrays are human-readable solution lines — never
    // stringify the canonical answer object.
    const rawAnswerText =
      entry.answerText !== undefined
        ? entry.answerText
        : typeof entry.answer === 'string' || Array.isArray(entry.answer)
          ? entry.answer
          : null;
    const answerLines = normalizeAnswerLines(rawAnswerText);
    if (answerLines.length) {
      state.results[itemId] = { ...(state.results[itemId] || {}), answerText: answerLines };
    }
    // Pins solution zones (server: `answerZones`, shape {id,label,x,y,r}).
    const zones = Array.isArray(entry.answerZones)
      ? entry.answerZones
      : Array.isArray(entry.reviewZones)
        ? entry.reviewZones
        : Array.isArray(entry.zones)
          ? entry.zones
          : null;
    if (zones && zones.length) {
      state.results[itemId] = { ...(state.results[itemId] || {}), zones };
    }
    if (entry.response !== undefined) state.answers[itemId] = entry.response;
  }
}

function applyAssignmentLocale() {
  const locale = (state.assignment && state.assignment.locale) || (state.activity && state.activity.locale);
  if (locale === 'en' || locale === 'de') {
    let saved = null;
    try {
      saved = localStorage.getItem('ow_locale');
    } catch {
      /* ignore */
    }
    if (saved !== 'de' && saved !== 'en' && getLocale() !== locale) {
      setLocale(locale, { persist: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function setupSession() {
  sessionActive = true;
  autoSubmitPending = false;
  setupDeadline();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = window.setInterval(retryLoop, RETRY_INTERVAL_MS);
  sendHeartbeat();
  updateOfflineUI();
  if (pendingCount() > 0) flushInBackground();
}

function stopSession() {
  sessionActive = false;
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  deadline = null;
  stopReadAloud();
}

function setupDeadline() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  deadline = null;
  const minutes = Number(state.settings && state.settings.timeLimitMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    countdownEl.hidden = true;
    return;
  }
  const startedAt = Date.parse((state.participant && state.participant.startedAt) || '');
  const start = Number.isFinite(startedAt) ? startedAt : Date.now();
  deadline = start + minutes * 60 * 1000;
  countdownEl.hidden = false;
  tickCountdown();
  countdownTimer = window.setInterval(tickCountdown, 1000);
}

function tickCountdown() {
  if (!deadline) return;
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const label = t('student.time_left', { time: fmtDuration(remaining) });
  countdownEl.textContent = label;
  countdownEl.setAttribute('aria-label', label);
  countdownEl.classList.toggle('is-urgent', remaining <= 300);
  if (remaining <= 0) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    if (!state.submitted && !autoSubmitPending) {
      autoSubmitPending = true;
      setAnnouncement(t('student.time_up_text'));
      toast(t('student.time_up_text'), 'warning');
      submitAssignment({ auto: true });
    }
  }
}

function retryLoop() {
  if (state.submitted) return;
  if (autoSubmitPending) {
    if (!submitting) submitAssignment({ auto: true });
    return;
  }
  if (isOnline() && pendingCount() > 0) flushAllPending();
  else updateSaveStatus();
}

async function sendHeartbeat() {
  if (!state.token || state.submitted || !isSessionActive()) return;
  try {
    await post('/api/participant/heartbeat', undefined, {
      headers: participantHeaders(state.token),
    });
  } catch (error) {
    if (error && error.code === 'invalid_participant_token') onSessionExpired();
  }
}

// ---------------------------------------------------------------------------
// Flags (star questions)
// ---------------------------------------------------------------------------

async function toggleFlag(itemId) {
  if (!state.token || state.submitted) return;
  const previous = state.flags.slice();
  const index = state.flags.indexOf(itemId);
  if (index >= 0) state.flags.splice(index, 1);
  else state.flags.push(itemId);
  syncFlagButtons();
  try {
    const data = await post(
      '/api/participant/flags',
      { flags: state.flags },
      { headers: participantHeaders(state.token) },
    );
    if (data && Array.isArray(data.flags)) state.flags = data.flags.slice();
    syncFlagButtons();
  } catch (error) {
    state.flags = previous;
    syncFlagButtons();
    if (!handleSessionError(error)) toast(errorMessage(error), 'error');
  }
}

function syncFlagButtons() {
  for (const view of views.values()) {
    if (!view.starBtn) continue;
    const starred = state.flags.indexOf(view.item.id) >= 0;
    view.starBtn.classList.toggle('is-active', starred);
    view.starBtn.setAttribute('aria-pressed', String(starred));
    view.starBtn.setAttribute('aria-label', starred ? t('student.star_remove') : t('student.star'));
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

function speechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

function ttsLanguage() {
  const locale = (state.activity && state.activity.locale) || (state.assignment && state.assignment.locale) || getLocale();
  return locale === 'en' ? 'en-US' : 'de-DE';
}

function speechTextFor(item) {
  if (!item) return '';
  const parts = [];
  const stem = plainText(item.stem);
  if (stem) parts.push(stem);
  const help = plainText(item.help);
  if (help) parts.push(help);
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  switch (item.type) {
    case 'text': {
      const text = plainText(config.text);
      if (text) parts.push(text);
      break;
    }
    case 'multiple_choice': {
      const choices = Array.isArray(config.choices) ? config.choices : [];
      if (choices.length) {
        parts.push(t('student.tts_choices'));
        choices.forEach((choice, index) => {
          parts.push(`${index + 1}. ${plainText(choice && choice.text)}`);
        });
      }
      break;
    }
    case 'fill_blanks': {
      const text = String(config.text || '').replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (match, id) =>
        t('student.tts_blank', { number: id }),
      );
      const cleaned = plainText(text);
      if (cleaned) parts.push(cleaned);
      break;
    }
    case 'match': {
      const lefts = Array.isArray(config.lefts)
        ? config.lefts
        : Array.isArray(config.pairs)
          ? config.pairs.map((pair) => ({ id: pair.id, text: pair.left }))
          : [];
      const rights = Array.isArray(config.rights)
        ? config.rights
        : Array.isArray(config.pairs)
          ? config.pairs.map((pair) => ({ id: pair.id, text: pair.right }))
          : [];
      parts.push(t('student.tts_match'));
      lefts.forEach((left, index) => parts.push(`${index + 1}. ${plainText(left && left.text)}`));
      if (rights.length) {
        parts.push(t('student.tts_options'));
        parts.push(rights.map((right) => plainText(right && right.text)).filter(Boolean).join(', '));
      }
      break;
    }
    case 'ordering': {
      const items = Array.isArray(config.items) ? config.items : [];
      if (items.length) {
        parts.push(t('student.tts_order'));
        items.forEach((entry, index) => parts.push(`${index + 1}. ${plainText(entry && entry.text)}`));
      }
      break;
    }
    case 'pins': {
      const zones = Array.isArray(config.zones) ? config.zones : [];
      if (zones.length) {
        parts.push(t('student.tts_pins'));
        parts.push(zones.map((zone) => plainText(zone && zone.label)).filter(Boolean).join(', '));
      }
      break;
    }
    default:
      break;
  }
  return parts.filter(Boolean).join('. ');
}

function syncTtsButtons() {
  for (const view of views.values()) {
    if (!view.ttsBtn) continue;
    const speaking = state.ttsItemId === view.item.id;
    view.ttsBtn.classList.toggle('is-speaking', speaking);
    view.ttsBtn.setAttribute('aria-pressed', String(speaking));
    view.ttsBtn.setAttribute('aria-label', speaking ? t('student.stop_read_aloud') : t('student.read_aloud'));
  }
}

function stopReadAloud() {
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  ttsUtterance = null;
  state.ttsItemId = null;
  syncTtsButtons();
}

function toggleReadAloud(item) {
  if (!speechSupported()) {
    toast(t('student.tts_unsupported'), 'warning');
    return;
  }
  if (state.ttsItemId === item.id) {
    stopReadAloud();
    return;
  }
  stopReadAloud();
  const text = speechTextFor(item);
  if (!text) return;
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = ttsLanguage();
  utterance.rate = 0.95;
  utterance.onend = () => {
    if (ttsUtterance === utterance) {
      ttsUtterance = null;
      state.ttsItemId = null;
      syncTtsButtons();
    }
  };
  utterance.onerror = utterance.onend;
  ttsUtterance = utterance;
  state.ttsItemId = item.id;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    ttsUtterance = null;
    state.ttsItemId = null;
  }
  syncTtsButtons();
}

// ---------------------------------------------------------------------------
// Progress / answered helpers
// ---------------------------------------------------------------------------

function isAnswered(item) {
  const response = state.answers[item.id];
  if (!response || typeof response !== 'object') return false;
  switch (item.type) {
    case 'text':
      return true;
    case 'multiple_choice':
      return Array.isArray(response.selected) && response.selected.length > 0;
    case 'short_answer':
    case 'long_answer':
      return typeof response.text === 'string' && response.text.trim() !== '';
    case 'numeric':
      return typeof response.value === 'string' && response.value.trim() !== '';
    case 'fill_blanks':
      return Object.values(response.blanks || {}).some((value) => String(value === undefined || value === null ? '' : value).trim() !== '');
    case 'match':
      return Object.keys(response.matches || {}).length > 0;
    case 'ordering':
      return Array.isArray(response.order) && response.order.length > 0;
    case 'pins':
      return Object.keys(response.points || {}).length > 0;
    default:
      return false;
  }
}

function answeredStats() {
  const items = scoreableItems();
  const answered = items.filter((item) => isAnswered(item)).length;
  return { answered, total: items.length };
}

function unansweredCount() {
  const stats = answeredStats();
  return Math.max(0, stats.total - stats.answered);
}

function updatePlayerProgress() {
  const stats = answeredStats();
  const label = t('student.answered_of', {
    answered: formatNumber(stats.answered),
    total: formatNumber(stats.total),
  });
  for (const el of app.querySelectorAll('[data-answered-count]')) el.textContent = label;
  const submitInfo = qs('[data-submit-info]', app);
  if (submitInfo) {
    clear(submitInfo);
    submitInfo.appendChild(h('span', { text: label }));
  }
  const quizAnswered = qs('[data-quiz-answered]', app);
  if (quizAnswered) quizAnswered.textContent = label;
}

// ---------------------------------------------------------------------------
// Item cards / renderer mounting
// ---------------------------------------------------------------------------

function createItemCard(item, index, options = {}) {
  const mode = options.mode || 'student';
  const disabled = options.disabled === true || mode === 'review';
  const section = h('section.card.student-item', {
    id: `item-${item.id}`,
    tabindex: -1,
    dataset: { itemId: item.id },
    'aria-label': t('student.item_label', {
      number: formatNumber(index + 1),
      type: itemTypeLabel(item),
    }),
  });

  const head = h('div.student-item-head');
  head.appendChild(h('span.student-item-number', { 'aria-hidden': 'true', text: String(index + 1) }));
  head.appendChild(h('span.badge.student-item-type', { text: itemTypeLabel(item) }));
  if (isScoreable(item)) {
    head.appendChild(
      h('span.badge.badge-info.student-item-points', {
        text: t('student.points_badge', { points: formatNumber(item.points) }),
      }),
    );
  }

  const tools = h('div.student-item-tools');
  let starBtn = null;
  let ttsBtn = null;

  const accessibility = (state.settings && state.settings.accessibility) || {};
  if (mode === 'student' && !state.submitted && accessibility.starQuestions !== false) {
    starBtn = h('button.student-icon-btn.student-star-btn', {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': t('student.star'),
      title: t('student.star'),
    });
    starBtn.innerHTML = icon('star', { size: 18 });
    starBtn.addEventListener('click', () => toggleFlag(item.id));
    tools.appendChild(starBtn);
  }
  if (accessibility.tts !== false && speechSupported()) {
    ttsBtn = h('button.student-icon-btn.student-tts-btn', {
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': t('student.read_aloud'),
      title: t('student.read_aloud'),
    });
    ttsBtn.innerHTML = icon('volume', { size: 18 });
    ttsBtn.addEventListener('click', () => toggleReadAloud(item));
    tools.appendChild(ttsBtn);
  }
  if (tools.childNodes.length) head.appendChild(tools);
  section.appendChild(head);

  const content = h('div.student-item-content');
  section.appendChild(content);

  const storedResult = state.results[item.id] || null;
  let ctxResult = null;
  if (mode === 'review') ctxResult = state.showResults ? storedResult : null;
  else if (mode === 'student' && state.settings.instantFeedback !== false) ctxResult = storedResult;

  const renderer = mountItem(content, {
    item,
    response: state.answers[item.id] === undefined ? null : state.answers[item.id],
    mode,
    locale: getLocale(),
    seed: seedFor(item),
    disabled,
    showAnswers: mode === 'review' ? state.showAnswers === true : false,
    answerText: mode === 'review' && state.showAnswers ? (storedResult && storedResult.answerText) || null : null,
    reviewZones: mode === 'review' && state.showAnswers ? (storedResult && storedResult.zones) || null : null,
    result: ctxResult,
    // audio_answer renderer uploads recordings through this callback
    uploadAudio: state.token
      ? (blob, mime) => uploadParticipantAsset(blob, state.token, `aufnahme.${String(mime || 'audio/webm').split('/')[1]?.split(';')[0] || 'webm'}`)
      : undefined,
  });

  const view = {
    item,
    section,
    content,
    renderer,
    starBtn,
    ttsBtn,
    mode,
    index,
  };
  views.set(item.id, view);

  if (mode === 'student') {
    const handler = () => onRendererChanged(item.id);
    for (const eventName of ['input', 'change', 'click', 'keyup', 'pointerup']) {
      content.addEventListener(eventName, handler, true);
    }
    // Save immediately when focus leaves the item (autosave is debounced otherwise).
    content.addEventListener(
      'focusout',
      () => {
        captureAnswer(item.id);
        if (!dirty.has(item.id)) return;
        const timer = saveTimers.get(item.id);
        if (timer) {
          clearTimeout(timer);
          saveTimers.delete(item.id);
        }
        saveItem(item.id);
      },
      true,
    );
  }

  return section;
}

function destroyViews() {
  for (const view of views.values()) {
    try {
      if (view.renderer && typeof view.renderer.destroy === 'function') view.renderer.destroy();
    } catch {
      /* ignore renderer cleanup errors */
    }
  }
  views.clear();
}

// ---------------------------------------------------------------------------
// Screen rendering
// ---------------------------------------------------------------------------

function renderScreen() {
  captureLiveAnswers();
  destroyViews();
  if (!app) return;
  clear(app);
  switch (state.screen) {
    case 'loading':
      app.appendChild(
        h(
          'div.loading-block',
          h('span.spinner', { 'aria-hidden': 'true' }),
          h('span', { text: t('student.loading_assignment') }),
        ),
      );
      break;
    case 'join':
      app.appendChild(buildJoinScreen());
      break;
    case 'class-join':
      app.appendChild(buildClassJoinScreen());
      break;
    case 'class-lobby':
      app.appendChild(buildClassLobby());
      break;
    case 'player':
      app.appendChild(buildPlayerScreen());
      break;
    case 'result':
      app.appendChild(buildResultScreen());
      break;
    case 'review':
      app.appendChild(buildReviewScreen());
      break;
    case 'error':
    default:
      app.appendChild(buildErrorScreen());
      break;
  }
  renderChrome();
}

function buildJoinScreen() {
  const info = state.joinInfo || {};
  const assignment = info.assignment || {};
  const activity = info.activity || {};
  const requireName = assignment.requireName !== false;
  const card = h('div.card.student-join');

  card.appendChild(h('p.student-join-eyebrow', { text: t('student.join_eyebrow') }));
  card.appendChild(
    h('h2.student-join-title', {
      text: String(assignment.title || activity.title || t('student.join_eyebrow')),
    }),
  );
  if (activity.title && activity.title !== assignment.title) {
    card.appendChild(h('p.student-join-desc', { text: String(activity.title) }));
  }
  if (activity.description) {
    const description = h('div.student-join-desc');
    renderRichText(description, String(activity.description));
    card.appendChild(description);
  }

  const meta = h('div.student-join-meta');
  const template = assignment.template === 'quiz' ? 'quiz' : 'worksheet';
  meta.appendChild(
    h('span.badge.badge-primary', {
      text: t(template === 'quiz' ? 'student.template_quiz' : 'student.template_worksheet'),
    }),
  );
  if (assignment.code || state.code) {
    meta.appendChild(
      h('span.badge', { text: `${t('student.code_label')}: ${assignment.code || state.code}` }),
    );
  }
  card.appendChild(meta);

  // Assignment belongs to a class bundle: point to the class lobby unless the
  // student already carries a class token for it.
  const classCode = assignment.classCode || (CLASS_PARAM && CLASS_PARAM) || '';
  if (classCode && !getClassToken(classCode)) {
    const hint = h('p.student-join-hint.class-hint');
    hint.appendChild(h('span', { text: `${t('student.class_via_link')} ` }));
    hint.appendChild(
      h('a', { href: `/c/${encodeURIComponent(classCode)}` }, h('strong', { text: t('student.class_open_link') })),
    );
    card.appendChild(hint);
  }

  const form = h('form.student-join-form', { novalidate: true });
  form.appendChild(h('p.student-join-hint', { text: t('student.join_hint') }));

  const field = h('div.field');
  const label = h(
    'label.label',
    { htmlFor: 'join-name' },
    h('span', { text: requireName ? t('student.name_label') : t('student.name_label_optional') }),
  );
  field.appendChild(label);
  const input = h('input.input', {
    id: 'join-name',
    type: 'text',
    name: 'name',
    autocomplete: 'name',
    maxlength: 120,
    placeholder: t('student.name_placeholder'),
    value: state.pendingName || (CLASS_PARAM ? getClassName(CLASS_PARAM) : '') || '',
  });
  if (!requireName) input.setAttribute('aria-describedby', 'join-name-hint');
  field.appendChild(input);
  if (!requireName) {
    field.appendChild(h('p.help', { id: 'join-name-hint', text: t('student.name_optional_hint') }));
  }
  form.appendChild(field);

  const errorText = h('p.student-error-text', { id: 'join-error', role: 'alert', hidden: true });
  form.appendChild(errorText);

  const submitBtn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, t('student.join_button'));
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.hidden = true;
    const name = input.value.trim();
    state.pendingName = input.value;
    if (requireName && !name) {
      errorText.textContent = t('student.name_required');
      errorText.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    submitBtn.disabled = true;
    submitBtn.textContent = t('common.loading');
    try {
      const body = { code: state.code, name };
      if (CLASS_PARAM) {
        const classToken = getClassToken(CLASS_PARAM);
        if (classToken) body.classToken = classToken;
      }
      const data = await post('/api/join', body);
      const token = data && data.participantToken;
      if (token) {
        setParticipantToken(CODE, token);
        state.token = token;
        // Queue is scoped to the participant token; a freshly joined student
        // starts with an empty queue (never another student's answers).
        loadPendingQueue(token);
      }
      await hydrateAfterJoin(data);
      startPlayer();
    } catch (error) {
      if (error && error.code === 'invalid_code') {
        showFatalError({ title: t('student.invalid_code_title'), message: t('student.invalid_code_text') });
        return;
      }
      if (error && error.code === 'assignment_closed') {
        showFatalError({
          title: t('student.assignment_closed_title'),
          message: t('student.assignment_closed_text'),
        });
        return;
      }
      if (error && error.code === 'class_required') {
        const target = error.details && error.details.classCode ? `/c/${encodeURIComponent(error.details.classCode)}` : '/';
        window.location.assign(target);
        return;
      }
      if (error && error.code === 'name_required') {
        errorText.textContent = t('student.name_required');
        errorText.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else {
        const message = errorMessage(error);
        errorText.textContent = message;
        errorText.hidden = false;
        toast(message, 'error');
      }
      submitBtn.disabled = false;
      submitBtn.textContent = t('student.join_button');
    }
  });

  card.appendChild(form);

  window.setTimeout(() => {
    const firstField = qs('#join-name');
    if (firstField && document.activeElement !== firstField) firstField.focus();
  }, 50);

  return card;
}

async function hydrateAfterJoin(joinData) {
  // POST /api/join returns the full session payload, but `participant.startedAt`
  // (needed for the countdown) only comes from GET /api/participant. Hydrate
  // when a time limit is configured; degrade gracefully offline.
  const submitted = applyPayload(joinData);
  if (submitted) return;
  const minutes = Number(state.settings && state.settings.timeLimitMinutes);
  if (minutes > 0 && !(state.participant && state.participant.startedAt)) {
    try {
      const full = await get('/api/participant', { headers: participantHeaders(state.token) });
      const already = applyPayload(full);
      if (already) return;
    } catch {
      if (state.participant) {
        state.participant = { ...state.participant, startedAt: new Date().toISOString() };
      }
    }
  }
}

function buildPlayerScreen() {
  if (state.template === 'quiz') return buildQuizScreen();
  return buildWorksheetScreen();
}

function buildWorksheetScreen() {
  const wrap = h('div.student-player');
  if (state.settings && state.settings.practice) {
    wrap.appendChild(
      h('p.student-practice-banner', { role: 'note', text: t('student.practice_banner') }),
    );
  }
  if (state.activity && state.activity.description) {
    const description = h('div.card.compact');
    const body = h('div.small.muted');
    renderRichText(body, String(state.activity.description));
    description.appendChild(body);
    wrap.appendChild(description);
  }
  if (!state.items.length) {
    wrap.appendChild(h('div.card.empty', h('p.empty-title', { text: t('student.no_items') })));
    return wrap;
  }
  const list = h('ul.student-items');
  state.items.forEach((item, index) => {
    const li = h('li');
    li.appendChild(createItemCard(item, index));
    list.appendChild(li);
  });
  wrap.appendChild(list);
  wrap.appendChild(buildSubmitBar());
  updatePlayerProgress();
  return wrap;
}

function buildSubmitBar() {
  const bar = h('div.student-submit-bar.no-print');
  const info = h('div.student-submit-info', { dataset: { submitInfo: '1' } });
  bar.appendChild(info);
  const submitBtn = h(
    'button.btn.btn-primary.btn-lg',
    { type: 'button', 'data-submit': '1' },
    h('span', { html: icon('check', { size: 18 }) }),
    h('span', { text: t('student.submit') }),
  );
  submitBtn.addEventListener('click', () => submitAssignment());
  // Auto-resumed attempt on a shared device: offer a clean way to start over
  // as a different person (result/review screens always offer it as well).
  if (state.resumed) bar.appendChild(switchPersonButton());
  bar.appendChild(submitBtn);
  return bar;
}

function buildQuizScreen() {
  const total = state.items.length;
  const wrap = h('div.student-quiz');
  if (state.settings && state.settings.practice) {
    wrap.appendChild(
      h('p.student-practice-banner', { role: 'note', text: t('student.practice_banner') }),
    );
  }
  if (!total) {
    wrap.appendChild(h('div.card.empty', h('p.empty-title', { text: t('student.no_items') })));
    return wrap;
  }
  if (state.currentIndex < 0) state.currentIndex = 0;
  if (state.currentIndex >= total) state.currentIndex = total - 1;

  const progress = h('div.student-quiz-progress');
  const progressText = h('div.student-quiz-progress-text');
  progressText.appendChild(
    h('span', {
      id: 'quiz-progress-text',
      text: t('student.question_of', {
        current: formatNumber(state.currentIndex + 1),
        total: formatNumber(total),
      }),
    }),
  );
  const stats = answeredStats();
  progressText.appendChild(
    h('span.student-quiz-answered', {
      dataset: { quizAnswered: '1' },
      text: t('student.answered_short', {
        answered: formatNumber(stats.answered),
        total: formatNumber(stats.total),
      }),
    }),
  );
  progress.appendChild(progressText);

  const progressBar = h('div.progress', {
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': total,
    'aria-valuenow': state.currentIndex + 1,
    'aria-label': t('student.question_of', {
      current: formatNumber(state.currentIndex + 1),
      total: formatNumber(total),
    }),
  });
  const progressFill = h('span');
  progressFill.style.width = `${(((state.currentIndex + 1) / total) * 100).toFixed(2)}%`;
  progressBar.appendChild(progressFill);
  progress.appendChild(progressBar);
  wrap.appendChild(progress);

  const host = h('div.student-quiz-item', { tabindex: -1 });
  host.appendChild(createItemCard(state.items[state.currentIndex], state.currentIndex));
  wrap.appendChild(host);

  const nav = h('div.student-quiz-nav.no-print');
  const prevBtn = h(
    'button.btn.btn-secondary',
    { type: 'button', 'aria-label': t('common.previous') },
    h('span', { html: icon('arrow-left', { size: 18 }) }),
    h('span', { text: t('common.previous') }),
  );
  prevBtn.disabled = state.currentIndex === 0;
  prevBtn.addEventListener('click', () => quizGo(-1));
  nav.appendChild(prevBtn);
  if (state.resumed) nav.appendChild(switchPersonButton());

  nav.appendChild(h('span.student-quiz-spacer'));

  if (state.currentIndex >= total - 1) {
    const submitBtn = h(
      'button.btn.btn-primary',
      { type: 'button', 'data-submit': '1' },
      h('span', { html: icon('check', { size: 18 }) }),
      h('span', { text: t('student.submit') }),
    );
    submitBtn.addEventListener('click', () => submitAssignment());
    nav.appendChild(submitBtn);
  } else {
    const nextBtn = h(
      'button.btn.btn-primary',
      { type: 'button', 'aria-label': t('common.next') },
      h('span', { text: t('common.next') }),
      h('span', { html: icon('arrow-right', { size: 18 }) }),
    );
    nextBtn.addEventListener('click', () => quizGo(1));
    nav.appendChild(nextBtn);
  }
  wrap.appendChild(nav);
  return wrap;
}

function quizGo(delta) {
  captureLiveAnswers();
  const next = state.currentIndex + delta;
  if (next < 0 || next >= state.items.length) return;
  state.currentIndex = next;
  renderScreen();
  window.setTimeout(() => {
    const host = qs('.student-quiz-item', app);
    if (host) host.focus();
  }, 0);
  setAnnouncement(
    t('student.question_of', {
      current: formatNumber(next + 1),
      total: formatNumber(state.items.length),
    }),
  );
}

function buildResultScreen() {
  const wrap = h('div.student-result');
  const showResults = state.showResults === true;
  const hero = h('div.card.student-result-hero');
  hero.appendChild(h('div.student-result-icon', { html: icon('checkCircle', { size: 30 }) }));
  hero.appendChild(h('h2.student-result-title', { text: t('student.submitted_title') }));
  if (showResults) {
    hero.appendChild(h('p.student-result-subtitle', { text: t('student.submitted_text') }));
  } else {
    hero.appendChild(h('p.student-result-subtitle', { text: t('student.result_hidden') }));
  }

  const score = participantNumber('score', computeTotalScore());
  const maxScore = participantNumber('maxScore', computeMaxScore());
  if (showResults) {
    hero.appendChild(
      h(
        'div.student-score',
        h('span.student-score-value', { text: fmtScore(Number.isFinite(score) ? score : 0) }),
        h('span.student-score-max', { text: `/ ${fmtScore(Number.isFinite(maxScore) ? maxScore : 0)}` }),
      ),
    );
    hero.appendChild(
      h('p.student-score-percent', {
        text: t('student.result_percent', { percent: fmtPercent(score, maxScore) }),
      }),
    );
    const bar = h('div.progress.student-score-bar', {
      role: 'progressbar',
      'aria-valuemin': 0,
      'aria-valuemax': Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 1,
      'aria-valuenow': Number.isFinite(score) ? Math.min(score, maxScore || score) : 0,
    });
    const fill = h('span');
    const percent = maxScore > 0 ? Math.max(0, Math.min(100, (score / maxScore) * 100)) : 0;
    fill.style.width = `${percent.toFixed(2)}%`;
    bar.appendChild(fill);
    hero.appendChild(bar);
    hero.style.setProperty('--ow-score-percent', `${percent.toFixed(1)}%`);
    if (percent >= 75) celebrate();
  } else {
    hero.style.setProperty('--ow-score-percent', '100%');
    hero.appendChild(h('p.student-result-subtitle', { text: t('student.result_hidden') }));
  }

  if (scoreableItems().some((item) => state.results[item.id] && state.results[item.id].needsManual)) {
    hero.appendChild(h('p.student-result-note', { text: t('student.result_manual_note') }));
  }

  const actions = h('div.student-result-actions');
  if (state.classInfo && state.classInfo.code) {
    actions.appendChild(
      h(
        'a.btn.btn-secondary',
        { href: `/c/${encodeURIComponent(state.classInfo.code)}` },
        h('span', { html: icon('arrow-left', { size: 18 }) }),
        h('span', { text: t('student.class_back') }),
      ),
    );
  }
  if (state.settings.allowReview !== false) {
    const reviewBtn = h(
      'button.btn.btn-secondary',
      { type: 'button' },
      h('span', { html: icon('eye', { size: 18 }) }),
      h('span', { text: t('student.result_review') }),
    );
    reviewBtn.addEventListener('click', () => {
      state.screen = 'review';
      renderScreen();
      scrollToTop();
    });
    actions.appendChild(reviewBtn);
  }
  // Practice mode: the attempt is not graded — offer an immediate retry.
  if (state.settings && state.settings.practice) {
    hero.appendChild(h('p.student-result-note', { text: t('student.practice_note') }));
    const retryBtn = h(
      'button.btn.btn-secondary',
      { type: 'button' },
      h('span', { html: icon('refresh', { size: 18 }) }),
      h('span', { text: t('student.practice_retry') }),
    );
    retryBtn.addEventListener('click', () => reopenPracticeAttempt(retryBtn));
    actions.appendChild(retryBtn);
  }
  // Shared classroom device: allow the next pupil to start fresh.
  actions.appendChild(switchPersonButton());
  if (actions.childNodes.length) hero.appendChild(actions);

  wrap.appendChild(hero);
  if (showResults) wrap.appendChild(buildBreakdownCard());
  return wrap;
}

/** Practice mode: reopen the attempt so the student can try again. */
async function reopenPracticeAttempt(button) {
  if (button) button.disabled = true;
  try {
    await post('/api/participant/reopen', {}, { headers: participantHeaders(state.token) });
    const full = await get('/api/participant', { headers: participantHeaders(state.token) });
    state.submitted = !applyPayload(full);
    state.screen = 'player';
    renderScreen();
    scrollToTop();
  } catch (error) {
    toast(errorMessage(error), 'error');
    if (button) button.disabled = false;
  }
}

// Lightweight confetti burst for strong results (skipped for reduced motion).
function celebrate() {
  if (prefersReducedMotion()) return;
  const layer = h('div.ow-confetti', { 'aria-hidden': 'true' });
  const colors = ['#4f46e5', '#9333ea', '#22a06b', '#f59e0b', '#38bdf8', '#ec4899'];
  for (let i = 0; i < 90; i += 1) {
    const piece = h('span.ow-confetti-piece');
    const size = 6 + Math.random() * 7;
    piece.style.width = `${size}px`;
    piece.style.height = `${Math.max(3, size * (Math.random() > 0.5 ? 1 : 0.45))}px`;
    piece.style.background = colors[i % colors.length];
    piece.style.left = `${Math.random() * 100}vw`;
    layer.appendChild(piece);
    const drift = (Math.random() - 0.5) * 240;
    const spin = (Math.random() - 0.5) * 900;
    const animation = piece.animate(
      [
        { transform: 'translate3d(0, -12vh, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate3d(${drift}px, ${window.innerHeight + 140}px, 0) rotate(${spin}deg)`, opacity: 0.85 },
      ],
      {
        duration: 2200 + Math.random() * 1800,
        delay: Math.random() * 450,
        easing: 'cubic-bezier(0.2, 0.6, 0.35, 1)',
        fill: 'forwards',
      },
    );
    if (animation && typeof animation.onfinish !== 'undefined') animation.onfinish = () => piece.remove();
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 5000);
}

function participantNumber(key, fallback) {
  if (!state.participant) return fallback;
  const value = Number(state.participant[key]);
  return Number.isFinite(value) ? value : fallback;
}

function computeTotalScore() {
  let total = 0;
  for (const item of scoreableItems()) {
    const result = state.results[item.id];
    if (result) total += Number(result.autoScore) || 0;
  }
  return Math.round(total * 100) / 100;
}

function computeMaxScore() {
  let total = 0;
  for (const item of state.items) {
    if (item.type !== 'text' || textHasGaps(item)) total += Number(item.points) || 0;
  }
  return Math.round(total * 100) / 100;
}

function buildResultBadge(result) {
  if (!result) return h('span.badge', { text: t('common.unanswered') });
  if (result.needsManual) return h('span.badge.badge-info', { text: t('common.manual') });
  if (result.correct) return h('span.badge.badge-success', { text: t('common.correct') });
  if (Number(result.autoScore) > 0) return h('span.badge.badge-warning', { text: t('common.partial') });
  return h('span.badge.badge-danger', { text: t('common.incorrect') });
}

function buildBreakdownCard() {
  const card = h('div.card');
  card.appendChild(h('h3.card-title', { text: t('student.breakdown_title') }));
  const list = h('ul.student-breakdown');
  state.items.forEach((item, index) => {
    if (item.type === 'text' && !textHasGaps(item)) return;
    const result = state.results[item.id];
    const row = h('li.student-breakdown-row');
    row.appendChild(h('span.student-breakdown-number', { text: String(index + 1) }));
    const main = h('div.student-breakdown-main');
    main.appendChild(h('div.student-breakdown-stem', { text: plainText(item.stem).slice(0, 180) }));
    if (state.showAnswers && result && Array.isArray(result.answerText) && result.answerText.length) {
      main.appendChild(
        h('div.student-breakdown-answer', {
          text: `${t('student.solution_label')}: ${result.answerText.join(' · ')}`,
        }),
      );
    }
    row.appendChild(main);
    const side = h('div.student-breakdown-side');
    side.appendChild(buildResultBadge(result));
    if (result) {
      side.appendChild(
        h('span.student-breakdown-points', {
          text: fmtScore(Number(result.autoScore) || 0, Number(result.maxScore) || 0),
        }),
      );
    }
    row.appendChild(side);
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}

function buildReviewScreen() {
  const wrap = h('div.student-review');
  const toolbar = h('div.student-review-toolbar');
  toolbar.appendChild(h('h2.student-review-title', { text: t('student.review_title') }));
  const backBtn = h(
    'button.btn.btn-secondary',
    { type: 'button' },
    h('span', { html: icon('arrow-left', { size: 18 }) }),
    h('span', { text: t('student.result_back') }),
  );
  backBtn.addEventListener('click', () => {
    state.screen = 'result';
    renderScreen();
    scrollToTop();
  });
  const toolbarActions = h('div.row.gap-2.wrap', backBtn, switchPersonButton());
  toolbar.appendChild(toolbarActions);
  wrap.appendChild(toolbar);
  wrap.appendChild(h('p.student-review-note', { role: 'note', text: t('student.review_note') }));

  const list = h('ul.student-items');
  state.items.forEach((item, index) => {
    const li = h('li');
    li.appendChild(createItemCard(item, index, { mode: 'review', disabled: true }));
    list.appendChild(li);
  });
  wrap.appendChild(list);

  const actions = h('div.student-review-actions');
  const backBtnBottom = h('button.btn.btn-secondary', { type: 'button' }, h('span', { text: t('student.result_back') }));
  backBtnBottom.addEventListener('click', () => {
    state.screen = 'result';
    renderScreen();
    scrollToTop();
  });
  actions.appendChild(backBtnBottom);
  actions.appendChild(switchPersonButton());
  wrap.appendChild(actions);
  return wrap;
}

function buildErrorScreen() {
  const error = state.error || {};
  const wrap = h('div.card.student-error');
  wrap.appendChild(h('div.student-error-icon', { html: icon('warning', { size: 28 }) }));
  wrap.appendChild(h('h2.student-error-title', { text: error.title || t('student.error_title') }));
  wrap.appendChild(
    h('p.student-error-message', { text: error.message || t('student.error_text') }),
  );
  const actions = h('div.student-error-actions');
  if (typeof state.retry === 'function') {
    const retryBtn = h('button.btn.btn-primary', { type: 'button' }, h('span', { text: t('student.retry') }));
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.classList.add('is-busy');
      try {
        await state.retry();
      } finally {
        retryBtn.disabled = false;
        retryBtn.classList.remove('is-busy');
      }
    });
    actions.appendChild(retryBtn);
  }
  const home = h('a.btn.btn-secondary', { href: '/' }, h('span', { text: t('student.go_home') }));
  actions.appendChild(home);
  wrap.appendChild(actions);
  return wrap;
}

function showFatalError({ title, message, retry }) {
  state.screen = 'error';
  state.error = { title, message };
  state.retry = typeof retry === 'function' ? retry : null;
  destroyViews();
  renderScreen();
  scrollToTop();
}

// ---------------------------------------------------------------------------
// Shared-device affordance: leave the current participant and join as someone
// else. Clears the stored participant token and every retry-queue entry for
// this assignment, then reloads the join screen for a fresh participant.
// ---------------------------------------------------------------------------

function switchParticipant() {
  stopSession();
  try {
    clearParticipantToken(CODE);
  } catch {
    /* ignore */
  }
  state.token = null;
  state.submitted = false;
  state.resumed = false;
  removeQueueStorageKeys();
  const target = `/a/${encodeURIComponent(CODE)}`;
  try {
    if (window.location && typeof window.location.assign === 'function') {
      window.location.assign(target);
    } else {
      window.location.href = target;
    }
  } catch {
    try {
      window.location.reload();
    } catch {
      /* nothing else we can do */
    }
  }
}

function switchPersonButton(extraClass = '') {
  const button = h(`button.btn.btn-ghost.btn-sm${extraClass ? `.${extraClass}` : ''}`, {
    type: 'button',
    'data-switch-person': '1',
  });
  button.appendChild(h('span', { html: icon('logout', { size: 16 }) }));
  button.appendChild(h('span', { text: t('student.switch_person') }));
  button.addEventListener('click', switchParticipant);
  return button;
}

// ---------------------------------------------------------------------------
// Submit flow
// ---------------------------------------------------------------------------

async function submitAssignment({ auto = false } = {}) {
  if (state.submitted || submitting) return;
  if (!auto) {
    const unanswered = unansweredCount();
    const message =
      state.settings.warnUnanswered !== false && unanswered > 0
        ? t('student.submit_confirm_unanswered', { count: formatNumber(unanswered) })
        : t('student.submit_confirm_text');
    const confirmed = await confirmDialog({
      title: t('student.submit_confirm_title'),
      message,
      confirmLabel: t('student.submit'),
      cancelLabel: t('common.cancel'),
      danger: false,
    });
    if (!confirmed) return;
  }

  submitting = true;
  updateSubmitButtons();
  try {
    await flushAllPending();
    if (!auto && pendingCount() > 0) {
      const proceed = await confirmDialog({
        title: t('student.submit_confirm_title'),
        message: t('student.submit_pending_warning'),
        confirmLabel: t('student.submit'),
        cancelLabel: t('common.cancel'),
      });
      if (!proceed) {
        submitting = false;
        updateSubmitButtons();
        return;
      }
    }
  } catch {
    /* flushAllPending never throws; keep going */
  }

  try {
    const data = await post(
      '/api/participant/submit',
      { confirm: true },
      { headers: participantHeaders(state.token) },
    );
    onSubmitted(data);
  } catch (error) {
    if (handleSessionError(error)) {
      if (error && error.code === 'invalid_participant_token') {
        submitting = false;
        updateSubmitButtons();
      }
      return;
    }
    toast(errorMessage(error), 'error');
    if (auto) {
      autoSubmitPending = true;
      setAnnouncement(t('student.auto_submit_pending'));
    }
  } finally {
    if (!state.submitted) {
      submitting = false;
      updateSubmitButtons();
    }
  }
}

function onSubmitted(data) {
  state.submitted = true;
  autoSubmitPending = false;
  stopSession();
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  dirty.clear();
  pendingQueue = {};
  persistQueue();
  applySubmitPayload(data);
  state.screen = 'result';
  destroyViews();
  renderScreen();
  scrollToTop();
  setAnnouncement(t('student.submitted_title'));
}

function updateSubmitButtons() {
  for (const button of app.querySelectorAll('[data-submit]')) {
    button.disabled = submitting;
    button.setAttribute('aria-busy', submitting ? 'true' : 'false');
  }
}

// ---------------------------------------------------------------------------
// Class flow (/c/CODE): join a class bundle, see the lobby with lock states,
// open unlocked assignments via /a/<code>?c=<classCode>.
// ---------------------------------------------------------------------------

function applyClassPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  state.classPayload = payload.class || null;
  if (payload.participant && payload.participant.name) {
    state.classParticipantName = payload.participant.name;
    setClassName(CODE, payload.participant.name);
  }
}

async function initClassFlow() {
  state.screen = 'loading';
  renderScreen();
  if (state.classToken) {
    try {
      const data = await get(`/api/classes/${encodeURIComponent(CODE)}/participant`, {
        headers: classHeaders(state.classToken),
      });
      applyClassPayload(data);
      state.screen = 'class-lobby';
      renderScreen();
      return;
    } catch (error) {
      if (error && (error.code === 'invalid_class_token' || error.status === 401)) {
        clearClassToken(CODE);
        state.classToken = null;
      } else if (error && error.code === 'invalid_code') {
        showFatalError({ title: t('student.class_invalid_code_title'), message: t('student.class_invalid_code_text') });
        return;
      } else {
        toast(errorMessage(error), 'error');
        showFatalError({ title: t('student.error_title'), message: errorMessage(error), retry: () => initClassFlow() });
        return;
      }
    }
  }
  try {
    const info = await get(`/api/classes/join/${encodeURIComponent(CODE)}`);
    state.classJoinInfo = (info && info.class) || null;
    state.screen = 'class-join';
    renderScreen();
  } catch (error) {
    if (error && error.code === 'invalid_code') {
      showFatalError({ title: t('student.class_invalid_code_title'), message: t('student.class_invalid_code_text') });
      return;
    }
    toast(errorMessage(error), 'error');
    showFatalError({ title: t('student.error_title'), message: errorMessage(error), retry: () => initClassFlow() });
  }
}

function buildClassJoinScreen() {
  const info = state.classJoinInfo || {};
  const card = h('div.card.student-join');
  card.appendChild(h('p.student-join-eyebrow', { text: t('student.class_eyebrow') }));
  card.appendChild(h('h2.student-join-title', { text: String(info.name || t('student.class_eyebrow')) }));
  if (info.description) {
    const description = h('div.student-join-desc');
    renderRichText(description, String(info.description));
    card.appendChild(description);
  }
  const meta = h('div.student-join-meta');
  meta.appendChild(
    h('span.badge.badge-info', {
      text: t(info.orderMode === 'sequence' ? 'student.class_mode_sequence' : 'student.class_mode_free'),
    }),
  );
  meta.appendChild(h('span.badge', { text: `${t('student.code_label')}: ${CODE}` }));
  card.appendChild(meta);

  const form = h('form.student-join-form', { novalidate: true });
  form.appendChild(h('p.student-join-hint', { text: t('student.class_join_hint') }));
  const field = h('div.field');
  field.appendChild(h('label.label', { htmlFor: 'join-name' }, h('span', { text: t('student.name_label') })));
  const input = h('input.input', {
    id: 'join-name',
    type: 'text',
    name: 'name',
    autocomplete: 'name',
    maxlength: 120,
    placeholder: t('student.name_placeholder'),
    value: state.pendingName || '',
  });
  field.appendChild(input);
  form.appendChild(field);
  const errorText = h('p.student-error-text', { id: 'join-error', role: 'alert', hidden: true });
  form.appendChild(errorText);
  const submitBtn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, t('student.class_join_button'));
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.hidden = true;
    const name = input.value.trim();
    state.pendingName = input.value;
    if (!name) {
      errorText.textContent = t('student.name_required');
      errorText.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    submitBtn.disabled = true;
    submitBtn.textContent = t('common.loading');
    try {
      const data = await post('/api/classes/join', { code: CODE, name });
      if (data && data.classToken) {
        setClassToken(CODE, data.classToken);
        state.classToken = data.classToken;
      }
      applyClassPayload(data);
      state.screen = 'class-lobby';
      renderScreen();
      setAnnouncement(t('student.class_eyebrow'));
    } catch (error) {
      const message = errorMessage(error);
      errorText.textContent = message;
      errorText.hidden = false;
      toast(message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = t('student.class_join_button');
    }
  });

  card.appendChild(form);
  window.setTimeout(() => {
    const firstField = qs('#join-name');
    if (firstField && document.activeElement !== firstField) firstField.focus();
  }, 50);
  return card;
}

function classItemStateBadge(item) {
  if (item.state === 'done') return h('span.badge.badge-success', { text: t('student.class_item_done') });
  if (item.state === 'locked') return h('span.badge.badge-danger', { text: t('student.class_item_locked', { position: formatNumber(item.blockedBy || item.position) }) });
  return h('span.badge.badge-primary', { text: t('student.class_item_open') });
}

function buildClassLobby() {
  const payload = state.classPayload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const done = items.filter((item) => item.state === 'done').length;

  const wrap = h('div.student-class');
  const card = h('div.card.student-join');
  card.appendChild(h('p.student-join-eyebrow', { text: t('student.class_eyebrow') }));
  card.appendChild(h('h2.student-join-title', { text: String(payload.name || t('student.class_eyebrow')) }));
  if (payload.description) {
    const description = h('div.student-join-desc');
    renderRichText(description, String(payload.description));
    card.appendChild(description);
  }
  const meta = h('div.student-join-meta');
  meta.appendChild(
    h('span.badge.badge-info', {
      text: t(payload.orderMode === 'sequence' ? 'student.class_mode_sequence' : 'student.class_mode_free'),
    }),
  );
  meta.appendChild(h('span.badge', { text: t('student.class_progress', { done: formatNumber(done), total: formatNumber(items.length) }) }));
  card.appendChild(meta);
  wrap.appendChild(card);

  if (items.length === 0) {
    wrap.appendChild(h('div.card.compact.center.muted', { text: t('student.class_empty') }));
  } else {
    const list = h('ul.student-class-items');
    for (const item of items) {
      const li = h('li.student-class-item');
      li.appendChild(h('span.student-class-item-number', { 'aria-hidden': 'true', text: String(item.position) }));
      const main = h('div.student-class-item-main');
      main.appendChild(h('div.strong', { text: String(item.title || `#${item.position}`) }));
      const sub = h('div.row.gap-2.small.muted');
      sub.appendChild(h('span.badge', { text: t(item.template === 'quiz' ? 'student.template_quiz' : 'student.template_worksheet') }));
      if (item.state === 'done' && Number(item.maxScore) > 0) {
        sub.appendChild(h('span', { text: t('student.class_score', { score: fmtScore(item.score), maxScore: fmtScore(item.maxScore) }) }));
      }
      main.appendChild(sub);
      li.appendChild(main);
      const side = h('div.student-class-item-side');
      side.appendChild(classItemStateBadge(item));
      if (item.state === 'locked' || !item.code) {
        side.appendChild(h('button.btn.btn-secondary', { type: 'button', disabled: true }, t('student.class_item_open')));
      } else {
        side.appendChild(
          h(
            'a.btn.btn-primary',
            { href: `/a/${encodeURIComponent(item.code)}?c=${encodeURIComponent(CODE)}` },
            h('span', { text: item.state === 'done' ? t('student.class_item_review') : t('student.class_item_open') }),
          ),
        );
      }
      li.appendChild(side);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }

  const actions = h('div.student-class-actions');
  actions.appendChild(switchClassPersonButton());
  wrap.appendChild(actions);
  return wrap;
}

function switchClassPerson() {
  clearClassToken(CODE);
  state.classToken = null;
  state.classPayload = null;
  const target = `/c/${encodeURIComponent(CODE)}`;
  try {
    window.location.assign(target);
  } catch {
    window.location.href = target;
  }
}

function switchClassPersonButton() {
  const button = h('button.btn.btn-ghost.btn-sm', { type: 'button' });
  button.appendChild(h('span', { html: icon('logout', { size: 16 }) }));
  button.appendChild(h('span', { text: t('student.switch_person') }));
  button.addEventListener('click', switchClassPerson);
  return button;
}

// ---------------------------------------------------------------------------
// Startup / API loading
// ---------------------------------------------------------------------------

async function loadParticipant() {
  if (!state.token) return false;
  let data;
  try {
    data = await get('/api/participant', { headers: participantHeaders(state.token) });
  } catch (error) {
    if (error && error.code === 'invalid_participant_token') {
      // Stale token (deleted/reset participant, shared classroom device):
      // forget it and fall back to the join form instead of an error card.
      clearParticipantToken(CODE);
      state.token = null;
      removeQueueStorageKeys();
      return false;
    }
    throw error;
  }
  state.resumed = true;
  const submitted = applyPayload(data);
  if (submitted) {
    await loadResultView({ fallbackTitle: t('student.submitted_title') });
    return true;
  }
  startPlayer();
  return true;
}

function startPlayer() {
  state.screen = 'player';
  state.submitted = false;
  state.currentIndex = 0;
  setupSession();
  renderScreen();
  window.setTimeout(() => {
    const firstItem = qs('.student-item', app);
    if (firstItem) firstItem.focus();
  }, 0);
}

async function startJoinFlow() {
  state.screen = 'loading';
  state.joinInfo = null;
  state.resumed = false;
  renderScreen();
  try {
    const info = await get(`/api/join/${encodeURIComponent(CODE)}`);
    state.joinInfo = info || {};
    const assignment = state.joinInfo.assignment || {};
    applyAssignmentLocaleFromInfo(state.joinInfo);
    if (assignment.status === 'closed') {
      showFatalError({
        title: t('student.assignment_closed_title'),
        message: t('student.assignment_closed_text'),
      });
      return;
    }
    state.screen = 'join';
    renderScreen();
  } catch (error) {
    if (error && error.code === 'invalid_code') {
      showFatalError({
        title: t('student.invalid_code_title'),
        message: t('student.invalid_code_text'),
      });
      return;
    }
    if (error && error.code === 'assignment_closed') {
      showFatalError({
        title: t('student.assignment_closed_title'),
        message: t('student.assignment_closed_text'),
      });
      return;
    }
    const message = errorMessage(error);
    toast(message, 'error');
    showFatalError({
      title: t('student.error_title'),
      message,
      retry: () => startJoinFlow(),
    });
  }
}

function applyAssignmentLocaleFromInfo(info) {
  const locale =
    (info && info.assignment && info.assignment.locale) || (info && info.activity && info.activity.locale);
  if (locale === 'en' || locale === 'de') {
    let saved = null;
    try {
      saved = localStorage.getItem('ow_locale');
    } catch {
      /* ignore */
    }
    if (saved !== 'de' && saved !== 'en' && getLocale() !== locale) {
      setLocale(locale, { persist: false });
    }
  }
}

async function init() {
  initLocale();
  applyI18n(document);
  setupFontScale();
  setupGlobalListeners();
  buildA11yBar();
  loadPendingQueue(state.token);
  state.screen = 'loading';
  renderScreen();

  if (!CODE || !VALID_CODE_RE.test(CODE)) {
    showFatalError({
      title: t('student.invalid_code_title'),
      message: t('student.invalid_link'),
    });
    return;
  }

  if (MODE === 'c') {
    await initClassFlow();
    return;
  }

  if (state.token) {
    try {
      const resumed = await loadParticipant();
      if (resumed) return;
    } catch (error) {
      if (error && error.code === 'invalid_participant_token') {
        clearParticipantToken(CODE);
        state.token = null;
        removeQueueStorageKeys();
      } else {
        const message = errorMessage(error);
        toast(message, 'error');
        showFatalError({
          title: t('student.error_title'),
          message,
          retry: () => init(),
        });
        return;
      }
    }
  }
  await startJoinFlow();
}

function setupGlobalListeners() {
  window.addEventListener('online', async () => {
    updateOfflineUI();
    toast(t('student.online_again'), 'success');
    if (state.token && !state.submitted) {
      if (autoSubmitPending) submitAssignment({ auto: true });
      else await flushAllPending();
    }
    updateOfflineUI();
  });

  window.addEventListener('offline', () => {
    updateOfflineUI();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistDirtyToQueue();
      flushInBackground();
      return;
    }
    if (state.token && !state.submitted) {
      sendHeartbeat();
      if (autoSubmitPending) submitAssignment({ auto: true });
      else if (pendingCount() > 0) flushAllPending();
    }
  });

  window.addEventListener('pagehide', () => {
    persistDirtyToQueue();
    flushInBackground();
  });

  onLocaleChange(() => {
    if (state.screen === 'join' || state.screen === 'class-join') {
      const nameInput = qs('#join-name');
      if (nameInput) state.pendingName = nameInput.value;
    }
    captureLiveAnswers();
    buildA11yBar();
    renderScreen();
  });

  window.addEventListener('unhandledrejection', () => {
    toast(t('errors.unknown'), 'error');
  });
}

// Kick off once the module has parsed (module scripts run after DOM parsing).
init();
