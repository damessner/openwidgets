// Playwright configuration for the OpenWidgets interactive end-to-end suite.
//
// The suite owns a throwaway server on port 4188 with its own DATA_DIR
// (tools/e2e/.data/e2e) so it never touches a developer instance (e.g. :3999).
// run.mjs deletes the data directory before invoking the Playwright CLI.
//
// Browser: the Chromium download is blocked in this environment, so the suite
// uses the installed Microsoft Edge via `channel: 'msedge'`. Do not set
// PLAYWRIGHT_BROWSERS_PATH — no browsers are downloaded into tools/e2e.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const BASE_URL = 'http://127.0.0.1:4188';

export default defineConfig({
  testDir: './specs',
  // One shared server and one shared database: specs run strictly one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'de-AT',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Mock LLM endpoint (OpenRouter + Gemini dialects) for the LLM specs.
      command: `"${process.execPath}" tools/e2e/mock-llm.mjs`,
      cwd: ROOT,
      env: { MOCK_LLM_PORT: '4189' },
      url: 'http://127.0.0.1:4189/__health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // process.execPath is the exact Node binary running the tests (no `node` on PATH).
      command: `"${process.execPath}" server/index.js`,
      cwd: ROOT,
      env: {
        PORT: '4188',
        HOST: '127.0.0.1',
        DATA_DIR: 'tools/e2e/.data/e2e',
        ADMIN_EMAIL: 'admin@e2e.test',
        ADMIN_PASSWORD: 'e2e-admin-password',
        NODE_ENV: 'test',
        OW_LLM_PROVIDER: 'openrouter',
        OW_LLM_API_KEY: 'e2e-mock-key-abcdef',
        OW_LLM_BASE_URL: 'http://127.0.0.1:4189',
        OW_LLM_MODEL: 'mock/free',
        OW_LLM_ENABLED: '1',
      },
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
