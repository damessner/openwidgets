#!/usr/bin/env node
// Single entry point for the OpenWidgets end-to-end suite (`npm run e2e`).
//
//   1. Removes the throwaway data directory used by the suite's own server.
//   2. Fails fast if something else already listens on 127.0.0.1:4188
//      (the config uses reuseExistingServer:false and would otherwise hang).
//   3. Runs the Playwright CLI programmatically and propagates its exit code.
//
// Extra CLI arguments are forwarded to `playwright test`, e.g.
//   node tools/e2e/run.mjs --grep live
//   node tools/e2e/run.mjs specs/03-student.spec.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '.data', 'e2e');
const BASE_URL = 'http://127.0.0.1:4188';

// 1. Fresh database for every run (the server seeds the admin on first boot).
fs.rmSync(DATA_DIR, { recursive: true, force: true });

// 2. Port guard: give a precise error instead of a 30 s webServer timeout.
try {
  const response = await fetch(`${BASE_URL}/api/health`);
  if (response.ok) {
    console.error(
      `[e2e] Port 4188 is already in use (${BASE_URL}/api/health answered). ` +
        'Stop that server or change the port in tools/e2e/playwright.config.mjs.',
    );
    process.exit(1);
  }
} catch {
  // Nothing listening — expected.
}

// 3. Run the installed Playwright CLI with the exact Node binary.
const cli = path.join(HERE, 'node_modules', 'playwright', 'cli.js');
if (!fs.existsSync(cli)) {
  console.error(`[e2e] Playwright CLI not found at ${cli}. Run pnpm/npm install inside tools/e2e first.`);
  process.exit(1);
}

const args = [cli, 'test', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { cwd: HERE, stdio: 'inherit' });

child.on('error', (error) => {
  console.error(`[e2e] Failed to start Playwright: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[e2e] Playwright terminated by signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
