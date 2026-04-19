/**
 * Playwright test fixture that restores sessionStorage on every context.
 *
 * Why this exists: Firebase Auth is configured with browserSessionPersistence,
 * so auth shards + tokens live in sessionStorage. Playwright's storageState()
 * only persists cookies + localStorage, so a fresh test context starts with an
 * empty sessionStorage -- Firebase fires onAuthStateChanged(null) and
 * static-auth-guard.js redirects protected pages to /login before the test can
 * interact with them.
 *
 * global-setup.js captures sessionStorage after login into
 * .auth/session-storage.json. This fixture reads that file and injects an
 * addInitScript on each context so sessionStorage is repopulated before page
 * scripts run. Tests that want an unauthenticated context can still pass
 * storageState: undefined to browser.newContext() -- the init script is a
 * no-op when keys are already present and only restores the saved entries,
 * which is fine because those tests explicitly clear storage themselves.
 */

const { test: base, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const sessionStoragePath = path.join(__dirname, '..', '.auth', 'session-storage.json');

function loadSessionStorageFile() {
  try {
    if (!fs.existsSync(sessionStoragePath)) return null;
    const raw = fs.readFileSync(sessionStoragePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.origins)) return null;
    return parsed;
  } catch (err) {
    console.warn('[auth-fixture] Failed to load session-storage.json:', err.message);
    return null;
  }
}

const sessionStorageData = loadSessionStorageFile();

const test = base.extend({
  context: async ({ context }, use) => {
    if (sessionStorageData && sessionStorageData.origins.length > 0) {
      await context.addInitScript((data) => {
        try {
          if (!data || !Array.isArray(data.origins)) return;
          const currentOrigin = window.location.origin;
          // Don't re-hydrate sessionStorage if the user has explicitly logged
          // out in this context (logout writes localStorage['user-authenticated']
          // = 'false' and/or sets 'force-logged-out'). Re-populating Firebase
          // shards here would silently re-authenticate the user in a new tab
          // and break logout tests.
          try {
            if (localStorage.getItem('user-authenticated') === 'false') return;
            const forcedLogoutTs = parseInt(localStorage.getItem('force-logged-out') || '0', 10);
            if (forcedLogoutTs && (Date.now() - forcedLogoutTs) < 60000) return;
          } catch (_) {}
          for (const origin of data.origins) {
            if (!origin || origin.origin !== currentOrigin) continue;
            const entries = Array.isArray(origin.sessionStorage) ? origin.sessionStorage : [];
            for (const entry of entries) {
              if (!entry || typeof entry.name !== 'string') continue;
              try {
                if (sessionStorage.getItem(entry.name) == null) {
                  sessionStorage.setItem(entry.name, entry.value || '');
                }
              } catch (_) { /* storage unavailable */ }
            }
          }
        } catch (_) { /* no-op */ }
      }, sessionStorageData);
    }
    await use(context);
  },
});

module.exports = { test, expect };
