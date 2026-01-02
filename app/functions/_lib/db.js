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
 * Resolve the D1 binding from the environment.
 *
 * Some environments bind D1 under a name other than `DB` (e.g. `JOBHACKAI_DB`).
 * To prevent silent persistence failures, we resolve from a small allowlist.
 */
const DB_BINDING_NAMES = ['DB', 'JOBHACKAI_DB', 'INTERVIEW_QUESTIONS_DB', 'IQ_D1'];
/**
 * Resolve the D1 binding from the environment.
 * @param {Object} env - Cloudflare environment
 * @returns {Object|null} D1 database binding or null if not available
 */
export function getDb(env) {
  if (!env) return null;
  const direct = env.DB;
  if (direct && typeof direct.prepare === 'function') return direct;
  for (const name of DB_BINDING_NAMES) {
    const candidate = env[name];
    if (candidate && typeof candidate.prepare === 'function') return candidate;
  }
  return null;
}
/**
 * Get or create a user by Firebase auth ID
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @param {string|null} email - User email (optional)
 * @returns {Promise<Object>} User record { id, auth_id, email, created_at, updated_at }
 */
export async function getOrCreateUserByAuthId(env, authId, email = null) {
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  try {
    // Try to find existing user
    // First, try with plan column (new schema)
    let existing;
    try {
      existing = await db.prepare(
        'SELECT id, auth_id, email, plan, created_at, updated_at FROM users WHERE auth_id = ?'
      ).bind(authId).first();
    } catch (planError) {
      // If plan column doesn't exist, try without it (fallback for pre-migration state)
      if (planError.message && planError.message.includes('no such column: plan')) {
        console.warn('[DB] Plan column not found, using fallback query. Migration 007 may need to be run.');
        existing = await db.prepare(
          'SELECT id, auth_id, email, created_at, updated_at FROM users WHERE auth_id = ?'
        ).bind(authId).first();
        // Add plan property with default value
        if (existing) {
          existing.plan = 'free';
        }
      } else {
        throw planError;
      }
    }
    if (existing) {
      // Update email if provided and different
      if (email && email !== existing.email) {
        await db.prepare(
          'UPDATE users SET email = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(email, existing.id).run();
        existing.email = email;
        existing.updated_at = new Date().toISOString();
      }
      return existing;
    }
    // Create new user
    const result = await db.prepare(
      'INSERT INTO users (auth_id, email) VALUES (?, ?) RETURNING id, auth_id, email, created_at, updated_at'
    ).bind(authId, email).first();
    if (!result) {
      throw new Error('Failed to create user: INSERT returned null');
    }
    // Add plan property if it wasn't returned (pre-migration state)
    if (!result.plan) {
      result.plan = 'free';
    }
    console.log('[DB] Created new user:', { id: result.id, authId });
    return result;
  } catch (error) {
    console.error('[DB] Error in getOrCreateUserByAuthId:', error);
    throw error;
  }
}
/**
 * Get user plan from D1 (source of truth)
 * Returns the effective plan, accounting for scheduled plan changes that have taken effect
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @returns {Promise<string>} Plan name ('free', 'trial', 'essential', 'pro', 'premium')
 */
export async function getUserPlan(env, authId) {
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available, defaulting to free');
    return 'free';
  }
  try {
    const user = await db.prepare(
      'SELECT plan, scheduled_plan, scheduled_at FROM users WHERE auth_id = ?'
    ).bind(authId).first();
    if (!user) return 'free';
    // Calculate effective plan - check if scheduled change has taken effect
    let effectivePlan = user.plan || 'free';
    if (user.scheduled_plan && user.scheduled_at) {
      const now = new Date();
      const scheduledDate = new Date(user.scheduled_at);
      if (now >= scheduledDate) {
        // Scheduled change has already taken effect, use the scheduled plan
        effectivePlan = user.scheduled_plan;
      }
    }
    return effectivePlan;
  } catch (error) {
    console.error('[DB] Error in getUserPlan:', error);
    return 'free';
  }
}
/**
 * Update user plan in D1
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @param {Object} planData - Plan update data
 * @param {string} planData.plan - Plan name
 * @param {string|null} planData.stripeCustomerId - Stripe customer ID
 * @param {string|null} planData.stripeSubscriptionId - Stripe subscription ID
 * @param {string|null} planData.subscriptionStatus - Subscription status
 * @param {string|null} planData.trialEndsAt - ISO 8601 datetime
 * @param {string|null} planData.currentPeriodEnd - ISO 8601 datetime
 * @param {string|null} planData.cancelAt - ISO 8601 datetime
 * @param {string|null} planData.scheduledPlan - Scheduled plan change
 * @param {string|null} planData.scheduledAt - ISO 8601 datetime for scheduled change
 * @returns {Promise<boolean>} Success
 */
