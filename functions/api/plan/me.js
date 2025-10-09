import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const token = getBearer(request);
    if (!token) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
      });
    }
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    const plan = (await env.JOBHACKAI_KV?.get(`planByUid:${uid}`)) || 'free';
    return new Response(JSON.stringify({ plan }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'server_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
    });
  }
}


