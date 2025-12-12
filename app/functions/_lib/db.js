/**
 * D1 Database Helper for JobHackAI
 * 
 * Provides simple wrappers around the D1 binding (env.DB) for:
 * - User management (getOrCreateUserByAuthId)
 * - Resume session tracking (createResumeSession)
 * - Feedback session storage (createFeedbackSession)
 * - Usage event logging (logUsageEvent)
 * - History retrieval (getResumeFeedbackHistory)
 * 
 * Design principles:
 * - Small and boring - no ORMs or heavy abstractions
 * - Assumes env.DB is correctly bound per environment (DEV/QA/PROD)
 * - Uses TEXT for dates (ISO 8601 format) for SQLite/D1 compatibility
 */

/**
 * Get or create a user by Firebase auth ID
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @param {string|null} email - User email (optional)
 * @returns {Promise<Object>} User record { id, auth_id, email, created_at, updated_at }
 */
export async function getOrCreateUserByAuthId(env, authId, email = null) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    // Try to find existing user
    const existing = await env.DB.prepare(
      'SELECT id, auth_id, email, created_at, updated_at FROM users WHERE auth_id = ?'
    ).bind(authId).first();

    if (existing) {
      // Update email if provided and different
      if (email && email !== existing.email) {
        await env.DB.prepare(
          'UPDATE users SET email = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(email, existing.id).run();
        existing.email = email;
        existing.updated_at = new Date().toISOString();
      }
      return existing;
    }

    // Create new user
    const result = await env.DB.prepare(
      'INSERT INTO users (auth_id, email) VALUES (?, ?) RETURNING id, auth_id, email, created_at, updated_at'
    ).bind(authId, email).first();

    console.log('[DB] Created new user:', { id: result.id, authId });
    return result;
  } catch (error) {
    console.error('[DB] Error in getOrCreateUserByAuthId:', error);
    throw error;
  }
}

/**
 * Create a resume session
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID from users table
 * @param {Object} options - Session options
 * @param {string|null} options.title - User-friendly title
 * @param {string|null} options.role - Target role (job title)
 * @param {string|null} options.rawTextLocation - KV key for resume text (e.g., "resume:${resumeId}")
 * @returns {Promise<Object>} Resume session { id, user_id, title, role, created_at, raw_text_location }
 */
