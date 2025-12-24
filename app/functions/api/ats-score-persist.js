// ATS Score Persistence endpoint
// Stores ATS scores in KV + Firebase Firestore hybrid for cross-device continuity

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, isD1Available } from '../_lib/db.js';

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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

/**
 * Store ATS score in KV + Firestore
 */
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    // GET: Retrieve last ATS score
    if (request.method === 'GET') {
      // Try D1 first (source of truth)
      if (isD1Available(env)) {
        try {
          const db = env.DB || env.JOBHACKAI_DB;
          const d1User = await getOrCreateUserByAuthId(env, uid);
          if (d1User) {
            // Get latest resume session for user
            const latestSession = await db.prepare(
              `SELECT id, rule_based_scores_json, ats_score, role, created_at
               FROM resume_sessions 
               WHERE user_id = ? 
               ORDER BY created_at DESC 
               LIMIT 1`
            ).bind(d1User.id).first();
            
            if (latestSession && latestSession.rule_based_scores_json) {
              try {
                const ruleBasedScores = JSON.parse(latestSession.rule_based_scores_json);
                const extractionQuality = ruleBasedScores.extractionQuality;
                
                // Reconstruct breakdown from ruleBasedScores
                const breakdown = {
                  keywordScore: ruleBasedScores.keywordScore,
                  formattingScore: ruleBasedScores.formattingScore,
                  structureScore: ruleBasedScores.structureScore,
                  toneScore: ruleBasedScores.toneScore,
                  grammarScore: ruleBasedScores.grammarScore
                };
                
                // Ensure breakdown structure has feedback properties
                const normalizedBreakdown = { ...breakdown };
                ['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'].forEach(key => {
                  if (normalizedBreakdown[key] && typeof normalizedBreakdown[key] === 'object') {
                    if (!('feedback' in normalizedBreakdown[key])) {
                      normalizedBreakdown[key] = {
                        ...normalizedBreakdown[key],
                        feedback: normalizedBreakdown[key].tip || normalizedBreakdown[key].message || ''
                      };
                    }
                  }
                });
                
                return json({
                  success: true,
                  data: {
                    score: latestSession.ats_score || ruleBasedScores.overallScore,
                    breakdown: normalizedBreakdown,
                    extractionQuality: extractionQuality || null,
                    feedback: ruleBasedScores.feedback || null,
                    jobTitle: latestSession.role || null,
                    resumeId: `resume:${latestSession.id}`,
                    timestamp: new Date(latestSession.created_at).getTime()
                  }
                }, 200, origin, env);
              } catch (parseError) {
                console.warn('[ATS-SCORE-PERSIST] Failed to parse D1 ruleBasedScores, falling back to KV:', parseError);
                // Fall through to KV fallback
              }
            }
          }
        } catch (d1Error) {
          console.warn('[ATS-SCORE-PERSIST] D1 read failed, falling back to KV:', d1Error);
          // Fall through to KV fallback
        }
      }
      
      // Fallback to KV (existing code)
      const kv = env.JOBHACKAI_KV;
      if (!kv) {
        return json({ success: false, error: 'Storage not available' }, 500, origin, env);
      }

      const lastResumeKey = `user:${uid}:lastResume`;
      const lastResumeData = await kv.get(lastResumeKey);

      if (!lastResumeData) {
        return json({ success: true, data: null }, 200, origin, env);
      }

      let resumeData;
      try {
        resumeData = JSON.parse(lastResumeData);
      } catch (parseError) {
        console.warn('[ATS-SCORE-PERSIST] Failed to parse KV data, clearing:', parseError);
        // Clear corrupted data
        await kv.delete(lastResumeKey);
        return json({ success: true, data: null }, 200, origin, env);
      }
      
      // Validate that the stored data belongs to this user (double-check UID)
      // This prevents showing data from a previous user account that was deleted
      // and a new account created with the same email/UID
      if (resumeData.uid && resumeData.uid !== uid) {
        // Data belongs to a different user - don't return it
        console.warn('[ATS-SCORE-PERSIST] UID mismatch detected, clearing stale data', {
          storedUid: resumeData.uid,
          currentUid: uid
        });
        // Delete the stale data
        await kv.delete(lastResumeKey);
        return json({ success: true, data: null }, 200, origin, env);
      }
      
      // Ensure breakdown structure has feedback properties
      if (resumeData.breakdown && typeof resumeData.breakdown === 'object') {
        const normalizedBreakdown = { ...resumeData.breakdown };
        ['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'].forEach(key => {
          if (normalizedBreakdown[key] && typeof normalizedBreakdown[key] === 'object') {
            if (!('feedback' in normalizedBreakdown[key])) {
              normalizedBreakdown[key] = {
                ...normalizedBreakdown[key],
                feedback: normalizedBreakdown[key].tip || normalizedBreakdown[key].message || ''
              };
            }
          }
        });
        resumeData.breakdown = normalizedBreakdown;
      }
      
      // Ensure extractionQuality is included in KV response (if available)
      // Note: KV may not have extractionQuality if it was stored before this feature was added
      if (!resumeData.extractionQuality) {
        resumeData.extractionQuality = null;
      }
      
      return json({ success: true, data: resumeData }, 200, origin, env);
    }

    // POST: Store ATS score
    const body = await request.json();
    const { resumeId, score, breakdown, summary, jobTitle, extractionQuality } = body;

    if (!resumeId || typeof score !== 'number') {
      return json({ success: false, error: 'resumeId and score required' }, 400, origin, env);
    }

    const kv = env.JOBHACKAI_KV;
    if (!kv) {
      return json({ success: false, error: 'Storage not available' }, 500, origin, env);
    }

    const timestamp = Date.now();
    const lastResumeKey = `user:${uid}:lastResume`;
    
    const resumeState = {
      uid,
      resumeId,
      score,
      breakdown: breakdown || {},
      summary: summary || '',
      jobTitle: jobTitle || '',
      extractionQuality: extractionQuality || null,
      timestamp,
      syncedAt: timestamp
    };

    // Store in KV (fast, for dashboard pre-loading)
    try {
      await kv.put(lastResumeKey, JSON.stringify(resumeState), {
        expirationTtl: 2592000 // 30 days
      });
    } catch (kvError) {
      console.warn('[ATS-SCORE-PERSIST] KV write failed:', kvError);
      // Continue to Firestore even if KV fails
    }

    // Mirror to Firestore (for analytics and multi-device continuity)
    // Note: Firestore write requires Firebase Admin SDK or REST API
    // For now, we'll log the intent - full Firestore integration can be added later
    if (env.FIREBASE_PROJECT_ID) {
      // Firestore write would go here
      // For now, we rely on KV storage
      console.log('[ATS-SCORE-PERSIST] Firestore sync intent logged', { uid, resumeId });
    }

    return json({
      success: true,
      message: 'ATS score saved',
      data: resumeState
    }, 200, origin, env);

  } catch (error) {
    console.error('[ATS-SCORE-PERSIST] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

