// Spec 10 — class UX round: create a class with roster names directly in the
// create dialog (credentials dialog with copy/print), statistics matrix on
// the class page, "add to class" checkboxes on the assignment page, and the
// student dashboard with progress bars on the landing page.
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsAdmin, mcItem, seedPublishedActivity, uniqueLabel } from './_helpers.js';

async function jsonOrThrow(response, label) {
  const text = await response.text();
  if (!response.ok()) throw new Error(`${label}: HTTP ${response.status()} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

test.describe('Klassen-UX (v0.5)', () => {
  test('Klasse mit Schüler:innen im Erstellen-Dialog, Statistik, Zuordnung zur Aufgabe', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);

    const assignment = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E UX Quiz'),
      items: [mcItem({ id: 'it_ux1', points: 2, stem: '1+1?', choices: [{ id: 'c1', text: '2', correct: true }, { id: 'c2', text: '3', correct: false }] })],
    });

    // --- create dialog includes the roster field ---------------------------
    await page.goto('/teacher/classes');
    await expect(page.locator('.classes-view')).toBeVisible({ timeout: 20_000 });
    await page.locator('button.btn-primary', { hasText: 'Neue Klasse' }).click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#new-class-names')).toBeVisible();

    const className = uniqueLabel('E2E UX-Klasse');
    await dialog.locator('#new-class-name').fill(className);
    await dialog.locator('#new-class-names').fill('Emma Beispiel\nLukas Test');
    await dialog.locator('button.btn-primary', { hasText: 'Klasse erstellen' }).click();

    // credentials dialog appears (passwords shown once) with copy + print
    const credDialog = page.locator('dialog.modal', { has: page.locator('.roster-cred-table') });
    await expect(credDialog).toBeVisible({ timeout: 20_000 });
    await expect(credDialog.locator('.roster-cred-table tbody tr')).toHaveCount(2);
    await expect(credDialog.locator('button', { hasText: 'Als CSV kopieren' })).toBeVisible();
    await expect(credDialog.locator('button', { hasText: 'Drucken' })).toBeVisible();
    await credDialog.locator('button', { hasText: 'Schließen' }).click();
    await expect(credDialog).toBeHidden();

    // navigated to the class editor; roster shows both students
    await expect(page).toHaveURL(/\/teacher\/class\?id=/);
    await expect(page.locator('.class-edit-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.roster-list .item-order-row')).toHaveCount(2);
    await expect(page.locator('button', { hasText: 'Klassenliste drucken' })).toBeVisible();
    const classId = new URL(page.url()).searchParams.get('id');

    // stats card: no items yet -> hint
    await expect(page.locator('.class-stats-table')).toHaveCount(0);
    await expect(page.locator('.class-edit-view')).toContainText('noch keine Aufgaben');

    // add the published assignment via the items card
    const itemsCard = page.locator('.card', { has: page.locator('.class-item-list') });
    await itemsCard.locator('select#add-item-select').selectOption(assignment.assignment.id);
    await itemsCard.locator('button', { hasText: 'Aufgabe hinzufügen' }).click();
    await expect(page.locator('.class-item-row')).toHaveCount(1, { timeout: 20_000 });

    // stats card now renders the matrix: 2 students x 1 assignment, all open
    const statsTable = page.locator('.class-stats-table');
    await expect(statsTable).toBeVisible({ timeout: 20_000 });
    await expect(statsTable.locator('thead th')).toHaveCount(3); // student + 1 item + total
    await expect(statsTable.locator('tbody tr')).toHaveCount(2);
    await expect(statsTable.locator('tbody tr').first().locator('td.stat-open')).toHaveCount(2);

    // --- assignment page: "In Klassen" checkbox adds the assignment --------
    await page.goto(`/teacher/assignment?id=${encodeURIComponent(assignment.assignment.id)}`);
    await expect(page.locator('.share-card')).toBeVisible({ timeout: 20_000 });
    const classesCard = page.locator('.card', { hasText: 'In Klassen' });
    await expect(classesCard).toBeVisible({ timeout: 20_000 });
    const pill = classesCard.locator('label.checkbox-row', { hasText: className });
    await expect(pill).toBeVisible();
    const checkbox = pill.locator('input[type="checkbox"]');
    // already a member (added via the class editor above)
    await expect(checkbox).toBeChecked();

    // toggle off -> removed from the class
    await checkbox.uncheck();
    await expect.poll(async () => {
      const detail = await jsonOrThrow(await page.request.get(`/api/classes/${classId}`), 'class detail');
      return detail.class.items.map((item) => item.assignmentId);
    }, { timeout: 15_000 }).not.toContain(assignment.assignment.id);

    // toggle on -> added again
    await checkbox.check();
    await expect.poll(async () => {
      const detail = await jsonOrThrow(await page.request.get(`/api/classes/${classId}`), 'class detail');
      return detail.class.items.map((item) => item.assignmentId);
    }, { timeout: 15_000 }).toContain(assignment.assignment.id);
    await expect(checkbox).toBeChecked();
  });

  test('Schüler:innen-Dashboard auf der Startseite: Aufgaben mit Fortschrittsbalken', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);

    const assignment = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Dashboard-Quiz'),
      items: [mcItem({ id: 'it_dash1', points: 2, stem: '2+2?', choices: [{ id: 'c1', text: '4', correct: true }, { id: 'c2', text: '5', correct: false }] })],
    });
    const className = uniqueLabel('E2E Dash-Klasse');
    const created = await jsonOrThrow(await page.request.post('/api/classes', { data: { name: className, orderMode: 'free' } }), 'create class');
    const classId = created.class.id;
    await jsonOrThrow(await page.request.put(`/api/classes/${classId}/items`, { data: { assignmentIds: [assignment.assignment.id] } }), 'items');
    const published = await jsonOrThrow(await page.request.post(`/api/classes/${classId}/publish`, { data: {} }), 'publish');
    const classCode = published.class.code;
    const pupilName = uniqueLabel('Emma Beispiel');
    const roster = await jsonOrThrow(
      await page.request.post(`/api/classes/${classId}/students`, { data: { names: [pupilName] } }),
      'roster',
    );
    const cred = roster.credentials.find((c) => c.name === pupilName);
    expect(cred).toBeTruthy();

    // student logs in via /login (student mode) and lands on the dashboard
    const studentContext = await browser.newContext({ baseURL: BASE_URL, locale: 'de-AT' });
    const student = await studentContext.newPage();
    await student.goto('/login');
    await student.locator('#mode-student').click();
    await student.locator('#email').fill(cred.username);
    await student.locator('#password').fill(cred.password);
    await student.locator('#login-submit').click();
    await expect(student).toHaveURL(/\/$/, { timeout: 20_000 });

    // dashboard lists the class item with a progress bar and an open badge
    const panel = student.locator('#student-panel');
    await expect(panel.locator('.landing-student-item')).toHaveCount(1, { timeout: 20_000 });
    await expect(panel.locator('.landing-student-item .student-progress.sm')).toBeVisible();
    await expect(panel.locator('.landing-class > .row .student-progress:not(.sm)')).toBeVisible();
    // open item: the bar exists but is empty (width 0) with the is-open class
    await expect(panel.locator('.landing-student-item .student-progress-bar')).toHaveClass(/is-open/);
    await expect(panel.locator('.landing-class > .row .student-progress-bar')).toHaveClass(/is-open/);
    await expect(panel.locator('.landing-student-item .badge')).toContainText('offen');
    await expect(panel.locator('.landing-student-item a.btn-primary')).toHaveAttribute('href', new RegExp(`/a/${assignment.assignment.code}\\?c=${classCode}`));

    // the class link in the dashboard opens the class lobby
    await panel.locator('a.btn-secondary', { hasText: 'Öffnen' }).first().click();
    await expect(student).toHaveURL(new RegExp(`/c/${classCode}`));
    await studentContext.close();
  });
});
