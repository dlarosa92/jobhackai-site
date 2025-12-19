import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, isD1Available } from '../_lib/db.js';

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

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);
    const userEmail = payload.email || null;

    // Get usage data from KV
    const usage = {
      atsScans: {
        used: 0,
        limit: plan === 'free' ? 1 : null, // Free: 1 lifetime, others: unlimited
        remaining: plan === 'free' ? 1 : null,
        cooldown: 0
      },
      resumeFeedback: {
        used: 0,
        limit: plan === 'essential' ? 3 : plan === 'trial' ? 3 : null, // Essential: 3/month, Trial: 3 total, Pro/Premium: unlimited
        remaining: plan === 'essential' ? 3 : plan === 'trial' ? 3 : null,
        cooldown: 0
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

    // Check ATS usage (Free plan: lifetime limit)
    if (plan === 'free' && env.JOBHACKAI_KV) {
      const atsUsageKey = `atsUsage:${uid}:lifetime`;
      const atsUsed = await env.JOBHACKAI_KV.get(atsUsageKey);
      usage.atsScans.used = atsUsed ? parseInt(atsUsed, 10) : 0;
      usage.atsScans.remaining = Math.max(0, 1 - usage.atsScans.used);
    }

    // Check feedback usage (Essential: monthly, Trial: lifetime during trial)
    if (plan === 'essential' && env.JOBHACKAI_KV) {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const feedbackUsageKey = `feedbackUsage:${uid}:${monthKey}`;
      const feedbackUsed = await env.JOBHACKAI_KV.get(feedbackUsageKey);
      usage.resumeFeedback.used = feedbackUsed ? parseInt(feedbackUsed, 10) : 0;
      usage.resumeFeedback.remaining = Math.max(0, 3 - usage.resumeFeedback.used);
    } else if (plan === 'trial' && env.JOBHACKAI_KV) {
      // Trial: total limit (3 feedbacks for entire trial period)
      const totalKey = `feedbackTrialTotal:${uid}`;
      const totalUsed = await env.JOBHACKAI_KV.get(totalKey);
      usage.resumeFeedback.used = totalUsed ? parseInt(totalUsed, 10) : 0;
      usage.resumeFeedback.limit = 3;
      usage.resumeFeedback.remaining = Math.max(0, 3 - usage.resumeFeedback.used);
    }

    // Check rewrite usage (Pro/Premium: 45s cooldown, KV TTL minimum is 60s)
    if ((plan === 'pro' || plan === 'premium') && env.JOBHACKAI_KV) {
      usage.resumeRewrite.limit = null; // Unlimited for Pro/Premium
      usage.resumeRewrite.used = 0;
      usage.resumeRewrite.remaining = null;

      // Keep in sync with resume-rewrite.js: enforce 45s but stored TTL >= 60s
      const cooldownSeconds = 45;
      const cooldownKey = `rewriteCooldown:${uid}`;
      const lastTs = await env.JOBHACKAI_KV.get(cooldownKey);
      if (lastTs) {
        const timeSinceLast = Date.now() - parseInt(lastTs, 10);
        if (timeSinceLast < cooldownSeconds * 1000) {
          usage.resumeRewrite.cooldown = Math.ceil((cooldownSeconds * 1000 - timeSinceLast) / 1000); // seconds
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

    // Get Interview Questions monthly usage from database
    if ((plan === 'trial' || plan === 'essential' || plan === 'pro' || plan === 'premium') && isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        if (d1User && d1User.id) {
          // Get current month's usage by summing all daily counts for the month
          // Use UTC dates to match the increment function which uses UTC
          const now = new Date();
          const year = now.getUTCFullYear();
          const month = String(now.getUTCMonth() + 1).padStart(2, '0');
          const monthStart = `${year}-${month}-01`;
          const monthEnd = `${year}-${month}-31`;
          
          const result = await env.DB.prepare(
            `SELECT COALESCE(SUM(count), 0) as total FROM feature_daily_usage
             WHERE user_id = ? AND feature = 'interview_questions'
             AND usage_date >= ? AND usage_date <= ?`
          ).bind(d1User.id, monthStart, monthEnd).first();
          
          // Handle NULL explicitly - COALESCE should return 0, but be safe
          let totalUsed = (result && result.total !== null && result.total !== undefined) 
            ? Number(result.total) 
            : 0;
          
          // Normalize old format (questions) to new format (sets) for monthly usage
          // Old system stored multiples of 10 per day (10 questions per set)
          // New system stores individual sets per day (1 per set)
          // Only convert if total exceeds reasonable monthly usage AND is a multiple of 10
          // This prevents false positives: legitimate usage (e.g., 20 sets/month) won't be converted
          // But old format values (100+, 200+, etc.) will be correctly converted
          // Conservative threshold: if monthly total > 50 and multiple of 10, likely old format
          const MONTHLY_CONVERSION_THRESHOLD = 50;
          if (totalUsed > MONTHLY_CONVERSION_THRESHOLD && totalUsed >= 10 && totalUsed % 10 === 0) {
            const oldValue = totalUsed;
            totalUsed = Math.floor(totalUsed / 10);
            console.log('[USAGE] Converted old format monthly usage for interview_questions:', { uid, oldValue, newValue: totalUsed });
          }
          
          usage.interviewQuestions.used = totalUsed;
        }
      } catch (error) {
        console.error('[USAGE] Error getting interview questions usage:', error);
        // Keep default 0 on error
      }
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
