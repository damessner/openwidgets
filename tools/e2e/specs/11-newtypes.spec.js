// Spec 11 — new item types (v0.6): Hotspot/TipToi, Tabelle, Gruppieren,
// Satz markieren, Audio-Antwort.
//  1. Authoring UI: the palette offers all five new types and their editors
//     mount in the real teacher editor without errors.
//  2. Student flow: a seeded Hotspot item is answered by tapping the correct
//     zone (feedback popup appears), the `correct` flag never leaks into the
//     student payload, and both items score full marks after submit.
import { test, expect } from '@playwright/test';
import { createItem } from '../../../shared/items/index.js';
import { BASE_URL, loginAsAdmin, seedPublishedActivity, uniqueLabel } from './_helpers.js';

// 320x200 PNG: sky, green ground, a brown "bird" rectangle at x 210..270, y 40..90.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAACI0lEQVR42u3bMQ2AMBRF0SppkNIRGcjAATaqqDJYaoK1Y8f/yUmOgpfc8ZVnTCCpYgIQMCBgQMAgYEDAgIABAYOAAQEDAgYBAwIGBAwIGAQMCBgQMCBgEDAgYEDAIGBAwICAAQGDgAEBAwIGBAwCBgQMCBgEDAgYEDAgYBAwIGBAwCR1n0c6AgYBCxgBC1jACFjAIGABI2ABCxgBCxgELGAQsIARsIAFjIAFDAIWMAhYwAhYwAJGwAIGAQsYAQtYwAhYwCDg1dvrPgEjYAELGAELGAQsYBCwgBGwgAWMgAUMAhYwAhawgBGwgEHAAgYBCxgBC1jACFjA4E7oTggCFjACFrCAEbCAQcACRsACFjACFjAIWMAgYAEjYAELGAELGAQsYAQsYAEjYAGDgAUMAhYwAhawgBGwgIHABAwCBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgYEDAgYBAwIGBAwIGAQMCBgQMCAgEHAgIABAYOAAQEDAgYEDAIGBAwIGARsBRAwIGBAwCBgQMCAgAEBg4ABAQMCBgEDAgYEDAgYBAwIGBAwIGD4R8BXb0BSAgYBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAQcCAgAEBAwIGAQMCBgQMAgYEDAgYBAwIGBAwIGD4R8BXb0BSAgYBAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAQcBACB/QuH9WRTLRggAAAABJRU5ErkJggg==';

function hotspotItem(assetId) {
  const item = createItem('hotspot', { id: 'it_e2e_hotspot', points: 2 });
  item.stem = 'Wo ist der Vogel?';
  item.config = {
    image: { assetId, alt: 'Landschaft mit Vogel' },
    prompt: { text: 'Tippe den Vogel im Bild an.', audioAssetId: '' },
    zones: [
      {
        id: 'z_bird',
        label: 'Vogel',
        shape: 'rect',
        x: 210 / 320,
        y: 40 / 200,
        w: 60 / 320,
        h: 50 / 200,
        correct: true,
        feedback: { text: 'Richtig! Das ist der Vogel.', imageAssetId: '', audioAssetId: '' },
        link: { type: 'none', value: '' },
      },
      {
        id: 'z_ground',
        label: 'Wiese',
        shape: 'rect',
        x: 0.05,
        y: 0.8,
        w: 0.3,
        h: 0.15,
        correct: false,
        feedback: { text: 'Hier ist kein Vogel.', imageAssetId: '', audioAssetId: '' },
        link: { type: 'none', value: '' },
      },
    ],
  };
  return item;
}

function markSentenceItem() {
  const item = createItem('mark_sentence', { id: 'it_e2e_mark', points: 1 });
  item.stem = 'Markiere das Tier im Satz.';
  item.config = {
    mode: 'mark',
    words: [
      { text: 'Der', target: 'none', fix: '' },
      { text: 'Vogel', target: 'mark', fix: '' },
      { text: 'singt', target: 'none', fix: '' },
      { text: 'schön.', target: 'none', fix: '' },
    ],
  };
  return item;
}

