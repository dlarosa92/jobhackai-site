// Interview Questions Save Set endpoint
// Persists question sets to D1 for Mock Interview integration
// Called when user clicks "Start Mock Interview" with selected questions

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { 
  getOrCreateUserByAuthId, 
  createInterviewQuestionSet,
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const plan = await getUserPlan(env, uid);
    
    // Dev environment detection
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;

    // Effective plan
    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
    }

    console.log('[IQ-SAVE-SET] Plan check:', { requestId, uid, plan, effectivePlan });

    // Save set requires pro or premium (Mock Interview access)
    const allowedPlans = ['pro', 'premium'];
    if (!allowedPlans.includes(effectivePlan)) {
      return errorResponse(
        'Saving question sets for Mock Interviews requires Pro or Premium plan.',
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

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    const { role, seniority, types, questions, selectedIndices, jd } = body;

    // Validate required fields
    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return errorResponse('Role is required', 400, origin, env, requestId);
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return errorResponse('Questions array is required', 400, origin, env, requestId);
    }

    if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return errorResponse('At least one question must be selected', 400, origin, env, requestId);
    }

    // Validate selectedIndices are valid indices
    const maxIndex = questions.length - 1;
    const validIndices = selectedIndices.filter(idx => 
      typeof idx === 'number' && 
      Number.isInteger(idx) && 
      idx >= 0 && 
      idx <= maxIndex
    );

    if (validIndices.length === 0) {
      return errorResponse('No valid question indices provided', 400, origin, env, requestId);
    }

    // Get or create user in D1
    const d1User = await getOrCreateUserByAuthId(env, uid, userEmail);
    if (!d1User) {
      return errorResponse('Failed to resolve user', 500, origin, env, requestId);
    }

    // Create the question set
    const savedSet = await createInterviewQuestionSet(env, {
      userId: d1User.id,
      role: role.trim(),
      seniority: seniority || null,
      types: Array.isArray(types) ? types : ['behavioral', 'technical'],
      questions,
      selectedIndices: validIndices,
      jd: jd || null
    });

    if (!savedSet) {
      return errorResponse('Failed to save question set', 500, origin, env, requestId);
    }

    console.log('[IQ-SAVE-SET] Success:', {
      requestId,
      uid,
      setId: savedSet.id,
      role: role.trim(),
      questionCount: questions.length,
      selectedCount: validIndices.length
    });

    return successResponse({
      id: savedSet.id,
      role: savedSet.role,
      seniority: savedSet.seniority,
      questionCount: questions.length,
      selectedCount: validIndices.length,
      createdAt: savedSet.created_at
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[IQ-SAVE-SET] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to save question set',
      500,
      origin,
      env,
      requestId
    );
  }
}

