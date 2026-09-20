import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId } from '../_lib/db.js';
import { upsertCookieConsent, getCookieConsent } from '../_lib/db.js';
import { revokeCheckoutAttribution } from '../../app/functions/_lib/checkout-attribution.js';

function corsHeaders(origin, env) {
  const fallbackOrigins = [
    'https://jobhackai.io',
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true', // Needed for cookie-based client_id
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { 
    status, 
    headers: corsHeaders(origin, env) 
  });
}

// Invalid credentials must never silently turn an account preference into an
// anonymous record. Only explicitly anonymous requests use the browser ID.
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validConsent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.version === 1 && typeof value.analytics === 'boolean';
}

export async function onRequest({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin, env) });
  if (!['GET', 'POST'].includes(request.method)) return json({ok:false,error:'Method not allowed'},405,origin,env);

  try {
    const token = getBearer(request);
    let authId = null;
    if (request.headers.has('Authorization')) {
      if (!token) return json({ok:false,error:'unauthorized'},401,origin,env);
      try {
        const identity = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
        authId = identity?.uid;
        if (!authId) return json({ok:false,error:'unauthorized'},401,origin,env);
      } catch (_) {
        return json({ok:false,error:'unauthorized'},401,origin,env);
      }
    }
    let userId = null;
    if (authId) {
      const user = await getOrCreateUserByAuthId(env, authId);
      userId = user?.id;
      if (!userId) return json({ok:false,error:'Consent storage unavailable'},503,origin,env);
    }
    const cookieMatch = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)jha_client_id=([^;]*)/);
    const cookieClient = cookieMatch && CLIENT_ID.test(cookieMatch[1]) ? cookieMatch[1] : null;
    if (request.method === 'GET') {
      const consent = await getCookieConsent(env, userId, cookieClient);
      // Old or malformed stored data is not an analytics grant.
      return json({ok:true,consent:validConsent(consent) ? {
        version:1,analytics:consent.analytics,updatedAt:consent.updatedAt
      } : null, ...(consent != null && !validConsent(consent) ? {resetConsent:true} : {})},200,origin,env);
    }

    const body = await request.json().catch(() => null);
    if (!validConsent(body?.consent)) return json({ok:false,error:'Invalid consent data'},400,origin,env);
    if (body.clientId != null && (typeof body.clientId !== 'string' || !CLIENT_ID.test(body.clientId))) {
      return json({ok:false,error:'Invalid client identifier'},400,origin,env);
    }
    if (cookieClient && body.clientId && cookieClient !== body.clientId) {
      return json({ok:false,error:'Client identifier mismatch'},400,origin,env);
    }
    const clientId = cookieClient || body.clientId || null;
    if (!userId && !clientId) return json({ok:false,error:'Missing identifier'},400,origin,env);
    // Store only the supported decision, with the server receipt time. Never
    // persist arbitrary caller fields or treat the string "false" as consent.
    const consent = {version:1,analytics:body.consent.analytics,updatedAt:new Date().toISOString()};
    const saved = await upsertCookieConsent(env, {userId,authId,clientId,consent});
    if (saved && !consent.analytics && !await revokeCheckoutAttribution(env, {userId,clientId})) {
      return json({ok:false,error:'Consent cleanup unavailable'},503,origin,env);
    }
    return saved ? json({ok:true},200,origin,env) : json({ok:false,error:'Failed to save consent'},503,origin,env);
  } catch (error) {
    console.error('[COOKIE-CONSENT] Storage operation failed:', error?.name || 'Error');
    return json({ok:false,error:'Consent storage unavailable'},503,origin,env);
  }
}
