const { test, expect } = require('@playwright/test');

test.describe('Authentication', () => {
  test('should login and redirect to dashboard', async ({ browser, baseURL }) => {
    // Create new unauthenticated context to test actual login flow
    // (not re-login with existing session)
    const context = await browser.newContext({
      baseURL: baseURL
    });
    const page = await context.newPage();
    
    await page.goto('/login');
    
    // Wait for login form using actual selector
    await page.waitForSelector('#loginEmail');
    
    // Require credentials from environment variables - no hardcoded fallbacks
    const TEST_EMAIL = process.env.TEST_EMAIL;
    const TEST_PASSWORD = process.env.TEST_PASSWORD;
    
    if (!TEST_EMAIL || !TEST_PASSWORD) {
      throw new Error('TEST_EMAIL and TEST_PASSWORD environment variables must be set');
    }
    
    // Fill credentials
    await page.fill('#loginEmail', TEST_EMAIL);
    await page.fill('#loginPassword', TEST_PASSWORD);
    
    // Submit form - click button and wait for navigation (avoid double wait deadlock)
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 20000 }),
      page.click('#loginContinueBtn')
    ]);
    
    // Verify dashboard loaded - wait for DOM to be ready instead of networkidle
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('domcontentloaded');
    
    await context.close();
  });
  
  test('should protect dashboard from unauthenticated access', async ({ browser, baseURL }) => {
    // Create new context without auth - explicitly clear storage state
    const context = await browser.newContext({
      baseURL: baseURL,
      storageState: undefined // Explicitly no storage state
    });
    const page = await context.newPage();
    
    // Clear any localStorage that might have been set
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    
    // Navigate to dashboard - auth guard should redirect to login
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    
    // Wait for redirect - auth guard can take up to 10 seconds to check auth state
    // Use waitForURL with longer timeout and check for either login or verify-email redirect
    try {
      await page.waitForURL(/\/login|\/verify-email/, { timeout: 20000 });
    } catch (error) {
      // If redirect didn't happen, check current URL and fail with helpful message
      const currentURL = page.url();
      if (currentURL.includes('/dashboard')) {
        // Check if auth guard script is present
        const hasAuthGuard = await page.evaluate(() => {
          return document.querySelector('script[src*="static-auth-guard"]') !== null ||
                 Array.from(document.scripts).some(s => s.textContent.includes('auth-pending'));
        });
        throw new Error(`Auth guard did not redirect. Current URL: ${currentURL}. Auth guard script present: ${hasAuthGuard}. Auth guard may not be working or page loaded before guard executed.`);
      }
      throw error;
    }
    
    // Verify we're redirected away from dashboard
    const finalURL = page.url();
    expect(finalURL).toMatch(/\/login|\/verify-email/);
    
    await context.close();
  });
});

