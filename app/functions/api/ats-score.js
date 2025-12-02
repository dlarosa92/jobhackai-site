// ATS Score endpoint
// Rule-based scoring only (no AI grammar verification)

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { scoreResume } from '../_lib/ats-scoring-engine.js';
import { getOrCreateUserByAuthId, upsertResumeSessionWithScores, isD1Available } from '../_lib/db.js';

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

    // Parse request body - accept both resumeId (for KV) and resumeText (for direct scoring)
    const body = await request.json();
    const { resumeId, resumeText, jobTitle } = body;

    // Normalize job title - optional for scoring
    const normalizedJobTitle = (jobTitle && typeof jobTitle === 'string')
      ? jobTitle.trim()
      : '';

    // Get resume text - prefer resumeText from request, fall back to KV if available
    let text = resumeText;
    let resumeData = null;

    if (!text && resumeId) {
      // Try to load from KV if resumeText not provided
      const kv = env.JOBHACKAI_KV;
      if (kv) {
        try {
          const resumeKey = `resume:${resumeId}`;
          const resumeDataStr = await kv.get(resumeKey);
          if (resumeDataStr) {
            resumeData = JSON.parse(resumeDataStr);
            // Verify resume belongs to user
            if (resumeData.uid !== uid) {
              return json({ success: false, error: 'Unauthorized' }, 403, origin, env);
            }
            text = resumeData.text;
          }
        } catch (kvError) {
          console.warn('[ATS-SCORE] KV read failed (non-fatal):', kvError);
          // Continue without KV - will use resumeText if provided
        }
      } else {
        console.warn('[ATS-SCORE] KV missing and no resumeText provided');
      }
    }

    // Validate text is available
    if (!text || typeof text !== 'string' || text.trim().length < 100) {
      return json({ 
        success: false, 
        error: 'invalid-text',
        message: 'Resume text not available for scoring. Please upload a text-based PDF, DOCX, or TXT file.' 
      }, 400, origin, env);
    }

    // Cost guardrails
    if (text.length > 80000) {
      return json({ 
        success: false, 
        error: 'Resume text exceeds 80,000 character limit' 
      }, 400, origin, env);
    }

    // KV-based features (optional - only if KV is available)
    const kv = env.JOBHACKAI_KV;
    
    // Throttle check (Trial only) - best effort, skip if KV unavailable
    if (plan === 'trial' && kv) {
      try {
        const throttleKey = `atsThrottle:${uid}`;
        const lastRun = await kv.get(throttleKey);
        
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
      } catch (throttleError) {
        console.warn('[ATS-SCORE] Throttle check failed (non-fatal):', throttleError);
        // Continue without throttling if KV unavailable
      }
    }

    // Cache check (all plans) - best effort, skip if KV unavailable
    let cachedResult = null;
    if (kv) {
      try {
        // FIX: Use content-based hash instead of resumeId to ensure same resume = same cache
        // This prevents different users from getting different cached scores for the same resume
        // Use first 2000 chars for better uniqueness while keeping hash fast
        const textHash = await hashString(text.substring(0, 2000));
        const cacheKeyBase = `${textHash}:${normalizedJobTitle}:ats`;
        const cacheHash = await hashString(cacheKeyBase);
        const cacheKey = `atsCache:${cacheHash}`;
        const cached = await kv.get(cacheKey);
        
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
      } catch (cacheError) {
        console.warn('[ATS-SCORE] Cache check failed (non-fatal):', cacheError);
        // Continue without cache if KV unavailable
      }
    }

    // Usage limits (Free plan - 1 lifetime) - best effort, skip if KV unavailable
    if (plan === 'free' && kv) {
      try {
        const usageKey = `atsUsage:${uid}:lifetime`;
        const usage = await kv.get(usageKey);
        
        if (usage && parseInt(usage, 10) >= 1) {
          return json({
            success: false,
            error: 'Usage limit reached',
            message: 'You have used your free ATS score. Upgrade to Trial or Essential for unlimited scoring.',
            upgradeRequired: true
          }, 403, origin, env);
        }
      } catch (usageError) {
        console.warn('[ATS-SCORE] Usage check failed (non-fatal):', usageError);
        // Continue without usage tracking if KV unavailable
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

    // Get isMultiColumn from resumeData if available, otherwise default to false
    const isMultiColumn = resumeData?.isMultiColumn || false;

    // Run rule-based scoring (NO AI TOKENS)
    let ruleBasedScores;
    try {
      console.log('[ATS-SCORE] Input length:', text.length, 'jobTitle:', normalizedJobTitle);
      console.log('[ATS-SCORE] Starting scoring:', {
        textLength: text.length,
        jobTitle: normalizedJobTitle,
        isMultiColumn
      });
      
      ruleBasedScores = await scoreResume(
        text,
        normalizedJobTitle,
        { isMultiColumn },
        env
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
        error: 'scoring-failed',
        message: 'Unable to score resume at this time. Please try again in a few minutes.'
      }, 500, origin, env);
    }

    // Validate scoring result
    if (!ruleBasedScores || typeof ruleBasedScores.overallScore !== 'number') {
      console.error('[ATS-SCORE] Invalid scoring result:', ruleBasedScores);
      return json({ 
        success: false, 
        error: 'invalid-result',
        message: 'Scoring engine returned invalid data. Please try again.'
      }, 500, origin, env);
    }

    // --- D1 Persistence: Store ruleBasedScores as source of truth (non-blocking) ---
    if (isD1Available(env) && resumeId) {
      // Fire-and-forget: don't block response if D1 write fails
      (async () => {
        try {
          const d1User = await getOrCreateUserByAuthId(env, uid, null);
          if (d1User) {
            await upsertResumeSessionWithScores(env, d1User.id, {
              resumeId: resumeId,
              role: normalizedJobTitle || null,
              atsScore: ruleBasedScores.overallScore,
              ruleBasedScores: ruleBasedScores
            });
            console.log('[ATS-SCORE] Stored ruleBasedScores in D1', { resumeId, uid });
          }
        } catch (d1Error) {
          // Non-blocking: log but don't fail the request
          console.warn('[ATS-SCORE] D1 persistence failed (non-fatal):', d1Error.message);
        }
      })();
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

    // Cache result (24 hours) - best effort, skip if KV unavailable
    if (kv) {
      try {
        // FIX: Use same content-based hash for cache write
        const textHash = await hashString(text.substring(0, 2000));
        const cacheKeyBase = `${textHash}:${normalizedJobTitle}:ats`;
        const cacheHash = await hashString(cacheKeyBase);
        const cacheKey = `atsCache:${cacheHash}`;
        await kv.put(cacheKey, JSON.stringify({
          result,
          timestamp: Date.now()
        }), {
          expirationTtl: 86400 // 24 hours
        });
      } catch (cacheError) {
        console.warn('[ATS-SCORE] Cache write failed (non-fatal):', cacheError);
        // Continue without caching if write fails
      }
    }

    // Update throttle (Trial only) - best effort, skip if KV unavailable
    if (plan === 'trial' && kv) {
      try {
        const throttleKey = `atsThrottle:${uid}`;
        await kv.put(throttleKey, String(Date.now()), {
          expirationTtl: 60 // 1 minute
        });
      } catch (throttleError) {
        console.warn('[ATS-SCORE] Throttle write failed (non-fatal):', throttleError);
        // Continue without throttling if write fails
      }
    }

    // Track usage (Free plan only) - best effort, skip if KV unavailable
    if (plan === 'free' && kv) {
      try {
        const usageKey = `atsUsage:${uid}:lifetime`;
        await kv.put(usageKey, '1'); // No expiration - lifetime limit
      } catch (usageError) {
        console.warn('[ATS-SCORE] Usage tracking failed (non-fatal):', usageError);
        // Continue without tracking if write fails
      }
    }

    // Persist ATS score to KV + Firestore hybrid (best effort)
    if (kv && resumeId) {
      try {
        const lastResumeKey = `user:${uid}:lastResume`;
        const resumeState = {
          uid,
          resumeId,
          score: result.score,
          breakdown: result.breakdown,
          summary: result.feedback?.[0] || '',
          jobTitle: normalizedJobTitle,
          timestamp: Date.now(),
          syncedAt: Date.now()
        };
        await kv.put(lastResumeKey, JSON.stringify(resumeState), {
          expirationTtl: 2592000 // 30 days
        });
      } catch (persistError) {
        console.warn('[ATS-SCORE] Persistence failed (non-fatal):', persistError);
        // Continue without persistence if write fails
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

