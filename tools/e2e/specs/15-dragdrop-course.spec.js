// E2E for v0.9 authoring/player features: drag & drop fill_blanks (<<n>>),
// editor worksheet preview + palette emojis, vocabulary course generator.
import { test, expect } from '@playwright/test';
import { loginAsAdmin, seedPublishedActivity, createActivity, uniqueLabel } from './_helpers.js';

test.describe('v0.9: drag&drop gaps, worksheet preview, vocab course', () => {
  test('student: drag & drop words from the word box into <<n>> gaps', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E DragDrop'),
      items: [
        {
          id: 'it_dd', type: 'fill_blanks', points: 2, stem: 'Ziehe die Wörter in die Lücken.',
          config: {
            text: 'Der <<1>> sitzt auf dem <<2>>.',
            blanks: { 1: { accepted: ['Hund'] }, 2: { accepted: ['Baum'] } },
            caseSensitive: false,
            mode: 'drag',
            wordBank: ['Hund', 'Baum', 'Vogel'],
          },
        },
      ],
    });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('DD-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator('.student-item[data-item-id="it_dd"]');
    await expect(card).toBeVisible();
    // word box is rendered, gaps are drop zones
    await expect(card.locator('.item-word-box .item-word-chip')).toHaveCount(3);
    await expect(card.locator('.item-blank-gap[data-gap-id="1"]')).toBeVisible();
    await expect(card.locator('.item-blank-gap[data-gap-id="2"]')).toBeVisible();

    // click-to-assign path: tap word, then tap gap (works without HTML5 DnD)
    await card.locator('.item-word-chip', { hasText: 'Hund' }).click();
    await card.locator('.item-blank-gap[data-gap-id="1"]').click();
    await expect(card.locator('.item-blank-gap[data-gap-id="1"] .item-gap-word')).toHaveText(/Hund/);
    await card.locator('.item-word-chip', { hasText: 'Baum' }).click();
    await card.locator('.item-blank-gap[data-gap-id="2"]').click();
    await expect(card.locator('.item-blank-gap[data-gap-id="2"] .item-gap-word')).toHaveText(/Baum/);

    // HTML5 drag path for the distractor word: drag "Vogel" nowhere, but drag Hund again would move it — skip.
    // submit and expect full score
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-score-value')).toHaveText('2');
    await context.close();
  });

  test('teacher editor: preview button opens testable worksheet preview; palette has emojis; add button at bottom', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const activity = await createActivity(page.request, {
      title: uniqueLabel('E2E Vorschau'),
      items: [
        {
          id: 'it_pv', type: 'multiple_choice', points: 1, stem: '2+2?',
          config: { choices: [{ id: 'c1', text: '4', correct: true }, { id: 'c2', text: '5', correct: false }] },
        },
      ],
    });
    await page.goto(`/teacher/edit?id=${activity.id}`);

    // palette entries carry an emoji
    await expect(page.locator('.palette-button .palette-emoji').first()).toBeVisible();
    // add-item button at the bottom of the item list
    await expect(page.locator('.editor-add-bottom')).toBeVisible();

    // worksheet preview button in the toolbar
    await page.locator('.worksheet-preview-button').click();
    const dialog = page.locator('dialog.worksheet-preview-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.preview-item')).toHaveCount(1);
    // answer in the preview, then evaluate locally
    await dialog.locator('.item-choice', { hasText: '4' }).click();
    await dialog.locator('button', { hasText: 'Antworten auswerten' }).click();
    await expect(dialog.locator('span.small.muted')).toContainText('1 / 1');
  });

  test('teacher: vocabulary list generates a multi-level course (drafts + into class sequence)', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const request = page.request;

    const listRes = await request.post('/api/vocab-lists', {
      data: {
        title: uniqueLabel('Unit 5'),
        sourceLang: 'de',
        targetLang: 'en',
        entries: [
          { term: 'Haus', translation: 'house', example: 'Das Haus ist groß.' },
          { term: 'Baum', translation: 'tree', example: 'Der Baum ist hoch.' },
          { term: 'Katze', translation: 'cat', example: 'Die Katze schläft.' },
          { term: 'Hund', translation: 'dog', example: 'Der Hund bellt.' },
        ],
      },
    });
    expect(listRes.status()).toBe(201);
    const list = (await listRes.json()).list;

    // drafts only
    const drafts = await request.post(`/api/vocab-lists/${list.id}/generate-course`, { data: {} });
    expect(drafts.status()).toBe(201);
    const draftBody = await drafts.json();
    expect(draftBody.activities.length).toBe(5); // flashcards, example, translate, translate reverse, final
    expect(draftBody.levelTitles.some((t) => t.includes('Abschluss'))).toBe(true);
    expect(draftBody.classId).toBeFalsy();

    // into a class → sequence
    const classRes = await request.post('/api/classes', { data: { name: uniqueLabel('Kurs-Klasse') } });
    expect(classRes.status()).toBe(201);
    const cls = (await classRes.json()).class;
    const intoClass = await request.post(`/api/vocab-lists/${list.id}/generate-course`, { data: { classId: cls.id } });
    expect(intoClass.status()).toBe(201);
    const body = await intoClass.json();
    expect(body.classId).toBe(cls.id);
    expect(body.assignmentIds.length).toBe(5);

    const classDetail = await request.get(`/api/classes/${cls.id}`);
    const detail = await classDetail.json();
    expect(detail.class.orderMode).toBe('sequence');
    expect(detail.class.items.length).toBe(5);
  });
});
