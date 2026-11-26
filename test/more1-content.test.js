// MORE1 revision courses (Unit 1–3): every generated activity must validate,
// each unit is a 6-activity course (Vokabeln/Grammatik/Lesen/Hören/Schreiben/
// Exit-Check) with the expected item types, and the listening activity carries
// a teacher read-aloud script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActivity } from '../shared/activity.js';
import { buildMore1Courses, buildUnitCourse, MORE1_UNITS } from '../shared/more1-content.js';

test('more1: three unit courses with book titles', () => {
  const courses = buildMore1Courses();
  assert.equal(courses.length, 3);
  assert.deepEqual(
    courses.map((c) => c.courseTitle),
    ['Unit 1 — Time for School', 'Unit 2 — At the Zoo', 'Unit 3 — Pirates'],
  );
  assert.deepEqual(MORE1_UNITS.map((u) => u.unit), [1, 2, 3]);
});

test('more1: every activity of every unit validates and has the expected structure', () => {
  for (const course of buildMore1Courses()) {
    assert.equal(course.activities.length, 6, `${course.courseTitle}: 6 activities`);
    const kinds = course.activities.map((a) => a.title.split(': ')[1]);
    assert.deepEqual(kinds, ['Vokabeln', 'Grammatik', 'Lesen', 'Hören', 'Schreiben', 'Exit-Check']);
    for (const activity of course.activities) {
      const check = validateActivity(activity);
      assert.ok(check.ok, `${activity.title}: ${JSON.stringify(check.errors)}`);
      assert.ok(activity.items.length > 0, `${activity.title} has items`);
    }
  }
});

test('more1: per-unit item types — vocab quiz, writing task with criteria, listening script', () => {
  for (const unit of [1, 2, 3]) {
    const course = buildUnitCourse(unit);
    const [vocab, grammar, reading, listening, writing, exit] = course.activities;

    // Vokabeln: one vocabulary item in quiz mode with entries
    assert.equal(vocab.items[0].type, 'vocabulary');
    assert.equal(vocab.items[0].config.mode, 'quiz');
    assert.ok(vocab.items[0].config.entries.length >= 20, 'unit vocab has 20+ entries');

    // Grammatik: fill_blanks / short_answer / multiple_choice / ordering items
    const gTypes = new Set(grammar.items.map((i) => i.type));
    assert.ok(gTypes.has('fill_blanks'), `unit ${unit} grammar uses fill_blanks`);

    // Lesen: two text blocks (book texts) + questions
    const textItems = reading.items.filter((i) => i.type === 'text');
    assert.equal(textItems.length, 2, `unit ${unit} reading has text A + B`);
    assert.ok(reading.items.some((i) => i.type === 'multiple_choice'), 'reading has MC questions');

    // Hören: first item is the read-aloud script (teacher-marked), then questions
    const script = listening.items[0];
    assert.equal(script.type, 'text');
    assert.ok(/VORLESETEXT/i.test(script.config.text), 'listening script is marked for the teacher');
    assert.ok(listening.items.length > 3, 'listening has questions after the script');

    // Schreiben: writing item with criteria + AI feedback enabled
    assert.equal(writing.items[0].type, 'writing');
    assert.ok(writing.items[0].config.criteria.length >= 3, 'writing has criteria');
    assert.equal(writing.items[0].config.allowLoops, true, 'AI feedback loops enabled');

    // Exit-Check: quiz template with short answers
    assert.equal(exit.template, 'quiz');
    assert.ok(exit.items.every((i) => i.type === 'short_answer' || i.type === 'fill_blanks'), 'exit check is typed answers');
  }
});

test('more1: unit-specific learning goals are covered', () => {
  const grammarDump = (course) => JSON.stringify(course.activities[1].items);
  const u1 = buildUnitCourse(1);
  const g1Text = grammarDump(u1);
  assert.ok(g1Text.includes('babies') && g1Text.includes('children'), 'unit 1 plurals');
  assert.ok(g1Text.includes("Don't speak") && g1Text.includes('Close'), 'unit 1 imperatives');

  const u2 = buildUnitCourse(2);
  const g2Text = grammarDump(u2);
  assert.ok(g2Text.includes('There is') && g2Text.includes('There are'), 'unit 2 there is/are');
  assert.ok(g2Text.includes('next to') && g2Text.includes('behind'), 'unit 2 prepositions');

  const u3 = buildUnitCourse(3);
  const g3Text = grammarDump(u3);
  assert.ok(g3Text.includes('teeth') && g3Text.includes('feet'), 'unit 3 irregular plurals');
  assert.ok(/hasn/i.test(g3Text) && g3Text.includes('has got'), 'unit 3 have/has got');

  // reading texts contain the book content
  assert.ok(u1.activities[2].items[0].config.text.includes('leo10@telfs.at'), 'unit 1 reading text A');
  assert.ok(u2.activities[2].items[0].config.text.includes('Brightside Wildlife Park'), 'unit 2 reading text A');
  assert.ok(u3.activities[2].items[0].config.text.includes('Captain Scarlet'), 'unit 3 reading text A');
});

test('more1: unknown unit throws', () => {
  assert.throws(() => buildUnitCourse(99), /Unknown MORE1 unit/);
});
