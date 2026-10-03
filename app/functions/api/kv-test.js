// Read-only, non-production diagnostic for the KV namespace binding.
// GET /api/kv-test?key=config:ats

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { isExplicitNonProductionEnvironment, notFoundInProductionResponse } from '../_lib/debug-access.js';

// Never accept account data keys or caller-controlled write targets.
const ALLOWED_DIAGNOSTIC_KEYS = new Set(['config:ats']);

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
    } catch {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    // Get key from query params
    const url = new URL(request.url);
    const testKey = url.searchParams.get('key') || 'config:ats';
    if (!ALLOWED_DIAGNOSTIC_KEYS.has(testKey)) {
      return json({ success: false, error: 'Unsupported diagnostic key' }, 400, origin, env);
    }

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
      kvError = err.message;
      console.error('[KV-TEST] KV read error:', err);
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
      writeSuccess: false,
      uid,
      timestamp: new Date().toISOString()
    }, 200, origin, env);

  } catch (error) {
    console.error('[KV-TEST] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}
