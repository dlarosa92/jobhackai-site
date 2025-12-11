// Interview Questions Get Set endpoint
// Retrieves a question set from D1 for Mock Interview
// Called by mock-interview.html when loading a set by ID

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { 
  getOrCreateUserByAuthId, 
  getInterviewQuestionSetById,
  getInterviewQuestionSetsByUser,
  isD1Available 
} from '../../_lib/db.js';

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
    console.error('[IQ-GET-SET] Error fetching plan from KV:', error);
    return 'free';
  }
}

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
    const plan = await getUserPlan(uid, env);
    
    // Dev environment detection
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;

    // Effective plan
    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
    }

    console.log('[IQ-GET-SET] Plan check:', { requestId, uid, plan, effectivePlan });

    // Get set requires pro or premium (Mock Interview access)
    const allowedPlans = ['pro', 'premium'];
    if (!allowedPlans.includes(effectivePlan)) {
      return errorResponse(
        'Accessing question sets for Mock Interviews requires Pro or Premium plan.',
        403,
        origin,
        env,
        requestId,
        { upgradeRequired: true }
      );
    }

    // Check D1 availability
    if (!isD1Available(env)) {
      return errorResponse(
        'Database not available',
        503,
        origin,
        env,
        requestId
      );
    }

    // Get params
    const url = new URL(request.url);
    const setId = url.searchParams.get('id');
    const listMode = url.searchParams.get('list');

    // Get or create user in D1 to verify ownership
    const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    if (!d1User) {
      return errorResponse('Failed to resolve user', 500, origin, env, requestId);
    }

    // List recent sets for dropdown
    if (listMode) {
      const sets = await getInterviewQuestionSetsByUser(env, d1User.id, { limit: 20 });
      return successResponse({ sets }, 200, origin, env, requestId);
    }

    if (!setId) {
      return errorResponse('Set ID is required', 400, origin, env, requestId);
    }

    // Parse ID as integer
    const setIdInt = parseInt(setId, 10);
    if (isNaN(setIdInt) || setIdInt <= 0) {
      return errorResponse('Invalid set ID', 400, origin, env, requestId);
    }

    // Retrieve the question set (SQL enforces ownership via WHERE id = ? AND user_id = ?)
    const questionSet = await getInterviewQuestionSetById(env, setIdInt, d1User.id);

    if (!questionSet) {
      // SQL query returns null if set doesn't exist or doesn't belong to user
      // No need for separate JS ownership check - SQL already enforced it
      return errorResponse('Question set not found', 404, origin, env, requestId);
    }

    console.log('[IQ-GET-SET] Success:', {
      requestId,
      uid,
      setId: setIdInt,
      role: questionSet.role,
      questionCount: questionSet.questions?.length || 0,
      selectedCount: questionSet.selectedIndices?.length || 0
    });

    return successResponse({
      id: questionSet.id,
      role: questionSet.role,
      seniority: questionSet.seniority,
      types: questionSet.types,
      questions: questionSet.questions,
      selectedIndices: questionSet.selectedIndices,
      jd: questionSet.jd,
      createdAt: questionSet.createdAt
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[IQ-GET-SET] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to retrieve question set',
      500,
      origin,
      env,
      requestId
    );
  }
}

