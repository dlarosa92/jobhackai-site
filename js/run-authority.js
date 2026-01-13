;(function () {
  'use strict';

  const STORAGE_KEY = 'jh_current_run_key';
  const DEBUG_ENABLED =
    Boolean(
      (window.JobHackAIDebug && window.JobHackAIDebug.runAuthority) ||
        window.__JOBHACKAI_RUN_AUTHORITY_DEBUG__
    );

  let activeAuthority = null;

  function normalizeRole(role = '') {
    return String(role || '').trim().toLowerCase();
  }

  function logDecision(message, details = {}) {
    if (!DEBUG_ENABLED || typeof window.console === 'undefined') return;
    try {
      console.debug('[RUN-AUTHORITY]', message, details);
    } catch (err) {
      // Swallow logging errors
    }
  }

  function persistRunKey(runKey) {
    if (!runKey) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, runKey);
    } catch (error) {
      console.warn('[RUN-AUTHORITY] Unable to persist run key', error);
    }
  }

  function setAuthority(runObj = {}) {
    if (!runObj || typeof runObj !== 'object') return;
    const normalizedRun = {
      runKey: runObj.runKey,
      resumeId: runObj.resumeId,
      role: normalizeRole(runObj.role),
      timestamp:
        typeof runObj.timestamp === 'number' && !Number.isNaN(runObj.timestamp)
          ? runObj.timestamp
          : Date.now(),
      source: runObj.source,
      score: runObj.score,
      breakdown: runObj.breakdown
    };

    activeAuthority = normalizedRun;
    persistRunKey(normalizedRun.runKey);
  }

  function getAuthority() {
    return activeAuthority;
  }

  function clearAuthority() {
    activeAuthority = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[RUN-AUTHORITY] Failed to clear storage key', error);
    }
  }

  function authorityMatches(resumeId, role) {
    if (!activeAuthority) return false;
    return (
      activeAuthority.resumeId === resumeId &&
      activeAuthority.role === normalizeRole(role)
    );
  }

  function ensureRunKey(runKey, fallbackLabel = 'run') {
    if (runKey && typeof runKey === 'string' && runKey.trim()) {
      return runKey;
    }
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${fallbackLabel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function tryApplyScore(candidate = {}, context = {}) {
    if (!candidate || typeof candidate !== 'object') {
      logDecision('reject_no_candidate', { context });
      return false;
    }

    const timestamp =
      typeof candidate.timestamp === 'number' && !Number.isNaN(candidate.timestamp)
        ? candidate.timestamp
        : Date.now();
    const normalizedRole = normalizeRole(candidate.role);
    const runKey = ensureRunKey(candidate.runKey, candidate.source || 'run');
    const source = candidate.source || 'live';
    const contextRole = context.role ? normalizeRole(context.role) : null;
    const contextResumeId = context.resumeId || null;

    if (contextResumeId && contextResumeId !== candidate.resumeId) {
      logDecision('reject_resume_mismatch', {
        runKey,
        source,
        resumeId: candidate.resumeId,
        contextResumeId
      });
      return false;
    }

    if (contextRole && normalizedRole && contextRole !== normalizedRole) {
      logDecision('reject_role_mismatch', {
        runKey,
        source,
        role: normalizedRole,
        contextRole
      });
      return false;
    }

    candidate.runKey = runKey;
    candidate.timestamp = timestamp;

    const promote = () => {
      setAuthority({ ...candidate, role: normalizedRole, timestamp });
    };

    if (activeAuthority) {
      if (activeAuthority.runKey === runKey) {
        logDecision('accept_same_run', {
          runKey,
          source,
          authoritySource: activeAuthority.source
        });
        promote();
        return true;
      }

      if (source === 'history_user') {
        logDecision('accept_history_user', {
          runKey,
          source,
          previousAuthority: activeAuthority.runKey
        });
        promote();
        return true;
      }

      if (source === 'live') {
        if (timestamp >= (activeAuthority.timestamp || 0)) {
          logDecision('accept_live_override', {
            runKey,
            source,
            overwrote: activeAuthority.runKey
          });
          promote();
          return true;
        }
        logDecision('reject_live_stale', {
          runKey,
          source,
          authorityTimestamp: activeAuthority.timestamp
        });
        return false;
      }

      logDecision('reject_conflict', {
        runKey,
        source,
        authorityRunKey: activeAuthority.runKey
      });
      return false;
    }

    logDecision('accept_new_authority', { runKey, source });
    promote();
    return true;
  }

  window.JobHackAIRunAuthority = {
    setAuthority,
    getAuthority,
    clearAuthority,
    authorityMatches,
    tryApplyScore,
    normalizeRole
  };
})();
