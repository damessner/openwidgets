// Minimal i18n: German-first with English fallback. Every visible string goes
// through t(). Modules register their own namespaced keys via registerMessages.
const messages = { de: {}, en: {} };
let current = 'de';
const listeners = new Set();

registerMessages({
  de: {
    'common.save': 'Speichern',
    'common.saved': 'Gespeichert',
    'common.saving': 'Wird gespeichert …',
    'common.cancel': 'Abbrechen',
    'common.delete': 'Löschen',
    'common.remove': 'Entfernen',
    'common.close': 'Schließen',
    'common.create': 'Erstellen',
    'common.edit': 'Bearbeiten',
    'common.back': 'Zurück',
    'common.next': 'Weiter',
    'common.previous': 'Zurück',
    'common.submit': 'Abgeben',
    'common.loading': 'Lädt …',
    'common.error': 'Fehler',
    'common.retry': 'Erneut versuchen',
    'common.copy': 'Kopieren',
    'common.copied': 'Kopiert',
    'common.download': 'Herunterladen',
    'common.upload': 'Hochladen',
    'common.print': 'Drucken',
    'common.preview': 'Vorschau',
    'common.publish': 'Veröffentlichen',
    'common.settings': 'Einstellungen',
    'common.title': 'Titel',
    'common.description': 'Beschreibung',
    'common.name': 'Name',
    'common.email': 'E-Mail',
    'common.password': 'Passwort',
    'common.points': 'Punkte',
    'common.question': 'Frage',
    'common.questions': 'Fragen',
    'common.actions': 'Aktionen',
    'common.search': 'Suchen',
    'common.yes': 'Ja',
    'common.no': 'Nein',
    'common.online': 'Online',
    'common.offline': 'Offline',
    'common.logout': 'Abmelden',
    'common.login': 'Anmelden',
    'common.language': 'Sprache',
    'common.of': 'von',
    'common.empty': 'Nichts vorhanden',
    'common.confirm': 'Bestätigen',
    'common.optional': 'optional',
    'common.correct': 'Richtig',
    'common.incorrect': 'Falsch',
    'common.partial': 'Teilweise richtig',
    'common.unanswered': 'Nicht beantwortet',
    'common.manual': 'Manuell bewerten',
    'common.student': 'Schüler:in',
    'common.students': 'Schüler:innen',
    'common.status': 'Status',
    'common.score': 'Punkte',
    'common.date': 'Datum',
    'common.time': 'Uhrzeit',
    'errors.network_error': 'Keine Verbindung zum Server. Bitte prüfen Sie das Netzwerk.',
    'errors.invalid_credentials': 'E-Mail oder Passwort ist falsch.',
    'errors.unauthorized': 'Bitte melden Sie sich an.',
    'errors.forbidden': 'Diese Aktion ist nicht erlaubt.',
    'errors.not_found': 'Nicht gefunden.',
    'errors.validation_failed': 'Bitte überprüfen Sie Ihre Eingaben.',
    'errors.invalid_request': 'Ungültige Anfrage.',
    'errors.revision_conflict': 'Die Aktivität wurde inzwischen an anderer Stelle geändert. Bitte neu laden.',
    'errors.rate_limited': 'Zu viele Versuche. Bitte warten Sie einen Moment.',
    'errors.payload_too_large': 'Die Datei ist zu groß.',
    'errors.unsupported_type': 'Dieser Dateityp wird nicht unterstützt.',
    'errors.assignment_closed': 'Diese Aufgabe ist geschlossen.',
    'errors.invalid_code': 'Dieser Code ist ungültig.',
    'errors.invalid_participant_token': 'Ihre Sitzung ist abgelaufen. Bitte neu beitreten.',
    'errors.attempt_submitted': 'Die Aufgabe wurde bereits abgegeben.',
    'errors.time_expired': 'Die Zeit ist abgelaufen. Die Aufgabe wurde abgegeben.',
    'errors.bad_origin': 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
    'errors.upload_failed': 'Der Upload ist fehlgeschlagen.',
    'errors.unknown': 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
    'errors.name_required': 'Bitte geben Sie Ihren Namen ein.',
    'errors.invalid_name': 'Der Name ist ungültig.',
    'errors.class_required': 'Diese Aufgabe gehört zu einer Klasse — bitte über den Klassen-Link beitreten.',
    'errors.item_locked': 'Bitte zuerst die vorherigen Aufgaben abgeben.',
    'errors.invalid_class_token': 'Ihre Klassen-Sitzung ist abgelaufen. Bitte neu beitreten.',
    'errors.class_empty': 'Diese Klasse hat noch keine Aufgaben.',
    'errors.not_in_class': 'Diese Aufgabe gehört nicht zu dieser Klasse.',
  },
  en: {
    'common.save': 'Save',
    'common.saved': 'Saved',
    'common.saving': 'Saving …',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.remove': 'Remove',
    'common.close': 'Close',
    'common.create': 'Create',
    'common.edit': 'Edit',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.previous': 'Back',
    'common.submit': 'Submit',
    'common.loading': 'Loading …',
    'common.error': 'Error',
    'common.retry': 'Try again',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.download': 'Download',
    'common.upload': 'Upload',
    'common.print': 'Print',
    'common.preview': 'Preview',
    'common.publish': 'Publish',
    'common.settings': 'Settings',
    'common.title': 'Title',
    'common.description': 'Description',
    'common.name': 'Name',
    'common.email': 'Email',
    'common.password': 'Password',
    'common.points': 'Points',
    'common.question': 'Question',
    'common.questions': 'Questions',
    'common.actions': 'Actions',
    'common.search': 'Search',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.online': 'Online',
    'common.offline': 'Offline',
    'common.logout': 'Sign out',
    'common.login': 'Sign in',
    'common.language': 'Language',
    'common.of': 'of',
    'common.empty': 'Nothing here',
    'common.confirm': 'Confirm',
    'common.optional': 'optional',
    'common.correct': 'Correct',
    'common.incorrect': 'Incorrect',
    'common.partial': 'Partially correct',
    'common.unanswered': 'Not answered',
    'common.manual': 'Needs manual grading',
    'common.student': 'Student',
    'common.students': 'Students',
    'common.status': 'Status',
    'common.score': 'Score',
    'common.date': 'Date',
    'common.time': 'Time',
    'errors.network_error': 'Cannot reach the server. Please check the network.',
    'errors.invalid_credentials': 'Email or password is wrong.',
    'errors.unauthorized': 'Please sign in.',
    'errors.forbidden': 'This action is not allowed.',
    'errors.not_found': 'Not found.',
    'errors.validation_failed': 'Please check your input.',
    'errors.invalid_request': 'Invalid request.',
    'errors.revision_conflict': 'This activity was changed elsewhere. Reload and try again.',
    'errors.rate_limited': 'Too many attempts. Please wait a moment.',
    'errors.payload_too_large': 'The file is too large.',
    'errors.unsupported_type': 'This file type is not supported.',
    'errors.assignment_closed': 'This assignment is closed.',
    'errors.invalid_code': 'This code is invalid.',
    'errors.invalid_participant_token': 'Your session expired. Please join again.',
    'errors.attempt_submitted': 'This assignment was already submitted.',
    'errors.time_expired': 'Time is up. Your assignment was submitted.',
    'errors.bad_origin': 'Security check failed. Please reload the page.',
    'errors.upload_failed': 'The upload failed.',
    'errors.unknown': 'Something went wrong. Please try again.',
    'errors.name_required': 'Please enter your name.',
    'errors.invalid_name': 'The name is invalid.',
    'errors.class_required': 'This assignment belongs to a class — please join via the class link.',
    'errors.item_locked': 'Please submit the previous assignments first.',
    'errors.invalid_class_token': 'Your class session expired. Please join again.',
    'errors.class_empty': 'This class has no assignments yet.',
    'errors.not_in_class': 'This assignment is not part of this class.',
  },
});

