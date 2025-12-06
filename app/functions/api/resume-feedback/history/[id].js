/**
 * Resume Feedback History Detail endpoint
 * GET /api/resume-feedback/history/:id
 * 
 * Returns the full feedback payload for a specific session from D1.
 * This is D1-ONLY - NO OpenAI calls are made.
 * Used by the frontend to restore full page state when viewing history.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, getFeedbackSessionById, isD1Available } from '../../../_lib/db.js';

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
    console.warn('[RESUME-FEEDBACK-HISTORY-DETAIL] Failed to fetch plan from KV:', error);
    return 'free';
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
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

    // Verify token with separate error handling for auth failures
    let uid;
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
    } catch (authError) {
      console.error('[RESUME-FEEDBACK-HISTORY-DETAIL] Authentication failed:', { 
        requestId, 
        error: authError.message 
      });
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    // Check if D1 is available
    if (!isD1Available(env)) {
      console.warn('[RESUME-FEEDBACK-HISTORY-DETAIL] D1 not available');
      return errorResponse('History not available', 503, origin, env, requestId);
    }

    // Get or create user to get the D1 user ID
    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      console.warn('[RESUME-FEEDBACK-HISTORY-DETAIL] Failed to resolve user');
      return errorResponse('User not found', 404, origin, env, requestId);
    }

    // Fetch the full feedback session (ownership enforced in SQL)
    const session = await getFeedbackSessionById(env, sessionIdNum, d1User.id);

    if (!session) {
      console.warn('[RESUME-FEEDBACK-HISTORY-DETAIL] Session not found or not authorized:', { 
        requestId, 
        sessionId: sessionIdNum, 
        userId: d1User.id 
      });
      return errorResponse('Session not found', 404, origin, env, requestId);
    }

    console.log('[RESUME-FEEDBACK-HISTORY-DETAIL] Retrieved session:', { 
      requestId, 
      sessionId: session.sessionId,
      userId: d1User.id,
      hasFeedback: !!session.feedback
    });

    // Plan-based rewrite visibility
    const plan = await getUserPlan(uid, env);
    const isPaidRewrite = plan === 'pro' || plan === 'premium';
    const rewriteLocked = !isPaidRewrite;

    const rawRewritten = session.feedback?.rewrittenResume || null;
    const rawSummary = session.feedback?.rewriteChangeSummary || session.feedback?.changeSummary || null;
    const originalResume =
      session.feedback?.originalResume ||
      session.feedback?.original ||
      session.feedback?.originalText ||
      null;

    const rewrittenResume = rewriteLocked ? null : rawRewritten;
    const rewriteChangeSummary = rewriteLocked ? null : rawSummary;

    // Return full session data for UI restoration
    // The frontend can use this to repopulate:
    // - ATS score gauge
    // - ATS rubric breakdown (all 5 categories)
    // - Role-specific tailoring tips
    // - Original/rewritten snippets (if Pro/Premium)
    // - Metadata (role, date, etc.)
    return successResponse({
      sessionId: session.sessionId,
      title: session.title,
      role: session.role,
      createdAt: session.createdAt,
      atsScore: session.atsScore,
      feedbackCreatedAt: session.feedbackCreatedAt,
      // Full feedback payload from D1 - NO OpenAI calls
      atsRubric: session.feedback?.atsRubric || null,
      roleSpecificFeedback: session.feedback?.roleSpecificFeedback || null,
      atsIssues: session.feedback?.atsIssues || null,
      // Include rewrite data if visible for current plan
      originalResume,
      rewrittenResume,
      rewriteChangeSummary,
      changeSummary: rewriteChangeSummary,
      rewriteLocked,
      // Metadata for display
      meta: {
        isHistoricalView: true,
        retrievedAt: new Date().toISOString()
      }
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[RESUME-FEEDBACK-HISTORY-DETAIL] Error:', { 
      requestId, 
      error: error.message, 
      stack: error.stack 
    });
    
    return errorResponse(
      'Failed to retrieve feedback session',
      500,
      origin,
      env,
      requestId
    );
  }
}

