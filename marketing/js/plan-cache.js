// Centralized plan cache with request deduplication.
// Every subsystem (firebase-auth.js, navigation.js, page-access-control.js,
// dashboard.tsx) MUST fetch the user plan through window.PlanCache to avoid
// redundant /api/plan/me calls. The cache deduplicates in-flight requests
// and keeps results fresh for CACHE_TTL milliseconds.
(function () {
  'use strict';

  var _cached = null;   // { plan, trialEndsAt }
  var _cachedAt = 0;
  var _inflight = null; // Promise | null
  var _generation = 0;  // Incremented on invalidate to discard stale in-flight results
  var CACHE_TTL = 30000; // 30 seconds

  function doFetch(token) {
    return fetch('/api/plan/me', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (data) {
        return { plan: (data && data.plan) || null, trialEndsAt: (data && data.trialEndsAt) || null };
      });
    });
  }

  function persistToLocalStorage(result) {
    if (!result) return;
    try {
      localStorage.setItem('user-plan', result.plan || 'free');
      if (result.trialEndsAt) {
        localStorage.setItem('trial-ends-at', result.trialEndsAt);
      }
      // Do NOT remove trial-ends-at when absent — a previous API call
      // may have set it correctly and callers like billing-status fallback
      // may not have trialEndsAt available.
    } catch (_) { /* localStorage may be unavailable */ }
  }

  window.PlanCache = {
    // Main entry point. Returns { plan, trialEndsAt } or null.
    // Deduplicates concurrent calls automatically.
    getPlan: function (token, forceRefresh) {
      if (!token) return Promise.resolve(null);

      // Return cached result if still fresh
      if (!forceRefresh && _cached && (Date.now() - _cachedAt) < CACHE_TTL) {
        return Promise.resolve(_cached);
      }

      // Deduplicate in-flight requests — all callers share the same promise
      if (_inflight) return _inflight;

      var gen = ++_generation;
      _inflight = doFetch(token)
        .then(function (result) {
          if (gen === _generation && result) {
            _cached = result;
            _cachedAt = Date.now();
            persistToLocalStorage(result);
          }
          if (gen === _generation) _inflight = null;
          return result;
        })
        .catch(function (err) {
          if (gen === _generation) _inflight = null;
          console.warn('[PlanCache] fetch failed:', err);
          return null;
        });

      return _inflight;
    },

    // Read-only access to the last fetched value (no network call).
    getCachedPlan: function () {
      return _cached;
    },

    // Manually seed the cache (e.g. after checkout redirect sets plan via
    // billing-status). Prevents a redundant /api/plan/me round-trip.
    setCachedPlan: function (plan, trialEndsAt) {
      _cached = { plan: plan, trialEndsAt: trialEndsAt || null };
      _cachedAt = Date.now();
      persistToLocalStorage(_cached);
    },

    // Clear cache so the next getPlan() will hit the network.
    // Call after checkout, plan upgrade/downgrade, or manual sync.
    invalidate: function () {
      _cached = null;
      _cachedAt = 0;
      _inflight = null;
      ++_generation; // Ensures any in-flight fetch won't overwrite cache when it resolves
    }
  };
})();
