import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const token = getBearer(request);
    if (!token) {
      console.log('🔍 [/api/plan/me] missing token');
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
      });
    }
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    console.log('🔍 [/api/plan/me] fetch plan for', uid);

    const plan = (await env.JOBHACKAI_KV?.get(`planByUid:${uid}`)) || 'free';
    const trialEnd = await env.JOBHACKAI_KV?.get(`trialEndByUid:${uid}`);
    console.log('📊 [/api/plan/me] result', { plan, trialEnd });

    return new Response(JSON.stringify({ 
      plan, 
      trialEndsAt: trialEnd ? new Date(parseInt(trialEnd) * 1000).toISOString() : null 
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
    });
  } catch (e) {
    console.log('❌ [/api/plan/me] error', e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || 'server_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://dev.jobhackai.io', 'Vary': 'Origin' }
    });
  }
}


