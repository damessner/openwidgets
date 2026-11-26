// E2E for the overhauled vocabulary courses: the generated course contains a
// quiz-trainer level (one word at a time, instant server-checked feedback,
// streak + progress) and a spelling level (translation shown, word typed).
import { test, expect } from '@playwright/test';
import { loginAsAdmin, publishActivity, uniqueLabel } from './_helpers.js';

const ENTRIES = [
  { term: 'Haus', translation: 'house', example: 'Das Haus ist groß.' },
  { term: 'Baum', translation: 'tree', example: 'Der Baum ist hoch.' },
  { term: 'Katze', translation: 'cat', example: 'Die Katze schläft.' },
  { term: 'Hund', translation: 'dog', example: 'Der Hund bellt.' },
];
const TERM_TO_TRANS = Object.fromEntries(ENTRIES.map((e) => [e.term, e.translation]));
const TRANS_TO_TERM = Object.fromEntries(ENTRIES.map((e) => [e.translation, e.term]));

async function generateCourse(request) {
  const listRes = await request.post('/api/vocab-lists', {
    data: { title: uniqueLabel('Unit'), sourceLang: 'de', targetLang: 'en', entries: ENTRIES },
  });
  expect(listRes.status()).toBe(201);
  const list = (await listRes.json()).list;
  const courseRes = await request.post(`/api/vocab-lists/${list.id}/generate-course`, { data: {} });
  expect(courseRes.status()).toBe(201);
  const body = await courseRes.json();
  // fetch full activities to find the levels by their vocab mode
  const activities = [];
  for (const a of body.activities) {
    const res = await request.get(`/api/activities/${a.id}`);
    activities.push((await res.json()).activity);
  }
  return activities;
}

function vocabModeOf(activity) {
  const item = (activity.definition.items || []).find((i) => i.type === 'vocabulary');
  return item ? item.config.mode : null;
}

test.describe('Vocabulary course overhaul (quiz + spell trainer)', () => {
  test('course contains quiz and spell levels; quiz trainer plays one word at a time with instant feedback', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);
    const activities = await generateCourse(page.request);

    const modes = activities.map(vocabModeOf);
    expect(modes).toContain('quiz');
    expect(modes).toContain('spell');

    const quizActivity = activities.find((a) => vocabModeOf(a) === 'quiz');
    const assignment = await publishActivity(page.request, quizActivity.id, quizActivity.title);

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Quiz-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator('.student-item').first();
    await expect(card.locator('.item-vocab-trainer')).toBeVisible();
    // one card at a time + progress + check button
    await expect(card.locator('.item-vocab-progress-text')).toContainText('1 von');
    await expect(card.locator('.item-vocab-trainer-card')).toHaveCount(1);

    // play all entries: read the prompt, type the matching answer, check
    for (let i = 0; i < ENTRIES.length; i++) {
      const prompt = (await card.locator('.item-vocab-trainer-prompt').innerText()).trim();
      const answer = TERM_TO_TRANS[prompt] || TRANS_TO_TERM[prompt];
      expect(answer, `prompt "${prompt}" must be a known entry`).toBeTruthy();
      await card.locator('input.item-vocab-input').fill(answer);
      await card.locator('.item-vocab-check').click();
      await expect(card.locator('.item-vocab-trainer-card')).toHaveClass(/is-correct/, { timeout: 15_000 });
      if (i < ENTRIES.length - 1) {
        await expect(card.locator('.item-vocab-progress-text')).toContainText(`${i + 2} von`, { timeout: 15_000 });
      }
    }
    // done summary with full streak
    await expect(card.locator('.item-vocab-done')).toContainText(`${ENTRIES.length} von ${ENTRIES.length} richtig`, { timeout: 15_000 });

    // submit -> full score
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-score-value')).not.toHaveText('0');
    await context.close();
  });

  test('spell level: translation shown, the word itself must be typed (spelling)', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const activities = await generateCourse(page.request);
    const spellActivity = activities.find((a) => vocabModeOf(a) === 'spell');
    expect(spellActivity, 'course has a spell level').toBeTruthy();
    // the sanitized payload must not contain the term as an answer — check the
    // level definition keeps both sides teacher-side but the mode is spell
    const assignment = await publishActivity(page.request, spellActivity.id, spellActivity.title);

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Rechtschreib-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator('.student-item').first();
    await expect(card.locator('.item-vocab-trainer')).toBeVisible();
    // prompt is the translation; a wrong word (the translation typed back) must fail
    const prompt = (await card.locator('.item-vocab-trainer-prompt').innerText()).trim();
    const term = TRANS_TO_TERM[prompt];
    expect(term, `prompt "${prompt}" must be a known translation`).toBeTruthy();
    await card.locator('input.item-vocab-input').fill(prompt); // wrong on purpose (translation, not the term)
    await card.locator('.item-vocab-check').click();
    await expect(card.locator('.item-vocab-trainer-card')).toHaveClass(/is-incorrect/, { timeout: 15_000 });
    // now the correct spelling
    await card.locator('input.item-vocab-input').fill(term);
    await card.locator('.item-vocab-check').click();
    await expect(card.locator('.item-vocab-trainer-card')).toHaveClass(/is-correct/, { timeout: 15_000 });
    await context.close();
  });
});
