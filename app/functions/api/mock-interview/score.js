// Mock Interview Scoring Endpoint
// Scores a set of Q&A pairs (up to 20) in a single OpenAI call
// Persists session to D1 for history
// Only available for Pro/Premium plans

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { callOpenAI } from '../../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { 
  getOrCreateUserByAuthId, 
  isD1Available,
  createMockInterviewSession,
  getMockInterviewMonthlyUsage,
  incrementMockInterviewMonthlyUsage
} from '../../_lib/db.js';

// Session limits by plan
const SESSION_LIMITS = {
  pro: 20,      // 20 sessions per month
  premium: 999  // Effectively unlimited but capped for abuse prevention
};

// Lightweight KV lock with token verification to reduce race window
async function acquireKvLock(env, key, ttlSeconds = 60) {
  if (!env.JOBHACKAI_KV) return { acquired: true, token: null };

  // Early-exit if a lock is already present
  const existing = await env.JOBHACKAI_KV.get(key);
  if (existing) return { acquired: false, token: null };

  const token = crypto.randomUUID();
  await env.JOBHACKAI_KV.put(key, token, { expirationTtl: ttlSeconds });

  // Verify we still own the lock (in case another request overwrote us)
  const stored = await env.JOBHACKAI_KV.get(key);
  if (stored !== token) return { acquired: false, token: null };

  return { acquired: true, token };
}

async function releaseKvLock(env, key, token) {
  if (!env.JOBHACKAI_KV || !token) return;
  const stored = await env.JOBHACKAI_KV.get(key);
  if (stored === token) {
    await env.JOBHACKAI_KV.delete(key).catch(() => {});
  }
}

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
    return 'free';
  }
  
  try {
    const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
    return plan || 'free';
  } catch (error) {
    console.error('[MI-SCORE] Error fetching plan from KV:', error);
    return 'free';
  }
}

/**
 * Truncate answer to approximately N words
 */