export async function createResumeSession(env, userId, { title = null, role = null, rawTextLocation = null } = {}) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO resume_sessions (user_id, title, role, raw_text_location) 
       VALUES (?, ?, ?, ?) 
       RETURNING id, user_id, title, role, created_at, raw_text_location`
    ).bind(userId, title, role, rawTextLocation).first();

    console.log('[DB] Created resume session:', { id: result.id, userId, role });
    return result;
  } catch (error) {
    console.error('[DB] Error in createResumeSession:', error);
    throw error;
  }
}

/**
 * Create a feedback session
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} resumeSessionId - Resume session ID
 * @param {Object|string} feedbackJson - Full structured feedback (will be JSON.stringify'd if object)
 * @returns {Promise<Object>} Feedback session { id, resume_session_id, feedback_json, created_at }
 */
export async function createFeedbackSession(env, resumeSessionId, feedbackJson) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    const feedbackStr = typeof feedbackJson === 'string' 
      ? feedbackJson 
      : JSON.stringify(feedbackJson);

    const result = await env.DB.prepare(
      `INSERT INTO feedback_sessions (resume_session_id, feedback_json) 
       VALUES (?, ?) 
       RETURNING id, resume_session_id, feedback_json, created_at`
    ).bind(resumeSessionId, feedbackStr).first();

    console.log('[DB] Created feedback session:', { id: result.id, resumeSessionId });
    return result;
  } catch (error) {
    console.error('[DB] Error in createFeedbackSession:', error);
    throw error;
  }
}

/**
 * Log a usage event
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @param {string} feature - Feature name (e.g., 'resume_feedback')
 * @param {number|null} tokensUsed - Token count from OpenAI
 * @param {Object|null} meta - Additional metadata
 * @returns {Promise<Object>} Usage event { id, user_id, feature, tokens_used, meta_json, created_at }
 */
export async function logUsageEvent(env, userId, feature, tokensUsed = null, meta = null) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    const metaStr = meta ? JSON.stringify(meta) : null;

    const result = await env.DB.prepare(
      `INSERT INTO usage_events (user_id, feature, tokens_used, meta_json) 
       VALUES (?, ?, ?, ?) 
       RETURNING id, user_id, feature, tokens_used, meta_json, created_at`
    ).bind(userId, feature, tokensUsed, metaStr).first();

    console.log('[DB] Logged usage event:', { id: result.id, userId, feature, tokensUsed });
    return result;
  } catch (error) {
    console.error('[DB] Error in logUsageEvent:', error);
    throw error;
  }
}

/**
 * Get resume feedback history for a user
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of results (default 20)
 * @returns {Promise<Array>} List of history items
 */
export async function getResumeFeedbackHistory(env, userId, { limit = 20 } = {}) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return [];
  }

  try {
    // Get unique resume sessions with their latest feedback session (if any)
    // Uses correlated subqueries to get the most recent feedback per resume session
    // This ensures one row per resume_session even when multiple feedback_sessions exist
    // Also fetches ats_score from resume_sessions column or extracts from feedback_json
    const results = await env.DB.prepare(`
      SELECT 
        rs.id as session_id,
        rs.title,
        rs.role,
        rs.created_at,
        rs.ats_score,
        (SELECT id FROM feedback_sessions 
         WHERE resume_session_id = rs.id 
         ORDER BY created_at DESC 
         LIMIT 1) as feedback_id,
        (SELECT created_at FROM feedback_sessions 
         WHERE resume_session_id = rs.id 
         ORDER BY created_at DESC 
         LIMIT 1) as feedback_created_at,
        (SELECT feedback_json FROM feedback_sessions 
         WHERE resume_session_id = rs.id 
         ORDER BY created_at DESC 
         LIMIT 1) as feedback_json
      FROM resume_sessions rs
      WHERE rs.user_id = ?
      ORDER BY rs.created_at DESC
      LIMIT ?
    `).bind(userId, limit).all();

    // Transform to clean history items, extracting ats_score if needed
    const items = results.results.map(row => {
      let atsScore = row.ats_score;
      let fileName = null;
      let resumeId = null;
      let feedback = null;
      
      if (row.feedback_json) {
        try {
          feedback = JSON.parse(row.feedback_json);
          fileName = feedback?.fileName || null;
          resumeId = feedback?.resumeId || null;
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      // If ats_score column is null, try to extract from feedback_json
      if (atsScore === null && feedback) {
        // Prefer canonical overallScore if present
        if (typeof feedback.overallScore === 'number') {
          atsScore = feedback.overallScore;
        } else if (feedback.aiFeedback && typeof feedback.aiFeedback.overallScore === 'number') {
          atsScore = feedback.aiFeedback.overallScore;
        } else if (feedback.atsRubric && Array.isArray(feedback.atsRubric)) {
          // Fallback: sum rubric scores and round (matches calcOverallScore behavior)
          atsScore = Math.round(feedback.atsRubric.reduce((sum, item) => sum + (item.score || 0), 0));
        }
      }
      
      return {
        sessionId: String(row.session_id),
        title: row.title,
        role: row.role,
        createdAt: row.created_at,
        atsScore: atsScore,
        hasFeedback: !!row.feedback_id,
        fileName,
        resumeId
      };
    });

    console.log('[DB] Retrieved history:', { userId, count: items.length });
    return items;
  } catch (error) {
    console.error('[DB] Error in getResumeFeedbackHistory:', error);
    return [];
  }
}

/**
 * Get a specific feedback session by ID with full payload
 * Used for history detail view (D1-only, no OpenAI calls)
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} sessionId - Resume session ID
 * @param {number} userId - User ID (required for security - ownership check)
 * @returns {Promise<Object|null>} Full feedback session or null if not found/unauthorized
 */
export async function getFeedbackSessionById(env, sessionId, userId) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  if (!userId || typeof userId !== 'number') {
    console.warn('[DB] userId is required for getFeedbackSessionById');
    return null;
  }

  try {
    // Join resume_sessions and feedback_sessions, enforcing user ownership
    const row = await env.DB.prepare(`
      SELECT 
        rs.id as session_id,
        rs.user_id,
        rs.title,
        rs.role,
        rs.created_at as session_created_at,
        rs.ats_score,
        rs.raw_text_location,
        fs.id as feedback_id,
        fs.feedback_json,
        fs.created_at as feedback_created_at
      FROM resume_sessions rs
      LEFT JOIN feedback_sessions fs ON fs.resume_session_id = rs.id
      WHERE rs.id = ? AND rs.user_id = ?
      ORDER BY fs.created_at DESC
      LIMIT 1
    `).bind(sessionId, userId).first();

    if (!row) {
      return null;
    }

    // Parse feedback_json
    let feedbackData = null;
    if (row.feedback_json) {
      try {
        feedbackData = JSON.parse(row.feedback_json);
      } catch (e) {
        console.warn('[DB] Failed to parse feedback_json:', e);
      }
    }

    // Calculate ats_score if not stored
    let atsScore = row.ats_score;
    if (atsScore === null && feedbackData && feedbackData.atsRubric) {
      // Round to match calcOverallScore behavior for consistency
      atsScore = Math.round(feedbackData.atsRubric.reduce((sum, item) => sum + (item.score || 0), 0));
    }

    return {
      sessionId: String(row.session_id),
      userId: row.user_id,
      title: row.title,
      role: row.role,
      createdAt: row.session_created_at,
      atsScore: atsScore,
      rawTextLocation: row.raw_text_location,
      feedbackId: row.feedback_id ? String(row.feedback_id) : null,
      feedbackCreatedAt: row.feedback_created_at,
      // Full feedback payload for UI restoration
      feedback: feedbackData
    };
  } catch (error) {
    console.error('[DB] Error in getFeedbackSessionById:', error);
    
    // Only return null for schema mismatch errors (missing columns, etc.)
    // This prevents 500 errors when D1 schema is out of date
    // Other errors (connection failures, permission issues, etc.) should still throw
    const errorMessage = error?.message || String(error);
    // Check for schema mismatch errors (missing columns/tables)
    // Both error types are checked directly for consistency
    const isSchemaMismatch = 
      errorMessage.includes('no such column') ||
      errorMessage.includes('no such table');
    
    if (isSchemaMismatch) {
      console.warn('[DB] Schema mismatch detected, treating as "not found"');
      return null;
    }
    
    // Re-throw genuine database errors so they surface as 500 errors
    throw error;
  }
}

/**
 * Update resume session with ATS score
 * Called after feedback is generated to cache the score
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} sessionId - Resume session ID
 * @param {number} atsScore - Overall ATS score (0-100)
 * @returns {Promise<boolean>} Success
 */
export async function updateResumeSessionAtsScore(env, sessionId, atsScore) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return false;
  }

  try {
    await env.DB.prepare(
      'UPDATE resume_sessions SET ats_score = ? WHERE id = ?'
    ).bind(atsScore, sessionId).run();

    console.log('[DB] Updated ats_score:', { sessionId, atsScore });
    return true;
  } catch (error) {
    console.error('[DB] Error in updateResumeSessionAtsScore:', error);
    return false;
  }
}

/**
 * Get resume session by resumeId (looks up by raw_text_location)
 * Simple lookup: one table, one query, returns session or null
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID from users table
 * @param {string} resumeId - Resume ID (e.g., "uid:timestamp")
 * @returns {Promise<Object|null>} Resume session with rule_based_scores_json or null
 */
export async function getResumeSessionByResumeId(env, userId, resumeId) {
  if (!env.DB) {
    return null;
  }

  try {
    const rawTextLocation = `resume:${resumeId}`;
    const result = await env.DB.prepare(
      `SELECT id, user_id, title, role, created_at, raw_text_location, ats_score, rule_based_scores_json
       FROM resume_sessions 
       WHERE user_id = ? AND raw_text_location = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(userId, rawTextLocation).first();

    return result || null;
  } catch (error) {
    console.error('[DB] Error in getResumeSessionByResumeId:', error);
    return null;
  }
}

