// Spec 06 — admin (task 5f):
// the admin creates a teacher through the UI form, the row appears in the user
// list, and the new teacher can sign in from a second browser context.
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAs, loginAsAdmin, uniqueLabel } from './_helpers.js';

test.describe('Administration', () => {
  test('Lehrkraft über die UI anlegen und in zweitem Kontext anmelden', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    await page.goto('/teacher/admin');
    await expect(page.locator('#view h1.page-title')).toHaveText('Administration', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Benutzer:in anlegen' })).toBeVisible();

    // --- create the teacher through the dialog ----------------------------
    const email = `e2e.lehrkraft.${Date.now().toString(36)}@e2e.test`;
    const password = 'e2e-teacher-password';
    await page.getByRole('button', { name: 'Benutzer:in anlegen' }).click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="text"]').fill('E2E Lehrkraft');
    await expect(dialog.locator('select')).toHaveValue('teacher');
    await dialog.locator('input[type="password"]').fill(password);
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // --- row appears in the user table ------------------------------------
    const row = page.locator('#view tbody tr').filter({ hasText: email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText('E2E Lehrkraft');
    await expect(row).toContainText('Lehrkraft');

    // The new account is really persisted on the server.
    const users = await (await page.request.get('/api/admin/users')).json();
    const created = (users.users || []).find((user) => user.email === email);
    expect(created, 'created teacher in GET /api/admin/users').toBeTruthy();
    expect(created.role).toBe('teacher');

    // --- second context: the new teacher can sign in ----------------------
    const teacherContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const teacherPage = await teacherContext.newPage();
    await loginAs(teacherPage, { email, password });
    await expect(teacherPage).toHaveURL(/\/teacher\/dashboard/);
    await expect(teacherPage.locator('#header-actions')).toContainText('E2E Lehrkraft');
    // Teacher role must not see the admin navigation entry.
    await expect(teacherPage.locator('#app-nav')).not.toContainText('Administration');

    // A teacher who opens the admin URL is refused (role check, not just nav).
    await teacherPage.goto('/teacher/admin');
    await expect(teacherPage.locator('#view')).toContainText(/nur für Administrator/i, {
      timeout: 20_000,
    });

    await teacherContext.close();
  });
});
