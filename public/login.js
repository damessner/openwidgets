// Teacher login page.
import { registerMessages, initLocale, applyI18n, mountLanguageToggle, t } from './lib/i18n.js';
import { qs } from './lib/dom.js';
import { post, errorMessage } from './lib/api.js';

registerMessages({
  de: {
    'login.title': 'Anmelden',
    'login.subtitle': 'Lehrkräfte melden sich mit E-Mail an, Schüler:innen mit ihrem persönlichen Login.',
    'login.mode_teacher': 'Lehrkraft',
    'login.mode_student': 'Schüler:in',
    'login.username': 'Name oder Benutzername',
    'login.username_placeholder': 'z. B. Sabrina Messner',
    'login.student_hint': 'Melde dich mit deinem Namen (z. B. „Sabrina Messner“) oder Benutzernamen und deinem Passwort an — das hat dir deine Lehrkraft gegeben.',
    'login.selfhosted_note':
      'Diese Instanz wird selbst gehostet. Passwort vergessen? Bitte an die Administration wenden.',
    'login.redirecting': 'Anmeldung erfolgreich — weiter …',
    'login.demo_title': 'Demo-Modus — nur zum Ausprobieren',
    'login.demo_hint':
      'Login: admin / admin. Fertige Demo-Arbeitsblätter sind vorhanden. Schwaches Passwort, keine echten Schüler:innen-Daten verwenden.',
  },
  en: {
    'login.title': 'Sign in',
    'login.subtitle': 'Teachers sign in with email; students use their personal login.',
    'login.mode_teacher': 'Teacher',
    'login.mode_student': 'Student',
    'login.username': 'Name or username',
    'login.username_placeholder': 'e.g. Sabrina Messner',
    'login.student_hint': 'Sign in with your full name (e.g. “Sabrina Messner”) or your username plus the password your teacher gave you.',
    'login.selfhosted_note':
      'This instance is self-hosted. Forgot your password? Please contact your administrator.',
    'login.redirecting': 'Signed in — continuing …',
    'login.demo_title': 'Demo mode — for trying things out only',
    'login.demo_hint':
      'Login: admin / admin. Demo worksheets are preloaded. Weak password — do not use real student data.',
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
  // Already logged in as a student? Send them to the landing page panel.
  try {
    const res = await fetch('/api/student/me', { credentials: 'same-origin' });
    if (res.ok) window.location.replace('/');
  } catch {
    /* not a student — stay */
  }
})();

// ---------------------------------------------------------------------------
// Mode toggle: teacher (email) vs student (username + generated password)
// ---------------------------------------------------------------------------
let mode = 'teacher';
const modeTeacherBtn = qs('#mode-teacher');
const modeStudentBtn = qs('#mode-student');
const emailInput = qs('#email');
const emailLabel = qs('#email-label');

function setMode(next) {
  mode = next;
  modeTeacherBtn.classList.toggle('is-active', mode === 'teacher');
  modeStudentBtn.classList.toggle('is-active', mode === 'student');
  if (mode === 'student') {
    emailLabel.textContent = t('login.username');
    emailInput.type = 'text';
    emailInput.autocomplete = 'username';
    emailInput.inputMode = 'text';
    emailInput.placeholder = t('login.username_placeholder');
    emailInput.value = '';
  } else {
    emailLabel.textContent = t('common.email');
    emailInput.type = 'email';
    emailInput.autocomplete = 'username';
    emailInput.inputMode = 'email';
    emailInput.placeholder = '';
  }
  qs('#login-error').hidden = true;
}
modeTeacherBtn.addEventListener('click', () => setMode('teacher'));
modeStudentBtn.addEventListener('click', () => setMode('student'));

// Demo instances advertise themselves: show the throwaway credentials.
(async () => {
  try {
    const response = await fetch('/api/capabilities', { credentials: 'same-origin' });
    if (!response.ok) return;
    const capabilities = await response.json();
    if (!capabilities || !capabilities.demoMode) return;
    const box = qs('#demo-hint');
    if (!box) return;
    const title = document.createElement('strong');
    title.textContent = t('login.demo_title');
    const hint = document.createElement('div');
    hint.textContent = t('login.demo_hint');
    box.replaceChildren(title, hint);
    box.hidden = false;
    const emailInput = qs('#email');
    if (emailInput && !emailInput.value) {
      emailInput.value = 'admin';
      qs('#password').focus();
    }
  } catch {
    /* non-fatal */
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
    if (mode === 'student') {
      await post('/api/auth/student-login', { username: email, password });
      submit.textContent = t('login.redirecting');
      window.location.assign('/');
    } else {
      await post('/api/auth/login', { email, password });
      submit.textContent = t('login.redirecting');
      window.location.assign(safeNext());
    }
  } catch (err) {
    showError(errorMessage(err));
    submit.disabled = false;
    submit.textContent = t('common.login');
    qs('#password').select();
  }
});
