// Landing page behaviour: join-code form, language toggle, capabilities badge.
import { registerMessages, initLocale, applyI18n, mountLanguageToggle, t } from './lib/i18n.js';
import { h, qs, toast } from './lib/dom.js';
import { get } from './lib/api.js';

registerMessages({
  de: {
    'landing.title': 'Interaktive Arbeitsblätter, selbst gehostet.',
    'landing.subtitle':
      'OpenWidgets ist eine quelloffene, datenschutzfreundliche Alternative zu BookWidgets. Lehrkräfte erstellen Quizze und Arbeitsblätter, Schüler:innen bearbeiten sie im Browser, die Auswertung passiert automatisch — alles auf dem eigenen Schulserver.',
    'landing.nav_features': 'Funktionen',
    'landing.nav_join': 'Als Schüler:in beitreten',
    'landing.teacher_login': 'Lehrkräfte-Login',
    'landing.cta_teacher': 'Lehrkräfte-Login',
    'landing.cta_student': 'Aufgabe beitreten',
    'landing.join_title': 'Einer Aufgabe beitreten',
    'landing.join_hint': 'Geben Sie den Code ein, den Ihre Lehrkraft bereitgestellt hat.',
    'landing.code_label': 'Aufgaben-Code',
    'landing.code_placeholder': 'z. B. K7M2QP',
    'landing.join_button': 'Beitreten',
    'landing.invalid_code': 'Bitte geben Sie einen gültigen Code ein (mindestens 4 Zeichen).',
    'landing.feature1_title': 'Schnelles Erstellen',
    'landing.feature1_text':
      'Zehn Aufgabentypen, automatische Punktevergabe, Vorschau in Echtzeit und Import/Export als JSON.',
    'landing.feature2_title': 'Live-Dashboard',
    'landing.feature2_text':
      'Sehen Sie beim Bearbeiten zu: Anwesenheit, Punktestand und jede einzelne Antwort — ohne die Klasse in Echtzeit zu unterbrechen.',
    'landing.feature3_title': 'Faire Bewertung',
    'landing.feature3_text':
      'Lösungsschlüssel bleiben am Server, Freitext wird manuell bewertet. Rückmeldung und Ergebnisansicht steuern Sie selbst.',
    'landing.status_title': 'Systemstatus',
    'landing.status_text': 'Diese Instanz läuft auf einem eigenen Server. Version und verfügbare Aufgabentypen:',
    'landing.footer_license': 'quelloffen (AGPL-3.0)',
    'landing.selfhosted_note':
      'Läuft komplett auf Ihrer eigenen Infrastruktur. Keine Cloud, keine Abos, keine Schülerdaten bei Dritten.',
    'landing.item_types': 'Aufgabentypen',
    'landing.available': 'verfügbar',
    'landing.unreachable': 'Server nicht erreichbar',
  },
  en: {
    'landing.title': 'Interactive worksheets, self-hosted.',
    'landing.subtitle':
      'OpenWidgets is an open-source, privacy-friendly alternative to BookWidgets. Teachers author quizzes and worksheets, students complete them in the browser, grading is automatic — all on your own school server.',
    'landing.nav_features': 'Features',
    'landing.nav_join': 'Join as a student',
    'landing.teacher_login': 'Teacher login',
    'landing.cta_teacher': 'Teacher login',
    'landing.cta_student': 'Join an assignment',
    'landing.join_title': 'Join an assignment',
    'landing.join_hint': 'Enter the code your teacher gave you.',
    'landing.code_label': 'Assignment code',
    'landing.code_placeholder': 'e.g. K7M2QP',
    'landing.join_button': 'Join',
    'landing.invalid_code': 'Please enter a valid code (at least 4 characters).',
    'landing.feature1_title': 'Fast authoring',
    'landing.feature1_text':
      'Ten question types, automatic scoring, live preview and JSON import/export.',
    'landing.feature2_title': 'Live dashboard',
    'landing.feature2_text':
      'Watch the class work: presence, score and every single response — without interrupting anyone.',
    'landing.feature3_title': 'Fair grading',
    'landing.feature3_text':
      'Answer keys stay on the server, free text is graded manually. You decide on feedback and result visibility.',
    'landing.status_title': 'System status',
    'landing.status_text': 'This instance runs on its own server. Version and available question types:',
    'landing.footer_license': 'open source (AGPL-3.0)',
    'landing.selfhosted_note':
      'Runs entirely on your own infrastructure. No cloud, no subscriptions, no student data with third parties.',
    'landing.item_types': 'question types',
    'landing.available': 'available',
    'landing.unreachable': 'Server unreachable',
  },
});

initLocale();

const joinForm = qs('#join-form');
const joinInput = qs('#join-code');
const joinError = qs('#join-error');

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = joinInput.value.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    joinError.textContent = t('landing.invalid_code');
    joinError.hidden = false;
    joinInput.setAttribute('aria-invalid', 'true');
    joinInput.focus();
    return;
  }
  joinError.hidden = true;
  joinInput.removeAttribute('aria-invalid');
  window.location.href = `/a/${encodeURIComponent(code)}`;
});

joinInput.addEventListener('input', () => {
  joinError.hidden = true;
  joinInput.removeAttribute('aria-invalid');
});

const langSlot = qs('#lang-slot');
mountLanguageToggle(langSlot);
applyI18n(document);

// Capabilities badge (version + question types + reachability)
(async () => {
  const badge = qs('#version-badge');
  const capabilitiesBox = qs('#capabilities');
  try {
    const data = await get('/api/capabilities');
    badge.hidden = false;
    badge.textContent = `v${data.version}`;
    const typeCount = Array.isArray(data.itemTypes) ? data.itemTypes.length : 0;
    capabilitiesBox.appendChild(
      h('span.badge.badge-success', `v${data.version} · ${typeCount} ${t('landing.item_types')}`),
    );
  } catch {
    badge.hidden = false;
    badge.textContent = t('landing.unreachable');
    badge.className = 'badge badge-danger';
    capabilitiesBox.appendChild(h('span.badge.badge-danger', t('landing.unreachable')));
  }
})();

window.addEventListener('unhandledrejection', () => {
  toast(t('errors.unknown'), 'error');
});
