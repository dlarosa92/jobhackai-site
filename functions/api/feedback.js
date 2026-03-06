/**
 * NOTE: This file is NOT deployed to production. The Cloudflare Pages project
 * root directory is /app, so the deployed handler is app/functions/api/feedback.js.
 *
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend HTTP API.
 *
 * Self-contained handler — no cross-directory imports so that the Cloudflare
 * Pages bundler can compile this file regardless of which functions/ directory
 * the build picks up.
 *
 * Feedback is always saved to KV for reliability. Email via Resend is best-effort.
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/**
 * Save feedback to KV as a reliable fallback.
 * Key: feedback:<timestamp>:<random>
 * Value: JSON with message, page, timestamp, emailStatus
 */
async function saveFeedbackToKV(env, { message, page, timestamp, emailResult }) {
  if (!env.JOBHACKAI_KV) {
    console.warn('[FEEDBACK] JOBHACKAI_KV not available, cannot save fallback');
    return false;
  }
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = `feedback:${id}`;
    await env.JOBHACKAI_KV.put(key, JSON.stringify({
      message,
      page,
      timestamp,
      emailSent: emailResult.ok,
      emailError: emailResult.error || null,
    }), { expirationTtl: 60 * 60 * 24 * 90 }); // keep for 90 days
    console.log('[FEEDBACK] Saved to KV:', key);
    return true;
  } catch (err) {
    console.error('[FEEDBACK] Failed to save to KV:', err.message);
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin, env) });
    }

    // Diagnostic endpoint: GET /api/feedback?debug=env
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('debug') === 'env') {
        const hasResendKey = !!(env && env.RESEND_API_KEY);
        const resendKeyLen = (env && env.RESEND_API_KEY) ? env.RESEND_API_KEY.length : 0;
        const hasKV = !!(env && env.JOBHACKAI_KV);
        return json({
          hasResendKey,
          resendKeyLen,
          hasKV,
          hasEnv: !!env
        }, 200, origin, env);
      }
      return json({ error: 'Method not allowed' }, 405, origin, env);
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
    } catch (_e) {
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

    // Try sending email via Resend (best-effort)
    const emailResult = await sendEmail(env, {
      to: FEEDBACK_TO,
      subject: `Feedback from ${subjectPage}`,
      html
    });

    // Always save feedback to KV for reliability
    const kvSaved = await saveFeedbackToKV(env, { message, page, timestamp, emailResult });

    // Update rate limit timestamp
    if (env.JOBHACKAI_KV) {
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      await env.JOBHACKAI_KV.put(`feedbackRateLimit:${clientIp}`, String(Date.now()), {
        expirationTtl: 60
      });
    }

    // Succeed if either email was sent OR feedback was saved to KV
    if (emailResult.ok || kvSaved) {
      return json({ ok: true }, 200, origin, env);
    }

    // Both failed — return error with detail
    return json({
      error: 'Failed to send feedback',
      detail: emailResult.error
    }, 500, origin, env);
  } catch (err) {
    console.error('[FEEDBACK] Unhandled error:', err);
    return json({ error: 'Internal server error' }, 500, origin, env);
  }
}
