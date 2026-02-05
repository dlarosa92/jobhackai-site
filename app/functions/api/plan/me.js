import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getUserPlanData, isTrialEligible } from '../../_lib/db.js';

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

    // Fetch plan data from D1 (source of truth)
    const planData = await getUserPlanData(env, uid);
    const trialEligible = await isTrialEligible(env, uid);

    return new Response(JSON.stringify({ 
      plan: planData?.plan || 'free',
      trialEndsAt: planData?.trialEndsAt || null,
      cancelAt: planData?.cancelAt || null,
      currentPeriodEnd: planData?.currentPeriodEnd || null,
      scheduledPlanChange: planData?.scheduledPlanChange || null,
      trialEligible
    }), {
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

