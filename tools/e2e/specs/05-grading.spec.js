// Spec 05 — manual grading (task 5e):
// open the grade view for a submitted participant, set a manual score +
// feedback for the long-answer item, save, reload and assert it persisted.
import { test, expect } from '@playwright/test';
import {
  joinStudent,
  loginAsAdmin,
  longAnswerItem,
  mcItem,
  saveStudentResponse,
  seedPublishedActivity,
  submitStudent,
  uniqueLabel,
} from './_helpers.js';

const LONG_ID = 'it_grade_long';
const MC_ID = 'it_grade_mc';
const FEEDBACK = 'Gute Erklärung — die Verdunstung fehlt noch.';

test.describe('Manuelle Bewertung', () => {
  test('Freitext bewerten, speichern, neu laden und Persistenz prüfen', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Bewerten'),
      items: [
        mcItem({ id: MC_ID, points: 2 }),
        longAnswerItem({ id: LONG_ID, points: 5, stem: 'Erkläre den Wasserkreislauf.' }),
      ],
    });

    // A student answers both items and submits.
    const studentName = uniqueLabel('Bewertungs Schüler:in');
    const joined = await joinStudent(assignment.code, studentName);
    await saveStudentResponse(joined.participantToken, MC_ID, { selected: ['c1'] });
    await saveStudentResponse(joined.participantToken, LONG_ID, {
      text: 'Wasser verdunstet, steigt auf, kühlt ab und regnet wieder herunter.',
    });
    await submitStudent(joined.participantToken);

    // --- grade view --------------------------------------------------------
    await page.goto(`/teacher/grade?assignment=${assignment.id}&participant=${joined.participant.id}`);
    await expect(page.locator('.grade-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.grade-item')).toHaveCount(2);
    await expect(page.locator('.grade-view')).toContainText(studentName);

    // The long-answer item always needs manual grading.
    const scoreInput = page.locator(`#manual-score-${LONG_ID}`);
    const feedbackInput = page.locator(`#manual-feedback-${LONG_ID}`);
    await expect(page.locator(`.grade-item[data-item-id="${LONG_ID}"] .manual-grade`)).toBeVisible();
    await expect(scoreInput).toBeVisible();
    await expect(feedbackInput).toBeVisible();

    await scoreInput.fill('3.5');
    await feedbackInput.fill(FEEDBACK);

    const saveButton = page.locator(`.grade-item[data-item-id="${LONG_ID}"] .manual-grade button`, {
      hasText: 'Speichern',
    });
    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes(`/api/participants/${joined.participant.id}/responses/${LONG_ID}`),
        { timeout: 20_000 },
      ),
      saveButton.click(),
    ]);
    expect(patchResponse.status()).toBe(200);

    // Totals update without reload: 2 (MC) + 3.5 (manual) = 5.5 / 7.
    await expect(page.locator('#grade-totals')).toContainText(/5[.,]5\s*\/\s*7/);

    // --- reload: values are persisted server-side --------------------------
    await page.reload();
    await expect(page.locator(`#manual-score-${LONG_ID}`)).toHaveValue('3.5', { timeout: 20_000 });
    await expect(page.locator(`#manual-feedback-${LONG_ID}`)).toHaveValue(FEEDBACK);
    await expect(page.locator('#grade-totals')).toContainText(/5[.,]5\s*\/\s*7/);

    // API-level proof (independent of the UI).
    const review = await (
      await page.request.get(`/api/participants/${joined.participant.id}/review`)
    ).json();
    const longResponse = (review.responses || []).find((entry) => entry.itemId === LONG_ID);
    expect(longResponse, 'long-answer response present in review').toBeTruthy();
    expect(longResponse.manualScore).toBe(3.5);
    expect(longResponse.feedback).toBe(FEEDBACK);
  });
});
