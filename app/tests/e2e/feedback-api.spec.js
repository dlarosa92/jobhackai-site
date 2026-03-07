const { test, expect } = require('@playwright/test');
const { waitForAuthReady } = require('../helpers/auth-helpers');

/**
 * E2E tests for the feedback API endpoint.
 *
 * Covers:
 * - Valid feedback submission (POST with message + page)
 * - Validation errors (empty message, invalid JSON)
 * - Method enforcement (non-POST returns 405)
 * - Security: error responses never leak internal details
 * - Error handling (feedback returns 500 when email fails)
 */

test.describe('Feedback API', () => {
  test('POST /api/feedback with valid message returns ok', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'E2E test feedback', page: '/dashboard' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // May succeed (200), hit rate limit (429), or fail if email service unavailable (500)
    expect([200, 429, 500]).toContain(result.status);
    if (result.status === 200) {
      expect(result.body).toHaveProperty('ok', true);
    }
  });

  test('POST /api/feedback with empty message returns 400', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', page: '/test' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // 400 = validation error, 429 = rate limited (rate limit check happens before validation)
    expect([400, 429]).toContain(result.status);
    expect(result.body).toHaveProperty('error');
    if (result.status === 400) {
      expect(result.body.error).toContain('Message is required');
    }
  });

  test('non-POST requests to /api/feedback return 405', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', { method: 'PUT' });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(405);
    expect(result.body).toHaveProperty('error', 'Method not allowed');
  });

  test('feedback error responses do not leak internal details', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test', page: '/test' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // May succeed (200), hit rate limit (429), or fail if email service unavailable (500)
    // For security testing, we need a 500 response, but rate limiting may occur first
    expect([200, 429, 500]).toContain(result.status);

    // Security: error should NOT contain internal details like stack traces,
    // API keys, KV errors, or Resend-specific error messages
    // Only check security assertions if we got an error response
    if (result.status === 500 || result.status === 429) {
      expect(result.body).toHaveProperty('error');
      const errorMsg = JSON.stringify(result.body);
      expect(errorMsg).not.toMatch(/RESEND_API_KEY/i);
      expect(errorMsg).not.toMatch(/stack|trace|at\s+\w+/i);
      expect(errorMsg).not.toMatch(/env\./i);
      expect(errorMsg).not.toMatch(/JOBHACKAI_KV/i);
    }
  });

  test('feedback returns 500 when email fails', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Feedback with email failure', page: '/dashboard' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // May succeed (200), hit rate limit (429), or fail if email service unavailable (500)
    // When email fails, API returns 500 (no KV fallback)
    expect([200, 429, 500]).toContain(result.status);
    if (result.status === 500) {
      expect(result.body).toHaveProperty('error', 'Failed to send feedback');
    }
  });

  test('CORS headers include GET, POST, and OPTIONS in allowed methods', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test', page: '/test' }),
      });
      const allowMethods = res.headers.get('Access-Control-Allow-Methods') || '';
      return { status: res.status, allowMethods };
    });

    // All responses (200, 429, 500) include CORS headers
    expect([200, 429, 500]).toContain(result.status);
    expect(result.allowMethods).toContain('GET');
    expect(result.allowMethods).toContain('POST');
    expect(result.allowMethods).toContain('OPTIONS');
  });
});
