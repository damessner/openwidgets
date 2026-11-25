// Built-in writing-task templates (teacher area "Texte"). Pure data —
// importable from server and browser. Each template produces one activity
// definition with a single `writing` item.
import { createDefinition, normalizeActivity } from './activity.js';
import { createItem } from './items/index.js';
import { shortId } from './util.js';

const CRITERIA = {
  content: { id: 'c1', label: 'Inhalt', weight: 40, description: 'Nachvollziehbarkeit, Argumentation, Bezug zur Aufgabenstellung' },
  structure: { id: 'c2', label: 'Struktur', weight: 25, description: 'Aufbau (Einleitung – Hauptteil – Schluss), roter Faden, Absätze' },
  language: { id: 'c3', label: 'Sprache & Stil', weight: 20, description: 'Wortwahl, Satzbau, adresdatengerechter Stil' },
  spelling: { id: 'c4', label: 'Rechtschreibung & Zeichensetzung', weight: 15, description: 'Orthografie, Grammatik, Zeichensetzung' },
};

function cloneCriteria(...keys) {
  return keys.map((key, index) => ({ ...CRITERIA[key], id: `c${index + 1}` }));
}

export const WRITING_TEMPLATES = [
  {
    id: 'leserbrief',
    label: { de: 'Leserbrief', en: 'Letter to the editor' },
    subject: { de: 'Deutsch', en: 'Language arts' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 5 });
      item.stem = 'Schreibe einen Leserbrief zu einem aktuellen Thema aus der Zeitung: Nimm Stellung, begründe deine Meinung mit mindestens zwei Argumenten und appelliere an die Leser:innen.';
      item.config = {
        gradeLevel: 'ab 8. Klasse',
        sourceText: 'Zeitungsartikel (als Quelle einfügen) …',
        criteria: cloneCriteria('content', 'structure', 'language', 'spelling'),
        minWords: 120,
        maxWords: 400,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
  {
    id: 'inhaltsangabe',
    label: { de: 'Inhaltsangabe', en: 'Summary' },
    subject: { de: 'Deutsch', en: 'Language arts' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 5 });
      item.stem = 'Fasse den vorliegenden Text in eigenen Worten zusammen: Hauptgedanken, wichtige Details, keine eigene Meinung. Schreibe im Präsens.';
      item.config = {
        gradeLevel: 'ab 6. Klasse',
        sourceText: 'Vorliegender Text (als Quellmaterial einfügen) …',
        criteria: cloneCriteria('content', 'structure', 'language', 'spelling'),
        minWords: 80,
        maxWords: 250,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
  {
    id: 'erörterung',
    label: { de: 'Erörterung', en: 'Argumentative essay' },
    subject: { de: 'Deutsch', en: 'Language arts' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 6 });
      item.stem = 'Erörtere die Frage: Pro- und Kontra-Argumente abwägen, eigene Position begründen, mit Einleitung und Schluss.\nBeziehe dich auf das Quellmaterial.';
      item.config = {
        gradeLevel: 'ab 9. Klasse',
        sourceText: '',
        criteria: cloneCriteria('content', 'structure', 'language', 'spelling'),
        minWords: 200,
        maxWords: 600,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
  {
    id: 'textanalyse',
    label: { de: 'Textanalyse (Kurzgeschichte)', en: 'Short-story analysis' },
    subject: { de: 'Deutsch', en: 'Language arts' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 6 });
      item.stem = 'Analysiere die Kurzgeschichte: Erzählerperspektive, Aufbau, sprachliche Mittel mit Textbelegen, Deutung der Aussage.';
      item.config = {
        gradeLevel: 'ab 10. Klasse',
        sourceText: 'Kurzgeschichte (als Quellmaterial einfügen) …',
        criteria: cloneCriteria('content', 'structure', 'language', 'spelling'),
        minWords: 250,
        maxWords: 700,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
  {
    id: 'beschreibung',
    label: { de: 'Bild-/Szenenbeschreibung', en: 'Description' },
    subject: { de: 'Deutsch / Kunst', en: 'Language arts / Art' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 4 });
      item.stem = 'Beschreibe das Bild oder die Szene genau: Was ist zu sehen? Wo? Details, Perspektive, Stimmung — ohne zu werten.';
      item.config = {
        gradeLevel: 'ab 5. Klasse',
        sourceText: '',
        criteria: cloneCriteria('content', 'structure', 'language', 'spelling'),
        minWords: 60,
        maxWords: 250,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
  {
    id: 'mathe-argumentation',
    label: { de: 'Mathe: Begründung', en: 'Math: reasoning' },
    subject: { de: 'Mathematik', en: 'Math' },
    build({ title, locale }) {
      const item = createItem('writing', { id: shortId('it'), points: 5 });
      item.stem = 'Begründe rechnerisch und in Worten: Wie kommst du auf dein Ergebnis? Erkläre jeden Schritt, damit jemand anderes mitrechnen kann.';
      item.config = {
        gradeLevel: 'ab 7. Klasse',
        sourceText: '',
        criteria: [
          { id: 'c1', label: 'Rechnerischer Weg', weight: 40, description: 'Rechenschritte vollständig und richtig' },
          { id: 'c2', label: 'Begründung in Worten', weight: 40, description: 'Nachvollziehbare Erklärung der Schritte' },
          { id: 'c3', label: 'Sprache & Zeichen', weight: 20, description: 'Klarheit, Fachbegriffe, saubere Darstellung' },
        ],
        minWords: 60,
        maxWords: 400,
        allowLoops: true,
      };
      const definition = createDefinition({ template: 'worksheet', locale, title });
      definition.items = [item];
      return normalizeActivity(definition);
    },
  },
];

export function writingTemplate(id) {
  return WRITING_TEMPLATES.find((tpl) => tpl.id === id) || null;
}
