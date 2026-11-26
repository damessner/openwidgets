// E2E for "courses within classes": teacher sees course sections in the class
// editor (create/rename/delete, move assignments between courses), the pupil
// class lobby groups assignments under course headers with progress.
import { test, expect } from '@playwright/test';
import { loginAsAdmin, seedPublishedActivity, uniqueLabel, mcItem } from './_helpers.js';

async function makeClassWithCourses(request, { courseTitles = ['Unit 1 — Time for School', 'Unit 2 — At the Zoo'] } = {}) {
  const { assignment: a1 } = await seedPublishedActivity(request, {
    title: uniqueLabel('Kurs A'),
    items: [mcItem({ id: 'ca1', stem: 'Frage A?' })],
  });
  const { assignment: a2 } = await seedPublishedActivity(request, {
    title: uniqueLabel('Kurs B'),
    items: [mcItem({ id: 'cb1', stem: 'Frage B?' })],
  });
  const created = await request.post('/api/classes', {
    data: { name: uniqueLabel('Kurs-Klasse'), description: '', orderMode: 'sequence', unlockMinPercent: 0 },
  });
  const classId = (await created.json()).class.id;
  const courseIds = [];
  for (const title of courseTitles) {
    const res = await request.post(`/api/classes/${classId}/courses`, { data: { title } });
    courseIds.push((await res.json()).class.courses.find((c) => c.title === title).id);
  }
  await request.put(`/api/classes/${classId}/items`, {
    data: { items: [{ assignmentId: a1.id, courseId: courseIds[0] }, { assignmentId: a2.id, courseId: courseIds[1] }] },
  });
  const pub = await request.post(`/api/classes/${classId}/publish`, { data: {} });
  const code = (await pub.json()).class.code;
  return { classId, code, a1, a2, courseIds };
}

test.describe('Courses within classes', () => {
  test('teacher: class editor shows course sections and can add a course', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const { classId } = await makeClassWithCourses(page.request);

    await page.goto(`/teacher/class?id=${encodeURIComponent(classId)}`);
    await expect(page.locator('.course-section')).toHaveCount(2);
    await expect(page.locator('.course-title-input').first()).toHaveValue('Unit 1 — Time for School');
    await expect(page.locator('.course-title-input').nth(1)).toHaveValue('Unit 2 — At the Zoo');
    // each course section lists its assignment
    await expect(page.locator('.course-section').first().locator('.class-item-row')).toHaveCount(1);

    // add a third course via the UI
    await page.fill('#new-course-title', 'Unit 3 — Pirates');
    await page.locator('button', { hasText: 'Kurs hinzufügen' }).click();
    await expect(page.locator('.course-section')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('.course-title-input').nth(2)).toHaveValue('Unit 3 — Pirates');

    // move the first assignment into the new course via its select
    const row = page.locator('.course-section').first().locator('.class-item-row').first();
    await row.locator('.item-course-select').selectOption({ label: 'Unit 3 — Pirates' });
    await page.waitForTimeout(1200);
    await expect(page.locator('.course-section').nth(2).locator('.class-item-row')).toHaveCount(1, { timeout: 15_000 });
  });

  test('pupil: class lobby groups assignments under course headers with progress and locks', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    const { code } = await makeClassWithCourses(page.request);

    const context = await browser.newContext();
    const student = await context.newPage();
    await student.goto(`/c/${code}`);
    await student.fill('#join-name', uniqueLabel('Kurs-Schüler'));
    await student.locator('.student-join-form button[type="submit"]').click();

    // course headers with progress badge
    const headers = student.locator('.student-class-course-head');
    await expect(headers).toHaveCount(2);
    await expect(student.locator('.student-class-course-title').first()).toHaveText('Unit 1 — Time for School');
    await expect(student.locator('.student-class-course-title').nth(1)).toHaveText('Unit 2 — At the Zoo');
    await expect(headers.first().locator('.badge')).toContainText('0/1 erledigt');

    // sequence mode: first item open, second locked
    const items = student.locator('.student-class-item');
    await expect(items).toHaveCount(2);
    await expect(items.first().locator('.badge-primary')).toContainText('Öffnen');
    await expect(items.nth(1).locator('.badge-danger')).toContainText('Gesperrt');
    await context.close();
  });
});
