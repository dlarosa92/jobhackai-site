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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

async function getUserPlan(uid, env) {
  if (!env.JOBHACKAI_KV) {
    return 'free';
  }
  
  const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
  return plan || 'free';
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders(origin, env)
    });
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders(origin, env)
      });
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);

    // Get usage data from KV
    const usage = {
      atsScans: {
        used: 0,
        limit: plan === 'free' ? 1 : null, // Free: 1 lifetime, others: unlimited
        remaining: plan === 'free' ? 1 : null
      },
      resumeFeedback: {
        used: 0,
        limit: plan === 'essential' ? 3 : plan === 'trial' ? null : null, // Essential: 3/month, Trial: unlimited (throttled), Pro/Premium: unlimited
        remaining: plan === 'essential' ? 3 : null
      },
      resumeRewrite: {
        used: 0,
        limit: (plan === 'pro' || plan === 'premium') ? null : 0, // Pro/Premium: unlimited (throttled), others: locked
        remaining: (plan === 'pro' || plan === 'premium') ? null : 0
      }
    };

    // Check ATS usage (Free plan: lifetime limit)
    if (plan === 'free' && env.JOBHACKAI_KV) {
      const atsUsageKey = `atsUsage:${uid}:lifetime`;
      const atsUsed = await env.JOBHACKAI_KV.get(atsUsageKey);
      usage.atsScans.used = atsUsed ? parseInt(atsUsed, 10) : 0;
      usage.atsScans.remaining = Math.max(0, 1 - usage.atsScans.used);
    }

    // Check feedback usage (Essential: monthly, Trial: daily/per-doc)
    if (plan === 'essential' && env.JOBHACKAI_KV) {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const feedbackUsageKey = `feedbackUsage:${uid}:${monthKey}`;
      const feedbackUsed = await env.JOBHACKAI_KV.get(feedbackUsageKey);
      usage.resumeFeedback.used = feedbackUsed ? parseInt(feedbackUsed, 10) : 0;
      usage.resumeFeedback.remaining = Math.max(0, 3 - usage.resumeFeedback.used);
    } else if (plan === 'trial' && env.JOBHACKAI_KV) {
      // Trial: check daily limit (5/day)
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `feedbackDaily:${uid}:${today}`;
      const dailyUsed = await env.JOBHACKAI_KV.get(dailyKey);
      usage.resumeFeedback.used = dailyUsed ? parseInt(dailyUsed, 10) : 0;
      usage.resumeFeedback.limit = 5; // Daily limit
      usage.resumeFeedback.remaining = Math.max(0, 5 - usage.resumeFeedback.used);
    }

    // Check rewrite usage (Pro/Premium: daily limit 5)
    if ((plan === 'pro' || plan === 'premium') && env.JOBHACKAI_KV) {
      const today = new Date().toISOString().split('T')[0];
      const rewriteDailyKey = `rewriteDaily:${uid}:${today}`;
      const rewriteUsed = await env.JOBHACKAI_KV.get(rewriteDailyKey);
      usage.resumeRewrite.used = rewriteUsed ? parseInt(rewriteUsed, 10) : 0;
      usage.resumeRewrite.limit = 5; // Daily limit
      usage.resumeRewrite.remaining = Math.max(0, 5 - usage.resumeRewrite.used);
    }

    return new Response(JSON.stringify({
      success: true,
      plan,
      usage
    }), {
      headers: corsHeaders(origin, env)
    });

  } catch (error) {
    console.error('[USAGE] Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: corsHeaders(origin, env)
    });
  }
}
