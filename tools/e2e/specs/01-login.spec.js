// Spec 01 — teacher login (task 5a).
// Wrong password must show an inline error and stay on /login; correct
// credentials must land on the teacher dashboard.
import { test, expect } from '@playwright/test';
import { ADMIN, loginAs } from './_helpers.js';

test.describe('Lehrkraft-Login', () => {
  test('falsches Passwort zeigt Fehler und navigiert nicht', async ({ page }) => {
    const responses = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/auth/login')) responses.push(response.status());
    });

    await page.goto('/login');
    await expect(page.locator('#login-form')).toBeVisible();
    await page.fill('#email', ADMIN.email);
    await page.fill('#password', 'definitiv-falsches-passwort');
    await page.click('#login-submit');

    const error = page.locator('#login-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).not.toBeEmpty();

    // No navigation: still the login page, and the auth call was rejected.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#login-form')).toBeVisible();
    expect(responses, 'login API must have answered 401').toContain(401);
  });

  test('richtige Anmeldung landet auf /teacher/dashboard', async ({ page }) => {
    await loginAs(page, ADMIN);
    await expect(page).toHaveURL(/\/teacher\/dashboard/);
    await expect(page.getByRole('button', { name: /Neue Aktivität/ }).first()).toBeVisible();
    // Admin-only navigation is present for the seeded admin.
    await expect(page.locator('#app-nav')).toContainText(/Dashboard|Administration/);
  });
});
