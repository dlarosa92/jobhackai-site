// Resume Feedback endpoint
// AI-powered section-by-section feedback with hybrid grammar verification

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateATSFeedback } from '../_lib/openai-client.js';
import { scoreResume } from '../_lib/ats-scoring-engine.js';
import { applyHybridGrammarScoring } from '../_lib/hybrid-grammar-scoring.js';
import { FEATURE_KEYS } from '../_lib/usage-config.js';
import { getUsageForUser, checkFeatureAllowed, incrementFeatureUsage, getCooldownStatus, touchCooldown } from '../_lib/usage-tracker.js';
import { saveLastAtsAnalysis } from '../_lib/ats-analysis-persistence.js';

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

/**
 * Update usage counters for feedback requests
 * Called for both cache hits and cache misses to prevent bypassing limits
 */
async function updateUsageCounters(uid, resumeId, plan, env) {
  if (!env.JOBHACKAI_KV) {
    return;
  }

  // Update throttles and usage (Trial)
  if (plan === 'trial') {
    const throttleKey = `feedbackThrottle:${uid}`;
    await env.JOBHACKAI_KV.put(throttleKey, String(Date.now()), {
      expirationTtl: 60 // 60 seconds - matches throttle window
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
  if (plan === 'essential') {
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
    
    // Log plan detection for debugging
    console.log('[RESUME-FEEDBACK] Plan check:', { uid, plan, hasKV: !!env.JOBHACKAI_KV, environment: env.ENVIRONMENT, origin });

    // Dev environment bypass: Allow authenticated users in dev environment
    // This allows testing with dev plan override without requiring KV storage setup
    // SECURITY: Use exact origin matching to prevent bypass attacks (e.g., attacker.com/dev.jobhackai.io)
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' || isDevOrigin;
    const effectivePlan = isDevEnvironment && plan === 'free' ? 'pro' : plan;
    
    console.log('[RESUME-FEEDBACK] Effective plan:', { plan, effectivePlan, isDevEnvironment });

    // Initialize usage doc and enforce cooldown/limits BEFORE any heavy work
    await getUsageForUser(env, uid, effectivePlan);

    // Cooldown check (60 seconds)
    const cooldown = await getCooldownStatus(env, uid, FEATURE_KEYS.RESUME_FEEDBACK, 60);
    if (cooldown.onCooldown) {
      return json({
        success: false,
        error: 'cooldown',
        message: 'Please wait before requesting another feedback.',
        feature: FEATURE_KEYS.RESUME_FEEDBACK,
        plan: effectivePlan,
        reason: 'cooldown',
        used: null,
        limit: null,
        cooldownSecondsRemaining: cooldown.cooldownSecondsRemaining
      }, 429, origin, env);
    }

    // Usage limit check
    const usageCheck = await checkFeatureAllowed(env, uid, FEATURE_KEYS.RESUME_FEEDBACK);
    if (!usageCheck.allowed) {
      return json({
        success: false,
        error: 'forbidden',
        message: 'Feature usage limit reached',
        feature: usageCheck.feature,
        plan: usageCheck.plan,
        reason: usageCheck.reason,
        used: usageCheck.used,
        limit: usageCheck.limit
      }, 403, origin, env);
    }

    // Parse request body
    const body = await request.json();
    const { resumeId, jobTitle, resumeText, isMultiColumn } = body;

    if (!resumeId) {
      return json({ success: false, error: 'resumeId required' }, 400, origin, env);
    }

    if (!jobTitle || jobTitle.trim().length === 0) {
      return json({ success: false, error: 'jobTitle required' }, 400, origin, env);
    }

    // All ad-hoc throttles/limits replaced by centralized usage tracker

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

    // If cached, still update usage counters (user is consuming the feature)
    // Then return cached result
    if (cachedResult) {
      console.log(`[RESUME-FEEDBACK] Cache hit for ${uid}`, { resumeId, plan: effectivePlan });
      // Increment usage and touch cooldown for cache hits too
      let usageMeta = null;
      try {
        const inc = await incrementFeatureUsage(env, uid, effectivePlan, FEATURE_KEYS.RESUME_FEEDBACK);
        await touchCooldown(env, uid, effectivePlan, FEATURE_KEYS.RESUME_FEEDBACK);
        usageMeta = {
          plan: inc.plan,
          feature: FEATURE_KEYS.RESUME_FEEDBACK,
          limit: inc.limit,
          used: inc.used,
          cooldownSecondsRemaining: 0
        };
      } catch (e) {
        console.warn('[RESUME-FEEDBACK] Usage increment/touch failed (non-fatal):', e);
      }
      return json({
        success: true,
        ...cachedResult,
        cached: true,
        ...(usageMeta ? { usage: usageMeta } : {})
      }, 200, origin, env);
    }

    // Retrieve resume from KV or request body (dev fallback)
    let resumeData = null;
    
    if (env.JOBHACKAI_KV) {
      // Try to get resume from KV storage
      const resumeKey = `resume:${resumeId}`;
      const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
      
      if (resumeDataStr) {
        resumeData = JSON.parse(resumeDataStr);
        
        // Verify resume belongs to user
        if (resumeData.uid !== uid) {
          return json({ success: false, error: 'Unauthorized' }, 403, origin, env);
        }
      } else {
        // KV available but resume not found - allow dev fallback if resumeText provided
        if (isDevEnvironment && resumeText) {
          // Use resume text from request body (dev mode fallback when KV resume missing)
          resumeData = {
            uid,
            text: resumeText,
            isMultiColumn: isMultiColumn || false,
            fileName: 'dev-resume',
            uploadedAt: Date.now()
          };
          console.log('[RESUME-FEEDBACK] KV resume not found, using dev fallback with resumeText from request body');
        } else {
          // KV available but resume not found and no dev fallback
          return json({ success: false, error: 'Resume not found' }, 404, origin, env);
        }
      }
    } else {
      // KV not available - allow dev fallback with resumeText in request body
      if (isDevEnvironment && resumeText) {
        // Use resume text from request body (dev mode fallback)
        resumeData = {
          uid,
          text: resumeText,
          isMultiColumn: isMultiColumn || false,
          fileName: 'dev-resume',
          uploadedAt: Date.now()
        };
        console.log('[RESUME-FEEDBACK] KV not available, using dev fallback: resume text from request body');
      } else {
        // KV not available and no dev fallback provided
        return json({ 
          success: false, 
          error: 'Storage not available',
          message: 'KV storage is required for resume retrieval. In dev environments, you can pass resumeText in the request body as a fallback.'
        }, 500, origin, env);
      }
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

    // Hybrid grammar verification: AI check only if rule-based score is perfect
    await applyHybridGrammarScoring({
      ruleBasedScores,
      resumeText: resumeData.text,
      env,
      resumeId
    });

    // Generate AI feedback with exponential backoff retry
    let aiFeedback = null;
    let tokenUsage = 0;
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const aiResponse = await generateATSFeedback(
          resumeData.text,
          ruleBasedScores,
          jobTitle,
          env
        );
        
        // Capture token usage from OpenAI response
        if (aiResponse && aiResponse.usage) {
          tokenUsage = aiResponse.usage.totalTokens || 0;
        }
        
        // Handle falsy content: treat as error and apply backoff
        if (!aiResponse || !aiResponse.content) {
          lastError = new Error('AI response missing content');
          console.error(`[RESUME-FEEDBACK] AI response missing content (attempt ${attempt + 1}/${maxRetries})`);
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          continue;
        }
        
        // Parse AI response (structured output should be JSON)
        try {
          aiFeedback = typeof aiResponse.content === 'string' 
            ? JSON.parse(aiResponse.content)
            : aiResponse.content;
          
          // Validate structure
          if (aiFeedback && aiFeedback.atsRubric) {
            break; // Success, exit retry loop
          } else {
            // Invalid structure - treat as error
            lastError = new Error('AI response missing required atsRubric structure');
            console.error(`[RESUME-FEEDBACK] Invalid AI response structure (attempt ${attempt + 1}/${maxRetries})`);
            if (attempt < maxRetries - 1) {
              const waitTime = Math.pow(2, attempt) * 1000;
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        } catch (parseError) {
          lastError = parseError;
          console.error(`[RESUME-FEEDBACK] Failed to parse AI response (attempt ${attempt + 1}/${maxRetries}):`, parseError);
          // Apply exponential backoff for parse errors too
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          // Continue to next attempt if parsing fails
          continue;
        }
      } catch (aiError) {
        lastError = aiError;
        console.error(`[RESUME-FEEDBACK] AI feedback error (attempt ${attempt + 1}/${maxRetries}):`, aiError);
        
        // Exponential backoff: wait 1s, 2s, 4s
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // Log failed responses to KV for diagnostics (best effort)
    if (!aiFeedback && lastError && env.JOBHACKAI_KV) {
      try {
        const errorKey = `feedbackError:${uid}:${Date.now()}`;
        await env.JOBHACKAI_KV.put(errorKey, JSON.stringify({
          resumeId,
          jobTitle,
          error: lastError.message,
          timestamp: Date.now()
        }), {
          expirationTtl: 604800 // 7 days
        });
      } catch (kvError) {
        console.warn('[RESUME-FEEDBACK] Failed to log error to KV:', kvError);
      }
    }

    // Build result with AI feedback if available, otherwise use rule-based scores
    const result = aiFeedback && aiFeedback.atsRubric ? {
      atsRubric: aiFeedback.atsRubric.map((item, idx) => ({
        category: item.category || ['Keyword Match', 'ATS Formatting', 'Structure & Organization', 'Tone & Clarity', 'Grammar & Spelling'][idx],
        score: item.score ?? ruleBasedScores[['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'][idx]]?.score ?? 0,
        max: item.max ?? 10,
        feedback: item.feedback || ruleBasedScores[['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'][idx]]?.feedback || '',
        suggestions: item.suggestions || []
      })),
      roleSpecificFeedback: aiFeedback.roleSpecificFeedback || [
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
      aiFeedback: aiFeedback
    } : {
      // Fallback to rule-based scores if AI fails
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
      aiFeedback: null
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

    // Increment usage and touch cooldown for success (cache miss)
    let usageMeta = null;
    try {
      const inc = await incrementFeatureUsage(env, uid, effectivePlan, FEATURE_KEYS.RESUME_FEEDBACK);
      await touchCooldown(env, uid, effectivePlan, FEATURE_KEYS.RESUME_FEEDBACK);
      usageMeta = {
        plan: inc.plan,
        feature: FEATURE_KEYS.RESUME_FEEDBACK,
        limit: inc.limit,
        used: inc.used,
        cooldownSecondsRemaining: 0
      };
    } catch (e) {
      console.warn('[RESUME-FEEDBACK] Usage increment/touch failed (non-fatal):', e);
    }

    // Persist last ATS analysis (24h TTL)
    try {
      const breakdown = {
        keywordScore: ruleBasedScores.keywordScore.score,
        formattingScore: ruleBasedScores.formattingScore.score,
        structureScore: ruleBasedScores.structureScore.score,
        toneScore: ruleBasedScores.toneScore.score,
        grammarScore: ruleBasedScores.grammarScore.score
      };
      await saveLastAtsAnalysis(env, uid, {
        createdAt: Date.now(),
        plan: effectivePlan,
        jobTitle,
        atsScore: {
          overall: ruleBasedScores.overallScore,
          breakdown
        },
        atsRubric: result.atsRubric,
        roleSpecificFeedback: result.roleSpecificFeedback
      });
    } catch (persistErr) {
      console.warn('[RESUME-FEEDBACK] saveLastAtsAnalysis failed (non-fatal):', persistErr);
    }

    return json({
      success: true,
      tokenUsage: tokenUsage,
      ...result,
      ...(usageMeta ? { usage: usageMeta } : {})
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

