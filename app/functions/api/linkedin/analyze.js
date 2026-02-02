import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth';
import { callOpenAI } from '../../_lib/openai-client.js';
import { getUserPlan } from '../../_lib/db.js';

const DB_BINDING_NAMES = ['JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1', 'DB'];

// Match LinkedIn's actual limits: headline 220, About 2600, experience 2000/position (6000 for ~3 positions), skills no char limit (2000 for paste)
const MAX = {
  requestId: 80,
  role: 120,
  headline: 220,
  summary: 2600,
  experience: 6000,
  skills: 2000,
  recommendations: 400
};

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function jsonResponse(env, data, status = 200) {
  const origin = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin'
    }
  });
}

function getDb(env) {
  for (const name of DB_BINDING_NAMES) {
    const candidate = env[name];
    if (candidate && typeof candidate.prepare === 'function') return candidate;
  }
  return null;
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS linkedin_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        role TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'processing',
        overall_score INTEGER,
        input_json TEXT NOT NULL,
        output_json TEXT,
        model TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        error_message TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_created
       ON linkedin_runs(user_id, created_at DESC)`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_hash
       ON linkedin_runs(user_id, input_hash)`
    )
    .run();
}

async function requirePremium(env, uid) {
  const plan = await getUserPlan(env, uid);
  if (plan !== 'premium') return { ok: false, plan };
  return { ok: true, plan };
}

