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
    TIMESTAMP: 'jh_last_score_timestamp'
  };

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
   */
  function saveATSScore({ score, breakdown, resumeId, jobTitle, roleSpecificFeedback }) {
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

      // Try to save with quota error handling
      try {
        localStorage.setItem(STORAGE_KEYS.ATS_SCORE, score.toString());
        localStorage.setItem(STORAGE_KEYS.ATS_BREAKDOWN, JSON.stringify(normalizedBreakdown));
        localStorage.setItem(STORAGE_KEYS.RESUME_ID, resumeId);
        
        // Always save job title (even if empty/null) to enable proper cache validation
        if (jobTitle) {
          localStorage.setItem(STORAGE_KEYS.JOB_TITLE, jobTitle);
        } else {
          // Clear job title if not provided (to distinguish between "no job title" and "has job title")
          localStorage.removeItem(STORAGE_KEYS.JOB_TITLE);
        }
        
        // Save role-specific feedback if provided
        // Support both old format (array) and new format (object with targetRoleUsed and sections)
        if (roleSpecificFeedback) {
          const isOldFormat = Array.isArray(roleSpecificFeedback);
          const isNewFormat = typeof roleSpecificFeedback === 'object' && 
                             roleSpecificFeedback.targetRoleUsed !== undefined &&
                             Array.isArray(roleSpecificFeedback.sections);
          
          if (isOldFormat || isNewFormat) {
            localStorage.setItem(STORAGE_KEYS.ROLE_FEEDBACK, JSON.stringify(roleSpecificFeedback));
          } else {
            // Invalid format - clear it
            localStorage.removeItem(STORAGE_KEYS.ROLE_FEEDBACK);
          }
        } else {
          // Clear role feedback if not provided (to distinguish between "no feedback" and "has feedback")
          localStorage.removeItem(STORAGE_KEYS.ROLE_FEEDBACK);
        }
        localStorage.setItem(STORAGE_KEYS.TIMESTAMP, data.timestamp.toString());

        console.log('[STATE-PERSISTENCE] Saved ATS score:', score, 'with role feedback:', !!roleSpecificFeedback, 'with breakdown feedback:', 
          !!(normalizedBreakdown.keywordScore?.feedback || normalizedBreakdown.formattingScore?.feedback));
        return true;
      } catch (storageError) {
        // Handle quota exceeded or other storage errors
        if (storageError.name === 'QuotaExceededError' || storageError.code === 22) {
          console.error('[STATE-PERSISTENCE] Storage quota exceeded, attempting cleanup');
          // Try to clear old data
          try {
            // Clear expired cache
            const oldTimestamp = localStorage.getItem(STORAGE_KEYS.TIMESTAMP);
            if (oldTimestamp) {
              const age = Date.now() - parseInt(oldTimestamp, 10);
              if (age > CACHE_EXPIRATION) {
                clearATSScore();
                // Retry save
                return saveATSScore({ score, breakdown: normalizedBreakdown, resumeId, jobTitle, roleSpecificFeedback });
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
   * @returns {Object|null} Score data or null if not found/expired/mismatched
   */
  function loadATSScore(currentJobTitle = null) {
    try {
      const timestamp = localStorage.getItem(STORAGE_KEYS.TIMESTAMP);
      if (!timestamp) {
        return null;
      }

      const age = Date.now() - parseInt(timestamp, 10);
      if (age > CACHE_EXPIRATION) {
        // Cache expired, clear it
        clearATSScore();
        return null;
      }

      const score = localStorage.getItem(STORAGE_KEYS.ATS_SCORE);
      const breakdownStr = localStorage.getItem(STORAGE_KEYS.ATS_BREAKDOWN);
      const resumeId = localStorage.getItem(STORAGE_KEYS.RESUME_ID);
      const cachedJobTitle = localStorage.getItem(STORAGE_KEYS.JOB_TITLE);
      const roleFeedback = localStorage.getItem(STORAGE_KEYS.ROLE_FEEDBACK);

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
        clearATSScore();
        return null;
      }
      
      // Validate breakdown structure
      if (!breakdown || typeof breakdown !== 'object') {
        console.warn('[STATE-PERSISTENCE] Invalid breakdown structure');
        clearATSScore();
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
          if (roleSpecificFeedback && !Array.isArray(roleSpecificFeedback) && 
              typeof roleSpecificFeedback === 'object' &&
              roleSpecificFeedback.targetRoleUsed === undefined) {
            // Invalid format - treat as null
            console.warn('[STATE-PERSISTENCE] Invalid role feedback format, ignoring');
            roleSpecificFeedback = null;
          }
        } catch (parseError) {
          console.warn('[STATE-PERSISTENCE] Failed to parse role feedback JSON:', parseError);
          // Continue without role feedback rather than failing completely
        }
      }

      return {
        score: parseFloat(score),
        breakdown: normalizedBreakdown,
        resumeId,
        jobTitle: cachedJobTitle || null,
        roleSpecificFeedback,
        timestamp: parseInt(timestamp, 10),
        cached: true
      };
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to load ATS score:', error);
      // Try to clear corrupted data
      try {
        clearATSScore();
      } catch (clearError) {
        console.error('[STATE-PERSISTENCE] Failed to clear corrupted data:', clearError);
      }
      return null;
    }
  }

  /**
   * Clear ATS score from localStorage
   */
  function clearATSScore() {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
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

