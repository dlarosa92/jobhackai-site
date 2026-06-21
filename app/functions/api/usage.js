import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, isD1Available, getFeatureDailyUsage, getMockInterviewMonthlyUsage } from '../_lib/db.js';

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

import { getUserPlan } from '../_lib/db.js';

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
    const plan = await getUserPlan(env, uid);
    const userEmail = payload.email || null;

    // Repositioning: the prep tools are free for every signed-in user.
    // Quota display tiers mirror the server enforcement: free/pack accounts
    // use the Essential feedback quota; weekly/monthly are Pro-equivalent.
    const essentialQuotaPlans = ['free', 'pack', 'essential'];
    const monthlyCappedMock = plan !== 'premium'; // 20/month for everyone but Premium

    // Get usage data from KV
    const usage = {
      atsScans: {
        used: 0,
        limit: null, // unlimited for signed-in users (rule-based scoring)
        remaining: null,
        cooldown: 0
      },
      resumeFeedback: {
        used: 0,
        limit: essentialQuotaPlans.includes(plan) ? 3 : plan === 'trial' ? 3 : null, // Free/Pack/Essential: 3/month, Trial: 3 total, others: unlimited
        remaining: essentialQuotaPlans.includes(plan) ? 3 : plan === 'trial' ? 3 : null,
        cooldown: 0
      },
      resumeRewrite: {
        used: 0,
        limit: null, // free with signup (45s server-side throttle)
        remaining: null,
        cooldown: 0
      },
      coverLetters: {
        used: 0,
        limit: null, // free with signup
        remaining: null,
        cooldown: 0
      },
      interviewQuestions: {
        used: 0,
        limit: null, // free with signup (daily set limits enforced server-side)
        remaining: null,
        cooldown: 0 // 1-min cooldown (to be tracked when feature is implemented)
      },
      mockInterviews: {
        used: 0,
        limit: monthlyCappedMock ? 20 : null, // 20/month for all plans, Premium unlimited
        remaining: monthlyCappedMock ? 20 : null,
        cooldown: 0 // 1/hr cooldown for Premium (to be tracked when feature is implemented)
      },
      linkedInOptimizer: {
        used: 0,
        limit: null, // free with signup (removal pending analytics decision)
        remaining: null,
        cooldown: 0
      },
      priorityReview: {
        enabled: plan === 'premium', // Premium: enabled, others: disabled
        plan: plan
      }
    };

    // Check ATS usage (Free plan: lifetime limit) -- D1 is authority
    if (plan === 'free' && isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        let atsUsed = 0;
        if (d1User && d1User.id && env.DB) {
          const res = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM usage_events WHERE user_id = ? AND feature = 'ats_score'`
          ).bind(d1User.id).first();
          atsUsed = res?.count || 0;
        }
        usage.atsScans.used = atsUsed;
      } catch (e) {
        usage.atsScans.used = 0;
      }
    }

    // Check feedback usage (Essential: monthly) -- D1 is authority
    // Monthly allowance starts from plan activation date (plan_updated_at), not calendar month start
    if (['free', 'pack', 'essential'].includes(plan) && isD1Available(env)) { // repositioning: free/pack use the Essential quota
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        let feedbackUsed = 0;
        if (d1User && d1User.id && env.DB) {
          const now = new Date();
          const year = now.getUTCFullYear();
          const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const monthStart = `${year}-${month}-01`;
      // Calculate actual last day of month (end-of-month fix)
      function getLastDayOfMonth(year, month) {
        return new Date(Date.UTC(year, month, 0)).getUTCDate();
      }
      const lastDayOfMonth = getLastDayOfMonth(year, Number(month));
      const monthEnd = `${year}-${month}-${String(lastDayOfMonth).padStart(2, '0')}`;

          // Determine effective start: later of monthStart and plan_updated_at
          // This ensures users who upgrade mid-month get a fresh allowance starting at plan activation
          let effectiveStart = monthStart;
          try {
            const userRow = await env.DB.prepare(
              'SELECT plan_updated_at FROM users WHERE id = ?'
            ).bind(d1User.id).first();

            if (userRow && userRow.plan_updated_at) {
              // Normalize to YYYY-MM-DD for date comparison
              const planUpdatedDate = new Date(userRow.plan_updated_at).toISOString().split('T')[0];
              if (new Date(planUpdatedDate) > new Date(effectiveStart)) {
                effectiveStart = planUpdatedDate;
              }
            }
          } catch (e) {
            // If we cannot read plan_updated_at, fall back to monthStart
            console.warn('[USAGE] Failed to read plan_updated_at for usage calculation, falling back to monthStart:', e);
          }

          // Count resume_feedback events in D1 between effectiveStart and monthEnd
          const res = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM usage_events
             WHERE user_id = ? AND feature = 'resume_feedback'
               AND date(created_at) >= date(?) AND date(created_at) <= date(?)`
          ).bind(d1User.id, effectiveStart, monthEnd).first();

          feedbackUsed = res?.count || 0;

          // Temporary debug log (remove after verification)
          console.log('[USAGE] resume_feedback count', { userId: d1User.id, effectiveStart, monthEnd, feedbackUsed });
        }

        usage.resumeFeedback.used = feedbackUsed;
        usage.resumeFeedback.remaining = Math.max(0, 3 - feedbackUsed);
      } catch (e) {
        // On error, be conservative: show full allowance to avoid blocking users
        console.warn('[USAGE] Error computing resumeFeedback usage for essential plan:', e);
        usage.resumeFeedback.used = 0;
        usage.resumeFeedback.remaining = 3;
      }
    } else if (plan === 'trial' && isD1Available(env)) {
      // Trial: total limit (3 feedbacks for entire trial period) -- D1 is authority
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        let trialUsed = 0;
        if (d1User && d1User.id && env.DB) {
          const res = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM usage_events WHERE user_id = ? AND feature = 'resume_feedback'`
          ).bind(d1User.id).first();
          trialUsed = res?.count || 0;
        }
        usage.resumeFeedback.used = trialUsed;
        usage.resumeFeedback.limit = 3;
        usage.resumeFeedback.remaining = Math.max(0, 3 - trialUsed);
      } catch (e) {
        usage.resumeFeedback.used = 0;
        usage.resumeFeedback.limit = 3;
        usage.resumeFeedback.remaining = 3;
      }
    }

    // Check feedback usage for Pro/Premium from D1 usage_events table
    if (['pro', 'premium', 'weekly', 'monthly'].includes(plan) && isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        if (d1User && d1User.id) {
          // Get current month's usage by counting resume_feedback events
          const now = new Date();
          const year = now.getUTCFullYear();
          const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const monthStart = `${year}-${month}-01`;
      // Calculate actual last day of month (end-of-month fix)
      function getLastDayOfMonth(year, month) {
        return new Date(Date.UTC(year, month, 0)).getUTCDate();
      }
      const lastDayOfMonth = getLastDayOfMonth(year, Number(month));
      const monthEnd = `${year}-${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
          
          const result = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM usage_events
             WHERE user_id = ? AND feature = 'resume_feedback'
             AND date(created_at) >= date(?) AND date(created_at) <= date(?)`
          ).bind(d1User.id, monthStart, monthEnd).first();
          
          const totalUsed = (result && result.count !== null && result.count !== undefined) 
            ? Number(result.count) 
            : 0;
          
          usage.resumeFeedback.used = totalUsed;
          // limit and remaining stay null for unlimited plans
        }
      } catch (error) {
        console.error('[USAGE] Error getting resume feedback usage for Pro/Premium:', error);
        // Keep default 0 on error
      }
    }

    // Check rewrite usage (Pro/Premium: 45s cooldown, KV TTL minimum is 60s)
    if (env.JOBHACKAI_KV) { // rewrite is free with signup; cooldown applies to all plans
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
    
    // Mock interview usage: read from D1 mock_interview_usage, the same source
    // mock-interview/score.js enforces against (getMockInterviewMonthlyUsage /
    // incrementMockInterviewMonthlyUsage). The old code read a KV key that
    // nothing increments, so the dashboard always showed a full quota while the
    // server was actually counting in D1. 20/month for every plan except
    // Premium (unlimited), matching SESSION_LIMITS in score.js.
    if (isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        if (d1User && d1User.id) {
          const mockUsed = await getMockInterviewMonthlyUsage(env, d1User.id);
          usage.mockInterviews.used = mockUsed;
          if (plan === 'premium') {
            usage.mockInterviews.limit = null;
            usage.mockInterviews.remaining = null;
          } else {
            usage.mockInterviews.limit = 20;
            usage.mockInterviews.remaining = Math.max(0, 20 - mockUsed);
          }
        }
      } catch (mockErr) {
        console.warn('[USAGE] Mock interview usage read failed (non-blocking):', mockErr?.message || mockErr);
      }
    }

    // Get Interview Questions monthly usage from database
    if (['free', 'trial', 'essential', 'pro', 'premium', 'weekly', 'monthly', 'pack'].includes(plan) && isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        if (d1User && d1User.id) {
          // Get current month's usage by summing all daily counts for the month
          // Use UTC dates to match the increment function which uses UTC
          const now = new Date();
          const year = now.getUTCFullYear();
          const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const monthStart = `${year}-${month}-01`;
      // Calculate actual last day of month (end-of-month fix)
      function getLastDayOfMonth(year, month) {
        return new Date(Date.UTC(year, month, 0)).getUTCDate();
      }
      const lastDayOfMonth = getLastDayOfMonth(year, Number(month));
      const monthEnd = `${year}-${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
          
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
          // Max legitimate monthly usage by plan (new format):
          //   Trial/Essential: 10 sets/day × 31 days = 310 sets/month
          //   Pro: 20 sets/day × 31 days = 620 sets/month
          //   Premium: 50 sets/day × 31 days = 1550 sets/month
          // Max old format monthly usage (old limits were questions):
          //   Trial: 40 questions/day × 31 days = 1240 questions (124 sets)
          //   Essential: 80 questions/day × 31 days = 2480 questions (248 sets)
          //   Pro: 150 questions/day × 31 days = 4650 questions (465 sets)
          //   Premium: 250 questions/day × 31 days = 7750 questions (775 sets)
          // Convert if value is >= 300 (above max new format for trial/essential) AND multiple of 10
          // This catches all old format values (1240, 2480, 4650, 7750) while avoiding false positives
          // Edge case: 300, 600, 1500 in new format are possible but rare; if they're multiples of 10,
          // they'll be converted (300→30, 600→60, 1500→150), which is acceptable for display purposes
          const MONTHLY_CONVERSION_THRESHOLD = 300; // Above max new format for trial/essential (310)
          if (totalUsed >= MONTHLY_CONVERSION_THRESHOLD && totalUsed >= 10 && totalUsed % 10 === 0) {
            const oldValue = totalUsed;
            totalUsed = Math.floor(totalUsed / 10);
            console.log('[USAGE] Converted old format monthly usage for interview_questions:', { uid, oldValue, newValue: totalUsed });
          }
          
          usage.interviewQuestions.used = totalUsed;
          
          // Get daily usage for interview questions
          const PLAN_LIMITS = {
            trial: 10,
            essential: 10,
            pro: 20,
            premium: 50
          };
          
          const dailyLimit = PLAN_LIMITS[plan];
          if (dailyLimit) {
            const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
            const dailyResult = await env.DB.prepare(
              `SELECT count FROM feature_daily_usage
               WHERE user_id = ? AND feature = 'interview_questions'
               AND usage_date = ?`
            ).bind(d1User.id, today).first();
            
            const dailyUsed = (dailyResult && dailyResult.count !== null && dailyResult.count !== undefined) 
              ? Number(dailyResult.count) 
              : 0;
            
            // Normalize old format for daily usage
            // Old format stored questions (multiples of 10), new format stores sets (1 per set)
            // Normalize if value is > dailyLimit AND multiple of 10 (clearly old format)
            // Values <= dailyLimit that are multiples of 10 are ambiguous (could be old or new format)
            //   - Assume new format (don't normalize) to be safe for display
            //   - Worst case: old format value at limit shows correctly as limit (e.g., 10 sets)
            // Example: Trial user (limit 10) with old format 50 (5 sets) → normalize to 5
            // Example: Trial user (limit 10) with old format 10 (1 set) → don't normalize (assume new format 10 sets)
            let normalizedDaily = dailyUsed;
            if (dailyUsed > dailyLimit && dailyUsed >= 10 && dailyUsed % 10 === 0) {
              normalizedDaily = Math.floor(dailyUsed / 10);
            }
            
            usage.interviewQuestions.dailyUsed = normalizedDaily;
            usage.interviewQuestions.dailyLimit = dailyLimit;
            usage.interviewQuestions.dailyRemaining = Math.max(0, dailyLimit - normalizedDaily);
          }
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
