// Shared helpers for the OpenWidgets end-to-end specs.
//
// Teaching notes:
// - Every spec is independent: it logs in as the seeded admin (or a fresh
//   teacher account), creates its own activity/assignment, and tears nothing
//   down (the database is throwaway and deleted by run.mjs before the run).
// - Seeding through the API is intentional where the spec is about another
//   screen (student/live/grade/print); the authoring spec drives the real UI.
import { expect } from '@playwright/test';
import { createDefinition, defaultSettings } from '../../../shared/activity.js';
import { createItem } from '../../../shared/items/index.js';

export const BASE_URL = 'http://127.0.0.1:4188';
export const ADMIN = {
  email: 'admin@e2e.test',
  password: 'e2e-admin-password',
  name: 'E2E Admin',
};

/** Unique, human-readable marker so repeated runs never collide on titles/emails. */
export function uniqueLabel(prefix) {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Teacher login
// ---------------------------------------------------------------------------

/** Sign in through the real login form and wait for the teacher SPA to boot. */
export async function loginAs(page, { email, password } = ADMIN) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-submit');
  await page.waitForURL(/\/teacher\//, { timeout: 20_000 });
  // The SPA renders a loading block first; wait until a view is mounted.
  await page.waitForFunction(
    () => {
      const view = document.querySelector('#view');
      return !!view && view.children.length > 0 && !view.querySelector('.loading-block');
    },
    null,
    { timeout: 20_000 },
  );
}

export async function loginAsAdmin(page) {
  await loginAs(page, ADMIN);
}

/** Wait for the auth guard to bounce an unauthenticated visitor to the login page. */
export async function expectRedirectedToLogin(page, timeout = 20_000) {
  await page.waitForURL(/\/login/, { timeout });
  await expect(page.locator('#login-form')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Item builders (use the same shared modules the server validates with)
// ---------------------------------------------------------------------------

export function mcItem({ id = 'it_qa_mc', points = 2, stem = '', choices } = {}) {
  const item = createItem('multiple_choice', { id, points });
  item.stem = stem;
  item.config = {
    multi: false,
    choices:
      choices ||
      [
        { id: 'c1', text: 'Blau', correct: true },
        { id: 'c2', text: 'Grün', correct: false },
      ],
    shuffle: false,
    partialCredit: true,
  };
  return item;
}

export function shortAnswerItem({ id = 'it_qa_short', points = 1, stem = 'Nenne ein Edelgas.' } = {}) {
  const item = createItem('short_answer', { id, points });
  item.stem = stem;
  item.config = { accepted: ['Helium', 'Neon'], caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true };
  return item;
}

export function longAnswerItem({ id = 'it_qa_long', points = 5, stem = 'Erkläre den Wasserkreislauf.' } = {}) {
  const item = createItem('long_answer', { id, points });
  item.stem = stem;
  item.config = {
    hints: [{ text: 'verdunstung', alternatives: ['verdampfung'], points: 2 }],
    rubric: [{ criterion: 'Fachliche Richtigkeit', levels: [{ label: 'vollständig', points }] }],
    minWords: 0,
    maxWords: 3000,
  };
  return item;
}

// ---------------------------------------------------------------------------
// Seeding through the teacher API (page.request shares the browser cookies)
// ---------------------------------------------------------------------------

async function jsonOrThrow(response, label) {
  const text = await response.text();
  if (!response.ok()) throw new Error(`${label}: HTTP ${response.status()} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** Create a draft activity with a valid definition. Returns the activity row. */
export async function createActivity(request, { title, template = 'worksheet', settings, items = [] } = {}) {
  const created = await jsonOrThrow(
    await request.post('/api/activities', { data: { title, template } }),
    'create activity',
  );
  const activity = created.activity;
  const definition = createDefinition({ template, locale: 'de', title });
  if (settings) definition.settings = { ...defaultSettings(), ...settings };
  definition.items = items;
  const updated = await jsonOrThrow(
    await request.put(`/api/activities/${activity.id}`, {
      data: {
        title,
        description: '',
        template,
        locale: 'de',
        definition,
        revision: activity.revision,
      },
    }),
    'update activity definition',
  );
  return updated.activity;
}

/** Publish an activity and return the created assignment row. */
export async function publishActivity(request, activityId, title) {
  const data = { title: title || undefined };
  const published = await jsonOrThrow(
    await request.post(`/api/activities/${activityId}/publish`, { data }),
    'publish activity',
  );
  return published.assignment;
}

/** Convenience: create + publish an activity with the given items. */
export async function seedPublishedActivity(request, options) {
  const activity = await createActivity(request, options);
  const assignment = await publishActivity(request, activity.id, options.title);
  return { activity, assignment };
}

/** Fetch an activity (with definition) as the logged-in teacher. */
export async function getActivity(request, activityId) {
  return (await jsonOrThrow(await request.get(`/api/activities/${activityId}`), 'get activity')).activity;
}

/** Poll the activity API until `predicate(definition)` is true (autosave proof). */
export async function expectSavedDefinition(request, activityId, predicate, timeout = 20_000) {
  let lastText = '';
  await expect
    .poll(
      async () => {
        const activity = await getActivity(request, activityId);
        lastText = JSON.stringify(activity.definition || {});
        return predicate(activity.definition || {});
      },
      { timeout, message: 'activity definition was not saved as expected' },
    )
    .toBe(true);
  return lastText;
}

// ---------------------------------------------------------------------------
// Student helpers (anonymous sessions, no cookie jar needed)
// ---------------------------------------------------------------------------

async function postJsonWithStatus(path, body, headers = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

/** Join an assignment anonymously; returns the full POST /api/join payload. */
export async function joinStudent(code, name) {
  const { response, json } = await postJsonWithStatus('/api/join', { code, name });
  if (!response.ok) throw new Error(`join failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  return json;
}

/** Save one answer with the participant token. */
export async function saveStudentResponse(token, itemId, responseBody) {
  const response = await fetch(`${BASE_URL}/api/participant/responses/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token },
    body: JSON.stringify({ response: responseBody }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`save response failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** Submit the assignment with the participant token. */
export async function submitStudent(token) {
  const response = await fetch(`${BASE_URL}/api/participant/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Participant-Token': token },
    body: JSON.stringify({ confirm: true }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`submit failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
