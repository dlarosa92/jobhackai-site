/**
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend HTTP API.
 *
 * Self-contained handler — no cross-directory imports so that the Cloudflare
 * Pages bundler can compile this file regardless of which functions/ directory
 * the build picks up.
 */

const FEEDBACK_TO = 'feedback@jobhackai.io';
const RESEND_API_URL = 'https://api.resend.com/emails';

function corsHeaders(origin, env) {
  const fallbackOrigins = [
    'https://jobhackai.io',
    'https://www.jobhackai.io',
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || fallbackOrigins[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
  });
}

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn('[EMAIL] RESEND_API_KEY not configured');
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
      let data;
      try {
        data = await res.json();
      } catch {
        // Response is not JSON (e.g., HTML error page from proxy)
        return { ok: false, error: `HTTP ${res.status}` };
      }
      console.error('[EMAIL] Resend API error:', data);
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      // Response is not JSON, but email was sent successfully (res.ok was true)
      console.log('[EMAIL] Sent successfully:', { to, subject });
      return { ok: true };
    }

    console.log('[EMAIL] Sent successfully:', { to, subject, id: data?.id });
    return { ok: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error.message);
    return { ok: false, error: error.message };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin, env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin, env);
    }

    // Rate limiting: 1 request per minute per IP
    if (env.JOBHACKAI_KV) {
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = `feedbackRateLimit:${clientIp}`;
      const lastRequest = await env.JOBHACKAI_KV.get(rateLimitKey);
      if (lastRequest) {
        const timeSince = Date.now() - parseInt(lastRequest, 10);
        if (timeSince < 60000) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded. Please wait before sending another feedback.' }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(Math.ceil((60000 - timeSince) / 1000)),
                ...corsHeaders(origin, env)
              }
            }
          );
        }
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, origin, env);
    }

    const message = (body.message || '').trim();
    if (!message) {
      return json({ error: 'Message is required' }, 400, origin, env);
    }

    const page = (body.page || 'unknown').trim();
    const timestamp = new Date().toISOString();
    const sanitizedPage = page.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const subjectPage = page.replace(/[\r\n\t]/g, ' ').slice(0, 100);

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
    </div>`;

    const result = await sendEmail(env, {
      to: FEEDBACK_TO,
      subject: `Feedback from ${subjectPage}`,
      html
    });

    if (!result.ok) {
      console.error('[FEEDBACK] Email send failed:', result.error);
      return json({ error: 'Failed to send feedback' }, 502, origin, env);
    }

    if (env.JOBHACKAI_KV) {
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      await env.JOBHACKAI_KV.put(`feedbackRateLimit:${clientIp}`, String(Date.now()), {
        expirationTtl: 60
      });
    }

    return json({ ok: true }, 200, origin, env);
  } catch (err) {
    console.error('[FEEDBACK] Unhandled error:', err);
    return json({ error: 'Internal server error' }, 500, origin, env);
  }
}
