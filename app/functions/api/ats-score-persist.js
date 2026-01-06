// ATS Score Persistence endpoint
// Stores ATS scores in KV + Firebase Firestore hybrid for cross-device continuity

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, isD1Available, getDb, upsertResumeSessionWithScores, getFirstResumeSnapshot, setFirstResumeSnapshot } from '../_lib/db.js';

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

    // Parse query params
    const url = new URL(request.url);
    const firstOnly = url.searchParams.get('first') === 'true';

    // GET: Retrieve last ATS score or first snapshot
    if (request.method === 'GET') {
      // If caller asked only for the first-run snapshot but D1 is unavailable,
      // don't fall back to KV (which contains latest resume). Return null so
      // callers (dashboard) know there's no persisted first snapshot yet.
      if (firstOnly && !isD1Available(env)) {
        return json({ success: true, data: null }, 200, origin, env);
      }

      // If caller asked for first-run snapshot, prefer D1
      if (firstOnly && isD1Available(env)) {
        try {
          const db = getDb(env);
          const d1User = await getOrCreateUserByAuthId(env, uid);
          if (d1User) {
            const first = await getFirstResumeSnapshot(env, d1User.id);
            if (first && first.snapshot) {
              const payload = first.snapshot;
              // Normalize fields to existing response shape
              return json({
                success: true,
                data: {
                  score: payload.score ?? null,
                  breakdown: payload.breakdown ?? null,
                  extractionQuality: payload.extractionQuality ?? null,
                  feedback: payload.feedback ?? null,
                  jobTitle: payload.jobTitle ?? null,
                  resumeId: payload.resumeId ? payload.resumeId : `resume:${first.resumeSessionId}`,
                  timestamp: payload.timestamp ?? Date.parse(first.createdAt)
                }
              }, 200, origin, env);
            }
          }
          // No first snapshot found, return null
          return json({ success: true, data: null }, 200, origin, env);
        } catch (e) {
          console.warn('[ATS-SCORE-PERSIST] D1 first snapshot read failed:', e);
          return json({ success: true, data: null }, 200, origin, env);
        }
      }

      // Try D1 first (source of truth)
      if (isD1Available(env)) {
        try {
          const db = getDb(env);
          const d1User = await getOrCreateUserByAuthId(env, uid);
          if (d1User) {
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
                const breakdown = {
                  keywordScore: ruleBasedScores.keywordScore,
                  formattingScore: ruleBasedScores.formattingScore,
                  structureScore: ruleBasedScores.structureScore,
                  toneScore: ruleBasedScores.toneScore,
                  grammarScore: ruleBasedScores.grammarScore
                };
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
                    score: latestSession.ats_score ?? ruleBasedScores.overallScore,
                    breakdown: normalizedBreakdown,
                    extractionQuality: extractionQuality || null,
                    feedback: ruleBasedScores.feedback || null,
                    jobTitle: latestSession.role || null,
                    resumeId: `resume:${latestSession.id}`,
                    timestamp: new Date(latestSession.created_at).getTime()
                  }
                }, 200, origin, env);
              } catch (parseError) {
                console.warn('[ATS-SCORE-PERSIST] Failed to parse D1 ruleBasedScores, returning null:', parseError);
                return json({ success: true, data: null }, 200, origin, env);
              }
            }
            // No valid session found
            return json({ success: true, data: null }, 200, origin, env);
          }
        } catch (d1Error) {
          console.warn('[ATS-SCORE-PERSIST] D1 read failed:', d1Error);
          return json({ success: true, data: null }, 200, origin, env);
        }
      }
      // Intentional: D1 is the single source-of-truth for GET reads.
      // We do NOT return KV-cached data to clients. POST still writes to KV
      // for fast preloading; KV is ephemeral—ensure background sync copies KV
      // writes into D1 when available and log/alert on D1 failures.
      // Always return null for non-D1 or no record
      return json({ success: true, data: null }, 200, origin, env);
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
      // initially assume not yet synced to D1; we'll set syncedAt after successful D1 mirror
      syncedAt: null,
      needsSync: true
    };

    // Store in KV (fast, for dashboard pre-loading)
    try {
      await kv.put(lastResumeKey, JSON.stringify(resumeState), {
        expirationTtl: 2592000 // 30 days
      });
    } catch (kvError) {
      console.warn('[ATS-SCORE-PERSIST] KV write failed:', kvError);
      // Continue even if KV fails
    }

    // Mirror to D1 and persist first snapshot
    if (isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, null);
        if (d1User) {
          const session = await upsertResumeSessionWithScores(env, d1User.id, {
            resumeId,
            role: jobTitle || null,
            atsScore: score,
            ruleBasedScores: breakdown || null
          });
          // Persist first-ever snapshot if not already set
          if (session) {
            const existingFirst = await getFirstResumeSnapshot(env, d1User.id);
            if (!existingFirst) {
              await setFirstResumeSnapshot(env, d1User.id, session.id, {
                uid,
                resumeId,
                score,
                breakdown,
                summary,
                jobTitle,
                extractionQuality,
                feedback: null,
                timestamp
              });
              console.log('[ATS-SCORE-PERSIST] Created D1 firstResume snapshot', { uid, resumeId, sessionId: session.id });
            }
          }
          // At this point D1 mirror appears successful — update KV record to mark synced
          try {
            resumeState.syncedAt = Date.now();
            resumeState.needsSync = false;
            await kv.put(lastResumeKey, JSON.stringify(resumeState), {
              expirationTtl: 2592000
            });
          } catch (kvUpdateErr) {
            // Non-fatal: KV update failing here is informational only
            console.warn('[ATS-SCORE-PERSIST] KV update after D1 mirror failed:', kvUpdateErr);
          }
        }
      } catch (e) {
        // If D1 mirror fails, leave needsSync=true in KV so a background sync worker can retry.
        console.warn('[ATS-SCORE-PERSIST] D1 mirror/first-snapshot failed (non-fatal):', e);
        // TODO: increment metrics counter for D1 write failures here
      }
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

