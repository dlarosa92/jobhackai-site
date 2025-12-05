/**
 * Latest Resume Feedback endpoint
 * GET /api/resume-feedback/latest
 *
 * Returns the most recent feedback session for the authenticated user from D1.
 * Uses plan-based gating for rewrite visibility.
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, isD1Available } from '../../_lib/db.js';

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
    console.warn('[RESUME-FEEDBACK-LATEST] Failed to fetch plan from KV:', error);
    return 'free';
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    let uid;
    try {
      const authResult = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
      uid = authResult.uid;
    } catch (authError) {
      console.error('[RESUME-FEEDBACK-LATEST] Authentication failed:', { requestId, error: authError.message });
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    if (!isD1Available(env)) {
      console.warn('[RESUME-FEEDBACK-LATEST] D1 not available');
      return successResponse({ latest: null }, 200, origin, env, requestId);
    }

    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      console.warn('[RESUME-FEEDBACK-LATEST] Failed to resolve user');
      return successResponse({ latest: null }, 200, origin, env, requestId);
    }

    const row = await env.DB.prepare(`
      SELECT 
        fs.id as feedback_id,
        fs.created_at as feedback_created_at,
        fs.feedback_json,
        rs.id as resume_session_id,
        rs.title,
        rs.role,
        rs.ats_score
      FROM resume_sessions rs
      JOIN feedback_sessions fs ON fs.resume_session_id = rs.id
      WHERE rs.user_id = ?
      ORDER BY fs.created_at DESC
      LIMIT 1
    `).bind(d1User.id).first();

    if (!row) {
      return successResponse({ latest: null }, 200, origin, env, requestId);
    }

    let feedbackData = null;
    try {
      feedbackData = row.feedback_json ? JSON.parse(row.feedback_json) : null;
    } catch (e) {
      console.warn('[RESUME-FEEDBACK-LATEST] Failed to parse feedback_json', { requestId, error: e.message });
    }

    let atsScore = row.ats_score;
    if ((atsScore === null || atsScore === undefined) && feedbackData?.atsRubric) {
      atsScore = Math.round(feedbackData.atsRubric.reduce((sum, item) => sum + (item.score || 0), 0));
    }

    const plan = await getUserPlan(uid, env);
    const isPaidRewrite = plan === 'pro' || plan === 'premium';
    const rewriteLocked = !isPaidRewrite;
    const rawRewritten = feedbackData?.rewrittenResume || null;
    const rawSummary = feedbackData?.rewriteChangeSummary || feedbackData?.changeSummary || null;

    const rewrittenResume = rewriteLocked ? null : rawRewritten;
    const rewriteChangeSummary = rewriteLocked ? null : rawSummary;

    const latest = {
      sessionId: String(row.resume_session_id),
      title: row.title,
      role: row.role,
      createdAt: row.feedback_created_at,
      atsScore: atsScore ?? null,
      atsRubric: feedbackData?.atsRubric || null,
      roleSpecificFeedback: feedbackData?.roleSpecificFeedback || null,
      atsIssues: feedbackData?.atsIssues || null,
      rewrittenResume,
      rewriteChangeSummary,
      rewriteLocked
    };

    console.log('[RESUME-FEEDBACK-LATEST] Retrieved latest feedback', { requestId, userId: d1User.id, sessionId: latest.sessionId });

    return successResponse({ latest }, 200, origin, env, requestId);
  } catch (error) {
    console.error('[RESUME-FEEDBACK-LATEST] Error:', { requestId, error: error.message, stack: error.stack });
    return successResponse({ latest: null }, 200, origin, env, requestId);
  }
}

