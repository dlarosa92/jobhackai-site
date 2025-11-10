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

  // Early KV binding check
  if (!env.JOBHACKAI_KV) {
    console.error('[ATS-SCORE] KV binding not found');
    return json({ 
      success: false, 
      error: 'KV binding not found',
      message: 'Storage service unavailable' 
    }, 500, origin, env);
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
    if (plan === 'trial') {
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
    const cacheHash = await hashString(`${resumeId}:${jobTitle}:ats`);
    const cacheKey = `atsCache:${cacheHash}`;
    const cached = await env.JOBHACKAI_KV.get(cacheKey);
    
    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        const cacheAge = Date.now() - cachedData.timestamp;
        
        // Cache valid for 24 hours
        if (cacheAge < 86400000) {
          cachedResult = cachedData.result;
        }
      } catch (parseError) {
        console.error('[ATS-SCORE] Cache parse error:', parseError);
        // Continue without cache if parse fails
      }
    }

    // Usage limits (Free plan - 1 lifetime)
    if (plan === 'free') {
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
    const resumeKey = `resume:${resumeId}`;
    let resumeDataStr;
    try {
      resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
    } catch (kvError) {
      console.error('[ATS-SCORE] KV read error:', kvError);
      return json({ 
        success: false, 
        error: 'Storage error',
        message: 'Failed to retrieve resume data' 
      }, 500, origin, env);
    }
    
    if (!resumeDataStr) {
      return json({ success: false, error: 'Resume not found' }, 404, origin, env);
    }

    let resumeData;
    try {
      resumeData = JSON.parse(resumeDataStr);
    } catch (parseError) {
      console.error('[ATS-SCORE] Resume data parse error:', parseError);
      return json({ 
        success: false, 
        error: 'Invalid resume data',
        message: 'Failed to parse resume data' 
      }, 500, origin, env);
    }
    
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

    // Validate resume text exists and is not empty
    const text = resumeData.text;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('[ATS-SCORE] Invalid resume text:', {
        hasText: !!text,
        textType: typeof text,
        textLength: text?.length
      });
      return json({ 
        success: false, 
        error: 'Invalid resume data',
        message: 'Resume text is missing or empty'
      }, 400, origin, env);
    }

    // Validate text length (minimum 100 chars, max 80k)
    if (text.length < 100) {
      return json({ 
        success: false, 
        error: 'Text extraction failed or OCR not implemented',
        message: 'Resume text is too short. Please upload a text-based PDF or DOCX file.'
      }, 400, origin, env);
    }

    // Run rule-based scoring (NO AI TOKENS)
    let ruleBasedScores;
    try {
      console.log('[ATS-SCORE] Input length:', text.length);
      console.log('[ATS-SCORE] Starting scoring:', {
        textLength: text.length,
        jobTitle,
        isMultiColumn: resumeData.isMultiColumn
      });
      
      ruleBasedScores = scoreResume(
        text,
        jobTitle,
        { isMultiColumn: resumeData.isMultiColumn }
      );
      
      console.log('[ATS-SCORE] Score result:', {
        overallScore: ruleBasedScores?.overallScore,
        keywordScore: ruleBasedScores?.keywordScore?.score,
        formattingScore: ruleBasedScores?.formattingScore?.score,
        structureScore: ruleBasedScores?.structureScore?.score,
        toneScore: ruleBasedScores?.toneScore?.score,
        grammarScore: ruleBasedScores?.grammarScore?.score
      });
      
      // Validate scoreResume returned a valid object
      if (!ruleBasedScores || typeof ruleBasedScores !== 'object') {
        console.error('[ATS-SCORE] scoreResume returned invalid result:', ruleBasedScores);
        throw new Error('Scoring engine returned invalid result');
      }
      
      // Validate required properties exist
      if (typeof ruleBasedScores.overallScore !== 'number' ||
          !ruleBasedScores.keywordScore ||
          typeof ruleBasedScores.keywordScore.score !== 'number' ||
          !ruleBasedScores.formattingScore ||
          typeof ruleBasedScores.formattingScore.score !== 'number' ||
          !ruleBasedScores.structureScore ||
          typeof ruleBasedScores.structureScore.score !== 'number' ||
          !ruleBasedScores.toneScore ||
          typeof ruleBasedScores.toneScore.score !== 'number' ||
          !ruleBasedScores.grammarScore ||
          typeof ruleBasedScores.grammarScore.score !== 'number') {
        console.error('[ATS-SCORE] scoreResume missing required properties:', {
          overallScore: ruleBasedScores.overallScore,
          keywordScore: ruleBasedScores.keywordScore,
          formattingScore: ruleBasedScores.formattingScore,
          structureScore: ruleBasedScores.structureScore,
          toneScore: ruleBasedScores.toneScore,
          grammarScore: ruleBasedScores.grammarScore
        });
        throw new Error('Scoring engine returned incomplete result');
      }

      console.log('[ATS-SCORE] Scoring completed successfully');
    } catch (scoreError) {
      console.error('[ATS-SCORE] Scoring error:', scoreError);
      return json({ 
        success: false, 
        error: 'Scoring failed',
        message: scoreError.message || 'Failed to calculate ATS score'
      }, 500, origin, env);
    }

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
        keywordScore: ruleBasedScores.keywordScore.score,
        formattingScore: ruleBasedScores.formattingScore.score,
        structureScore: ruleBasedScores.structureScore.score,
        toneScore: ruleBasedScores.toneScore.score,
        grammarScore: ruleBasedScores.grammarScore.score
      },
      feedback: [
        ruleBasedScores.keywordScore.feedback,
        ruleBasedScores.formattingScore.feedback,
        ruleBasedScores.structureScore.feedback,
        ruleBasedScores.toneScore.feedback,
        ruleBasedScores.grammarScore.feedback
      ].filter(Boolean),
      recommendations: ruleBasedScores.recommendations || []
    };

    // Cache result (24 hours)
    try {
      const cacheKey = `atsCache:${cacheHash}`;
      await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
        result,
        timestamp: Date.now()
      }), {
        expirationTtl: 86400 // 24 hours
      });
    } catch (cacheError) {
      console.error('[ATS-SCORE] Cache write error:', cacheError);
      // Continue without caching if write fails
    }

    // Update throttle (Trial only)
    if (plan === 'trial') {
      try {
        const throttleKey = `atsThrottle:${uid}`;
        await env.JOBHACKAI_KV.put(throttleKey, String(Date.now()), {
          expirationTtl: 60 // 1 minute
        });
      } catch (throttleError) {
        console.error('[ATS-SCORE] Throttle write error:', throttleError);
        // Continue without throttling if write fails
      }
    }

    // Track usage (Free plan only)
    if (plan === 'free') {
      try {
        const usageKey = `atsUsage:${uid}:lifetime`;
        await env.JOBHACKAI_KV.put(usageKey, '1'); // No expiration - lifetime limit
      } catch (usageError) {
        console.error('[ATS-SCORE] Usage tracking error:', usageError);
        // Continue without tracking if write fails
      }
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

