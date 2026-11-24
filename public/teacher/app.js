// Teacher SPA shell: auth guard, sticky header, path router and error handling.
// Routes live under /teacher/... (server serves index.html for all of them).
import './messages.js';

import { initLocale, t, onLocaleChange, mountLanguageToggle, getLocale } from '/lib/i18n.js';
import { get, post, ApiError, errorMessage } from '/lib/api.js';
import { h, qs, clear, toast, setPageTitle } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { redirectToLogin, navigate } from './lib/core.js';

import * as dashboardView from './views/dashboard.js';
import * as editorView from './views/editor.js';
import * as assignmentView from './views/assignment.js';
import * as gradeView from './views/grade.js';
import * as adminView from './views/admin.js';
import * as printView from './views/print.js';
import * as classesView from './views/classes.js';
import * as classEditView from './views/class-edit.js';

const ROUTES = [
  { name: 'dashboard', pattern: /^\/teacher\/dashboard\/?$/, view: dashboardView },
  { name: 'edit', pattern: /^\/teacher\/edit\/?$/, view: editorView },
  { name: 'assignment', pattern: /^\/teacher\/assignment\/?$/, view: assignmentView },
  { name: 'grade', pattern: /^\/teacher\/grade\/?$/, view: gradeView },
  { name: 'classes', pattern: /^\/teacher\/classes\/?$/, view: classesView },
  { name: 'class-edit', pattern: /^\/teacher\/class\/?$/, view: classEditView },
  { name: 'admin', pattern: /^\/teacher\/admin\/?$/, view: adminView, adminOnly: true },
  { name: 'print', pattern: /^\/teacher\/print\/?$/, view: printView, chrome: false },
];

const root = qs('#view');
let currentUser = null;
let currentRoute = null;
let currentCleanup = null;
let currentLocaleUnsubs = [];
let abortController = null;
let bootVersion = '';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function initialLetters(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'OW';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const NAV_ITEMS = [
  { route: 'dashboard', href: '/teacher/dashboard', key: 'teacher.nav_dashboard', icon: 'grid' },
  { route: 'classes', href: '/teacher/classes', key: 'teacher.nav_classes', icon: 'list' },
  { route: 'admin', href: '/teacher/admin', key: 'teacher.nav_admin', icon: 'settings', adminOnly: true },
];

function buildNav() {
  const nav = qs('#app-nav');
  if (!nav) return;
  clear(nav);
  for (const item of NAV_ITEMS) {
    if (item.adminOnly && (!currentUser || currentUser.role !== 'admin')) continue;
    const link = h(
      'a',
      { href: item.href, 'data-nav': item.route, 'aria-current': currentRoute === item.route ? 'page' : undefined },
      h('span', { html: icon(item.icon, { size: 16 }) }),
      ' ',
      t(item.key),
    );
    link.classList.toggle('is-active', currentRoute === item.route);
    nav.appendChild(link);
  }
}

function buildUserChip() {
  const actions = qs('#header-actions');
  if (!actions) return;
  const existingLangSlot = actions.querySelector('#lang-slot');
  clear(actions);
  const langSlot = existingLangSlot || h('div#lang-slot');
  actions.appendChild(langSlot);
  if (!existingLangSlot) mountLanguageToggle(langSlot);

  if (currentUser) {
    const chip = h(
      'span.user-chip',
      h('span.avatar', { 'aria-hidden': 'true' }, initialLetters(currentUser.name)),
      h('span.user-chip-name', currentUser.name || currentUser.email || ''),
      currentUser.role === 'admin' ? h('span.badge.badge-primary.tiny', t('teacher.role_admin')) : null,
    );
    actions.appendChild(chip);
  }

  const logout = h(
    'button.btn.btn-ghost.btn-icon.btn-sm',
    {
      type: 'button',
      title: t('common.logout'),
      'aria-label': t('common.logout'),
    },
    h('span', { html: icon('logout', { size: 18 }) }),
  );
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await post('/api/auth/logout');
    } catch {
      /* log out locally anyway */
    }
    window.location.replace('/login');
  });
  actions.appendChild(logout);
}

