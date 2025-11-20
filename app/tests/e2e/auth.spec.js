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
    
    // Submit form - click button and wait for navigation
    await page.click('#loginContinueBtn');
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    
    // Verify dashboard loaded - wait for DOM to be ready instead of networkidle
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('domcontentloaded');
    
    await context.close();
  });
  
  test('should protect dashboard from unauthenticated access', async ({ browser, baseURL }) => {
    // Create new context without auth, but with baseURL from config
    const context = await browser.newContext({
      baseURL: baseURL
    });
    const page = await context.newPage();
    
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    
    // Should redirect to login - increase timeout for auth guard processing
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/login/);
    
    await context.close();
  });
});

