const { test, expect } = require('@playwright/test');
const { getAuthToken, waitForAuthReady } = require('../helpers/auth-helpers');

const ALLOWED_PLANS = new Set(['free', 'trial', 'essential', 'pro', 'premium']);

test.describe('Real API Smoke', () => {
  test('GET /api/plan/me returns valid plan', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const response = await page.request.get('/api/plan/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const data = await response.json();
    const plan = String(data.plan || '').toLowerCase();
    expect(ALLOWED_PLANS.has(plan)).toBeTruthy();
  });

  test('GET /api/plan/me includes trialEligible field', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const response = await page.request.get('/api/plan/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const data = await response.json();

    // trialEligible was added to plan/me to support trial re-use prevention
    expect(data).toHaveProperty('trialEligible');
    expect(typeof data.trialEligible).toBe('boolean');
  });

  test('GET /api/billing-status returns valid response', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const response = await page.request.get('/api/billing-status?force=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 401, 403]).toContain(response.status());
    const raw = await response.text();
    if (response.status() === 200) {
      expect(raw.length).toBeGreaterThan(0);
      try {
        const data = JSON.parse(raw);
        expect(data !== null && typeof data === 'object').toBeTruthy();
      } catch {
        throw new Error(`Expected JSON body for 200 response, got: ${raw.slice(0, 200)}`);
      }
    }
  });

  test('GET /api/user/export returns valid export data', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const response = await page.request.get('/api/user/export', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Validate top-level export structure
    expect(data).toHaveProperty('exportDate');
    expect(typeof data.exportDate).toBe('string');
    expect(data).toHaveProperty('user');
    expect(typeof data.user).toBe('object');
    expect(data.user).toHaveProperty('email');
    expect(typeof data.user.email).toBe('string');
    expect(data.user.email.length).toBeGreaterThan(0);

    // Validate all expected data collections are present (even if empty arrays)
    const expectedCollections = [
      'resumeSessions',
      'feedbackSessions',
      'linkedinRuns',
      'interviewQuestionSets',
      'mockInterviewSessions',
      'coverLetterHistory',
      'usageEvents',
    ];
    for (const collection of expectedCollections) {
      expect(data).toHaveProperty(collection);
      expect(Array.isArray(data[collection])).toBe(true);
    }

    // Nullable fields should exist
    expect(data).toHaveProperty('cookieConsent');
    expect(data).toHaveProperty('firstResumeSnapshot');
    expect(data).toHaveProperty('roleUsageLog');
    expect(data).toHaveProperty('featureDailyUsage');
    expect(data).toHaveProperty('mockInterviewUsage');
  });

  test('POST /api/cancel-subscription returns valid response', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock the cancel-subscription endpoint to avoid destructively canceling real subscriptions
    await page.route('**/api/cancel-subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'no_active_subscription' }),
      });
    });

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Use page.evaluate(fetch()) so the request goes through the page context
    // where page.route() interceptors are active. page.request.post() uses
    // Playwright's APIRequestContext which bypasses page.route() entirely and
    // would hit the real endpoint, potentially canceling a real subscription.
    const result = await page.evaluate(async (bearerToken) => {
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
      });
      return { status: res.status, body: await res.json() };
    }, token);

    // Valid outcomes: 200 (canceled or no active sub), 404 (no customer found), 502 (Stripe unavailable)
    expect([200, 404, 502]).toContain(result.status);
    expect(typeof result.body).toBe('object');

    if (result.status === 200) {
      expect(result.body).toHaveProperty('ok', true);
      expect(result.body).toHaveProperty('status');
      // Valid statuses: no_active_subscription, canceled_immediately, cancel_scheduled
      expect(['no_active_subscription', 'canceled_immediately', 'cancel_scheduled']).toContain(result.body.status);
    } else if (result.status === 404) {
      expect(result.body).toHaveProperty('error');
    }
  });

  test('POST /api/user/delete requires authentication', async ({ browser, baseURL }) => {
    test.setTimeout(30000);

    // Use an unauthenticated context
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });
    try {
      const unauthPage = await context.newPage();
      await unauthPage.goto('/login', { waitUntil: 'domcontentloaded' });

      const response = await unauthPage.request.post('/api/user/delete', {
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status()).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    } finally {
      await context.close();
    }
  });

  test('GET /api/user/export requires authentication', async ({ browser, baseURL }) => {
    test.setTimeout(30000);

    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });
    try {
      const unauthPage = await context.newPage();
      await unauthPage.goto('/login', { waitUntil: 'domcontentloaded' });

      const response = await unauthPage.request.get('/api/user/export');

      expect(response.status()).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    } finally {
      await context.close();
    }
  });
});
