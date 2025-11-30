// Interview Questions Generate endpoint
// AI-powered cutting-edge interview question generation
// Uses OpenAI with structured JSON output for reliable parsing

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { callOpenAI } from '../../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, isD1Available, getFeatureDailyUsage, incrementFeatureDailyUsage } from '../../_lib/db.js';

// Fixed question count for all requests
const IQ_FIXED_COUNT = 10;

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

async function getUserPlan(uid, env) {
  if (!env.JOBHACKAI_KV) {
    console.warn('[IQ-GENERATE] KV not available for plan lookup');
    return 'free';
  }
  
  try {
    const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
    return plan || 'free';
  } catch (error) {
    console.error('[IQ-GENERATE] Error fetching plan from KV:', error);
    return 'free';
  }
}

/**
 * Generate cutting-edge interview questions using OpenAI
 */
async function generateQuestions({ role, seniority, types, count, jd }, env) {
  const typesStr = types && types.length > 0 ? types.join(', ') : 'behavioral, technical';
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
  "types": ${JSON.stringify(types || ['behavioral', 'technical'])},
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
        types: {
          type: 'array',
          items: { type: 'string' }
        },
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
      required: ['role', 'seniority', 'types', 'count', 'seed', 'questions']
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

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const userEmail = payload.email;

    // Get user plan
    const plan = await getUserPlan(uid, env);
    
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

    // Server-side cooldown enforcement (60 seconds)
    if (env.JOBHACKAI_KV) {
      const cooldownKey = `iq_cooldown:${uid}`;
      const lastRequest = await env.JOBHACKAI_KV.get(cooldownKey);
      const now = Date.now();
      const cooldownMs = 60 * 1000; // 60 seconds

      if (lastRequest) {
        const lastRequestTime = parseInt(lastRequest, 10);
        const timeSinceLastRequest = now - lastRequestTime;

        if (timeSinceLastRequest < cooldownMs) {
          const retryAfter = Math.ceil((cooldownMs - timeSinceLastRequest) / 1000);
          return errorResponse(
            'Please wait before generating another set. Cooldown active.',
            429,
            origin,
            env,
            requestId,
            { retryAfter, reason: 'cooldown' }
          );
        }
      }
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    const { role, seniority, types, jd, mode, replaceIndex } = body;

    // Validate role
    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return errorResponse('Role is required', 400, origin, env, requestId);
    }

    // Validate types
    const validTypes = ['behavioral', 'technical', 'system', 'leadership', 'culture'];
    const sanitizedTypes = Array.isArray(types)
      ? types.filter(t => validTypes.includes(t))
      : ['behavioral', 'technical'];

    // Determine count based on mode
    const requestedCount = mode === 'replace' ? 1 : IQ_FIXED_COUNT;

    // Check D1 availability and get/create user for daily quota tracking
    let d1User = null;
    if (isD1Available(env)) {
      d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    }

    // Daily quota check (D1-backed)
    const FEATURE = 'interview_questions';
    const PLAN_LIMITS = {
      trial: 40,
      essential: 80,
      pro: 150,
      premium: 250
    };

    if (d1User && PLAN_LIMITS[effectivePlan]) {
      const dailyLimit = PLAN_LIMITS[effectivePlan];
      const used = await getFeatureDailyUsage(env, d1User.id, FEATURE);
      
      if (used >= dailyLimit) {
        return errorResponse(
          'Daily Interview Questions limit reached for your plan.',
          429,
          origin,
          env,
          requestId,
          { reason: 'daily_limit', limit: dailyLimit, used }
        );
      }
    }

    // Generate questions
    const result = await generateQuestions({
      role: role.trim(),
      seniority: seniority || '',
      types: sanitizedTypes,
      count: requestedCount,
      jd: jd || ''
    }, env);

    console.log('[IQ-GENERATE] Success:', {
      requestId,
      uid,
      role: role.trim(),
      questionCount: result.questions?.length || 0,
      tokenUsage: result.tokenUsage
    });

    // Increment daily usage quota after successful generation
    if (d1User && PLAN_LIMITS[effectivePlan]) {
      await incrementFeatureDailyUsage(env, d1User.id, FEATURE, 1);
    }

    // Set cooldown after successful generation
    if (env.JOBHACKAI_KV) {
      const cooldownKey = `iq_cooldown:${uid}`;
      const now = Date.now();
      await env.JOBHACKAI_KV.put(cooldownKey, String(now), {
        expirationTtl: 60 // 60 seconds
      });
    }

    return successResponse({
      role: result.role,
      seniority: result.seniority,
      types: result.types,
      count: result.count,
      seed: result.seed,
      jd: result.jd || '',
      questions: result.questions,
      tokenUsage: result.tokenUsage
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[IQ-GENERATE] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to generate questions',
      500,
      origin,
      env,
      requestId
    );
  }
}

