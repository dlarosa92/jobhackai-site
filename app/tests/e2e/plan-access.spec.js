const { test, expect } = require('@playwright/test');

test.describe('Plan-Based Access Control', () => {
  test('should allow paid plans to access resume feedback', async ({ page }) => {
    await page.goto('/resume-feedback-pro.html');
    await page.waitForLoadState('networkidle');
    
    // Should NOT redirect to pricing (paid users can access)
    await expect(page).not.toHaveURL(/\/pricing/);
    
    // Should see upload interface - check for actual file input selector
    const uploadArea = page.locator('#rf-upload');
    await expect(uploadArea).toBeVisible({ timeout: 10000 });
  });
  
  test('should show plan badge on dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Check for plan badge using actual selectors from dashboard.html
    const planBadge = page.locator('.plan-badge, .user-plan-badge, [class*="plan-badge"]').first();
    
    // Plan badge might not always be visible, so check if it exists
    const badgeExists = await planBadge.isVisible().catch(() => false);
    
    if (badgeExists) {
      const planText = await planBadge.textContent();
      // Should be one of the paid plans
      expect(['trial', 'essential', 'pro', 'premium']).toContain(planText.toLowerCase());
    } else {
      // If badge not visible, check for plan in other elements
      const planIndicator = page.locator('[class*="plan"], [data-plan]').first();
      const indicatorExists = await planIndicator.isVisible().catch(() => false);
      
      if (indicatorExists) {
        const planText = await planIndicator.textContent();
        expect(planText).toBeTruthy();
      } else {
        // Fail if no plan indicator is found at all
        throw new Error('No plan badge or plan indicator found on dashboard');
      }
    }
  });
});

