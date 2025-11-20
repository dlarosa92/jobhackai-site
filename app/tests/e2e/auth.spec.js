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
    
    // Fill credentials
    await page.fill('#loginEmail', process.env.TEST_EMAIL || 'jobshackai@gmail.com');
    await page.fill('#loginPassword', process.env.TEST_PASSWORD || 'Password1234');
    
    // Submit form
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 20000 }),
      page.click('#loginContinueBtn')
    ]);
    
    // Verify dashboard loaded
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('networkidle');
    
    await context.close();
  });
  
  test('should protect dashboard from unauthenticated access', async ({ browser, baseURL }) => {
    // Create new context without auth, but with baseURL from config
    const context = await browser.newContext({
      baseURL: baseURL
    });
    const page = await context.newPage();
    
    await page.goto('/dashboard');
    
    // Should redirect to login
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
    
    await context.close();
  });
});

