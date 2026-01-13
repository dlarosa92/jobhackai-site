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
  createResumeSession, 
  createFeedbackSession, 
  logUsageEvent,
  isD1Available,
  getResumeSessionByResumeId
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

    // --- D1 User Resolution (best effort, non-blocking) ---
    // Resolve the authenticated user from D1 for session tracking
    // This is done early so we have user_id for all D1 operations
    let d1User = null;
    if (isD1Available(env)) {
      try {
        // Get or create user in D1 with email from Firebase token
        d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        console.log('[RESUME-FEEDBACK] D1 user resolved:', { userId: d1User?.id, authId: uid });
      } catch (d1Error) {
        console.warn('[RESUME-FEEDBACK] D1 user resolution failed (non-blocking):', d1Error.message);
        // Continue without D1 - history won't be saved but feedback will still work
      }
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

    const { resumeId, jobTitle, resumeText, isMultiColumn } = body;

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

    // Cache check (all plans)
    let cachedResult = null;
    if (env.JOBHACKAI_KV) {
      const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback`);
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

    // If cached, still update usage counters (user is consuming the feature)
    // Then return cached result
    if (cachedResult) {
      console.log(`[RESUME-FEEDBACK] Using KV feedback cache hit`, { requestId, resumeId: sanitizedResumeId, plan: effectivePlan });
      
      // Update throttles and usage even for cache hits (prevents bypassing limits)
      await updateUsageCounters(uid, sanitizedResumeId, effectivePlan, env);
      
      // Skip D1 persistence for cache hits to prevent duplicate history entries
      // History should only show unique analyses, not every cache hit
      // The original analysis session was already persisted when the cache was created
      
      return successResponse({
        ...cachedResult,
        cached: true
      }, 200, origin, env, requestId);
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

    // --- Load ruleBasedScores from D1 (authoritative) ---
    let ruleBasedScores = null;
    resumeSession = null;
    if (d1User && isD1Available(env)) {
      const maxRetries = 4;
      const retryDelay = 200;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const existingSession = await getResumeSessionByResumeId(env, d1User.id, sanitizedResumeId);
          resumeSession = existingSession;
          
          if (existingSession?.rule_based_scores_json) {
            try {
              const parsed = JSON.parse(existingSession.rule_based_scores_json);
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
                  overallScore: ruleBasedScores.overallScore,
                  attempt: attempt + 1
                });
                break;
              } else {
                console.warn('[RESUME-FEEDBACK] Invalid ruleBasedScores structure in D1, retrying', {
                  requestId,
                  attempt: attempt + 1
                });
              }
            } catch (parseError) {
              console.warn('[RESUME-FEEDBACK] Failed to parse ruleBasedScores from D1, retrying', {
                requestId,
                error: parseError.message,
                attempt: attempt + 1
              });
            }
          }
        } catch (d1Error) {
          console.warn('[RESUME-FEEDBACK] D1 lookup failed (non-fatal), will retry:', {
            requestId,
            error: d1Error.message,
            attempt: attempt + 1
          });
        }

        if (!ruleBasedScores && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    if (!ruleBasedScores) {
      console.warn('[RESUME-FEEDBACK] ATS score not yet available in D1 for resumeId', { requestId, resumeId: sanitizedResumeId });
      return errorResponse(
        'Please wait for your ATS score to finish processing before requesting feedback.',
        409,
        origin,
        env,
        requestId
      );
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

  // --- D1 feedback reuse (source of truth) ---
  if (d1User && isD1Available(env)) {
    try {
      if (!resumeSession) {
        resumeSession = await getResumeSessionByResumeId(env, d1User.id, sanitizedResumeId);
      }

      if (resumeSession && env.DB) {
        const latestFeedback = await env.DB.prepare(`
          SELECT feedback_json, created_at 
          FROM feedback_sessions 
          WHERE resume_session_id = ? 
          ORDER BY created_at DESC 
          LIMIT 1
        `).bind(resumeSession.id).first();

        if (latestFeedback?.feedback_json) {
          let feedback = null;
          try {
            feedback = JSON.parse(latestFeedback.feedback_json);
          } catch (parseError) {
            console.warn('[RESUME-FEEDBACK] Ignoring D1 feedback session due to JSON parse error', {
              requestId,
              error: parseError.message
            });
          }

          if (feedback) {
            const storedRole = normalizeRole(
              feedback?.roleSpecificFeedback?.targetRoleUsed || resumeSession.role || null
            );
            const roleMatches = requestedRoleNormalized === storedRole;

            const feedbackValid = isValidFeedbackResult(feedback, {
              requireRoleSpecific: !!requestedRoleNormalized
            });

            const canReuse = feedbackValid && (
              requestedRoleNormalized ? roleMatches : (storedRole == null || storedRole === 'general')
            );

            if (canReuse) {
              // Optionally re-seed KV for future quick hits (only if valid)
              if (env.JOBHACKAI_KV) {
                const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback`);
                await env.JOBHACKAI_KV.put(
                  `feedbackCache:${cacheHash}`,
                  JSON.stringify({ result: feedback, timestamp: Date.now() }),
                  { expirationTtl: 86400 }
                );
              }

              // Count usage for D1-served responses
              await updateUsageCounters(uid, sanitizedResumeId, effectivePlan, env);

              console.log('[RESUME-FEEDBACK] Using D1 feedback session', {
                requestId,
                resumeSessionId: resumeSession.id
              });

              return successResponse({
                ...feedback,
                extractionQuality: feedback?.extractionQuality || extractionQuality || null
              }, 200, origin, env, requestId);
            } else {
              console.log('[RESUME-FEEDBACK] Ignoring D1 feedback session (role mismatch or invalid structure)', {
                requestId,
                roleMatches,
                hasRoleSpecificFeedback: !!feedback?.roleSpecificFeedback,
                storedRole,
                requestedRoleNormalized
              });
            }
          }
        }
      }
    } catch (d1FeedbackError) {
      console.warn('[RESUME-FEEDBACK] D1 feedback lookup failed (non-fatal)', {
        requestId,
        error: d1FeedbackError.message
      });
    }
  }

    // Generate AI feedback with exponential backoff retry
    // Token budget logic:
    // - First attempt (attempt === 0): let generateATSFeedback() use its internal logic
    //   which applies token optimization (1500 tokens when no role, 3500 when role exists)
    // - Retry attempts (attempt > 0): override with increased tokens to handle truncation
    const baseMaxTokens = Number(env.OPENAI_MAX_TOKENS_ATS) > 0
      ? Number(env.OPENAI_MAX_TOKENS_ATS)
      : 3500;
    let aiFeedback = null;
    let tokenUsage = 0;
    const maxRetries = 3;
    let lastError = null;
    let partialAIFeedback = null; // Capture rubric if tips are missing
    let missingTipsOnly = false;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Only pass maxOutputTokensOverride on retry attempts to increase budget after truncation
        // First attempt uses generateATSFeedback's internal logic which optimizes for hasRole
        const options = attempt > 0 
          ? { maxOutputTokensOverride: baseMaxTokens + (attempt * 600) }
          : {};
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
        
        // Check for truncation BEFORE parsing - truncated JSON will always fail to parse
        if (aiResponse && aiResponse.finishReason === 'length') {
          lastError = new Error('Response truncated at token limit');
          console.warn(`[RESUME-FEEDBACK] Response truncated at token limit (attempt ${attempt + 1}/${maxRetries})`, {
            requestId,
            finishReason: aiResponse.finishReason,
            completionTokens: aiResponse.usage?.completionTokens,
            totalTokens: aiResponse.usage?.totalTokens
          });
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          continue; // Retry - don't try to parse truncated JSON
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
          
          // CRITICAL: Sanitize roleSpecificFeedback immediately after parsing to prevent malformed data
          // This ensures we never persist or return mixed-type sections arrays
          if (aiFeedback?.roleSpecificFeedback) {
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
          
          // Validate structure - check ALL required fields before exiting retry loop
          // When no role is provided, allow missing roleSpecificFeedback (it won't be generated by OpenAI)
          // This saves ~2000 tokens (~57% reduction) when no role is selected
          const hasNoRole = !normalizedJobTitle || normalizedJobTitle.trim() === '';
          const validation = validateAIFeedback(aiFeedback, false, hasNoRole);
          
          if (validation.valid) {
            // All required fields present - success, exit retry loop
            break;
          } else {
            // If only roleSpecificFeedback is missing, keep rubric and bail out to fallback tips
            // BUT: if we have no role, we don't expect role-specific feedback, so this shouldn't happen
            const missingOnlyRoleTips = validation.missing.length === 1 && validation.missing[0] === 'roleSpecificFeedback';
            if (missingOnlyRoleTips && !hasNoRole) {
              // Only apply fallback logic if we actually expected role-specific feedback
              partialAIFeedback = aiFeedback;
              missingTipsOnly = true;
              break;
            }

            // Invalid structure - log what's missing for diagnostics
            lastError = new Error(`AI response missing required fields: ${validation.missing.join(', ')}`);
            console.error(`[RESUME-FEEDBACK] Invalid AI response structure (attempt ${attempt + 1}/${maxRetries})`, {
              requestId,
              missing: validation.missing,
              hasNoRole,
              ...validation.details
            });
            // Reset aiFeedback to null to prevent using incomplete response
            aiFeedback = null;
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
    // Store original resume text in D1 for history restoration
    const result = aiFeedback && aiFeedback.atsRubric ? {
      originalResume: resumeData.text,
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
      // Role-specific feedback structure validation
      // CRITICAL: Never return malformed roleSpecificFeedback - use strict validation
      // Sanitization already happened after parsing, but double-check here for safety
      roleSpecificFeedback: (() => {
        // If no job title provided, return null (no role-specific tips)
        if (!normalizedJobTitle || normalizedJobTitle.trim() === '') {
          return null;
        }
        
        const rsf = aiFeedback.roleSpecificFeedback;
        
        // New format: must pass strict validation
        if (rsf && typeof rsf === 'object' && !Array.isArray(rsf)) {
          if (isRoleSpecificFeedbackStrict(rsf)) {
            return rsf; // Already sanitized, safe to return
          }
          // Attempt final sanitization as last resort
          const sanitized = sanitizeRoleSpecificFeedback(rsf);
          if (sanitized) {
            return sanitized;
          }
          // Malformed - treat as missing
        }
        
        // Old format: must be array of objects only (no mixed types)
        if (Array.isArray(rsf) && rsf.length > 0) {
          const allObjects = rsf.every(item => item && typeof item === 'object' && !Array.isArray(item));
          if (allObjects) {
            return rsf; // Valid old format
          }
          // Mixed types in old format - filter to objects only
          const filtered = rsf.filter(item => item && typeof item === 'object' && !Array.isArray(item));
          if (filtered.length > 0) {
            return filtered;
          }
          // No valid objects - treat as missing
        }
        
        // Missing or invalid - use fallback if role exists
        if (shouldAddFallbackTips) {
          console.warn('[RESUME-FEEDBACK] Adding fallback role tips (missing/invalid roleSpecificFeedback)', {
            requestId,
            resumeId: sanitizedResumeId,
            role: normalizedJobTitle
          });
          return buildFallbackRoleTips(normalizedJobTitle);
        }
        
        console.warn('[RESUME-FEEDBACK] AI succeeded but roleSpecificFeedback missing or invalid', {
          requestId,
          resumeId: sanitizedResumeId,
          hasRoleSpecificFeedback: !!rsf,
          roleSpecificFeedbackType: typeof rsf
        });
        return null;
      })(),
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
        originalResume: resumeData.text,
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
      // Provide fallback role-specific feedback when AI fails completely (non-fabricated)
      roleSpecificFeedback: fallbackRoleTips,
      atsIssues: generateATSIssuesFromScores(ruleBasedScores, normalizedJobTitle),
      aiFeedback: null
      };
    })();

    // Cache result (24 hours) - only cache complete results to prevent serving incomplete data
    // CRITICAL: Final sanitization pass before storage to ensure no malformed data is cached
    if (result.roleSpecificFeedback) {
      if (typeof result.roleSpecificFeedback === 'object' && !Array.isArray(result.roleSpecificFeedback)) {
        const sanitized = sanitizeRoleSpecificFeedback(result.roleSpecificFeedback);
        result.roleSpecificFeedback = sanitized || null;
      } else if (Array.isArray(result.roleSpecificFeedback)) {
        // Old format: filter to objects only
        const filtered = result.roleSpecificFeedback.filter(
          item => item && typeof item === 'object' && !Array.isArray(item)
        );
        result.roleSpecificFeedback = filtered.length > 0 ? filtered : null;
      } else {
        result.roleSpecificFeedback = null;
      }
    }
    
    if (env.JOBHACKAI_KV) {
      // Validate result is complete before caching
      const cacheValid = isValidFeedbackResult(result, { requireRoleSpecific: !!requestedRoleNormalized });
      
      if (cacheValid) {
        const cacheHash = await hashString(`${sanitizedResumeId}:${normalizedJobTitle}:feedback`);
        const cacheKey = `feedbackCache:${cacheHash}`;
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
          result,
          timestamp: Date.now()
        }), {
          expirationTtl: 86400 // 24 hours
        });
        console.log('[RESUME-FEEDBACK] Cached complete result', { 
          requestId,
          resumeId: sanitizedResumeId,
          jobTitle: normalizedJobTitle
        });
      } else {
        console.warn('[RESUME-FEEDBACK] Skipping cache - incomplete result', {
          requestId,
          resumeId: sanitizedResumeId,
          requireRoleSpecific: !!requestedRoleNormalized
        });
      }
    }

    // Update throttles and usage counters (for cache misses)
    await updateUsageCounters(uid, sanitizedResumeId, effectivePlan, env);

    // --- D1 Persistence (best effort, non-blocking) ---
    // Persist resume session, feedback, and usage to D1 for history
    let d1SessionId = null;
    let d1CreatedAt = null;
    if (d1User && isD1Available(env)) {
      try {
        // Check if session already exists (created by /api/ats-score)
        if (!resumeSession) {
          resumeSession = await getResumeSessionByResumeId(env, d1User.id, sanitizedResumeId);
        }
        
        if (!resumeSession) {
          // Create new session (fallback if /api/ats-score didn't create one)
          resumeSession = await createResumeSession(env, d1User.id, {
            title: normalizedJobTitle || null,
            role: normalizedJobTitle || null,
            rawTextLocation: `resume:${sanitizedResumeId}`
          });
        }
        
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
        
        if (resumeSession) {
          d1SessionId = String(resumeSession.id);
          d1CreatedAt = resumeSession.created_at;
          
          // Use overallScore from ruleBasedScores (already calculated with Math.round via calcOverallScore)
          // This ensures consistency with the score returned by the scoring engine
          const overallAtsScore = ruleBasedScores.overallScore ?? null;
          // ATS score is canonical and written only by /api/ats-score.
          
          // Create feedback session with the full result
          // CRITICAL: Final defensive sanitization before D1 storage (result already sanitized, but double-check)
          if (result.roleSpecificFeedback) {
            if (typeof result.roleSpecificFeedback === 'object' && !Array.isArray(result.roleSpecificFeedback)) {
              const sanitized = sanitizeRoleSpecificFeedback(result.roleSpecificFeedback);
              result.roleSpecificFeedback = sanitized || null;
            } else if (Array.isArray(result.roleSpecificFeedback)) {
              const filtered = result.roleSpecificFeedback.filter(
                item => item && typeof item === 'object' && !Array.isArray(item)
              );
              result.roleSpecificFeedback = filtered.length > 0 ? filtered : null;
            } else {
              result.roleSpecificFeedback = null;
            }
          }
          await createFeedbackSession(env, resumeSession.id, result);
          
          // Log usage event
          await logUsageEvent(env, d1User.id, 'resume_feedback', tokenUsage || null, {
            resumeSessionId: resumeSession.id,
            plan: effectivePlan,
            cached: false,
            jobTitle: normalizedJobTitle || null,
            atsScore: overallAtsScore
          });
          
          console.log('[RESUME-FEEDBACK] D1 persistence complete:', { 
            sessionId: d1SessionId, 
            userId: d1User.id,
            atsScore: overallAtsScore
          });
        }
      } catch (d1Error) {
        console.error('[RESUME-FEEDBACK] D1 persistence failed (non-blocking):', d1Error.message);
        // Continue - feedback still works, just won't be in history
      }
    }

    console.log('[RESUME-FEEDBACK] Success', { requestId, uid, resumeId: sanitizedResumeId, tokenUsage });

    return successResponse({
      tokenUsage: tokenUsage,
      ...result,
      // Add session metadata for history (additive - doesn't break existing response)
      sessionId: d1SessionId,
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

