const { test, expect } = require('@playwright/test');
const { submitForm } = require('../helpers/auth-helpers');

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
  return `${localPart}+terms-${timestamp}-${randomSuffix}@${domainPart}`;
}

async function openSignupForm(page) {
  await page.goto('/login?plan=trial', { waitUntil: 'domcontentloaded' });
  const signupForm = page.locator('#signupForm');

  if (!(await signupForm.isVisible().catch(() => false))) {
    const showSignUpLink = page.locator('#showSignUpLink');
    await expect(showSignUpLink).toBeVisible({ timeout: 10000 });
    await showSignUpLink.click();
  }

  await expect(signupForm).toBeVisible({ timeout: 15000 });
}

test.describe('Terms Checkpoints', () => {
  test('signup requires terms acceptance before submit can proceed', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });

    try {
      const page = await context.newPage();
      let acceptTermsApiCalls = 0;

      await page.route('**/api/accept-terms**', async (route) => {
        acceptTermsApiCalls += 1;
        await route.fallback();
      });

      await openSignupForm(page);

      const signupEmail = generateUniqueSignupEmail();
      const signupPassword = process.env.SIGNUP_TEST_PASSWORD || process.env.TEST_PASSWORD || 'Password1234A';

      await page.fill('#firstName', 'E2E');
      await page.fill('#lastName', 'Terms');
      await page.fill('#signupEmail', signupEmail);
      await page.fill('#signupPassword', signupPassword);
      await page.fill('#confirmPassword', signupPassword);

      const acceptTermsCheckbox = page.locator('#acceptTerms');
      await expect(acceptTermsCheckbox).not.toBeChecked();

      await submitForm(page, '#signupForm');

      const termsError = page.locator('#termsError');
      await expect(termsError).toBeVisible();
      await expect(termsError).toContainText('You must agree to the Terms of Service and Privacy Policy');
      await expect(acceptTermsCheckbox).toBeFocused();
      await expect(page).toHaveURL(/\/login/);
      expect(page.url()).not.toMatch(/\/verify-email(?:\.html)?/i);
      expect(acceptTermsApiCalls).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('signup exposes terms and privacy links in checkpoint UI', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
    });

    try {
      const page = await context.newPage();
      await openSignupForm(page);

      const oauthNotice = page.locator('#oauthTermsNotice');
      await expect(oauthNotice).toBeVisible();

      const oauthTermsLink = oauthNotice.locator('a[href*="terms"]');
      const oauthPrivacyLink = oauthNotice.locator('a[href*="privacy"]');
      await expect(oauthTermsLink).toBeVisible();
      await expect(oauthTermsLink).toHaveAttribute('target', '_blank');
      await expect(oauthTermsLink).toHaveAttribute('rel', /noopener/);
      await expect(oauthPrivacyLink).toBeVisible();
      await expect(oauthPrivacyLink).toHaveAttribute('target', '_blank');
      await expect(oauthPrivacyLink).toHaveAttribute('rel', /noopener/);

      const checkboxTermsLink = page.locator('#signupForm .terms-acceptance a[href*="terms"]');
      const checkboxPrivacyLink = page.locator('#signupForm .terms-acceptance a[href*="privacy"]');
      await expect(checkboxTermsLink).toBeVisible();
      await expect(checkboxPrivacyLink).toBeVisible();

      await expect(page.locator('#acceptTerms')).toHaveAttribute('aria-required', 'true');

      await page.click('#showLoginLink');
      await expect(page.locator('#oauthTermsNotice')).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
