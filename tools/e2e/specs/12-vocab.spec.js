// Spec 12 — vocabulary (v0.7): teacher vocab library UI + `vocabulary` item
// type end to end: palette → editor, list view, and a student answering a
// translate-mode vocab item to full marks.
import { test, expect } from '@playwright/test';
import { createItem } from '../../../shared/items/index.js';
import { BASE_URL, loginAsAdmin, seedPublishedActivity, uniqueLabel } from './_helpers.js';

function vocabItem() {
  const item = createItem('vocabulary', { id: 'it_e2e_vocab', points: 4 });
  item.stem = 'Übersetze die Vokabeln.';
  item.config = {
    mode: 'translate',
    direction: 'term_to_translation',
    shuffle: false,
    caseSensitive: false,
    entries: [
      { id: 'e1', term: 'house', translation: 'Haus', alternatives: ['home'], example: 'The house is big.', imageAssetId: '', audioAssetId: '' },
      { id: 'e2', term: 'tree', translation: 'Baum', alternatives: [], example: '', imageAssetId: '', audioAssetId: '' },
    ],
  };
  return item;
}

test.describe('Vokabeln (v0.7)', () => {
  test('Vokabellisten-UI und Vokabel-Editor in der Palette', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // seed a list through the API so the list view has content
    const listTitle = uniqueLabel('Unit 3');
    const created = await page.request.post('/api/vocab-lists', {
      data: {
        title: listTitle,
        sourceLang: 'en',
        targetLang: 'de',
        entries: [
          { term: 'house', translation: 'Haus', example: 'The house is big.' },
          { term: 'tree', translation: 'Baum' },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const listId = (await created.json()).list.id;

    // nav → vocab list view
    await page.locator('#app-nav a', { hasText: 'Vokabeln' }).click();
    await page.waitForURL(/\/teacher\/vocab$/, { timeout: 20_000 });
    await expect(page.locator('h1.page-title')).toContainText('Vokabellisten');
    await expect(page.locator('.vocab-table')).toBeVisible();
    await expect(page.locator('.vocab-table')).toContainText(listTitle);
    await expect(page.locator('.vocab-table')).toContainText('2'); // entry count

    // open the editor
    await page.locator('.vocab-table a', { hasText: listTitle }).click();
    await page.waitForURL(/\/teacher\/vocab-edit\?id=/, { timeout: 20_000 });
    await expect(page.locator('.vocab-entry-row')).toHaveCount(2);
    await expect(page.locator('.vc-term').first()).toHaveValue('house');
    await expect(page.locator('.vc-trans').first()).toHaveValue('Haus');

    // palette → vocabulary item editor mounts with one default entry
    await page.goto('/teacher/dashboard');
    await page.waitForURL(/\/teacher\/dashboard/, { timeout: 20_000 });
    await page.getByRole('button', { name: /Neue Aktivität/ }).first().click();
    const dialog = page.locator('dialog.modal');
    await page.fill('#new-activity-title', uniqueLabel('E2E Vokabeln'));
    await dialog.locator('button[type="submit"]').click();
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 20_000 });
    await expect(page.locator('.editor-heading')).toBeVisible({ timeout: 20_000 });
    await page.locator('.palette-button', { hasText: 'Vokabeln' }).click();
    await expect(page.locator('.item-card')).toHaveCount(1);
    await expect(page.locator('.item-card .item-type-badge')).toContainText('Vokabeln');
    await expect(page.locator('.vocab-editor')).toBeVisible();
    await expect(page.locator('.vocab-entry-row')).toHaveCount(1);
    // mode select offers the four modes
    await expect(page.locator('.vocab-editor select').first()).toBeVisible();
  });

  test('Schüler:in übersetzt Vokabeln und erreicht volle Punktzahl', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Vokabel-Quiz'),
      items: [vocabItem()],
    });
    expect(assignment.code).toMatch(/^[A-Z2-9]{6}$/);

    // join payload must not leak translations/alternatives
    const probe = await page.request.post('/api/join', {
      data: { code: assignment.code, name: 'Leak-Sonde' },
    });
    expect(probe.status()).toBe(200);
    const raw = await probe.text();
    expect(raw).toContain('"house"'); // term is the prompt
    expect(raw).not.toContain('"Haus"'); // translation stripped
    expect(raw).not.toContain('"home"'); // alternatives stripped
    expect(raw).not.toContain('"Baum"');

    const studentContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const student = await studentContext.newPage();
    await student.goto(`/a/${assignment.code}`);
    await expect(student.locator('#join-name')).toBeVisible({ timeout: 20_000 });
    await student.fill('#join-name', uniqueLabel('Vokabel Schüler:in'));
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });

    const card = student.locator('.student-item[data-item-id="it_e2e_vocab"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.item-vocab-row')).toHaveCount(2);
    // prompts visible, answers hidden
    await expect(card.locator('.item-vocab-row').nth(0)).toContainText('house');
    await expect(card.locator('.item-vocab-row').nth(1)).toContainText('tree');

    const inputs = card.locator('.item-vocab-input');
    await inputs.nth(0).fill('Haus'); // exact
    await inputs.nth(1).fill('baum'); // case-insensitive

    const saveStatus = student.locator('#save-status');
    await expect(saveStatus).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();

    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-breakdown-row')).toHaveCount(1);
    await expect(student.locator('.student-score-percent')).toContainText('100');

    await studentContext.close();
  });
});
