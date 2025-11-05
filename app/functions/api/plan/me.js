import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(origin, env)
    });
  }
  
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
      console.log('❌ [PLAN/ME] No bearer token provided');
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }
    
    let uid;
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
      console.log('✅ [PLAN/ME] Authenticated user', uid);
    } catch (authError) {
      console.error('❌ [PLAN/ME] JWT verification failed:', authError?.message || authError);
      return new Response(JSON.stringify({ 
        error: 'auth_failed', 
        message: authError?.message || 'Invalid or expired token' 
      }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }

    // Fetch all subscription-related data from KV
    let plan, trialEnd, cancelAt, periodEnd, scheduledPlan, scheduledAt;
    try {
      plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`) || 'free';
      trialEnd = await env.JOBHACKAI_KV.get(`trialEndByUid:${uid}`);
      cancelAt = await env.JOBHACKAI_KV.get(`cancelAtByUid:${uid}`);
      periodEnd = await env.JOBHACKAI_KV.get(`periodEndByUid:${uid}`);
      scheduledPlan = await env.JOBHACKAI_KV.get(`scheduledPlanByUid:${uid}`);
      scheduledAt = await env.JOBHACKAI_KV.get(`scheduledAtByUid:${uid}`);
      console.log('✅ [PLAN/ME] Fetched plan data from KV', { plan, hasTrialEnd: !!trialEnd });
    } catch (kvError) {
      console.error('❌ [PLAN/ME] KV access error:', kvError?.message || kvError);
      // Return free plan as fallback if KV fails
      plan = 'free';
      trialEnd = null;
      cancelAt = null;
      periodEnd = null;
      scheduledPlan = null;
      scheduledAt = null;
    }

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
    console.error('❌ [PLAN/ME] Unexpected error:', e?.message || e);
    console.error('❌ [PLAN/ME] Stack:', e?.stack);
    // Don't expose stack trace in production, but log it
    return new Response(JSON.stringify({ 
      error: 'server_error', 
      message: e?.message || 'An unexpected error occurred' 
    }), {
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


