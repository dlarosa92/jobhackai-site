// Local-only auth funnel regression tests. Auth/provider methods and API traffic
// are intercepted; shipped login, verification, and return-path logic run intact.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = process.env.UI_SOURCE_ROOT || path.resolve(__dirname, '../../..');
const origin = 'http://localhost:4180';
const key = 'jha-auth-tool-return-v1';
const target = '/linkedin-optimizer.html';
const browserType = process.env.AUTH_TEST_BROWSER === 'webkit' ? webkit : chromium;
let helper, browser;
before(async () => {
  const source = fs.readFileSync(path.join(root, 'js/auth-tool-return.js'), 'utf8');
  helper = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  browser = await browserType.launch({ headless: true });
});
after(async () => { await browser?.close(); });
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
function location(search = '') { return { href: origin + '/login.html' + search, search }; }

test('return allowlist accepts only exact tool entry paths', () => {
  for (const tool of ['linkedin-optimizer', 'interview-questions', 'resume-feedback-pro', 'cover-letter-generator', 'mock-interview', 'voice-interview']) {
    for (const suffix of ['', '.html']) assert.equal(helper.safeToolReturnPath('/' + tool + suffix), '/' + tool + suffix);
  }
  for (const value of [null, undefined, 1, {}, [], '', 'linkedin-optimizer.html', 'https://evil.test/linkedin-optimizer.html', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/linkedin-optimizer.html?token=synthetic', '/linkedin-optimizer.html#fragment', '/linkedin-optimizer.html/../login.html', '/../linkedin-optimizer.html', '/%2Flinkedin-optimizer.html', '%2Flinkedin-optimizer.html', '/linkedin-optimizer.html\n', '/api/linkedin/analyze', '/dashboard.html']) {
    assert.equal(helper.safeToolReturnPath(value), null, String(value));
  }
});

test('URL decoding happens once and invalid explicit redirects clear saved intent', () => {
  const s = storage();
  helper.createAuthToolReturn(location('?redirect=%2Flinkedin-optimizer.html'), s, 100);
  assert.ok(s.getItem(key));
  for (const redirect of ['https://evil.test', '//evil.test', '/linkedin-optimizer.html?x=1', '%2Flinkedin-optimizer.html']) {
    s.setItem(key, JSON.stringify({ path: target, createdAt: 100 }));
    const flow = helper.createAuthToolReturn(location('?redirect=' + encodeURIComponent(redirect)), s, 101);
    assert.equal(flow.destination(), '/dashboard.html');
    assert.equal(s.getItem(key), null);
  }
});

test('stored intent expires after 30 minutes and rejects future or malformed records', () => {
  const s = storage();
  const savedAt = 10000;
  for (const [age, expected] of [[0, target], [1799999, target], [1800000, '/dashboard.html'], [-1, '/dashboard.html']]) {
    s.setItem(key, JSON.stringify({ path: target, createdAt: savedAt }));
    assert.equal(helper.createAuthToolReturn(location(), s, savedAt + age).destination(), expected);
  }
  for (const value of ['invalid json', '{}', JSON.stringify({ path: '//evil.test', createdAt: savedAt }), JSON.stringify({ path: target, createdAt: '10000' })]) {
    s.setItem(key, value);
    assert.equal(helper.createAuthToolReturn(location(), s, savedAt).destination(), '/dashboard.html');
  }
});

test('blocked storage does not prevent a safe explicit return or its verification handoff', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const flow = helper.createAuthToolReturn(location('?redirect=' + encodeURIComponent(target)), blocked);
  assert.equal(flow.destination(), target);
  assert.equal(new URL(flow.carryTo('/verify-email.html?sent=1'), origin).searchParams.get('redirect'), target);
  assert.equal(helper.createAuthToolReturn(location(), blocked).destination(), '/dashboard.html');
});

