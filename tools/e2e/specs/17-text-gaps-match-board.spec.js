// E2E: inline gaps in a Textblock (<<answer>>) render as real inputs in the
// student view and in the teacher preview; match tasks render as a two-column
// connect board where image sides are picture cards without text labels.
import { test, expect } from '@playwright/test';
import { loginAsAdmin, seedPublishedActivity, uniqueLabel } from './_helpers.js';
import { createItem } from '../../../shared/items/index.js';

test.describe('Text gaps + match connect board', () => {
  test('student: <<answer>> in a Textblock becomes an input; correct answer scores', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    const textItem = createItem('text', { id: 'it_text', points: 2 });
    textItem.config.text = 'He <<goes>> to the bank. She <<reads|read>> a book.';

    const { activity, assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Text-Lücken'),
      items: [textItem],
    });

    // teacher preview tab shows the gaps as inputs as well
    await page.goto(`/teacher/preview?activity=${activity.id}`);
    await expect(page.locator('.preview-item .ow-item[data-item-type="text"] input.rt-gap')).toHaveCount(2, { timeout: 20_000 });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Lücken-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator('.student-item[data-item-id="it_text"]');
    await expect(card).toBeVisible();
    const gaps = card.locator('input.rt-gap');
    await expect(gaps).toHaveCount(2);
    // the answer is never leaked to the student payload
    await expect(card).not.toContainText('goes>>');
    await gaps.nth(0).fill('goes');
    await gaps.nth(1).fill('reads');
    // let the debounced autosave flush before submitting
    await student.waitForTimeout(1800);

    await student.locator('[data-submit]').first().click();
    const dialog = student.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('button.btn-primary', { hasText: 'Abgeben' }).click();
    await expect(student.locator('.student-result')).toBeVisible({ timeout: 20_000 });
    await expect(student.locator('.student-score-value')).toHaveText('2');
    await context.close();
  });

  test('student: match with pictures — right column shows picture cards once, no text labels', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const { assignment } = await seedPublishedActivity(page.request, {
      title: uniqueLabel('E2E Match-Bilder'),
      items: [
        {
          id: 'it_mimg', type: 'match', points: 2, stem: 'Ordne das Wort dem Bild zu.',
          config: {
            shuffle: false,
            pairs: [
              { id: 'p1', left: { kind: 'text', text: 'Haus' }, right: { kind: 'image', assetId: 'demo-house', alt: 'Haus' } },
              { id: 'p2', left: { kind: 'text', text: 'Baum' }, right: { kind: 'image', assetId: 'demo-tree', alt: 'Baum' } },
            ],
          },
        },
      ],
    });

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/a/${assignment.code}`);
    await student.fill('#join-name', uniqueLabel('Bild-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    const card = student.locator('.student-item[data-item-id="it_mimg"]');
    await expect(card).toBeVisible();
    // words on the left, pictures on the right — each exactly once
    await expect(card.locator('.item-match-col-left .item-match-card')).toHaveCount(2);
    const rightCards = card.locator('.item-match-col-right .item-match-card');
    await expect(rightCards).toHaveCount(2);
    await expect(card.locator('.item-match-col-right img.item-match-img')).toHaveCount(2);
    // picture cards carry no visible text label (alt only as aria-label)
    await expect(card.locator('.item-match-col-right .item-match-text')).toHaveCount(0);
    const rightHouse = card.locator('.item-match-col-right .item-match-card[aria-label="Haus"]');
    const rightTree = card.locator('.item-match-col-right .item-match-card[aria-label="Baum"]');
    await expect(rightHouse).toHaveCount(1);
    await expect(rightTree).toHaveCount(1);

    // connect Haus -> its picture, then Baum -> the other picture
    await card.locator('.item-match-col-left .item-match-card', { hasText: 'Haus' }).click();
    await rightHouse.click();
    await expect(card.locator('.item-match-lines line.item-match-line')).toHaveCount(1);
    await card.locator('.item-match-col-left .item-match-card', { hasText: 'Baum' }).click();
    await rightTree.click();
    await expect(card.locator('.item-match-lines line.item-match-line')).toHaveCount(2);
    await context.close();
  });
});