/**
 * Upsert resume session with rule-based scores
 * Simple pattern: INSERT OR UPDATE, one table, one JSON field
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @param {Object} options - Session data
 * @param {string} options.resumeId - Resume ID
 * @param {string|null} options.role - Target role
 * @param {number|null} options.atsScore - Overall ATS score
 * @param {Object|null} options.ruleBasedScores - Full rule-based scores object
 * @returns {Promise<Object|null>} Resume session or null
 */
export async function upsertResumeSessionWithScores(env, userId, {
  resumeId,
  role = null,
  atsScore = null,
  ruleBasedScores = null
}) {
  if (!env.DB) {
    return null;
  }

  try {
    const rawTextLocation = `resume:${resumeId}`;
    const ruleBasedScoresJson = ruleBasedScores ? JSON.stringify(ruleBasedScores) : null;

    // Check if exists
    const existing = await getResumeSessionByResumeId(env, userId, resumeId);

    if (existing) {
      // Update existing
      const result = await env.DB.prepare(
        `UPDATE resume_sessions 
         SET ats_score = COALESCE(?, ats_score),
             rule_based_scores_json = COALESCE(?, rule_based_scores_json),
             role = COALESCE(?, role)
         WHERE id = ?
         RETURNING id, user_id, title, role, created_at, raw_text_location, ats_score, rule_based_scores_json`
      ).bind(atsScore, ruleBasedScoresJson, role, existing.id).first();

      return result || null;
    } else {
      // Insert new
      const result = await env.DB.prepare(
        `INSERT INTO resume_sessions (user_id, title, role, raw_text_location, ats_score, rule_based_scores_json)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id, user_id, title, role, created_at, raw_text_location, ats_score, rule_based_scores_json`
      ).bind(userId, role, role, rawTextLocation, atsScore, ruleBasedScoresJson).first();

      return result || null;
    }
  } catch (error) {
    console.error('[DB] Error in upsertResumeSessionWithScores:', error);
    return null;
  }
}

