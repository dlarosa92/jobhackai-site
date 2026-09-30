import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getUserPlanData, isTrialEligible } from '../../_lib/db.js';
import { getVoicePlanSummary } from '../../_lib/voice-plan-summary.js';

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
    
    let uid, payload;
    try {
      ({ uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID));
    } catch (_) {
      // An expired/invalid token is an auth failure, not a server error; the
      // dashboard post-checkout poll refreshes its token on 401.
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }
    const email = payload?.email || null;

    // Fetch plan data from D1 (source of truth)
    const planData = await getUserPlanData(env, uid);
    const trialEligible = await isTrialEligible(env, uid, email);

    // Voice mock interview entitlement summary (read-only; server enforces).
    // `enabled` means the feature is actually USABLE: the flag is on AND the
    // entitlement backend is operational. If migration 020 has not run (or D1
    // is down), getVoiceEntitlement reports not_migrated/db_unavailable and we
    // report enabled:false, so the dashboard tile and tool CTAs (which key off
    // `enabled`) stay hidden instead of surfacing entry points that 503.
    const voice = await getVoicePlanSummary(env, uid);

    return new Response(JSON.stringify({
      plan: planData?.plan || 'free',
      trialEndsAt: planData?.trialEndsAt || null,
      cancelAt: planData?.cancelAt || null,
      currentPeriodEnd: planData?.currentPeriodEnd || null,
      scheduledPlanChange: planData?.scheduledPlanChange || null,
      trialEligible,
      voice
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
