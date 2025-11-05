import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  try {
    // Validate environment variables
    if (!env.FIREBASE_PROJECT_ID) {
      console.error('❌ [PLAN/ME] Missing FIREBASE_PROJECT_ID');
      return new Response(JSON.stringify({ error: 'server_config_error', message: 'FIREBASE_PROJECT_ID not configured' }), {
        status: 500,
        headers: corsHeaders(origin, env)
      });
    }

    if (!env.JOBHACKAI_KV) {
      console.error('❌ [PLAN/ME] Missing JOBHACKAI_KV binding');
      return new Response(JSON.stringify({ error: 'server_config_error', message: 'KV store not bound' }), {
        status: 500,
        headers: corsHeaders(origin, env)
      });
    }

    const token = getBearer(request);
    if (!token) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }
    
    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    console.log('✅ [PLAN/ME] Authenticated user', uid);

    // Fetch all subscription-related data from KV
    const plan = (await env.JOBHACKAI_KV.get(`planByUid:${uid}`)) || 'free';
    const trialEnd = await env.JOBHACKAI_KV.get(`trialEndByUid:${uid}`);
    const cancelAt = await env.JOBHACKAI_KV.get(`cancelAtByUid:${uid}`);
    const periodEnd = await env.JOBHACKAI_KV.get(`periodEndByUid:${uid}`);
    const scheduledPlan = await env.JOBHACKAI_KV.get(`scheduledPlanByUid:${uid}`);
    const scheduledAt = await env.JOBHACKAI_KV.get(`scheduledAtByUid:${uid}`);

    console.log('✅ [PLAN/ME] Fetched plan data', { plan, hasTrialEnd: !!trialEnd });

    return new Response(JSON.stringify({ 
      plan,
      trialEndsAt: trialEnd ? new Date(parseInt(trialEnd) * 1000).toISOString() : null,
      cancelAt: cancelAt ? new Date(parseInt(cancelAt) * 1000).toISOString() : null,
      currentPeriodEnd: periodEnd ? new Date(parseInt(periodEnd) * 1000).toISOString() : null,
      scheduledPlanChange: scheduledPlan ? {
        newPlan: scheduledPlan,
        effectiveDate: new Date(parseInt(scheduledAt) * 1000).toISOString()
      } : null
    }), {
      headers: corsHeaders(origin, env)
    });
  } catch (e) {
    console.error('❌ [PLAN/ME] Error:', e?.message || e, e?.stack);
    return new Response(JSON.stringify({ error: e?.message || 'server_error', details: e?.stack }), {
      status: 500,
      headers: corsHeaders(origin, env)
    });
  }
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin'
  };
}