function updateActiveNav(routeName) {
  document.querySelectorAll('#app-nav a[data-nav]').forEach((link) => {
    const active = link.dataset.nav === routeName;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// ---------------------------------------------------------------------------
// Error rendering
// ---------------------------------------------------------------------------

function renderErrorCard({ title, message, retryLabel, onRetry } = {}) {
  clear(root);
  const retryButton = h(
    'button.btn.btn-primary',
    { type: 'button' },
    retryLabel || t('common.retry'),
  );
  if (typeof onRetry === 'function') retryButton.addEventListener('click', onRetry);
  else retryButton.addEventListener('click', () => render());
  root.appendChild(
    h(
      'div.card.error-card',
      h('h1.error-title', { html: icon('warning', { size: 28 }) }),
      h('h2', title || t('common.error')),
      h('p.muted', message || t('errors.unknown')),
      retryButton,
    ),
  );
}

function renderForbidden() {
  clear(root);
  root.appendChild(
    h(
      'div.card.error-card',
      h('h2', t('errors.forbidden')),
      h('p.muted', t('teacher.admin_only')),
      h('a.btn.btn-primary', { href: '/teacher/dashboard' }, t('teacher.back_to_dashboard')),
    ),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function matchRoute(pathname) {
  for (const route of ROUTES) {
    if (route.pattern.test(pathname)) return route;
  }
  return null;
}

function currentLocationPath() {
  return window.location.pathname + window.location.search;
}

function makeContext(route, controller) {
  const params = new URLSearchParams(window.location.search);
  return {
    user: currentUser,
    params,
    path: currentLocationPath(),
    signal: controller.signal,
    navigate: (path, options) => navigate(path, options),
    setTitle: (title) => setPageTitle(title),
    refresh: () => render(),
    onLocaleChange: (handler) => {
      const unsubscribe = onLocaleChange(handler);
      currentLocaleUnsubs.push(unsubscribe);
      return unsubscribe;
    },
    get version() {
      return bootVersion;
    },
  };
}

function runCleanup() {
  for (const unsubscribe of currentLocaleUnsubs) {
    try {
      unsubscribe();
    } catch {
      /* ignore */
    }
  }
  currentLocaleUnsubs = [];
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (error) {
      if (typeof console !== 'undefined') console.error('view cleanup failed', error);
    }
  }
  currentCleanup = null;
  if (abortController) {
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
    abortController = null;
  }
}

async function render() {
  const pathname = window.location.pathname;
  if (pathname === '/teacher' || pathname === '/teacher/') {
    window.history.replaceState({}, '', '/teacher/dashboard' + window.location.search);
    return render();
  }
  const route = matchRoute(pathname);
  runCleanup();
  // Close any modal dialog left open from the previous view (e.g. after
  // following the "live dashboard" link in the publish dialog).
  document.querySelectorAll('dialog.modal[open]').forEach((dialog) => {
    try {
      dialog.close();
    } catch {
      /* already closed */
    }
  });
  document.body.classList.remove('print-view');
  if (!route) {
    currentRoute = null;
    updateActiveNav(null);
    renderErrorCard({
      title: t('teacher.not_found_title'),
      message: t('teacher.not_found_message'),
      retryLabel: t('teacher.back_to_dashboard'),
      onRetry: () => navigate('/teacher/dashboard', { replace: true }),
    });
    return;
  }
  if (route.adminOnly && (!currentUser || currentUser.role !== 'admin')) {
    currentRoute = route.name;
    renderForbidden();
    return;
  }
  currentRoute = route.name;
  updateActiveNav(route.name);
  // Capture the controller locally: a fast second navigation replaces the
  // module-level one, and the stale mount must not clobber the new view.
  const localController = new AbortController();
  abortController = localController;
  const ctx = makeContext(route, localController);
  if (route.chrome === false) document.body.classList.add('print-view');
  clear(root);
  root.appendChild(
    h(
      'div.loading-block',
      { role: 'status' },
      h('span.spinner', { 'aria-hidden': 'true' }),
      h('span', t('common.loading')),
    ),
  );
  try {
    const result = await route.view.mount(root, ctx);
    if (localController.signal.aborted) return;
    if (typeof result === 'function') currentCleanup = result;
    else if (result && typeof result.destroy === 'function') currentCleanup = () => result.destroy();
  } catch (error) {
    if (localController.signal.aborted) return;
    if (error && error.name === 'AbortError') return;
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      renderForbidden();
      return;
    }
    if (error instanceof ApiError && error.status === 404) {
      renderErrorCard({
        title: t('errors.not_found'),
        message: errorMessage(error),
        retryLabel: t('teacher.back_to_dashboard'),
        onRetry: () => navigate('/teacher/dashboard', { replace: true }),
      });
      return;
    }
    if (typeof console !== 'undefined') console.error(error);
    renderErrorCard({ title: t('common.error'), message: errorMessage(error) });
  }
}

// ---------------------------------------------------------------------------
// Global events
// ---------------------------------------------------------------------------

window.addEventListener('popstate', () => {
  render();
});

window.addEventListener('ow:navigate', () => {
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
});

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link) return;
  if (link.target && link.target !== '_self') return;
  if (link.hasAttribute('download')) return;
  const href = link.getAttribute('href') || '';
  if (!href.startsWith('/teacher')) return;
  event.preventDefault();
  const url = new URL(href, window.location.origin);
  navigate(url.pathname + url.search);
});

