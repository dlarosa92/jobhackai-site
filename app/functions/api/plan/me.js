import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  try {
    const token = getBearer(request);
    if (!token) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    const plan = (await env.JOBHACKAI_KV?.get(`planByUid:${uid}`)) || 'free';
    return new Response(JSON.stringify({ plan }), {
      headers: corsHeaders(origin, env)
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'server_error' }), {
      status: 500,
      headers: corsHeaders(origin, env)
    });
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
    'Content-Type': 'application/json', 
    'Cache-Control': 'no-store', 
    'Access-Control-Allow-Origin': allowed, 
    'Vary': 'Origin' 
  };
}



