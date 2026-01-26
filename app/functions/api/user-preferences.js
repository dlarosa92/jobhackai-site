/**
 * User Preferences API
 * Handles user preference updates like welcome modal seen status
 * 
 * GET /api/user-preferences?preference=welcomeModalSeen
 * GET /api/user-preferences?preference=upgradePopupSeen
 * POST /api/user-preferences
 * Body: { preference: 'welcomeModalSeen', value: true }
 * Body: { preference: 'upgradePopupSeen', value: true }
 */

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { markWelcomeModalAsSeen, hasSeenWelcomeModal, markUpgradePopupAsSeen, hasSeenUpgradePopup } from '../_lib/db.js';

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: corsHeaders(origin, env) }
      );
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const authId = uid;

    // Handle GET request
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const preference = url.searchParams.get('preference');

      if (!preference) {
        return new Response(
          JSON.stringify({ error: 'Missing preference query parameter' }),
          { status: 400, headers: corsHeaders(origin, env) }
        );
      }

      if (preference === 'welcomeModalSeen') {
        const hasSeen = await hasSeenWelcomeModal(env, authId);
        return new Response(
          JSON.stringify({ preference, value: hasSeen }),
          { status: 200, headers: corsHeaders(origin, env) }
        );
      }

      if (preference === 'upgradePopupSeen') {
        const hasSeen = await hasSeenUpgradePopup(env, authId);
        return new Response(
          JSON.stringify({ preference, value: hasSeen }),
          { status: 200, headers: corsHeaders(origin, env) }
        );
      }

      return new Response(
        JSON.stringify({ error: `Unknown preference type: ${preference}` }),
        { status: 400, headers: corsHeaders(origin, env) }
      );
    }

    // Handle POST request
    if (request.method === 'POST') {
      // Parse request body
      const body = await request.json();
      const { preference, value } = body;

      if (!preference) {
        return new Response(
          JSON.stringify({ error: 'Missing preference field' }),
          { status: 400, headers: corsHeaders(origin, env) }
        );
      }

      // Handle different preference types
      if (preference === 'welcomeModalSeen') {
        // Validate value - must be boolean true
        if (value !== true) {
          return new Response(
            JSON.stringify({ 
              error: 'Invalid value for welcomeModalSeen',
              message: 'Value must be boolean true'
            }),
            { status: 400, headers: corsHeaders(origin, env) }
          );
        }

        const success = await markWelcomeModalAsSeen(env, authId);
        
        if (success) {
          return new Response(
            JSON.stringify({ success: true, message: 'Welcome modal marked as seen' }),
            { status: 200, headers: corsHeaders(origin, env) }
          );
        } else {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update preference' }),
            { status: 500, headers: corsHeaders(origin, env) }
          );
        }
      }

      if (preference === 'upgradePopupSeen') {
        if (value !== true) {
          return new Response(
            JSON.stringify({
              error: 'Invalid value for upgradePopupSeen',
              message: 'Value must be boolean true'
            }),
            { status: 400, headers: corsHeaders(origin, env) }
          );
        }

        const success = await markUpgradePopupAsSeen(env, authId);

        if (success) {
          return new Response(
            JSON.stringify({ success: true, message: 'Upgrade popup marked as seen' }),
            { status: 200, headers: corsHeaders(origin, env) }
          );
        } else {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to update preference' }),
            { status: 500, headers: corsHeaders(origin, env) }
          );
        }
      }

      // Unknown preference type
      return new Response(
        JSON.stringify({ error: `Unknown preference type: ${preference}` }),
        { status: 400, headers: corsHeaders(origin, env) }
      );
    }

    // Method not allowed
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: corsHeaders(origin, env) }
    );

  } catch (error) {
    console.error('[API] Error in user-preferences:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: corsHeaders(origin, env) }
    );
  }
}