window.addEventListener('error', (event) => {
  if (typeof console !== 'undefined') console.error(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  if (error instanceof ApiError && error.status === 401) {
    redirectToLogin();
    return;
  }
  if (typeof console !== 'undefined') console.error(error);
  toast(errorMessage(error), 'error');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

onLocaleChange(() => {
  buildNav();
  buildUserChip();
  if (currentRoute === null) render();
});

async function loadCapabilitiesVersion() {
  try {
    const capabilities = await get('/api/capabilities');
    bootVersion = (capabilities && capabilities.version) || '';
    const slot = qs('#footer-version');
    if (slot && bootVersion) slot.textContent = `v${bootVersion}`;
    if (capabilities && capabilities.demoMode) renderDemoModeBanner();
  } catch {
    /* non-fatal */
  }
}

/** Visible, non-dismissible warning on demo instances (weak password, test data only). */
function renderDemoModeBanner() {
  if (qs('#demo-mode-banner')) return;
  const view = qs('#view');
  const host = view && view.parentElement;
  if (!host) return;
  const english = getLocale() === 'en';
  const banner = h(
    'div.demo-mode-banner',
    { id: 'demo-mode-banner', role: 'status' },
    h('strong', english ? 'Demo mode' : 'Demo-Modus'),
    ' — ',
    english
      ? 'test instance with the weak password "admin". Do not use real pupil data.'
      : 'Testinstanz mit dem schwachen Passwort „admin“. Keine echten Schüler:innen-Daten verwenden.',
  );
  host.insertBefore(banner, view);
}

async function boot() {
  initLocale();
  const initialPath = currentLocationPath();
  try {
    const data = await get('/api/me');
    currentUser = data && data.user;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      window.location.replace('/login?next=' + encodeURIComponent(initialPath));
      return;
    }
    renderErrorCard({ title: t('common.error'), message: errorMessage(error), onRetry: () => window.location.reload() });
    return;
  }
  initLocale(currentUser && currentUser.locale);
  buildNav();
  buildUserChip();
  document.documentElement.lang = getLocale();
  loadCapabilitiesVersion();
  await render();
}

boot();
