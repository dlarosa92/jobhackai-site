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
});
