/**
 * Mock Interview Session Detail endpoint
 * GET /api/mock-interview/sessions/:id
 * 
 * Returns the full session data including Q&A pairs and feedback from D1.
 * This is D1-ONLY - NO OpenAI calls are made.
 * Used by the frontend to restore summary view when viewing history.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, getMockInterviewSessionById, isD1Available } from '../../../_lib/db.js';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    console.warn('[MI-SESSION-DETAIL] Failed to fetch plan from KV:', error);
    return 'free';
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
    // Extract session ID from path params
    const sessionId = params.id;
    if (!sessionId) {
      return errorResponse('Session ID is required', 400, origin, env, requestId);
    }

    // Validate session ID is a number
    const sessionIdNum = parseInt(sessionId, 10);
    if (isNaN(sessionIdNum) || sessionIdNum <= 0) {
      return errorResponse('Invalid session ID', 400, origin, env, requestId);
    }

    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    let uid;
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
    } catch (authError) {
      console.error('[MI-SESSION-DETAIL] Authentication failed:', { 
        requestId, 
        error: authError.message 
      });
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    // Check if D1 is available
    if (!isD1Available(env)) {
      console.warn('[MI-SESSION-DETAIL] D1 not available');
      return errorResponse('History not available', 503, origin, env, requestId);
    }

    // Get or create user to get the D1 user ID
    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      console.warn('[MI-SESSION-DETAIL] Failed to resolve user');
      return errorResponse('User not found', 404, origin, env, requestId);
    }

    // Fetch the full session (ownership enforced in SQL)
    const session = await getMockInterviewSessionById(env, sessionIdNum, d1User.id);

    if (!session) {
      console.warn('[MI-SESSION-DETAIL] Session not found or not authorized:', { 
        requestId, 
        sessionId: sessionIdNum, 
        userId: d1User.id 
      });
      return errorResponse('Session not found', 404, origin, env, requestId);
    }

    console.log('[MI-SESSION-DETAIL] Retrieved session:', { 
      requestId, 
      sessionId: session.id,
      userId: d1User.id,
      overallScore: session.overallScore
    });

    // Get user plan and enforce access
    const plan = await getUserPlan(uid, env);
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;
    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
    }

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

    const isPremium = effectivePlan === 'premium';

    // If not premium, strip premium_rewrite from per_question feedback
    const feedback = session.feedback || {};
    if (!isPremium && feedback.per_question) {
      feedback.per_question = feedback.per_question.map(pq => {
        const { premium_rewrite, ...rest } = pq;
        return rest;
      });
    }

    // Return full session data for UI restoration
    return successResponse({
      sessionId: session.id,
      role: session.role,
      seniority: session.seniority,
      interviewStyle: session.interviewStyle,
      questionSetId: session.questionSetId,
      questionSetName: session.questionSetName,
      overallScore: session.overallScore,
      rubric: {
        relevance: { score: session.rubricScores.relevance, of: 30, note: feedback.rubric?.relevance?.note || '' },
        structure: { score: session.rubricScores.structure, of: 25, note: feedback.rubric?.structure?.note || '' },
        clarity: { score: session.rubricScores.clarity, of: 20, note: feedback.rubric?.clarity?.note || '' },
        insight: { score: session.rubricScores.insight, of: 15, note: feedback.rubric?.insight?.note || '' },
        grammar: { score: session.rubricScores.grammar, of: 10, note: feedback.rubric?.grammar?.note || '' }
      },
      saoOverall: {
        situationPct: session.saoBreakdown.situationPct,
        actionPct: session.saoBreakdown.actionPct,
        outcomePct: session.saoBreakdown.outcomePct,
        coaching: feedback.sao_overall?.coaching || []
      },
      strengths: feedback.strengths || [],
      improvements: feedback.improvements || [],
      perQuestion: feedback.per_question || [],
      qaPairs: session.qaPairs,
      createdAt: session.createdAt,
      meta: {
        isHistoricalView: true,
        retrievedAt: new Date().toISOString(),
        isPremium
      }
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[MI-SESSION-DETAIL] Error:', { 
      requestId, 
      error: error.message, 
      stack: error.stack 
    });
    
    return errorResponse(
      'Failed to retrieve mock interview session',
      500,
      origin,
      env,
      requestId
    );
  }
}