/**
 * Check if D1 is available in the environment
 * @param {Object} env - Cloudflare environment
 * @returns {boolean}
 */
export function isD1Available(env) {
  return !!env.DB;
}

const MOCK_INTERVIEW_SESSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mock_interview_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  seniority TEXT NOT NULL,
  interview_style TEXT NOT NULL,
  question_set_id INTEGER,
  question_set_name TEXT,
  overall_score INTEGER NOT NULL,
  relevance_score INTEGER NOT NULL,
  structure_score INTEGER NOT NULL,
  clarity_score INTEGER NOT NULL,
  insight_score INTEGER NOT NULL,
  grammar_score INTEGER NOT NULL,
  situation_pct REAL NOT NULL,
  action_pct REAL NOT NULL,
  outcome_pct REAL NOT NULL,
  qa_pairs_json TEXT NOT NULL,
  feedback_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (question_set_id) REFERENCES interview_question_sets(id) ON DELETE SET NULL
);`;

const MOCK_INTERVIEW_USAGE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mock_interview_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  last_reset_at TEXT,
  UNIQUE(user_id, month),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`;

async function ensureMockInterviewIndexes(db) {
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_user_id ON mock_interview_sessions(user_id)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_created_at ON mock_interview_sessions(created_at DESC)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_mock_interview_sessions_role ON mock_interview_sessions(role)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_mock_interview_usage_user_month ON mock_interview_usage(user_id, month)')
    .run();
}

export async function ensureMockInterviewSchema(env) {
  if (!env.DB) return;

  try {
    await env.DB.prepare(MOCK_INTERVIEW_SESSIONS_TABLE_SQL).run();
    await env.DB.prepare(MOCK_INTERVIEW_USAGE_TABLE_SQL).run();
    await ensureMockInterviewIndexes(env.DB);
  } catch (error) {
    console.error('[DB] Error ensuring mock interview schema:', error);
    throw error;
  }
}

// ============================================================
// INTERVIEW QUESTION SET HELPERS
// ============================================================

