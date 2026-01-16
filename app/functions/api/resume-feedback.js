// Resume Feedback endpoint
// AI-powered section-by-section feedback with rule-based grammar scoring (no AI grammar verification)
// Persists resume sessions and feedback to D1 for history

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateATSFeedback } from '../_lib/openai-client.js';
import { getGrammarDiagnostics } from '../_lib/grammar-engine.js';
import { errorResponse, successResponse, generateRequestId } from '../_lib/error-handler.js';
import { sanitizeJobTitle, sanitizeResumeText, sanitizeResumeId } from '../_lib/input-sanitizer.js';
import { validateAIFeedback, validateFeedbackResult, isValidFeedbackResult, normalizeRole, sanitizeRoleSpecificFeedback, isRoleSpecificFeedbackStrict } from '../_lib/feedback-validator.js';
import {
  getOrCreateUserByAuthId, 
  upsertResumeSessionWithScores,
  createFeedbackSession, 
  logUsageEvent,
  isD1Available
} from '../_lib/db.js';

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

import { getUserPlan } from '../_lib/db.js';

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
    // Throttle: 1 request per minute (abuse prevention)
    const throttleKey = `feedbackThrottle:${uid}`;
    await env.JOBHACKAI_KV.put(throttleKey, String(Date.now()), {
      expirationTtl: 60 // 60 seconds - matches throttle window
    });

    // Total trial feedback counter: exactly 3 total across entire trial
    const totalTrialKey = `feedbackTotalTrial:${uid}`;
    const currentTotal = await env.JOBHACKAI_KV.get(totalTrialKey);
    const newTotal = currentTotal ? parseInt(currentTotal, 10) + 1 : 1;
    
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
    
    await env.JOBHACKAI_KV.put(totalTrialKey, String(newTotal), {
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

function toExtractionQuality(diagnostics) {
  return {
    extractionStatus: diagnostics?.extractionStatus || 'ok',
    confidence: typeof diagnostics?.confidence === 'number' ? diagnostics.confidence : 1.0,
    tokenCount: typeof diagnostics?.tokenCount === 'number' ? diagnostics.tokenCount : 0
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const userEmail = payload.email; // Get email from token payload
    
    // Dev environment detection: Use exact origin matching to prevent bypass attacks
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    // Strengthened check: require both ENVIRONMENT=dev AND valid dev origin (exact match only)
    // Using isDevOrigin alone prevents matching malicious origins like 'https://evil.com/localhost'
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;
    
    let plan = await getUserPlan(env, uid);
    const allowedPlans = ['free', 'trial', 'essential', 'pro', 'premium'];
    if (!allowedPlans.includes(plan)) {
      console.warn('[RESUME-FEEDBACK] Invalid plan detected, normalizing to free', { requestId, uid, plan });
      plan = 'free';
    }
    
    // Log plan detection for debugging
    console.log('[RESUME-FEEDBACK] Plan check:', { 
      requestId,
      uid, 
      plan, 
      hasKV: !!env.JOBHACKAI_KV, 
      environment: env.ENVIRONMENT, 
      origin,
      isDevOrigin,
      isDevEnvironment
    });

    // Dev environment bypass: Allow authenticated users in dev environment
    // This allows testing with dev plan override without requiring KV storage setup
    // If plan lookup fails in dev environment, try to fetch from plan/me endpoint as fallback
    let effectivePlan = plan;
    
    // If plan is 'free' and we're in dev environment, upgrade to 'pro' for testing
    if (isDevEnvironment && plan === 'free') {
      // In dev environment, if D1 lookup failed, try to fetch plan from D1 one more time
      if (isD1Available(env)) {
        try {
          // Try to fetch plan directly from D1 one more time with better error handling
          const directPlan = await getUserPlan(env, uid);
          if (directPlan && directPlan !== 'free') {
            effectivePlan = directPlan;
            console.log('[RESUME-FEEDBACK] Found plan via direct D1 lookup:', effectivePlan);
          } else {
            // Still 'free' after direct lookup - upgrade to 'pro' for dev testing
            effectivePlan = 'pro';
            console.log('[RESUME-FEEDBACK] Plan lookup returned free in dev environment, upgrading to pro for testing');
          }
        } catch (dbError) {
          console.warn('[RESUME-FEEDBACK] D1 lookup failed in dev environment, upgrading to pro for testing:', dbError);
          effectivePlan = 'pro';
        }
      } else {
        // D1 not available in dev environment - upgrade to 'pro' for testing
        effectivePlan = 'pro';
        console.log('[RESUME-FEEDBACK] D1 not available in dev environment, upgrading to pro for testing');
      }
    }
    
    console.log('[RESUME-FEEDBACK] Effective plan:', { plan, effectivePlan, isDevEnvironment });

    // Track resume session for reuse across D1 reads/writes
    let resumeSession = null;

    // D1 session metadata (declared early to avoid TDZ)
    let d1SessionId = null;
    let d1CreatedAt = null;
    let preFeedbackSessionId = null;
    let preUsageEventId = null;

    // --- D1 User Resolution (best effort, non-blocking) ---
    // Resolve the authenticated user from D1 for session tracking
    // This is done early so we have user_id for all D1 operations
    let d1User = null;
    if (isD1Available(env)) {
      try {
        // Get or create user in D1 with email from Firebase token
        d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        console.log('[RESUME-FEEDBACK] D1 user resolved:', { userId: d1User?.id, authId: uid });
        if (!d1User) {
          return errorResponse('Failed to resolve user record', 500, origin, env, requestId);
        }
      } catch (d1Error) {
        console.error('[RESUME-FEEDBACK] D1 user resolution failed:', d1Error.message);
        return errorResponse('Failed to resolve user record', 500, origin, env, requestId);
      }
    } else {
      // If D1 is not available, fail immediately to enforce single persistence flow
      return errorResponse('Storage not available. Retry later.', 500, origin, env, requestId);
    }

    // Plan gating: always enforce from D1 (cache is just a performance hint)
    if (effectivePlan === 'free') {
      // Old behavior: block all free resume feedback, uncomment if you want to revert
      return errorResponse(
        'Resume Feedback is available in Trial, Essential, Pro, or Premium plans.',
        403,
        origin,
        env,
        requestId,
        { upgradeRequired: true }
      );
      
      /*
      // Or if you want a limited free tier (one run), use:
      if (!isD1Available(env))
        return errorResponse('Cannot verify free usage; please try again or contact support.', 500, origin, env, requestId);
      const db = getDb(env);
      const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
      if (!db || !d1User)
        return errorResponse('Cannot verify free usage; please try again or contact support.', 500, origin, env, requestId);
      const res = await db.prepare(`SELECT COUNT(*) as count FROM usage_events WHERE user_id = ? AND feature = 'resume_feedback'`).bind(d1User.id).first();
      const d1FreeCount = res?.count || 0;
      if (d1FreeCount >= 1) {
        return errorResponse(
          'You have used your one free feedback. Please upgrade!',
          403,
          origin,
          env,
          requestId,
          { upgradeRequired: true }
        );
      }
      // KV can be used for quick check/caching (never as authority)
      */
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[RESUME-FEEDBACK] JSON parse error:', { requestId, error: parseError.message });
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    const { resumeId, jobTitle, resumeText, isMultiColumn, includeOriginalResume } = body;

    // Validate resumeId exists and is not empty before sanitizing
    // Catch all falsy values (null, undefined, empty string, etc.) for consistent error handling
    if (!resumeId) {
      console.error('[RESUME-FEEDBACK] Missing resumeId:', { requestId, body: Object.keys(body), resumeId });
      return errorResponse('Resume ID is required', 400, origin, env, requestId);
    }

    // Sanitize and validate inputs
    const resumeIdValidation = sanitizeResumeId(resumeId);
    if (!resumeIdValidation.valid) {
      console.error('[RESUME-FEEDBACK] Invalid resumeId:', { requestId, resumeId, error: resumeIdValidation.error });
      return errorResponse(resumeIdValidation.error || 'Invalid resume ID', 400, origin, env, requestId);
    }
    const sanitizedResumeId = resumeIdValidation.sanitized;

    // Job title is optional - sanitize and validate
    const jobTitleValidation = sanitizeJobTitle(jobTitle, 200);
    if (!jobTitleValidation.valid) {
      console.error('[RESUME-FEEDBACK] Invalid jobTitle:', { requestId, jobTitle, error: jobTitleValidation.error });
      return errorResponse(jobTitleValidation.error || 'Invalid job title', 400, origin, env, requestId);
    }
    const normalizedJobTitle = jobTitleValidation.sanitized;
    const requestedRoleNormalized = normalizeRole(normalizedJobTitle || null);

    // Throttle check (Trial only)
    if (effectivePlan === 'trial' && env.JOBHACKAI_KV) {
      const throttleKey = `feedbackThrottle:${uid}`;
      const lastRun = await env.JOBHACKAI_KV.get(throttleKey);
      
      if (lastRun) {
        const lastRunTime = parseInt(lastRun, 10);
        const now = Date.now();
        const timeSinceLastRun = now - lastRunTime;
        
        if (timeSinceLastRun < 60000) { // 60 seconds
          const retryAfter = Math.ceil((60000 - timeSinceLastRun) / 1000);
          return errorResponse(
            'Rate limit exceeded. Please wait before requesting another feedback (1 request per minute).',
            429,
            origin,
            env,
            requestId,
            { retryAfter }
          );
        }
      }

      // Trial quota check: strictly in D1
      if (isD1Available(env)) {
        if (!d1User) {
          return errorResponse(
            'Cannot verify usage limits for trial users. Please try again or contact support.',
            500,
            origin,
            env,
            requestId
          );
        }
        const db = env.DB;
        let trialUsed = 0;
        if (db) {
          const res = await db.prepare(`SELECT COUNT(*) as count FROM usage_events WHERE user_id = ? AND feature = 'resume_feedback'`).bind(d1User.id).first();
          trialUsed = res?.count || 0;
        }
        if (trialUsed >= 3) {
          return errorResponse(
            'You have used all 3 feedback attempts in your trial. Upgrade to Pro for unlimited feedback.',
            403,
            origin,
            env,
            requestId,
            { upgradeRequired: true }
          );
        }
      }
    }

    // Usage limits (Essential: 3/month)
    // D1 is the authoritative usage source for Essential/monthly quota
    // Monthly allowance starts from plan activation date (plan_updated_at), not calendar month start
    if (effectivePlan === 'essential' && isD1Available(env)) {
      if (!d1User) {
        return errorResponse(
          'Cannot verify usage limits for Essential users. Please try again or contact support.',
          500,
          origin,
          env,
          requestId
        );
      }
      const db = env.DB;
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const monthStart = `${year}-${month}-01`;
      // Calculate the actual last day of the month (handles leap years and month lengths)
      function getLastDayOfMonth(year, month) {
        // JS months are 1-based for our input, but 0-based for Date
        return new Date(Date.UTC(year, month, 0)).getUTCDate();
      }
      const lastDay = getLastDayOfMonth(year, Number(month));
      const monthEnd = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      // Determine effective start: later of monthStart and plan_updated_at
      // This ensures users who upgrade mid-month get a fresh allowance starting at plan activation
      let effectiveStart = monthStart;
      try {
        const userRow = await db.prepare(
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
        console.warn('[RESUME-FEEDBACK] Failed to read plan_updated_at for usage enforcement, falling back to monthStart:', e);
      }

      let monthlyUsed = 0;
      if (db) {
        // Count resume_feedback events in D1 between effectiveStart and monthEnd
        const res = await db.prepare(
          `SELECT COUNT(*) as count FROM usage_events
           WHERE user_id = ? AND feature = 'resume_feedback'
             AND date(created_at) >= date(?) AND date(created_at) <= date(?)`
        ).bind(d1User.id, effectiveStart, monthEnd).first();
        monthlyUsed = res?.count || 0;
      }
      if (monthlyUsed >= 3) {
        return errorResponse(
          'You have used all 3 feedbacks this month. Upgrade to Pro for unlimited feedback.',
          403,
          origin,
          env,
          requestId,
          { upgradeRequired: true }
        );
      }
    }

    // Obtain authoritative resumeSession (fetch or create) before cache check
    if (isD1Available(env)) {
      if (!d1User) {
        return errorResponse('Cannot resolve user for persistence', 500, origin, env, requestId);
      }
      try {
        resumeSession = await upsertResumeSessionWithScores(env, d1User.id, {
          resumeId: sanitizedResumeId,
          role: normalizedJobTitle || null,
          atsScore: null,
          ruleBasedScores: null
        });
        if (!resumeSession) {
          return errorResponse('Failed to resolve or create resume session', 500, origin, env, requestId);
        }
        d1SessionId = String(resumeSession.id);
        d1CreatedAt = resumeSession.created_at || new Date().toISOString();
      } catch (e) {
        console.error('[RESUME-FEEDBACK] Resume session resolution/create failed:', e?.message || e);
        return errorResponse('Failed to resolve or create resume session', 500, origin, env, requestId);
      }
    } else {
      return errorResponse('Storage not available for rule-based scores', 500, origin, env, requestId);
    }

    // Cache check (all plans)
    let cachedResult = null;
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback:tier1`);
      const cacheKey = `feedbackCache:${cacheHash}`;
      const cached = await env.JOBHACKAI_KV.get(cacheKey);
      
      if (cached) {
        const cachedData = JSON.parse(cached);
        const cacheAge = Date.now() - cachedData.timestamp;
        
        // Cache valid for 24 hours
        if (cacheAge < 86400000) {
          cachedResult = cachedData.result;

          const cacheValid = isValidFeedbackResult(cachedResult, {
            requireRoleSpecific: !!requestedRoleNormalized
          });

          if (!cacheValid) {
            console.log(`[RESUME-FEEDBACK] Ignoring KV feedback cache (missing/invalid)`, {
              requestId,
              resumeId: sanitizedResumeId,
              jobTitle: normalizedJobTitle
            });
            cachedResult = null;
          }
        }
      }
    }

    // If cached, ensure persistence & usage for this request before returning cached result.
    if (cachedResult) {
      console.log(`[RESUME-FEEDBACK] KV feedback cache hit`, { requestId, resumeId: sanitizedResumeId, plan: effectivePlan });

      let canReturnCached = false;
      let cachedSessionId = cachedResult.sessionId || null;

      if (isD1Available(env)) {
        if (d1User) {
          try {
            // resumeSession assumed obtained earlier in flow
            if (resumeSession && resumeSession.id) {
              // If cached result lacks sessionId (legacy cache entry), create a new feedback_session
              if (!cachedSessionId) {
                try {
                  const placeholder = await createFeedbackSession(env, resumeSession.id, { status: 'completed' });
                  if (placeholder && placeholder.id) {
                    cachedSessionId = placeholder.id;
                    // Update cache with sessionId included for future hits
                    const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback:tier1`);
                    const cacheKey = `feedbackCache:${cacheHash}`;
                    const updatedCacheData = {
                      result: { ...cachedResult, sessionId: cachedSessionId },
                      timestamp: Date.now()
                    };
                    await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify(updatedCacheData), {
                      expirationTtl: 86400 // 24 hours
                    });
                    console.log('[RESUME-FEEDBACK] Added sessionId to legacy cache entry', {
                      requestId,
                      feedbackSessionId: cachedSessionId
                    });
                  }
                } catch (sessionError) {
                  console.warn('[RESUME-FEEDBACK] Failed to create feedback session for legacy cache entry (non-fatal):', sessionError.message);
                  // Continue without sessionId - role tips won't persist for this cache hit
                }
              }

              const usageEvent = await logUsageEvent(env, d1User.id, 'resume_feedback', null, {
                resumeSessionId: resumeSession.id,
                plan: effectivePlan,
                cached: true,
                jobTitle: normalizedJobTitle || null
              });
              if (usageEvent && usageEvent.id) {
                await updateUsageCounters(uid, sanitizedResumeId, effectivePlan, env);
                canReturnCached = true;
              }
            }
          } catch (e) {
            console.warn('[RESUME-FEEDBACK] Failed to persist usage for cached result, will treat as cache miss:', e.message);
            canReturnCached = false;
          }
        }
      }

      if (canReturnCached) {
        return successResponse({
          ...cachedResult,
          sessionId: cachedSessionId, // Include sessionId for role-tips persistence
          cached: true
        }, 200, origin, env, requestId);
      }

      console.log('[RESUME-FEEDBACK] Ignoring KV feedback cache due to missing persistence. Proceeding to generate fresh feedback.');
      cachedResult = null;
    }

    // Retrieve resume from KV or request body (dev fallback)
    let resumeData = null;
    
    if (env.JOBHACKAI_KV) {
      // Try to get resume from KV storage
      const resumeKey = `resume:${sanitizedResumeId}`;
      const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
      
      if (resumeDataStr) {
        resumeData = JSON.parse(resumeDataStr);
        
        // Verify resume belongs to user
        if (resumeData.uid !== uid) {
          return errorResponse('Unauthorized', 403, origin, env, requestId);
        }
      } else {
        // KV available but resume not found - allow dev fallback if resumeText provided
        if (isDevEnvironment && resumeText) {
          // Sanitize resume text from request body
          const resumeTextValidation = sanitizeResumeText(resumeText, 80000);
          if (!resumeTextValidation.valid) {
            return errorResponse(resumeTextValidation.error || 'Invalid resume text', 400, origin, env, requestId);
          }
          
          // Use resume text from request body (dev mode fallback when KV resume missing)
          resumeData = {
            uid,
            text: resumeTextValidation.sanitized,
            isMultiColumn: isMultiColumn || false,
            fileName: 'dev-resume',
            uploadedAt: Date.now()
          };
          console.log('[RESUME-FEEDBACK] KV resume not found, using dev fallback with resumeText from request body', { requestId });
        } else {
          // KV available but resume not found and no dev fallback
          return errorResponse('Resume not found', 404, origin, env, requestId);
        }
      }
    } else {
      // KV not available - allow dev fallback with resumeText in request body
      if (isDevEnvironment && resumeText) {
        // Sanitize resume text from request body
        const resumeTextValidation = sanitizeResumeText(resumeText, 80000);
        if (!resumeTextValidation.valid) {
          return errorResponse(resumeTextValidation.error || 'Invalid resume text', 400, origin, env, requestId);
        }
        
        // Use resume text from request body (dev mode fallback)
        resumeData = {
          uid,
          text: resumeTextValidation.sanitized,
          isMultiColumn: isMultiColumn || false,
          fileName: 'dev-resume',
          uploadedAt: Date.now()
        };
        console.log('[RESUME-FEEDBACK] KV not available, using dev fallback: resume text from request body', { requestId });
      } else {
        // KV not available and no dev fallback provided
        return errorResponse(
          'Storage not available. KV storage is required for resume retrieval. In dev environments, you can pass resumeText in the request body as a fallback.',
          500,
          origin,
          env,
          requestId
        );
      }
    }

    // Resume text is already validated by sanitizeResumeText (80,000 char limit)

    // --- Ensure canonical persistence exists BEFORE reading rule-based scores ---
    // At this point, require D1 user and resume session to exist (created/resolved earlier if needed).
    let ruleBasedScores = null;
    let atsReady = false;
    if (!d1User || !isD1Available(env)) {
      return errorResponse('Storage not available for rule-based scores', 500, origin, env, requestId);
    }

    // resumeSession already obtained above

    // ATS readiness is authoritative from the resume_session row
    if (resumeSession.ats_ready === 1) {
      atsReady = true;
    } else {
      return errorResponse(
        'Please wait for your ATS score to finish processing before requesting feedback.',
        409,
        origin,
        env,
        requestId
      );
    }

    // Prefer rule_based_scores_json if present and valid
    if (resumeSession.rule_based_scores_json) {
      try {
        const parsed = JSON.parse(resumeSession.rule_based_scores_json);
        const isValid = parsed &&
          typeof parsed.overallScore === 'number' &&
          parsed.keywordScore?.score !== undefined &&
          parsed.formattingScore?.score !== undefined &&
          parsed.structureScore?.score !== undefined &&
          parsed.toneScore?.score !== undefined &&
          parsed.grammarScore?.score !== undefined;
        if (isValid) {
          ruleBasedScores = parsed;
          console.log('[RESUME-FEEDBACK] Reusing ruleBasedScores from D1', {
            requestId,
            resumeId: sanitizedResumeId,
            overallScore: ruleBasedScores.overallScore
          });
        } else {
          console.warn('[RESUME-FEEDBACK] Invalid ruleBasedScores structure in D1');
        }
      } catch (e) {
        console.warn('[RESUME-FEEDBACK] Failed to parse ruleBasedScores from D1:', e?.message || e);
      }
    }

    // If JSON missing/invalid, fallback to ats_score if present
    if (!ruleBasedScores) {
      if (resumeSession.ats_score !== null && resumeSession.ats_score !== undefined) {
        const fallbackAtsScore = Number(resumeSession.ats_score) || 0;
        const scoreFor = (max) => Math.round((fallbackAtsScore / 100) * max);
        ruleBasedScores = {
          overallScore: fallbackAtsScore,
          keywordScore: { score: scoreFor(40), max: 40, feedback: '' },
          formattingScore: { score: scoreFor(20), max: 20, feedback: '' },
          structureScore: { score: scoreFor(15), max: 15, feedback: '' },
          toneScore: { score: scoreFor(15), max: 15, feedback: '' },
          grammarScore: { score: scoreFor(10), max: 10, feedback: '' }
        };
        console.log('[RESUME-FEEDBACK] Using fallback ruleBasedScores constructed from ats_score', {
          requestId,
          resumeId: sanitizedResumeId,
          atsScore: fallbackAtsScore
        });
      } else {
        return errorResponse(
          'Please wait for your ATS score to finish processing before requesting feedback.',
          409,
          origin,
          env,
          requestId
        );
      }
    }

  // Ensure extractionQuality is available for UI trust messaging (even when reusing older D1 scores)
  let extractionQuality = ruleBasedScores?.extractionQuality || null;
  if (!extractionQuality && resumeData?.text) {
    try {
      const diagnostics = await getGrammarDiagnostics(env, resumeData.text, {});
      extractionQuality = toExtractionQuality(diagnostics);
    } catch (e) {
      extractionQuality = null;
    }
  }

  // D1 feedback reuse handled via single persistence flow

    // PHASE 1: Generate AI feedback with truncation-aware retry (exactly 2 attempts)
    // Attempt 1: normal structured Tier 1 output
    // Attempt 2: shortMode structured Tier 1 output (if Attempt 1 truncated)
    // If both truncated: immediate rule-based fallback (no 3rd attempt)
    // NO escalating maxTokens, NO exponential backoff for truncation
    // B2: Use Tier 1 token cap (OPENAI_MAX_TOKENS_ATS_TIER1) for Tier 1 attempts
    const baseMaxTokens = Number(env.OPENAI_MAX_TOKENS_ATS_TIER1) > 0
      ? Number(env.OPENAI_MAX_TOKENS_ATS_TIER1)
      : 800;
    let aiFeedback = null;
    let tokenUsage = 0;
    const maxRetries = 2;  // PHASE 1: Exactly 2 attempts (normal + shortMode)
    let lastError = null;
    let partialAIFeedback = null; // Capture rubric if tips are missing
    let missingTipsOnly = false;
    
    // --- Persistence reservation (must succeed before any AI call) ---
    // Ensure D1 user, resume_session, a feedback_session stub, and a usage_event exist.
    if (isD1Available(env)) {
      if (!d1User) {
        return errorResponse('Cannot resolve user for persistence', 500, origin, env, requestId);
      }
      try {
        // Record canonical session metadata for response
        d1SessionId = String(resumeSession.id);
        d1CreatedAt = resumeSession.created_at || new Date().toISOString();

        // Update title/role if they're missing and we have a job title
        // This ensures history tiles show the correct job title instead of "Untitled role"
        if (resumeSession && normalizedJobTitle && (!resumeSession.title || !resumeSession.role)) {
          try {
            const updated = await env.DB.prepare(
              `UPDATE resume_sessions 
               SET title = COALESCE(title, ?),
                   role = COALESCE(role, ?)
               WHERE id = ?
               RETURNING id, title, role`
            ).bind(
              normalizedJobTitle,
              normalizedJobTitle,
              resumeSession.id
            ).first();

            if (updated) {
              resumeSession.title = updated.title || resumeSession.title;
              resumeSession.role = updated.role || resumeSession.role;
            }
          } catch (updateError) {
            console.warn('[RESUME-FEEDBACK] Failed to update session title/role (non-blocking):', updateError.message);
          }
        }

        // Create placeholder feedback session to reserve history row
        const placeholder = await createFeedbackSession(env, resumeSession.id, { status: 'in_progress' });
        if (!placeholder || !placeholder.id) {
          return errorResponse('Failed to create feedback session', 500, origin, env, requestId);
        }
        preFeedbackSessionId = placeholder.id;

        // Persist a usage event (tokens will be updated after AI completes)
        const usageEvent = await logUsageEvent(env, d1User.id, 'resume_feedback', null, {
          resumeSessionId: resumeSession.id,
          plan: effectivePlan,
          cached: false,
          jobTitle: normalizedJobTitle || null,
          atsScore: ruleBasedScores?.overallScore ?? null
        });
        if (!usageEvent || !usageEvent.id) {
          return errorResponse('Failed to log usage event', 500, origin, env, requestId);
        }
        preUsageEventId = usageEvent.id;

        // Update KV counters (fatal if this fails to ensure invariant)
        await updateUsageCounters(uid, sanitizedResumeId, effectivePlan, env);
      } catch (e) {
        console.error('[RESUME-FEEDBACK] Persistence reservation failed:', e?.message || e);
        return errorResponse('Failed to reserve persistence for feedback. Please try again.', 500, origin, env, requestId);
      }
    } 

    // PHASE 1: Tier 1 timeout (10-12 seconds)
    const TIER1_TIMEOUT_MS = 11000; // 11 seconds
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // PHASE 1: Attempt 0 = normal mode, Attempt 1 = shortMode
        // PHASE 1: NO escalating maxTokens - use same baseMaxTokens for both attempts
        // PHASE 2: skipRoleTips=true to exclude role tips from Tier 1
        const isShortMode = attempt === 1;
        const options = {
          skipRoleTips: true,  // PHASE 2: Tier 1 must not include role tips
          shortMode: isShortMode,  // PHASE 1: Use shortMode on retry
          timeoutMs: TIER1_TIMEOUT_MS  // PHASE 1: Add timeout
        };
        
        const aiResponse = await generateATSFeedback(
          resumeData.text,
          ruleBasedScores,
          normalizedJobTitle,
          env,
          options
        );
        
        // Capture token usage from OpenAI response
        if (aiResponse && aiResponse.usage) {
          tokenUsage = aiResponse.usage.totalTokens || 0;
        }
        
        // PHASE 1: Check for truncation BEFORE parsing - detect incomplete JSON
        const content = aiResponse?.content || '';
        const finishReason = aiResponse?.finishReason;
        const isTruncatedByFinishReason = finishReason === 'length';
        
        // Check for incomplete JSON (brace/bracket mismatch)
        const openBraces = (content.match(/{/g) || []).length;
        const closeBraces = (content.match(/}/g) || []).length;
        const openBrackets = (content.match(/\[/g) || []).length;
        const closeBrackets = (content.match(/]/g) || []).length;
        const likelyIncompleteJson = openBraces !== closeBraces || openBrackets !== closeBrackets;
        
        const isTruncated = isTruncatedByFinishReason || likelyIncompleteJson;
        
        if (isTruncated) {
          lastError = new Error('Response truncated at token limit');
          console.warn(`[RESUME-FEEDBACK] Response truncated (attempt ${attempt + 1}/${maxRetries})`, {
            requestId,
            finishReason: aiResponse.finishReason,
            completionTokens: aiResponse.usage?.completionTokens,
            totalTokens: aiResponse.usage?.totalTokens,
            shortMode: isShortMode,
            braceMismatch: openBraces - closeBraces,
            bracketMismatch: openBrackets - closeBrackets,
            likelyIncompleteJson
          });
          
          // PHASE 1: If truncated and not last attempt, retry with shortMode (no backoff, no token escalation)
          if (attempt < maxRetries - 1) {
            console.log(`[RESUME-FEEDBACK] Retrying with shortMode (no backoff, no token escalation)`, { requestId });
            continue; // Retry with shortMode - don't try to parse truncated JSON
          } else {
            // PHASE 1: Both attempts truncated - immediate fallback to rule-based
            console.warn(`[RESUME-FEEDBACK] Both attempts truncated, falling back to rule-based`, { requestId });
            aiFeedback = null;
            break; // Exit retry loop, will use rule-based fallback
          }
        }
        
        // Handle falsy content: treat as error
        if (!aiResponse || !aiResponse.content) {
          lastError = new Error('AI response missing content');
          console.error(`[RESUME-FEEDBACK] AI response missing content (attempt ${attempt + 1}/${maxRetries})`);
          // PHASE 1: For missing content, only retry if not last attempt (no backoff for truncation)
          if (attempt < maxRetries - 1) {
            continue; // Retry with shortMode
          }
          break; // Exit, will use rule-based fallback
        }
        
        // Parse AI response (structured output should be JSON)
        try {
          aiFeedback = typeof aiResponse.content === 'string' 
            ? JSON.parse(aiResponse.content)
            : aiResponse.content;
          
          // PHASE 2: skipRoleTips=true means roleSpecificFeedback should NOT be in response
          // Remove it if present (defensive cleanup)
          if (aiFeedback?.roleSpecificFeedback) {
            console.warn('[RESUME-FEEDBACK] Unexpected roleSpecificFeedback in Tier 1 response (skipRoleTips=true), removing', {
              requestId,
              resumeId: sanitizedResumeId
            });
            delete aiFeedback.roleSpecificFeedback;
          }
          
          // Legacy cleanup code (should not execute with skipRoleTips=true, but keep for safety)
          if (false && aiFeedback?.roleSpecificFeedback) {
            const rsf = aiFeedback.roleSpecificFeedback;
            
            // Handle new format (object with sections array)
            if (typeof rsf === 'object' && !Array.isArray(rsf)) {
              const sanitized = sanitizeRoleSpecificFeedback(rsf);
              if (sanitized) {
                aiFeedback.roleSpecificFeedback = sanitized;
              } else {
                // Log malformed data for monitoring (without sensitive content)
                const sectionTypes = Array.isArray(rsf.sections)
                  ? rsf.sections.reduce((acc, item) => {
                      const type = typeof item;
                      acc[type] = (acc[type] || 0) + 1;
                      return acc;
                    }, {})
                  : { invalid: 1 };
                console.warn('[RESUME-FEEDBACK] Sanitized roleSpecificFeedback returned null (malformed sections)', {
                  requestId,
                  resumeId: sanitizedResumeId,
                  sectionTypes,
                  sectionsLength: Array.isArray(rsf.sections) ? rsf.sections.length : 0
                });
                // Treat as missing - will trigger fallback if role exists
                delete aiFeedback.roleSpecificFeedback;
              }
            }
            // Handle old format (array) - validate all items are objects
            else if (Array.isArray(rsf)) {
              const allObjects = rsf.every(item => item && typeof item === 'object' && !Array.isArray(item));
              if (!allObjects) {
                // Log malformed old format
                const sectionTypes = rsf.reduce((acc, item) => {
                  const type = typeof item;
                  acc[type] = (acc[type] || 0) + 1;
                  return acc;
                }, {});
                console.warn('[RESUME-FEEDBACK] Old format roleSpecificFeedback contains non-objects', {
                  requestId,
                  resumeId: sanitizedResumeId,
                  sectionTypes,
                  sectionsLength: rsf.length
                });
                // Filter to objects only or delete if empty
                const filtered = rsf.filter(item => item && typeof item === 'object' && !Array.isArray(item));
                if (filtered.length > 0) {
                  aiFeedback.roleSpecificFeedback = filtered;
                } else {
                  delete aiFeedback.roleSpecificFeedback;
                }
              }
            }
            // Invalid type - delete it
            else {
              console.warn('[RESUME-FEEDBACK] roleSpecificFeedback has invalid type', {
                requestId,
                resumeId: sanitizedResumeId,
                type: typeof rsf
              });
              delete aiFeedback.roleSpecificFeedback;
            }
          }
          
          // PHASE 2: Validate structure - skipRoleTips=true means roleSpecificFeedback is NOT required
          // Tier 1 only needs atsRubric and atsIssues
          const validation = validateAIFeedback(aiFeedback, false, true); // hasNoRole=true since skipRoleTips
          
          if (validation.valid) {
            // All required fields present - success, exit retry loop
            break;
          } else {
            // Invalid structure - log what's missing for diagnostics
            lastError = new Error(`AI response missing required fields: ${validation.missing.join(', ')}`);
            console.error(`[RESUME-FEEDBACK] Invalid AI response structure (attempt ${attempt + 1}/${maxRetries})`, {
              requestId,
              missing: validation.missing,
              ...validation.details
            });
            // Reset aiFeedback to null to prevent using incomplete response
            aiFeedback = null;
            // PHASE 1: Only retry if not last attempt (no backoff for structure errors)
            if (attempt < maxRetries - 1) {
              continue; // Retry with shortMode
            }
            break; // Exit, will use rule-based fallback
          }
        } catch (parseError) {
          lastError = parseError;
          console.error(`[RESUME-FEEDBACK] Failed to parse AI response (attempt ${attempt + 1}/${maxRetries}):`, parseError);
          // PHASE 1: Parse errors may indicate truncation - retry with shortMode if not last attempt
          if (attempt < maxRetries - 1) {
            continue; // Retry with shortMode (no backoff)
          }
          break; // Exit, will use rule-based fallback
        }
      } catch (aiError) {
        lastError = aiError;
        const isTimeout = aiError.message?.includes('timeout');
        console.error(`[RESUME-FEEDBACK] AI feedback error (attempt ${attempt + 1}/${maxRetries}):`, {
          error: aiError.message,
          isTimeout,
          requestId
        });
        
        // PHASE 1: Timeout or other errors - only retry if not last attempt
        // For transient errors (429, 5xx), allow one retry but keep bounded
        const isTransient = !isTimeout && (
          aiError.message?.includes('429') || 
          aiError.message?.includes('500') ||
          aiError.message?.includes('503')
        );
        
        if (attempt < maxRetries - 1 && isTransient) {
          // Brief wait for transient errors only (not truncation/timeout)
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        // Timeout or last attempt - exit, will use rule-based fallback
        break;
      }
    }
    
    // If we only missed role-specific tips, keep the partial AI feedback for rubric but mark to add fallback tips
    // BUT: only if we actually expected role-specific feedback (i.e., we have a role)
    let shouldAddFallbackTips = false;
    const hasNoRole = !normalizedJobTitle || normalizedJobTitle.trim() === '';
    if (missingTipsOnly && partialAIFeedback && !hasNoRole) {
      // Only add fallback tips if we have a role but AI didn't generate role-specific feedback
      aiFeedback = partialAIFeedback;
      shouldAddFallbackTips = true;
    } else if (!aiFeedback && normalizedJobTitle && !hasNoRole) {
      // No AI feedback at all: we will add fallback tips later if a role was provided
      shouldAddFallbackTips = true;
    }

    // Log failed responses to KV for diagnostics (best effort)
    if (!aiFeedback && lastError && env.JOBHACKAI_KV) {
      try {
        const errorKey = `feedbackError:${uid}:${Date.now()}`;
        await env.JOBHACKAI_KV.put(errorKey, JSON.stringify({
          requestId,
          resumeId: sanitizedResumeId,
          jobTitle: normalizedJobTitle,
          error: lastError.message,
          timestamp: Date.now()
        }), {
          expirationTtl: 604800 // 7 days
        });
      } catch (kvError) {
        console.warn('[RESUME-FEEDBACK] Failed to log error to KV:', kvError);
      }
    }

    // Fallback role-specific tips generator (minimal, non-fabricated)
    function buildFallbackRoleTips(targetRole) {
      const safeRole = targetRole || 'general';
      return {
        targetRoleUsed: safeRole,
        sections: [
          {
            section: 'Professional Summary',
            fitLevel: 'tunable',
            diagnosis: `Add a short summary highlighting your ${safeRole} impact, stakeholders, and tools.`,
            tips: [
              'State your focus areas (process, data, stakeholders) in one sentence.',
              'Call out 2–3 core tools or methods you use in this role.',
              'Add one measurable outcome (e.g., reduced cycle time or improved accuracy).'
            ],
            rewritePreview: ''
          },
          {
            section: 'Experience',
            fitLevel: 'big_impact',
            diagnosis: 'Experience bullets need role-aligned impact and metrics.',
            tips: [
              'Lead with the action + outcome (e.g., “Improved reporting accuracy by 20%”).',
              'Include stakeholders or teams you partnered with.',
              'Name the tools or methods used (e.g., SQL, dashboards, requirements workshops).'
            ],
            rewritePreview: ''
          }
        ]
      };
    }

    // Build result with AI feedback if available, otherwise use rule-based scores
    // CRITICAL: Always use rule-based scores for score and max values to prevent AI drift
    // PHASE 1: Remove originalResume from response by default (performance + privacy)
    const result = aiFeedback && aiFeedback.atsRubric ? {
      ...(includeOriginalResume ? { originalResume: resumeData.text } : {}),  // PHASE 1: Only include if explicitly requested
      fileName: resumeData.fileName || null,
      resumeId: sanitizedResumeId,
      extractionQuality: extractionQuality,
      atsRubric: aiFeedback.atsRubric
        // Filter out any "overallScore" or "overall" categories - only process the 5 expected categories
        .filter(item => {
          const categoryLower = (item.category || '').toLowerCase();
          return !categoryLower.includes('overall') && categoryLower !== 'overallscore';
        })
        // Limit to exactly 5 items (the expected categories)
        .slice(0, 5)
        .map((item, idx) => {
          const canonicalCategories = [
            'Keyword Match',
            'ATS Formatting',
            'Structure & Organization',
            'Tone & Clarity',
            'Grammar & Spelling'
          ];
          const scoreKeyByLabel = {
            'keyword match': 'keywordScore',
            'ats formatting': 'formattingScore',
            'structure & organization': 'structureScore',
            'tone & clarity': 'toneScore',
            'grammar & spelling': 'grammarScore'
          };

          const rawCategory = (item.category || canonicalCategories[idx] || '').trim();
          const normalizedCategory = rawCategory.toLowerCase();
          const scoreKey =
            scoreKeyByLabel[normalizedCategory] ||
            ['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'][idx];

          const ruleBasedScore = ruleBasedScores[scoreKey];
          return {
            category: rawCategory || canonicalCategories[idx],
            // Force use of rule-based scores - AI should NOT generate or override scores
            score: ruleBasedScore?.score ?? 0,
            max: ruleBasedScore?.max ?? 10,
            // AI provides feedback and suggestions only
            // Use rule-based feedback if score is 0 or if AI feedback doesn't match score range
            // (e.g., "No major errors detected" shouldn't appear for score 0)
            feedback:
              ruleBasedScore?.score === 0 || !item.feedback
                ? ruleBasedScore?.feedback || ''
                : item.feedback,
            suggestions: item.suggestions || []
          };
        }),
      // PHASE 2: Tier 1 does NOT include role tips - they come from separate /api/role-tips endpoint
      roleSpecificFeedback: null,
      // Extract ATS issues from AI response or generate from rule-based scores
      atsIssues: aiFeedback.atsIssues && Array.isArray(aiFeedback.atsIssues) 
        ? aiFeedback.atsIssues
        : generateATSIssuesFromScores(ruleBasedScores, normalizedJobTitle),
      aiFeedback: aiFeedback
    } : (() => {
      // Fallback to rule-based scores if AI fails completely
      // Log this for monitoring AI reliability
      console.warn('[RESUME-FEEDBACK] AI feedback generation failed, using rule-based fallback', {
        requestId,
        resumeId: sanitizedResumeId,
        jobTitle: normalizedJobTitle,
        lastError: lastError?.message,
        attempts: maxRetries
      });
      
      const fallbackRoleTips = (shouldAddFallbackTips && normalizedJobTitle && normalizedJobTitle.trim() !== '') 
        ? buildFallbackRoleTips(normalizedJobTitle) 
        : null;

      return {
        ...(includeOriginalResume ? { originalResume: resumeData.text } : {}),  // PHASE 1: Only include if explicitly requested
        fileName: resumeData.fileName || null,
        resumeId: sanitizedResumeId,
        extractionQuality: extractionQuality,
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
      // PHASE 2: Tier 1 does NOT include role tips - they come from separate /api/role-tips endpoint
      roleSpecificFeedback: null,
      atsIssues: generateATSIssuesFromScores(ruleBasedScores, normalizedJobTitle),
      aiFeedback: null
      };
    })();

    // PHASE 2: Tier 1 result always has roleSpecificFeedback: null (role tips come from separate endpoint)
    // No sanitization needed since it's always null
    
    if (env.JOBHACKAI_KV) {
      // PHASE 2: Tier 1 result does not include roleSpecificFeedback, so don't require it for cache
      const cacheValid = isValidFeedbackResult(result, { requireRoleSpecific: false });
      
      if (cacheValid) {
        const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback:tier1`);
        const cacheKey = `feedbackCache:${cacheHash}`;
        // Include sessionId in cached result for role-tips persistence
        const resultWithSessionId = {
          ...result,
          sessionId: preFeedbackSessionId || null
        };
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
          result: resultWithSessionId,
          timestamp: Date.now()
        }), {
          expirationTtl: 86400 // 24 hours
        });
        console.log('[RESUME-FEEDBACK] Cached Tier 1 result', { 
          requestId,
          resumeId: sanitizedResumeId,
          jobTitle: normalizedJobTitle,
          sessionId: preFeedbackSessionId || null
        });
      } else {
        console.warn('[RESUME-FEEDBACK] Skipping cache - incomplete result', {
          requestId,
          resumeId: sanitizedResumeId
        });
      }
    }

    // Finalize placeholder feedback session and usage event before caching
    if (preFeedbackSessionId) {
      try {
        await env.DB.prepare(
          `UPDATE feedback_sessions SET feedback_json = ? WHERE id = ?`
        ).bind(JSON.stringify(result), preFeedbackSessionId).run();
      } catch (e) {
        return errorResponse('Failed to persist feedback result', 500, origin, env, requestId);
      }
    } else {
      // No placeholder to finalize - treat as failure
      return errorResponse('Missing feedback session placeholder', 500, origin, env, requestId);
    }

    if (preUsageEventId) {
      try {
        await env.DB.prepare(
          `UPDATE usage_events SET tokens_used = ? WHERE id = ?`
        ).bind(tokenUsage || null, preUsageEventId).run();
      } catch (e) {
        return errorResponse('Failed to persist usage data', 500, origin, env, requestId);
      }
    } else {
      return errorResponse('Missing usage event placeholder', 500, origin, env, requestId);
    }

    // Update throttles and usage counters (for cache misses)
    // NOTE: moved to after successful D1 persistence to ensure "no results = no usage recorded"

    // Persistence finalized earlier (placeholder updated and usage recorded). No legacy non-blocking persistence paths remain.

    console.log('[RESUME-FEEDBACK] Success', { requestId, uid, resumeId: sanitizedResumeId, tokenUsage });

    return successResponse({
      tokenUsage: tokenUsage,
      ...result,
      // Add session metadata for history (additive - doesn't break existing response)
      // Use preFeedbackSessionId (feedback_sessions.id) not d1SessionId (resume_sessions.id) for role-tips persistence
      sessionId: preFeedbackSessionId || d1SessionId,
      meta: {
        createdAt: d1CreatedAt || new Date().toISOString(),
        title: normalizedJobTitle || null,
        role: normalizedJobTitle || null
      }
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[RESUME-FEEDBACK] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error,
      500,
      origin,
      env,
      requestId,
      { endpoint: 'resume-feedback' }
    );
  }
}

/**
 * Generate structured ATS issues from rule-based scores
 * Used as fallback when AI doesn't provide issues or for rule-based only responses
 */
function generateATSIssuesFromScores(ruleBasedScores, jobTitle) {
  const issues = [];
  
  // Keyword relevance issues
  if (ruleBasedScores.keywordScore) {
    const keywordPercent = ruleBasedScores.keywordScore.score / ruleBasedScores.keywordScore.max;
    if (keywordPercent < 0.7) {
      issues.push({
        id: 'missing_keywords',
        severity: keywordPercent < 0.5 ? 'high' : 'medium',
        details: jobTitle ? [`Missing role-specific keywords for ${jobTitle}`] : ['Missing industry-relevant keywords']
      });
    }
  }
  
  // Formatting issues
  if (ruleBasedScores.formattingScore) {
    const formattingPercent = ruleBasedScores.formattingScore.score / ruleBasedScores.formattingScore.max;
    if (formattingPercent < 0.7) {
      issues.push({
        id: 'formatting_compliance',
        severity: formattingPercent < 0.5 ? 'high' : 'medium',
        details: ['Resume formatting may not be fully ATS-compliant. Avoid tables, graphics, and complex layouts.']
      });
    }
  }
  
  // Structure issues
  if (ruleBasedScores.structureScore) {
    const structurePercent = ruleBasedScores.structureScore.score / ruleBasedScores.structureScore.max;
    if (structurePercent < 0.7) {
      issues.push({
        id: 'structure_organization',
        severity: structurePercent < 0.5 ? 'high' : 'medium',
        details: ['Resume structure could be improved. Ensure clear section headers and consistent formatting.']
      });
    }
  }
  
  // Tone and clarity issues
  if (ruleBasedScores.toneScore) {
    const tonePercent = ruleBasedScores.toneScore.score / ruleBasedScores.toneScore.max;
    if (tonePercent < 0.7) {
      issues.push({
        id: 'tone_clarity',
        severity: 'low',
        details: ['Improve action-oriented language and make bullet points more concise.']
      });
    }
  }
  
  // Grammar and spelling issues
  if (ruleBasedScores.grammarScore) {
    const grammarPercent = ruleBasedScores.grammarScore.score / ruleBasedScores.grammarScore.max;
    if (grammarPercent < 0.8) {
      issues.push({
        id: 'grammar_spelling',
        severity: 'high',
        details: ['Resume contains grammar or spelling errors that must be corrected.']
      });
    }
  }
  
  return issues;
}

// Simple hash function for cache keys
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

