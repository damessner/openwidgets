// Spec 03 — student flow in a second, fresh browser context (task 5c):
// join by code → answer the Multiple Choice item → autosave → submit (confirm
// dialog) → result view. Also proves the participant payload carries no answer
// keys (no "correct":true / "accepted" / "hints" before any grading).
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  joinStudent,
  loginAsAdmin,
  longAnswerItem,
  mcItem,
  seedPublishedActivity,
  shortAnswerItem,
  uniqueLabel,
} from './_helpers.js';

const MC_ID = 'it_student_mc';
const MC_STEM = 'Welche Farbe hat der Himmel an einem klaren Tag?';

test.describe('Schüler:innen-Flow', () => {
  test('beitreten, antworten, autosave, abgeben, Ergebnis sehen', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // Seed a small quiz through the teacher API: MC + short answer (has an
    // answer key) + long answer (has hints) so the sanitization assertion has
    // real answer keys to look for in the student payload.
    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Schüler'),
      items: [
        mcItem({
          id: MC_ID,
          points: 2,
          stem: MC_STEM,
          choices: [
            { id: 'c1', text: 'Blau', correct: true },
            { id: 'c2', text: 'Grün', correct: false },
          ],
        }),
        shortAnswerItem({ id: 'it_student_short' }),
        longAnswerItem({ id: 'it_student_long' }),
      ],
    });
    expect(assignment.code).toMatch(/^[A-Z2-9]{6}$/);

    // --- second browser context: fresh storage, no teacher cookie ----------
    const studentContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const student = await studentContext.newPage();

    await student.goto(`/a/${assignment.code}`);
    await expect(student.locator('#join-name')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-join-form')).toBeVisible();

    const studentName = uniqueLabel('Test Schüler:in');
    await student.fill('#join-name', studentName);
    await student.locator('.student-join-form button[type="submit"]').click();

    // Player replaces the join screen.
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.ow-item')).toHaveCount(3);
    await expect(student.locator('#join-name')).toHaveCount(0);
    await expect(student).toHaveURL(new RegExp(`/a/${assignment.code}$`));

    // --- answer-key stripping: join and participant payloads --------------
    // Never send answer keys, accepted answers or long-answer hints to a
    // student. Check both the POST /api/join payload and the participant
    // state fetched in the page (the latter is the payload the player resumes
    // from on reload).
    const joinResponse = await page.request.post('/api/join', {
      data: { code: assignment.code, name: 'Leak-Sonde' },
    });
    expect(joinResponse.status()).toBe(200);
    const rawJoinPayload = await joinResponse.text();
    expect(rawJoinPayload).not.toContain('"correct":true');
    expect(rawJoinPayload).not.toContain('"accepted"');
    expect(rawJoinPayload).not.toContain('"hints"');
    expect(rawJoinPayload).not.toContain('verdunstung'); // long-answer hint text
    expect(rawJoinPayload).not.toContain('Helium'); // short-answer accepted value

    // (After grading, legitimate result values may contain "correct":true —
    // that is why this runs on the freshly joined, unanswered state.)
    const initialPayload = await student.evaluate(async (code) => {
      const token = localStorage.getItem(`ow_pt_${String(code).toUpperCase()}`);
      const response = await fetch('/api/participant', {
        headers: token ? { 'X-Participant-Token': token } : {},
      });
      return { status: response.status, tokenPresent: !!token, body: await response.text() };
    }, assignment.code);
    expect(initialPayload.tokenPresent, 'participant token stored in localStorage').toBe(true);
    expect(initialPayload.status).toBe(200);
    expect(initialPayload.body).not.toContain('"correct":true');
    expect(initialPayload.body).not.toContain('"accepted"');
    expect(initialPayload.body).not.toContain('"hints"');
    expect(initialPayload.body).not.toContain('rubric');
    expect(initialPayload.body).not.toContain('correctIds');

    // --- answer the MC item by clicking the choice label -------------------
    const mcItemCard = student.locator(`.student-item[data-item-id="${MC_ID}"]`);
    await expect(mcItemCard).toBeVisible();
    const choice = mcItemCard.locator('.item-choice', { hasText: 'Blau' });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice.locator('input')).toBeChecked();

    // Autosave indicator: "Speichern …" while the PUT is in flight, then
    // "Gespeichert" once the server confirmed it.
    const saveStatus = student.locator('#save-status');
    await expect(saveStatus).toBeVisible();
    await expect(saveStatus).toHaveAttribute('data-state', 'saving', { timeout: 5_000 });
    await expect(saveStatus).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    await expect(saveStatus).toContainText('Gespeichert');

    // Server-side proof: the response was stored and still carries no keys.
    const afterAnswerPayload = await student.evaluate(async (code) => {
      const token = localStorage.getItem(`ow_pt_${String(code).toUpperCase()}`);
      const response = await fetch('/api/participant', { headers: { 'X-Participant-Token': token } });
      return await response.text();
    }, assignment.code);
    expect(afterAnswerPayload).toContain(MC_ID);
    expect(afterAnswerPayload).not.toContain('"accepted"');
    expect(afterAnswerPayload).not.toContain('"hints"');
    expect(afterAnswerPayload).not.toContain('correctIds');
    expect(afterAnswerPayload).not.toContain('missingIds');
    expect(afterAnswerPayload).not.toContain('wrongIds');

    // --- submit: button → confirmation dialog → result ---------------------
    const submitButton = student.locator('[data-submit]').first();
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/abgeben/i);
    // 3 scoreable items, 1 answered → the warning must count the remaining 2.
    await expect(dialog).toContainText('2 unbeantwortete');
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();

    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-result-title')).toHaveText('Abgegeben!');
    await expect(student.locator('.student-breakdown')).toBeVisible();
    // The answered MC item shows a per-item state, the total is rendered.
    await expect(student.locator('.student-breakdown-row')).toHaveCount(3);
    await expect(student.locator('.student-score')).toBeVisible();

    // After submit the assignment is closed for further attempts. The server
    // marks a submitted attempt as "graded" immediately when no response needs
    // manual grading; with unanswered manual items it may stay "submitted".
    const finalStatus = await student.evaluate(async (code) => {
      const token = localStorage.getItem(`ow_pt_${String(code).toUpperCase()}`);
      const response = await fetch('/api/participant', { headers: { 'X-Participant-Token': token } });
      const data = await response.json();
      return data && data.participant ? data.participant.status : null;
    }, assignment.code);
    expect(['submitted', 'graded']).toContain(finalStatus);

    await studentContext.close();
  });

  test('zweite:r Schüler:in tritt demselben Code bei (eigene Sitzung)', async ({ page, browser }) => {
    // Two independent anonymous students must be possible for one assignment.
    await loginAsAdmin(page);
    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Zwei Schüler'),
      items: [mcItem({ id: MC_ID, stem: MC_STEM })],
    });

    const first = await joinStudent(assignment.code, uniqueLabel('Erste:r'));
    const second = await joinStudent(assignment.code, uniqueLabel('Zweite:r'));
    expect(first.participant.id).not.toBe(second.participant.id);

    const studentContext = await browser.newContext({ baseURL: BASE_URL, locale: 'de-AT' });
    const student = await studentContext.newPage();
    await student.goto(`/a/${assignment.code}`);
    await expect(student.locator('#join-name')).toBeVisible({ timeout: 20_000 });
    await student.fill('#join-name', uniqueLabel('Dritte:r'));
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });
    await studentContext.close();
  });
});
