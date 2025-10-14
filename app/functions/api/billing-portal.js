import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth';
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });

  try {
    const token = getBearer(request);
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401, origin);
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    const customerId = await env.JOBHACKAI_KV?.get(kvCusKey(uid));
    if (!customerId) return json({ ok: false, error: 'No customer for user' }, 404, origin);

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: customerId, return_url: `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/dashboard.html` })
    });
    const p = await res.json();
    if (!res.ok) return json({ ok: false, error: p?.error?.message || 'portal_error' }, 502, origin);
    return json({ ok: true, url: p.url }, 200, origin);
  } catch (e) {
    return json({ ok: false, error: e?.message || 'server_error' }, 500, origin);
  }
}

function corsHeaders(origin) {
  const allowed = origin === 'https://dev.jobhackai.io' ? origin : 'https://dev.jobhackai.io';
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Vary': 'Origin', 'Content-Type': 'application/json' };
}
function json(body, status, origin) { return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) }); }
const kvCusKey = (uid) => `cusByUid:${uid}`;


