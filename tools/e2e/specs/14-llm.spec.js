// E2E for the LLM features (v0.9): teacher AI wizard, admin LLM settings
// (against the mock LLM on :4189), and the student AI feedback card.
import { test, expect } from '@playwright/test';
import { loginAsAdmin, seedPublishedActivity, uniqueLabel, mcItem } from './_helpers.js';

test.describe('LLM integration', () => {
  test('teacher: KI-Assistent generates a draft worksheet and opens the editor', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    await page.goto('/teacher');

    const aiButton = page.locator('button.ai-wizard-button', { hasText: 'Mit KI erstellen' });
    await expect(aiButton).toBeVisible();
    await aiButton.click();

    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('KI-Assistent');
    await dialog.locator('#ai-topic').fill('Fotosynthese der Pflanzen');
    await dialog.locator('#ai-subject').fill('Biologie');
    await dialog.locator('input[name="ai-length"][value="short"]').check();
    await dialog.locator('input[name="ai-mix"][value="simple"]').check();
    await dialog.locator('button[type="submit"]', { hasText: 'Generieren' }).click();

    // navigates to the editor with the generated draft
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 60_000 });
    await expect(page.locator('body')).toContainText('Fotosynthese', { timeout: 30_000 });
  });

  test('admin: LLM settings card shows masked key and connection test works', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);
    await page.goto('/teacher/admin');

    const card = page.locator('.card', { hasText: 'KI / LLM' });
    await expect(card).toBeVisible();
    // env-provided key is masked (placeholder), never shown in clear
    await expect(card.locator('input[type="password"]')).toHaveValue('');
    await expect(card.locator('input[type="password"]')).toHaveAttribute('placeholder', /^e2e-.*cdef$/);
    await expect(page.locator('body')).not.toContainText('e2e-mock-key-abcdef');

    await card.locator('button', { hasText: 'Verbindung testen' }).click();
    await expect(card).toContainText('Verbindung OK', { timeout: 20_000 });
  });

  test('student: after submit the AI feedback card shows summary + exercise', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const mcId = 'it_llm_mc';
    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E KI-Feedback'),
      items: [
        mcItem({
          id: mcId,
          points: 1,
          stem: 'Welche Farbe hat der Himmel an einem klaren Tag?',
          choices: [
            { id: 'c1', text: 'Blau', correct: true },
            { id: 'c2', text: 'Grün', correct: false },
          ],
        }),
      ],
    });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('KI-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator(`.student-item[data-item-id="${mcId}"]`);
    await expect(card).toBeVisible();
    await card.locator('.item-choice', { hasText: 'Blau' }).click();

    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();

    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });

    // AI feedback card: generate summary (mock LLM), then summary + exercise appear
    const aiCard = student.locator('.ai-feedback-card');
    await expect(aiCard).toBeVisible();
    await aiCard.locator('button', { hasText: 'Zusammenfassung erstellen' }).click();
    await expect(aiCard).toContainText('Du hast die Grundlagen verstanden', { timeout: 30_000 });
    await expect(aiCard.locator('.ai-exercise')).toHaveCount(1);
    await expect(aiCard.locator('.ai-exercise')).toContainText('Fotosynthese');
    await context.close();
  });
});