function truncateToWords(text, maxWords = 250) {
  if (!text || typeof text !== 'string') return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Score mock interview using OpenAI
 * Single call for all 10 Q&A pairs
 */
async function scoreMockInterview({ role, seniority, interviewStyle, questionSetName, qaPairs, isPremium }, env) {
  const systemPrompt = `You are an expert hiring manager and interview coach.
Score and coach a candidate's mock interview for the given role, seniority, and interview style.
Use the rubric weights: Relevance 30, Structure & Delivery 25, Confidence & Clarity 20, Depth & Insight 15, Grammar & Pace 10.
Use Situation + Action = Outcome (S + A = O) as coaching guidance, not a hard penalty: target ≈ Situation 5%, Action 10%, Outcome 85%.
Be concise, specific, role-aware, and actionable. Prefer brief bullet points.
Do not invent facts; base all feedback solely on the provided answers. Always output valid JSON.`;

  // Format Q&A pairs for the prompt using JSON.stringify to safely escape
  const qaText = qaPairs.map((qa) => {
    const qSafe = JSON.stringify(qa.q ?? '');
    const aSafe = JSON.stringify(truncateToWords(qa.a, 250) ?? '');
    return `{ "q": ${qSafe}, "a": ${aSafe} }`;
  }).join(',\n    ');

  const userPrompt = `Score this mock interview. Answers are truncated to ~250 words max.

Inputs:
- Role: ${role}
- Seniority: ${seniority}
- Interview style: ${interviewStyle}
- Question set: ${questionSetName || 'AI-generated'}

Rubric weights:
- Relevance: 30
- Structure & Delivery: 25
- Confidence & Clarity: 20
- Depth & Insight: 15
- Grammar & Pace: 10

S/A/O guidance (do NOT penalize mechanically):
- Situation ~5%
- Action ~10%
- Outcome ~85%

Data (array of question+answer pairs):
[
    ${qaText}
]

Output JSON exactly in this structure:
{
  "overall_score": number (0-100),
  "rubric": {
    "relevance": { "score": number (0-30), "note": "one sentence" },
    "structure": { "score": number (0-25), "note": "one sentence" },
    "clarity": { "score": number (0-20), "note": "one sentence" },
    "insight": { "score": number (0-15), "note": "one sentence" },
    "grammar": { "score": number (0-10), "note": "one sentence" }
  },
  "sao_overall": {
    "situation_pct": number (0-100),
    "action_pct": number (0-100),
    "outcome_pct": number (0-100),
    "coaching": ["bullet 1", "bullet 2", "bullet 3"]
  },
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "per_question": [
    {
      "q_index": number (0-9),
      "score": number (0-10),
      "notes": ["note 1", "note 2"],
      "sao": { "situation_pct": number, "action_pct": number, "outcome_pct": number }${isPremium ? ',\n      "premium_rewrite": "improved answer for Premium users (only for first 2 questions)"' : ''}
    }
  ]
}`;

  const responseFormat = {
    name: 'mock_interview_score',
    schema: {
      type: 'object',
      properties: {
        overall_score: { type: 'number' },
        rubric: {
          type: 'object',
          properties: {
            relevance: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } }, required: ['score', 'note'] },
            structure: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } }, required: ['score', 'note'] },
            clarity: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } }, required: ['score', 'note'] },
            insight: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } }, required: ['score', 'note'] },
            grammar: { type: 'object', properties: { score: { type: 'number' }, note: { type: 'string' } }, required: ['score', 'note'] }
          },
          required: ['relevance', 'structure', 'clarity', 'insight', 'grammar']
        },
        sao_overall: {
          type: 'object',
          properties: {
            situation_pct: { type: 'number' },
            action_pct: { type: 'number' },
            outcome_pct: { type: 'number' },
            coaching: { type: 'array', items: { type: 'string' } }
          },
          required: ['situation_pct', 'action_pct', 'outcome_pct', 'coaching']
        },
        strengths: { type: 'array', items: { type: 'string' } },
        improvements: { type: 'array', items: { type: 'string' } },
        per_question: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              q_index: { type: 'number' },
              score: { type: 'number' },
              notes: { type: 'array', items: { type: 'string' } },
              sao: {
                type: 'object',
                properties: {
                  situation_pct: { type: 'number' },
                  action_pct: { type: 'number' },
                  outcome_pct: { type: 'number' }
                }
              },
              premium_rewrite: { type: 'string' }
            },
            required: ['q_index', 'score', 'notes']
          }
        }
      },
      required: ['overall_score', 'rubric', 'sao_overall', 'strengths', 'improvements', 'per_question']
    }
  };

  const aiResponse = await callOpenAI({
    model: env.OPENAI_MODEL_MI || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    responseFormat,
    maxTokens: 3000,
    temperature: 0.3,
    systemPrompt,
    feature: 'mock_interview_score'
  }, env);

  if (!aiResponse || !aiResponse.content) {
    throw new Error('AI response missing content');
  }

  const parsed = typeof aiResponse.content === 'string'
    ? JSON.parse(aiResponse.content)
    : aiResponse.content;

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

  let uid = null;
  let lockKey = null;
  let lockToken = null;
  let lockAcquired = false;

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
    const plan = await getUserPlan(uid, env);
    
    // Dev environment detection
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;

    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
    }

    // Mock Interview only available for Pro/Premium
    const allowedPlans = ['pro', 'premium'];
    if (!allowedPlans.includes(effectivePlan)) {
      return errorResponse(
        'Mock Interviews are available on Pro and Premium plans.',
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

    const { role, seniority, interviewStyle, questionSetId, questionSetName, qaPairs } = body;

    // Validate inputs
    if (!role || !seniority || !interviewStyle) {
      return errorResponse('role, seniority, and interviewStyle are required', 400, origin, env, requestId);
    }

    if (!Array.isArray(qaPairs) || qaPairs.length < 1 || qaPairs.length > 20) {
      return errorResponse('qaPairs must be an array of 1 to 20 question/answer pairs', 400, origin, env, requestId);
    }

    // Validate each Q&A pair
    for (let i = 0; i < qaPairs.length; i++) {
      const qa = qaPairs[i];
      const invalidQuestion = !qa || typeof qa.q !== 'string' || qa.q.trim() === '';
      const invalidAnswer = !qa || typeof qa.a !== 'string'; // allow empty string answers
      if (invalidQuestion || invalidAnswer) {
        return errorResponse(`Invalid Q&A pair at index ${i}`, 400, origin, env, requestId);
      }
    }

    // Get or create D1 user
    let d1User = null;
    if (isD1Available(env)) {
      d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    }

    // Acquire lock to prevent concurrent scoring (reduce race with token verification)
    lockKey = `mi_score_lock:${uid}`;
    const { acquired, token: lockTokenValue } = await acquireKvLock(env, lockKey, 60);
    if (!acquired) {
      return errorResponse(
        'Another interview is being scored. Please wait.',
        429,
        origin,
        env,
        requestId,
        { retryAfter: 5 }
      );
    }
    lockAcquired = true;
    lockToken = lockTokenValue;

    // Re-check monthly usage limit inside lock to avoid races
    if (d1User) {
      const monthlyUsage = await getMockInterviewMonthlyUsage(env, d1User.id);
      const limit = SESSION_LIMITS[effectivePlan] || 20;

      if (monthlyUsage >= limit) {
        // Calculate next reset date (first of next month)
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const resetDate = nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        await releaseKvLock(env, lockKey, lockToken);
        lockAcquired = false;
        return errorResponse(
          `Monthly session limit reached. Next reset: ${resetDate}`,
          429,
          origin,
          env,
          requestId,
          { 
            reason: 'monthly_limit', 
            used: monthlyUsage, 
            limit,
            resetDate
          }
        );
      }
    }

    // Score the interview
    const isPremium = effectivePlan === 'premium';
    const scoreResult = await scoreMockInterview({
      role,
      seniority,
      interviewStyle,
      questionSetName,
      qaPairs,
      isPremium
    }, env);

    console.log('[MI-SCORE] Scoring complete:', {
      requestId,
      uid,
      role,
      overallScore: scoreResult.overall_score,
      tokenUsage: scoreResult.tokenUsage
    });

    // Persist session to D1
    let sessionId = null;
    if (d1User) {
      try {
        const session = await createMockInterviewSession(env, {
          userId: d1User.id,
          role,
          seniority,
          interviewStyle,
          questionSetId: questionSetId || null,
          questionSetName: questionSetName || null,
          overallScore: scoreResult.overall_score,
          rubricScores: {
            relevance: scoreResult.rubric.relevance.score,
            structure: scoreResult.rubric.structure.score,
            clarity: scoreResult.rubric.clarity.score,
            insight: scoreResult.rubric.insight.score,
            grammar: scoreResult.rubric.grammar.score
          },
          saoBreakdown: {
            situationPct: scoreResult.sao_overall.situation_pct,
            actionPct: scoreResult.sao_overall.action_pct,
            outcomePct: scoreResult.sao_overall.outcome_pct
          },
          qaPairs: qaPairs.map(qa => ({ q: qa.q, a: truncateToWords(qa.a, 250) })),
          feedback: scoreResult
        });

        if (session) {
          sessionId = session.id;
          console.log('[MI-SCORE] Session saved successfully:', { sessionId, userId: d1User.id });
          // Increment monthly usage
          await incrementMockInterviewMonthlyUsage(env, d1User.id);
        } else {
          console.warn('[MI-SCORE] Session creation returned null');
        }
      } catch (dbError) {
        console.error('[MI-SCORE] D1 persistence error:', dbError);
        // Continue - we still return the score even if D1 fails
      }
    }

    // Release lock
    if (lockAcquired) {
      await releaseKvLock(env, lockKey, lockToken);
    }

    // Format response
    const response = {
      sessionId,
      overallScore: scoreResult.overall_score,
      rubric: scoreResult.rubric,
      saoOverall: scoreResult.sao_overall,
      strengths: scoreResult.strengths,
      improvements: scoreResult.improvements,
      perQuestion: scoreResult.per_question,
      role,
      seniority,
      interviewStyle,
      questionSetName: questionSetName || 'AI-generated',
      savedToHistory: !!sessionId
    };

    return successResponse(response, 200, origin, env, requestId);

  } catch (error) {
    // Release lock on error
    if (lockAcquired && lockKey) {
      await releaseKvLock(env, lockKey, lockToken);
    }

    console.error('[MI-SCORE] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to score interview',
      500,
      origin,
      env,
      requestId
    );
  }
}

