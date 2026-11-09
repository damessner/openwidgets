// Teacher login page.
import { registerMessages, initLocale, applyI18n, mountLanguageToggle, t } from './lib/i18n.js';
import { qs } from './lib/dom.js';
import { post, errorMessage } from './lib/api.js';

registerMessages({
  de: {
    'login.title': 'Anmelden',
    'login.subtitle': 'Für Lehrkräfte dieser Instanz. Schüler:innen treten über den Aufgaben-Link bei.',
    'login.selfhosted_note':
      'Diese Instanz wird selbst gehostet. Passwort vergessen? Bitte an die Administration wenden.',
    'login.redirecting': 'Anmeldung erfolgreich — weiter …',
  },
  en: {
    'login.title': 'Sign in',
    'login.subtitle': 'For teachers of this instance. Students join via the assignment link.',
    'login.selfhosted_note':
      'This instance is self-hosted. Forgot your password? Please contact your administrator.',
    'login.redirecting': 'Signed in — continuing …',
  },
});

initLocale();

const form = qs('#login-form');
const errorBox = qs('#login-error');
const submit = qs('#login-submit');
const langSlot = qs('#lang-slot');
mountLanguageToggle(langSlot);
applyI18n(document);

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.setAttribute('role', 'alert');
}

function safeNext() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || '';
  // Only same-origin absolute paths are allowed.
  return /^\/(?!\/)/.test(next) ? next : '/teacher/';
}

(async () => {
  try {
    const data = await fetch('/api/me', { credentials: 'same-origin' });
    if (data.ok) window.location.replace(safeNext());
  } catch {
    /* stay on the login page */
  }
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const email = qs('#email').value.trim();
  const password = qs('#password').value;
  if (!email || !password) {
    showError(t('errors.invalid_credentials'));
    return;
  }
  submit.disabled = true;
  submit.textContent = t('common.loading');
  try {
    await post('/api/auth/login', { email, password });
    submit.textContent = t('login.redirecting');
    window.location.assign(safeNext());
  } catch (err) {
    showError(errorMessage(err));
    submit.disabled = false;
    submit.textContent = t('common.login');
    qs('#password').select();
  }
});
