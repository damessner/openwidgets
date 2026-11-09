// Spec 07 — print view (task 5g):
// /teacher/print?activity=… renders the worksheet without app chrome and
// contains the item text; the answer-key toggle reveals solutions.
import { test, expect } from '@playwright/test';
import { loginAsAdmin, mcItem, seedPublishedActivity, shortAnswerItem, uniqueLabel } from './_helpers.js';

const MC_STEM = 'Welche Farbe hat der Himmel an einem klaren Tag?';

test.describe('Druckansicht', () => {
  test('Arbeitsblatt drucken: kein App-Header, Aufgabentexte vorhanden', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const title = uniqueLabel('E2E Druck');
    const { activity } = await seedPublishedActivity(page.request, {
      title,
      items: [
        mcItem({ id: 'it_print_mc', stem: MC_STEM }),
        shortAnswerItem({ id: 'it_print_short', stem: 'Nenne ein Edelgas.' }),
      ],
    });

    await page.goto(`/teacher/print?activity=${activity.id}`);

    // Print route renders without the teacher app chrome (the print view adds a
    // body class and hides the header/footer via CSS).
    await expect(page.locator('.print-sheet')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#app-header')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/print-view/);

    // Worksheet content: title, item stems, type labels.
    const sheet = page.locator('.print-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('.print-doc-title')).toHaveText(title);
    await expect(page.locator('article.print-item')).toHaveCount(2);
    await expect(page.locator('.print-item-stem').first()).toHaveText(MC_STEM);
    await expect(sheet).toContainText('Nenne ein Edelgas.');
    await expect(sheet).toContainText('Multiple Choice');

    // Solution key is hidden by default and revealed by the toolbar toggle.
    const answerToggle = page.locator('.print-toolbar label.switch input[type="checkbox"]');
    await expect(answerToggle).not.toBeChecked();
    const keyBefore = await page.locator('.print-answer-key, .print-choice-correct').count();
    expect(keyBefore).toBe(0);
    await page.locator('.print-toolbar label.switch').click();
    await expect(answerToggle).toBeChecked();
    await expect(page.locator('.print-answer-key').first()).toBeVisible();
    await expect(page.locator('.print-choice-correct').first()).toBeVisible();

    // Emulated print media keeps the sheet (no app chrome in either mode).
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-doc-title')).toBeVisible();
    await expect(page.locator('.print-toolbar')).toBeHidden();
  });
});
