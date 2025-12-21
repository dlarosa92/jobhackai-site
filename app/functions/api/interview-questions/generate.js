// Interview Questions Generate endpoint
// AI-powered cutting-edge interview question generation
// Uses OpenAI with structured JSON output for reliable parsing

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { callOpenAI } from '../../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, isD1Available, getFeatureDailyUsage, incrementFeatureDailyUsage } from '../../_lib/db.js';

// Fixed question count for all requests
const IQ_FIXED_COUNT = 10;
const FULL_COOLDOWN_MS = 45 * 1000;
const REPLACE_COOLDOWN_MS = 5 * 1000;

function corsHeaders(origin) {
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

import { getUserPlan } from '../../_lib/db.js';

/**
 * Generate cutting-edge interview questions using OpenAI
 */
async function generateQuestions({ role, seniority, type, count, jd }, env) {
  const normalizedType = String(type || 'mixed').toLowerCase();
  const expandedTypes =
    normalizedType === 'mixed'
      ? ['behavioral', 'technical', 'leadership']
      : [normalizedType];
  const typesStr =
    normalizedType === 'mixed'
      ? 'mixed (behavioral, technical, leadership)'
      : expandedTypes.join(', ');
  const jdContext = jd && jd.trim() ? jd.trim() : 'none provided';
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const systemPrompt = `You are an expert hiring manager and interviewer specialized in creating up-to-date, realistic interview questions for modern roles. You stay current on modern tools, frameworks, AI workflows, and industry practices, and you avoid outdated or irrelevant topics.`;

  const userPrompt = `Generate ${count} cutting-edge interview questions for:
- Role: ${role}
- Level: ${seniority || 'not specified'}
- Question types: ${typesStr}
- Job description (optional context): ${jdContext}

Focus on:
- Realistic, modern scenarios for this role and level as of today.
- Topics that reflect current industry practices (including cloud and AI where appropriate).
- Questions that an experienced interviewer would actually ask in 2025, not outdated textbook prompts.
- Mix of question types based on the types requested.

Return ONLY a JSON object with this exact shape:
{
  "role": "${role}",
  "seniority": "${seniority || ''}",
  "type": "${normalizedType}",
  "count": ${count},
  "seed": "${seed}",
  "jd": "${jd ? 'provided' : ''}",
  "questions": [
    {
      "id": "q1",
      "q": "question text",
      "hint": "optional ultra-brief hint (one sentence max) or empty string",
      "example": ""
    }
  ]
}

CRITICAL:
- Each question must have a unique id (q1, q2, q3, etc.)
- Hints should be ultra-brief (under 20 words) - think "Use STAR; quantify impact" not long explanations
- Leave "example" as empty string to save tokens
- No commentary, no markdown, no extra fields
- Make questions genuinely challenging and relevant for 2025 interviews`;

  const responseFormat = {
    name: 'interview_questions',
    schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        seniority: { type: 'string' },
        type: { type: 'string' },
        count: { type: 'number' },
        seed: { type: 'string' },
        jd: { type: 'string' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              q: { type: 'string' },
              hint: { type: 'string' },
              example: { type: 'string' }
            },
            required: ['id', 'q', 'hint', 'example']
          }
        }
      },
      required: ['role', 'seniority', 'type', 'count', 'seed', 'questions']
    }
  };

  const aiResponse = await callOpenAI({
    model: env.OPENAI_MODEL_IQ || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    responseFormat,
    maxTokens: 2000,
    temperature: 0.7,
    systemPrompt,
    feature: 'interview_questions_generate'
  }, env);

  if (!aiResponse || !aiResponse.content) {
    throw new Error('AI response missing content');
  }

  // Parse response
  const parsed = typeof aiResponse.content === 'string'
    ? JSON.parse(aiResponse.content)
    : aiResponse.content;

  // Ensure seed is set
  parsed.seed = parsed.seed || seed;
  // Ensure type is set (and sanitize to our contract)
  parsed.type = String(parsed.type || normalizedType || 'mixed').toLowerCase();
  // Backwards compatibility for older clients expecting `types[]`
  parsed.types = [parsed.type];

  return {
    ...parsed,
    tokenUsage: aiResponse.usage?.totalTokens || 0
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  // Declare lock variables outside try block so catch block can access them
  let lockAcquired = false;
  let lockKey = null;
  let uid = null;
  let quotaIncremented = false; // Track if quota was consumed to prevent clearing cooldown
  let isReplaceMode = false; // Track if this is a replace operation (must be declared outside try block)

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    const { uid: authUid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    uid = authUid;
    const userEmail = payload.email;

    // Get user plan
    const plan = await getUserPlan(env, uid);
    
    // Dev environment detection
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;

    // Effective plan (dev gets pro for testing)
    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
      console.log('[IQ-GENERATE] Dev environment - upgrading free to pro for testing');
    }

    console.log('[IQ-GENERATE] Plan check:', { requestId, uid, plan, effectivePlan, isDevEnvironment });

    // Interview Questions allowed for: trial, essential, pro, premium
    const allowedPlans = ['trial', 'essential', 'pro', 'premium'];
    if (!allowedPlans.includes(effectivePlan)) {
      return errorResponse(
        'Interview Questions is available in Trial, Essential, Pro, or Premium plans.',
        403,
        origin,
        env,
        requestId,
        { upgradeRequired: true }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    const { role, seniority, type, types, jd, mode, replaceIndex } = body;
    isReplaceMode = mode === 'replace';

    // Validate replace mode: require replaceIndex and verify user has generated sets
    // Replacements are free but must be tied to an existing question set to prevent abuse
    if (isReplaceMode) {
      // Basic validation: replaceIndex must be present and valid type
      if (replaceIndex === undefined || replaceIndex === null || (typeof replaceIndex !== 'number' && typeof replaceIndex !== 'string')) {
        return errorResponse(
          'Replace mode requires a valid replaceIndex pointing to an existing question.',
          400,
          origin,
          env,
          requestId
        );
      }
      
      // Validate replaceIndex is a valid number within bounds (0-9, since sets have 10 questions)
      const replaceIndexNum = typeof replaceIndex === 'string' ? parseInt(replaceIndex, 10) : replaceIndex;
      if (isNaN(replaceIndexNum) || replaceIndexNum < 0 || replaceIndexNum >= 10) {
        return errorResponse(
          'replaceIndex must be a number between 0 and 9 (valid question index).',
          400,
          origin,
          env,
          requestId
        );
      }
      
      // Security: Verify user has generated at least one set today
      // This ensures replacements are only allowed after generating a full set (using quota)
      // Prevents abuse where attackers bypass daily limits by only using replace mode
      if (isD1Available(env)) {
        const tempD1User = await getOrCreateUserByAuthId(env, uid, userEmail);
        if (tempD1User && tempD1User.id) {
          const todayUsage = await getFeatureDailyUsage(env, tempD1User.id, 'interview_questions');
          
          // Normalize if old format (same logic as quota check - use plan limit if available)
          // For replace validation, we just need to know if they have >= 1 set
          // If usage is >= 10 and multiple of 10, it's likely old format
          let normalizedUsage = todayUsage;
          if (todayUsage >= 10 && todayUsage % 10 === 0) {
            // Likely old format: convert to sets
            normalizedUsage = Math.floor(todayUsage / 10);
          }
          
          // User must have generated at least 1 set today to use replacements
          // This prevents abuse: attackers can't bypass quota by only using replace mode
          if (normalizedUsage < 1) {
            return errorResponse(
              'You must generate at least one question set before using replacements.',
              403,
              origin,
              env,
              requestId
            );
          }
        }
      }
    }

    // Validate role
    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return errorResponse('Role is required', 400, origin, env, requestId);
    }

    // Validate type (single string). Keep legacy `types[]` support.
    const validTypes = ['mixed', 'behavioral', 'technical', 'leadership'];
    const inferTypeFromLegacy = (rawTypes) => {
      if (!Array.isArray(rawTypes)) return null;
      const cleaned = rawTypes.map(t => String(t || '').toLowerCase()).filter(Boolean);
      if (!cleaned.length) return null;
      if (cleaned.includes('mixed')) return 'mixed';
      // Legacy multi-select becomes mixed
      if (cleaned.length > 1) return 'mixed';
      // Map removed legacy values
      if (cleaned[0] === 'system') return 'technical';
      if (cleaned[0] === 'culture') return 'behavioral';
      return cleaned[0];
    };
    const requestedType = String(type || inferTypeFromLegacy(types) || 'mixed').toLowerCase();
    const sanitizedType = validTypes.includes(requestedType) ? requestedType : 'mixed';

    // Determine count based on mode
    const requestedCount = mode === 'replace' ? 1 : IQ_FIXED_COUNT;

    // Server-side cooldown enforcement - checked before quota
    // Mode-specific cooldown keys allow replacements during the global cooldown window
    lockKey = `iq_lock:${uid}`;
    const cooldownKey = isReplaceMode ? `iq_replace_cooldown:${uid}` : `iq_cooldown:${uid}`;
    const cooldownMs = isReplaceMode ? REPLACE_COOLDOWN_MS : FULL_COOLDOWN_MS;
    lockAcquired = false;
    
    if (env.JOBHACKAI_KV) {
      const now = Date.now();
      
      // Check cooldown first
      const lastRequest = await env.JOBHACKAI_KV.get(cooldownKey);
      if (lastRequest) {
        const lastRequestTime = parseInt(lastRequest, 10);
        const timeSinceLastRequest = now - lastRequestTime;

        if (timeSinceLastRequest < cooldownMs) {
          const retryAfter = Math.ceil((cooldownMs - timeSinceLastRequest) / 1000);
          console.warn('[IQ-GENERATE] Cooldown hit:', {
            requestId,
            uid,
            plan: effectivePlan,
            reason: 'cooldown',
            retryAfter,
            mode: isReplaceMode ? 'replace' : 'full'
          });
          return errorResponse(
            isReplaceMode
              ? 'Please wait before replacing another question. Cooldown active.'
              : 'Please wait before generating another set. Cooldown active.',
            429,
            origin,
            env,
            requestId,
            { retryAfter, reason: 'cooldown', mode: isReplaceMode ? 'replace' : 'full' }
          );
        }
      }
      
      // Acquire distributed lock to prevent race conditions
      const existingLock = await env.JOBHACKAI_KV.get(lockKey);
      if (existingLock) {
        return errorResponse(
          'Another request is being processed. Please wait a moment.',
          429,
          origin,
          env,
          requestId,
          { retryAfter: 2, reason: 'concurrent_request' }
        );
      }
      
      // Set lock with 60 second TTL (Cloudflare KV minimum - enough time for quota check + generation start)
      await env.JOBHACKAI_KV.put(lockKey, String(now), { expirationTtl: 60 });
      lockAcquired = true;
    }

    // Check D1 availability and get/create user for daily quota tracking
    let d1User = null;
    if (isD1Available(env)) {
      d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    }

    // Daily quota check (D1-backed) - now protected by lock
    // Limits are in sets per day (not questions)
    const FEATURE = 'interview_questions';
    const PLAN_LIMITS = {
      trial: 10,        // 10 sets/day
      essential: 10,    // 10 sets/day
      pro: 20,         // 20 sets/day
      premium: 50      // 50 sets/day
    };

    if (d1User && PLAN_LIMITS[effectivePlan]) {
      const dailyLimit = PLAN_LIMITS[effectivePlan];
      let used = await getFeatureDailyUsage(env, d1User.id, FEATURE);
      
      // Normalize old format (questions) to new format (sets)
      // Old system stored multiples of 10 (10 questions per set)
      // New system stores individual sets (1 per set)
      // Normalize if value is > dailyLimit AND multiple of 10 (clearly old format)
      // Values <= dailyLimit that are multiples of 10 are ambiguous (could be old or new format)
      //   - Assume new format (don't normalize) to be safe for quota enforcement
      //   - Worst case: old format value at limit shows correctly as limit (e.g., 10 sets)
      // Example: Trial user (limit 10) with old format 50 (5 sets) → normalize to 5
      // Example: Trial user (limit 10) with old format 10 (1 set) → don't normalize (assume new format 10 sets)
      let needsNormalization = false;
      let normalizedValue = used;
      if (used > dailyLimit && used >= 10 && used % 10 === 0) {
        const oldValue = used;
        normalizedValue = Math.floor(used / 10);
        needsNormalization = true;
        console.log('[IQ-GENERATE] Detected old format usage, will normalize:', { requestId, uid, oldValue, newValue: normalizedValue, plan: effectivePlan, dailyLimit });
      }
      
      // If we detected old format, update database to normalized value before quota check
      // This prevents incrementing from old value (e.g., 40 + 1 = 41, which breaks conversion)
      if (needsNormalization && env.DB) {
        try {
          const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
          await env.DB.prepare(
            `UPDATE feature_daily_usage 
             SET count = ?, updated_at = datetime('now')
             WHERE user_id = ? AND feature = ? AND usage_date = ?`
          ).bind(normalizedValue, d1User.id, FEATURE, today).run();
          console.log('[IQ-GENERATE] Normalized old format in database:', { requestId, uid, oldValue: used, newValue: normalizedValue });
          used = normalizedValue; // Use normalized value for quota check
        } catch (normalizeError) {
          console.error('[IQ-GENERATE] Error normalizing old format in database:', { requestId, uid, error: normalizeError.message });
          // Continue with normalized value in memory - will be fixed on next request
          used = normalizedValue;
        }
      } else {
        used = normalizedValue; // Use current value (no normalization needed)
      }
      
      // Replacements are free but still subject to cooldown (enforced above)
      // No quota check needed for replacements - they're tied to existing sets
      if (!isReplaceMode) {
        // Only check quota for full sets (replacements don't count)
        // Full sets count as 1, replacements count as 0
        if (used + 1 > dailyLimit) {
          // Release lock before returning error
          if (lockAcquired && env.JOBHACKAI_KV) {
            await env.JOBHACKAI_KV.delete(lockKey).catch(() => {});
          }
          // Log daily limit hit for monitoring
          console.warn('[IQ-GENERATE] Daily limit hit:', {
            requestId,
            uid,
            userId: d1User.id,
            plan: effectivePlan,
            reason: 'daily_limit',
            limit: dailyLimit,
            used,
            requestedCount: 1
          });
          return errorResponse(
            `Daily limit reached: ${dailyLimit} sets per day for your plan.`,
            429,
            origin,
            env,
            requestId,
            { reason: 'daily_limit', limit: dailyLimit, used }
          );
        }
      }
    }

    // Set cooldown BEFORE generation to prevent race conditions
    // This ensures concurrent requests will see the cooldown immediately
    if (env.JOBHACKAI_KV) {
      const now = Date.now();
      await env.JOBHACKAI_KV.put(cooldownKey, String(now), {
        expirationTtl: Math.max(60, Math.ceil(cooldownMs / 1000))
      });
    }

    // Generate questions
    let result;
    try {
      result = await generateQuestions({
        role: role.trim(),
        seniority: seniority || '',
        type: sanitizedType,
        count: requestedCount,
        jd: jd || ''
      }, env);
    } catch (genError) {
      // If generation fails, clear the cooldown since no quota was consumed
      // This allows users to retry immediately after legitimate API failures
      if (env.JOBHACKAI_KV) {
        await env.JOBHACKAI_KV.delete(cooldownKey).catch(() => {});
      }
      // Release lock
      if (lockAcquired && env.JOBHACKAI_KV) {
        await env.JOBHACKAI_KV.delete(lockKey).catch(() => {});
      }
      throw genError;
    }

    console.log('[IQ-GENERATE] Success:', {
      requestId,
      uid,
      role: role.trim(),
      questionCount: result.questions?.length || 0,
      tokenUsage: result.tokenUsage
    });

    // Build response first to ensure it can be created successfully
    // Only increment quota after we confirm the response can be sent
    const response = successResponse({
      role: result.role,
      seniority: result.seniority,
      type: result.type,
      // Backwards compatibility
      types: result.types,
      count: result.count,
      seed: result.seed,
      jd: result.jd || '',
      questions: result.questions,
      tokenUsage: result.tokenUsage
    }, 200, origin, env, requestId);

    // Increment daily usage quota only after response is successfully created
    // This ensures quota is only consumed when user will actually receive questions
    // Full sets count as 1, replacements count as 0 (free refinement)
    if (d1User && PLAN_LIMITS[effectivePlan]) {
      const incrementAmount = isReplaceMode ? 0 : 1; // Replacements are free
      await incrementFeatureDailyUsage(env, d1User.id, FEATURE, incrementAmount);
      quotaIncremented = true; // Mark quota as consumed
    } else {
      console.warn('[IQ-GENERATE] Usage increment skipped:', {
        requestId,
        uid,
        hasD1User: !!d1User,
        effectivePlan,
        hasPlanLimit: !!PLAN_LIMITS[effectivePlan]
      });
    }

    // Release lock after successful completion
    if (lockAcquired && env.JOBHACKAI_KV) {
      await env.JOBHACKAI_KV.delete(lockKey).catch(() => {});
    }

    return response;

  } catch (error) {
    // Only clear cooldown if quota was NOT consumed
    // If quota was consumed, user should still be subject to cooldown to prevent abuse
    // Respect mode-specific cooldowns so a replace failure does not clear a full-set cooldown (and vice versa)
    if (uid && env.JOBHACKAI_KV && !quotaIncremented) {
      const cooldownKey = isReplaceMode ? `iq_replace_cooldown:${uid}` : `iq_cooldown:${uid}`;
      await env.JOBHACKAI_KV.delete(cooldownKey).catch(() => {});
    }
    // Release lock if it was acquired before the error
    if (lockAcquired && lockKey && env.JOBHACKAI_KV) {
      await env.JOBHACKAI_KV.delete(lockKey).catch(() => {});
    }
    
    console.error('[IQ-GENERATE] Error:', { 
      requestId, 
      error: error.message, 
      stack: error.stack,
      quotaIncremented // Log whether quota was consumed for debugging
    });
    return errorResponse(
      error.message || 'Failed to generate questions',
      500,
      origin,
      env,
      requestId
    );
  }
}