/**
 * Create an interview question set
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {Object} options - Set options
 * @param {number} options.userId - User ID from users table
 * @param {string} options.role - Target role (e.g., "Software Engineer")
 * @param {string|null} options.seniority - Level (e.g., "Senior", "Mid")
 * @param {Array} options.types - Array of question types (e.g., ["behavioral", "technical"])
 * @param {Array} options.questions - Array of question objects [{id, q, hint, example}, ...]
 * @param {Array} options.selectedIndices - Array of selected question indices [0, 1, 2]
 * @param {string|null} options.jd - Optional job description
 * @returns {Promise<Object>} Created set { id, user_id, role, seniority, types_json, questions_json, selected_ids_json, jd, created_at }
 */
export async function createInterviewQuestionSet(env, { userId, role, seniority = null, types, questions, selectedIndices, jd = null }) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    const typesJson = JSON.stringify(types || []);
    const questionsJson = JSON.stringify(questions || []);
    const selectedIdsJson = JSON.stringify(selectedIndices || []);

    const result = await env.DB.prepare(
      `INSERT INTO interview_question_sets (user_id, role, seniority, types_json, questions_json, selected_ids_json, jd)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, user_id, role, seniority, types_json, questions_json, selected_ids_json, jd, created_at`
    ).bind(userId, role, seniority, typesJson, questionsJson, selectedIdsJson, jd).first();

    console.log('[DB] Created interview question set:', { id: result.id, userId, role });
    return result;
  } catch (error) {
    console.error('[DB] Error in createInterviewQuestionSet:', error);
    throw error;
  }
}

/**
 * Get an interview question set by ID and user ID (security: enforces ownership in SQL)
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} id - Set ID
 * @param {number} userId - User ID from users table (required for security)
 * @returns {Promise<Object|null>} Set with parsed JSON fields, or null if not found or doesn't belong to user
 */
export async function getInterviewQuestionSetById(env, id, userId) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  if (!userId || typeof userId !== 'number') {
    console.warn('[DB] userId is required for getInterviewQuestionSetById');
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, role, seniority, types_json, questions_json, selected_ids_json, jd, created_at
       FROM interview_question_sets
       WHERE id = ? AND user_id = ?`
    ).bind(id, userId).first();

    if (!row) {
      return null;
    }

    // Parse JSON fields back to JS objects
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      seniority: row.seniority,
      types: JSON.parse(row.types_json || '[]'),
      questions: JSON.parse(row.questions_json || '[]'),
      selectedIndices: JSON.parse(row.selected_ids_json || '[]'),
      jd: row.jd,
      createdAt: row.created_at
    };
  } catch (error) {
    console.error('[DB] Error in getInterviewQuestionSetById:', error);
    throw error;
  }
}

/**
 * Get interview question sets for a user (for history/recent sets)
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID from users table
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of results (default 10)
 * @returns {Promise<Array>} List of sets with metadata (not full questions)
 */
export async function getInterviewQuestionSetsByUser(env, userId, { limit = 10 } = {}) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return [];
  }

  try {
    const results = await env.DB.prepare(
      `SELECT id, role, seniority, types_json, selected_ids_json, created_at
       FROM interview_question_sets
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(userId, limit).all();

    // Transform to clean list items
    const items = results.results.map(row => ({
      id: row.id,
      role: row.role,
      seniority: row.seniority,
      types: JSON.parse(row.types_json || '[]'),
      selectedCount: JSON.parse(row.selected_ids_json || '[]').length,
      createdAt: row.created_at
    }));

    console.log('[DB] Retrieved interview question sets:', { userId, count: items.length });
    return items;
  } catch (error) {
    console.error('[DB] Error in getInterviewQuestionSetsByUser:', error);
    return [];
  }
}

// ============================================================
// FEATURE DAILY USAGE HELPERS
// ============================================================

/**
 * Get daily usage count for a feature
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID from users table
 * @param {string} feature - Feature name (e.g., 'interview_questions')
 * @returns {Promise<number>} Current usage count for today
 */
export async function getFeatureDailyUsage(env, userId, feature) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return 0;
  }

  try {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
    const row = await env.DB.prepare(
      `SELECT count FROM feature_daily_usage
       WHERE user_id = ? AND feature = ? AND usage_date = ?`
    ).bind(userId, feature, today).first();

    return row ? row.count : 0;
  } catch (error) {
    console.error('[DB] Error in getFeatureDailyUsage:', error);
    return 0;
  }
}

