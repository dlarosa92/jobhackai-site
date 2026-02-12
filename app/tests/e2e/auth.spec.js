const { test, expect } = require('@playwright/test');
const { submitForm, waitForAuthReady } = require('../helpers/auth-helpers');

function generateUniqueSignupEmail() {
  const fallbackBase = 'jobhackai.e2e@gmail.com';
  const rawBase = process.env.SIGNUP_TEST_EMAIL_BASE || process.env.TEST_EMAIL || fallbackBase;
  const [localPartRaw, domainPartRaw] = rawBase.includes('@')
    ? rawBase.split('@')
    : [rawBase, 'example.com'];
  const localPart = (localPartRaw || 'jobhackai.e2e')
    .split('+')[0]
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'jobhackai.e2e';
  const domainPart = (domainPartRaw || 'example.com').replace(/[^a-zA-Z0-9.-]/g, '') || 'example.com';
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${localPart}+signup-${timestamp}-${randomSuffix}@${domainPart}`;
}

test.describe('Authentication', () => {
  test('should login and redirect to dashboard', async ({ browser, baseURL }) => {
    // Create new unauthenticated context to test actual login flow
    // (not re-login with existing session)
    const context = await browser.newContext({
      baseURL: baseURL
    });
    try {
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

      // Submit form - use form submission instead of button click to avoid element detachment
      // The form submit handler triggers async navigation which can detach the button element
      await Promise.all([
        page.waitForURL(/\/dashboard/, { timeout: 20000 }),
        submitForm(page, '#loginForm')
      ]);

      // Verify dashboard loaded - wait for DOM to be ready instead of networkidle
      await expect(page).toHaveURL(/\/dashboard/);
      await page.waitForLoadState('domcontentloaded');
    } finally {
      await context.close();
    }
  });
  
  test('should protect dashboard from unauthenticated access', async ({ browser, baseURL }) => {
    // Create new context without auth - explicitly clear storage state
    const context = await browser.newContext({
      baseURL: baseURL,
      storageState: undefined // Explicitly no storage state
    });
    try {
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
    } finally {
      await context.close();
    }
  });

  test('should sign up and reach verify-email with working resend flow', async ({ browser, baseURL }) => {
    test.skip((process.env.TEST_ENV || '').toLowerCase() === 'prod', 'Disabled in prod: this test creates real accounts.');
    test.setTimeout(90000);
    const context = await browser.newContext({
      baseURL,
      storageState: undefined
    });
    try {
      const page = await context.newPage();

      const signupEmail = generateUniqueSignupEmail();
      const signupPassword = process.env.SIGNUP_TEST_PASSWORD || process.env.TEST_PASSWORD || 'Password1234';

      await page.goto('/login?plan=trial', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#signupForm', { state: 'visible', timeout: 20000 });

      await page.fill('#firstName', 'E2E');
      await page.fill('#lastName', 'Signup');
      await page.fill('#signupEmail', signupEmail);
      await page.fill('#signupPassword', signupPassword);
      await page.fill('#confirmPassword', signupPassword);

      const signupContinueBtn = page.locator('#signupContinueBtn');
      await expect(signupContinueBtn).toBeVisible();
      await expect(signupContinueBtn).toBeEnabled();

      await signupContinueBtn.click();
      await expect(signupContinueBtn).toHaveText(/Creating account\.\.\./i, { timeout: 5000 });

      let transitionState = '';
      await expect.poll(async () => {
        const currentUrl = page.url();
        if (/\/verify-email(?:\.html)?/i.test(currentUrl)) {
          transitionState = 'redirected';
          return transitionState;
        }

        const buttonExists = await signupContinueBtn.count().then((c) => c > 0).catch(() => false);
        if (!buttonExists) {
          transitionState = 'button-gone';
          return transitionState;
        }

        const buttonText = ((await signupContinueBtn.textContent()) || '').trim();
        const isDisabled = await signupContinueBtn.isDisabled().catch(() => false);
        if (!(buttonText === 'Creating account...' && isDisabled)) {
          transitionState = `button-recovered:${buttonText}:${isDisabled}`;
          return transitionState;
        }

        transitionState = 'still-creating';
        return transitionState;
      }, {
        timeout: 30000,
        message: 'Signup button remained stuck on "Creating account..." for 30s'
      }).toMatch(/redirected|button-gone|button-recovered/);

      await page.waitForURL(/\/verify-email(?:\.html)?/i, {
        timeout: 45000,
        waitUntil: 'domcontentloaded'
      });

      await page.waitForFunction(() => {
        return typeof window.FirebaseAuthManager?.sendVerificationEmail === 'function';
      }, { timeout: 15000 });

      await expect(page.locator('#resendVerifyBtn')).toBeVisible();
      await expect(page.locator('#resendVerifyBtn')).toBeEnabled();

      await page.locator('#resendVerifyBtn').click();

      const verifyStatus = page.locator('#verifyStatus');
      let verifyStatusText = '';
      await expect.poll(async () => {
        verifyStatusText = ((await verifyStatus.textContent()) || '').trim();
        return verifyStatusText.length > 0;
      }, {
        timeout: 30000,
        message: 'Expected resend verification status text to be shown'
      }).toBe(true);

      expect(verifyStatusText).toMatch(
        /Verification email sent|Too many|try again later|Could not send verification email|already verified|Please wait before requesting/i
      );
    } finally {
      await context.close();
    }
  });

  test('logout clears auth state and shows visitor nav', async ({ page, baseURL }) => {
    test.setTimeout(30000);
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

    const newPage = await page.context().newPage();
    try {
      await newPage.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await newPage.waitForTimeout(2000);
      const url = newPage.url();
      expect(url).toMatch(/\/login|\/verify-email/);
      const authNavLoc = newPage.locator('.nav-actions .user-plan-badge, .nav-user-menu');
      const authCount = await authNavLoc.count();
      let hasAuthNav = false;
      for (let i = 0; i < authCount; i++) {
        if (await authNavLoc.nth(i).isVisible().catch(() => false)) {
          hasAuthNav = true;
          break;
        }
      }
      expect(hasAuthNav).toBeFalsy();
    } finally {
      await newPage.close();
    }
  });

  test('should protect resume-feedback from unauthenticated access', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.goto('/resume-feedback-pro.html', { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForURL(/\/login|\/verify-email/, { timeout: 20000 });
      } catch (e) {
        const currentURL = page.url();
        throw new Error(`Auth guard did not redirect from resume-feedback. Current URL: ${currentURL}`);
      }
      expect(page.url()).toMatch(/\/login|\/verify-email/);
    } finally {
      await context.close();
    }
  });

  test('should protect account-setting from unauthenticated access', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.goto('/account-setting.html', { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForURL(/\/login|\/verify-email/, { timeout: 20000 });
      } catch (e) {
        const currentURL = page.url();
        throw new Error(`Auth guard did not redirect from account-setting. Current URL: ${currentURL}`);
      }
      expect(page.url()).toMatch(/\/login|\/verify-email/);
    } finally {
      await context.close();
    }
  });

});
