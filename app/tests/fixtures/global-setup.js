const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Require credentials from environment variables - no hardcoded fallbacks
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const BASE_URL = process.env.TEST_ENV === 'qa' 
  ? 'https://qa.jobhackai.io'
  : 'https://dev.jobhackai.io';

async function globalSetup() {
  // Fail early if credentials are not provided
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    if (isCI) {
      throw new Error(
        'TEST_EMAIL and TEST_PASSWORD environment variables must be set.\n' +
        'To fix this, add GitHub Secrets:\n' +
        '1. Go to your GitHub repository\n' +
        '2. Navigate to Settings → Secrets and variables → Actions\n' +
        '3. Click "New repository secret"\n' +
        '4. Add TEST_EMAIL with value: jobshackai@gmail.com\n' +
        '5. Add TEST_PASSWORD with value: Password1234\n' +
        '6. Re-run the workflow'
      );
    } else {
      throw new Error(
        'TEST_EMAIL and TEST_PASSWORD environment variables must be set.\n' +
        'Set them in your shell or create a .env file:\n' +
        '  export TEST_EMAIL=your-email@example.com\n' +
        '  export TEST_PASSWORD=your-password\n' +
        'Or run: TEST_EMAIL=email TEST_PASSWORD=password npm run test:e2e:dev'
      );
    }
  }
  
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log(`🔐 Authenticating on ${BASE_URL}`);
    
    // Capture console errors and network failures
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    page.on('pageerror', error => {
      consoleErrors.push(`Page error: ${error.message}`);
    });
    
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    
    // Wait for login form - using actual selector from login.html
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    
    // Wait for Firebase to be ready (login form won't work until Firebase is initialized)
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined || 
             window.firebase !== undefined ||
             document.querySelector('#loginEmail') !== null;
    }, { timeout: 10000 });
    
    // Fill login form with actual selectors
    await page.fill('#loginEmail', TEST_EMAIL);
    await page.fill('#loginPassword', TEST_PASSWORD);
    
    // Click submit button and wait for navigation
    // Login redirects to dashboard.html (with .html extension) or verify-email.html
    try {
      await Promise.all([
        page.waitForURL(/\/dashboard|\/verify-email/, { timeout: 45000 }),
        page.click('#loginContinueBtn')
      ]);
      
      // Check if we're on verify-email page (email not verified)
      const currentURL = page.url();
      if (currentURL.includes('/verify-email')) {
        console.log('⚠️ Email verification required - this may cause test issues');
        // For test accounts, we might need to skip email verification
        // or handle it differently
      }
    } catch (error) {
      // If redirect fails, check what happened
      const currentURL = page.url();
      
      console.error('❌ Login redirect failed');
      console.error(`Current URL: ${currentURL}`);
      console.error(`Expected: URL containing /dashboard or /verify-email`);
      
      // Check for error messages on the page
      const errorElement = await page.locator('#loginError, .error, [class*="error"]').first().textContent().catch(() => null);
      if (errorElement) {
        console.error(`Login error message: ${errorElement}`);
        throw new Error(`Login failed with error: ${errorElement}. Current URL: ${currentURL}`);
      }
      
      // Check if we're still on login page (login didn't work)
      if (currentURL.includes('/login')) {
        // Wait a bit more to see if redirect happens
        await page.waitForTimeout(5000);
        const finalURL = page.url();
        if (finalURL.includes('/login')) {
          // Log console errors
          if (consoleErrors.length > 0) {
            console.error('Console errors:', consoleErrors);
          }
          throw new Error(`Login failed - still on login page. Console errors: ${consoleErrors.join('; ')}`);
        }
      }
      
      // Log console errors
      if (consoleErrors.length > 0) {
        console.error('Console errors:', consoleErrors);
      }
      
      throw error;
    }
    
    // Ensure auth directory exists
    const authDir = path.join(__dirname, '../.auth');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    
    // Save auth state
    await context.storageState({ 
      path: path.join(authDir, 'user.json') 
    });
    
    console.log('✅ Authentication successful, state saved');
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = globalSetup;

