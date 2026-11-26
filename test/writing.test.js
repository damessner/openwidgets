// Writing item type + templates + writing feedback prompt/sanitizer (v0.9.3).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createItem,
  normalizeItem,
  validateItem,
  sanitizeItem,
  normalizeResponse,
  score,
  type,
  findUsedWords,
  MAX_REQUIRED_WORDS,
  MAX_HINTS,
} from '../shared/items/writing.js';
import { validateActivity } from '../shared/activity.js';
import { WRITING_TEMPLATES, writingTemplate } from '../shared/writing-templates.js';
import { buildWritingFeedbackPrompt, sanitizeWritingFeedback } from '../server/llm/prompts.js';

test('writing: createItem + normalize + validate', () => {
  const item = createItem('writing', { id: 'w1', points: 5 });
  assert.equal(item.type, 'writing');
  assert.equal(item.config.criteria.length, 1);
  assert.deepEqual(validateItem(item), []);

  // validateItem checks the raw config (validateActivity normalizes first)
  const bad = {
    id: 'w2', type: 'writing', points: 5,
    config: { criteria: [{ id: 'c1', label: '', weight: 200 }, { id: 'c1', label: 'x', weight: 5 }] },
  };
  const errors = validateItem(bad);
  assert.ok(errors.some((e) => e.includes('label')));
  assert.ok(errors.some((e) => e.includes('weight')));
  assert.ok(errors.some((e) => e.includes('duplicate')));
});

test('writing: sanitize shows labels/weights/source to students, hides descriptions', () => {
  const item = normalizeItem({
    id: 'w3', type: 'writing', points: 5,
    config: {
      gradeLevel: '7. Klasse',
      sourceText: 'Quelltext …',
      criteria: [{ id: 'c1', label: 'Inhalt', weight: 60, description: 'geheime Notiz' }],
      minWords: 50, maxWords: 300, allowLoops: true,
    },
  });
  const safe = sanitizeItem(item);
  assert.equal(safe.config.criteria[0].label, 'Inhalt');
  assert.equal(safe.config.criteria[0].weight, 60);
  assert.ok(!('description' in safe.config.criteria[0]), 'criterion description stays teacher-side');
  assert.equal(safe.config.sourceText, 'Quelltext …');
  assert.ok(!JSON.stringify(safe).includes('geheime Notiz'));
});

test('writing: response + score (manual grading)', () => {
  const item = createItem('writing', { id: 'w4', points: 5 });
  assert.deepEqual(normalizeResponse(item, { text: 'Hallo Welt' }), { text: 'Hallo Welt' });
  const result = score(item, { text: 'egal' });
  assert.equal(result.needsManual, true);
  assert.equal(result.autoScore, 0);
  assert.equal(result.maxScore, 5);
});

test('writing templates: all build valid definitions with one writing item', () => {
  assert.ok(WRITING_TEMPLATES.length >= 5);
  for (const tpl of WRITING_TEMPLATES) {
    const definition = tpl.build({ title: tpl.label.de, locale: 'de' });
    const check = validateActivity(definition);
    assert.ok(check.ok, `${tpl.id}: ${JSON.stringify(check.errors)}`);
    assert.equal(definition.items.length, 1);
    assert.equal(definition.items[0].type, 'writing');
    assert.ok(definition.items[0].config.criteria.length >= 3);
  }
  assert.equal(writingTemplate('leserbrief').id, 'leserbrief');
  assert.equal(writingTemplate('nope'), null);
});

