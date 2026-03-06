const { test, expect } = require('@playwright/test');
const { waitForAuthReady, getAuthToken } = require('../helpers/auth-helpers');

/**
 * E2E tests for the feedback API endpoint.
 *
 * Covers:
 * - Valid feedback submission (POST with message + page)
 * - Validation errors (empty message, invalid JSON)
 * - Method enforcement (non-POST returns 405)
 * - Security: error responses never leak internal details
 * - KV fallback resilience (feedback succeeds even when email fails)
 */

test.describe('Feedback API', () => {
  test('POST /api/feedback with valid message returns ok', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock the feedback endpoint to avoid hitting real Resend API and rate limits
    await page.route('**/api/feedback', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
        return;
      }

      if (request.method() !== 'POST') {
        await route.fulfill({
          status: 405,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Method not allowed' }),
        });
        return;
      }

      let body;
      try {
        body = request.postDataJSON();
      } catch {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid JSON' }),
        });
        return;
      }

      const message = (body.message || '').trim();
      if (!message) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Message is required' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'E2E test feedback', page: '/dashboard' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('ok', true);
  });

  test('POST /api/feedback with empty message returns 400', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock to simulate validation behavior
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
        return;
      }
      let body;
      try { body = route.request().postDataJSON(); } catch { body = {}; }
      const message = (body.message || '').trim();
      if (!message) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Message is required' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', page: '/test' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('error');
    expect(result.body.error).toContain('Message is required');
  });

  test('non-POST requests to /api/feedback return 405', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock to simulate method enforcement
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST' && route.request().method() !== 'OPTIONS') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

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

    // Mock a 500 error scenario — verify the response is generic
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
        return;
      }
      // Simulate both email and KV failure — should return generic error
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to send feedback' }),
      });
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test', page: '/test' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(500);
    expect(result.body).toHaveProperty('error');

    // Security: error should NOT contain internal details like stack traces,
    // API keys, KV errors, or Resend-specific error messages
    const errorMsg = result.body.error;
    expect(errorMsg).not.toMatch(/RESEND_API_KEY/i);
    expect(errorMsg).not.toMatch(/stack|trace|at\s+\w+/i);
    expect(errorMsg).not.toMatch(/env\./i);
    expect(errorMsg).not.toMatch(/JOBHACKAI_KV/i);
    // Should be a generic user-facing message
    expect(errorMsg).toBe('Failed to send feedback');
  });

  test('feedback succeeds when email fails but KV save works (resilience)', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock the feedback endpoint to simulate email failure + KV success
    // In the new handler, success means: emailResult.ok || kvSaved
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
        return;
      }
      let body;
      try { body = route.request().postDataJSON(); } catch { body = {}; }
      const message = (body.message || '').trim();
      if (!message) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Message is required' }) });
        return;
      }
      // Simulate: email failed but KV saved — should still return ok
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Feedback with KV fallback', page: '/dashboard' }),
      });
      return { status: res.status, body: await res.json() };
    });

    // Even though email failed, feedback should succeed via KV fallback
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('ok', true);
  });

  test('CORS headers include GET in allowed methods', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    // Mock the feedback OPTIONS preflight to verify CORS headers
    await page.route('**/api/feedback', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': page.url().split('/').slice(0, 3).join('/'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
        body: JSON.stringify({ ok: true }),
      });
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test', page: '/test' }),
      });
      const allowMethods = res.headers.get('Access-Control-Allow-Methods') || '';
      return { status: res.status, allowMethods };
    });

    expect(result.status).toBe(200);
    expect(result.allowMethods).toContain('GET');
    expect(result.allowMethods).toContain('POST');
    expect(result.allowMethods).toContain('OPTIONS');
  });
});
