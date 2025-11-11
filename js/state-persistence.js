/**
 * JobHackAI State Persistence Utility
 * Persists ATS scores and resume data across page loads
 */

(function() {
  'use strict';

  const STORAGE_KEYS = {
    ATS_SCORE: 'jh_last_ats_score',
    ATS_BREAKDOWN: 'jh_last_ats_breakdown',
    RESUME_ID: 'jh_last_resume_id',
    RESUME_TEXT: 'jh_last_resume_text',
    RESUME_IS_MULTI_COLUMN: 'jh_last_resume_is_multi_column',
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
   */
  function saveATSScore({ score, breakdown, resumeId, jobTitle }) {
    try {
      const data = {
        score,
        breakdown,
        resumeId,
        jobTitle,
        timestamp: Date.now()
      };

      localStorage.setItem(STORAGE_KEYS.ATS_SCORE, score.toString());
      localStorage.setItem(STORAGE_KEYS.ATS_BREAKDOWN, JSON.stringify(breakdown));
      localStorage.setItem(STORAGE_KEYS.RESUME_ID, resumeId);
      if (jobTitle) {
        localStorage.setItem(STORAGE_KEYS.JOB_TITLE, jobTitle);
      }
      localStorage.setItem(STORAGE_KEYS.TIMESTAMP, data.timestamp.toString());

      console.log('[STATE-PERSISTENCE] Saved ATS score:', score);
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to save ATS score:', error);
    }
  }

  /**
   * Load ATS score from localStorage
   * @returns {Object|null} Score data or null if not found/expired
   */
  function loadATSScore() {
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
      const breakdown = localStorage.getItem(STORAGE_KEYS.ATS_BREAKDOWN);
      const resumeId = localStorage.getItem(STORAGE_KEYS.RESUME_ID);
      const jobTitle = localStorage.getItem(STORAGE_KEYS.JOB_TITLE);

      if (!score || !breakdown || !resumeId) {
        return null;
      }

      return {
        score: parseFloat(score),
        breakdown: JSON.parse(breakdown),
        resumeId,
        jobTitle: jobTitle || null,
        timestamp: parseInt(timestamp, 10),
        cached: true
      };
    } catch (error) {
      console.warn('[STATE-PERSISTENCE] Failed to load ATS score:', error);
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
   * @param {boolean} [data.isMultiColumn] - Whether resume is multi-column format
   */
  function saveResumeData({ resumeId, resumeText, isMultiColumn }) {
    try {
      sessionStorage.setItem('currentResumeId', resumeId);
      if (resumeText) {
        sessionStorage.setItem('currentResumeText', resumeText);
      }
      if (isMultiColumn !== undefined) {
        sessionStorage.setItem('currentResumeIsMultiColumn', String(isMultiColumn));
        localStorage.setItem(STORAGE_KEYS.RESUME_IS_MULTI_COLUMN, String(isMultiColumn));
      }
      localStorage.setItem(STORAGE_KEYS.RESUME_ID, resumeId);
      console.log('[STATE-PERSISTENCE] Saved resume data:', resumeId, isMultiColumn !== undefined ? `(isMultiColumn: ${isMultiColumn})` : '');
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
      const isMultiColumnStr = sessionStorage.getItem('currentResumeIsMultiColumn') || localStorage.getItem(STORAGE_KEYS.RESUME_IS_MULTI_COLUMN);
      const isMultiColumn = isMultiColumnStr !== null ? isMultiColumnStr === 'true' : undefined;

      if (!resumeId) {
        return null;
      }

      return {
        resumeId,
        resumeText: resumeText || null,
        isMultiColumn
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