export function registerMessages(bundle) {
  if (!bundle || typeof bundle !== 'object') return;
  for (const [locale, dict] of Object.entries(bundle)) {
    if (locale !== 'de' && locale !== 'en') continue;
    if (!messages[locale]) messages[locale] = {};
    Object.assign(messages[locale], dict);
  }
}

export function t(key, vars) {
  const dict = messages[current] || {};
  const fallback = messages.en || {};
  let value = dict[key];
  if (value === undefined) value = fallback[key];
  if (value === undefined) value = key;
  if (vars) {
    value = String(value).replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : match,
    );
  }
  return value;
}

export function getLocale() {
  return current;
}

export function formatNumber(value, options = {}) {
  const locale = current === 'en' ? 'en-US' : 'de-AT';
  try {
    return new Intl.NumberFormat(locale, options).format(Number(value) || 0);
  } catch {
    return String(value);
  }
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const locale = current === 'en' ? 'en-GB' : 'de-AT';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const locale = current === 'en' ? 'en-GB' : 'de-AT';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

export function setLocale(locale, options = {}) {
  current = locale === 'en' ? 'en' : 'de';
  if (options.persist !== false) {
    try {
      localStorage.setItem('ow_locale', current);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    applyI18n(document);
  }
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      /* ignore listener errors */
    }
  }
  return current;
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pick the initial locale: saved preference > server/user locale > browser. */
export function initLocale(fallback) {
  let saved = null;
  try {
    saved = localStorage.getItem('ow_locale');
  } catch {
    /* ignore */
  }
  if (saved === 'de' || saved === 'en') {
    current = saved;
  } else if (fallback === 'de' || fallback === 'en') {
    current = fallback;
  } else {
    const browser = typeof navigator !== 'undefined' ? String(navigator.language || 'de') : 'de';
    current = browser.toLowerCase().startsWith('en') ? 'en' : 'de';
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    applyI18n(document);
  }
  return current;
}

/** Translate all [data-i18n*] elements inside root. */
export function applyI18n(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  root.querySelectorAll('[data-i18n-value]').forEach((el) => {
    el.setAttribute('value', t(el.getAttribute('data-i18n-value')));
  });
}

/** Add a DE/EN language switch to the given container. */
export function mountLanguageToggle(container) {
  if (!container) return;
  const wrap = document.createElement('div');
  wrap.className = 'lang-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Sprache / Language');
  for (const locale of ['de', 'en']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-btn';
    button.textContent = locale.toUpperCase();
    button.dataset.locale = locale;
    button.addEventListener('click', () => {
      setLocale(locale);
      sync();
    });
    wrap.appendChild(button);
  }
  function sync() {
    wrap.querySelectorAll('.lang-btn').forEach((button) => {
      const active = button.dataset.locale === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  sync();
  onLocaleChange(sync);
  container.appendChild(wrap);
}