export async function updateUserPlan(env, authId, {
  plan,
  stripeCustomerId = undefined,
  stripeSubscriptionId = undefined,
  subscriptionStatus = undefined,
  trialEndsAt = undefined,
  currentPeriodEnd = undefined,
  cancelAt = undefined,
  scheduledPlan = undefined,
  scheduledAt = undefined,
  planEventTimestamp = undefined // ISO 8601 datetime string from Stripe event.created
}) {
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return false;
  }
  try {
    // Ensure user exists first
    await getOrCreateUserByAuthId(env, authId);
    // Build UPDATE query dynamically to only set provided fields
    const updates = [];
    const binds = [];
    if (plan !== undefined) {
      updates.push('plan = ?');
      binds.push(plan);
    }
    if (stripeCustomerId !== undefined) {
      updates.push('stripe_customer_id = ?');
      binds.push(stripeCustomerId);
    }
    if (stripeSubscriptionId !== undefined) {
      updates.push('stripe_subscription_id = ?');
      binds.push(stripeSubscriptionId);
    }
    if (subscriptionStatus !== undefined) {
      updates.push('subscription_status = ?');
      binds.push(subscriptionStatus);
    }
    if (trialEndsAt !== undefined) {
      updates.push('trial_ends_at = ?');
      binds.push(trialEndsAt);
    }
    if (currentPeriodEnd !== undefined) {
      updates.push('current_period_end = ?');
      binds.push(currentPeriodEnd);
    }
    if (cancelAt !== undefined) {
      updates.push('cancel_at = ?');
      binds.push(cancelAt);
    }
    if (scheduledPlan !== undefined) {
      updates.push('scheduled_plan = ?');
      binds.push(scheduledPlan);
    }
    if (scheduledAt !== undefined) {
      updates.push('scheduled_at = ?');
      binds.push(scheduledAt);
    }
    // Always update timestamps
    // Use planEventTimestamp if provided (from Stripe event.created), otherwise use current time
    if (planEventTimestamp !== undefined) {
      updates.push('plan_updated_at = ?');
      binds.push(planEventTimestamp);
    } else {
      updates.push('plan_updated_at = datetime(\'now\')');
    }
    updates.push('updated_at = datetime(\'now\')');
    if (updates.length === 2) {
      // Only timestamps to update - nothing to do
      return true;
    }
    binds.push(authId);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE auth_id = ?`;
    await db.prepare(query).bind(...binds).run();
    console.log('[DB] Updated user plan:', { authId, plan });
    return true;
  } catch (error) {
    console.error('[DB] Error in updateUserPlan:', error);
    return false;
  }
}
/**
 * Get full user plan data including subscription metadata
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @returns {Promise<Object|null>} User plan data or null
 */
export async function getUserPlanData(env, authId) {
  const db = getDb(env);
  if (!db) {
    return null;
  }
  try {
    const user = await db.prepare(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status,
              trial_ends_at, current_period_end, cancel_at, scheduled_plan, scheduled_at,
              plan_updated_at
       FROM users WHERE auth_id = ?`
    ).bind(authId).first();
    if (!user) return null;
    // Calculate effective plan - check if scheduled change has taken effect
    let effectivePlan = user.plan || 'free';
    let scheduledPlanChange = null;
    if (user.scheduled_plan && user.scheduled_at) {
      const now = new Date();
      const scheduledDate = new Date(user.scheduled_at);
      if (now >= scheduledDate) {
        // Scheduled change has already taken effect, use the scheduled plan as effective
        effectivePlan = user.scheduled_plan;
        // Do not expose scheduledPlanChange if the effective date has passed
        scheduledPlanChange = null;
      } else {
        // Scheduled change is in the future — expose it to the API consumer
        scheduledPlanChange = {
          newPlan: user.scheduled_plan,
          effectiveDate: user.scheduled_at
        };
      }
    }
    return {
      plan: effectivePlan, // Return effective plan, not raw plan
      stripeCustomerId: user.stripe_customer_id,
      stripeSubscriptionId: user.stripe_subscription_id,
      subscriptionStatus: user.subscription_status,
      trialEndsAt: user.trial_ends_at,
      currentPeriodEnd: user.current_period_end,
      cancelAt: user.cancel_at,
      scheduledPlanChange,
      planUpdatedAt: user.plan_updated_at
    };
  } catch (error) {
    console.error('[DB] Error in getUserPlanData:', error);
    return null;
  }
}
/**
 * Check if user is eligible for a trial (D1 is source of truth)
 * A user is eligible if they are on the free plan, have never had a trial (trial_ends_at IS NULL),
 * and have not previously paid (has_ever_paid = 0).
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {string} authId - Firebase UID
 * @returns {Promise<boolean>}
 */
