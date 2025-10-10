import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin, env) });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, env) });

  try {
    const token = getBearer(request);
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401, origin, env);
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    const customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    if (!customerId) return json({ ok: false, error: 'No customer for user' }, 404, origin, env);

    // UPDATED: use /dashboard for return_url
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: customerId, return_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard` })
    });
    const p = await res.json();
    if (!res.ok) return json({ ok: false, error: p?.error?.message || 'portal_error', details: p?.error }, res.status || 400, origin, env);
    return json({ ok: true, url: p.url }, 200, origin, env);
  } catch (e) {
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin, env);
  }
}

function corsHeaders(origin, env) {
  // Dynamic CORS: support dev, qa, and production origins
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io', 
    'https://app.jobhackai.io'
  ];
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { 
    'Access-Control-Allow-Origin': allowed, 
    'Access-Control-Allow-Methods': 'POST,OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type,Authorization', 
    'Vary': 'Origin', 
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) { 
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) }); 
}

const kvCusKey = (uid) => `cusByUid:${uid}`;



