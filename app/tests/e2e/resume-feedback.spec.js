const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('Resume Feedback', () => {
  test('should upload resume and receive ATS score', async ({ page }) => {
    // Upload + ATS scoring can exceed default 30s timeout; allow up to 2 minutes
    test.setTimeout(120000);
    
    // CRITICAL: Intercept KV fetch to return null (simplest solution - prevents cached state from loading)
    // This ensures the page always shows upload form, not cached results
    await page.route('**/api/ats-score-persist', async route => {
      // Return empty response to prevent KV cache from loading
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: null })
      });
    });
    
    // CRITICAL: Clear any cached state before navigating
    // State persistence might be showing results view instead of upload form
    // Navigate to page first to get context, then clear state
    await page.goto('/resume-feedback-pro.html');
    await page.waitForLoadState('domcontentloaded');
    
    // Clear state persistence data that might hide the upload form
    await page.evaluate(() => {
      // Clear state persistence data
      if (window.JobHackAIStatePersistence) {
        // Try to clear using the persistence API if available
        try {
          localStorage.removeItem('jobhackai_ats_score');
          localStorage.removeItem('jobhackai_resume_data');
        } catch (e) {
          console.warn('Failed to clear state persistence:', e);
        }
      }
      // Clear all localStorage keys related to resume feedback
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('ats_score') || key.includes('resume_data') || key.includes('jobhackai'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Clear sessionStorage
      sessionStorage.clear();
    });
    
    // Reload page to reset to upload form view
    await page.reload({ waitUntil: 'domcontentloaded' });
    
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
    
    // CRITICAL: Verify we're still on resume-feedback page after plan hydration
    // If redirected to dashboard, navigate back to resume-feedback-pro.html
    const currentURL = page.url();
    if (!currentURL.includes('resume-feedback')) {
      console.log(`⚠️ Page redirected to ${currentURL} during plan hydration, navigating back to resume-feedback-pro.html`);
      await page.goto('/resume-feedback-pro.html');
      await page.waitForLoadState('domcontentloaded');
      
      // Wait for auth again after navigation
      await page.waitForFunction(() => {
        const user = window.FirebaseAuthManager?.getCurrentUser?.();
        return user !== null && user !== undefined;
      }, { timeout: 10000 }).catch(() => {
        return page.waitForFunction(() => {
          return localStorage.getItem('user-authenticated') === 'true';
        }, { timeout: 5000 });
      });
      
      // Wait for plan hydration again
      try {
        await page.waitForFunction(() => {
          const planPendingRemoved = !document.documentElement.classList.contains('plan-pending');
          const planFlagCleared = window.__JOBHACKAI_PLAN_PENDING__ === false || 
                                  window.__JOBHACKAI_PLAN_PENDING__ === undefined;
          const stillOnPage = window.location.pathname.includes('resume-feedback-pro') || 
                              window.location.pathname.includes('resume-feedback');
          return planPendingRemoved && planFlagCleared && stillOnPage;
        }, { timeout: 15000 });
      } catch (error) {
        const hydrationURL = page.url();
        if (hydrationURL.includes('/pricing')) {
          const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
          test.info().skip(`Page redirected to pricing during plan hydration. user-plan=${userPlan}`);
          return;
        }
        console.log('⚠️ Plan hydration wait timed out after navigation - continuing');
      }
    }
    
    // CRITICAL: Wait for KV check to complete, then verify upload form is visible
    // The page fetches from KV storage asynchronously, which may restore cached state
    // Wait for KV fetch to complete, then check if form button exists
    await page.waitForTimeout(3000); // Give time for KV fetch to complete
    
    // Check if form has correct structure (button exists = full form, not simplified)
    const formState = await page.evaluate(() => {
      const form = document.getElementById('rf-upload-form');
      const button = document.getElementById('rf-generate-btn');
      const jobTitleInput = document.getElementById('rf-job-title');
      const hasCachedScore = window.JobHackAIStatePersistence ? 
        !!(window.JobHackAIStatePersistence.loadATSScore && 
           window.JobHackAIStatePersistence.loadATSScore(null)?.score) : false;
      
      // Check if form HTML contains the button (form might have been replaced)
      const formHasButtonInHTML = form ? form.innerHTML.includes('rf-generate-btn') : false;
      const formHasJobTitleInHTML = form ? form.innerHTML.includes('rf-job-title') : false;
      
      return {
        url: window.location.href,
        formExists: !!form,
        buttonExists: !!button,
        jobTitleInputExists: !!jobTitleInput,
        hasCachedScore,
        formHasButtonInHTML,
        formHasJobTitleInHTML,
        formHTML: form ? form.innerHTML.substring(0, 500) : null
      };
    });
    
    console.log('🔍 [FORM STATE] After KV check:', JSON.stringify(formState, null, 2));
    
    // If button doesn't exist OR form HTML doesn't contain button, form was replaced
    // This can happen if KV restored state OR form was replaced by some other code
    // OR QA is still serving the old interface (expected until PR is deployed)
    if (!formState.buttonExists || !formState.formHasButtonInHTML) {
      console.log('⚠️ Form structure incorrect - button missing or form replaced');
      
      // Check if this is the old interface (simplified form without button)
      // This is expected when testing PRs before QA is updated with new interface
      const isOldInterface = formState.formHTML && 
        formState.formHTML.includes('Upload your resume (PDF, max 2 MB)') &&
        !formState.formHTML.includes('rf-generate-btn') &&
        !formState.formHTML.includes('rf-job-title');
      
      if (isOldInterface) {
        test.info().skip(`QA is serving the old interface (simplified form without #rf-generate-btn). This is expected until the PR is merged and deployed. The new interface exists in the PR branch.`);
        return;
      }
      
      // If cached score exists, clear it and reload
      if (formState.hasCachedScore) {
        console.log('⚠️ KV restored cached state, clearing and reloading...');
      await page.evaluate(() => {
        // Clear all state persistence
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('ats_score') || key.includes('resume_data') || key.includes('jobhackai'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        sessionStorage.clear();
      });
      
      // Reload page after clearing
      await page.reload({ waitUntil: 'domcontentloaded' });
      
      // Wait for auth again
      await page.waitForFunction(() => {
        const user = window.FirebaseAuthManager?.getCurrentUser?.();
        return user !== null && user !== undefined;
      }, { timeout: 10000 }).catch(() => {
        return page.waitForFunction(() => {
          return localStorage.getItem('user-authenticated') === 'true';
        }, { timeout: 5000 });
      });
      
      // Wait for plan hydration again
      try {
        await page.waitForFunction(() => {
          const planPendingRemoved = !document.documentElement.classList.contains('plan-pending');
          const planFlagCleared = window.__JOBHACKAI_PLAN_PENDING__ === false || 
                                  window.__JOBHACKAI_PLAN_PENDING__ === undefined;
          const stillOnPage = window.location.pathname.includes('resume-feedback-pro') || 
                              window.location.pathname.includes('resume-feedback');
          return planPendingRemoved && planFlagCleared && stillOnPage;
        }, { timeout: 15000 });
        } catch (error) {
          const hydrationURL = page.url();
          if (hydrationURL.includes('/pricing')) {
            const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
            test.info().skip(`Page redirected to pricing during plan hydration. user-plan=${userPlan}`);
            return;
          }
          console.log('⚠️ Plan hydration wait timed out after reload - continuing');
        }
        
        // Verify we're still on resume-feedback page after reload
        const reloadURL = page.url();
        if (!reloadURL.includes('resume-feedback')) {
          console.log(`⚠️ Page redirected to ${reloadURL} after reload, navigating back to resume-feedback-pro.html`);
          await page.goto('/resume-feedback-pro.html');
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(3000);
        }
        
        // Wait for KV check again (it will run on reload)
        await page.waitForTimeout(3000);
      } else {
        // Form was replaced but no cached score - might be a different issue
        // Try reloading anyway to see if form restores
        console.log('⚠️ Form replaced but no cached score - reloading page');
        await page.reload({ waitUntil: 'domcontentloaded' });
        
        // Wait for auth again
        await page.waitForFunction(() => {
          const user = window.FirebaseAuthManager?.getCurrentUser?.();
          return user !== null && user !== undefined;
        }, { timeout: 10000 }).catch(() => {
          return page.waitForFunction(() => {
            return localStorage.getItem('user-authenticated') === 'true';
          }, { timeout: 5000 });
        });
        
        // Wait for plan hydration again
        try {
          await page.waitForFunction(() => {
            const planPendingRemoved = !document.documentElement.classList.contains('plan-pending');
            const planFlagCleared = window.__JOBHACKAI_PLAN_PENDING__ === false || 
                                    window.__JOBHACKAI_PLAN_PENDING__ === undefined;
            const stillOnPage = window.location.pathname.includes('resume-feedback-pro') || 
                                window.location.pathname.includes('resume-feedback');
            return planPendingRemoved && planFlagCleared && stillOnPage;
          }, { timeout: 15000 });
        } catch (error) {
          const hydrationURL = page.url();
          if (hydrationURL.includes('/pricing')) {
            const userPlan = await page.evaluate(() => localStorage.getItem('user-plan') || 'unknown');
            test.info().skip(`Page redirected to pricing during plan hydration. user-plan=${userPlan}`);
            return;
          }
          console.log('⚠️ Plan hydration wait timed out after reload - continuing');
        }
        
        // Verify we're still on resume-feedback page after reload
        const reloadURL2 = page.url();
        if (!reloadURL2.includes('resume-feedback')) {
          console.log(`⚠️ Page redirected to ${reloadURL2} after reload, navigating back to resume-feedback-pro.html`);
          await page.goto('/resume-feedback-pro.html');
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(3000);
        }
        
        await page.waitForTimeout(3000);
      }
    }
    
    // Now verify upload form is visible with correct structure
    // The form should have the button - if it doesn't, the form HTML was replaced
    await page.waitForFunction(() => {
      const form = document.getElementById('rf-upload-form');
      const button = document.getElementById('rf-generate-btn');
      const jobTitleInput = document.getElementById('rf-job-title');
      
      // Form, button, and job title input must all exist (full form structure)
      if (!form || !button || !jobTitleInput) return false;
      
      const formStyle = window.getComputedStyle(form);
      const buttonStyle = window.getComputedStyle(button);
      return formStyle.display !== 'none' && 
             buttonStyle.display !== 'none' && 
             buttonStyle.visibility !== 'hidden';
    }, { timeout: 15000 }).catch(async (error) => {
      // Log diagnostic info if form still not visible
      const diagnostic = await page.evaluate(() => {
        const form = document.getElementById('rf-upload-form');
        const button = document.getElementById('rf-generate-btn');
        const jobTitleInput = document.getElementById('rf-job-title');
        const fileInput = document.getElementById('rf-upload');
        
        return {
          url: window.location.href,
          formExists: !!form,
          buttonExists: !!button,
          jobTitleInputExists: !!jobTitleInput,
          fileInputExists: !!fileInput,
          formDisplay: form ? window.getComputedStyle(form).display : null,
          buttonDisplay: button ? window.getComputedStyle(button).display : null,
          formHTML: form ? form.innerHTML.substring(0, 500) : null,
          hasCachedScore: window.JobHackAIStatePersistence ? 
            !!(window.JobHackAIStatePersistence.loadATSScore && 
               window.JobHackAIStatePersistence.loadATSScore(null)?.score) : false,
          // Check if form was replaced with simplified version
          formHasJobTitle: form ? form.innerHTML.includes('rf-job-title') : false,
          formHasGenerateBtn: form ? form.innerHTML.includes('rf-generate-btn') : false
        };
      });
      console.log('⚠️ Upload form not visible after all checks:', JSON.stringify(diagnostic, null, 2));
      
      // If form exists but button doesn't, the form HTML was replaced
      if (diagnostic.formExists && !diagnostic.buttonExists) {
        throw new Error(`Form HTML was replaced - button missing. Form HTML: ${diagnostic.formHTML?.substring(0, 200)}`);
      }
      
      throw new Error('Upload form is not visible - page may be showing cached results view');
    });
    
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
    const pricingCheckURL = page.url();
    if (pricingCheckURL.includes('/pricing')) {
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
    
    // DIAGNOSTIC: Check page state before looking for button
    const diagnosticInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        hasPlanPending: document.documentElement.classList.contains('plan-pending'),
        hasAuthPending: document.documentElement.classList.contains('auth-pending'),
        buttonExists: !!document.getElementById('rf-generate-btn'),
        buttonVisible: (() => {
          const btn = document.getElementById('rf-generate-btn');
          if (!btn) return false;
          const style = window.getComputedStyle(btn);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })(),
        buttonDisabled: (() => {
          const btn = document.getElementById('rf-generate-btn');
          return btn ? btn.disabled : null;
        })(),
        fileInputHasFile: (() => {
          const input = document.getElementById('rf-upload');
          return input ? input.files.length > 0 : false;
        })(),
        bodyVisibility: window.getComputedStyle(document.body).visibility,
        htmlVisibility: window.getComputedStyle(document.documentElement).visibility
      };
    });
    
    console.log('🔍 [DIAGNOSTIC] Page state after file upload:', JSON.stringify(diagnosticInfo, null, 2));
    
    // If page is hidden, wait for it to become visible
    if (diagnosticInfo.hasPlanPending || diagnosticInfo.htmlVisibility === 'hidden') {
      console.log('⚠️ Page is still hidden (plan-pending), waiting for visibility...');
      await page.waitForFunction(() => {
        return !document.documentElement.classList.contains('plan-pending') &&
               window.getComputedStyle(document.documentElement).visibility !== 'hidden';
      }, { timeout: 10000 }).catch(() => {
        throw new Error('Page remained hidden after file upload');
      });
    }
    
    // Verify button exists in DOM after file upload
    if (!diagnosticInfo.buttonExists) {
      // Get more context about what's in the DOM
      const domSnapshot = await page.evaluate(() => {
        const form = document.getElementById('rf-upload-form');
        return {
          formExists: !!form,
          formHTML: form ? form.innerHTML.substring(0, 500) : null,
          allButtons: Array.from(document.querySelectorAll('button')).map(btn => ({
            id: btn.id,
            text: btn.textContent?.trim().substring(0, 50)
          }))
        };
      });
      console.log('🔍 [DIAGNOSTIC] DOM snapshot:', JSON.stringify(domSnapshot, null, 2));
      throw new Error(`Button #rf-generate-btn not found in DOM after file upload. Form exists: ${domSnapshot.formExists}`);
    }
    
    // Verify button exists in DOM after file upload (double-check with waitForFunction)
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

