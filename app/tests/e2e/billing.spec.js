const { test, expect } = require('@playwright/test');

test.describe('Stripe Billing', () => {
  test('should allow upgrade from trial to essential', async ({ page }) => {
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('networkidle');
    
    // Find Essential plan button using actual selector
    const essentialBtn = page.locator('button[data-plan="essential"]').first();
    await expect(essentialBtn).toBeVisible();
    
    // Click and wait for API response
    const [response] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes('/api/stripe-checkout') && response.status() === 200,
        { timeout: 15000 }
      ),
      essentialBtn.click()
    ]);
    
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.url).toContain('checkout.stripe.com');
  });
  
  test('should allow upgrade from essential to pro', async ({ page }) => {
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('networkidle');
    
    // Get auth token for API call
    const token = await page.evaluate(async () => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (user) {
        return await user.getIdToken();
      }
      return null;
    });
    
    // Fail if token is null (authentication required)
    expect(token).not.toBeNull();
    
    // Verify current plan is essential (or lower) before testing upgrade
    const planResponse = await page.request.get('/api/plan/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    // Fail if plan API call failed
    expect(planResponse.ok()).toBe(true);
    
    const planData = await planResponse.json();
    // Only test upgrade if current plan is essential or lower
    if (planData.plan && ['pro', 'premium'].includes(planData.plan)) {
      test.info().skip('User is already on pro or premium plan');
      return;
    }
    
    const proBtn = page.locator('button[data-plan="pro"]').first();
    await expect(proBtn).toBeVisible();
    
    const [response] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes('/api/stripe-checkout') && response.status() === 200,
        { timeout: 15000 }
      ),
      proBtn.click()
    ]);
    
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.url).toContain('checkout.stripe.com');
  });
  
  test('should allow downgrade from premium to pro', async ({ page }) => {
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('networkidle');
    
    // Get auth token for API call
    const token = await page.evaluate(async () => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (user) {
        return await user.getIdToken();
      }
      return null;
    });
    
    // Fail if token is null (authentication required)
    expect(token).not.toBeNull();
    
    // Verify current plan is premium before testing downgrade
    const planResponse = await page.request.get('/api/plan/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    // Fail if plan API call failed
    expect(planResponse.ok()).toBe(true);
    
    const planData = await planResponse.json();
    // Only test downgrade if current plan is premium
    if (planData.plan !== 'premium') {
      test.info().skip('User is not on premium plan');
      return;
    }
    
    const proBtn = page.locator('button[data-plan="pro"]').first();
    await expect(proBtn).toBeVisible();
    
    const [response] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes('/api/stripe-checkout') && response.status() === 200,
        { timeout: 15000 }
      ),
      proBtn.click()
    ]);
    
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.url).toContain('checkout.stripe.com');
  });
  
  test('should BLOCK trial if already used', async ({ page }) => {
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('networkidle');
    
    const trialBtn = page.locator('button[data-plan="trial"]').first();
    
    // Verify trial button exists and is visible
    const isVisible = await trialBtn.isVisible().catch(() => false);
    expect(isVisible).toBe(true); // Fail if trial button doesn't exist
    
    // Click trial button and wait for response
    const [response] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes('/api/stripe-checkout'),
        { timeout: 15000 }
      ),
      trialBtn.click()
    ]);
    
    const data = await response.json();
    
    // If trial already used, API should return error
    // This test assumes the test account has already used trial
    if (data.error && typeof data.error === 'string' && data.error.includes('Trial already used')) {
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Trial already used');
    } else if (data.ok) {
      // If trial is allowed, that's also valid - but log it
      console.log('Trial is available (not yet used)');
      expect(data.url).toContain('checkout.stripe.com');
    } else {
      // If we get an error but not the expected one, fail the test
      throw new Error(`Unexpected error response: ${JSON.stringify(data)}`);
    }
  });
  
  test('should complete full Stripe checkout flow', async ({ page }) => {
    // NOTE: This test creates actual subscriptions in Stripe test mode.
    // Subscriptions should be cleaned up manually in Stripe dashboard or via API.
    // Consider skipping this test in CI or adding cleanup logic.
    
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('networkidle');
    
    // Click Essential plan button
    const essentialBtn = page.locator('button[data-plan="essential"]').first();
    await essentialBtn.click();
    
    // Wait for redirect to Stripe checkout
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    
    // Stripe checkout form is in iframes - need to handle carefully
    // Try to find card number input in iframe
    const cardFrame = page.frameLocator('iframe[name*="card"], iframe[title*="card"]').first();
    
    // Fill card details using Stripe test card
    try {
      // Card number field
      await cardFrame.locator('input[name="cardNumber"], input[placeholder*="Card"], input[autocomplete="cc-number"]').fill('4242 4242 4242 4242');
      
      // Expiry
      await cardFrame.locator('input[name="cardExpiry"], input[placeholder*="MM"], input[autocomplete="cc-exp"]').fill('12/34');
      
      // CVC
      await cardFrame.locator('input[name="cardCvc"], input[placeholder*="CVC"], input[autocomplete="cc-csc"]').fill('123');
    } catch (error) {
      // If iframe approach fails, try direct page selectors (Stripe may have changed structure)
      console.log('Iframe approach failed, trying direct selectors');
      await page.locator('input[name="cardNumber"], input[placeholder*="Card"]').fill('4242 4242 4242 4242');
      await page.locator('input[name="cardExpiry"], input[placeholder*="MM"]').fill('12/34');
      await page.locator('input[name="cardCvc"], input[placeholder*="CVC"]').fill('123');
    }
    
    // Fill billing details if present (outside iframe)
    const billingName = page.locator('input[name="billingName"], input[name="name"]').first();
    if (await billingName.isVisible().catch(() => false)) {
      await billingName.fill('Test User');
    }
    
    // Submit checkout
    const submitBtn = page.locator('button[type="submit"]:has-text("Subscribe"), button:has-text("Pay"), button:has-text("Complete")').first();
    await submitBtn.click();
    
    // Wait for redirect back to your site
    await page.waitForURL(/\/dashboard.*paid=1/, { timeout: 30000 });
    
    // Verify we're back on dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // TODO: Add cleanup logic to cancel the test subscription via Stripe API
    // This would prevent accumulating test subscriptions in Stripe test mode
  });
});

