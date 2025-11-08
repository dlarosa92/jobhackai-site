// ATS Score endpoint
// Rule-based scoring (no AI tokens) + optional AI for narrative feedback

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { scoreResume } from '../_lib/ats-scoring-engine.js';
import { generateATSFeedback } from '../_lib/openai-client.js';

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
      const throttleKey = `atsThrottle:${uid}`;
      const lastRun = await env.JOBHACKAI_KV.get(throttleKey);
      
      if (lastRun) {
        const lastRunTime = parseInt(lastRun, 10);
        const now = Date.now();
        const timeSinceLastRun = now - lastRunTime;
        
        if (timeSinceLastRun < 30000) { // 30 seconds
          const retryAfter = Math.ceil((30000 - timeSinceLastRun) / 1000);
          return json({
            success: false,
            error: 'Rate limit exceeded',
            message: 'Please wait before running another ATS score.',
            retryAfter
          }, 429, origin, env);
        }
      }
    }

    // Cache check (all plans)
    let cachedResult = null;
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${resumeId}:${jobTitle}:ats`);
      const cacheKey = `atsCache:${cacheHash}`;
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

    // Usage limits (Free plan - 1 lifetime)
    if (plan === 'free' && env.JOBHACKAI_KV) {
      const usageKey = `atsUsage:${uid}:lifetime`;
      const usage = await env.JOBHACKAI_KV.get(usageKey);
      
      if (usage && parseInt(usage, 10) >= 1) {
        return json({
          success: false,
          error: 'Usage limit reached',
          message: 'You have used your free ATS score. Upgrade to Trial or Essential for unlimited scoring.',
          upgradeRequired: true
        }, 403, origin, env);
      }
    }

    // If cached, return cached result
    if (cachedResult) {
      console.log(`[ATS-SCORE] Cache hit for ${uid}`, { resumeId, plan });
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

    if (resumeData.fileSize > 2 * 1024 * 1024) {
      return json({ 
        success: false, 
        error: 'File size exceeds 2MB limit' 
      }, 400, origin, env);
    }

    // Run rule-based scoring (NO AI TOKENS)
    const ruleBasedScores = scoreResume(
      resumeData.text,
      jobTitle,
      { isMultiColumn: resumeData.isMultiColumn }
    );

    // Generate AI feedback (only for narrative, not scores)
    // TODO: [OPENAI INTEGRATION POINT] - Uncomment when OpenAI is configured
    // let aiFeedback = null;
    // try {
    //   aiFeedback = await generateATSFeedback(
    //     resumeData.text,
    //     ruleBasedScores,
    //     jobTitle,
    //     env
    //   );
    // } catch (aiError) {
    //   console.error('[ATS-SCORE] AI feedback error:', aiError);
    //   // Continue without AI feedback if it fails
    // }

    // For now, use rule-based scores only (AI integration pending)
    const result = {
      score: ruleBasedScores.overallScore,
      breakdown: {
        keywordScore: ruleBasedScores.keywordScore,
        formattingScore: ruleBasedScores.formattingScore,
        structureScore: ruleBasedScores.structureScore,
        toneScore: ruleBasedScores.toneScore,
        grammarScore: ruleBasedScores.grammarScore
      },
      recommendations: ruleBasedScores.recommendations,
      aiFeedback: null // Will be populated when OpenAI is configured
    };

    // Cache result (24 hours)
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${resumeId}:${jobTitle}:ats`);
      const cacheKey = `atsCache:${cacheHash}`;
      await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
        result,
        timestamp: Date.now()
      }), {
        expirationTtl: 86400 // 24 hours
      });
    }

    // Update throttle (Trial only)
    if (plan === 'trial' && env.JOBHACKAI_KV) {
      const throttleKey = `atsThrottle:${uid}`;
      await env.JOBHACKAI_KV.put(throttleKey, String(Date.now()), {
        expirationTtl: 60 // 1 minute
      });
    }

    // Track usage (Free plan only)
    if (plan === 'free' && env.JOBHACKAI_KV) {
      const usageKey = `atsUsage:${uid}:lifetime`;
      await env.JOBHACKAI_KV.put(usageKey, '1'); // No expiration - lifetime limit
    }

    return json({
      success: true,
      ...result
    }, 200, origin, env);

  } catch (error) {
    console.error('[ATS-SCORE] Error:', error);
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

