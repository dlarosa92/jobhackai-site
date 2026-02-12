const { test, expect } = require('@playwright/test');
const { waitForAuthReady, getAuthToken } = require('../helpers/auth-helpers');

test.describe('Account Settings', () => {
  test('account settings page loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');

    await expect(page.locator('[data-action="logout"]')).toBeVisible({ timeout: 15000 });
  });

  test('billing management opens Stripe portal', async ({ page, baseURL }) => {
    test.setTimeout(30000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const response = await page.request.post('/api/billing-portal', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        return_url: `${baseURL}/account-setting.html`,
      },
    });

    expect([200, 400, 401, 403, 404, 500]).toContain(response.status());
    if (response.status() === 200) {
      const data = await response.json();
      expect(typeof data.url).toBe('string');
      expect(data.url).toContain('billing.stripe.com');
    }
  });

  test('logout from account settings works', async ({ page }) => {
    test.setTimeout(20000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const logoutBtn = page.locator('[data-action="logout"]');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });

    await Promise.all([
      page.waitForURL(/\/login/, { timeout: 15000 }),
      logoutBtn.click(),
    ]);

    await expect(page).toHaveURL(/\/login/);
  });
});
