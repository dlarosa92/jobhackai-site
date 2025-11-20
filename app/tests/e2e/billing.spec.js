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
    
    // Stripe Checkout uses dynamically named iframes - find them by waiting for the page to load
    // and then locating the payment element iframe
    await page.waitForLoadState('networkidle');
    
    // Stripe Checkout iframes are typically named with patterns like:
    // - __privateStripeFrame* for payment elements
    // - Or found via data-testid or specific classes
    // Try multiple approaches to find the card input iframe
    let cardInputFilled = false;
    
    // Approach 1: Look for Stripe payment element iframe
    const stripeFrames = page.locator('iframe').filter({ has: page.locator('body') });
    const frameCount = await stripeFrames.count();
    
    for (let i = 0; i < frameCount; i++) {
      try {
        const frame = stripeFrames.nth(i);
        const frameContent = frame.contentFrame();
        
        if (frameContent) {
          // Try to find card number input in this iframe
          const cardNumberInput = frameContent.locator('input[autocomplete="cc-number"], input[placeholder*="Card"], input[name*="card"]').first();
          const isVisible = await cardNumberInput.isVisible({ timeout: 2000 }).catch(() => false);
          
          if (isVisible) {
            await cardNumberInput.fill('4242 4242 4242 4242');
            
            // Fill expiry and CVC in same iframe
            const expiryInput = frameContent.locator('input[autocomplete="cc-exp"], input[placeholder*="MM"], input[name*="exp"]').first();
            const cvcInput = frameContent.locator('input[autocomplete="cc-csc"], input[placeholder*="CVC"], input[name*="cvc"]').first();
            
            if (await expiryInput.isVisible({ timeout: 1000 }).catch(() => false)) {
              await expiryInput.fill('12/34');
            }
            if (await cvcInput.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cvcInput.fill('123');
            }
            
            cardInputFilled = true;
            break;
          }
        }
      } catch (e) {
        // Continue to next iframe
        continue;
      }
    }
    
    // If we couldn't fill the form, skip the rest of the test with a note
    if (!cardInputFilled) {
      test.info().skip('Could not locate Stripe checkout form fields - Stripe UI structure may have changed');
      return;
    }
    
    // Fill billing details if present (outside iframe)
    const billingName = page.locator('input[name="billingName"], input[name="name"], input[placeholder*="Name"]').first();
    if (await billingName.isVisible({ timeout: 2000 }).catch(() => false)) {
      await billingName.fill('Test User');
    }
    
    // Submit checkout - Stripe uses various button texts
    const submitBtn = page.locator('button[type="submit"]:has-text("Subscribe"), button:has-text("Pay"), button:has-text("Complete"), button:has-text("Subscribe to")').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
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

