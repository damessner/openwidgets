// Spec 04 — teacher live dashboard (task 5d):
// SSE row appears for a student who joins while the dashboard is open, states
// are exposed as text/aria (not colour only), and the anonymize toggles change
// names visually and persist their setting.
import { test, expect } from '@playwright/test';
import {
  joinStudent,
  loginAsAdmin,
  mcItem,
  saveStudentResponse,
  seedPublishedActivity,
  uniqueLabel,
} from './_helpers.js';

const ITEM_ID = 'it_live_mc';

test.describe('Live-Dashboard', () => {
  test('Schüler:in erscheint live, Status als Text/ARIA, Anonymisierung schaltet', async ({ page }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Live'),
      items: [mcItem({ id: ITEM_ID, points: 2, stem: 'Welche Farbe hat der Himmel?' })],
    });

    // Open the dashboard BEFORE the student joins: the row can only appear
    // through the SSE stream (or an SSE-triggered refetch), not an initial load.
    await page.goto(`/teacher/assignment?id=${assignment.id}`);
    const connectionBadge = page.locator('#connection-badge');
    await expect(connectionBadge).toContainText('Live verbunden', { timeout: 20_000 });
    await expect(page.locator('.live-board')).toBeVisible();
    await expect(page.locator('tr.player-row')).toHaveCount(0);

    // --- student joins (anonymous API join) → SSE participant event --------
    const studentName = uniqueLabel('Live Schülerin');
    const joined = await joinStudent(assignment.code, studentName);
    const row = page.locator(`tr.player-row[data-player-id="${joined.participant.id}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('a.player-link')).toContainText(studentName);

    // --- per-item state is exposed as text/ARIA, not colour only -----------
    const stateCell = row.locator('td.item-cell').first();
    await expect(stateCell).toHaveCount(1);
    await expect(stateCell).toHaveAttribute('aria-label', 'Nicht beantwortet');
    await expect(stateCell.locator('.sr-only')).toHaveText('Status: Nicht beantwortet');
    // The legend spells the states out as well.
    await expect(page.locator('.legend')).toContainText(/Richtig/);
    await expect(page.locator('.legend')).toContainText(/Falsch/);
    await expect(page.locator('.legend')).toContainText(/Nicht beantwortet/);

    // --- answering updates the live cell through SSE -----------------------
    await saveStudentResponse(joined.participantToken, ITEM_ID, { selected: ['c1'] });
    await expect(stateCell).toHaveAttribute('aria-label', 'Richtig', { timeout: 20_000 });
    await expect(stateCell).toHaveClass(/state-correct/);
    await expect(stateCell.locator('.sr-only')).toHaveText('Status: Richtig');

    // --- anonymize: real name → pseudonym ----------------------------------
    const toggles = page.locator('.board-toggles label.switch');
    await expect(toggles).toHaveCount(2);
    const anonymizeInput = toggles.nth(0).locator('input[type="checkbox"]');
    const blurInput = toggles.nth(1).locator('input[type="checkbox"]');
    await expect(anonymizeInput).not.toBeChecked();
    await toggles.nth(0).click();
    await expect(anonymizeInput).toBeChecked();
    await expect(row.locator('a.player-link')).not.toContainText(studentName);
    await expect(row.locator('a.player-link')).toContainText(/Schüler:in \d+/);
    expect(await page.evaluate(() => localStorage.getItem('ow_teacher_anonymize'))).toBe('1');

    // --- blur names: visual class change -----------------------------------
    await expect(row.locator('span.player-name')).not.toHaveClass(/is-blurred/);
    await toggles.nth(1).click();
    await expect(blurInput).toBeChecked();
    await expect(row.locator('span.player-name')).toHaveClass(/is-blurred/);
    expect(await page.evaluate(() => localStorage.getItem('ow_teacher_blur_names'))).toBe('1');

    // Both toggles persist across a reload.
    await page.reload();
    await expect(page.locator('#connection-badge')).toContainText('Live verbunden', { timeout: 20_000 });
    const reloadedRow = page.locator(`tr.player-row[data-player-id="${joined.participant.id}"]`);
    await expect(reloadedRow).toBeVisible({ timeout: 20_000 });
    await expect(reloadedRow.locator('span.player-name')).toHaveClass(/is-blurred/);
    await expect(page.locator('.board-toggles input[type="checkbox"]').nth(0)).toBeChecked();

    // The /live API is the single source of truth for the same states.
    const live = await (await page.request.get(`/api/assignments/${assignment.id}/live`)).json();
    const player = (live.players || []).find((entry) => entry.id === joined.participant.id);
    expect(player, 'joined student in /live').toBeTruthy();
    expect(player.items[ITEM_ID]).toBe('correct');
    expect(player.name).toBe(studentName);
  });
});
