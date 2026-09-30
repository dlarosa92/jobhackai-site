// Exercise the shipped auth functions without bootstrapping Firebase or a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const plans = ['free', 'trial', 'essential', 'pro', 'premium', 'pending', 'weekly', 'monthly', 'pack'];
const quietConsole = { log() {}, warn() {}, error() {} };

function sourceRange(path, startMarker, endMarker) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Cannot locate runtime functions in ${path}`);
  return source.slice(start, end);
}

function authStateHarness(source, { plan, devPlan = plan, cookiePlan = null, authenticated = true, logout = false } = {}) {
  const values = new Map([['user-plan', plan], ['dev-plan', devPlan]]);
  const ctx = {
    console: quietConsole,
    window: cookiePlan ? {} : { FirebaseAuthManager: { getCurrentUser: () => authenticated ? { uid: 'fixture-user' } : null } },
    sessionStorage: { getItem: key => key === 'logout-intent' && logout ? '1' : null },
    localStorage: { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) },
    getAuthPlanValue: key => values.get(key) ?? null,
    hasStoredAuthenticatedFlag: () => false,
    hasFirebaseAuthPersistence: () => false,
    parseCrossDomainCookies: () => cookiePlan ? { plan: cookiePlan } : null,
    getUrlAuthHandoff: () => null,
    hasCrossDomainLogoutCookie: () => false,
    hasCrossDomainAuthCookie: () => Boolean(cookiePlan),
    hasUrlAuthHandoff: () => false,
    isRealAuthReady: () => true,
    navLog() {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.getAuthState();
}

function cookieHarness(source, hostname = 'jobhackai.io') {
  const writes = [];
  const document = {};
  Object.defineProperty(document, 'cookie', { set: value => writes.push(value) });
  const ctx = { document, window: { location: { hostname } } };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { writes, setAuthCookies: ctx.setAuthCookies };
}

for (const [label, directory] of [['app', '../../js'], ['marketing', '../js']]) {
  // Execute complete, unchanged function bodies; only platform dependencies are stubbed.
  const authSource = sourceRange(`${directory}/navigation.js`, 'function getAuthState() {', 'function setAuthState(');
  const cookieSource = sourceRange(`${directory}/firebase-auth.js`, 'const PROD_COOKIE_HOSTS =', 'function clearAuthCookies() {');

  for (const plan of plans) {
    test(`${label}: signed-in ${plan} remains intact in navigation auth state`, () => {
      const state = authStateHarness(authSource, { plan });
      assert.equal(state.isAuthenticated, true);
      assert.equal(state.userPlan, plan);
      assert.equal(state.devPlan, plan);
    });

    test(`${label}: cross-domain ${plan} wins over stale free storage`, () => {
      const state = authStateHarness(authSource, { plan: 'free', cookiePlan: plan });
      assert.equal(state.isAuthenticated, true);
      assert.equal(state.userPlan, plan);
    });

    test(`${label}: ${plan} survives shared-cookie serialization`, () => {
      const h = cookieHarness(cookieSource);
      h.setAuthCookies(` ${plan.toUpperCase()} `);
      assert.ok(h.writes.includes(`jhai_plan=${plan}; domain=.jobhackai.io; path=/; max-age=2592000; SameSite=Lax; Secure`));
      assert.ok(h.writes.includes('jhai_auth=1; domain=.jobhackai.io; path=/; max-age=2592000; SameSite=Lax; Secure'));
    });
  }

  test(`${label}: unknown stored plans fall back to free, not arbitrary privileges`, () => {
    const state = authStateHarness(authSource, { plan: 'unknown-plan' });
    assert.equal(state.userPlan, 'free');
    assert.equal(state.devPlan, null);
  });

  test(`${label}: stored paid plan never authenticates a signed-out user`, () => {
    const state = authStateHarness(authSource, { plan: 'monthly', authenticated: false });
    assert.equal(state.isAuthenticated, false);
    assert.equal(state.userPlan, null);
  });

  test(`${label}: logout intent overrides a paid cross-domain signal`, () => {
    const state = authStateHarness(authSource, { plan: 'monthly', cookiePlan: 'monthly', logout: true });
    assert.equal(state.isAuthenticated, false);
    assert.equal(state.userPlan, null);
  });

  test(`${label}: invalid cookie plans remain free and unverified users stay unverified`, () => {
    for (const plan of ['unknown-plan', 'monthly; injected=1', '', null]) {
      const h = cookieHarness(cookieSource);
      h.setAuthCookies(plan, false);
      assert.ok(h.writes.some(value => value.startsWith('jhai_plan=free;')));
      assert.ok(h.writes.some(value => value.startsWith('jhai_auth=0;')));
      assert.ok(h.writes.every(value => !value.includes('injected=1')));
    }
  });

  test(`${label}: development, QA and previews never write production auth cookies`, () => {
    for (const hostname of ['dev.jobhackai.io', 'qa.jobhackai.io', 'localhost', 'preview.pages.dev']) {
      const h = cookieHarness(cookieSource, hostname);
      h.setAuthCookies('monthly');
      assert.equal(h.writes.length, 0, hostname);
    }
  });
}
