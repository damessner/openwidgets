// Spec 02 — teacher authoring through the real UI (task 5b):
// dashboard "+ Neue Aktivität" → editor → Multiple Choice + Kurze Antwort →
// autosave ("Gespeichert") → publish → 6-character join code + join link.
import { test, expect } from '@playwright/test';
import {
  expectSavedDefinition,
  getActivity,
  loginAsAdmin,
  uniqueLabel,
} from './_helpers.js';

const MC_STEM = 'Welche Farbe hat der Himmel an einem klaren Tag?';
const SHORT_STEM = 'Nenne ein Edelgas.';

test.describe('Authoring und Veröffentlichen', () => {
  test('Aktivität über die UI anlegen, bearbeiten und veröffentlichen', async ({ page }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/teacher\/dashboard/);

    const title = uniqueLabel('E2E Autor');

    // --- create via the dashboard dialog ----------------------------------
    await page.getByRole('button', { name: /Neue Aktivität/ }).first().click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#new-activity-title')).toBeVisible();
    await page.fill('#new-activity-title', title);
    await dialog.locator('button[type="submit"]').click();

    // --- editor route ------------------------------------------------------
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 20_000 });
    const activityId = new URL(page.url()).searchParams.get('id');
    expect(activityId).toBeTruthy();
    await expect(page.locator('.editor-heading')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.palette-button')).toHaveCount(15);

    // --- add a Multiple Choice item from the palette ----------------------
    await page.locator('.palette-button', { hasText: 'Multiple Choice' }).click();
    const mcCard = page.locator('.item-card').first();
    await expect(mcCard).toBeVisible();
    await expect(mcCard.locator('.item-type-badge')).toHaveText('Multiple Choice');

    await mcCard.locator('[id^="stem-"]').fill(MC_STEM);
    const choiceRows = mcCard.locator('.item-config .list-row');
    await expect(choiceRows).toHaveCount(2);
    await choiceRows.nth(0).locator('input[type="text"]').fill('Blau');
    await choiceRows.nth(1).locator('input[type="text"]').fill('Grün');

    // First choice is the correct one by default; make it explicit.
    const correctBox = choiceRows.nth(0).locator('input[type="checkbox"]');
    if (!(await correctBox.isChecked())) await correctBox.check();

    // --- autosave indicator ("Nicht gespeichert" → "Gespeichert") ---------
    const saveState = page.locator('.save-state');
    await expect(saveState).toHaveClass(/save-pending/, { timeout: 5_000 });
    await expect(saveState).toHaveClass(/save-saved/, { timeout: 15_000 });
    await expect(saveState).toContainText('Gespeichert');

    // The indicator is cosmetic — prove the server really has the data.
    await expectSavedDefinition(
      page.request,
      activityId,
      (definition) =>
        definition.items.length === 1 &&
        definition.items[0].type === 'multiple_choice' &&
        definition.items[0].stem === MC_STEM &&
        definition.items[0].config.choices.map((choice) => choice.text).join('|') === 'Blau|Grün' &&
        definition.items[0].config.choices[0].correct === true,
    );

    // --- add a second item (Kurze Antwort) ---------------------------------
    await page.locator('.palette-button', { hasText: 'Kurze Antwort' }).click();
    await expect(page.locator('.item-card')).toHaveCount(2);
    const shortCard = page.locator('.item-card').nth(1);
    await expect(shortCard.locator('.item-type-badge')).toHaveText('Kurze Antwort');
    await shortCard.locator('[id^="stem-"]').fill(SHORT_STEM);

    await expect(saveState).toHaveClass(/save-pending/, { timeout: 5_000 });
    await expect(saveState).toHaveClass(/save-saved/, { timeout: 15_000 });
    await expectSavedDefinition(
      page.request,
      activityId,
      (definition) => definition.items.length === 2 && definition.items[1].type === 'short_answer',
    );

    // --- publish via the toolbar ------------------------------------------
    await page.locator('.editor-toolbar button', { hasText: 'Veröffentlichen' }).click();
    await expect(dialog).toBeVisible();
    const publishTitle = page.locator('#publish-title');
    await expect(publishTitle).toBeVisible();
    await expect(publishTitle).toHaveValue(title);
    await dialog.locator('button[type="submit"]').click();

    // --- success panel: 6-char code + join link ---------------------------
    const codeElement = page.locator('.publish-code-value');
    await expect(codeElement).toBeVisible({ timeout: 15_000 });
    const code = (await codeElement.innerText()).trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const joinLink = dialog.locator('input.mono');
    await expect(joinLink).toHaveValue(new RegExp(`/a/${code}$`));

    // The assignment is visible in the API and open for students.
    const assignmentsBody = await (await page.request.get('/api/assignments')).json();
    const assignment = (assignmentsBody.assignments || []).find((entry) => entry.code === code);
    expect(assignment, 'published assignment appears in GET /api/assignments').toBeTruthy();
    expect(assignment.status).toBe('open');
    expect(assignment.activityId).toBe(activityId);

    // --- final persisted definition ---------------------------------------
    const savedActivity = await getActivity(page.request, activityId);
    expect(savedActivity.status).toBe('published');
    expect(savedActivity.definition.items).toHaveLength(2);
    expect(savedActivity.definition.items[0].stem).toBe(MC_STEM);
    expect(savedActivity.definition.items[1].stem).toBe(SHORT_STEM);

    // Dialog can be dismissed without errors (header close button via aria-label).
    await dialog.getByLabel('Schließen').click();
    await expect(dialog).toBeHidden();
  });
});
