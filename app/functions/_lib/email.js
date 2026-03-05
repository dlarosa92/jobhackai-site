/**
 * Shared email utility using Resend HTTP API (no SDK dependency).
 * Requires env.RESEND_API_KEY (Worker secret).
 * Set your real API key: wrangler secret put RESEND_API_KEY --env <env>
 * (Use your Resend API key, e.g. re_xxxxxxxxx, when prompted—do not commit it.)
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Send an email via Resend HTTP API
 * @param {Object} env - Cloudflare environment with RESEND_API_KEY
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn('[EMAIL] RESEND_API_KEY not configured, skipping email');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'JobHackAI <noreply@jobhackai.io>',
        to: [to],
        subject,
        html
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[EMAIL] Resend API error:', data);
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }

    console.log('[EMAIL] Sent successfully:', { to, subject, id: data?.id });
    return { ok: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.message);
    return { ok: false, error: error.message };
  }
}
