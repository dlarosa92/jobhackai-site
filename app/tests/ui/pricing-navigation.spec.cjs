const { test, expect } = require('@playwright/test');
const origin = 'http://127.0.0.1:4178';

const plans = [
  { id: 'weekly', label: 'Get the Weekly Pass' },
  { id: 'monthly', label: 'Get Monthly' },
  { id: 'pack', label: 'Get the Pack' }
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__pricingPageShows = [];
    window.addEventListener('pageshow', (event) => {
      window.__pricingPageShows.push(event.persisted);
    });

    window.JHA = {
      trackEventSafe(name, payload) {
        if (name !== 'begin_checkout') return;
        const count = Number(sessionStorage.getItem('pricingBeginCheckoutCount') || 0);
        sessionStorage.setItem('pricingBeginCheckoutCount', String(count + 1));
        sessionStorage.setItem('pricingBeginCheckoutPlan', payload.plan);
      }
    };
  });
});

for (const plan of plans) {
  test(`${plan.id} CTA preserves its plan and recovers across Back/Forward`, async ({ page }) => {
    let loginNavigationCount = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/login.html') loginNavigationCount++;
    });

    await page.goto(`${origin}/pricing.html`);
    const button = page.locator(`.vp-buy[data-plan="${plan.id}"]`);
    const originalLabel = plan.label;

    // Dispatch twice in one task to catch accidental duplicate checkout starts.
    await button.evaluate((element) => {
      element.click();
      element.click();
    });

    await expect(page).toHaveURL(new RegExp(`/login\\.html\\?plan=${plan.id}$`));
    expect(loginNavigationCount).toBe(1);
    await expect.poll(() => page.evaluate(() => ({
      selectedPlan: JSON.parse(sessionStorage.getItem('selectedPlan') || 'null')?.planId,
      pagePlan: document.body.dataset.plan,
      trackedPlan: sessionStorage.getItem('pricingBeginCheckoutPlan'),
      beginCheckoutCount: sessionStorage.getItem('pricingBeginCheckoutCount')
    }))).toEqual({
      selectedPlan: plan.id,
      pagePlan: plan.id,
      trackedPlan: plan.id,
      beginCheckoutCount: '1'
    });

    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/pricing\.html$/);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText(originalLabel);
    await expect.poll(() => page.evaluate(() => window.__pricingPageShows.includes(true))).toBe(true);

    await page.goForward({ waitUntil: 'commit' });
    await expect(page).toHaveURL(new RegExp(`/login\\.html\\?plan=${plan.id}$`));
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/pricing\.html$/);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText(originalLabel);
  });
}

test('a signup navigation that does not commit restores the CTA so the user can retry', async ({ page }) => {
  await page.goto('/pricing.html');
  const button = page.locator('.vp-buy[data-plan="weekly"]');

  await page.route((url) => {
    const requestUrl = new URL(url);
    return requestUrl.pathname.endsWith('/login.html') && requestUrl.searchParams.get('plan') === 'weekly';
  }, (route) => route.fulfill({ status: 204, body: '' }));

  const uncommittedNavigation = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().isNavigationRequest()
      && requestUrl.pathname.endsWith('/login.html')
      && requestUrl.searchParams.get('plan') === 'weekly'
      && response.status() === 204;
  });

  await page.clock.install();
  await button.click();
  await uncommittedNavigation;
  await expect(page).toHaveURL(/\/pricing\.html$/);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Opening checkout...');

  await page.clock.fastForward(5001);

  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Get the Weekly Pass');
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('selectedPlan') || 'null')?.planId)).toBe('weekly');
});

test('an authenticated checkout stays locked while its request survives visibility and BFCache return', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('user-authenticated', 'true');
    window.FirebaseAuthManager = {
      waitForAuthReady: async () => ({ getIdToken: async () => 'local-test-token' })
    };

    window.__pricingCheckout = { calls: 0, resolve: null };
    window.fetch = () => {
      window.__pricingCheckout.calls++;
      return new Promise((resolve) => {
        window.__pricingCheckout.resolve = resolve;
      });
    };
    window.__resolvePricingCheckout = (body) => {
      window.__pricingCheckout.resolve({ json: async () => body });
    };
  });
  page.on('dialog', (dialog) => dialog.dismiss());

  await page.goto('/pricing.html');
  const button = page.locator('.vp-buy[data-plan="weekly"]');
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__pricingCheckout.calls)).toBe(1);

  // A foregrounding event must not unlock an active API request.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(button).toBeDisabled();

  // Return to the pending document through browser history (BFCache).
  await page.goto('/login.html?plan=weekly');
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/pricing\.html$/);
  await expect.poll(() => page.evaluate(() => window.__pricingPageShows.includes(true))).toBe(true);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Opening checkout...');

  await button.evaluate((element) => element.click());
  expect(await page.evaluate(() => window.__pricingCheckout.calls)).toBe(1);

  await page.evaluate(() => window.__resolvePricingCheckout({ error: 'local fixture failure' }));
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Get the Weekly Pass');
});
