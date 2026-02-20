/**
 * Shared email utility using Resend SDK
 * Requires env.RESEND_API_KEY (Worker secret).
 * Set your real API key: wrangler secret put RESEND_API_KEY --env <env>
 * (Use your Resend API key, e.g. re_xxxxxxxxx, when prompted—do not commit it.)
 */

import { Resend } from 'resend';

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

  const resend = new Resend(env.RESEND_API_KEY);

  try {
    const { data, error } = await resend.emails.send({
      from: 'JobHackAI <noreply@jobhackai.io>',
      to: [to],
      subject,
      html
    });

    if (error) {
      console.error('[EMAIL] Resend API error:', error);
      return { ok: false, error: error.message || String(error) };
    }

    console.log('[EMAIL] Sent successfully:', { to, subject, id: data?.id });
    return { ok: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.message);
    return { ok: false, error: error.message };
  }
}
