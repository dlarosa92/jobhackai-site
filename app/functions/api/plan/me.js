import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getUserPlanData, isTrialEligible } from '../../_lib/db.js';
import { getVoiceEntitlement, voiceFeatureEnabled } from '../../_lib/voice-entitlements.js';

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
    
    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const email = payload?.email || null;

    // Fetch plan data from D1 (source of truth)
    const planData = await getUserPlanData(env, uid);
    const trialEligible = await isTrialEligible(env, uid, email);

    // Voice mock interview entitlement summary (read-only; server enforces)
    const voiceEnabled = voiceFeatureEnabled(env);
    let voice = { enabled: voiceEnabled, canStart: false, mode: null, unlimited: false, freeSessionUsed: false, sessionsRemaining: 0 };
    if (voiceEnabled) {
      try {
        const ent = await getVoiceEntitlement(env, uid);
        voice = {
          enabled: true,
          canStart: ent.canStart,
          mode: ent.mode,
          unlimited: ent.unlimited,
          freeSessionUsed: ent.freeSessionUsed,
          sessionsRemaining: ent.sessionsRemaining
        };
      } catch (voiceErr) {
        console.warn('[PLAN-ME] Voice entitlement lookup failed (non-fatal):', voiceErr?.message || voiceErr);
      }
    }

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

