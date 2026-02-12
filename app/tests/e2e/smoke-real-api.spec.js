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
    if (raw.length > 0 && response.status() === 200) {
      try {
        const data = JSON.parse(raw);
        expect(typeof data).toBe('object');
      } catch {
        throw new Error(`Expected JSON body for 200 response, got: ${raw.slice(0, 200)}`);
      }
    }
  });
});
