// Spec 09 — classes (Lernpfade): a teacher bundles two published assignments
// into a sequence class; a student joins via /c/<CODE>, sees the lobby with a
// locked second item, submits the first assignment through the class link,
// and the second item unlocks. Also proves direct joins of gated assignments
// are rejected (403 class_required) and that the teacher UI lists/edits the
// class.
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsAdmin, mcItem, seedPublishedActivity, uniqueLabel } from './_helpers.js';

async function jsonOrThrow(response, label) {
  const text = await response.text();
  if (!response.ok()) throw new Error(`${label}: HTTP ${response.status()} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

test.describe('Klassen (Lernpfade)', () => {
  test(' Sequenz-Klasse: Lobby-Sperre, Freischaltung nach Abgabe, Lehrer-UI', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);

    // Two tiny published worksheets, each with one MC item (c1 = correct).
    const first = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Klasse A'),
      items: [
        mcItem({
          id: 'it_cls_a',
          points: 2,
          stem: 'Erste Aufgabe: 1+1?',
          choices: [
            { id: 'c1', text: '2', correct: true },
            { id: 'c2', text: '3', correct: false },
          ],
        }),
      ],
    });
    const second = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Klasse B'),
      items: [
        mcItem({
          id: 'it_cls_b',
          points: 2,
          stem: 'Zweite Aufgabe: 2+2?',
          choices: [
            { id: 'c1', text: '4', correct: true },
            { id: 'c2', text: '5', correct: false },
          ],
        }),
      ],
    });

    // Class via API: sequence mode, no min percent, both assignments in order.
    const className = uniqueLabel('E2E Klasse');
    const created = await jsonOrThrow(
      await page.request.post('/api/classes', {
        data: { name: className, description: 'Reihenfolge-Test', orderMode: 'sequence', unlockMinPercent: 0 },
      }),
      'create class',
    );
    await jsonOrThrow(
      await page.request.put(`/api/classes/${created.class.id}/items`, {
        data: { assignmentIds: [first.assignment.id, second.assignment.id] },
      }),
      'set items',
    );
    const published = await jsonOrThrow(
      await page.request.post(`/api/classes/${created.class.id}/publish`, { data: {} }),
      'publish class',
    );
    const classCode = published.class.code;
    expect(classCode).toMatch(/^[A-Z2-9]{6}$/);

    // --- teacher UI: list shows the class with its code --------------------
    await page.goto('/teacher/classes');
    await expect(page.locator('.classes-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.classes-view .card', { hasText: className })).toBeVisible();
    await expect(page.locator('.classes-view .code-chip')).toContainText(classCode);

    // Editor shows both items in order.
    await page.goto(`/teacher/class?id=${created.class.id}`);
    await expect(page.locator('.class-edit-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.class-item-row')).toHaveCount(2);
    await expect(page.locator('.class-item-row').first()).toContainText(first.assignment.title);

    // --- direct join of a gated assignment must fail ------------------------
    const direct = await page.request.post('/api/join', {
      data: { code: second.assignment.code, name: 'Direkt' },
    });
    expect(direct.status()).toBe(403);
    expect((await direct.json()).error.code).toBe('class_required');

    // --- student: class lobby in a fresh browser context --------------------
    const studentContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const student = await studentContext.newPage();

    await student.goto(`/c/${classCode}`);
    await expect(student.locator('.student-join-form')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-join-title')).toContainText(className);

    const pupil = uniqueLabel('Klassen-Schüler:in');
    await student.fill('#join-name', pupil);
    await student.locator('.student-join-form button[type="submit"]').click();

    // Lobby: two items — first open, second locked (no link, disabled button).
    await expect(student.locator('.student-class-items .student-class-item')).toHaveCount(2);
    const firstRow = student.locator('.student-class-item').first();
    const secondRow = student.locator('.student-class-item').nth(1);
    await expect(firstRow.locator('.badge-primary')).toHaveText('Öffnen');
    await expect(secondRow.locator('.badge-danger')).toContainText('Gesperrt');
    await expect(secondRow.locator('a.btn')).toHaveCount(0);
    await expect(secondRow.locator('button:disabled')).toHaveCount(1);
    const openLink = firstRow.locator('a.btn-primary');
    await expect(openLink).toHaveCount(1);
    expect(await openLink.getAttribute('href')).toBe(`/a/${first.assignment.code}?c=${classCode}`);

    // Open the first assignment through the class link.
    await openLink.click();
    await expect(student).toHaveURL(new RegExp(`/a/${first.assignment.code}\\?c=${classCode}$`));
    // Join form is prefilled with the class-join name.
    await expect(student.locator('#join-name')).toHaveValue(pupil);
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });

    // Answer the MC item and submit.
    const card = student.locator('.student-item[data-item-id="it_cls_a"]');
    await expect(card).toBeVisible();
    await card.locator('.item-choice', { hasText: '2' }).click();
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });

    // Result screen offers the way back to the class lobby.
    const backToClass = student.locator('.student-result-actions a', { hasText: 'Zur Klasse' });
    await expect(backToClass).toBeVisible();
    expect(await backToClass.getAttribute('href')).toBe(`/c/${classCode}`);
    await backToClass.click();

    // Lobby now: first done, second open with a working link.
    await expect(student.locator('.student-class-items .student-class-item')).toHaveCount(2);
    await expect(student.locator('.student-class-item').first().locator('.badge-success')).toHaveText('Erledigt');
    const secondRowAfter = student.locator('.student-class-item').nth(1);
    await expect(secondRowAfter.locator('.badge-primary')).toHaveText('Öffnen');
    const secondLink = secondRowAfter.locator('a.btn-primary');
    await expect(secondLink).toHaveCount(1);
    expect(await secondLink.getAttribute('href')).toBe(`/a/${second.assignment.code}?c=${classCode}`);

    // The previously gated assignment now accepts a class-token join via API.
    const classToken = await student.evaluate((code) => localStorage.getItem(`ow_ct_${code}`), classCode);
    expect(classToken).toBeTruthy();
    const joinResponse = await studentContext.request.post('/api/join', {
      data: { code: second.assignment.code, name: pupil, classToken },
    });
    expect(joinResponse.status()).toBe(200);
    const joinJson = await joinResponse.json();
    expect(joinJson.class.code).toBe(classCode);

    await studentContext.close();
  });

  test('Freie Reihenfolge: alle Aufgaben sofort offen', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const first = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Frei A'),
      items: [mcItem({ id: 'it_free_a', points: 1, stem: 'A?', choices: [{ id: 'c1', text: 'Ja', correct: true }, { id: 'c2', text: 'Nein', correct: false }] })],
    });
    const second = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Frei B'),
      items: [mcItem({ id: 'it_free_b', points: 1, stem: 'B?', choices: [{ id: 'c1', text: 'Ja', correct: true }, { id: 'c2', text: 'Nein', correct: false }] })],
    });
    const className = uniqueLabel('E2E Freie Klasse');
    const created = await jsonOrThrow(
      await page.request.post('/api/classes', { data: { name: className, orderMode: 'free' } }),
      'create free class',
    );
    await jsonOrThrow(
      await page.request.put(`/api/classes/${created.class.id}/items`, {
        data: { assignmentIds: [first.assignment.id, second.assignment.id] },
      }),
      'set items',
    );
    const published = await jsonOrThrow(
      await page.request.post(`/api/classes/${created.class.id}/publish`, { data: {} }),
      'publish',
    );

    const studentContext = await browser.newContext({ baseURL: BASE_URL, locale: 'de-AT' });
    const student = await studentContext.newPage();
    await student.goto(`/c/${published.class.code}`);
    await student.fill('#join-name', uniqueLabel('Frei'));
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-class-items .student-class-item')).toHaveCount(2);
    // Free mode: both items open, both carry real links.
    await expect(student.locator('.student-class-item .badge-primary')).toHaveCount(2);
    await expect(student.locator('.student-class-item a.btn-primary')).toHaveCount(2);
    await studentContext.close();
  });
});
