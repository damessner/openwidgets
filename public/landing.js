// Landing page behaviour: join-code form, language toggle, capabilities badge.
import { registerMessages, initLocale, applyI18n, mountLanguageToggle, t } from './lib/i18n.js';
import { h, qs, toast } from './lib/dom.js';
import { get, post } from './lib/api.js';

registerMessages({
  de: {
    'landing.eyebrow': 'Open Source · Für Schulen',
    'landing.title_a': 'Interaktive Arbeitsblätter,',
    'landing.title_b': 'selbst gehostet.',
    'landing.stat_types_value': '18',
    'landing.stat_types_label': 'Aufgabentypen',
    'landing.stat_hosting_value': '100 %',
    'landing.stat_hosting_label': 'auf Ihrem Server',
    'landing.stat_license_value': 'AGPL-3.0',
    'landing.stat_license_label': 'quelloffen',
    'landing.subtitle':
      'OpenWidgets ist eine quelloffene, datenschutzfreundliche Plattform für interaktive Arbeitsblätter. Lehrkräfte erstellen Quizze und Arbeitsblätter, Schüler:innen bearbeiten sie im Browser, die Auswertung passiert automatisch — alles auf dem eigenen Schulserver.',
    'landing.nav_features': 'Funktionen',
    'landing.trust_privacy': 'DSGVO-konform · eigener Schulserver',
    'landing.trust_opensource': 'Open Source · AGPL-3.0',
    'landing.trust_no_tracking': 'Keine Tracking-Cookies · keine Drittanbieter-CDNs',
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
      '18 Aufgabentypen — von Multiple Choice, Lückentext und Zuordnen über Tabellen, Hotspot-Bilder (TipToi-artig), Hangman bis Kreuzworträtsel. Automatische Punktevergabe, Vorschau in Echtzeit, JSON-Import/Export.',
    'landing.feature2_title': 'Klassen & Lernpfade',
    'landing.feature2_text':
      'Arbeitsblätter zu Klassen bündeln — sequenziell (eine erledigte Aufgabe schaltet die nächste frei) oder in beliebiger Reihenfolge. Schüler:innen erhalten automatisch generierte Zugangsdaten zum Ausdrucken.',
    'landing.feature3_title': 'Vokabeln & Multimedia',
    'landing.feature3_text':
      'Vokabellisten mit Bild und Audio (CSV-Import) und Vokabel-Trainer mit Modi wie „Hören“ oder „Zuordnen“. Bilder per Strg+V einfügen, Audio-Antworten der Schüler:innen, anklickbare Hotspot-Bereiche im Bild.',
    'landing.feature4_title': 'Live-Dashboard & Statistik',
    'landing.feature4_text':
      'Sehen Sie beim Bearbeiten zu: Anwesenheit, Punktestand und jede einzelne Antwort. Die Klassen-Statistik zeigt, wie jede:r Schüler:in abgeschnitten hat; Schüler:innen sehen ihre Aufgaben mit Fortschrittsbalken.',
    'landing.feature5_title': 'Faire Bewertung & Datenschutz',
    'landing.feature5_text':
      'Lösungsschlüssel bleiben am Server, Freitext wird manuell bewertet. Rückmeldung und Ergebnisansicht steuern Sie selbst — alles auf Ihrem Schulserver, keine Cloud, keine Schülerdaten bei Dritten.',
    'landing.feature6_title': 'Drucken, QR & Offline',
    'landing.feature6_text':
      'Arbeitsblätter als Druckansicht, Beitritt per QR-Code. Antworten werden lokal zwischengespeichert und bei erneuter Verbindung automatisch übertragen.',
    'landing.status_title': 'Systemstatus',
    'landing.status_text': 'Diese Instanz läuft auf einem eigenen Server. Version und verfügbare Aufgabentypen:',
    'landing.footer_license': 'quelloffen (AGPL-3.0)',
    'landing.selfhosted_note':
      'Läuft komplett auf Ihrer eigenen Infrastruktur. Keine Cloud, keine Abos, keine Schülerdaten bei Dritten.',
    'landing.item_types': 'Aufgabentypen',
    'landing.available': 'verfügbar',
    'landing.unreachable': 'Server nicht erreichbar',
    'landing.reachable': 'Server erreichbar',
    'landing.student_title': 'Deine Aufgaben',
    'landing.greeting': 'Hallo, {name}! 👋',
    'landing.metric_done': 'Erledigt',
    'landing.metric_avg': 'Ø Punkte',
    'landing.metric_open': 'Offen',
    'landing.metric_classes': 'Klassen',
    'landing.student_hint': 'Angemeldet als {name} ({username}).',
    'landing.student_logout': 'Abmelden',
    'landing.student_empty': 'Dir wurden noch keine Klassen-Aufgaben zugewiesen.',
    'landing.state_locked': 'gesperrt',
    'landing.state_open': 'offen',
    'landing.state_done': 'erledigt',
    'landing.open_class': 'Öffnen',
    'landing.score_label': '{score} / {max} Punkte',
    'landing.mode_sequence': 'Reihenfolge',
    'landing.class_progress': 'Fortschritt in {name}',
    'landing.item_progress': 'Fortschritt: {title}',
  },
  en: {
    'landing.eyebrow': 'Open source · Built for schools',
    'landing.title_a': 'Interactive worksheets,',
    'landing.title_b': 'self-hosted.',
    'landing.stat_types_value': '18',
    'landing.stat_types_label': 'question types',
    'landing.stat_hosting_value': '100%',
    'landing.stat_hosting_label': 'on your server',
    'landing.stat_license_value': 'AGPL-3.0',
    'landing.stat_license_label': 'open source',
    'landing.subtitle':
      'OpenWidgets is an open-source, privacy-friendly platform for interactive worksheets. Teachers author quizzes and worksheets, students complete them in the browser, grading is automatic — all on your own school server.',
    'landing.nav_features': 'Features',
    'landing.trust_privacy': 'GDPR-compliant · your own school server',
    'landing.trust_opensource': 'Open source · AGPL-3.0',
    'landing.trust_no_tracking': 'No tracking cookies · no third-party CDNs',
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
      '18 question types — from multiple choice, fill-in-the-blanks and matching to tables, hotspot images (TipToi-style), hangman and crosswords. Automatic scoring, live preview, JSON import/export.',
    'landing.feature2_title': 'Classes & learning paths',
    'landing.feature2_text':
      'Bundle worksheets into classes — in sequence (a completed task unlocks the next) or in any order. Students get auto-generated credentials you can print.',
    'landing.feature3_title': 'Vocabulary & multimedia',
    'landing.feature3_text':
      'Vocabulary lists with images and audio (CSV import) plus a vocabulary trainer with modes like “listen” or “match”. Paste images with Ctrl+V, audio answers from students, clickable hotspot areas in images.',
    'landing.feature4_title': 'Live dashboard & statistics',
    'landing.feature4_text':
      'Watch the class work: presence, scores and every single response. Class statistics show how each student did; students see their tasks with progress bars.',
    'landing.feature5_title': 'Fair grading & privacy',
    'landing.feature5_text':
      'Answer keys stay on the server, free text is graded manually. You decide on feedback and result visibility — all on your school server, no cloud, no student data with third parties.',
    'landing.feature6_title': 'Print, QR & offline',
    'landing.feature6_text':
      'Print view for worksheets, join via QR code. Answers are cached locally and synced automatically once back online.',
    'landing.status_title': 'System status',
    'landing.status_text': 'This instance runs on its own server. Version and available question types:',
    'landing.footer_license': 'open source (AGPL-3.0)',
    'landing.selfhosted_note':
      'Runs entirely on your own infrastructure. No cloud, no subscriptions, no student data with third parties.',
    'landing.item_types': 'question types',
    'landing.available': 'available',
    'landing.unreachable': 'Server unreachable',
    'landing.reachable': 'Server reachable',
    'landing.student_title': 'Your assignments',
    'landing.greeting': 'Hello, {name}! 👋',
    'landing.metric_done': 'Done',
    'landing.metric_avg': 'Avg. score',
    'landing.metric_open': 'Open',
    'landing.metric_classes': 'Classes',
    'landing.student_hint': 'Signed in as {name} ({username}).',
    'landing.student_logout': 'Sign out',
    'landing.student_empty': 'No class assignments for you yet.',
    'landing.state_locked': 'locked',
    'landing.state_open': 'open',
    'landing.state_done': 'done',
    'landing.open_class': 'Open',
    'landing.score_label': '{score} / {max} points',
    'landing.mode_sequence': 'Sequence',
    'landing.class_progress': 'Progress in {name}',
    'landing.item_progress': 'Progress: {title}',
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

// Reachability badge — anonymous capabilities no longer disclose version or
// the item-type list, so the public page only shows that the server is up.
(async () => {
  const capabilitiesBox = qs('#capabilities');
  try {
    await get('/api/capabilities');
    capabilitiesBox.appendChild(h('span.badge.badge-success', t('landing.reachable')));
  } catch {
    capabilitiesBox.appendChild(h('span.badge.badge-danger', t('landing.unreachable')));
  }
})();

// Logged-in student? Show their classes with per-item states instead of only
// the anonymous join-by-code form.
(async () => {
  const panel = qs('#student-panel');
  if (!panel) return;
  let me;
  try {
    me = await get('/api/student/me');
  } catch {
    return; // not logged in as a student
  }
  const student = me.student || {};
  const classes = Array.isArray(me.classes) ? me.classes : [];

  // aggregate metrics across all classes (pupil dashboard mockup)
  let totalItems = 0, doneItems = 0, openItems = 0, scoreSum = 0, maxSum = 0;
  for (const cls of classes) {
    for (const item of Array.isArray(cls.items) ? cls.items : []) {
      totalItems += 1;
      if (item.state === 'done') {
        doneItems += 1;
        scoreSum += Number(item.score) || 0;
        maxSum += Number(item.maxScore) || 0;
      } else if (item.state === 'open') openItems += 1;
    }
  }
  const donePct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  const avgPct = maxSum > 0 ? Math.round((scoreSum / maxSum) * 100) : doneItems > 0 ? 100 : 0;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const dash = h('section.landing-student-dashboard');

  // greeting card (redesign v2.4 pupil dashboard)
  dash.appendChild(
    h('div.card.accent-top.landing-greet.mb-4',
      h('div.row.gap-2.wrap.mb-2',
        ...classes.slice(0, 3).map((cls) => h('span.badge.badge-primary', cls.name || cls.code || '')),
        h('span.badge', today),
      ),
      h('h1.landing-greet-title', t('landing.greeting', { name: student.name || student.username || '' })),
      h('p.small.muted.mb-0', t('landing.student_hint', { name: student.name || '', username: student.username || '' })),
    ),
  );

  // KPI metric cards, first with progress ring
  const ring = h('span.stat-ring',
    { html: `<svg viewBox="0 0 48 48"><circle class="ring-track" cx="24" cy="24" r="20"></circle><circle class="ring-fill" cx="24" cy="24" r="20" stroke-dasharray="125.6" stroke-dashoffset="${(125.6 * (1 - donePct / 100)).toFixed(2)}"></circle></svg>` },
    h('span.ring-icon', { text: `${donePct}%` }),
  );
  dash.appendChild(
    h('div.kpi-grid.landing-metrics',
      h('div.kpi-card', h('div', h('span.kpi-label', t('landing.metric_done')), h('div.kpi-value', `${doneItems}/${totalItems}`)), ring),
      h('div.kpi-card', h('div', h('span.kpi-label', t('landing.metric_avg')), h('div.kpi-value', `${avgPct}%`))),
      h('div.kpi-card', h('div', h('span.kpi-label', t('landing.metric_open')), h('div.kpi-value', String(openItems)))),
      h('div.kpi-card', h('div', h('span.kpi-label', t('landing.metric_classes')), h('div.kpi-value', String(classes.length)))),
    ),
  );

  const card = h('section.card.landing-join.accent-top',
    h('div.row.between.wrap.gap-2',
      h('div',
        h('h2.landing-join-title', t('landing.student_title')),
        h('p.small.muted.mb-0', t('landing.student_hint', { name: student.name || '', username: student.username || '' })),
      ),
      h('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        on: {
          click: async () => {
            try {
              await post('/api/auth/student-logout');
            } catch { /* ignore */ }
            window.location.reload();
          },
        },
      }, t('landing.student_logout')),
    ),
  );
  if (classes.length === 0) {
    card.appendChild(h('p.small.muted.mt-2', t('landing.student_empty')));
  }

  // Progress bar colour: by correctness once the item is done.
  const progressClass = (item) => {
    if (item.state === 'locked') return 'is-locked';
    if (item.state !== 'done') return 'is-open';
    const pct = item.maxScore > 0 ? (Number(item.score) || 0) / Number(item.maxScore) * 100 : 100;
    if (pct >= 75) return 'is-good';
    if (pct >= 40) return 'is-mid';
    return 'is-low';
  };
  const progressWidth = (item) => {
    if (item.state === 'locked' || item.state === 'open') return 0;
    if (!item.maxScore) return 100;
    return Math.max(0, Math.min(100, Math.round(((Number(item.score) || 0) / Number(item.maxScore)) * 100)));
  };

  for (const cls of classes) {
    const items = Array.isArray(cls.items) ? cls.items : [];
    const doneItems = items.filter((it) => it.state === 'done');
    const scoreSum = doneItems.reduce((sum, it) => sum + (Number(it.score) || 0), 0);
    const maxSum = doneItems.reduce((sum, it) => sum + (Number(it.maxScore) || 0), 0);
    const classPercent = maxSum > 0 ? Math.round((scoreSum / maxSum) * 100) : doneItems.length > 0 ? 100 : 0;
    const classBarClass = doneItems.length === 0 ? 'is-open' : classPercent >= 75 ? 'is-good' : classPercent >= 40 ? 'is-mid' : 'is-low';
    const box = h('div.landing-class.mt-3',
      h('div.row.between.wrap.gap-2',
        h('div.grow.min-w-0',
          h('div.row.gap-2.wrap',
            h('div.strong', cls.name || cls.code),
            cls.orderMode === 'sequence' ? h('span.badge.badge-info', t('landing.mode_sequence')) : null,
          ),
          h('div.student-progress', {
            role: 'progressbar',
            'aria-valuenow': String(classPercent),
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-label': t('landing.class_progress', { name: cls.name || cls.code || '' }),
          }, h(`div.student-progress-bar.${classBarClass}`, { style: `width:${classPercent}%` })),
        ),
        h('a.btn.btn-secondary.btn-sm', { href: `/c/${encodeURIComponent(String(cls.code || '').toUpperCase())}` }, t('landing.open_class')),
      ),
    );
    const list = h('ul.landing-student-items');
    for (const item of items) {
      const stateKey = item.state === 'locked' ? 'landing.state_locked' : item.state === 'passed' || item.state === 'done' ? 'landing.state_done' : 'landing.state_open';
      const width = progressWidth(item);
      list.appendChild(h('li.landing-student-item',
        h('div.row.between.wrap.gap-2',
          h('span.grow.min-w-0', { text: `${item.position}. ${item.title || ''}` }),
          h('span.row.gap-2',
            item.maxScore ? h('span.small.muted', t('landing.score_label', { score: item.score || 0, max: item.maxScore })) : null,
            h('span.badge', { text: t(stateKey) }),
            item.code ? h('a.btn.btn-primary.btn-sm', { href: `/a/${encodeURIComponent(item.code)}${cls.code ? `?c=${encodeURIComponent(cls.code)}` : ''}` }, t('landing.open_class')) : null,
          ),
        ),
        h('div.student-progress.sm', {
          role: 'progressbar',
          'aria-valuenow': String(width),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-label': t('landing.item_progress', { title: item.title || '' }),
        }, h(`div.student-progress-bar.${progressClass(item)}`, { style: `width:${width}%` })),
      ));
    }
    box.appendChild(list);
    card.appendChild(box);
  }
  dash.appendChild(card);
  panel.appendChild(dash);
})();

window.addEventListener('unhandledrejection', () => {
  toast(t('errors.unknown'), 'error');
});