function normalizeWhitespace(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(s, maxLen) {
  const str = String(s ?? '');
  if (!maxLen || maxLen <= 0) return str;
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function validateAnalyzeOutput(obj) {
  // Minimal runtime validation (structured outputs should guarantee shape,
  // but we still guard against null/empty).
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.overallScore !== 'number') return false;
  if (!Array.isArray(obj.keywordsToAdd)) return false;
  if (!Array.isArray(obj.quickWins)) return false;
  if (!obj.sections || typeof obj.sections !== 'object') return false;

  const requiredSections = ['headline', 'summary', 'experience', 'skills'];
  for (const key of requiredSections) {
    const sec = obj.sections[key];
    if (!sec || typeof sec !== 'object') return false;
    if (typeof sec.score !== 'number') return false;
    if (typeof sec.label !== 'string') return false;
    if (!Array.isArray(sec.feedbackBullets)) return false;
    if (typeof sec.optimizedText !== 'string') return false;
  }

  // recommendations is optional
  if (obj.sections.recommendations) {
    const sec = obj.sections.recommendations;
    if (typeof sec.score !== 'number') return false;
    if (typeof sec.label !== 'string') return false;
    if (!Array.isArray(sec.feedbackBullets)) return false;
    if (typeof sec.optimizedText !== 'string') return false;
  }

  return true;
}

function buildAnalyzeMessages({ role, headline, summary, experience, skills, recommendations }) {
  const hasRecs = !!recommendations;

  const system = `You are JobHackAI's LinkedIn Profile Optimizer.
Return STRICT JSON only (no markdown, no commentary).

Rules:
- Optimize for recruiter search and clarity for the target role.
- Do NOT invent achievements or metrics.
- Keep writing paste-ready for LinkedIn.
- quickWins: max 3 short bullets.
- keywordsToAdd: 5-10 items max.
- feedbackBullets per section: 2-3 items max.
 - Return section scores on a 0-100 scale if possible; the server will normalize and rescale when needed.

Length caps (LinkedIn limits):
- headline optimizedText <= 220 chars
- summary optimizedText <= 2600 chars (About section)
- experience optimizedText <= 2000 chars per position (6000 total for multiple)
- skills optimizedText <= 500 chars`;

  const user =
    `TARGET ROLE: ${role}\n\n` +
    `INPUT:\n` +
    `headline: ${headline}\n` +
    `summary: ${summary}\n` +
    `experience: ${experience}\n` +
    `skills: ${skills}\n` +
    (hasRecs ? `recommendations: ${recommendations}\n` : '');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function analyzeResponseSchema(includeRecommendations) {
  const sectionSchema = {
    type: 'object',
    properties: {
      score: { type: 'number' },
      label: { type: 'string' },
      feedbackBullets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
      optimizedText: { type: 'string' }
    },
    required: ['score', 'label', 'feedbackBullets', 'optimizedText'],
    additionalProperties: false
  };

  const sectionsProps = {
    headline: sectionSchema,
    summary: sectionSchema,
    experience: sectionSchema,
    skills: sectionSchema
  };
  const sectionsRequired = ['headline', 'summary', 'experience', 'skills'];

  if (includeRecommendations) {
    sectionsProps.recommendations = sectionSchema;
  }

  return {
    name: 'linkedin_optimizer_analyze_v1',
    schema: {
      type: 'object',
      properties: {
        overallScore: { type: 'number' },
        keywordsToAdd: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 10 },
        quickWins: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
        sections: {
          type: 'object',
          properties: sectionsProps,
          required: sectionsRequired.concat(includeRecommendations ? ['recommendations'] : []),
          additionalProperties: false
        }
      },
      required: ['overallScore', 'keywordsToAdd', 'quickWins', 'sections'],
      additionalProperties: false
    }
  };
}

async function cleanupOldRuns(db, uid) {
  const cutoff = Date.now() - RETENTION_MS;
  await db
    .prepare(
      `DELETE FROM linkedin_runs
       WHERE user_id = ? AND is_pinned = 0 AND created_at < ?`
    )
    .bind(uid, cutoff)
    .run();
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.FRONTEND_URL || 'https://dev.jobhackai.io',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        Vary: 'Origin'
      }
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(env, { error: 'method_not_allowed' }, 405);
  }

  const db = getDb(env);
  if (!db) return jsonResponse(env, { error: 'd1_not_bound' }, 500);

  const bearer = getBearer(request);
  if (!bearer) return jsonResponse(env, { error: 'unauthorized' }, 401);

  let uid;
  try {
    const verified = await verifyFirebaseIdToken(bearer, env.FIREBASE_PROJECT_ID);
    uid = verified.uid;
  } catch (e) {
    return jsonResponse(env, { error: 'unauthorized', reason: e?.message || 'invalid_token' }, 401);
  }

  const authz = await requirePremium(env, uid);
  if (!authz.ok) return jsonResponse(env, { error: 'premium_required' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(env, { error: 'invalid_json' }, 400);
  }

  const requestId = clampText(normalizeWhitespace(payload?.request_id), MAX.requestId);
  const role = clampText(normalizeWhitespace(payload?.role), MAX.role);
  const headline = clampText(String(payload?.headline || '').trim(), MAX.headline);
  const summary = clampText(String(payload?.summary || '').trim(), MAX.summary);
  const experience = clampText(String(payload?.experience || '').trim(), MAX.experience);
  const skills = clampText(String(payload?.skills || '').trim(), MAX.skills);
  const recommendationsRaw = payload?.recommendations !== undefined ? String(payload?.recommendations || '').trim() : '';
  const recommendations = clampText(recommendationsRaw, MAX.recommendations);
  const includeRecommendations = !!recommendations;

  if (!requestId) return jsonResponse(env, { error: 'invalid_request', field: 'request_id' }, 400);
  if (!role) return jsonResponse(env, { error: 'invalid_request', field: 'role' }, 400);
  if (!headline) return jsonResponse(env, { error: 'invalid_request', field: 'headline' }, 400);
  if (!summary) return jsonResponse(env, { error: 'invalid_request', field: 'summary' }, 400);
  if (!experience) return jsonResponse(env, { error: 'invalid_request', field: 'experience' }, 400);
  if (!skills) return jsonResponse(env, { error: 'invalid_request', field: 'skills' }, 400);

  try {
    await ensureSchema(db);
    // Retention backstop (per-user)
    await cleanupOldRuns(db, uid);

    // Idempotency: if request_id already exists, return it.
    const existingByRequest = await db
      .prepare(
        `SELECT id, created_at, updated_at, role, overall_score, status, output_json
         FROM linkedin_runs
         WHERE request_id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(requestId, uid)
      .first();

    if (existingByRequest) {
      const output = safeJsonParse(existingByRequest.output_json);
      if (existingByRequest.status === 'ok' && output) {
        return jsonResponse(env, {
          run_id: existingByRequest.id,
          created_at: existingByRequest.created_at,
          updated_at: existingByRequest.updated_at,
          role: existingByRequest.role,
          ...output
        });
      }
      return jsonResponse(
        env,
        {
          run_id: existingByRequest.id,
          created_at: existingByRequest.created_at,
          updated_at: existingByRequest.updated_at,
          role: existingByRequest.role,
          status: existingByRequest.status || 'processing'
        },
        202
      );
    }

    const inputHash = await sha256Hex(
      [
        uid,
        normalizeWhitespace(role),
        normalizeWhitespace(headline),
        normalizeWhitespace(summary),
        normalizeWhitespace(experience),
        normalizeWhitespace(skills),
        normalizeWhitespace(recommendations)
      ].join('|')
    );

    // Cache hit: same user+hash within 90 days and ok
    const cutoff = Date.now() - RETENTION_MS;
    const cached = await db
      .prepare(
        `SELECT id, created_at, updated_at, role, overall_score, status, output_json
         FROM linkedin_runs
         WHERE user_id = ? AND input_hash = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(uid, inputHash, cutoff)
      .first();

    if (cached && cached.status === 'ok' && cached.output_json) {
      const output = safeJsonParse(cached.output_json);
      if (output) {
        return jsonResponse(env, {
          run_id: cached.id,
          created_at: cached.created_at,
          updated_at: cached.updated_at,
          role: cached.role,
          ...output,
          deduped: true
        });
      }
    }

    const runId = crypto.randomUUID();
    const now = Date.now();
    const inputJsonObj = {
      role,
      headline,
      summary,
      experience,
      skills,
      ...(includeRecommendations ? { recommendations } : {})
    };

    await db
      .prepare(
        `INSERT INTO linkedin_runs
          (id, user_id, created_at, updated_at, role, input_hash, request_id, status, input_json, is_pinned)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, 'processing', ?, 0)`
      )
      .bind(runId, uid, now, now, role, inputHash, requestId, JSON.stringify(inputJsonObj))
      .run();

    let aiResult;
    try {
      // AI call (single call for all sections)
      aiResult = await callOpenAI(
        {
          model: env.OPENAI_MODEL_LINKEDIN_ANALYZE || 'gpt-4o-mini',
          fallbackModel: 'gpt-4o-mini',
          messages: buildAnalyzeMessages(inputJsonObj),
          responseFormat: analyzeResponseSchema(includeRecommendations),
          maxTokens: Number(env.OPENAI_MAX_TOKENS_LINKEDIN_ANALYZE) > 0 ? Number(env.OPENAI_MAX_TOKENS_LINKEDIN_ANALYZE) : 1300,
          temperature: Number.isFinite(Number(env.OPENAI_TEMPERATURE_LINKEDIN_ANALYZE))
            ? Number(env.OPENAI_TEMPERATURE_LINKEDIN_ANALYZE)
            : 0.2,
          systemPrompt: 'linkedin_optimizer_analyze_v2', // Bumped to v2 to invalidate old cached responses with incompatible schema
          userId: uid,
          feature: 'linkedin_optimizer_analyze'
        },
        env
      );
    } catch (e) {
      const msg = e?.message || 'openai_error';
      await db
        .prepare(
          `UPDATE linkedin_runs
           SET status = 'error', error_message = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(msg, Date.now(), runId, uid)
        .run();
      throw e;
    }

    const output = safeJsonParse(aiResult?.content);
    
    // Detailed validation logging to diagnose schema mismatches
    if (!validateAnalyzeOutput(output)) {
      console.error('[LINKEDIN ANALYZE] Validation failed - inspecting response structure:', {
        hasOutput: !!output,
        outputType: typeof output,
        outputKeys: output ? Object.keys(output) : null,
        // Check each validation requirement
        hasOverallScore: output?.overallScore !== undefined,
        overallScoreType: typeof output?.overallScore,
        overallScoreValue: output?.overallScore,
        hasKeywordsToAdd: Array.isArray(output?.keywordsToAdd),
        keywordsToAddType: typeof output?.keywordsToAdd,
        keywordsToAddLength: Array.isArray(output?.keywordsToAdd) ? output.keywordsToAdd.length : null,
        hasQuickWins: Array.isArray(output?.quickWins),
        quickWinsType: typeof output?.quickWins,
        quickWinsLength: Array.isArray(output?.quickWins) ? output.quickWins.length : null,
        hasSections: !!output?.sections,
        sectionsType: typeof output?.sections,
        sectionsKeys: output?.sections ? Object.keys(output.sections) : null,
        // Check each required section
        headlineValid: output?.sections?.headline ? {
          isObject: typeof output.sections.headline === 'object',
          hasScore: typeof output.sections.headline.score === 'number',
          scoreValue: output.sections.headline.score,
          hasLabel: typeof output.sections.headline.label === 'string',
          hasFeedbackBullets: Array.isArray(output.sections.headline.feedbackBullets),
          hasOptimizedText: typeof output.sections.headline.optimizedText === 'string'
        } : 'missing',
        // Raw content preview for debugging
        rawContentPreview: aiResult?.content?.substring(0, 1000),
        contentLength: aiResult?.content?.length,
        finishReason: aiResult?.finishReason,
        model: aiResult?.model,
        userId: uid,
        runId: runId
      });
    }
    
    if (!validateAnalyzeOutput(output)) {
      const msg = 'invalid_ai_json';
      await db
        .prepare(
          `UPDATE linkedin_runs
           SET status = 'error', error_message = ?, updated_at = ?, model = ?, tokens_in = ?, tokens_out = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(
          msg,
          Date.now(),
          aiResult?.model || null,
          aiResult?.usage?.promptTokens || null,
          aiResult?.usage?.completionTokens || null,
          runId,
          uid
        )
        .run();
      return jsonResponse(env, { error: 'generation_failed', reason: msg }, 500);
    }
    
    // --- Normalize section scores and compute weighted overall (server authoritative) ---
    const WEIGHTS = {
      headline: 20,
      summary: 30,
      experience: 25,
      skills: 15,
      recommendations: 10
    };

    function normalizeTo100(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      // Defensive: clamp negatives to 0
      if (n < 0) return 0;
      // Heuristic scaling for 0-10 model outputs: scale <= 10 to cover 10->100 case
      if (n <= 10) return Math.round(n * 10);
      // Otherwise clamp to 0-100 range
      return Math.round(Math.max(0, Math.min(100, n)));
    }

    // Normalize all section scores and detect scale mismatches
    let seenSmallScale = false;
    let weightSum = 0;
    let weightedSum = 0; // sum(normalized * weight)
    if (output.sections && typeof output.sections === 'object') {
      for (const [k, sec] of Object.entries(output.sections)) {
        if (sec && typeof sec.score === 'number') {
          // capture original reported score before mutating
          const originalScore = sec.score;
          const norm = normalizeTo100(originalScore);
          if (norm === null) {
            // leave as-is (will be coerced later), but log
            console.warn('[LINKEDIN] section score not numeric for', k, originalScore);
          } else {
            // detect if original was in small 0-10 scale
            if (originalScore <= 10) seenSmallScale = true;
            // replace with normalized score
            output.sections[k].score = norm;
            // accumulate weighted sum if k in WEIGHTS
            if (Object.prototype.hasOwnProperty.call(WEIGHTS, k)) {
              weightSum += WEIGHTS[k];
              weightedSum += norm * WEIGHTS[k];
            }
          }
        }
      }
    }

    // Compute overall: rescale to 0-100 based on available weights (normalize-to-100 behavior)
    let computedOverall = null;
    if (weightSum > 0) {
      // weighted average = (weightedSum / weightSum)
      computedOverall = Math.round(weightedSum / weightSum);
    }

    const aiOverall = Number.isFinite(output.overallScore) ? normalizeTo100(output.overallScore) : null;
    const overallScore = computedOverall !== null ? computedOverall : aiOverall !== null ? aiOverall : null;

    if (seenSmallScale) {
      console.info('[LINKEDIN] AI appears to return 0-10 scale for section scores; normalized to 0-100', {
        runId: runId,
        detectedSections: Object.keys(output.sections || {})
      });
    }

    const updatedAt = Date.now();

    await db
      .prepare(
        `UPDATE linkedin_runs
         SET status = 'ok',
             overall_score = ?,
             output_json = ?,
             updated_at = ?,
             model = ?,
             tokens_in = ?,
             tokens_out = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(
        overallScore,
        // Ensure output.overallScore reflects server-computed value before saving/returning
        (function () {
          try {
            if (overallScore !== null) output.overallScore = overallScore;
            return JSON.stringify(output);
          } catch (e) {
            return JSON.stringify(output);
          }
        })(),
        updatedAt,
        aiResult?.model || null,
        aiResult?.usage?.promptTokens || null,
        aiResult?.usage?.completionTokens || null,
        runId,
        uid
      )
      .run();

    return jsonResponse(env, {
      run_id: runId,
      created_at: now,
      updated_at: updatedAt,
      role,
      ...output,
      deduped: false
    });
  } catch (e) {
    console.error('linkedin analyze error', e);
    return jsonResponse(env, { error: 'server_error', reason: e?.message || 'unknown' }, 500);
  }
}

