// Resume Feedback endpoint
// AI-powered section-by-section feedback

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateATSFeedback } from '../_lib/openai-client.js';
import { scoreResume } from '../_lib/ats-scoring-engine.js';

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
    'Vary': 'Origin'
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env)
    }
  });
}

async function getUserPlan(uid, env) {
  if (!env.JOBHACKAI_KV) {
    return 'free';
  }
  
  const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
  return plan || 'free';
}

async function getTrialEndDate(uid, env) {
  if (!env.JOBHACKAI_KV) {
    return null;
  }
  
  const trialEnd = await env.JOBHACKAI_KV.get(`trialEndByUid:${uid}`);
  if (!trialEnd) {
    return null;
  }
  
  // Trial end is stored as Unix timestamp in seconds
  const trialEndTimestamp = parseInt(trialEnd, 10) * 1000; // Convert to milliseconds
  return new Date(trialEndTimestamp);
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);

    // Check plan access (Free plan locked)
    if (plan === 'free') {
      return json({
        success: false,
        error: 'Feature locked',
        message: 'Resume Feedback is available in Trial, Essential, Pro, or Premium plans.',
        upgradeRequired: true
      }, 403, origin, env);
    }

    // Parse request body
    const body = await request.json();
    const { resumeId, jobTitle } = body;

    if (!resumeId) {
      return json({ success: false, error: 'resumeId required' }, 400, origin, env);
    }

    if (!jobTitle || jobTitle.trim().length === 0) {
      return json({ success: false, error: 'jobTitle required' }, 400, origin, env);
    }

    // Throttle check (Trial only)
    if (plan === 'trial' && env.JOBHACKAI_KV) {
      const throttleKey = `feedbackThrottle:${uid}`;
      const lastRun = await env.JOBHACKAI_KV.get(throttleKey);
      
      if (lastRun) {
        const lastRunTime = parseInt(lastRun, 10);
        const now = Date.now();
        const timeSinceLastRun = now - lastRunTime;
        
        if (timeSinceLastRun < 60000) { // 60 seconds
          const retryAfter = Math.ceil((60000 - timeSinceLastRun) / 1000);
          return json({
            success: false,
            error: 'Rate limit exceeded',
            message: 'Please wait before requesting another feedback (1 request per minute).',
            retryAfter
          }, 429, origin, env);
        }
      }

      // Daily limit check (Trial: max 5/day)
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `feedbackDaily:${uid}:${today}`;
      const dailyCount = await env.JOBHACKAI_KV.get(dailyKey);
      
      if (dailyCount && parseInt(dailyCount, 10) >= 5) {
        return json({
          success: false,
          error: 'Daily limit reached',
          message: 'You have reached the daily limit (5 feedbacks/day). Upgrade to Pro for unlimited feedback.',
          upgradeRequired: true
        }, 429, origin, env);
      }

      // Per-doc cap check (Trial: max 3 passes per resume)
      // Only enforce if user is still on trial plan (check in case they upgraded)
      const docPassesKey = `feedbackDocPasses:${uid}:${resumeId}`;
      const docPasses = await env.JOBHACKAI_KV.get(docPassesKey);
      
      if (docPasses && parseInt(docPasses, 10) >= 3) {
        // Check if user is still on trial (they might have upgraded)
        const currentPlan = await getUserPlan(uid, env);
        if (currentPlan === 'trial') {
          return json({
            success: false,
            error: 'Per-document limit reached',
            message: 'You have reached the limit for this resume (3 passes). Upgrade to Pro for unlimited passes.',
            upgradeRequired: true
          }, 403, origin, env);
        }
        // If they upgraded, clear the old limit by not returning error
        // The limit will be reset when we update it below
      }
    }

    // Usage limits (Essential: 3/month)
    if (plan === 'essential' && env.JOBHACKAI_KV) {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const usageKey = `feedbackUsage:${uid}:${monthKey}`;
      const usage = await env.JOBHACKAI_KV.get(usageKey);
      
      if (usage && parseInt(usage, 10) >= 3) {
        return json({
          success: false,
          error: 'Monthly limit reached',
          message: 'You have used all 3 feedbacks this month. Upgrade to Pro for unlimited feedback.',
          upgradeRequired: true
        }, 403, origin, env);
      }
    }

    // Cache check (all plans)
    let cachedResult = null;
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${resumeId}:${jobTitle}:feedback`);
      const cacheKey = `feedbackCache:${cacheHash}`;
      const cached = await env.JOBHACKAI_KV.get(cacheKey);
      
      if (cached) {
        const cachedData = JSON.parse(cached);
        const cacheAge = Date.now() - cachedData.timestamp;
        
        // Cache valid for 24 hours
        if (cacheAge < 86400000) {
          cachedResult = cachedData.result;
        }
      }
    }

    // If cached, return cached result
    if (cachedResult) {
      console.log(`[RESUME-FEEDBACK] Cache hit for ${uid}`, { resumeId, plan });
      return json({
        success: true,
        ...cachedResult,
        cached: true
      }, 200, origin, env);
    }

    // Retrieve resume from KV
    if (!env.JOBHACKAI_KV) {
      return json({ success: false, error: 'Storage not available' }, 500, origin, env);
    }

    const resumeKey = `resume:${resumeId}`;
    const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
    
    if (!resumeDataStr) {
      return json({ success: false, error: 'Resume not found' }, 404, origin, env);
    }

    const resumeData = JSON.parse(resumeDataStr);
    
    // Verify resume belongs to user
    if (resumeData.uid !== uid) {
      return json({ success: false, error: 'Unauthorized' }, 403, origin, env);
    }

    // Cost guardrails
    if (resumeData.text.length > 80000) {
      return json({ 
        success: false, 
        error: 'Resume text exceeds 80,000 character limit' 
      }, 400, origin, env);
    }

    // Get rule-based scores first (for AI context)
    const ruleBasedScores = scoreResume(
      resumeData.text,
      jobTitle,
      { isMultiColumn: resumeData.isMultiColumn }
    );

    // Generate AI feedback
    // TODO: [OPENAI INTEGRATION POINT] - Uncomment when OpenAI is configured
    // let aiFeedback = null;
    // try {
    //   const aiResponse = await generateATSFeedback(
    //     resumeData.text,
    //     ruleBasedScores,
    //     jobTitle,
    //     env
    //   );
    //   
    //   // Parse AI response
    //   if (aiResponse.content) {
    //     try {
    //       aiFeedback = JSON.parse(aiResponse.content);
    //     } catch (parseError) {
    //       console.error('[RESUME-FEEDBACK] Failed to parse AI response:', parseError);
    //     }
    //   }
    // } catch (aiError) {
    //   console.error('[RESUME-FEEDBACK] AI feedback error:', aiError);
    //   // Continue without AI feedback if it fails
    // }

    // For now, use rule-based scores formatted as feedback (AI integration pending)
    const result = {
      atsRubric: [
        {
          category: 'Keyword Match',
          score: ruleBasedScores.keywordScore.score,
          max: ruleBasedScores.keywordScore.max,
          feedback: ruleBasedScores.keywordScore.feedback
        },
        {
          category: 'ATS Formatting',
          score: ruleBasedScores.formattingScore.score,
          max: ruleBasedScores.formattingScore.max,
          feedback: ruleBasedScores.formattingScore.feedback
        },
        {
          category: 'Structure & Organization',
          score: ruleBasedScores.structureScore.score,
          max: ruleBasedScores.structureScore.max,
          feedback: ruleBasedScores.structureScore.feedback
        },
        {
          category: 'Tone & Clarity',
          score: ruleBasedScores.toneScore.score,
          max: ruleBasedScores.toneScore.max,
          feedback: ruleBasedScores.toneScore.feedback
        },
        {
          category: 'Grammar & Spelling',
          score: ruleBasedScores.grammarScore.score,
          max: ruleBasedScores.grammarScore.max,
          feedback: ruleBasedScores.grammarScore.feedback
        }
      ],
      roleSpecificFeedback: [
        {
          section: 'Header & Contact',
          score: '8/10',
          feedback: 'Clear and concise. Consider adding a custom resume URL for extra polish.'
        },
        {
          section: 'Professional Summary',
          score: '6/10',
          feedback: 'Strong opening but lacks keywords for your target role.'
        },
        {
          section: 'Experience',
          score: '7/10',
          feedback: 'Great structure. Quantify impact with metrics.'
        },
        {
          section: 'Skills',
          score: '9/10',
          feedback: 'Relevant and up-to-date. Group under sub-headings.'
        },
        {
          section: 'Education',
          score: '10/10',
          feedback: 'Well-formatted. No changes needed.'
        }
      ],
      aiFeedback: null // Will be populated when OpenAI is configured
    };

    // Cache result (24 hours)
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${resumeId}:${jobTitle}:feedback`);
      const cacheKey = `feedbackCache:${cacheHash}`;
      await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
        result,
        timestamp: Date.now()
      }), {
        expirationTtl: 86400 // 24 hours
      });
    }

    // Update throttles and usage (Trial)
    if (plan === 'trial' && env.JOBHACKAI_KV) {
      const throttleKey = `feedbackThrottle:${uid}`;
      await env.JOBHACKAI_KV.put(throttleKey, String(Date.now()), {
        expirationTtl: 120 // 2 minutes
      });

      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `feedbackDaily:${uid}:${today}`;
      const currentCount = await env.JOBHACKAI_KV.get(dailyKey);
      const newCount = currentCount ? parseInt(currentCount, 10) + 1 : 1;
      await env.JOBHACKAI_KV.put(dailyKey, String(newCount), {
        expirationTtl: 86400 // 24 hours
      });

      const docPassesKey = `feedbackDocPasses:${uid}:${resumeId}`;
      const currentPasses = await env.JOBHACKAI_KV.get(docPassesKey);
      const newPasses = currentPasses ? parseInt(currentPasses, 10) + 1 : 1;
      
      // Set expiration based on trial end date, or use 7 days as fallback
      let expirationTtl = 604800; // 7 days default (covers 3-day trial + buffer)
      const trialEndDate = await getTrialEndDate(uid, env);
      if (trialEndDate) {
        const now = Date.now();
        const trialEndMs = trialEndDate.getTime();
        const secondsUntilTrialEnd = Math.max(0, Math.floor((trialEndMs - now) / 1000));
        // Use trial end date + 1 day buffer, or minimum 1 day
        expirationTtl = Math.max(86400, secondsUntilTrialEnd + 86400);
      }
      
      await env.JOBHACKAI_KV.put(docPassesKey, String(newPasses), {
        expirationTtl: expirationTtl
      });
    }

    // Track usage (Essential)
    if (plan === 'essential' && env.JOBHACKAI_KV) {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const usageKey = `feedbackUsage:${uid}:${monthKey}`;
      const currentUsage = await env.JOBHACKAI_KV.get(usageKey);
      const newUsage = currentUsage ? parseInt(currentUsage, 10) + 1 : 1;
      
      // Calculate expiration: end of current month + 2 days buffer
      // This ensures the key expires after the month boundary and doesn't interfere with next month
      const year = now.getFullYear();
      const month = now.getMonth();
      const nextMonth = new Date(year, month + 1, 1); // First day of next month
      const expirationDate = new Date(nextMonth.getTime() + (2 * 24 * 60 * 60 * 1000)); // +2 days
      const expirationTtl = Math.max(86400, Math.floor((expirationDate.getTime() - now.getTime()) / 1000));
      
      await env.JOBHACKAI_KV.put(usageKey, String(newUsage), {
        expirationTtl: expirationTtl
      });
    }

    return json({
      success: true,
      ...result
    }, 200, origin, env);

  } catch (error) {
    console.error('[RESUME-FEEDBACK] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

// Simple hash function for cache keys
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

