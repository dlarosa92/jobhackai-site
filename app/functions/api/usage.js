import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getUsageForUser, checkFeatureAllowed, getCooldownStatus } from '../_lib/usage-tracker.js';
import { FEATURE_KEYS } from '../_lib/usage-config.js';

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

    // Initialize usage doc and get normalized usage
    await getUsageForUser(env, uid, plan);

    // Get usage data using new usage-tracker.js system
    // For resumeFeedback (primary feature for this endpoint)
    const resumeFeedbackCheck = await checkFeatureAllowed(env, uid, FEATURE_KEYS.RESUME_FEEDBACK);
    const resumeFeedbackCooldown = await getCooldownStatus(env, uid, FEATURE_KEYS.RESUME_FEEDBACK, 60); // 60 second cooldown

    // For ATS Score
    const atsScoreCheck = await checkFeatureAllowed(env, uid, FEATURE_KEYS.ATS_SCORE);

    const usage = {
      atsScans: {
        used: atsScoreCheck.used || 0,
        limit: atsScoreCheck.limit,
        remaining: atsScoreCheck.limit !== null ? Math.max(0, (atsScoreCheck.limit || 0) - (atsScoreCheck.used || 0)) : null,
        cooldown: 0
      },
      resumeFeedback: {
        used: resumeFeedbackCheck.used || 0,
        limit: resumeFeedbackCheck.limit,
        remaining: resumeFeedbackCheck.limit !== null ? Math.max(0, (resumeFeedbackCheck.limit || 0) - (resumeFeedbackCheck.used || 0)) : null,
        cooldown: resumeFeedbackCooldown.cooldownSecondsRemaining || 0
      },
      resumeRewrite: {
        used: 0,
        limit: (plan === 'pro' || plan === 'premium') ? null : 0, // Pro/Premium: unlimited (throttled), others: locked
        remaining: (plan === 'pro' || plan === 'premium') ? null : 0,
        cooldown: 0
      },
      coverLetters: {
        used: 0,
        limit: (plan === 'pro' || plan === 'premium') ? null : 0, // Pro/Premium: unlimited, others: locked
        remaining: (plan === 'pro' || plan === 'premium') ? null : 0,
        cooldown: 0
      },
      interviewQuestions: {
        used: 0,
        limit: (plan === 'trial' || plan === 'essential' || plan === 'pro' || plan === 'premium') ? null : 0, // Trial/Essential/Pro/Premium: unlimited (1-min cooldown), others: locked
        remaining: (plan === 'trial' || plan === 'essential' || plan === 'pro' || plan === 'premium') ? null : 0,
        cooldown: 0 // 1-min cooldown (to be tracked when feature is implemented)
      },
      mockInterviews: {
        used: 0,
        limit: plan === 'pro' ? 20 : plan === 'premium' ? null : 0, // Pro: 20/month, Premium: unlimited (1/hr, 5/day soft limit), others: locked
        remaining: plan === 'pro' ? 20 : plan === 'premium' ? null : 0,
        cooldown: 0 // 1/hr cooldown for Premium (to be tracked when feature is implemented)
      },
      linkedInOptimizer: {
        used: 0,
        limit: plan === 'premium' ? null : 0, // Premium: unlimited, others: locked
        remaining: plan === 'premium' ? null : 0,
        cooldown: 0
      },
      priorityReview: {
        enabled: plan === 'premium', // Premium: enabled, others: disabled
        plan: plan
      }
    };

    // Usage data for resumeFeedback and atsScans is now populated above using usage-tracker.js
    // Remaining features use legacy logic (to be migrated later)

    // Check rewrite usage (Pro/Premium: daily limit 5)
    if ((plan === 'pro' || plan === 'premium') && env.JOBHACKAI_KV) {
      const today = new Date().toISOString().split('T')[0];
      const rewriteDailyKey = `rewriteDaily:${uid}:${today}`;
      const rewriteUsed = await env.JOBHACKAI_KV.get(rewriteDailyKey);
      usage.resumeRewrite.used = rewriteUsed ? parseInt(rewriteUsed, 10) : 0;
      usage.resumeRewrite.limit = 5; // Daily limit
      usage.resumeRewrite.remaining = Math.max(0, 5 - usage.resumeRewrite.used);
      
      // Check cooldown (1 hour throttle)
      const hourlyKey = `rewriteThrottle:${uid}:hour`;
      const lastHourly = await env.JOBHACKAI_KV.get(hourlyKey);
      if (lastHourly) {
        const lastHourlyTime = parseInt(lastHourly, 10);
        const timeSinceLastHourly = Date.now() - lastHourlyTime;
        if (timeSinceLastHourly < 3600000) {
          usage.resumeRewrite.cooldown = Math.ceil((3600000 - timeSinceLastHourly) / 1000); // seconds
        }
      }
    }
    
    // Check mock interview usage (Pro: 20/month, Premium: daily limit 5)
    if (plan === 'pro' && env.JOBHACKAI_KV) {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const mockInterviewUsageKey = `mockInterviewUsage:${uid}:${monthKey}`;
      const mockInterviewUsed = await env.JOBHACKAI_KV.get(mockInterviewUsageKey);
      usage.mockInterviews.used = mockInterviewUsed ? parseInt(mockInterviewUsed, 10) : 0;
      usage.mockInterviews.limit = 20; // Monthly limit
      usage.mockInterviews.remaining = Math.max(0, 20 - usage.mockInterviews.used);
    } else if (plan === 'premium' && env.JOBHACKAI_KV) {
      // Premium: check daily limit (5/day)
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `mockInterviewDaily:${uid}:${today}`;
      const dailyUsed = await env.JOBHACKAI_KV.get(dailyKey);
      usage.mockInterviews.used = dailyUsed ? parseInt(dailyUsed, 10) : 0;
      usage.mockInterviews.limit = null; // Unlimited but soft limit
      usage.mockInterviews.remaining = null;
      
      // Check cooldown (1 hour throttle)
      const hourlyKey = `mockInterviewThrottle:${uid}:hour`;
      const lastHourly = await env.JOBHACKAI_KV.get(hourlyKey);
      if (lastHourly) {
        const lastHourlyTime = parseInt(lastHourly, 10);
        const timeSinceLastHourly = Date.now() - lastHourlyTime;
        if (timeSinceLastHourly < 3600000) {
          usage.mockInterviews.cooldown = Math.ceil((3600000 - timeSinceLastHourly) / 1000); // seconds
        }
      }
    }

    // Return usage data with resumeFeedback in the format expected by frontend
    return new Response(JSON.stringify({
      success: true,
      plan,
      usage,
      // Also return resumeFeedback usage in the format expected by renderResumeFeedbackUsageTile
      resumeFeedbackUsage: {
        plan: resumeFeedbackCheck.plan,
        feature: FEATURE_KEYS.RESUME_FEEDBACK,
        limit: resumeFeedbackCheck.limit,
        used: resumeFeedbackCheck.used,
        cooldownSecondsRemaining: resumeFeedbackCooldown.cooldownSecondsRemaining || 0
      }
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
