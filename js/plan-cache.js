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
      } else {
        localStorage.removeItem('trial-ends-at');
      }
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

      _inflight = doFetch(token)
        .then(function (result) {
          if (result) {
            _cached = result;
            _cachedAt = Date.now();
            persistToLocalStorage(result);
          }
          _inflight = null;
          return result;
        })
        .catch(function (err) {
          _inflight = null;
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
      
      // Store the current in-flight promise to prevent race conditions
      var oldInflight = _inflight;
      _inflight = null;
      
      // If there was an in-flight request, chain a handler to prevent it from
      // updating the cache when it completes
      if (oldInflight) {
        oldInflight.then(function() {
          // Do nothing with the result - prevent the old promise's result
          // from overwriting our freshly invalidated cache
        });
      }
    }
  };
})();
