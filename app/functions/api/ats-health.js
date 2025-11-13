// ATS Health endpoint
// Returns "ok" and verifies JOBHACKAI_KV is readable

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
  return new Response(JSON.stringify(data), {
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
    return json({ error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Check KV binding exists
    const kvBindingExists = !!env.JOBHACKAI_KV;
    
    if (!kvBindingExists) {
      return json({
        status: 'error',
        message: 'KV binding not found',
        kvReadable: false
      }, 500, origin, env);
    }

    // Test KV read operation
    let kvReadable = false;
    let kvError = null;
    
    try {
      // Try to read a test key (or any key)
      await env.JOBHACKAI_KV.get('health:test');
      kvReadable = true;
    } catch (readError) {
      kvError = readError.message;
      console.error('[ATS-HEALTH] KV read test failed:', readError);
    }

    // If read test failed, try a write test
    if (!kvReadable) {
      try {
        const testKey = `health:test:${Date.now()}`;
        await env.JOBHACKAI_KV.put(testKey, 'ok', { expirationTtl: 60 });
        await env.JOBHACKAI_KV.get(testKey);
        kvReadable = true;
      } catch (writeError) {
        kvError = writeError.message;
        console.error('[ATS-HEALTH] KV write test failed:', writeError);
      }
    }

    if (kvReadable) {
      return json({
        status: 'ok',
        kvBindingExists: true,
        kvReadable: true,
        timestamp: new Date().toISOString()
      }, 200, origin, env);
    } else {
      return json({
        status: 'error',
        message: 'KV not readable',
        kvBindingExists: true,
        kvReadable: false,
        kvError: kvError || 'Unknown error'
      }, 500, origin, env);
    }

  } catch (error) {
    console.error('[ATS-HEALTH] Error:', error);
    return json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    }, 500, origin, env);
  }
}




