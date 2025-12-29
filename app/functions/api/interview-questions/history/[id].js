/**
 * Interview Questions History Delete endpoint
 * DELETE /api/interview-questions/history/:id
 * 
 * Deletes a question set from D1.
 */

import { getBearer, verifyFirebaseIdToken } from '../../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, deleteInterviewQuestionSet, isD1Available } from '../../../_lib/db.js';

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
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'DELETE') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
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
      console.error('[IQ-HISTORY-DELETE] Authentication failed:', { 
        requestId, 
        error: authError.message 
      });
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    // Check if D1 is available
    if (!isD1Available(env)) {
      return errorResponse(
        'Database not available',
        503,
        origin,
        env,
        requestId
      );
    }

    // Get or create user
    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      return errorResponse('Failed to resolve user', 500, origin, env, requestId);
    }

    // Get set ID from URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const setIdStr = pathParts[pathParts.length - 1];
    
    if (!setIdStr) {
      return errorResponse('Set ID is required', 400, origin, env, requestId);
    }

    const setId = parseInt(setIdStr, 10);
    if (isNaN(setId) || setId <= 0) {
      return errorResponse('Invalid set ID', 400, origin, env, requestId);
    }

    // Delete the set (SQL enforces ownership)
    const deleted = await deleteInterviewQuestionSet(env, setId, d1User.id);

    if (!deleted) {
      return errorResponse('Question set not found', 404, origin, env, requestId);
    }

    console.log('[IQ-HISTORY-DELETE] Success:', { 
      requestId, 
      uid, 
      userId: d1User.id, 
      setId 
    });

    return successResponse({
      success: true,
      id: setId
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[IQ-HISTORY-DELETE] Error:', { 
      requestId, 
      error: error.message, 
      stack: error.stack 
    });
    
    return errorResponse(
      error.message || 'Failed to delete question set',
      500,
      origin,
      env,
      requestId
    );
  }
}

