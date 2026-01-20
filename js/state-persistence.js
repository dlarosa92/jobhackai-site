/**
 * JobHackAI State Persistence Utility
 * Persists ATS scores and resume data across page loads
 */

(function() {
  'use strict';

  const STORAGE_KEYS = {
    ATS_SCORE: 'jh_last_ats_score',
    ATS_BREAKDOWN: 'jh_last_ats_breakdown',
    ROLE_FEEDBACK: 'jh_last_role_feedback',
    RESUME_ID: 'jh_last_resume_id',
    RESUME_TEXT: 'jh_last_resume_text',
    JOB_TITLE: 'jh_last_job_title',
    TIMESTAMP: 'jh_last_score_timestamp',
    EXTRACTION_QUALITY: 'jh_last_extraction_quality'
  };

  // Legacy keys that were not user-scoped; keep for cleanup only
  const LEGACY_FALLBACK_KEYS = ['lastATSScore', 'lastATSSummary', 'lastATSBreakdown', 'currentAtsScore', 'currentAtsBreakdown', 'jh_last_extraction_quality'];

  function getActiveUserId(explicitUserId = null) {
    if (explicitUserId && typeof explicitUserId === 'string') {
      return explicitUserId;
    }
    try {
      const manager = window.FirebaseAuthManager;
      if (manager?.currentUser?.uid) return manager.currentUser.uid;
      if (typeof manager?.getCurrentUser === 'function') {
        const u = manager.getCurrentUser();
        if (u?.uid) return u.uid;
      }
    } catch (_) {
      // no-op
    }
    return null;
  }

  function getUserScopedKey(baseKey, userId = null) {
    const uid = getActiveUserId(userId);
    if (!uid) return null;
    return `${baseKey}:${uid}`;
  }

  function getScopedItem(storage, baseKey, userId = null) {
    const key = getUserScopedKey(baseKey, userId);
    if (!key || !storage) return null;
    try {
      return storage.getItem(key);
    } catch (err) {
      console.warn('[STATE-PERSISTENCE] Failed to read scoped item', { baseKey, err });
      return null;
    }
  }

  function setScopedItem(storage, baseKey, value, userId = null) {
    const key = getUserScopedKey(baseKey, userId);
    if (!key || !storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch (err) {
      // Re-throw QuotaExceededError so outer catch block can handle cleanup/retry logic
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        throw err;
      }
      console.warn('[STATE-PERSISTENCE] Failed to write scoped item', { baseKey, err });
      return false;
    }
  }

  function removeScopedItem(storage, baseKey, userId = null) {
    const key = getUserScopedKey(baseKey, userId);
    if (!key || !storage) return;
    try {
      storage.removeItem(key);
    } catch (err) {
      console.warn('[STATE-PERSISTENCE] Failed to remove scoped item', { baseKey, err });
    }
  }

  function clearAllScopedItems(storage, baseKey) {
    if (!storage || typeof storage.length !== 'number') return;
    try {
      for (let i = storage.length - 1; i >= 0; i--) {
        const key = storage.key(i);
        if (key && key.startsWith(`${baseKey}:`)) {
          storage.removeItem(key);
        }
      }
    } catch (err) {
      console.warn('[STATE-PERSISTENCE] Failed to clear scoped items', { baseKey, err });
    }
  }

  function clearLegacyFallbackCache() {
    try {
      LEGACY_FALLBACK_KEYS.forEach((k) => {
        try { localStorage.removeItem(k); } catch (_) {}
        try { sessionStorage.removeItem(k); } catch (_) {}
      });
    } catch (err) {
      console.warn('[STATE-PERSISTENCE] Failed to clear legacy fallback cache', err);
    }
  }

  // Cache expiration: 24 hours
  const CACHE_EXPIRATION = 24 * 60 * 60 * 1000;

  /**
   * Save ATS score to localStorage
   * @param {Object} data - Score data
   * @param {number} data.score - Overall score
   * @param {Object} data.breakdown - Score breakdown
   * @param {string} data.resumeId - Resume ID
   * @param {string} [data.jobTitle] - Job title
   * @param {Array} [data.roleSpecificFeedback] - Role-specific feedback array
   * @param {Object} [data.extractionQuality] - Extraction quality metrics
   * @param {string} [userId] - Optional user ID override (defaults to current auth user)
   */
  function saveATSScore({ score, breakdown, resumeId, jobTitle, roleSpecificFeedback, extractionQuality, userId = null }) {
    try {
      // Validate input
      if (typeof score !== 'number' || isNaN(score)) {
        console.warn('[STATE-PERSISTENCE] Invalid score:', score);
        return false;
      }
      
      if (!breakdown || typeof breakdown !== 'object') {
        console.warn('[STATE-PERSISTENCE] Invalid breakdown:', breakdown);
        return false;
      }
      
      if (!resumeId || typeof resumeId !== 'string') {
        console.warn('[STATE-PERSISTENCE] Invalid resumeId:', resumeId);
        return false;
      }
      
      // Ensure breakdown structure has feedback properties
      const normalizedBreakdown = { ...breakdown };
      ['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'].forEach(key => {
        if (normalizedBreakdown[key]) {
          // Ensure it's an object with feedback property
          if (typeof normalizedBreakdown[key] === 'number') {
            // Convert number to object
            normalizedBreakdown[key] = {
              score: normalizedBreakdown[key],
              max: key === 'keywordScore' ? 40 : key === 'formattingScore' ? 20 : key === 'structureScore' ? 15 : key === 'toneScore' ? 15 : 10,
              feedback: ''
            };
          } else if (typeof normalizedBreakdown[key] === 'object') {
            // Ensure feedback property exists
            if (!('feedback' in normalizedBreakdown[key])) {
              normalizedBreakdown[key] = {
                ...normalizedBreakdown[key],
                feedback: normalizedBreakdown[key].tip || normalizedBreakdown[key].message || ''
              };
            }
          }
        }
      });

      const data = {
        score,
        breakdown: normalizedBreakdown,
        resumeId,
        jobTitle,
        timestamp: Date.now()
      };

      const uid = getActiveUserId(userId);
      if (!uid) {
        console.warn('[STATE-PERSISTENCE] No user available for ATS cache; skipping save');
        return false;
      }

      // Try to save with quota error handling
      try {
        setScopedItem(localStorage, STORAGE_KEYS.ATS_SCORE, score.toString(), uid);
        setScopedItem(localStorage, STORAGE_KEYS.ATS_BREAKDOWN, JSON.stringify(normalizedBreakdown), uid);
        setScopedItem(localStorage, STORAGE_KEYS.RESUME_ID, resumeId, uid);
        
        // Always save job title (even if empty/null) to enable proper cache validation
        if (jobTitle) {
          setScopedItem(localStorage, STORAGE_KEYS.JOB_TITLE, jobTitle, uid);
        } else {
          // Clear job title if not provided (to distinguish between "no job title" and "has job title")
          removeScopedItem(localStorage, STORAGE_KEYS.JOB_TITLE, uid);
        }
        
        // Save role-specific feedback if provided
        // Support both old format (array) and new format (object with targetRoleUsed and sections)
        if (roleSpecificFeedback) {
          const isOldFormat = Array.isArray(roleSpecificFeedback);
          const isNewFormat = typeof roleSpecificFeedback === 'object' && 
                             roleSpecificFeedback.targetRoleUsed !== undefined &&
                             Array.isArray(roleSpecificFeedback.sections);
          
          if (isOldFormat || isNewFormat) {
            setScopedItem(localStorage, STORAGE_KEYS.ROLE_FEEDBACK, JSON.stringify(roleSpecificFeedback), uid);
          } else {
            // Invalid format - clear it
            removeScopedItem(localStorage, STORAGE_KEYS.ROLE_FEEDBACK, uid);
          }
        } else {
          // Clear role feedback if not provided (to distinguish between "no feedback" and "has feedback")
          removeScopedItem(localStorage, STORAGE_KEYS.ROLE_FEEDBACK, uid);
        }
        
        // Store extractionQuality separately for easy access
        if (extractionQuality && typeof extractionQuality === 'object') {
          setScopedItem(localStorage, STORAGE_KEYS.EXTRACTION_QUALITY, JSON.stringify(extractionQuality), uid);
        } else {
          // Clear extractionQuality if not provided
          removeScopedItem(localStorage, STORAGE_KEYS.EXTRACTION_QUALITY, uid);
        }
        
        setScopedItem(localStorage, STORAGE_KEYS.TIMESTAMP, data.timestamp.toString(), uid);

        console.log('[STATE-PERSISTENCE] Saved ATS score:', score, 'with role feedback:', !!roleSpecificFeedback, 'with breakdown feedback:', 
          !!(normalizedBreakdown.keywordScore?.feedback || normalizedBreakdown.formattingScore?.feedback), 'with extractionQuality:', !!extractionQuality);
        return true;
      } catch (storageError) {
        // Handle quota exceeded or other storage errors
        if (storageError.name === 'QuotaExceededError' || storageError.code === 22) {
          console.error('[STATE-PERSISTENCE] Storage quota exceeded, attempting cleanup');
          // Try to clear old data
          try {
            // Clear expired cache
            const oldTimestamp = getScopedItem(localStorage, STORAGE_KEYS.TIMESTAMP, uid);
            if (oldTimestamp) {
              const age = Date.now() - parseInt(oldTimestamp, 10);
              if (age > CACHE_EXPIRATION) {
                clearATSScore(uid);
                // Retry save (preserve userId parameter if explicitly provided)
                return saveATSScore({ score, breakdown: normalizedBreakdown, resumeId, jobTitle, roleSpecificFeedback, extractionQuality, userId });
              }
            }
          } catch (cleanupError) {
            console.error('[STATE-PERSISTENCE] Cleanup failed:', cleanupError);
          }
        }
        console.warn('[STATE-PERSISTENCE] Failed to save ATS score:', storageError);
        return false;
      }
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to save ATS score:', error);
      return false;
    }
  }

  /**
   * Load ATS score from localStorage
   * @param {string} [currentJobTitle] - Current job title to validate against cached score
   * @param {string} [userId] - Optional user ID override (defaults to current auth user)
   * @returns {Object|null} Score data or null if not found/expired/mismatched
   */
  function loadATSScore(currentJobTitle = null, userId = null) {
    try {
      const uid = getActiveUserId(userId);
      if (!uid) {
        // Without a user we cannot trust cached data; clear legacy non-scoped caches to prevent leakage
        clearLegacyFallbackCache();
        return null;
      }

      const timestamp = getScopedItem(localStorage, STORAGE_KEYS.TIMESTAMP, uid);
      if (!timestamp) {
        return null;
      }

      const age = Date.now() - parseInt(timestamp, 10);
      if (age > CACHE_EXPIRATION) {
        // Cache expired, clear it
        clearATSScore(uid);
        return null;
      }

      const score = getScopedItem(localStorage, STORAGE_KEYS.ATS_SCORE, uid);
      const breakdownStr = getScopedItem(localStorage, STORAGE_KEYS.ATS_BREAKDOWN, uid);
      const resumeId = getScopedItem(localStorage, STORAGE_KEYS.RESUME_ID, uid);
      const cachedJobTitle = getScopedItem(localStorage, STORAGE_KEYS.JOB_TITLE, uid);
      const roleFeedback = getScopedItem(localStorage, STORAGE_KEYS.ROLE_FEEDBACK, uid);

      if (!score || !breakdownStr || !resumeId) {
        return null;
      }

      // Parse breakdown with error handling
      let breakdown;
      try {
        breakdown = JSON.parse(breakdownStr);
      } catch (parseError) {
        console.warn('[STATE-PERSISTENCE] Failed to parse breakdown JSON:', parseError);
        // Try to recover by clearing corrupted data
        clearATSScore(uid);
        return null;
      }
      
      // Validate breakdown structure
      if (!breakdown || typeof breakdown !== 'object') {
        console.warn('[STATE-PERSISTENCE] Invalid breakdown structure');
        clearATSScore(uid);
        return null;
      }
      
      // Normalize breakdown structure (ensure feedback properties exist)
      const normalizedBreakdown = { ...breakdown };
      ['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'].forEach(key => {
        if (normalizedBreakdown[key]) {
          if (typeof normalizedBreakdown[key] === 'number') {
            // Convert number to object
            normalizedBreakdown[key] = {
              score: normalizedBreakdown[key],
              max: key === 'keywordScore' ? 40 : key === 'formattingScore' ? 20 : key === 'structureScore' ? 15 : key === 'toneScore' ? 15 : 10,
              feedback: ''
            };
          } else if (typeof normalizedBreakdown[key] === 'object') {
            // Ensure feedback property exists
            if (!('feedback' in normalizedBreakdown[key])) {
              normalizedBreakdown[key] = {
                ...normalizedBreakdown[key],
                feedback: normalizedBreakdown[key].tip || normalizedBreakdown[key].message || ''
              };
            }
          }
        }
      });

      // Skip validation if currentJobTitle is explicitly null (page load scenario)
      // This allows cached scores to be restored and job titles to be populated
      // Validation only applies when user explicitly provides a job title
      if (currentJobTitle !== null) {
        // Normalize job titles for comparison (handle empty strings, null, undefined)
        const normalizeTitle = (title) => {
          if (!title) return '';
          return String(title).trim().toLowerCase();
        };

        const normalizedCurrent = normalizeTitle(currentJobTitle);
        const normalizedCached = normalizeTitle(cachedJobTitle);

        // Only return cached score if job titles match (both empty counts as match)
        if (normalizedCurrent !== normalizedCached) {
          console.log('[STATE-PERSISTENCE] Cached score job title mismatch:', {
            cached: cachedJobTitle,
            current: currentJobTitle
          });
          return null;
        }
      }

      // Parse role feedback with error handling
      // Supports both old format (array) and new format (object with targetRoleUsed and sections)
      let roleSpecificFeedback = null;
      if (roleFeedback) {
        try {
          roleSpecificFeedback = JSON.parse(roleFeedback);
          // Validate it's either an array (old) or object with expected structure (new)
          if (roleSpecificFeedback) {
            const isOldFormat = Array.isArray(roleSpecificFeedback);
            const isNewFormat = typeof roleSpecificFeedback === 'object' && 
                               !Array.isArray(roleSpecificFeedback) &&
                               roleSpecificFeedback.targetRoleUsed !== undefined &&
                               Array.isArray(roleSpecificFeedback.sections);
            
            // If it's neither old nor new format, mark as invalid
            if (!isOldFormat && !isNewFormat) {
              console.warn('[STATE-PERSISTENCE] Invalid role feedback format, ignoring', {
                isArray: Array.isArray(roleSpecificFeedback),
                hasTargetRoleUsed: roleSpecificFeedback.targetRoleUsed !== undefined,
                hasSectionsArray: Array.isArray(roleSpecificFeedback.sections)
              });
              roleSpecificFeedback = null;
            }
          }
        } catch (parseError) {
          console.warn('[STATE-PERSISTENCE] Failed to parse role feedback JSON:', parseError);
          // Continue without role feedback rather than failing completely
        }
      }

      // Retrieve extractionQuality from localStorage (user-scoped only, no legacy fallback to prevent data leakage)
      const extractionQualityScoped = getScopedItem(localStorage, STORAGE_KEYS.EXTRACTION_QUALITY, uid);
      let extractionQuality = null;
      if (extractionQualityScoped) {
        try {
          extractionQuality = JSON.parse(extractionQualityScoped);
        } catch (e) {
          console.warn('[STATE-PERSISTENCE] Failed to parse extractionQuality:', e);
        }
      }

      return {
        score: parseFloat(score),
        breakdown: normalizedBreakdown,
        resumeId,
        jobTitle: cachedJobTitle || null,
        roleSpecificFeedback,
        extractionQuality,
        timestamp: parseInt(timestamp, 10),
        cached: true
      };
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to load ATS score:', error);
      // Try to clear corrupted data
      try {
        clearATSScore(userId);
      } catch (clearError) {
        console.error('[STATE-PERSISTENCE] Failed to clear corrupted data:', clearError);
      }
      return null;
    }
  }

  /**
   * Clear ATS score from localStorage
   */
  function clearATSScore(userId = null) {
    try {
      const uid = getActiveUserId(userId);
      if (uid) {
        Object.values(STORAGE_KEYS).forEach(key => {
          removeScopedItem(localStorage, key, uid);
        });
      }
      // Also clear any unscoped legacy keys to prevent leakage between users
      Object.values(STORAGE_KEYS).forEach(key => {
        try { localStorage.removeItem(key); } catch (_) {}
      });
      try { localStorage.removeItem('jh_last_extraction_quality'); } catch (_) {}
      clearLegacyFallbackCache();
      console.log('[STATE-PERSISTENCE] Cleared ATS score');
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to clear ATS score:', error);
    }
  }

  /**
   * Save resume data
   * @param {Object} data - Resume data
   * @param {string} data.resumeId - Resume ID
   * @param {string} [data.resumeText] - Resume text (optional, for fallback)
   */
  function saveResumeData({ resumeId, resumeText }) {
    try {
      sessionStorage.setItem('currentResumeId', resumeId);
      if (resumeText) {
        sessionStorage.setItem('currentResumeText', resumeText);
      }
      localStorage.setItem(STORAGE_KEYS.RESUME_ID, resumeId);
      console.log('[STATE-PERSISTENCE] Saved resume data:', resumeId);
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to save resume data:', error);
    }
  }

  /**
   * Load resume data
   * @returns {Object|null} Resume data or null
   */
  function loadResumeData() {
    try {
      const resumeId = sessionStorage.getItem('currentResumeId') || localStorage.getItem(STORAGE_KEYS.RESUME_ID);
      const resumeText = sessionStorage.getItem('currentResumeText');

      if (!resumeId) {
        return null;
      }

      return {
        resumeId,
        resumeText: resumeText || null
      };
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to load resume data:', error);
      return null;
    }
  }

  /**
   * Sync score to KV (via API)
   * @param {string} resumeId - Resume ID
   * @param {number} score - Score
   * @param {Object} breakdown - Breakdown
   * @param {string} authToken - Auth token
   * @returns {Promise<boolean>} Success status
   */
  async function syncScoreToKV(resumeId, score, breakdown, authToken) {
    try {
      // This would call an API endpoint to sync to KV
      // For now, we'll just log it - actual implementation depends on backend
      console.log('[STATE-PERSISTENCE] Would sync to KV:', { resumeId, score });
      return true;
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to sync to KV:', error);
      return false;
    }
  }

  // Export public API
  window.JobHackAIStatePersistence = {
    saveATSScore,
    loadATSScore,
    clearATSScore,
    saveResumeData,
    loadResumeData,
    syncScoreToKV,
    STORAGE_KEYS,
    CACHE_EXPIRATION
  };
})();

