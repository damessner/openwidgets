// Shared harness for browser-based verification: boots a throwaway OpenWidgets
// server (temp DATA_DIR, random-ish port), and provides a tiny API client with a
// cookie jar so tests can seed data without clicking through the teacher UI.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_ADMIN = { email: 'admin@e2e.test', password: 'e2e-admin-password', name: 'E2E Admin' };

/** Start `node server/index.js` with an isolated data directory. */
export async function startServer(options = {}) {
  const port = options.port || 4188;
  const dataDir = options.dataDir || path.join(ROOT, 'tools/e2e/.data', `run-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const admin = { ...DEFAULT_ADMIN, ...(options.admin || {}) };

  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ADMIN_EMAIL: admin.email,
      ADMIN_PASSWORD: admin.password,
      ADMIN_NAME: admin.name,
      NODE_ENV: 'test',
      SESSION_TTL_DAYS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        return {
          baseURL,
          port,
          dataDir,
          admin,
          process: child,
          logs: () => output,
          async stop() {
            if (child.exitCode !== null) return;
            child.kill('SIGTERM');
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 3000);
              child.once('exit', () => {
                clearTimeout(timer);
                resolve();
              });
            });
          },
        };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`Server did not become healthy.\n${output}`);
}

/** Minimal JSON API client with cookie handling (teacher session). */
export class ApiClient {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(method, apiPath, body, extraHeaders = {}) {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (method !== 'GET' && cookie) headers.Cookie = cookie;
    else if (cookie) headers.Cookie = cookie;

    const response = await fetch(`${this.baseURL}${apiPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${method} ${apiPath}: ${text.slice(0, 500)}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  get(apiPath) {
    return this.request('GET', apiPath);
  }

  post(apiPath, body) {
    return this.request('POST', apiPath, body);
  }

  put(apiPath, body) {
    return this.request('PUT', apiPath, body);
  }

  patch(apiPath, body) {
    return this.request('PATCH', apiPath, body);
  }

  delete(apiPath) {
    return this.request('DELETE', apiPath);
  }

  async login(email, password) {
    return this.post('/api/auth/login', { email, password });
  }
}

/** Anonymous student client for one assignment. */
export class StudentSession {
  constructor(baseURL, code, token) {
    this.baseURL = baseURL;
    this.code = code;
    this.token = token;
  }

  static async join(baseURL, code, name) {
    const response = await fetch(`${baseURL}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`join failed: ${JSON.stringify(data)}`);
    return new StudentSession(baseURL, code, data.participantToken);
  }

  headers() {
    return { 'Content-Type': 'application/json', 'X-Participant-Token': this.token };
  }

  async getState() {
    const response = await fetch(`${this.baseURL}/api/participant`, { headers: this.headers() });
    const data = await response.json();
    if (!response.ok) throw new Error(`state failed: ${JSON.stringify(data)}`);
    return data;
  }

  async save(itemId, responseBody) {
    const response = await fetch(`${this.baseURL}/api/participant/responses/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ response: responseBody }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(`save failed: ${JSON.stringify(data)}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async submit() {
    const response = await fetch(`${this.baseURL}/api/participant/submit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ confirm: true }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(`submit failed: ${JSON.stringify(data)}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
}
