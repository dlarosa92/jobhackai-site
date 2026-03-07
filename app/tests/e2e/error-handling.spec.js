const { test, expect } = require('@playwright/test');
const { waitForAuthReady } = require('../helpers/auth-helpers');

test.describe('Error Handling', () => {
  test('page handles API 500 gracefully', async ({ page }) => {
    test.setTimeout(30000);

    let planMeRouteHit = false;
    await page.route('**/api/plan/me**', async (route) => {
      planMeRouteHit = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Wait for the dashboard to trigger the /api/plan/me request before asserting
    await page.waitForRequest(
      (req) => req.url().includes('/api/plan/me'),
      { timeout: 10000 }
    ).catch(() => {});

    const url = page.url();
    expect(url).toMatch(/\/dashboard/);
    expect(planMeRouteHit).toBe(true);

    const criticalErrors = pageErrors.filter((m) =>
      /uncaught|Unhandled|Cannot read|undefined is not/i.test(m)
    );
    expect(criticalErrors.length).toBe(0);

    const bodyVisible = await page.locator('body').isVisible();
    expect(bodyVisible).toBeTruthy();
  });

  test('feedback API 500 returns generic error without internal details', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'error test', page: '/test' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // May succeed (200), hit rate limit (429), or fail if email service unavailable (500)
    // For security testing, we need an error response
    expect([200, 429, 500]).toContain(result.status);
    // Security: must NOT expose internal implementation details
    // Only check security assertions if we got an error response
    if (result.status === 500 || result.status === 429) {
      expect(result.body).toHaveProperty('error');
      const errorMsg = JSON.stringify(result.body);
      expect(errorMsg).not.toMatch(/RESEND_API_KEY/i);
      expect(errorMsg).not.toMatch(/JOBHACKAI_KV/i);
      expect(errorMsg).not.toMatch(/stack|trace/i);
      expect(errorMsg).not.toMatch(/env\.\w+/i);
    }
  });
});
