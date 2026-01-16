// Role Tips endpoint (Tier 2)
// Generates role-specific tailoring tips asynchronously
// PHASE 2: Separate endpoint that does not block Tier 1 core feedback

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateRoleTips } from '../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../_lib/error-handler.js';
import { sanitizeJobTitle, sanitizeResumeText, sanitizeResumeId } from '../_lib/input-sanitizer.js';
import { normalizeRole, sanitizeRoleSpecificFeedback, isRoleSpecificFeedbackStrict } from '../_lib/feedback-validator.js';
import {
  getOrCreateUserByAuthId,
  isD1Available
} from '../_lib/db.js';

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env)
    }
  });
}

// Simple hash function for cache keys
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
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

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[ROLE-TIPS] JSON parse error:', { requestId, error: parseError.message });
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    // C1: Accept sessionId from request body
    const { resumeId, jobTitle, resumeText, sessionId } = body;

    // Validate inputs
    if (!resumeId) {
      return errorResponse('Resume ID is required', 400, origin, env, requestId);
    }

    const resumeIdValidation = sanitizeResumeId(resumeId);
    if (!resumeIdValidation.valid) {
      return errorResponse(resumeIdValidation.error || 'Invalid resume ID', 400, origin, env, requestId);
    }
    const sanitizedResumeId = resumeIdValidation.sanitized;

    if (!jobTitle || jobTitle.trim().length === 0) {
      return errorResponse('Job title is required for role tips', 400, origin, env, requestId);
    }

    const jobTitleValidation = sanitizeJobTitle(jobTitle, 200);
    if (!jobTitleValidation.valid) {
      return errorResponse(jobTitleValidation.error || 'Invalid job title', 400, origin, env, requestId);
    }
    const normalizedJobTitle = jobTitleValidation.sanitized;
    const normalizedRole = normalizeRole(normalizedJobTitle);

    // C2: Ownership verification via D1 first
    let d1User = null;
    let resumeSession = null;
    let feedbackSession = null;
    
    if (isD1Available(env)) {
      try {
        // Get user from D1
        d1User = await getOrCreateUserByAuthId(env, uid, null);
        if (!d1User) {
          return errorResponse('Failed to resolve user record', 500, origin, env, requestId);
        }

        // Verify resume session exists and belongs to user
        const rawTextLocation = `resume:${sanitizedResumeId}`;
        resumeSession = await env.DB.prepare(
          `SELECT id, user_id, raw_text_location FROM resume_sessions
           WHERE user_id = ? AND raw_text_location = ?
           ORDER BY created_at DESC
           LIMIT 1`
        ).bind(d1User.id, rawTextLocation).first();

        if (!resumeSession) {
          return errorResponse('Resume session not found or access denied', 404, origin, env, requestId);
        }

        // If sessionId provided, verify it belongs to this resume session and user
        if (sessionId) {
          feedbackSession = await env.DB.prepare(
            `SELECT id, resume_session_id, feedback_json FROM feedback_sessions
             WHERE id = ? AND resume_session_id = ?
             LIMIT 1`
          ).bind(sessionId, resumeSession.id).first();

          if (!feedbackSession) {
            // Log warning but don't fail - fallback to latest session
            console.warn('[ROLE-TIPS] sessionId not found or access denied, will use latest feedback_session', {
              requestId,
              sessionId,
              resumeSessionId: resumeSession.id
            });
          }
        }
      } catch (d1Error) {
        console.error('[ROLE-TIPS] D1 ownership verification failed', {
          requestId,
          error: d1Error.message
        });
        return errorResponse('Failed to verify ownership', 500, origin, env, requestId);
      }
    } else {
      // D1 required for ownership verification and persistence
      return errorResponse('Storage not available', 500, origin, env, requestId);
    }

    // C2: After verifying D1 ownership, load resume text
    // NOTE: Phase 3 will move to D1, but for now keep existing path
    let resumeData = null;
    
    if (env.JOBHACKAI_KV) {
      const resumeKey = `resume:${sanitizedResumeId}`;
      const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
      
      if (resumeDataStr) {
        resumeData = JSON.parse(resumeDataStr);
        
        // Verify resume belongs to user
        if (resumeData.uid !== uid) {
          return errorResponse('Unauthorized', 403, origin, env, requestId);
        }
      }
    }

    // Fallback to request body resumeText if KV not available or not found
    if (!resumeData && resumeText) {
      const resumeTextValidation = sanitizeResumeText(resumeText, 80000);
      if (!resumeTextValidation.valid) {
        return errorResponse(resumeTextValidation.error || 'Invalid resume text', 400, origin, env, requestId);
      }
      
      resumeData = {
        uid,
        text: resumeTextValidation.sanitized,
        fileName: 'resume',
        uploadedAt: Date.now()
      };
    }

    if (!resumeData || !resumeData.text) {
      return errorResponse('Resume text not found. Please provide resumeText in request body.', 400, origin, env, requestId);
    }

    // PHASE 2: Check KV cache for role tips (optional, non-blocking)
    let cachedRoleTips = null;
    if (env.JOBHACKAI_KV) {
      try {
        // Cache key: uid + resumeId + normalizedRole + model + schema version
        const modelVersion = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';
        const schemaVersion = 'v1';
        const cacheKey = `roleTips:${uid}:${sanitizedResumeId}:${normalizedRole}:${modelVersion}:${schemaVersion}`;
        const cached = await env.JOBHACKAI_KV.get(cacheKey);
        
        if (cached) {
          const cachedData = JSON.parse(cached);
          const cacheAge = Date.now() - cachedData.timestamp;
          
          // Cache valid for 24 hours
          if (cacheAge < 86400000) {
            cachedRoleTips = cachedData.roleSpecificFeedback;
            console.log('[ROLE-TIPS] Cache hit', { requestId, resumeId: sanitizedResumeId, role: normalizedRole });
          }
        }
      } catch (cacheError) {
        console.warn('[ROLE-TIPS] Cache read failed (non-fatal)', { requestId, error: cacheError.message });
        // Proceed without cache
      }
    }

    // Return cached result immediately if available
    if (cachedRoleTips) {
      // Validate cached result
      const isValid = isRoleSpecificFeedbackStrict(cachedRoleTips);
      if (isValid) {
        return successResponse({
          roleSpecificFeedback: cachedRoleTips,
          cached: true
        }, 200, origin, env, requestId);
      } else {
        console.warn('[ROLE-TIPS] Cached result invalid, regenerating', { requestId });
        // Continue to generation
      }
    }

    // Get rule-based scores for context (from D1 resume_session - load full row)
    let ruleBasedScores = null;
    if (resumeSession) {
      try {
        const sessionRow = await env.DB.prepare(
          `SELECT rule_based_scores_json FROM resume_sessions WHERE id = ?`
        ).bind(resumeSession.id).first();
        
        if (sessionRow && sessionRow.rule_based_scores_json) {
          ruleBasedScores = JSON.parse(sessionRow.rule_based_scores_json);
        }
      } catch (e) {
        console.warn('[ROLE-TIPS] Failed to parse rule_based_scores_json', { requestId });
      }
    }

    // Fallback rule-based scores structure if not available
    if (!ruleBasedScores) {
      ruleBasedScores = {
        keywordScore: { score: 0, max: 40, feedback: '' },
        formattingScore: { score: 0, max: 20, feedback: '' },
        structureScore: { score: 0, max: 15, feedback: '' },
        toneScore: { score: 0, max: 15, feedback: '' },
        grammarScore: { score: 0, max: 10, feedback: '' }
      };
    }

    // PHASE 2: Generate role tips with timeout (8-10 seconds)
    const TIER2_TIMEOUT_MS = 9000; // 9 seconds
    
    let roleSpecificFeedback = null;
    let tokenUsage = 0;
    
    try {
      const result = await generateRoleTips(
        resumeData.text,
        ruleBasedScores,
        normalizedJobTitle,
        env,
        { timeoutMs: TIER2_TIMEOUT_MS }
      );

      if (result && result.roleSpecificFeedback) {
        roleSpecificFeedback = result.roleSpecificFeedback;
        tokenUsage = result.usage?.totalTokens || 0;

        // Sanitize role-specific feedback
        if (typeof roleSpecificFeedback === 'object' && !Array.isArray(roleSpecificFeedback)) {
          const sanitized = sanitizeRoleSpecificFeedback(roleSpecificFeedback);
          if (sanitized) {
            roleSpecificFeedback = sanitized;
          } else {
            console.warn('[ROLE-TIPS] Sanitization failed, returning null', { requestId });
            roleSpecificFeedback = null;
          }
        } else {
          console.warn('[ROLE-TIPS] Invalid roleSpecificFeedback format', { requestId });
          roleSpecificFeedback = null;
        }
      }
    } catch (error) {
      const isTimeout = error.message?.includes('timeout');
      console.error('[ROLE-TIPS] Generation failed', {
        requestId,
        error: error.message,
        isTimeout,
        resumeId: sanitizedResumeId,
        role: normalizedRole
      });

      // On timeout or error, return non-200 status so frontend can show error UI
      const statusCode = isTimeout ? 504 : 500;
      return errorResponse(
        isTimeout ? 'Role tips generation timed out' : 'Failed to generate role tips',
        statusCode,
        origin,
        env,
        requestId,
        { error: isTimeout ? 'timeout' : 'generation_failed' }
      );
    }

    // C4: Persist role tips into D1 feedback_sessions for history consistency
    if (roleSpecificFeedback && isD1Available(env) && d1User && resumeSession) {
      try {
        let targetFeedbackSession = feedbackSession;
        
        // If sessionId was provided but not found, or no sessionId, use latest feedback_session
        if (!targetFeedbackSession) {
          if (sessionId) {
            console.warn('[ROLE-TIPS] sessionId not found, falling back to latest feedback_session', {
              requestId,
              sessionId,
              resumeSessionId: resumeSession.id
            });
          }
          
          // Find latest feedback_session for this resume_session_id
          targetFeedbackSession = await env.DB.prepare(
            `SELECT id, resume_session_id, feedback_json FROM feedback_sessions
             WHERE resume_session_id = ?
             ORDER BY created_at DESC
             LIMIT 1`
          ).bind(resumeSession.id).first();
        }

        if (targetFeedbackSession) {
          // Merge role tips into existing feedback_json
          let existingFeedbackJson = {};
          try {
            if (targetFeedbackSession.feedback_json) {
              existingFeedbackJson = JSON.parse(targetFeedbackSession.feedback_json);
            }
          } catch (parseError) {
            console.warn('[ROLE-TIPS] Failed to parse existing feedback_json, creating new structure', {
              requestId,
              error: parseError.message
            });
            existingFeedbackJson = {};
          }

          // Update feedback_json with role tips (preserve other keys)
          existingFeedbackJson.roleSpecificFeedback = roleSpecificFeedback;

          // Update the feedback_sessions row
          await env.DB.prepare(
            `UPDATE feedback_sessions 
             SET feedback_json = ?
             WHERE id = ?`
          ).bind(JSON.stringify(existingFeedbackJson), targetFeedbackSession.id).run();

          console.log('[ROLE-TIPS] Persisted role tips to D1 feedback_sessions', {
            requestId,
            feedbackSessionId: targetFeedbackSession.id,
            resumeSessionId: resumeSession.id
          });
        } else {
          console.warn('[ROLE-TIPS] No feedback_session found to persist role tips', {
            requestId,
            resumeSessionId: resumeSession.id
          });
        }
      } catch (persistError) {
        // Log error but don't fail the request - frontend still gets role tips
        console.error('[ROLE-TIPS] Failed to persist role tips to D1', {
          requestId,
          error: persistError.message,
          resumeSessionId: resumeSession?.id
        });
      }
    }

    // C5: Cache result in KV (optional, non-blocking)
    if (roleSpecificFeedback && env.JOBHACKAI_KV) {
      try {
        const modelVersion = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';
        const schemaVersion = 'v1';
        const cacheKey = `roleTips:${uid}:${sanitizedResumeId}:${normalizedRole}:${modelVersion}:${schemaVersion}`;
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify({
          roleSpecificFeedback,
          timestamp: Date.now()
        }), {
          expirationTtl: 86400 // 24 hours
        });
        console.log('[ROLE-TIPS] Cached result', { requestId, resumeId: sanitizedResumeId, role: normalizedRole });
      } catch (cacheError) {
        console.warn('[ROLE-TIPS] Cache write failed (non-fatal)', { requestId, error: cacheError.message });
        // Continue - cache is optional
      }
    }

    return successResponse({
      roleSpecificFeedback,
      tokenUsage,
      cached: false
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[ROLE-TIPS] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error,
      500,
      origin,
      env,
      requestId,
      { endpoint: 'role-tips' }
    );
  }
}
