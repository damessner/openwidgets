// Spec 13 — hangman + crossword (v0.8) end to end: palette buttons exist, a
// student plays hangman to a win (server reveals letters via result detail)
// and fills the crossword grid; both score full marks after submit. Also
// proves the answer keys (word / grid letters) never reach the join payload.
import { test, expect } from '@playwright/test';
import { createItem } from '../../../shared/items/index.js';
import { BASE_URL, loginAsAdmin, seedPublishedActivity, uniqueLabel } from './_helpers.js';

function hangmanItem() {
  const item = createItem('hangman', { id: 'it_e2e_hm', points: 4 });
  item.stem = 'Errate das Wort (Hinweis: Wächst im Wald).';
  item.config = { word: 'BAUM', alternatives: [], hint: 'Wächst im Wald', maxAttempts: 6, caseSensitive: false };
  return item;
}

function crosswordItem() {
  const item = createItem('crossword', { id: 'it_e2e_cw', points: 6 });
  item.stem = 'Löse das Kreuzworträtsel.';
  item.config = {
    title: 'Mini-Rätsel',
    words: [
      { id: 'w1', word: 'HAUS', clue: 'Wo wohnt man?', row: 0, col: 0, direction: 'across' },
      { id: 'w2', word: 'AUF', clue: 'Präposition: ___ dem Tisch', row: 0, col: 1, direction: 'down' },
    ],
  };
  return item;
}

test.describe('Galgenmännchen + Kreuzworträtsel (v0.8)', () => {
  test('Palette zeigt beide Typen', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    await page.getByRole('button', { name: /Neue Aktivität/ }).first().click();
    const dialog = page.locator('dialog.modal');
    await page.fill('#new-activity-title', uniqueLabel('E2E HM/CW'));
    await dialog.locator('button[type="submit"]').click();
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 20_000 });
    await expect(page.locator('.palette-button', { hasText: 'Galgenmännchen' })).toBeVisible();
    await expect(page.locator('.palette-button', { hasText: 'Kreuzworträtsel' })).toBeVisible();
    // crossword editor mounts with preview grid
    await page.locator('.palette-button', { hasText: 'Kreuzworträtsel' }).click();
    await expect(page.locator('.cw-editor')).toBeVisible();
    await expect(page.locator('.cw-preview-grid')).toBeVisible();
    await expect(page.locator('.cw-word-row')).toHaveCount(2);
  });

  test('Schüler:in spielt Hangman + Kreuzworträtsel auf volle Punktzahl', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E HM/CW Quiz'),
      items: [hangmanItem(), crosswordItem()],
    });
    expect(assignment.code).toMatch(/^[A-Z2-9]{6}$/);

    // answer keys must not leak into the student payload
    const probe = await page.request.post('/api/join', { data: { code: assignment.code, name: 'Leak-Sonde' } });
    expect(probe.status()).toBe(200);
    const raw = await probe.text();
    expect(raw).not.toContain('"BAUM"'); // hangman word
    expect(raw).not.toContain('"word":"HAUS"'); // crossword words
    expect(raw).toContain('Wächst im Wald'); // hint is the prompt
    expect(raw).toContain('Wo wohnt man?'); // crossword clues are prompts

    const studentContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const student = await studentContext.newPage();
    await student.goto(`/a/${assignment.code}`);
    await expect(student.locator('#join-name')).toBeVisible({ timeout: 20_000 });
    await student.fill('#join-name', uniqueLabel('HM/CW Schüler:in'));
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-item')).toHaveCount(2);

    // --- hangman: click B, A, U, M → won banner after autosave+result -------
    const hmCard = student.locator('.student-item[data-item-id="it_e2e_hm"]');
    await expect(hmCard).toBeVisible();
    for (const ch of ['B', 'A', 'U', 'M']) {
      await hmCard.getByRole('button', { name: ch, exact: true }).click();
    }
    await expect(hmCard.locator('.item-hangman-banner')).toBeVisible({ timeout: 20_000 });
    await expect(hmCard.locator('.item-hangman-banner')).toContainText('Gewonnen');
    // revealed letters shown
    await expect(hmCard.locator('.item-hangman-revealed')).toContainText('A');

    // --- crossword: fill all 6 cells -----------------------------------------
    const cwCard = student.locator('.student-item[data-item-id="it_e2e_cw"]');
    await expect(cwCard).toBeVisible();
    await expect(cwCard.locator('.item-crossword-input')).toHaveCount(6);
    const inputs = cwCard.locator('.item-crossword-input');
    const letters = ['H', 'A', 'U', 'S', 'U', 'F']; // row-major: (0,0..3), (1,1), (2,1)
    for (let i = 0; i < letters.length; i += 1) {
      await inputs.nth(i).fill(letters[i]);
    }
    // clue list visible
    await expect(cwCard.locator('.item-crossword-clue')).toHaveCount(2);

    // autosave settled
    const saveStatus = student.locator('#save-status');
    await expect(saveStatus).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    // --- submit → 100 % -------------------------------------------------------
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-breakdown-row')).toHaveCount(2);
    await expect(student.locator('.student-score-percent')).toContainText('100');

    await studentContext.close();
  });
});
