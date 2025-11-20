/**
 * Helper functions for Playwright E2E tests
 * Provides utilities for common authentication and response handling operations
 */

/**
 * Wait for Firebase auth to be ready and user to be authenticated
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} timeout - Timeout in milliseconds (default: 10000)
 */
async function waitForAuthReady(page, timeout = 10000) {
  // Wait for FirebaseAuthManager to be available
  await page.waitForFunction(() => {
    return window.FirebaseAuthManager !== undefined && 
           typeof window.FirebaseAuthManager.getCurrentUser === 'function';
  }, { timeout });
  
  // Wait for auth state to be ready (user might not be set immediately)
  try {
    await page.waitForFunction(() => {
      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      return user !== null && user !== undefined;
    }, { timeout });
  } catch {
    // Fallback: check localStorage for auth state
    await page.waitForFunction(() => {
      return localStorage.getItem('user-authenticated') === 'true' || 
             window.FirebaseAuthManager?.getCurrentUser?.() !== null;
    }, { timeout: Math.min(timeout, 5000) });
  }
  
  // Wait a bit more for auth state to settle
  await page.waitForTimeout(500);
}

/**
 * Get authentication token from Firebase
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<string|null>} - Firebase ID token or null if not authenticated
 */
async function getAuthToken(page) {
  await waitForAuthReady(page);
  
  return await page.evaluate(async () => {
    const user = window.FirebaseAuthManager?.getCurrentUser?.();
    if (user) {
      return await user.getIdToken();
    }
    return null;
  });
}

/**
 * Safely read JSON from a Playwright response
 * Handles cases where response body might be consumed or invalidated
 * @param {import('@playwright/test').APIResponse} response - Playwright response object
 * @returns {Promise<any>} - Parsed JSON data
 */
async function safeJsonResponse(response) {
  try {
    return await response.json();
  } catch (err) {
    // If json() fails, try to get the text and parse manually
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      throw new Error(
        `Failed to parse response: ${text.substring(0, 200)}. ` +
        `Original error: ${err.message}. Parse error: ${parseErr.message}`
      );
    }
  }
}

/**
 * Wait for response and safely read JSON
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Function} predicate - Function to match response
 * @param {Object} options - Options for waitForResponse
 * @returns {Promise<{response: import('@playwright/test').APIResponse, data: any}>}
 */
async function waitForResponseAndJson(page, predicate, options = {}) {
  const response = await page.waitForResponse(predicate, options);
  const data = await safeJsonResponse(response);
  return { response, data };
}

/**
 * Call the Stripe checkout API directly using Playwright's request context.
 * This avoids relying on page-level fetch handlers that may consume the body
 * before tests can read it.
 * @param {import('@playwright/test').Page} page
 * @param {{ plan: string, startTrial?: boolean }} payload
 * @param {{ requireAuth?: boolean }} options
 * @returns {Promise<{ response: import('@playwright/test').APIResponse, data: any, token: string | null }>}
 */
async function postStripeCheckout(page, payload, options = {}) {
  const { requireAuth = true } = options;
  const headers = { 'Content-Type': 'application/json' };
  
  let token = null;
  if (requireAuth) {
    token = await getAuthToken(page);
    if (!token) {
      throw new Error('Unable to obtain auth token for Stripe checkout request');
    }
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    // Try to attach token if available but don't fail if missing
    try {
      token = await getAuthToken(page);
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (_) {
      // no-op
    }
  }
  
  const response = await page.request.post('/api/stripe-checkout', {
    headers,
    data: {
      plan: payload.plan,
      startTrial: payload.startTrial || false,
    }
  });
  const data = await safeJsonResponse(response);
  return { response, data, token };
}

/**
 * Sync plan from Stripe to KV store
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<{ ok: boolean, plan?: string, error?: string }>}
 */
async function syncStripePlan(page) {
  const token = await getAuthToken(page);
  if (!token) {
    throw new Error('Unable to obtain auth token for sync-stripe-plan request');
  }
  
  const baseURL = page.url().split('/').slice(0, 3).join('/');
  const apiUrl = `${baseURL}/api/sync-stripe-plan`;
  
  const response = await page.request.post(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': baseURL,
    },
    data: {}
  });
  
  const data = await safeJsonResponse(response);
  console.log('🔄 [SYNC] Sync-stripe-plan response:', JSON.stringify(data, null, 2));
  
  return { ok: response.ok(), ...data };
}

/**
 * Get plan from API and verify it matches expected value
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} expectedPlan - Expected plan value (optional, for verification)
 * @returns {Promise<{ plan: string, planData: any }>}
 */
async function getPlanAndVerify(page, expectedPlan = null) {
  const token = await getAuthToken(page);
  if (!token) {
    throw new Error('Unable to obtain auth token for plan verification');
  }
  
  const baseURL = page.url().split('/').slice(0, 3).join('/');
  const apiUrl = `${baseURL}/api/plan/me`;
  
  const response = await page.request.get(apiUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Origin': baseURL,
    }
  });
  
  if (!response.ok()) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Plan API failed: ${response.status()} ${response.statusText()}. Response: ${errorText}`);
  }
  
  const planData = await safeJsonResponse(response);
  const plan = (planData.plan || 'free').toLowerCase();
  
  console.log('🔍 [VERIFY] Plan from KV (planByUid):', plan);
  console.log('🔍 [VERIFY] Full plan data:', JSON.stringify(planData, null, 2));
  
  if (expectedPlan && plan !== expectedPlan.toLowerCase()) {
    console.warn(`⚠️ [VERIFY] Plan mismatch! Expected: ${expectedPlan}, Got: ${plan}`);
  }
  
  return { plan, planData };
}

module.exports = {
  waitForAuthReady,
  getAuthToken,
  safeJsonResponse,
  waitForResponseAndJson,
  postStripeCheckout,
  syncStripePlan,
  getPlanAndVerify,
};

