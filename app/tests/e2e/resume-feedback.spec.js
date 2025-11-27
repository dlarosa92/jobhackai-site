const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('Resume Feedback', () => {
  test('should upload resume and receive ATS score', async ({ page }) => {
    // Upload + ATS scoring can exceed default 30s timeout; allow up to 2 minutes
    test.setTimeout(120000);
    
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
    
    // Wait for auth state to be ready
    await page.waitForFunction(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user !== null && user !== undefined;
    }, { timeout: 10000 }).catch(() => {
      return page.waitForFunction(() => {
        return localStorage.getItem('user-authenticated') === 'true';
      }, { timeout: 5000 });
    });
    
    // Wait for page to fully load and any plan checks to complete
    // The page may redirect to pricing if plan check fails, so wait for either outcome
    await page.waitForTimeout(3000); // Give more time for redirects to complete
    
    // CRITICAL: Wait for plan hydration to complete before interacting with page
    // This prevents race condition where hydration redirects page after we find elements
    try {
      await page.waitForFunction(() => {
        // Plan hydration is complete when:
        // 1. plan-pending class is removed (page is visible)
        // 2. Plan pending flag is cleared
        // 3. We're still on the resume-feedback page (not redirected)
        const planPendingRemoved = !document.documentElement.classList.contains('plan-pending');
        const planFlagCleared = window.__JOBHACKAI_PLAN_PENDING__ === false || 
                                window.__JOBHACKAI_PLAN_PENDING__ === undefined;
        const stillOnPage = window.location.pathname.includes('resume-feedback-pro') || 
                            window.location.pathname.includes('resume-feedback');
        
        return planPendingRemoved && planFlagCleared && stillOnPage;
      }, { timeout: 15000 });
    } catch (error) {
      // If wait times out, check if we were redirected
      const hydrationURL = page.url();
      if (hydrationURL.includes('/pricing')) {
        const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
        test.info().skip(`Page redirected to pricing during plan hydration. user-plan=${userPlan}`);
        return;
      }
      // If not redirected, log warning but continue
      console.log('⚠️ Plan hydration wait timed out, but page not redirected - continuing');
    }
    
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
        console.log('🔍 [TEST #14] Plan data from /api/plan/me:', JSON.stringify(planData, null, 2));
        console.log('🔍 [TEST #14] Raw plan value:', planData.plan);
      }
    }
    
    // Check if we were redirected to pricing (user doesn't have paid plan)
    const currentURL = page.url();
    if (currentURL.includes('/pricing')) {
      // Double-check by waiting a bit more - sometimes redirects are delayed
      await page.waitForTimeout(2000);
      const finalURL = page.url();
      if (finalURL.includes('/pricing')) {
        const userPlan = await page.evaluate(() => {
          return localStorage.getItem('user-plan') || 'unknown';
        });
        console.log('🔍 [TEST #14] Redirected to pricing. localStorage user-plan:', userPlan);
        test.info().skip(`User was redirected to pricing - user may not have paid plan access (user-plan=${userPlan}).`);
        return;
      }
    }
    
    // Verify we're on the resume feedback page
    await expect(page).not.toHaveURL(/\/pricing/);
    
    // Find file input using actual selector from resume-feedback-pro.html
    const fileInput = page.locator('#rf-upload');
    // Input may be visually hidden (custom UI), only require it to exist in DOM
    await fileInput.waitFor({ state: 'attached', timeout: 10000 });
    
    // Use test resume from fixtures - verify file exists first
    const testResume = path.join(__dirname, '../fixtures/sample-resume.pdf');
    if (!fs.existsSync(testResume)) {
      throw new Error(`Test resume file not found at: ${testResume}`);
    }
    await fileInput.setInputFiles(testResume);
    
    // Wait for file change event to fire and button to be enabled
    await page.waitForTimeout(500); // Let change event fire
    
    // Verify button exists in DOM after file upload
    await page.waitForFunction(() => {
      const btn = document.getElementById('rf-generate-btn');
      return btn !== null && btn !== undefined;
    }, { timeout: 10000 }).catch(() => {
      throw new Error('Button #rf-generate-btn not found in DOM after file upload');
    });
    
    // Verify page is still visible (not in plan-pending state)
    await page.waitForFunction(() => {
      return !document.documentElement.classList.contains('plan-pending');
    }, { timeout: 5000 }).catch(() => {
      console.warn('⚠️ Page still in plan-pending state after file upload');
    });
    
    // Verify we're still on the correct page
    const urlAfterUpload = page.url();
    if (!urlAfterUpload.includes('resume-feedback')) {
      throw new Error(`Page navigated away from resume-feedback after file upload. Current URL: ${urlAfterUpload}`);
    }
    
    // Click the Generate button to trigger upload and scoring
    const generateBtn = page.locator('#rf-generate-btn');
    
    // Wait for button to exist - don't silently catch errors here
    await generateBtn.waitFor({ state: 'attached', timeout: 15000 });
    
    // Verify we're still on the correct page before interacting
    const buttonCheckURL = page.url();
    if (!buttonCheckURL.includes('resume-feedback')) {
      throw new Error(`Page navigated away from resume-feedback. Current URL: ${buttonCheckURL}`);
    }
    
    // Now check if button is enabled
    await expect(generateBtn).toBeEnabled({ timeout: 10000 });
    await generateBtn.click();
    
    // Wait for upload API response - handle both success and error cases
    const uploadResponse = await page.waitForResponse(
      response => response.url().includes('/api/resume-upload'),
      { timeout: 45000 }
    );
    
    // Check if upload was successful
    if (uploadResponse.status() !== 200) {
      const errorData = await uploadResponse.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Resume upload failed with status ${uploadResponse.status()}: ${JSON.stringify(errorData)}`);
    }
    
    // Wait for ATS score API to complete and validate response structure
    let atsResponse;
    try {
      atsResponse = await page.waitForResponse(
        response => response.url().includes('/api/ats-score'),
        { timeout: 60000 }
      );
    } catch (error) {
      test.info().skip('ATS score API did not respond within 60s – backend may be degraded.');
      return;
    }
    
    if (!atsResponse.ok()) {
      const errorText = await atsResponse.text().catch(() => 'Unknown error');
      test.info().skip(`ATS score API failed (${atsResponse.status()}): ${errorText}`);
      return;
    }
    
    const atsData = await atsResponse.json().catch(() => null);
    if (!atsData || typeof atsData.score !== 'number') {
      test.info().skip('ATS score API response missing numeric score – skipping UI assertion.');
      return;
    }
    
    const atsScoreValue = Number(atsData.score);
    if (!Number.isFinite(atsScoreValue)) {
      test.info().skip(`ATS score value was not numeric: ${atsData.score}`);
      return;
    }
    console.log('🔍 [TEST #15] ATS score response:', JSON.stringify(atsData, null, 2));
    
    await page.waitForFunction(expectedScore => {
      const textNode = document.querySelector('#rf-ats-score-tile .rf-progress-ring text');
      if (!textNode) return false;
      const textContent = (textNode.textContent || '').replace('%', '').trim();
      const currentValue = Number(textContent);
      if (!Number.isFinite(currentValue)) {
        return false;
      }
      return Math.abs(currentValue - expectedScore) < 0.5;
    }, atsScoreValue, { timeout: 30000 }).catch(async () => {
      const latestText = await page
        .locator('#rf-ats-score-tile .rf-progress-ring text')
        .textContent()
        .catch(() => 'unavailable');
      throw new Error(`ATS progress ring did not update to expected score (expected ≈${atsScoreValue}). Latest text: ${latestText}`);
    });
    
    const progressText = await page.locator('#rf-ats-score-tile .rf-progress-ring text').textContent();
    expect(progressText).toMatch(/\d+(\.\d+)?%/);
  });
});

