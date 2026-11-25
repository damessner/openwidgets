// E2E for the "Texte" (writing tasks with AI feedback) area: template dialog,
// student feedback loop in the player, final feedback in the result view, and
// the teacher monitor. Mock LLM on :4189 answers formative-feedback prompts.
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  loginAsAdmin,
  seedPublishedActivity,
  joinStudent,
  saveStudentResponse,
  submitStudent,
  uniqueLabel,
} from './_helpers.js';
import { createItem } from '../../../shared/items/index.js';

function writingItem({ id = 'it_wr_1', points = 5, allowLoops = true } = {}) {
  const item = createItem('writing', { id, points });
  item.stem = 'Beschreibe deinen Lieblingstag und begründe, warum er dir gefällt.';
  item.config = {
    gradeLevel: '5. Klasse',
    sourceText: 'Ein Tag hat 24 Stunden.',
    criteria: [
      { id: 'c1', label: 'Inhalt', weight: 60, description: 'Bezug zum Thema' },
      { id: 'c2', label: 'Struktur', weight: 40, description: 'Aufbau und Sprache' },
    ],
    minWords: 20,
    maxWords: 300,
    allowLoops,
  };
  return item;
}

async function requestWritingFeedback(token, itemId, text) {
  const response = await fetch(`${BASE_URL}/api/llm/writing-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token },
    body: JSON.stringify({ itemId, text }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`feedback failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

test.describe('Writing tasks (Texte) with AI feedback', () => {
  test('teacher: template dialog creates a writing task and opens the editor', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    await page.goto('/teacher');

    const navLink = page.locator('a[href="/teacher/writing"]', { hasText: 'Texte' });
    await expect(navLink).toBeVisible();
    await navLink.click();
    await page.waitForURL(/\/teacher\/writing/);
    await expect(page.locator('h1.page-title')).toContainText('Schreibaufgaben');

    await page.locator('button.btn-primary', { hasText: 'Neue Schreibaufgabe aus Vorlage' }).click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    const cards = dialog.locator('.writing-template-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await cards.first().locator('button', { hasText: 'Vorlage verwenden' }).click();

    // lands in the editor with the template's writing item (criteria editor visible)
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 30_000 });
    await expect(page.locator('.writing-criteria-editor')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.wr-criterion-row').first()).toBeVisible();
  });

  test('student: interim AI feedback loop, then final feedback in the result view', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const itemId = 'it_wr_loop';
    const title = uniqueLabel('E2E Schreibaufgabe');
    const { assignment } = await seedPublishedActivity(page.request, {
      title,
      items: [writingItem({ id: itemId })],
    });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Schreiber'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator(`.student-item[data-item-id="${itemId}"]`);
    await expect(card).toBeVisible();
    // transparent rubric is shown before writing
    await expect(card.locator('.writing-criteria-overview')).toContainText('Inhalt (60 %)');

    const draft = 'Mein Lieblingstag ist der Samstag, weil ich dann ausschlafen kann und danach mit meinen Freunden Fußball spiele.';
    await card.locator('.writing-textarea').fill(draft);
    await expect(card.locator('.writing-textarea')).toHaveValue(draft);

    await card.locator('.writing-feedback-button').click();
    const feedbackPanel = card.locator('.writing-feedback');
    await expect(feedbackPanel).toContainText('Guter Anfang', { timeout: 30_000 });
    await expect(feedbackPanel.locator('.writing-criterion')).toHaveCount(2);
    await expect(feedbackPanel.locator('.writing-criterion').first()).toContainText('Inhalt');
    await expect(feedbackPanel.locator('.writing-criterion').first()).toContainText('Ergänze ein Beispiel');

    // second loop works as well
    await card.locator('.writing-feedback-button').click();
    await expect(feedbackPanel).toContainText('Zwischenstand 2', { timeout: 30_000 });

    // submit -> result view carries the final feedback
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });

    // open the read-only review ("Antworten ansehen") — final feedback is shown there
    await student.locator('button', { hasText: 'Antworten ansehen' }).click();
    const resultCard = student.locator(`.student-item[data-item-id="${itemId}"]`);
    await expect(resultCard.locator('.writing-feedback')).toContainText('Abschlussfeedback', { timeout: 20_000 });
    await expect(resultCard.locator('.writing-criterion')).toHaveCount(2);
    await context.close();
  });

  test('teacher: monitor shows drafts, loop counts and criteria progress per pupil', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const itemId = 'it_wr_mon';
    const title = uniqueLabel('E2E Schreib-Monitor');
    const { assignment } = await seedPublishedActivity(page.request, {
      title,
      items: [writingItem({ id: itemId })],
    });

    const pupilName = uniqueLabel('Monitor-Schüler');
    const { participantToken } = await joinStudent(assignment.code, pupilName);
    const draft = 'Der Sonntag ist mein Lieblingstag, weil die ganze Familie zusammen isst und wir danach spazieren gehen.';
    await saveStudentResponse(participantToken, itemId, { text: draft });
    const fb = await requestWritingFeedback(participantToken, itemId, draft);
    expect(fb.feedback.loop).toBe(1);
    expect(fb.feedback.criteria.length).toBe(2);
    await requestWritingFeedback(participantToken, itemId, draft + ' Außerdem backt meine Oma Kuchen.');

    // API shape: names visible to the teacher, loops counted
    const monitor = await page.request.get(`/api/writing/monitor/${assignment.id}`);
    expect(monitor.ok()).toBe(true);
    const data = await monitor.json();
    const row = data.participants.find((p) => p.name === pupilName);
    expect(row).toBeTruthy();
    expect(row.items[0].loopCount).toBe(2);
    expect(row.items[0].draft).toContain('Lieblingstag');
    expect(row.items[0].latestFeedback.criteria.length).toBe(2);

    // UI: monitor page renders the pupil card with progress
    await page.goto(`/teacher/writing-monitor?id=${encodeURIComponent(assignment.id)}`);
    const card = page.locator('.writing-monitor-card', { hasText: pupilName });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('.writing-monitor-item')).toContainText('2');
    await expect(card.locator('.writing-draft')).toContainText('Lieblingstag');
  });

  test('student: interim feedback can be disabled per task', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);

    const itemId = 'it_wr_noloop';
    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Schreib-ohne-Loops'),
      items: [writingItem({ id: itemId, allowLoops: false })],
    });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Ohne-Feedback'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator(`.student-item[data-item-id="${itemId}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.writing-feedback-button')).toHaveCount(0);
    await expect(card.locator('.writing-feedback')).toContainText('deaktiviert');
    await context.close();
  });
});