/**
 * Increment daily usage count for a feature
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID from users table
 * @param {string} feature - Feature name (e.g., 'interview_questions')
 * @param {number} incrementBy - Amount to increment (default 1)
 * @returns {Promise<number>} New total count after increment
 */
export async function incrementFeatureDailyUsage(env, userId, feature, incrementBy = 1) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return incrementBy;
  }

  try {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
    
    // Use INSERT ... ON CONFLICT pattern (SQLite supports this)
    const result = await env.DB.prepare(
      `INSERT INTO feature_daily_usage (user_id, feature, usage_date, count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, feature, usage_date)
       DO UPDATE SET count = count + excluded.count,
                     updated_at = datetime('now')
       RETURNING count`
    ).bind(userId, feature, today, incrementBy).first();

    if (result && result.count !== undefined) {
      return result.count;
    }
    
    // Fallback: if RETURNING doesn't work, fetch separately
    const row = await env.DB.prepare(
      `SELECT count FROM feature_daily_usage
       WHERE user_id = ? AND feature = ? AND usage_date = ?`
    ).bind(userId, feature, today).first();

    return row ? row.count : incrementBy;
  } catch (error) {
    console.error('[DB] Error in incrementFeatureDailyUsage:', error);
    // On error, return incrementBy as a safe fallback
    return incrementBy;
  }
}

// ============================================================
// MOCK INTERVIEW SESSION HELPERS
// ============================================================

/**
 * Create a mock interview session
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {Object} options - Session options
 * @param {number} options.userId - User ID from users table
 * @param {string} options.role - Target role
 * @param {string} options.seniority - Level (e.g., "Senior", "Mid")
 * @param {string} options.interviewStyle - Style: "mixed", "behavioral", "technical", "leadership"
 * @param {number|null} options.questionSetId - FK to interview_question_sets.id (nullable)
 * @param {string|null} options.questionSetName - Display name for the set
 * @param {number} options.overallScore - Total score 0-100
 * @param {Object} options.rubricScores - { relevance, structure, clarity, insight, grammar }
 * @param {Object} options.saoBreakdown - { situationPct, actionPct, outcomePct }
 * @param {Array} options.qaPairs - Array of { q, a } pairs
 * @param {Object} options.feedback - Full AI feedback JSON
 * @returns {Promise<Object>} Created session
 */
export async function createMockInterviewSession(env, {
  userId,
  role,
  seniority,
  interviewStyle,
  questionSetId = null,
  questionSetName = null,
  overallScore,
  rubricScores,
  saoBreakdown,
  qaPairs,
  feedback
}) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    await ensureMockInterviewSchema(env);

    const qaPairsJson = JSON.stringify(qaPairs || []);
    const feedbackJson = JSON.stringify(feedback || {});
    const setName = questionSetName || (questionSetId ? null : 'AI-generated');

    const result = await env.DB.prepare(
      `INSERT INTO mock_interview_sessions (
        user_id, role, seniority, interview_style, question_set_id, question_set_name,
        overall_score, relevance_score, structure_score, clarity_score, insight_score, grammar_score,
        situation_pct, action_pct, outcome_pct, qa_pairs_json, feedback_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, user_id, role, seniority, interview_style, question_set_id, question_set_name,
        overall_score, relevance_score, structure_score, clarity_score, insight_score, grammar_score,
        situation_pct, action_pct, outcome_pct, created_at`
    ).bind(
      userId,
      role,
      seniority,
      interviewStyle,
      questionSetId,
      setName,
      overallScore,
      rubricScores.relevance,
      rubricScores.structure,
      rubricScores.clarity,
      rubricScores.insight,
      rubricScores.grammar,
      saoBreakdown.situationPct,
      saoBreakdown.actionPct,
      saoBreakdown.outcomePct,
      qaPairsJson,
      feedbackJson
    ).first();

    console.log('[DB] Created mock interview session:', { id: result.id, userId, role, score: overallScore });
    return result;
  } catch (error) {
    console.error('[DB] Error in createMockInterviewSession:', error);
    throw error;
  }
}

/**
 * Get mock interview session by ID (enforces ownership)
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} sessionId - Session ID
 * @param {number} userId - User ID (required for security)
 * @returns {Promise<Object|null>} Full session with parsed JSON, or null
 */
