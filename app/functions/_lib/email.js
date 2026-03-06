/**
 * Shared email utility using Resend HTTP API (no SDK dependency).
 * Requires env.RESEND_API_KEY (Worker secret).
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

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed;
      try { parsed = JSON.parse(text); } catch (_e) { /* not JSON */ }
      const detail = (parsed && (parsed.message || parsed.error)) || `HTTP ${res.status}: ${text.slice(0, 200)}`;
      console.error('[EMAIL] Resend API error:', res.status, detail);
      return { ok: false, error: detail };
    }

    const data = await res.json().catch(() => null);
    console.log('[EMAIL] Sent successfully:', { to, subject, id: data?.id });
    return { ok: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.message);
    return { ok: false, error: error.message };
  }
}
