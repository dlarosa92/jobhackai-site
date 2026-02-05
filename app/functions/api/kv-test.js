// KV test endpoint to verify KV namespace binding
// GET /api/kv-test?key=config:ats

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';

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

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    // Get key from query params
    const url = new URL(request.url);
    const testKey = url.searchParams.get('key') || 'config:ats';

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

    // Test write (optional - only if key doesn't exist)
    let writeSuccess = false;
    if (!kvValue && testKey.startsWith('test:')) {
      try {
        await env.JOBHACKAI_KV.put(testKey, JSON.stringify({ test: true, timestamp: Date.now() }));
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
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

