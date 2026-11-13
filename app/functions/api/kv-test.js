// KV test endpoint to verify KV namespace binding
// GET /api/kv-test?key=config:ats
//
// Diagnostic only. Reachable solely when ENVIRONMENT is explicitly a known
// non-production value (also enforced in functions/_middleware.js), and only
// for the keys below: KV also holds resume text, billing caches and feedback,
// which this endpoint must never be able to read for the caller.

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { isExplicitNonProductionEnvironment, notFoundInProductionResponse } from '../_lib/debug-access.js';

const READABLE_KEYS = new Set(['config:ats']);
const SCRATCH_PREFIX = 'test:kv-test:';
const SCRATCH_TTL_SECONDS = 300;
const SCRATCH_SUFFIX = /^[A-Za-z0-9_-]{1,64}$/;

// The only keys this endpoint touches: the documented config key, and a
// short-lived scratch key namespaced to the caller's own uid.
export function resolveKvTestKey(requested, uid) {
  const key = requested || 'config:ats';
  if (READABLE_KEYS.has(key)) return { key, writable: false };
  if (key.startsWith(SCRATCH_PREFIX) && SCRATCH_SUFFIX.test(key.slice(SCRATCH_PREFIX.length))) {
    return { key: `${SCRATCH_PREFIX}${uid}:${key.slice(SCRATCH_PREFIX.length)}`, writable: true };
  }
  return null;
}

function corsHeaders(origin, env) {
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env)
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (!isExplicitNonProductionEnvironment(env)) {
    return notFoundInProductionResponse();
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'GET') {
    return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    let uid;
    try {
      ({ uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID));
    } catch (_) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    // Only the documented config key or the caller's own scratch key.
    const url = new URL(request.url);
    const resolved = resolveKvTestKey(url.searchParams.get('key'), uid);
    if (!resolved) {
      return json({ success: false, error: 'key_not_allowed' }, 400, origin, env);
    }
    const testKey = resolved.key;

    // Check KV binding
    const kvAvailable = !!env.JOBHACKAI_KV;
    
    if (!kvAvailable) {
      return json({
        success: false,
        error: 'KV not available',
        message: 'JOBHACKAI_KV namespace is not bound',
        kvBindingExists: false
      }, 500, origin, env);
    }

    // Try to read from KV
    let kvValue = null;
    let kvError = null;
    
    try {
      kvValue = await env.JOBHACKAI_KV.get(testKey);
    } catch (err) {
      kvError = 'kv_read_failed';
      console.error('[KV-TEST] KV read error:', err);
    }

    // Test write (optional - only if key doesn't exist). Scratch keys expire so
    // repeated checks cannot accumulate storage.
    let writeSuccess = false;
    if (!kvValue && resolved.writable) {
      try {
        await env.JOBHACKAI_KV.put(testKey, JSON.stringify({ test: true, timestamp: Date.now() }), { expirationTtl: SCRATCH_TTL_SECONDS });
        writeSuccess = true;
        kvValue = await env.JOBHACKAI_KV.get(testKey);
      } catch (err) {
        console.error('[KV-TEST] KV write error:', err);
      }
    }

    return json({
      success: true,
      kvBindingExists: true,
      testKey,
      kvValue: kvValue || 'no config',
      kvValueParsed: kvValue ? (() => {
        try {
          return JSON.parse(kvValue);
        } catch {
          return kvValue;
        }
      })() : null,
      kvError: kvError || null,
      writeSuccess,
      uid,
      timestamp: new Date().toISOString()
    }, 200, origin, env);

  } catch (error) {
    console.error('[KV-TEST] Error:', error);
    return json({ success: false, error: 'Internal server error' }, 500, origin, env);
  }
}

