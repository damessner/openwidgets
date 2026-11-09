// Spec 08 — security smoke (task 5h):
// unauthenticated teacher routes/APIs are rejected with a usable UX, and a
// bogus join code produces a friendly error instead of a crash/blank page.
import { test, expect } from '@playwright/test';
import { BASE_URL } from './_helpers.js';

test.describe('Sicherheits-Smoke-Test', () => {
  test('unangemeldet: /teacher/dashboard endet auf /login', async ({ page }) => {
    await page.goto('/teacher/dashboard');
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await expect(page.locator('#login-form')).toBeVisible();
    // The original target is preserved for the post-login redirect.
    expect(decodeURIComponent(page.url())).toContain('/teacher/dashboard');
    // No teacher chrome/secret data leaked on the login page.
    await expect(page.locator('#app-header')).toHaveCount(0);
    await expect(page.locator('#view')).toHaveCount(0);
  });

  test('unangemeldet: Lehrer-APIs antworten 401', async ({ request }) => {
    for (const apiPath of ['/api/activities', '/api/assignments', '/api/admin/users', '/api/me']) {
      const response = await request.get(apiPath);
      expect(response.status(), `${apiPath} must require a session`).toBe(401);
      const body = await response.text();
      // Teacher data never leaks: a 401 body is an error envelope, not a list.
      expect(body).not.toContain('"activities"');
      expect(body).not.toContain('"assignments"');
      expect(body).not.toContain('"users"');
    }

    // Student endpoints require a participant token.
    const participant = await request.get('/api/participant');
    expect(participant.status()).toBe(401);
  });

  test('ungültiger Beitrittscode zeigt eine freundliche Fehlermeldung', async ({ page }) => {
    await page.goto('/a/ZZZZZZ');
    await expect(page.locator('.student-error-title')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.student-error-title')).toHaveText('Code ungültig');
    await expect(page.locator('.student-error-message')).toContainText(/keine Aufgabe|Code/i);
    // The page stays usable (no JS crash / empty #app) and no join form appears.
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.locator('#join-name')).toHaveCount(0);
  });

  test('ungültiges Codeformat wird clientseitig abgefangen', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/a/123');
    await expect(page.locator('.student-error-title')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.student-error-title')).toHaveText('Code ungültig');
    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('API-Basis ohne Session liefert keine Aktivitäten', async ({ page }) => {
    // A fresh context must not be able to read teacher data through fetch().
    await page.goto('/login');
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/activities', { headers: { Accept: 'application/json' } });
      return response.status;
    });
    expect(status).toBe(401);
  });
});
