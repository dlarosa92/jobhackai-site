/**
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend.
 */
import { sendEmail } from '../_lib/email.js';

const FEEDBACK_TO = 'feedback@jobhackai.io';

function corsHeaders(origin) {
  const allowed = [
    'https://jobhackai.io',
    'https://www.jobhackai.io',
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin);
  }

  const message = (body.message || '').trim();
  if (!message) {
    return json({ error: 'Message is required' }, 400, origin);
  }

  const page = (body.page || 'unknown').trim();
  const timestamp = new Date().toISOString();

  // Sanitize page field to prevent HTML injection (same as message)
  const sanitizedPage = page.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `
    <div style="font-family: sans-serif; max-width: 560px;">
      <h2 style="margin:0 0 16px; font-size:18px; color:#1F2937;">New Feedback</h2>
      <table style="border-collapse:collapse; width:100%; font-size:14px; color:#4B5563;">
        <tr>
          <td style="padding:8px 12px; border:1px solid #E5E7EB; font-weight:600; width:100px;">Page</td>
          <td style="padding:8px 12px; border:1px solid #E5E7EB;">${sanitizedPage}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; border:1px solid #E5E7EB; font-weight:600;">Time</td>
          <td style="padding:8px 12px; border:1px solid #E5E7EB;">${timestamp}</td>
        </tr>
      </table>
      <div style="margin-top:16px; padding:16px; background:#F9FAFB; border-radius:8px; font-size:14px; color:#1F2937; white-space:pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>
  `;

  const result = await sendEmail(env, {
    to: FEEDBACK_TO,
    subject: `Feedback from ${sanitizedPage}`,
    html
  });

  if (!result.ok) {
    console.error('[FEEDBACK] Email send failed:', result.error);
    return json({ error: 'Failed to send feedback' }, 502, origin);
  }

  return json({ ok: true }, 200, origin);
}