test('writing feedback prompt + sanitizer', () => {
  const criteria = [
    { id: 'c1', label: 'Inhalt', weight: 50, description: 'Argumente' },
    { id: 'c2', label: 'Sprache', weight: 50, description: '' },
  ];
  const { system, user } = buildWritingFeedbackPrompt({
    locale: 'de',
    gradeLevel: '7. Klasse',
    criteria,
    sourceText: 'Ein Text über Wale.',
    text: 'Wale sind cool. Sie leben im Meer.',
    loop: 2,
  });
  assert.ok(system.includes('Inhalt') && system.includes('7. Klasse'));
  assert.ok(user.includes('Wale sind cool'));
  assert.ok(!user.includes('Max Mustermann'));

  const raw = {
    summary: 'Guter Anfang!',
    criteria: [
      { id: 'c1', label: 'Inhalt', met: 0.7, comment: 'Ein Argument fehlt.', tip: 'Nenne ein Beispiel.' },
      { id: 'c2', label: 'Sprache', met: 1.4, comment: 'Top', tip: '' },
      { id: 'cX', label: 'Unbekannt', met: 1, comment: 'x', tip: 'y' }, // not defined -> dropped
    ],
  };
  const fb = sanitizeWritingFeedback(raw, criteria);
  assert.equal(fb.summary, 'Guter Anfang!');
  assert.equal(fb.criteria.length, 2);
  assert.equal(fb.criteria[1].met, 1, 'met clamped to 1');
  assert.throws(() => sanitizeWritingFeedback({}, criteria), /empty/);
});

test('writing: requiredWords + hints normalize, validate and reach the student (sanitize)', () => {
  const item = normalizeItem({
    id: 'w5', type: 'writing', points: 5,
    config: {
      criteria: [{ id: 'c1', label: 'Inhalt', weight: 100 }],
      requiredWords: ['pencil case', '  Nice to meet you ', 'pencil case', 'x'.repeat(50)],
      hints: ['Schritt 1', 'Schritt 2', 'Schritt 3', 'zu viel'],
    },
  });
  assert.deepEqual(item.config.requiredWords, ['pencil case', 'Nice to meet you', 'x'.repeat(40)], 'dedup + trim + cap at 40 chars');
  assert.deepEqual(item.config.hints, ['Schritt 1', 'Schritt 2', 'Schritt 3'], 'max 3 hints');
  assert.deepEqual(validateItem(item), []);

  const safe = sanitizeItem(item);
  assert.deepEqual(safe.config.requiredWords, item.config.requiredWords, 'students see the word box');
  assert.deepEqual(safe.config.hints, item.config.hints, 'students see the hints');

  const tooMany = {
    id: 'w6', type: 'writing', points: 5,
    config: { criteria: [{ id: 'c1', label: 'x', weight: 1 }], requiredWords: Array.from({ length: MAX_REQUIRED_WORDS + 1 }, (_, i) => `w${i}`), hints: Array.from({ length: MAX_HINTS + 1 }, (_, i) => `h${i}`) },
  };
  const errors = validateItem(tooMany);
  assert.ok(errors.some((e) => e.includes('requiredWords')));
  assert.ok(errors.some((e) => e.includes('hints')));
});

test('writing: findUsedWords matches word boundaries, case-insensitive, phrases', () => {
  const words = ['pencil case', 'Favourite', 'glue stick'];
  const text = 'My favourite colour is blue. In my pencil case I have got a glue stick. The PENCIL CASE is blue.';
  const { used, missing } = findUsedWords(text, words);
  assert.deepEqual(used.sort(), ['Favourite', 'glue stick', 'pencil case'].sort());
  assert.deepEqual(missing, []);
  // "pencils" must NOT match "pencil"
  const strict = findUsedWords('I have two pencils here.', ['pencil']);
  assert.deepEqual(strict.used, []);
  assert.deepEqual(strict.missing, ['pencil']);
  // empty text
  const none = findUsedWords('', words);
  assert.deepEqual(none.used, []);
  assert.equal(none.missing.length, 3);
});

test('writing feedback prompt mentions the required word box when present', () => {
  const criteria = [{ id: 'c1', label: 'Inhalt', weight: 100, description: '' }];
  const withWords = buildWritingFeedbackPrompt({ locale: 'de', criteria, text: 'Mein Text …', requiredWords: ['beard', 'treasure'] });
  assert.ok(withWords.system.includes('beard') && withWords.system.includes('treasure'), 'required words are in the system prompt');
  assert.ok(/MUST use/i.test(withWords.system));
  const without = buildWritingFeedbackPrompt({ locale: 'de', criteria, text: 'Mein Text …' });
  assert.ok(!without.system.includes('MUST use'), 'no word-box rule without requiredWords');
});
