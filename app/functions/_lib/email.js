/**
 * Shared email utility using Resend API
 * Requires env.RESEND_API_KEY (Worker secret)
 */

/**
 * Send an email via Resend
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
    const res = await fetch('https://api.resend.com/emails', {
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
      const errorData = await res.text().catch(() => '');
      console.error('[EMAIL] Resend API error:', res.status, errorData);
      return { ok: false, error: `Resend API returned ${res.status}` };
    }

    console.log('[EMAIL] Sent successfully:', { to, subject });
    return { ok: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.message);
    return { ok: false, error: error.message };
  }
}