test('consumption clears session state while concurrent callbacks retain the same destination', () => {
  const s = storage();
  const flow = helper.createAuthToolReturn(location('?redirect=' + encodeURIComponent(target)), s);
  assert.equal(flow.destination(), target);
  assert.equal(s.getItem(key), null);
  assert.equal(flow.destination(), target);
  assert.equal(helper.createAuthToolReturn(location(), s).destination(), '/dashboard.html');
});

test('tool intent survives verification and return-to-login links with existing parameters', () => {
  const s = storage();
  const flow = helper.createAuthToolReturn(location('?redirect=' + encodeURIComponent(target)), s);
  const verify = new URL(flow.carryTo('/verify-email.html?sent=1&plan=free'), origin);
  assert.equal(verify.searchParams.get('sent'), '1');
  assert.equal(verify.searchParams.get('plan'), 'free');
  assert.equal(verify.searchParams.get('redirect'), target);
  const verification = helper.createAuthToolReturn(verify, s);
  assert.equal(new URL(verification.carryTo('/login.html?mode=signup'), origin).searchParams.get('redirect'), target);
  assert.equal(verification.destination(), target);
});

test('same-window LinkedIn callback resumes stored intent, ignores callback query, and tolerates import failure', async () => {
  const source = fs.readFileSync(path.join(root, 'app/functions/api/auth/linkedin/callback.js'), 'utf8');
  const start = source.indexOf("let destination = '/dashboard.html';");
  const end = "window.location.href = frontendOrigin + destination;";
  assert.ok(start > 0);
  const code = source.slice(start, source.indexOf(end, start) + end.length);
  const importBoundary = "await import(frontendOrigin + '/js/auth-tool-return.js')";
  assert.ok(code.includes(importBoundary));
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('window', 'frontendOrigin', 'loadHelper', code.replace(importBoundary, "await loadHelper(frontendOrigin + '/js/auth-tool-return.js')"));
  for (const failImport of [false, true]) {
    const s = storage();
    helper.createAuthToolReturn(location('?redirect=' + encodeURIComponent(target)), s);
    const win = { location: { search: '?redirect=https://evil.test', href: origin + '/api/auth/linkedin/callback?code=synthetic' } };
    await run(win, origin, async url => {
      assert.equal(url, origin + '/js/auth-tool-return.js');
      if (failImport) throw Error('synthetic module failure');
      return { createAuthToolReturn: loc => {
        assert.equal(loc.search, '');
        return helper.createAuthToolReturn(loc, s);
      } };
    });
    assert.equal(win.location.href, origin + (failImport ? '/dashboard.html' : target));
  }
});

