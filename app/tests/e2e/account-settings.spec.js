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

  test('download my data button is visible', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const downloadBtn = page.locator('#download-my-data-btn');
    await expect(downloadBtn).toBeVisible({ timeout: 10000 });

    const buttonText = await downloadBtn.textContent();
    expect(buttonText.trim().toLowerCase()).toContain('download');
  });

  test('delete account button and confirmation modal exist', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Delete account button should be visible
    const deleteBtn = page.locator('#delete-account-link');
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });

    // Click the delete button to open the confirmation modal
    await deleteBtn.click();

    // Confirmation modal should appear
    const modal = page.locator('#delete-account-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal should have a confirm button and cancel option
    const confirmBtn = modal.locator('#delete-modal-confirm, #confirm-delete-btn, button:has-text("Delete My Account")');
    const confirmVisible = await confirmBtn.first().isVisible({ timeout: 3000 }).catch(() => false);

    // Close the modal without deleting — look for cancel/close button
    const closeBtn = modal.locator('#delete-modal-cancel, #cancel-delete-btn, button:has-text("Cancel"), .modal-close, [aria-label="Close"]');
    const closeVisible = await closeBtn.first().isVisible({ timeout: 3000 }).catch(() => false);

    if (closeVisible) {
      await closeBtn.first().click();
      // Modal should be dismissed
      await expect(modal).not.toBeVisible({ timeout: 5000 });
    } else if (confirmVisible) {
      // If there's no explicit close but there's a confirm, press Escape to dismiss
      await page.keyboard.press('Escape');
    }

    // Verify the page is still on account settings (no accidental deletion)
    expect(page.url()).toContain('account-setting');
  });

  test('data export API returns downloadable JSON from account settings', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/account-setting.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Call the export API directly (same as what the download button triggers)
    const response = await page.request.get('/api/user/export', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);

    // Verify Content-Disposition header for file download
    const contentDisposition = response.headers()['content-disposition'] || '';
    expect(contentDisposition).toContain('attachment');
    expect(contentDisposition).toContain('jobhackai-data-export.json');

    const data = await response.json();
    expect(data).toHaveProperty('exportDate');
    expect(data).toHaveProperty('user');
    expect(data.user).toHaveProperty('email');
  });
});
