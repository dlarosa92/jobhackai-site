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
  
  // Capture console errors and network failures (declare outside try block for catch access)
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    consoleErrors.push(`Page error: ${error.message}`);
  });
  
  try {
    console.log(`🔐 Authenticating on ${BASE_URL}`);
    
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    
    // Wait for login form - using actual selector from login.html
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    
    // Wait for Firebase and authManager to be ready (login form won't work until Firebase is initialized)
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined && 
             typeof window.FirebaseAuthManager.signIn === 'function';
    }, { timeout: 15000 });
    
    // Fill login form with actual selectors
    await page.fill('#loginEmail', TEST_EMAIL);
    await page.fill('#loginPassword', TEST_PASSWORD);
    
    // Call authManager.signIn directly via JavaScript to avoid form submission issues
    // This bypasses the form and directly uses the Firebase auth
    const loginResult = await page.evaluate(async (email, password) => {
      if (!window.FirebaseAuthManager || typeof window.FirebaseAuthManager.signIn !== 'function') {
        return { success: false, error: 'FirebaseAuthManager.signIn not available' };
      }
      
      try {
        const result = await window.FirebaseAuthManager.signIn(email, password);
        return result;
      } catch (error) {
        return { success: false, error: error.message || 'Login failed' };
      }
    }, TEST_EMAIL, TEST_PASSWORD);
    
    if (!loginResult.success) {
      throw new Error(`Login failed: ${loginResult.error || 'Unknown error'}`);
    }
    
    // Wait a moment for auth state to update
    await page.waitForTimeout(2000);
    
    // After successful login, check if we need to handle email verification
    const authState = await page.evaluate(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (!user) {
        return { hasUser: false };
      }
      
      const isEmailPassword = window.FirebaseAuthManager?.isEmailPasswordUser?.(user);
      const emailVerified = user.emailVerified !== false;
      
      return {
        hasUser: true,
        needsVerification: isEmailPassword && !emailVerified,
        userEmail: user.email
      };
    });
    
    if (!authState.hasUser) {
      throw new Error('Login succeeded but no user found in auth state');
    }
    
    if (authState.needsVerification) {
      // Navigate to verify-email page
      await page.goto(`${BASE_URL}/verify-email.html`, { waitUntil: 'networkidle' });
      console.log('⚠️ Email verification required - navigating to verify-email page');
    } else {
      // Navigate to dashboard (the app should redirect here, but we'll do it explicitly)
      await page.goto(`${BASE_URL}/dashboard.html`, { waitUntil: 'networkidle' });
    }
    
    // Verify we're on the right page
    const finalURL = page.url();
    if (!finalURL.includes('/dashboard') && !finalURL.includes('/verify-email')) {
      throw new Error(`Unexpected redirect after login: ${finalURL}`);
    }
    
    if (finalURL.includes('/verify-email')) {
      console.log('⚠️ Email verification required - this may cause test issues');
      // For test accounts, we might need to skip email verification
      // or handle it differently
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
    
    console.error('❌ Authentication failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = globalSetup;

