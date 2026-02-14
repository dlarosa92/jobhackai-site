import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getDb } from '../../_lib/db.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders(origin, env)
    });
  }

  const token = getBearer(request);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders(origin, env)
    });
  }

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (authErr) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: corsHeaders(origin, env)
    });
  }

  const db = getDb(env);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500, headers: corsHeaders(origin, env)
    });
  }

  try {
    // Look up user (with fallback for pre-migration environments without activity columns)
    let user;
    try {
      user = await db.prepare(
        'SELECT id, auth_id, email, plan, created_at, updated_at, last_login_at, last_activity_at FROM users WHERE auth_id = ?'
      ).bind(uid).first();
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('no such column')) {
        user = await db.prepare(
          'SELECT id, auth_id, email, plan, created_at, updated_at FROM users WHERE auth_id = ?'
        ).bind(uid).first();
      } else {
        throw colErr;
      }
    }

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404, headers: corsHeaders(origin, env)
      });
    }

    const userId = user.id;

    // Aggregate all user data (run queries in parallel where possible)
    const [
      resumeSessions,
      feedbackSessions,
      linkedinRuns,
      interviewQuestionSets,
      mockInterviewSessions,
      coverLetterHistory,
      usageEvents,
      cookieConsentRows
    ] = await Promise.all([
      queryAll(db, 'SELECT id, title, role, ats_score, ats_ready, created_at FROM resume_sessions WHERE user_id = ?', userId),
      queryAll(db, 'SELECT fs.id, fs.resume_session_id, fs.created_at FROM feedback_sessions fs INNER JOIN resume_sessions rs ON fs.resume_session_id = rs.id WHERE rs.user_id = ?', userId),
      queryAll(db, 'SELECT id, created_at FROM linkedin_runs WHERE user_id = ?', uid),
      queryAll(db, 'SELECT id, role, seniority, types_json, created_at FROM interview_question_sets WHERE user_id = ?', userId),
      queryAll(db, 'SELECT id, created_at FROM mock_interview_sessions WHERE user_id = ?', userId),
      queryAll(db, 'SELECT id, title, role, company, seniority, tone, created_at FROM cover_letter_history WHERE user_id = ?', uid),
      queryAll(db, 'SELECT id, feature, tokens_used, created_at FROM usage_events WHERE user_id = ?', userId),
      queryAll(db, 'SELECT consent_json, updated_at FROM cookie_consents WHERE user_id = ?', userId)
    ]);

    const cookieConsent = cookieConsentRows.length > 0 ? cookieConsentRows[0] : null;

    // Build export object (exclude internal IDs)
    const exportData = {
      exportDate: new Date().toISOString(),
      user: {
        email: user.email,
        plan: user.plan,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login_at,
        lastActivityAt: user.last_activity_at
      },
      resumeSessions,
      feedbackSessions,
      linkedinRuns,
      interviewQuestionSets,
      mockInterviewSessions,
      coverLetterHistory,
      usageEvents,
      cookieConsent
    };

    const headers = {
      ...corsHeaders(origin, env),
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="jobhackai-data-export.json"'
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('[EXPORT] Error:', error);
    return new Response(JSON.stringify({ error: 'Export failed', details: error.message }), {
      status: 500, headers: corsHeaders(origin, env)
    });
  }
}

async function queryAll(db, sql, bind) {
  try {
    const result = await db.prepare(sql).bind(bind).all();
    return result.results || [];
  } catch (e) {
    console.warn('[EXPORT] Query failed:', e.message);
    return [];
  }
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = env?.FRONTEND_URL || null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin'
  };
}
