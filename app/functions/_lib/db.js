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
    const results = await env.DB.prepare(`
      SELECT 
        rs.id as session_id,
        rs.title,
        rs.role,
        rs.created_at,
        (SELECT id FROM feedback_sessions 
         WHERE resume_session_id = rs.id 
         ORDER BY created_at DESC 
         LIMIT 1) as feedback_id,
        (SELECT created_at FROM feedback_sessions 
         WHERE resume_session_id = rs.id 
         ORDER BY created_at DESC 
         LIMIT 1) as feedback_created_at
      FROM resume_sessions rs
      WHERE rs.user_id = ?
      ORDER BY rs.created_at DESC
      LIMIT ?
    `).bind(userId, limit).all();

    // Transform to clean history items
    const items = results.results.map(row => ({
      sessionId: String(row.session_id),
      title: row.title,
      role: row.role,
      createdAt: row.created_at,
      hasFeedback: !!row.feedback_id
    }));

    console.log('[DB] Retrieved history:', { userId, count: items.length });
    return items;
  } catch (error) {
    console.error('[DB] Error in getResumeFeedbackHistory:', error);
    return [];
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
 * Get an interview question set by ID
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} id - Set ID
 * @returns {Promise<Object|null>} Set with parsed JSON fields, or null if not found
 */
export async function getInterviewQuestionSetById(env, id) {
  if (!env.DB) {
    console.warn('[DB] D1 binding not available');
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, role, seniority, types_json, questions_json, selected_ids_json, jd, created_at
       FROM interview_question_sets
       WHERE id = ?`
    ).bind(id).first();

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