export async function getMockInterviewSessionById(env, sessionId, userId) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  if (!userId || typeof userId !== 'number') {
    console.warn('[DB] userId is required for getMockInterviewSessionById');
    return null;
  }

  try {
    await ensureMockInterviewSchema(env);

    const row = await env.DB.prepare(
      `SELECT id, user_id, role, seniority, interview_style, question_set_id, question_set_name,
        overall_score, relevance_score, structure_score, clarity_score, insight_score, grammar_score,
        situation_pct, action_pct, outcome_pct, qa_pairs_json, feedback_json, created_at
      FROM mock_interview_sessions
      WHERE id = ? AND user_id = ?`
    ).bind(sessionId, userId).first();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      seniority: row.seniority,
      interviewStyle: row.interview_style,
      questionSetId: row.question_set_id,
      questionSetName: row.question_set_name || 'AI-generated',
      overallScore: row.overall_score,
      rubricScores: {
        relevance: row.relevance_score,
        structure: row.structure_score,
        clarity: row.clarity_score,
        insight: row.insight_score,
        grammar: row.grammar_score
      },
      saoBreakdown: {
        situationPct: row.situation_pct,
        actionPct: row.action_pct,
        outcomePct: row.outcome_pct
      },
      qaPairs: JSON.parse(row.qa_pairs_json || '[]'),
      feedback: JSON.parse(row.feedback_json || '{}'),
      createdAt: row.created_at
    };
  } catch (error) {
    console.error('[DB] Error in getMockInterviewSessionById:', error);
    return null;
  }
}

/**
 * Get mock interview session history for a user
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results (default 10)
 * @returns {Promise<Array>} List of session summaries (not full feedback)
 */
export async function getMockInterviewHistory(env, userId, { limit = 10 } = {}) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return [];
  }

  try {
    await ensureMockInterviewSchema(env);

    const results = await env.DB.prepare(
      `SELECT id, role, seniority, interview_style, question_set_name, overall_score, created_at
      FROM mock_interview_sessions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
    ).bind(userId, limit).all();

    const items = results.results.map(row => ({
      id: row.id,
      role: row.role,
      seniority: row.seniority,
      interviewStyle: row.interview_style,
      questionSetName: row.question_set_name || 'AI-generated',
      overallScore: row.overall_score,
      createdAt: row.created_at
    }));

    console.log('[DB] Retrieved mock interview history:', { userId, count: items.length });
    return items;
  } catch (error) {
    console.error('[DB] Error in getMockInterviewHistory:', error);
    return [];
  }
}

/**
 * Get mock interview monthly usage for a user
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @param {string|null} month - Month string "YYYY-MM" (default: current month)
 * @returns {Promise<number>} Sessions used this month
 */
export async function getMockInterviewMonthlyUsage(env, userId, month = null) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return 0;
  }

  try {
    await ensureMockInterviewSchema(env);

    const targetMonth = month || new Date().toISOString().slice(0, 7); // "YYYY-MM"
    
    const row = await env.DB.prepare(
      `SELECT sessions_used FROM mock_interview_usage
      WHERE user_id = ? AND month = ?`
    ).bind(userId, targetMonth).first();

    return row ? row.sessions_used : 0;
  } catch (error) {
    console.error('[DB] Error in getMockInterviewMonthlyUsage:', error);
    return 0;
  }
}

/**
 * Increment mock interview monthly usage
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} userId - User ID
 * @returns {Promise<number>} New total for the month
 */
export async function incrementMockInterviewMonthlyUsage(env, userId) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return 1;
  }

  try {
    await ensureMockInterviewSchema(env);

    const targetMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    
    const result = await env.DB.prepare(
      `INSERT INTO mock_interview_usage (user_id, month, sessions_used, last_reset_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, month)
      DO UPDATE SET sessions_used = sessions_used + 1, last_reset_at = datetime('now')
      RETURNING sessions_used`
    ).bind(userId, targetMonth).first();

    return result ? result.sessions_used : 1;
  } catch (error) {
    console.error('[DB] Error in incrementMockInterviewMonthlyUsage:', error);
    return 1;
  }
}

