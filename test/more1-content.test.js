// MORE1 revision courses (Unit 1–3): every generated activity must validate,
// each unit is a 10-activity course (Vokabeln, Grammatik, Lesen 1–3, Hören 1–3,
// Schreiben, Exit-Check), each listening carries a teacher read-aloud script,
// and the writing task has a required word box + step hints.
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
    assert.equal(course.activities.length, 12, `${course.courseTitle}: 12 activities (10 + 2 ⭐ bonus)`);
    const kinds = course.activities.map((a) => a.title.split(': ')[1]);
    assert.deepEqual(kinds.slice(0, 10), [
      'Vokabeln', 'Grammatik',
      'Lesen 1', 'Lesen 2', 'Lesen 3',
      'Hören 1', 'Hören 2', 'Hören 3',
      'Schreiben', 'Exit-Check',
    ]);
    assert.ok(kinds[10].startsWith('⭐ Bonus') && kinds[11].startsWith('⭐ Bonus'), 'two bonus activities per unit');
    assert.equal(course.bonusTitles.length, 2);
    assert.ok(course.bonusTitles.every((title) => course.activities.some((a) => a.title === title)), 'bonusTitles match activity titles');
    for (const activity of course.activities) {
      const check = validateActivity(activity);
      assert.ok(check.ok, `${activity.title}: ${JSON.stringify(check.errors)}`);
      assert.ok(activity.items.length > 0, `${activity.title} has items`);
    }
    // sized for ~15–20 minutes per unit course: plenty of items everywhere
    const totalItems = course.activities.reduce((sum, a) => sum + a.items.length, 0);
    assert.ok(totalItems >= 60, `${course.courseTitle} has ${totalItems} items (>= 60)`);
    // bonus rounds use the fun types
    const bonusDump = JSON.stringify(course.activities.slice(10).map((a) => a.items));
    assert.ok(bonusDump.includes('"hangman"') && bonusDump.includes('"crossword"'), `${course.courseTitle} bonus has hangman + crossword`);
    assert.ok(bonusDump.includes('"spell"'), `${course.courseTitle} bonus includes a spelling trainer`);
  }
  // across all units the bonus rounds cover all fun types
  const allBonus = JSON.stringify(buildMore1Courses().flatMap((c) => c.activities.slice(10).flatMap((a) => a.items)));
  for (const type of ['hangman', 'crossword', 'match', 'groups', 'mark_sentence']) {
    assert.ok(allBonus.includes(`"${type}"`), `bonus rounds use ${type}`);
  }
});

test('more1: per-unit item types — vocab quiz, 3 readings, 3 listenings, writing, exit', () => {
  for (const unit of [1, 2, 3]) {
    const course = buildUnitCourse(unit);
    const [vocab, grammar, r1, r2, r3, h1, h2, h3, writing, exit] = course.activities;

    // Vokabeln: one vocabulary item in quiz mode with entries
    assert.equal(vocab.items[0].type, 'vocabulary');
    assert.equal(vocab.items[0].config.mode, 'quiz');
    assert.ok(vocab.items[0].config.entries.length >= 25, 'unit vocab has 25+ entries');

    // Grammatik: fill_blanks / short_answer / multiple_choice / ordering items
    const gTypes = new Set(grammar.items.map((i) => i.type));
    assert.ok(gTypes.has('fill_blanks'), `unit ${unit} grammar uses fill_blanks`);
    assert.ok(grammar.items.length >= 12, `unit ${unit} grammar has 12+ items`);

    // Lesen 1–3: each has one text block (book text) + questions
    for (const [idx, reading] of [r1, r2, r3].entries()) {
      const textItems = reading.items.filter((i) => i.type === 'text');
      assert.equal(textItems.length, 1, `unit ${unit} reading ${idx + 1} has one text block`);
      assert.ok(reading.items.length >= 7, `unit ${unit} reading ${idx + 1} has 6+ questions`);
      assert.ok(reading.items.some((i) => i.type === 'multiple_choice'), `unit ${unit} reading ${idx + 1} has MC questions`);
    }

    // Hören 1–3: first item is the read-aloud script (teacher-marked), then questions
    for (const [idx, listening] of [h1, h2, h3].entries()) {
      const script = listening.items[0];
      assert.equal(script.type, 'text');
      assert.ok(/VORLESETEXT/i.test(script.config.text), `unit ${unit} listening ${idx + 1} script is marked for the teacher`);
      assert.ok(listening.items.length >= 7, `unit ${unit} listening ${idx + 1} has 6+ questions`);
    }

    // Schreiben: writing item with criteria + word box + hints
    assert.equal(writing.items[0].type, 'writing');
    assert.ok(writing.items[0].config.criteria.length >= 3, 'writing has criteria');
    assert.equal(writing.items[0].config.allowLoops, true, 'AI feedback loops enabled');
    assert.ok((writing.items[0].config.requiredWords || []).length >= 5, 'writing has a required word box');
    assert.equal((writing.items[0].config.hints || []).length, 3, 'writing has 3 step hints');

    // Exit-Check: quiz template, 15 typed items
    assert.equal(exit.template, 'quiz');
    assert.equal(exit.items.length, 15, 'exit check has 15 items');
    assert.ok(exit.items.every((i) => i.type === 'short_answer' || i.type === 'fill_blanks' || i.type === 'multiple_choice'), 'exit check is typed answers');
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