test.describe('Neue Aufgabentypen (v0.6)', () => {
  test('Palette und Editoren: alle fünf neuen Typen lassen sich anlegen', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/teacher\/dashboard/);

    const title = uniqueLabel('E2E Neue Typen');
    await page.getByRole('button', { name: /Neue Aktivität/ }).first().click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await page.fill('#new-activity-title', title);
    await dialog.locator('button[type="submit"]').click();
    await page.waitForURL(/\/teacher\/edit\?id=/, { timeout: 20_000 });
    await expect(page.locator('.editor-heading')).toBeVisible({ timeout: 20_000 });

    // Teacher UI runs in German in the e2e context (de-AT locale).
    const newTypes = [
      { palette: 'Hotspot-Bild', badge: 'Hotspot-Bild (TipToi)', editor: '.hs-zone-card' },
      { palette: 'Tabelle', badge: 'Tabelle (ausfüllen / Matrix)', editor: '.tbl-editor' },
      { palette: 'In Zonen gruppieren', badge: 'In Zonen gruppieren (Drag & Drop)', editor: '.grp-item-row' },
      { palette: 'Satz markieren', badge: 'Satz markieren / Wörter streichen', editor: '.ms-chip' },
      { palette: 'Audio-Antwort', badge: 'Audio-Antwort (Aufnahme)', editor: '.item-config' },
    ];

    for (const entry of newTypes) {
      await page.locator('.palette-button', { hasText: entry.palette }).first().click();
    }
    await expect(page.locator('.item-card')).toHaveCount(5);

    const badges = page.locator('.item-card .item-type-badge');
    for (const entry of newTypes) {
      await expect(badges.filter({ hasText: entry.badge }).first()).toBeVisible();
    }

    // The hotspot editor really mounted (zone card present) and the
    // mark-sentence editor shows its target chips.
    await expect(page.locator('.hs-zone-card').first()).toBeVisible();
    await expect(page.locator('.ms-chip').first()).toBeVisible();
    await expect(page.locator('.tbl-editor').first()).toBeVisible();
    await expect(page.locator('.grp-item-row').first()).toBeVisible();

    // A fresh hotspot is invalid until an image is uploaded (save-error, same
    // as image_boxes) — remove it again so the remaining four defaults save.
    const hotspotCard = page.locator('.item-card').filter({ has: page.locator('.hs-zone-card') });
    await expect(hotspotCard).toHaveCount(1);
    await hotspotCard.getByRole('button', { name: 'Element löschen' }).click();
    await expect(page.locator('.item-card')).toHaveCount(4);

    // Autosave persists the four valid new items server-side.
    const activityId = new URL(page.url()).searchParams.get('id');
    const saveState = page.locator('.save-state');
    await expect(saveState).toHaveClass(/save-saved/, { timeout: 20_000 });
    const activity = await (
      await page.request.get(`/api/activities/${activityId}`)
    ).json();
    const types = activity.activity.definition.items.map((item) => item.type);
    for (const expected of ['table', 'groups', 'mark_sentence', 'audio_answer']) {
      expect(types).toContain(expected);
    }
  });

  test('Hotspot (TipToi) und Satz markieren im Schüler-Flow: tippen, Feedback, volle Punktzahl', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await loginAsAdmin(page);

    // Upload a real image so the hotspot canvas has a non-zero size.
    const upload = await page.request.post('/api/assets?filename=szene.png', {
      data: Buffer.from(PNG_B64, 'base64'),
      headers: { 'content-type': 'image/png' },
    });
    expect(upload.status(), 'upload hotspot image').toBe(201);
    const { asset } = await upload.json();
    expect(asset.id).toBeTruthy();

    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Hotspot'),
      items: [hotspotItem(asset.id), markSentenceItem()],
    });
    expect(assignment.code).toMatch(/^[A-Z2-9]{6}$/);

    // The student payload must never contain the `correct` flag of a zone.
    const joinProbe = await page.request.post('/api/join', {
      data: { code: assignment.code, name: 'Leak-Sonde' },
    });
    expect(joinProbe.status()).toBe(200);
    const rawJoin = await joinProbe.text();
    expect(rawJoin).not.toContain('"correct":true');
    // zone geometry/labels are visible to students; only correctness is secret
    expect(rawJoin).toContain('z_bird');

    // --- fresh student context ---------------------------------------------
    const studentContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
    });
    const student = await studentContext.newPage();
    await student.goto(`/a/${assignment.code}`);
    await expect(student.locator('#join-name')).toBeVisible({ timeout: 20_000 });
    await student.fill('#join-name', uniqueLabel('Hotspot Schüler:in'));
    await student.locator('.student-join-form button[type="submit"]').click();
    await expect(student.locator('.student-player')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-item')).toHaveCount(2);

    // --- hotspot: tap the bird zone ----------------------------------------
    const hotspotCard = student.locator('.student-item[data-item-id="it_e2e_hotspot"]');
    await expect(hotspotCard).toBeVisible();
    await expect(hotspotCard.locator('.item-hotspot-img')).toBeVisible();
    const birdZone = hotspotCard.getByRole('button', { name: 'Vogel' });
    const groundZone = hotspotCard.getByRole('button', { name: 'Wiese' });
    await expect(birdZone).toBeVisible();
    await expect(groundZone).toBeVisible();

    await birdZone.click();
    await expect(birdZone).toHaveAttribute('aria-pressed', 'true');
    // Feedback popup of the tapped zone appears.
    const feedback = hotspotCard.locator('.item-hotspot-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText('Richtig! Das ist der Vogel.');

    // --- mark_sentence: mark the word "Vogel" -------------------------------
    const markCard = student.locator('.student-item[data-item-id="it_e2e_mark"]');
    await expect(markCard).toBeVisible();
    const word = markCard.locator('.item-mark-word', { hasText: 'Vogel' }).first();
    await expect(word).toBeVisible();
    await word.click();
    await expect(word).toHaveClass(/is-selected/);

    // --- autosave ------------------------------------------------------------
    const saveStatus = student.locator('#save-status');
    await expect(saveStatus).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });

    // --- submit --------------------------------------------------------------
    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();

    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-breakdown-row')).toHaveCount(2);
    // Both items answered correctly: 2 + 1 of 3 points = 100 %.
    await expect(student.locator('.student-score-percent')).toContainText('100');

    await studentContext.close();
  });
});
