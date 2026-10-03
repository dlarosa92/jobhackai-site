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

for (const [name, path, selector, originalLabel, busyLabel] of [
  ['pricing checkout', '/pricing.html', '.vp-buy[data-plan="weekly"]', 'Get the Weekly Pass', 'Opening checkout...'],
  ['shared upgrade', '/upgrade.html', '#upgrade', 'Upgrade plan', 'Processing...']
]) {
  test(`an authenticated ${name} stays locked while its request survives visibility and BFCache return`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('user-authenticated', 'true');
      const user = { getIdToken: async () => 'local-test-token' };
      window.FirebaseAuthManager = {
        waitForAuthReady: async () => user,
        getCurrentUser: () => user
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

    await page.goto(path);
    const button = page.locator(selector);
    await button.click();
    await expect.poll(() => page.evaluate(() => window.__pricingCheckout.calls)).toBe(1);

    // A foregrounding event must not unlock an active API request.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(button).toBeDisabled();

    // Return to the pending document through browser history (BFCache).
    await page.goto('/login.html?plan=weekly');
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(origin + path);
    await expect.poll(() => page.evaluate(() => window.__pricingPageShows.includes(true))).toBe(true);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(busyLabel);

    await button.evaluate((element) => element.click());
    expect(await page.evaluate(() => window.__pricingCheckout.calls)).toBe(1);

    await page.evaluate(() => window.__resolvePricingCheckout({ error: 'local fixture failure' }));
    await expect(button).toBeEnabled();
    await expect(button).toHaveText(originalLabel);
  });
}

async function authenticateFixture(page, { alreadySubscribed = false } = {}) {
  await page.addInitScript(({ alreadySubscribed, origin }) => {
    localStorage.setItem('user-authenticated', 'true');
    const user = { getIdToken: async () => 'local-test-token' };
    window.FirebaseAuthManager = {
      waitForAuthReady: async () => user,
      getCurrentUser: () => user
    };
    window.__checkoutRequests = [];
    window.fetch = async (url) => {
      window.__checkoutRequests.push(url);
      return {
        ok: true,
        json: async () => alreadySubscribed && url === '/api/stripe-checkout'
          ? { code: 'ALREADY_SUBSCRIBED' }
          : { ok: true, action: 'redirect', url: origin + '/checkout.html' }
      };
    };
  }, { alreadySubscribed, origin });
}

for (const [name, path, selector, originalLabel] of [
  ['authenticated pricing', '/pricing.html', '.vp-buy[data-plan="weekly"]', 'Get the Weekly Pass'],
  ['shared upgrade', '/upgrade.html', '#upgrade', 'Upgrade plan']
]) {
  test(`${name} recovers when its checkout redirect does not commit`, async ({ page }) => {
    await authenticateFixture(page);
    await page.route('**/checkout.html', route => route.fulfill({ status: 204, body: '' }));
    await page.goto(path);
    await page.clock.install();
    const button = page.locator(selector);
    const navigation = page.waitForResponse(response => response.request().isNavigationRequest()
      && new URL(response.url()).pathname === '/checkout.html');
    await button.click();
    await navigation;
    await expect(button).toBeDisabled();
    await page.clock.fastForward(5001);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText(originalLabel);
    await expect.poll(() => page.evaluate(() => window.__checkoutRequests.length)).toBe(1);
  });
}

test('shared upgrade callers recover their original button after returning from checkout', async ({ page }) => {
  await authenticateFixture(page);
  await page.goto('/upgrade.html');
  const button = page.locator('#upgrade');
  await button.click();
  await expect(page).toHaveURL(/\/checkout\.html$/);
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => window.__pricingPageShows.includes(true))).toBe(true);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Upgrade plan');
});

test('pricing restores its own label after the real shared upgrade redirect', async ({ page }) => {
  await authenticateFixture(page, { alreadySubscribed: true });
  await page.goto('/pricing.html');
  const button = page.locator('.vp-buy[data-plan="monthly"]');
  await button.click();
  await page.locator('#jh-upgrade-confirm').click();
  await expect(page).toHaveURL(/\/checkout\.html$/);
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => window.__pricingPageShows.includes(true))).toBe(true);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Get Monthly');
  expect(await page.evaluate(() => window.__checkoutRequests)).toEqual(['/api/stripe-checkout', '/api/upgrade-plan']);
});