export async function isTrialEligible(env, authId) {
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    // Surface the error to callers so they can decide (checkout should return 500)
    throw new Error('D1 binding not available');
  }
  try {
    // Read core columns first (present in migration 007)
    const user = await db.prepare(
      'SELECT plan, trial_ends_at FROM users WHERE auth_id = ?'
    ).bind(authId).first();
    if (!user) {
      // New user = eligible
      return true;
    }
    const isOnFreePlan = (user.plan || 'free') === 'free';
    const hadTrial = user.trial_ends_at !== null;
    // has_ever_paid may be added in a later migration (e.g., Migration 010).
    // Attempt to read it; if the column doesn't exist, treat as not paid (0).
    let everPaid = 0;
    try {
      const paidRow = await db.prepare(
        'SELECT has_ever_paid FROM users WHERE auth_id = ?'
      ).bind(authId).first();
      if (paidRow && paidRow.has_ever_paid !== undefined && paidRow.has_ever_paid !== null) {
        everPaid = Number(paidRow.has_ever_paid) === 1 ? 1 : 0;
      }
    } catch (colErr) {
      // If column missing, treat as not paid. Re-throw unexpected errors.
      const msg = String(colErr?.message || '').toLowerCase();
      if (msg.includes('no such column') || msg.includes('unknown column') || msg.includes('no such')) {
        everPaid = 0;
      } else {
        throw colErr;
      }
    }
    return isOnFreePlan && !hadTrial && everPaid === 0;
  } catch (error) {
    console.error('[DB] Error in isTrialEligible:', error);
    // Propagate error to caller so it can return a 500 and avoid misleading 400s
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  try {
    const result = await db.prepare(
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  try {
    const feedbackStr = typeof feedbackJson === 'string' 
      ? feedbackJson 
      : JSON.stringify(feedbackJson);
    const result = await db.prepare(
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  try {
    const metaStr = meta ? JSON.stringify(meta) : null;
    const result = await db.prepare(
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
 * Atomic attempt to reserve a free ATS usage (returns true if succeeded, false if already used)
 * Uses a unique partial index on (user_id, feature) WHERE feature='ats_score' to enforce one-time use.
 */
export async function claimFreeATSUsage(env, userId) {
  const db = getDb(env);
  if (!db) throw new Error('D1 unavailable');
  try {
    await db.prepare(`
      INSERT INTO usage_events (user_id, feature, tokens_used, meta_json, created_at)
      VALUES (?, 'ats_score', null, NULL, datetime('now'))
    `).bind(userId).run();
    return true;
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint') || msg.includes('duplicate')) {
      return false;
    }
    throw e;
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return [];
  }
  try {
    // Get unique resume sessions with their latest feedback session (if any)
    // Uses correlated subqueries to get the most recent feedback per resume session
    // This ensures one row per resume_session even when multiple feedback_sessions exist
    // Also fetches ats_score from resume_sessions column or extracts from feedback_json
    const results = await db.prepare(`
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  if (!userId || typeof userId !== 'number') {
    console.warn('[DB] userId is required for getFeedbackSessionById');
    return null;
  }
  try {
    // Join resume_sessions and feedback_sessions, enforcing user ownership
    const row = await db.prepare(`
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
 * Delete a resume feedback session by ID (with ownership check)
 * Cascades to delete related feedback_sessions (via FK) and optionally removes KV data
 * @param {Object} env - Cloudflare environment with DB binding
 * @param {number} sessionId - Resume session ID
 * @param {number} userId - User ID (required for security - ownership check)
 * @returns {Promise<boolean>} True if deleted, false if not found/unauthorized
 */
export async function deleteResumeFeedbackSession(env, sessionId, userId) {
  const db = getDb(env);
  if (!db) {
    throw new Error('[DB] D1 binding not available');
  }
  if (!userId || typeof userId !== 'number') {
    throw new Error('userId is required for deleteResumeFeedbackSession');
  }
  try {
    const session = await db.prepare(`
      SELECT id, user_id, raw_text_location
      FROM resume_sessions
      WHERE id = ? AND user_id = ?
    `).bind(sessionId, userId).first();
    if (!session) {
      return false;
    }
    const result = await db.prepare(`
      DELETE FROM resume_sessions
      WHERE id = ? AND user_id = ?
    `).bind(sessionId, userId).run();
    const rowsAffected =
      typeof result?.meta?.changes === 'number'
        ? result.meta.changes
        : typeof result?.changes === 'number'
          ? result.changes
          : 0;
    if (rowsAffected === 0) {
      return false;
    }
    if (session.raw_text_location && env.JOBHACKAI_KV) {
      try {
        await env.JOBHACKAI_KV.delete(session.raw_text_location);
        console.log('[DB] Deleted KV entry:', session.raw_text_location);
      } catch (kvError) {
        console.warn('[DB] Failed to delete KV entry (non-fatal):', kvError);
      }
    }
    console.log('[DB] Deleted resume session:', { sessionId, userId });
    return true;
  } catch (error) {
    console.error('[DB] Error in deleteResumeFeedbackSession:', error);
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return false;
  }
  try {
    await db.prepare(
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
  const db = getDb(env);
  if (!db) {
    return null;
  }
  try {
    const rawTextLocation = `resume:${resumeId}`;
    const result = await db.prepare(
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
  const db = getDb(env);
  if (!db) {
    return null;
  }
  try {
    const rawTextLocation = `resume:${resumeId}`;
    const ruleBasedScoresJson = ruleBasedScores ? JSON.stringify(ruleBasedScores) : null;
    // Check if exists
    const existing = await getResumeSessionByResumeId(env, userId, resumeId);
    if (existing) {
      // Update existing
      const result = await db.prepare(
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
      const result = await db.prepare(
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
  return !!getDb(env);
}
const INTERVIEW_QUESTION_SETS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS interview_question_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  seniority TEXT,
  types_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  selected_ids_json TEXT NOT NULL,
  jd TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`;
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
  const db = getDb(env);
  if (!db) return;
  try {
    await db.prepare(INTERVIEW_QUESTION_SETS_TABLE_SQL).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_interview_question_sets_user_id ON interview_question_sets(user_id)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_interview_question_sets_created_at ON interview_question_sets(created_at DESC)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_interview_question_sets_role ON interview_question_sets(role)').run();
    await db.prepare(MOCK_INTERVIEW_SESSIONS_TABLE_SQL).run();
    await db.prepare(MOCK_INTERVIEW_USAGE_TABLE_SQL).run();
    await ensureMockInterviewIndexes(db);
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
  const db = getDb(env);
  if (!db) {
    console.warn('[DB] D1 binding not available');
    return null;
  }
  try {
    const typesJson = JSON.stringify(types || []);
    const questionsJson = JSON.stringify(questions || []);
    const selectedIdsJson = JSON.stringify(selectedIndices || []);
    const result = await db.prepare(
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
