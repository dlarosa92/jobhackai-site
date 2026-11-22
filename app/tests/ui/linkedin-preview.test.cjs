// Candidate-only browser coverage. Every request is served from disk or a local
// fixture; no authentication, profile generation, or analytics reaches a service.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const root = process.env.UI_SOURCE_ROOT || path.resolve(__dirname, '../../..');
const origin = 'http://localhost:4179';
const plans = ['free', 'weekly', 'monthly', 'pack', 'trial', 'essential', 'pro', 'premium'];
const browserType = process.env.LINKEDIN_TEST_BROWSER === 'webkit' ? webkit : chromium;
let browser;
before(async () => { browser = await browserType.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { plan = 'visitor', javaScriptEnabled = true, width = 390, analyzeStatus = 401 } = {}) {
  const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 844 } });
  t.after(() => context.close());
  const requests = [], errors = [];
  await context.addInitScript(({ plan }) => {
    let user = null, activePlan = plan;
    const assignUser = next => {
      activePlan = next;
      user = next === 'visitor' ? null : {
        uid: 'synthetic-preview-user', emailVerified: true,
        getIdToken: async () => 'synthetic-preview-token'
      };
    };
    assignUser(plan);
    window.__firebaseAuthReadyFired = true;
    window.__navigationReadyFired = true;
    window.FirebaseAuthManager = {
      get currentUser() { return user; },
      getCurrentUser: () => user,
      isAuthReady: () => true
    };
    window.JobHackAINavigation = {
      getAuthState: () => ({ isAuthenticated: !!user }),
      getEffectivePlan: () => activePlan
    };
    window.RoleSelector = function () {};
    window.__setLinkedInAuth = next => {
      assignUser(next);
      document.dispatchEvent(new CustomEvent('firebase-auth-ready', { detail: { user } }));
      window.dispatchEvent(new CustomEvent('navigationReady'));
    };
  }, { plan });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, method: req.method(), authorization: req.headers().authorization });
      if (url.pathname === '/api/linkedin/history') {
        return route.fulfill({ json: { items: [] } });
      }
      if (url.pathname === '/api/linkedin/analyze') {
        return route.fulfill({ status: analyzeStatus, json: { error: analyzeStatus === 403 ? 'premium_required' : 'unauthorized' } });
      }
      return route.fulfill({ status: 404, json: { error: 'Unexpected fixture API request' } });
    }
    if (['/login.html', '/pricing'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local destination fixture</title>' });
    }
    if (url.pathname.startsWith('/js/') && !['/js/linkedin-optimizer.js', '/js/modals.js'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(origin + '/linkedin-optimizer.html');
  return { page, requests, errors };
}

async function assertPreview(page) {
  await page.waitForFunction(() => !document.getElementById('lo-preview').hidden && document.getElementById('lo-app').hidden);
  assert.equal(await page.locator('#lo-preview').isVisible(), true);
  assert.equal(await page.locator('#lo-app').isVisible(), false);
  assert.equal(await page.locator('#lo-app').getAttribute('inert'), '');
  assert.equal(new URL(page.url()).pathname, '/linkedin-optimizer.html');
}

for (const width of [320, 390, 768]) {
  test(`signed-out visitors at ${width}px keep the example and make no tool requests`, async t => {
    const { page, requests, errors } = await fixture(t, { width });
    await assertPreview(page);
    await page.evaluate(() => window.__setLinkedInAuth('visitor'));
    await page.waitForTimeout(50);
    await assertPreview(page);
    assert.match(await page.locator('#lo-preview').innerText(), /Illustrative example/);
    assert.equal(await page.locator('#lo-form input').first().isVisible(), false);
    assert.equal(await page.locator('#jha-preview-gate').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  });
}

test('without JavaScript the example and both return links remain available', async t => {
  const { page, requests } = await fixture(t, { javaScriptEnabled: false });
  assert.equal(await page.locator('#lo-preview').isVisible(), true);
  assert.equal(await page.locator('#lo-app').isVisible(), false);
  for (const mode of ['signup', 'login']) {
    const href = await page.locator(`[data-cta="linkedin-preview-${mode}"]`).getAttribute('href');
    const url = new URL(href, origin);
    assert.equal(url.pathname, '/login.html');
    assert.equal(url.searchParams.get('redirect'), '/linkedin-optimizer.html');
    assert.equal(url.searchParams.get('mode'), mode === 'signup' ? 'signup' : null);
  }
  assert.deepEqual(requests, []);
});

for (const plan of plans) {
  test(`${plan} members keep authenticated access without a paid upgrade`, async t => {
    const { page, requests, errors } = await fixture(t, { plan });
    await page.waitForFunction(() => !document.getElementById('lo-app').hidden);
    await page.waitForFunction(() => !document.getElementById('lo-history-empty').hidden);
    assert.equal(await page.locator('#lo-preview').isVisible(), false);
    assert.equal(await page.locator('#lo-app').getAttribute('inert'), null);
    assert.equal(await page.locator('#lo-analyze').isEnabled(), true);
    assert.deepEqual(requests.map(r => [r.path, r.method, r.authorization]), [
      ['/api/linkedin/history', 'GET', 'Bearer synthetic-preview-token']
    ]);
    assert.deepEqual(errors, []);
  });
}

test('unknown plans remain locked without redirecting or requesting tool data', async t => {
  const { page, requests } = await fixture(t, { plan: 'unknown' });
  await assertPreview(page);
  assert.deepEqual(requests, []);
});

test('auth restoration opens the tool once and logout restores the inline preview', async t => {
  const { page, requests, errors } = await fixture(t);
  await assertPreview(page);
  await page.evaluate(() => window.__setLinkedInAuth('free'));
  await page.waitForFunction(() => !document.getElementById('lo-history-empty').hidden);
  await page.locator('#lo-headline').fill('Synthetic private headline');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('navigationReady')));
  await page.waitForTimeout(50);
  assert.equal(requests.length, 1);
  await page.evaluate(() => window.__setLinkedInAuth('visitor'));
  await assertPreview(page);
  assert.equal(await page.locator('#lo-headline').inputValue(), '');
  assert.equal(requests.length, 1);
  await page.evaluate(() => window.__setLinkedInAuth('monthly'));
  await page.waitForFunction(() => !document.getElementById('lo-app').hidden);
  await page.waitForTimeout(50);
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
});

for (const status of [401, 403]) {
  test(`server ${status} retains the authorization failure path`, async t => {
    const { page, requests, errors } = await fixture(t, { plan: 'free', analyzeStatus: status });
    await page.waitForFunction(() => !document.getElementById('lo-app').hidden);
    for (const id of ['role', 'headline', 'summary', 'experience', 'skills']) {
      await page.locator('#lo-' + id).fill('Synthetic example');
    }
    await page.locator('#lo-analyze').click();
    if (status === 401) {
      await page.waitForFunction(() => document.getElementById('lo-app').hidden);
      await assertPreview(page);
    } else {
      await page.waitForURL('**/pricing?redirect=*');
      assert.equal(new URL(page.url()).searchParams.get('redirect'), '/linkedin-optimizer.html');
    }
    assert.equal(requests.filter(r => r.path === '/api/linkedin/analyze').length, 1);
    assert.ok(requests.every(r => r.authorization === 'Bearer synthetic-preview-token'));
    assert.deepEqual(errors, []);
  });
}
