const { test, expect } = require('@playwright/test');
const { waitForAuthReady, getAuthToken } = require('../helpers/auth-helpers');

const MARKETING_BASE = process.env.MARKETING_BASE_URL || 'https://jobhackai.io';
const AUTH_HANDOFF_SESSION_KEY = 'jhai_auth_handoff';

test.describe('Marketing Site Auth Handoff', () => {
  test('marketing site shows visitor nav after logout (handoff cleared)', async ({ page, baseURL }) => {
    test.setTimeout(45000);
    test.skip(!baseURL || !baseURL.includes('jobhackai.io'), 'Requires jobhackai.io app URL');

    const ts = Date.now();
    const handoffUrl = `${MARKETING_BASE}/?jhai_auth=1&jhai_plan=premium&jhai_ts=${ts}`;

    await page.goto(handoffUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const hasAuthNav = await page.locator('.nav-actions, .user-plan-badge, a[href*="dashboard"]').first().isVisible().catch(() => false);
    const hasVisitorCta = await page.locator('a:has-text("Start Free Trial"), a:has-text("Log in"), .btn-primary').first().isVisible().catch(() => false);
    expect(hasAuthNav || hasVisitorCta).toBeTruthy();

    await page.evaluate((key) => {
      sessionStorage.removeItem(key);
    }, AUTH_HANDOFF_SESSION_KEY);

    await page.evaluate(() => {
      document.cookie = 'jhai_auth=0; domain=.jobhackai.io; path=/; max-age=86400; SameSite=Lax';
    });

    await page.goto(MARKETING_BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const hasStaleAuthNav = await page.locator('.user-plan-badge, .nav-actions .nav-user-menu').first().isVisible().catch(() => false);
    const hasVisitorNav = await page.locator('a:has-text("Start Free Trial"), a:has-text("Log in")').first().isVisible().catch(() => false);
    expect(hasStaleAuthNav).toBeFalsy();
    expect(hasVisitorNav).toBeTruthy();
  });
});
