/**
 * Interview Questions History endpoint
 * GET /api/interview-questions/history?limit=10
 * 
 * Returns the user's past interview question sets from D1.
 * This is the single source of truth for interview questions history.
 */

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';
import { getOrCreateUserByAuthId, getInterviewQuestionSetsByUser, isD1Available } from '../../_lib/db.js';

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

export async function onRequest(context) {
  const { request, env } = context;
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
      console.error('[IQ-HISTORY] Authentication failed:', { 
        requestId, 
        error: authError.message 
      });
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    // Check if D1 is available
    if (!isD1Available(env)) {
      console.warn('[IQ-HISTORY] D1 not available');
      return successResponse({
        items: [],
        message: 'History not available'
      }, 200, origin, env, requestId);
    }

    // Get or create user
    const d1User = await getOrCreateUserByAuthId(env, uid, null);
    if (!d1User) {
      console.warn('[IQ-HISTORY] Failed to resolve user');
      return successResponse({
        items: [],
        message: 'No history available yet'
      }, 200, origin, env, requestId);
    }

    // Get limit from query params (default 10, max 50)
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '10', 10);
    // Validate limitParam is a valid number (not NaN)
    const limit = isNaN(limitParam) 
      ? 10  // Use default if invalid
      : Math.min(Math.max(1, limitParam), 50);  // Clamp between 1 and 50

    // Fetch history from D1
    const items = await getInterviewQuestionSetsByUser(env, d1User.id, { limit });

    // Transform to match frontend format
    const formattedItems = items.map(item => ({
      id: String(item.id),
      role: item.role,
      count: item.selectedCount,
      time: item.createdAt
    }));

    console.log('[IQ-HISTORY] Retrieved history:', { 
      requestId, 
      uid, 
      userId: d1User.id, 
      count: formattedItems.length 
    });

    return successResponse({
      items: formattedItems
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[IQ-HISTORY] Error:', { 
      requestId, 
      error: error.message, 
      stack: error.stack 
    });
    
    // Return empty history on error (non-blocking)
    // Note: Authentication errors are handled separately above
    return successResponse({
      items: [],
      message: 'No history available yet'
    }, 200, origin, env, requestId);
  }
}

