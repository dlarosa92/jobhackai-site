import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId } from '../_lib/db.js';
import { upsertCookieConsent, getCookieConsent } from '../_lib/db.js';

function corsHeaders(origin, env) {
  const fallbackOrigins = [
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

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  try {
    // GET: Retrieve consent
    if (request.method === 'GET') {
      // Try to get auth token (optional for GET)
      const token = getBearer(request);
      let userId = null;
      let clientId = null;

      // Always extract client_id from cookie (for migration from anonymous to authenticated)
      const cookieHeader = request.headers.get('Cookie') || '';
      const clientIdMatch = cookieHeader.match(/jha_client_id=([^;]+)/);
      clientId = clientIdMatch ? clientIdMatch[1] : null;

      if (token) {
        // Authenticated: get userId
        try {
          const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
          const user = await getOrCreateUserByAuthId(env, uid);
          userId = user?.id || null;
        } catch (authError) {
          // Auth failed, will use clientId only
          userId = null;
        }
      }

      // Query by userId first, fall back to clientId if not found
      // This handles migration: user saved consent anonymously, then logged in
      const consent = await getCookieConsent(env, userId, clientId);
      return json({ ok: true, consent }, 200, origin, env);
    }

    // POST: Store consent
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !body.consent) {
        return json({ ok: false, error: 'Missing consent data' }, 400, origin, env);
      }

      const token = getBearer(request);
      let userId = null;
      let authId = null;
      let clientId = body.clientId || null;

      // If authenticated, get userId
      if (token) {
        try {
          const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
          authId = uid;
          const user = await getOrCreateUserByAuthId(env, uid);
          userId = user?.id || null;
        } catch (authError) {
          console.warn('[COOKIE-CONSENT] Auth failed, using clientId:', authError);
          // Continue with clientId only
        }
      }

      // If no userId and no clientId, generate one (shouldn't happen, but safety)
      if (!userId && !clientId) {
        return json({ ok: false, error: 'Missing identifier' }, 400, origin, env);
      }

      const success = await upsertCookieConsent(env, {
        userId,
        authId,
        clientId,
        consent: body.consent
      });

      if (success) {
        return json({ ok: true }, 200, origin, env);
      } else {
        // Temporary: Include debug info in response to diagnose issue
        const dbAvailable = !!(env?.JOBHACKAI_DB || env?.DB);
        const debugInfo = {
          hasDb: dbAvailable,
          hasUserId: !!userId,
          hasClientId: !!clientId,
          dbBindingNames: Object.keys(env || {}).filter(k => k.includes('DB') || k.includes('D1'))
        };
        console.error('[COOKIE-CONSENT] Failed to save consent, debug info:', debugInfo);
        return json({ ok: false, error: 'Failed to save consent', debug: debugInfo }, 500, origin, env);
      }
    }

    return json({ ok: false, error: 'Method not allowed' }, 405, origin, env);
  } catch (error) {
    console.error('[COOKIE-CONSENT] Error:', error);
    console.error('[COOKIE-CONSENT] Error stack:', error.stack);
    // Include error details in response for debugging
    const errorInfo = {
      message: error.message,
      name: error.name,
      hasEnv: !!env,
      dbBindings: env ? Object.keys(env).filter(k => k.includes('DB') || k.includes('D1')) : []
    };
    return json({ ok: false, error: 'Internal server error', debug: errorInfo }, 500, origin, env);
  }
}

