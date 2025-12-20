// Mock Interview Sessions Endpoint
// GET: List session history for the user
// Only available for Pro/Premium plans

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { 
  getOrCreateUserByAuthId, 
  isD1Available,
  getMockInterviewHistory,
  getMockInterviewMonthlyUsage
} from '../../_lib/db.js';

// Session limits by plan
const SESSION_LIMITS = {
  pro: 20,
  premium: 999
};

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

import { getUserPlan } from '../../_lib/db.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET') {
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
    const plan = await getUserPlan(env, uid);
    
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

    // Parse query params
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);

    // Get or create D1 user
    let d1User = null;
    if (isD1Available(env)) {
      d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    }

    if (!d1User) {
      // No D1 user, return empty history
      return successResponse({
        sessions: [],
        usage: {
          sessionsUsed: 0,
          sessionLimit: SESSION_LIMITS[effectivePlan] || 20,
          plan: effectivePlan
        }
      }, 200, origin, env, requestId);
    }

    // Get session history
    const sessions = await getMockInterviewHistory(env, d1User.id, { limit });

    // Get monthly usage
    const sessionsUsed = await getMockInterviewMonthlyUsage(env, d1User.id);
    const sessionLimit = SESSION_LIMITS[effectivePlan] || 20;

    // Calculate next reset date
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const resetDate = nextMonth.toISOString().slice(0, 10);

    console.log('[MI-SESSIONS] Retrieved history:', {
      requestId,
      uid,
      sessionCount: sessions.length,
      sessionsUsed,
      sessionLimit
    });

    return successResponse({
      sessions,
      usage: {
        sessionsUsed,
        sessionLimit,
        plan: effectivePlan,
        resetDate
      }
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[MI-SESSIONS] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to retrieve sessions',
      500,
      origin,
      env,
      requestId
    );
  }
}

