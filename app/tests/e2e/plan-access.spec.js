const { test, expect } = require('@playwright/test');

test.describe('Plan-Based Access Control', () => {
  test('should allow paid plans to access resume feedback', async ({ page }) => {
    await page.goto('/resume-feedback-pro.html');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for auth to be ready using FirebaseAuthManager or localStorage fallback
    await page.waitForFunction(() => {
      // Preferred: FirebaseAuthManager
      const mgr = window.FirebaseAuthManager;
      if (mgr && typeof mgr.getCurrentUser === 'function') {
        const u = mgr.getCurrentUser();
        return u !== null && u !== undefined;
      }

      // Fallback: localStorage flags used by navigation & static-auth-guard
      try {
        const isAuth = localStorage.getItem('user-authenticated') === 'true';
        const email = localStorage.getItem('user-email');
        return isAuth && !!email;
      } catch {
        return false;
      }
    }, { timeout: 10000 });
    
    // Wait for auth state to be ready (user might not be set immediately)
    await page.waitForFunction(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user !== null && user !== undefined;
    }, { timeout: 10000 }).catch(() => {
      // Fallback: check localStorage for auth state
      return page.waitForFunction(() => {
        return localStorage.getItem('user-authenticated') === 'true';
      }, { timeout: 5000 });
    });
    
    // Wait a bit for any redirects to complete
    await page.waitForTimeout(2000);
    
    // DEBUG: Check plan from API before checking redirect
    const token = await page.evaluate(async () => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (user) {
        return await user.getIdToken();
      }
      return null;
    });
    
    if (token) {
      const planResponse = await page.request.get('/api/plan/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (planResponse.ok()) {
        const planData = await planResponse.json();
        console.log('🔍 [TEST #12] Plan data from /api/plan/me:', JSON.stringify(planData, null, 2));
        console.log('🔍 [TEST #12] Raw plan value:', planData.plan);
      }
    }
    
    // Should NOT redirect to pricing (paid users can access)
    const currentURL = page.url();
    if (currentURL.includes('/pricing')) {
      const userPlan = await page.evaluate(() => {
        return localStorage.getItem('user-plan') || 'unknown';
      });
      console.log('🔍 [TEST #12] Redirected to pricing. localStorage user-plan:', userPlan);
      throw new Error(`Paid plan access blocked: redirected to pricing (${currentURL}). user-plan=${userPlan}`);
    }
    
    await expect(page).not.toHaveURL(/\/pricing/);
    
    // Should see upload interface - check for actual file input selector
    const uploadArea = page.locator('#rf-upload');
    const isVisible = await uploadArea.isVisible({ timeout: 10000 }).catch(() => false);
    if (!isVisible) {
      const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
      console.log('🔍 [TEST #12] Upload input hidden on resume-feedback page. user-plan=', userPlan);
      throw new Error(`Upload input hidden on resume-feedback page. user-plan=${userPlan}`);
    }
    await expect(uploadArea).toBeVisible({ timeout: 10000 });
  });
  
  test('should show plan badge on dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for Firebase auth to be ready (badge is rendered after auth state is loaded)
    await page.waitForFunction(() => {
      return window.FirebaseAuthManager !== undefined && 
             typeof window.FirebaseAuthManager.getCurrentUser === 'function';
    }, { timeout: 10000 });
    
    // Wait for auth state to be ready
    await page.waitForFunction(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user !== null && user !== undefined;
    }, { timeout: 10000 }).catch(() => {
      return page.waitForFunction(() => {
        return localStorage.getItem('user-authenticated') === 'true';
      }, { timeout: 5000 });
    });
    
    // Wait for dashboard to finish rendering (badge is rendered dynamically via JavaScript)
    // The badge appears in the status-action-row after the dashboard banner is rendered
    await page.waitForSelector('.user-plan-badge, .status-action-row', { timeout: 15000 }).catch(() => {
      // If selector not found, wait a bit more for dynamic content
      return page.waitForTimeout(2000);
    });
    
    // Check for plan badge using actual selectors from dashboard.html
    const planBadge = page.locator('.user-plan-badge').first();
    
    // Plan badge should be visible after dashboard renders
    const badgeExists = await planBadge.isVisible({ timeout: 10000 }).catch(() => false);
    
    if (badgeExists) {
      const planText = await planBadge.textContent();
      // Trim whitespace and extract plan name (handle cases like "Trial Plan" or " essential ")
      const normalizedPlan = planText.trim().toLowerCase();
      const validPlans = ['trial', 'essential', 'pro', 'premium'];
      
      // Check if any valid plan name is contained in the text
      const foundPlan = validPlans.find(plan => normalizedPlan.includes(plan));
      expect(foundPlan).toBeTruthy();
    } else {
      // If badge not visible, check for plan in other elements
      // Use more specific selectors to avoid false positives (e.g., "airplane", "explanation")
      const planIndicator = page.locator('[class*="plan-badge"], [class*="user-plan"], [data-plan], [class*="subscription-plan"]').first();
      const indicatorExists = await planIndicator.isVisible().catch(() => false);
      
      if (indicatorExists) {
        const planText = await planIndicator.textContent();
        // Apply same validation as first branch to ensure consistency
        const normalizedPlan = planText.trim().toLowerCase();
        const validPlans = ['trial', 'essential', 'pro', 'premium'];
        
        // Check if any valid plan name is contained in the text
        const foundPlan = validPlans.find(plan => normalizedPlan.includes(plan));
        expect(foundPlan).toBeTruthy();
      } else {
        const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
        throw new Error(`No plan badge or plan indicator found on dashboard. user-plan=${userPlan}`);
      }
    }
  });
});

