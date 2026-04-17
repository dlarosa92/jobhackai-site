// Shared page-level access control for protected pages
// Consolidates auth/plan gating logic previously duplicated across
// interview-questions.html and resume-feedback-pro.html.
// Version: 1.0.0
window.PageAccessControl = (function () {
  'use strict';

  var VALID_PLANS = ['visitor', 'free', 'trial', 'essential', 'pro', 'premium'];
  var PAID_PLANS  = ['trial', 'essential', 'pro', 'premium'];

  // ---- helpers ----

  function waitForGlobal(name, timeout) {
    if (window[name]) return Promise.resolve(true);
    var deadline = Date.now() + timeout;
    return new Promise(function (resolve) {
      var interval = setInterval(function () {
        if (window[name] || Date.now() >= deadline) {
          clearInterval(interval);
          resolve(!!window[name]);
        }
      }, 50);
    });
  }

  // ---- plan utilities ----

  function getVerifiedCachedPlan(allowedPlans) {
    allowedPlans = allowedPlans || PAID_PLANS;
    var verifiedPlan = window.__JOBHACKAI_VERIFIED_PLAN__;
    if (window.__JOBHACKAI_ACCESS_VERIFIED__ && allowedPlans.indexOf(verifiedPlan) !== -1) {
      return verifiedPlan;
    }
    var cachedPlan = localStorage.getItem('user-plan');
    return window.__JOBHACKAI_ACCESS_VERIFIED__ && allowedPlans.indexOf(cachedPlan) !== -1
      ? cachedPlan
      : null;
  }

  function getCurrentUserPlan(allowedPlans, logPrefix) {
    allowedPlans = allowedPlans || PAID_PLANS;
    logPrefix = logPrefix || '[PAGE-ACCESS]';
    var verifiedCachedPlan = getVerifiedCachedPlan(allowedPlans);

    var plan = 'free';
    if (window.JobHackAINavigation && typeof window.JobHackAINavigation.getEffectivePlan === 'function') {
      plan = window.JobHackAINavigation.getEffectivePlan();
      // Prefer verifiedCachedPlan when navigation hasn't hydrated (undefined/visitor)
      // OR when nav reports 'free' but access has already been verified against a
      // paid plan — the head guard's verified plan is authoritative and nav may
      // transiently report 'free' during hydration, causing a Free-state flash.
      // deferredPlanReVerify + the 'planChanged' event will downgrade later if
      // the plan truly changed (e.g. expired trial).
      if (!plan || plan === 'undefined' || plan === 'visitor') {
        plan = verifiedCachedPlan || localStorage.getItem('user-plan') || 'free';
      } else if (plan === 'free' && verifiedCachedPlan) {
        plan = verifiedCachedPlan;
      }
    } else {
      plan = verifiedCachedPlan || localStorage.getItem('user-plan') || 'free';
    }

    // Validate plan value to prevent corrupted data (e.g., "central")
    if (VALID_PLANS.indexOf(plan) === -1) {
      var oldPlan = plan;
      console.warn(logPrefix, 'Invalid plan detected:', plan, '- resetting to free');
      plan = 'free';
      localStorage.setItem('user-plan', 'free');
      var devPlan = localStorage.getItem('dev-plan');
      if (devPlan && VALID_PLANS.indexOf(devPlan) === -1) {
        localStorage.setItem('dev-plan', 'free');
      }
      console.log(logPrefix, 'Plan cleanup completed:', {
        oldPlan: oldPlan,
        newPlan: 'free',
        localStoragePlan: localStorage.getItem('user-plan'),
        devPlan: localStorage.getItem('dev-plan')
      });
    }

    return plan;
  }

  // ---- deferred re-verification ----

  // When the head guard granted access via the sync fast path (localStorage only),
  // schedule an async API check to catch stale/expired plans.
  var _deferredReVerifyScheduled = false;

  // opts.allowedPlans  – array of plan slugs that grant access (default PAID_PLANS)
  // opts.onPlanChanged – callback(newPlan) when API reports a different (still valid) plan
  // opts.logPrefix     – string prefix for console messages
  function deferredPlanReVerify(opts) {
    if (_deferredReVerifyScheduled) return;
    _deferredReVerifyScheduled = true;
    opts = opts || {};
    var allowedPlans = opts.allowedPlans || PAID_PLANS;
    var logPrefix    = opts.logPrefix || '[PAGE-ACCESS]';

    setTimeout(async function () {
      try {
        if (!window.JobHackAINavigation) return;
        if (typeof window.JobHackAINavigation.fetchPlanFromAPI !== 'function') return;
        var apiPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
        if (!apiPlan) return;
        if (allowedPlans.indexOf(apiPlan) === -1) {
          console.warn(logPrefix, 'Deferred re-verify: plan is now', apiPlan, '— revoking access');
          window.__JOBHACKAI_ACCESS_VERIFIED__ = false;
          window.__JOBHACKAI_VERIFIED_PLAN__ = null;
          window.location.href = opts.deniedRedirect || 'pricing-a.html?plan=essential';
        } else if (apiPlan !== window.__JOBHACKAI_VERIFIED_PLAN__) {
          console.log(logPrefix, 'Deferred re-verify: updating verified plan to', apiPlan);
          window.__JOBHACKAI_VERIFIED_PLAN__ = apiPlan;
          if (typeof opts.onPlanChanged === 'function') opts.onPlanChanged(apiPlan);
          window.dispatchEvent(new CustomEvent('planChanged', { detail: { plan: apiPlan } }));
        }
      } catch (e) {
        console.warn(logPrefix, 'Deferred re-verify error:', e);
      }
    }, 2000);
  }

  // ---- page access enforcement ----

  // opts.allowedPlans  – array of plan slugs that grant access (default PAID_PLANS)
  // opts.onPlanChanged – forwarded to deferredPlanReVerify
  // opts.logPrefix     – string prefix for console messages
  async function enforceAccess(opts) {
    opts = opts || {};
    var allowedPlans = opts.allowedPlans || PAID_PLANS;
    var logPrefix    = opts.logPrefix || '[PAGE-ACCESS]';

    // Fast path: head guard already verified
    if (window.__JOBHACKAI_ACCESS_VERIFIED__) {
      console.log(logPrefix, 'enforceAccess: head guard set flag, scheduling deferred re-verification');
      deferredPlanReVerify(opts);
      return;
    }

    // Wait for head guard async path to complete before checking independently.
    // Head guard awaits FirebaseAuthManager (3s) + waitForAuthReady (5s) + API fetch,
    // so allow up to 10s for it to set __JOBHACKAI_ACCESS_VERIFIED__.
    var waited = 0;
    while (!window.__JOBHACKAI_ACCESS_VERIFIED__ && waited < 10000) {
      await new Promise(function (r) { setTimeout(r, 200); });
      waited += 200;
    }
    if (window.__JOBHACKAI_ACCESS_VERIFIED__) {
      console.log(logPrefix, 'enforceAccess: head guard verified after', waited, 'ms');
      deferredPlanReVerify(opts);
      return;
    }

    // Head guard timed out or denied — do independent fallback check
    var isAuthenticated, plan;

    if (window.JobHackAINavigation) {
      var authState = window.JobHackAINavigation.getAuthState();
      isAuthenticated = authState && authState.isAuthenticated;
      plan = window.JobHackAINavigation.getEffectivePlan();
    } else {
      var hasLocalStorageAuth = localStorage.getItem('user-authenticated') === 'true';
      var hasFirebaseKeys = Object.keys(localStorage).some(function (k) {
        return k.startsWith('firebase:authUser:') &&
          localStorage.getItem(k) &&
          localStorage.getItem(k) !== 'null' &&
          localStorage.getItem(k).length > 10;
      });
      // SECURITY: Require BOTH signals (matches head fast path + static-auth-guard.js)
      isAuthenticated = hasLocalStorageAuth && hasFirebaseKeys;
      plan = localStorage.getItem('user-plan') || 'free';
    }

    if (!isAuthenticated || allowedPlans.indexOf(plan) === -1) {
      if (!isAuthenticated) {
        window.location.href = 'login.html';
      } else {
        window.location.href = opts.deniedRedirect || 'pricing-a.html?plan=essential';
      }
    } else {
      window.__JOBHACKAI_ACCESS_VERIFIED__ = true;
      window.__JOBHACKAI_VERIFIED_PLAN__ = plan;
      document.documentElement.classList.remove('auth-pending');
      document.documentElement.classList.remove('plan-pending');
      console.log(logPrefix, 'enforceAccess: fallback granted access, flag set');
      deferredPlanReVerify(opts);
    }
  }

  return {
    VALID_PLANS: VALID_PLANS,
    PAID_PLANS: PAID_PLANS,
    waitForGlobal: waitForGlobal,
    getVerifiedCachedPlan: getVerifiedCachedPlan,
    getCurrentUserPlan: getCurrentUserPlan,
    deferredPlanReVerify: deferredPlanReVerify,
    enforceAccess: enforceAccess
  };
})();