async function fixture(t, { query = '?redirect=%2Flinkedin-optimizer.html', existing = false, verified = true, storedPlan = null, returningEmail = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(5000);
  t.after(() => context.close());
  const requests = [], errors = [];
  await context.addInitScript(({ existing, verified, storedPlan, returningEmail }) => {
    // A returning user's remembered email selects Login without clicking the
    // explicit form toggle, which deliberately clears an old plan selection.
    if (returningEmail) {
      sessionStorage.setItem('user-authenticated', 'true');
      sessionStorage.setItem('firebase:authUser:fixture:[DEFAULT]', JSON.stringify({ email: 'synthetic@example.test' }));
    }
    if (storedPlan && !sessionStorage.getItem('__fixture_plan_seeded')) {
      sessionStorage.setItem('__fixture_plan_seeded', '1');
      sessionStorage.setItem('selectedPlan', JSON.stringify({ planId: storedPlan, timestamp: Date.now() }));
    }
    const persisted = JSON.parse(sessionStorage.getItem('__fixture_auth') || 'null');
    let user = null;
    const listeners = new Set();
    function signIn(provider = 'password', emailVerified = verified) {
      user = { uid: 'synthetic-auth-user', email: 'synthetic@example.test', emailVerified, provider,
        getIdToken: async () => 'synthetic-auth-token', reload: async () => { user.emailVerified = true; } };
      sessionStorage.setItem('__fixture_auth', JSON.stringify({ provider, emailVerified }));
      for (const listener of listeners) listener(user);
      return { success: true, user, verificationEmailSent: true };
    }
    if (persisted) signIn(persisted.provider, persisted.emailVerified);
    else if (existing) signIn();
    window.__authFixture = {
      getCurrentUser: () => user,
      waitForAuthReady: async () => user,
      isAuthReady: () => true,
      isEmailPasswordUser: u => u?.provider === 'password',
      onAuthStateChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      signIn: async () => signIn(),
      signUp: async () => signIn('password', false),
      signInWithGoogle: async () => signIn('google', true),
      signInWithLinkedIn: async () => signIn('linkedin', true),
      sendVerificationEmail: async () => { throw Error('Fixture must never send an email'); }
    };
    window.FirebaseAuthManager = window.__authFixture;
  }, { existing, verified, storedPlan, returningEmail });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, method: req.method(), body: req.postData(), authorization: req.headers().authorization });
      if (url.pathname === '/api/stripe-checkout') {
        return route.fulfill({ json: { ok: true, url: origin + '/fixture-checkout?plan=' + JSON.parse(req.postData()).plan } });
      }
      if (url.pathname === '/api/billing-status') return route.fulfill({ json: { ok: true, status: 'none' } });
      if (url.pathname === '/api/accept-terms') return route.fulfill({ json: { ok: true } });
      return route.fulfill({ status: 404, json: { error: 'Unexpected fixture API request' } });
    }
    if (url.pathname === '/js/firebase-auth.js') {
      return route.fulfill({ contentType: 'application/javascript', body: 'export default window.__authFixture; export const waitForAuthReady=window.__authFixture.waitForAuthReady; export const AUTH_PENDING={_authPending:true};' });
    }
    if (url.pathname === '/js/analytics.js') return route.fulfill({ contentType: 'application/javascript', body: 'export function identifyUser(){}' });
    if (url.pathname.startsWith('/js/') && !['/js/login-page.js', '/js/auth-tool-return.js', '/js/verify-email.js'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    if (!['/login.html', '/verify-email.html'].includes(url.pathname) && !/^\/(css|js|assets)\//.test(url.pathname)) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local return destination</title>' });
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/login.html' + query);
  return { page, requests, errors };
}

async function emailLogin(page) {
  if (await page.locator('#signupForm').isVisible()) await page.locator('#showLoginLink').click();
  await page.locator('#loginEmail').fill('synthetic@example.test');
  await page.locator('#loginPassword').fill('SyntheticPass123');
  await page.locator('#loginContinueBtn').click();
}

test('verified email login returns to the requested tool without checkout', async t => {
  const { page, requests, errors } = await fixture(t);
  await emailLogin(page);
  await page.waitForURL(origin + target);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('free tool intent supersedes an earlier stored pricing selection', async t => {
  const { page, requests, errors } = await fixture(t, { storedPlan: 'monthly' });
  await emailLogin(page);
  await page.waitForURL(origin + target);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('generic login preserves an earlier stored paid selection when no tool was requested', async t => {
  const { page, requests, errors } = await fixture(t, { query: '', storedPlan: 'monthly', returningEmail: true });
  await emailLogin(page);
  await page.waitForURL('**/fixture-checkout?plan=monthly');
  assert.equal(requests.filter(r => r.path === '/api/stripe-checkout').length, 1);
  assert.deepEqual(errors, []);
});

test('unverified email login retains the tool through verification and verified continuation', async t => {
  const { page, requests, errors } = await fixture(t, { verified: false });
  await emailLogin(page);
  await page.waitForURL('**/verify-email.html?*');
  assert.equal(new URL(page.url()).searchParams.get('redirect'), target);
  await page.locator('#alreadyVerifiedLink').click();
  await page.waitForURL(origin + target);
  assert.deepEqual(requests.map(r => r.path), ['/api/billing-status']);
  assert.deepEqual(errors, []);
});

test('explicit signup mode opens signup and carries the tool after synthetic registration', async t => {
  const { page, requests, errors } = await fixture(t, { query: '?mode=signup&redirect=%2Flinkedin-optimizer.html' });
  assert.equal(await page.locator('#signupForm').isVisible(), true);
  for (const [id, value] of [['firstName', 'Synthetic'], ['lastName', 'Candidate'], ['signupEmail', 'synthetic@example.test'], ['signupPassword', 'SyntheticPass123']]) {
    await page.locator('#' + id).fill(value);
  }
  await page.locator('#acceptTerms').check();
  await page.locator('#signupContinueBtn').click();
  await page.waitForURL('**/verify-email.html?*');
  assert.equal(new URL(page.url()).searchParams.get('redirect'), target);
  assert.ok(requests.every(r => r.path === '/api/accept-terms'));
  assert.deepEqual(errors, []);
});

test('already authenticated users retain tool intent, while hostile redirects fall back to dashboard', async t => {
  for (const [query, expected] of [['?redirect=%2Flinkedin-optimizer.html', target], ['?redirect=https%3A%2F%2Fevil.test', '/dashboard.html']]) {
    const { page, requests, errors } = await fixture(t, { existing: true, query });
    await page.waitForURL(origin + expected);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  }
});

test('a restored verified user keeps an explicit paid plan ahead of tool intent', async t => {
  const { page, requests, errors } = await fixture(t, {
    existing: true,
    query: '?plan=monthly&redirect=%2Flinkedin-optimizer.html'
  });
  await page.waitForURL('**/fixture-checkout?plan=monthly');
  const checkout = requests.filter(r => r.path === '/api/stripe-checkout');
  assert.equal(checkout.length, 1);
  assert.equal(JSON.parse(checkout[0].body).plan, 'monthly');
  assert.equal(checkout[0].authorization, 'Bearer synthetic-auth-token');
  assert.deepEqual(errors, []);
});

test('a restored unverified user verifies before the explicit paid checkout', async t => {
  const { page, requests, errors } = await fixture(t, {
    existing: true,
    verified: false,
    query: '?plan=monthly&redirect=%2Flinkedin-optimizer.html'
  });
  await page.waitForURL('**/verify-email.html?*');
  assert.equal(new URL(page.url()).searchParams.get('redirect'), target);
  assert.equal(requests.filter(r => r.path === '/api/stripe-checkout').length, 0);
  await page.locator('#alreadyVerifiedLink').click();
  await page.waitForURL('**/fixture-checkout?plan=monthly');
  const checkout = requests.filter(r => r.path === '/api/stripe-checkout');
  assert.equal(checkout.length, 1);
  assert.equal(JSON.parse(checkout[0].body).plan, 'monthly');
  assert.equal(checkout[0].authorization, 'Bearer synthetic-auth-token');
  assert.deepEqual(errors, []);
});

for (const provider of ['google', 'linkedin']) {
  test(`${provider} popup completion retains tool intent`, async t => {
    const { page, requests, errors } = await fixture(t);
    await page.locator('#' + provider + 'SignIn').click();
    await page.waitForURL(origin + target);
    assert.ok(requests.every(r => r.path === '/api/accept-terms'));
    assert.deepEqual(errors, []);
  });
}

for (const provider of ['email', 'google', 'linkedin']) {
  test(`fresh paid plan keeps checkout priority over tool return after ${provider} sign-in`, async t => {
    const { page, requests, errors } = await fixture(t, { query: '?plan=monthly&redirect=%2Flinkedin-optimizer.html', returningEmail: provider === 'email' });
    if (provider === 'email') await emailLogin(page);
    else await page.locator('#' + provider + 'SignIn').click();
    await page.waitForURL('**/fixture-checkout?plan=monthly');
    const checkout = requests.filter(r => r.path === '/api/stripe-checkout');
    assert.equal(checkout.length, 1);
    assert.equal(JSON.parse(checkout[0].body).plan, 'monthly');
    assert.equal(checkout[0].authorization, 'Bearer synthetic-auth-token');
    assert.deepEqual(errors, []);
  });
}
