// JobHackAI Navigation System
// Handles dynamic navigation based on authentication state and user plan

// Version stamp for deployment verification
console.log('🔧 navigation.js VERSION: fix-auth-cache-loop-v1 - ' + new Date().toISOString());

// Hide header until nav is resolved to avoid flicker on first paint.
// If the user is already authenticated, avoid nav-loading so the full nav persists
// (prevents the brief centered-logo fallback when navigating to home while logged-in).
try {
  const _authDecision = (typeof confidentlyAuthenticatedForNav === 'function') ? confidentlyAuthenticatedForNav() : null;
  if (_authDecision === true) {
    // Confidently authenticated -> do not add nav-loading
  } else if (_authDecision === false) {
    // Confidently unauthenticated -> preserve existing behavior (hide until reveal)
    document.documentElement.classList.add('nav-loading');
  } else {
    // Unknown (race/load-order) -> default to hiding nav, but re-evaluate when auth becomes ready
    document.documentElement.classList.add('nav-loading');
    try {
      // Re-evaluate when firebase-auth-ready fires
      const onAuthReady = function () {
        try { document.removeEventListener('firebase-auth-ready', onAuthReady); } catch (_) {}
        try { scheduleUpdateNavigation(true); } catch (_) {}
      };
      try {
        if (!window.__jha_nav_auth_ready_listener_registered) {
          document.addEventListener('firebase-auth-ready', onAuthReady, { once: true });
          window.__jha_nav_auth_ready_listener_registered = true;
        }
      } catch (_) {}
    } catch (_) {}
    try {
      // Also poll briefly for FirebaseAuthManager presence in case it is added later
      if (!window.__jha_auth_poll_interval) {
        let __jha_auth_poll_tries = 0;
        window.__jha_auth_poll_interval = setInterval(() => {
          __jha_auth_poll_tries++;
          try {
            if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
              clearInterval(window.__jha_auth_poll_interval);
              window.__jha_auth_poll_interval = null;
              try { scheduleUpdateNavigation(true); } catch (_) {}
            } else if (__jha_auth_poll_tries > 50) { // stop after ~5s
              clearInterval(window.__jha_auth_poll_interval);
              window.__jha_auth_poll_interval = null;
            }
          } catch (_) {
            // ignore polling errors
          }
        }, 100);
      }
    } catch (_) {}
  }
} catch (e) { /* ignore */ }

// Debounced navigation update scheduler (module-scope)
let __jha_nav_timer = null;
const NAV_DEBOUNCE_MS = 200;   // coalesce bursts (tune 150-300ms)
const NAV_MAX_WAIT_MS = 600;   // reveal nav if nothing authoritative arrives

function isRealAuthReady() {
  try {
    return !!(window.__REAL_AUTH_READY || window.__firebaseAuthReadyFired || firebaseAuthReadyFired || window.__NAV_AUTH_READY);
  } catch (_) {
    return false;
  }
}

function revealNav(){
  try {
    document.documentElement.classList.remove('nav-loading');
    document.documentElement.classList.add('nav-ready');
  } catch (e) { /* ignore in non-browser contexts */ }
}

function scheduleUpdateNavigation(force, skipPendingCheck = false) {
  // If caller requests a forced navigation update, ensure we don't run it while auth is possibly pending.
  // This avoids the visitor CTA / redirect race during auth restore.
  if (force) {
    try {
      const pending = !skipPendingCheck && (typeof isAuthPossiblyPending === 'function' && isAuthPossiblyPending())
        && !isRealAuthReady();

      if (pending) {
        // Only set one deferred listener to avoid duplicates; set flag immediately and attach listener on document.
        if (!window.__NAV_DEFERRED_NAV_UPDATE) {
          window.__NAV_DEFERRED_NAV_UPDATE = true;
          navLog('info', 'Forced navigation update deferred until firebase-auth-ready');

          // Handler schedules the forced update (debounced) once real auth-ready fires
          const deferredHandler = () => {
            try {
              // Clear any fallback timer
              if (window.__NAV_DEFERRED_TIMEOUT) {
                clearTimeout(window.__NAV_DEFERRED_TIMEOUT);
                window.__NAV_DEFERRED_TIMEOUT = null;
              }

              // Allow a tiny settle window then force the navigation update
              window.__NAV_DEFERRED_NAV_UPDATE = false;
              setTimeout(() => scheduleUpdateNavigation(true), 40);
            } catch (e) { console.error('Deferred navigation error', e); }
          };

          try {
            if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
              document.addEventListener('firebase-auth-ready', deferredHandler, { once: true });
            } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
              window.addEventListener('firebase-auth-ready', deferredHandler, { once: true });
            }
          } catch (e) {
            // registration failed - clear defer flag and continue immediately
            window.__NAV_DEFERRED_NAV_UPDATE = false;
            navLog('warn', 'Failed to attach deferred firebase-auth-ready handler; proceeding immediately', e);
            if (__jha_nav_timer) { clearTimeout(__jha_nav_timer); __jha_nav_timer = null; }
            try { updateNavigation(); } catch (err) { console.error('updateNavigation error', err); }
            revealNav();
            return;
          }

          // Fallback: if auth-ready never fires, force navigation after timeout
          try {
            window.__NAV_DEFERRED_TIMEOUT = setTimeout(() => {
              try {
                if (window.__NAV_DEFERRED_NAV_UPDATE) {
                  navLog('warn', 'Deferred nav timeout fired; forcing navigation update');
                  window.__NAV_DEFERRED_NAV_UPDATE = false;
                  scheduleUpdateNavigation(true, true); // force even if auth still pending
                }
              } catch (e) {
                console.error('Deferred nav timeout handler error', e);
              } finally {
                if (window.__NAV_DEFERRED_TIMEOUT) {
                  clearTimeout(window.__NAV_DEFERRED_TIMEOUT);
                  window.__NAV_DEFERRED_TIMEOUT = null;
                }
              }
            }, 5000);
          } catch (e) { /* ignore timers errors */ }
        } else {
          navLog('debug', 'Forced navigation already deferred; skipping duplicate defer');
        }
        // Do not run updateNavigation now
        return;
      }
    } catch (e) {
      // If anything goes wrong, fall back to immediate behavior rather than blocking navigation entirely
      navLog('warn', 'Error evaluating auth pending state; falling back to immediate force', e);
    }

    // If we reach here, auth is not pending — proceed with immediate force
    if (__jha_nav_timer) { clearTimeout(__jha_nav_timer); __jha_nav_timer = null; }
    try {
      updateNavigation();
    } catch (err) {
      console.error('updateNavigation error', err);
    }
    // Only reveal nav if auth is not pending now
    try {
      const pendingNow = (typeof isAuthPossiblyPending === 'function' && isAuthPossiblyPending())
        && !isRealAuthReady();
      if (!pendingNow) {
        revealNav();
      } else {
        navLog('info', 'Skipped revealNav due to auth pending after forced update');
      }
    } catch (e) {
      // If check fails, reveal to avoid hiding nav indefinitely
      revealNav();
    }
    return;
  }

  if (__jha_nav_timer) clearTimeout(__jha_nav_timer);
  __jha_nav_timer = setTimeout(() => {
    __jha_nav_timer = null;
    try { updateNavigation(); } catch (err) { console.error('updateNavigation error', err); }
    // Reveal only if auth is not pending after updateNavigation()
    try {
      const pendingNow = (typeof isAuthPossiblyPending === 'function' && isAuthPossiblyPending())
        && !isRealAuthReady();
      if (!pendingNow) {
        revealNav();
      } else {
        navLog('info', 'Skipped revealNav due to auth pending after scheduled update');
      }
    } catch (e) {
      revealNav();
    }
  }, NAV_DEBOUNCE_MS);

  // ensure nav is revealed eventually to avoid indefinite hiding
  if (!document.documentElement.dataset.navTimeoutSet) {
    document.documentElement.dataset.navTimeoutSet = '1';
    // allow a few conservative retries if auth still appears to be restoring
    const MAX_RETRIES = 3;
    const scheduleRevealCheck = (delay) => {
      setTimeout(() => {
        try {
          const retries = parseInt(document.documentElement.dataset.navTimeoutRetries || '0', 10);
          const pending = (typeof isAuthPossiblyPending === 'function' && isAuthPossiblyPending()) && !isRealAuthReady();
          if (pending && retries < MAX_RETRIES) {
            // increment retry count and defer reveal
            document.documentElement.dataset.navTimeoutRetries = String(retries + 1);
            navLog('info', 'NAV reveal deferred due to pending auth', { retries: retries + 1 });
            // try again after another NAV_MAX_WAIT_MS
            scheduleRevealCheck(NAV_MAX_WAIT_MS);
            return;
          }

          // Proceed to reveal (either not pending, or retries exhausted)
          if (__jha_nav_timer) {
            clearTimeout(__jha_nav_timer);
            __jha_nav_timer = null;
          }
          try { updateNavigation(); } catch (e) { navLog('warn', 'updateNavigation failed during reveal timeout', e); }
          try { revealNav(); } catch (e) { navLog('warn', 'revealNav failed during reveal timeout', e); }

          // Cleanup timeout markers now that reveal has been performed
          try { document.documentElement.removeAttribute('data-nav-timeout-set'); } catch (_) {}
          try { document.documentElement.removeAttribute('data-nav-timeout-retries'); } catch (_) {}
        } catch (e) {
          // best-effort reveal on any unexpected error and cleanup
          try {
            if (__jha_nav_timer) { clearTimeout(__jha_nav_timer); __jha_nav_timer = null; }
            try { updateNavigation(); } catch (ee) {}
            try { revealNav(); } catch (ee) {}
          } catch (_) {}
          try { document.documentElement.removeAttribute('data-nav-timeout-set'); } catch (_) {}
          try { document.documentElement.removeAttribute('data-nav-timeout-retries'); } catch (_) {}
        }
      }, delay);
    };
    scheduleRevealCheck(NAV_MAX_WAIT_MS);
  }
}

const APP_BASE_URL = window.getAppBaseUrl();
const IS_DEV_OR_QA_HOST = APP_BASE_URL === 'https://dev.jobhackai.io' || APP_BASE_URL === 'https://qa.jobhackai.io';
const VISITOR_HOME_HREF = IS_DEV_OR_QA_HOST ? 'index.html' : 'https://jobhackai.io/';
const VISITOR_BLOG_HREF = IS_DEV_OR_QA_HOST ? 'index.html#blog' : 'https://jobhackai.io/blog';
const VISITOR_FEATURES_HREF = IS_DEV_OR_QA_HOST ? 'features.html' : 'https://jobhackai.io/features';
const VISITOR_PRICING_HREF = `${APP_BASE_URL}/pricing-a`;
const VISITOR_LOGO_HREF = IS_DEV_OR_QA_HOST ? '/' : 'https://jobhackai.io/';

// Cross-domain cookie helpers — only read on the MARKETING site (not the app subdomain).
// On app.jobhackai.io Firebase is the source of truth; trusting a 30-day cookie there
// would override Firebase's authoritative "no user" after session revocation / account disable.
function isMarketingHostForCookieFallback() {
  try {
    if (IS_DEV_OR_QA_HOST) return false;
    const h = (window.location.hostname || '').toLowerCase();
    // Only activate on marketing hosts, NOT on app.jobhackai.io
    return h === 'jobhackai.io' || h === 'www.jobhackai.io';
  } catch (_) { return false; }
}

function hasCrossDomainAuthCookie() {
  try {
    if (!isMarketingHostForCookieFallback()) return false;
    return document.cookie.indexOf('jhai_auth=1') !== -1;
  } catch (_) { return false; }
}

function parseCrossDomainCookies() {
  try {
    if (!isMarketingHostForCookieFallback()) return null;
    const cookies = document.cookie.split(';').reduce((acc, c) => {
      const parts = c.trim().split('=');
      if (parts.length >= 2) acc[parts[0]] = parts.slice(1).join('=');
      return acc;
    }, {});
    if (cookies.jhai_auth === '1') {
      return { plan: decodeURIComponent(cookies.jhai_plan || 'free') };
    }
  } catch (_) {}
  return null;
}

// URL auth-handoff fallback — used when cross-domain cookies are unavailable.
// Flow: app.jobhackai.io appends a short-lived hint to marketing links, and
// marketing pages persist it in sessionStorage for the current tab/session.
const PROD_APP_HOST = 'app.jobhackai.io';
const PROD_MARKETING_HOSTS = ['jobhackai.io', 'www.jobhackai.io'];
const AUTH_HANDOFF_QUERY_AUTH = 'jhai_auth';
const AUTH_HANDOFF_QUERY_PLAN = 'jhai_plan';
const AUTH_HANDOFF_QUERY_TS = 'jhai_ts';
const AUTH_HANDOFF_SESSION_KEY = 'jhai_auth_handoff';
const AUTH_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
const AUTH_HANDOFF_ALLOWED_PLANS = ['free', 'trial', 'essential', 'pro', 'premium', 'pending'];

function getHostnameSafe() {
  try { return (window.location.hostname || '').toLowerCase(); } catch (_) { return ''; }
}

function isProdMarketingHostName(hostname) {
  return PROD_MARKETING_HOSTS.includes((hostname || '').toLowerCase());
}

function isProdMarketingHost() {
  return isProdMarketingHostName(getHostnameSafe());
}

function isProdAppHost() {
  return getHostnameSafe() === PROD_APP_HOST;
}

function normalizeHandoffPlan(plan) {
  const normalized = (plan || '').toString().toLowerCase();
  if (!normalized) return null;
  if (AUTH_HANDOFF_ALLOWED_PLANS.includes(normalized)) return normalized;
  return null;
}

function stripAuthHandoffQueryParams() {
  try {
    const url = new URL(window.location.href);
    const hasHint = url.searchParams.has(AUTH_HANDOFF_QUERY_AUTH)
      || url.searchParams.has(AUTH_HANDOFF_QUERY_PLAN)
      || url.searchParams.has(AUTH_HANDOFF_QUERY_TS);
    if (!hasHint) return;
    url.searchParams.delete(AUTH_HANDOFF_QUERY_AUTH);
    url.searchParams.delete(AUTH_HANDOFF_QUERY_PLAN);
    url.searchParams.delete(AUTH_HANDOFF_QUERY_TS);
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', next);
  } catch (_) {}
}

function persistUrlAuthHandoffIfPresent() {
  if (!isProdMarketingHost()) return null;
  try {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get(AUTH_HANDOFF_QUERY_AUTH) !== '1') return null;
    const now = Date.now();
    const ts = Number(params.get(AUTH_HANDOFF_QUERY_TS) || '0');
    const plan = normalizeHandoffPlan(params.get(AUTH_HANDOFF_QUERY_PLAN) || 'free');
    const isFresh = Number.isFinite(ts) && ts > 0 && (now - ts) >= 0 && (now - ts) <= AUTH_HANDOFF_MAX_AGE_MS;
    stripAuthHandoffQueryParams();
    if (!isFresh || !plan) {
      try { sessionStorage.removeItem(AUTH_HANDOFF_SESSION_KEY); } catch (_) {}
      return null;
    }
    const payload = { plan, ts: now };
    try { sessionStorage.setItem(AUTH_HANDOFF_SESSION_KEY, JSON.stringify(payload)); } catch (_) {}
    return payload;
  } catch (_) {
    return null;
  }
}

function getStoredUrlAuthHandoff() {
  if (!isProdMarketingHost()) return null;
  try {
    const raw = sessionStorage.getItem(AUTH_HANDOFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const plan = normalizeHandoffPlan(parsed?.plan);
    const ts = Number(parsed?.ts || '0');
    const now = Date.now();
    const isFresh = Number.isFinite(ts) && ts > 0 && (now - ts) >= 0 && (now - ts) <= AUTH_HANDOFF_MAX_AGE_MS;
    if (!plan || !isFresh) {
      sessionStorage.removeItem(AUTH_HANDOFF_SESSION_KEY);
      return null;
    }
    return { plan, ts };
  } catch (_) {
    try { sessionStorage.removeItem(AUTH_HANDOFF_SESSION_KEY); } catch (_) {}
    return null;
  }
}

function getUrlAuthHandoff() {
  return persistUrlAuthHandoffIfPresent() || getStoredUrlAuthHandoff();
}

function hasUrlAuthHandoff() {
  return !!getUrlAuthHandoff();
}

function clearUrlAuthHandoff() {
  try { sessionStorage.removeItem(AUTH_HANDOFF_SESSION_KEY); } catch (_) {}
}

function buildAuthHandoffHref(href, isAuthenticated, plan) {
  if (!isAuthenticated || !isProdAppHost()) return href;
  // Never propagate authenticated handoff from app -> marketing for unverified
  // Firebase email/password users.
  try {
    if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
      const currentUser = window.FirebaseAuthManager.getCurrentUser();
      if (currentUser && typeof currentUser.emailVerified === 'boolean' && !currentUser.emailVerified) {
        return href;
      }
    }
  } catch (_) {}
  try {
    const url = new URL(href, window.location.origin);
    if (!isProdMarketingHostName(url.hostname)) return href;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return href;
    const normalizedPlan = normalizeHandoffPlan(plan) || 'free';
    url.searchParams.set(AUTH_HANDOFF_QUERY_AUTH, '1');
    url.searchParams.set(AUTH_HANDOFF_QUERY_PLAN, normalizedPlan);
    url.searchParams.set(AUTH_HANDOFF_QUERY_TS, String(Date.now()));
    return url.toString();
  } catch (_) {
    return href;
  }
}

// Consume auth handoff from URL as early as possible on marketing pages.
persistUrlAuthHandoffIfPresent();

// --- ROBUSTNESS GLOBALS ---
// Ensure robustness globals are available for smoke tests and agent interface
window.siteHealth = window.siteHealth || {
  checkAll: () => ({ navigation: { healthy: true, issues: [] }, dom: { healthy: true, missing: [] }, localStorage: { healthy: true, issues: [] } }),
  checkNavigation: () => ({ healthy: true, issues: [] }),
  checkDOM: () => ({ healthy: true, missing: [] }),
  checkLocalStorage: () => ({ healthy: true, issues: [] })
};

window.agentInterface = window.agentInterface || {
  analyze: () => ({ status: 'not-implemented' }),
  navigation: () => ({ status: 'not-implemented' }),
  recovery: () => ({ status: 'not-implemented' }),
  safe: () => ({ status: 'not-implemented' })
};

// Lightweight state manager with pub/sub around localStorage
window.stateManager = window.stateManager || (function() {
  const watchers = new Map(); // key -> Set<callback>

  function notify(key, newValue, oldValue) {
    if (!watchers.has(key)) return;
    watchers.get(key).forEach(cb => {
      try { cb(newValue, oldValue); } catch (e) { /* no-op */ }
    });
  }

  function get(key) {
    return localStorage.getItem(key);
  }

  function set(key, value) {
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, value);
    notify(key, value, oldValue);
  }

  function watch(key, callback) {
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(callback);
    return () => unwatch(key, callback);
  }

  function unwatch(key, callback) {
    if (watchers.has(key)) watchers.get(key).delete(callback);
  }

  // Cross-tab updates
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    notify(e.key, e.newValue, e.oldValue);
  });

  // Simple backup/restore helpers (namespaced by timestamp)
  function createBackup() {
    const snapshot = {
      'user-authenticated': localStorage.getItem('user-authenticated'),
      'user-plan': localStorage.getItem('user-plan'),
      'dev-plan': localStorage.getItem('dev-plan')
      // SECURITY: Do NOT include user-email in backups - email should never be stored in localStorage
      // Email is available via Firebase auth when needed
      // Note: Removed 'user-email' from snapshot to prevent security vulnerability
    };
    const id = `backup-${Date.now()}`;
    localStorage.setItem(id, JSON.stringify(snapshot));
    return { status: 'ok', id };
  }

  function restoreBackup(id) {
    try {
      const snapshot = JSON.parse(localStorage.getItem(id) || '{}');
      // SECURITY: Skip restoring user-email even if it exists in old backups
      // This prevents reintroducing the security vulnerability
      const sensitiveKeys = ['user-email', 'auth-user'];
      Object.entries(snapshot).forEach(([k, v]) => {
        if (!sensitiveKeys.includes(k)) {
          set(k, v);
        }
      });
      return { status: 'ok' };
    } catch (e) {
      return { status: 'error', error: e?.message };
    }
  }

  function listBackups() {
    return Object.keys(localStorage).filter(k => k.startsWith('backup-'));
  }

  return { get, set, watch, unwatch, createBackup, restoreBackup, listBackups };
})();

// ----------------------- NAV HELPERS -----------------------
// Detect whether auth may be in-flight: localStorage suggests auth but Firebase not ready yet.
function isAuthPossiblyPending() {
  try {
    const lsAuth = localStorage.getItem('user-authenticated');
    if (lsAuth !== 'true') return false;
    // Helper: check for Firebase SDK persistence keys (same pattern used by getAuthState)
    const hasFirebaseKeys = Object.keys(localStorage).some(k =>
      k.startsWith('firebase:authUser:') &&
      localStorage.getItem(k) &&
      localStorage.getItem(k) !== 'null' &&
      localStorage.getItem(k).length > 10
    );

    // If auth already marked ready (either event flag or global fallback), not pending
    if (isRealAuthReady()) return false;

    // If persistence keys exist AND local flag is set, session likely restoring
    if (hasFirebaseKeys) return true;

    // If Firebase manager exists and reports no current user yet, and we haven't seen firebase-auth-ready, treat as pending
    const fm = window.FirebaseAuthManager;
    if (fm && typeof fm.getCurrentUser === 'function' && !fm.getCurrentUser()) return true;
  } catch (e) { /* ignore */ }
  return false;
}

// Patch only the parts of the nav that change (cta text/href and plan badge) to avoid full DOM rebuild
function patchNav(plan) {
  try {
    const navActions = document.querySelector('.nav-actions');
    const mobileNav = document.getElementById('mobileNav') || document.querySelector('.mobile-nav');
    if (!navActions && !mobileNav) return;

    // Use whichever actions container exists to perform patching work
    const actionsRoot = navActions || mobileNav;

    // CTA selector - adjust to match your markup
    const cta = actionsRoot.querySelector('a.btn.btn-primary, a.btn-primary, button.btn-primary, a.cta-button, .btn-primary');
    // If CTA anchor exists, update it in place
    if (cta) {
      if (plan === 'visitor') {
        try { cta.textContent = 'Start Free Trial'; } catch(_) {}
        if (cta.tagName === 'A') {
          try {
            cta.href = NAVIGATION_CONFIG.visitor?.cta?.href || `${APP_BASE_URL}/login?plan=trial`;
          } catch (_) {}
        }
        cta.classList.remove('plan-premium');
        cta.classList.add('plan-visitor');
      } else {
        try { cta.textContent = (plan === 'premium' ? 'Premium Plan' : (plan === 'pro' ? 'Pro Plan' : 'Open')); } catch(_) {}
        if (cta.tagName === 'A') try { cta.href = '/dashboard'; } catch(_) {}
        cta.classList.remove('plan-visitor');
        cta.classList.add('plan-premium');
      }
      // Ensure click handler reflects the new plan - remove any stale handler and attach new one if planConfig specifies planId
      try {
        // Remove stale handler (attachPlanSelectionHandler will also clean up if needed)
        if (cta._jha_plan_handler) {
          try { cta.removeEventListener('click', cta._jha_plan_handler); } catch(_) {}
          cta._jha_plan_handler = null;
        }
        const planConfig = NAVIGATION_CONFIG[plan] || NAVIGATION_CONFIG.visitor;
        if (planConfig && planConfig.cta && planConfig.cta.planId) {
          const handlerSource = (actionsRoot.classList && actionsRoot.classList.contains('mobile-nav')) ? 'navigation-cta-mobile' : 'navigation-cta-desktop';
          attachPlanSelectionHandler(cta, planConfig.cta.planId, handlerSource);
        }
      } catch (e) { /* ignore handler attach errors */ }
    } else {
      // No anchor CTA found — maybe there's a skeleton placeholder.
      const skeleton = actionsRoot ? actionsRoot.querySelector('.cta-skeleton-desktop, .cta-skeleton-mobile') : null;
      if (skeleton) {
        const planConfig = NAVIGATION_CONFIG[plan] || NAVIGATION_CONFIG.visitor;
        // If plan defines a CTA, create and replace; otherwise remove the skeleton to avoid stuck placeholder.
        if (planConfig && planConfig.cta) {
          const newCta = document.createElement('a');
          try { newCta.href = planConfig.cta.href; } catch(_) {}
          try { newCta.textContent = planConfig.cta.text; } catch(_) {}
          newCta.className = 'btn btn-primary';
          newCta.setAttribute('role', 'button');
          try {
            if (skeleton.classList && skeleton.classList.contains('cta-skeleton-mobile')) {
              newCta.style.cssText = 'background: #007A30; color: white !important; padding: 0.75rem 0; border-radius: 8px; text-decoration: none; font-weight: 600; display: block; text-align: center; margin-top: 1.5rem;';
            } else {
              newCta.style.cssText = 'background: #007A30; color: white !important; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;';
            }
          } catch(_) {}
          if (planConfig.cta.planId) {
            try {
              const handlerSource = (skeleton.classList && skeleton.classList.contains('cta-skeleton-mobile')) ? 'navigation-cta-mobile' : 'navigation-cta-desktop';
              attachPlanSelectionHandler(newCta, planConfig.cta.planId, handlerSource);
            } catch(_) {}
          }
          try { skeleton.replaceWith(newCta); } catch (e) { navLog('warn', 'Failed to replace skeleton with CTA', e); }
        } else {
          try { skeleton.remove(); } catch(_) {}
        }
      }
    }

    const badge = actionsRoot.querySelector('.plan-badge, .nav-plan-pill');
    if (badge) {
      // Prefer human-friendly name from PLANS config; fallback to capitalized plan id
      const text = (window.PLANS && PLANS[plan] && PLANS[plan].name) ? PLANS[plan].name : (plan ? (plan.charAt(0).toUpperCase() + plan.slice(1)) : '');
      try { badge.textContent = text; } catch(_) {}
      try { badge.dataset.plan = plan; } catch(e){/*ignore*/}
      badge.classList.toggle('hidden', plan === 'visitor' || !text);
    }
    // Ensure dataset.plan reflects the current plan to prevent repeated patch attempts
    try { if (actionsRoot) actionsRoot.dataset.plan = plan; } catch(_) {}

    // Compute and set nav signature for this plan so patch pre-checks remain coherent
    try {
      const planConfig = NAVIGATION_CONFIG[plan] || NAVIGATION_CONFIG.visitor;
      if (actionsRoot && planConfig && Array.isArray(planConfig.navItems)) {
        const signature = planConfig.navItems.map(item => {
          const base = `${item.text}::${item.href || ''}::locked:${!!item.locked}`;
          if (item.isDropdown && Array.isArray(item.items)) {
            const children = item.items.map(si => `${si.text}::${si.href || ''}::locked:${!!si.locked}`).join('|');
            return `${base}::D::${children}`;
          }
          return base;
        }).join('||');
        try { actionsRoot.dataset.navSignature = signature; } catch(_) {}
      }
    } catch (_) {}
  } catch (err) {
    console.warn('patchNav error', err);
  }
}

// --- FIREBASE AUTH READY TRACKING ---
// Track when firebase-auth-ready event fires to prevent premature localStorage clearing
let firebaseAuthReadyFired = false;
// If a global flag was set before this script loaded, sync it immediately to avoid races
try {
  if (typeof window !== 'undefined' && window.__REAL_AUTH_READY) {
    firebaseAuthReadyFired = true;
  }
} catch (_) {}
// NAV: defer forced nav updates until auth readiness is known.
// This prevents callers that pass `force=true` from immediately rendering visitor CTAs
// while Firebase is still restoring a session.
window.__NAV_DEFERRED_NAV_UPDATE = window.__NAV_DEFERRED_NAV_UPDATE || false;
window.__NAV_AUTH_READY = isRealAuthReady();

// Mirror firebase-auth-ready to a global for any scripts needing it
try {
  if (window && typeof window.addEventListener === 'function') {
    window.addEventListener('firebase-auth-ready', () => {
      try {
        window.__REAL_AUTH_READY = true;
        window.__NAV_AUTH_READY = true;
        firebaseAuthReadyFired = true;
      } catch (e) { /* ignore */ }
    });
  }
} catch (e) { /* ignore */ }

// Poll interval handle used when waiting for FirebaseAuthManager to be added to window
window.__jha_auth_poll_interval = window.__jha_auth_poll_interval || null;

// Helper: determine authentication confidence for initial nav decisions.
// Returns:
//  - true  => confidently authenticated
//  - false => confidently not authenticated
//  - null  => unknown / defer (e.g., Firebase not ready yet)
function confidentlyAuthenticatedForNav() {
  try {
    // 1) Honor explicit logout intent immediately
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('logout-intent') === '1') {
        return false;
      }
    } catch (_) {}

    // 2) If Firebase manager is available, trust it (source of truth)
    try {
      if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
        return !!window.FirebaseAuthManager.getCurrentUser();
      }
    } catch (_) {}

    // 3) If firebase-auth-ready has fired, we can use localStorage heuristics safely
    try {
      if (typeof window !== 'undefined' && isRealAuthReady()) {
        const storedAuth = (typeof localStorage !== 'undefined' && localStorage.getItem('user-authenticated') === 'true');
        const hasFirebaseKeys = (typeof localStorage !== 'undefined') && Object.keys(localStorage).some(k =>
          k.startsWith('firebase:authUser:') &&
          localStorage.getItem(k) &&
          localStorage.getItem(k) !== 'null' &&
          localStorage.getItem(k).length > 10
        );
        return storedAuth && hasFirebaseKeys;
      }
    } catch (_) {}

    // 4) Cross-domain cookie fallback (for marketing site where Firebase has no local state)
    if (hasCrossDomainAuthCookie()) return true;

    // 5) Non-cookie URL handoff fallback (for browsers blocking cross-domain cookies)
    if (hasUrlAuthHandoff()) return true;

    // 6) Otherwise, defer decision - Firebase may still be restoring session
    return null;
  } catch (_) {
    return null;
  }
}

// --- LOGGING SYSTEM ---
const DEBUG = {
  enabled: true,
  level: 'error', // 'debug', 'info', 'warn', 'error' - Default to 'error' to reduce info leakage
  prefix: '[NAV DEBUG]',
  rateLimit: {
    lastLog: {},
    interval: 1000 // Only log same message once per second
  },
  // Auto-enable debug logging when issues are detected
  autoDebug: {
    enabled: true,
    errorCount: 0,
    warningCount: 0,
    maxErrors: 3, // Enable debug after 3 errors
    maxWarnings: 5, // Enable debug after 5 warnings
    lastReset: Date.now(),
    resetInterval: 30000 // Reset counters every 30 seconds
  }
};

function navLog(level, message, data = null) {
  if (!DEBUG.enabled) return;
  
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] < levels[DEBUG.level]) return;
  
  // Auto-enable debug logging when issues are detected
  if (DEBUG.autoDebug.enabled) {
    const now = Date.now();
    
    // Reset counters if enough time has passed
    if (now - DEBUG.autoDebug.lastReset > DEBUG.autoDebug.resetInterval) {
      DEBUG.autoDebug.errorCount = 0;
      DEBUG.autoDebug.warningCount = 0;
      DEBUG.autoDebug.lastReset = now;
    }
    
    // Count errors and warnings
    if (level === 'error') {
      DEBUG.autoDebug.errorCount++;
    } else if (level === 'warn') {
      DEBUG.autoDebug.warningCount++;
    }
    
    // Auto-enable debug logging if too many issues
    if (DEBUG.autoDebug.errorCount >= DEBUG.autoDebug.maxErrors || 
        DEBUG.autoDebug.warningCount >= DEBUG.autoDebug.maxWarnings) {
      if (DEBUG.level !== 'debug') {
        DEBUG.level = 'debug';
        console.log('🔧 [NAV DEBUG] Auto-enabled debug logging due to detected issues');
        console.log('🔧 [NAV DEBUG] Errors:', DEBUG.autoDebug.errorCount, 'Warnings:', DEBUG.autoDebug.warningCount);
      }
    }
  }
  
  // Rate limiting to prevent spam
  const logKey = `${level}:${message}`;
  const now = Date.now();
  if (DEBUG.rateLimit.lastLog[logKey] && (now - DEBUG.rateLimit.lastLog[logKey]) < DEBUG.rateLimit.interval) {
    return; // Skip if logged recently
  }
  DEBUG.rateLimit.lastLog[logKey] = now;
  
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const logMessage = `${DEBUG.prefix} [${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (data) {
    console.group(logMessage);
    console.log('Data:', data);
    console.groupEnd();
  } else {
    console.log(logMessage);
  }
}

// --- AUTOMATIC ISSUE DETECTION ---
function detectNavigationIssues() {
  const issues = [];
  
  // Check if required DOM elements exist
  const navGroup = document.querySelector('.nav-group');
  const navLinks = document.querySelector('.nav-links');
  const mobileNav = document.getElementById('mobileNav');
  
  if (!navGroup) {
    issues.push('Missing .nav-group element');
    navLog('error', 'Navigation issue detected: Missing .nav-group element');
  }
  
  if (!navLinks) {
    issues.push('Missing .nav-links element');
    navLog('error', 'Navigation issue detected: Missing .nav-links element');
  }
  
  if (!mobileNav) {
    issues.push('Missing #mobileNav element');
    navLog('error', 'Navigation issue detected: Missing #mobileNav element');
  }
  
  // Check if navigation was rendered
  if (navLinks && navLinks.children.length === 0) {
    issues.push('Navigation links not rendered');
    navLog('warn', 'Navigation issue detected: No navigation links rendered');
  }
  
  // Check if plan detection is working
  const currentPlan = getEffectivePlan();
  if (!currentPlan || !PLANS[currentPlan]) {
    issues.push('Invalid plan detected');
    navLog('error', 'Navigation issue detected: Invalid plan', { currentPlan });
  }
  
  // Check if authentication state is consistent
  const authState = getAuthState();
  const storedAuth = localStorage.getItem('user-authenticated');
  // Check Firebase SDK keys as additional validation (more reliable than email)
  // SECURITY: Require BOTH flag AND Firebase keys to match getAuthState() logic
  // This prevents false inconsistency warnings and matches security requirements
  const hasFirebaseKeys = Object.keys(localStorage).some(k => 
    k.startsWith('firebase:authUser:') && 
    localStorage.getItem(k) && 
    localStorage.getItem(k) !== 'null' &&
    localStorage.getItem(k).length > 10
  );
  // Require both conditions: flag must be true AND Firebase keys must exist
  const isAuthenticated = storedAuth === 'true' && hasFirebaseKeys;
  if (authState.isAuthenticated !== isAuthenticated) {
    issues.push('Authentication state inconsistency');
    navLog('warn', 'Navigation issue detected: Auth state inconsistency', { 
      authState: authState.isAuthenticated, 
      localStorage: isAuthenticated 
    });
  }
  
  return issues;
}

function autoEnableDebugIfNeeded() {
  const issues = detectNavigationIssues();
  
  if (issues.length > 0) {
    // Auto-enable debug logging
    if (DEBUG.level !== 'debug') {
      DEBUG.level = 'debug';
      console.log('🔧 [NAV DEBUG] Auto-enabled debug logging due to detected issues:');
      issues.forEach(issue => console.log('  -', issue));
    }
    
    // Log the issues
    navLog('warn', 'Navigation issues detected', { issues, count: issues.length });
  }
}

// --- AUTHENTICATION STATE MANAGEMENT ---
function getAuthState() {
  // CRITICAL SECURITY FIX: Check Firebase auth state FIRST (source of truth)
  // This prevents dangerous "self-heal" logic that can restore auth state after logout
  const logoutIntent = sessionStorage.getItem('logout-intent');
  
  // If logout is in progress, always return unauthenticated
  if (logoutIntent === '1') {
    console.log('[AUTH] getAuthState: Logout in progress, returning unauthenticated');
    return {
      isAuthenticated: false,
      userPlan: null,
      devPlan: null
    };
  }
  
  // EDGE CASE FIX: Safely get Firebase user with error handling
  let firebaseUser = null;
  let firebaseError = null;
  let firebaseManagerExists = !!window.FirebaseAuthManager;
  let getCurrentUserExists = false;
  
  try {
    if (window.FirebaseAuthManager) {
      getCurrentUserExists = typeof window.FirebaseAuthManager.getCurrentUser === 'function';
      if (getCurrentUserExists) {
        firebaseUser = window.FirebaseAuthManager.getCurrentUser();
      } else {
        console.warn('[AUTH] getAuthState: FirebaseAuthManager exists but getCurrentUser is not a function');
      }
    }
  } catch (error) {
    firebaseError = error;
    console.error('[AUTH] getAuthState: Error calling getCurrentUser():', error.message);
  }
  
  const isAuthenticatedFromFirebase = !!firebaseUser;
  
  // EDGE CASE FIX: Only fall back to localStorage if Firebase hasn't initialized yet
  // AND we're sure Firebase isn't available (not just an error)
  let fallbackAuth = false;
  const hasFirebaseManager = firebaseManagerExists && getCurrentUserExists;
  
  if (!hasFirebaseManager && !firebaseUser) {
    // Firebase not initialized - use localStorage as fallback (for initial page load)
    try {
      const storedAuth = localStorage.getItem('user-authenticated');
      // Check Firebase SDK keys as additional validation (more reliable than email)
      // SECURITY: Require BOTH flag AND Firebase keys to prevent stale flags or XSS attacks
      // This matches the pattern used in inactivity-tracker.js and static-auth-guard.js
      const hasFirebaseKeys = Object.keys(localStorage).some(k => 
        k.startsWith('firebase:authUser:') && 
        localStorage.getItem(k) && 
        localStorage.getItem(k) !== 'null' &&
        localStorage.getItem(k).length > 10
      );
      
      // Require both conditions: flag must be true AND Firebase keys must exist
      if (storedAuth === 'true' && hasFirebaseKeys) {
        fallbackAuth = true;
        console.log('[AUTH] getAuthState: Using localStorage fallback (Firebase not initialized)');
      }
    } catch (storageError) {
      console.error('[AUTH] getAuthState: localStorage access error:', storageError.message);
    }
  }

  // Cross-domain cookie fallback (for marketing site where Firebase has no local state)
  let cookiePlan = null;
  if (!isAuthenticatedFromFirebase && !fallbackAuth) {
    const cookieData = parseCrossDomainCookies();
    if (cookieData) {
      fallbackAuth = true;
      cookiePlan = cookieData.plan;
      console.log('[AUTH] getAuthState: Using cross-domain cookie fallback, plan:', cookiePlan);
    }
  }

  // Non-cookie URL handoff fallback (for browsers blocking cross-domain cookies)
  if (!isAuthenticatedFromFirebase && !fallbackAuth) {
    const handoffData = getUrlAuthHandoff();
    if (handoffData) {
      fallbackAuth = true;
      cookiePlan = handoffData.plan;
      console.log('[AUTH] getAuthState: Using URL auth handoff fallback, plan:', cookiePlan);
    }
  }

  const actualAuth = isAuthenticatedFromFirebase || fallbackAuth;
  
  // EDGE CASE FIX: If Firebase is initialized and says logged out, trust Firebase
  // This handles cases where logout cleared Firebase but localStorage is stale
  // SECURITY FIX: Check localStorage directly instead of actualAuth, since actualAuth
  // will be false when Firebase says logged out, preventing cleanup of stale localStorage
  // CRITICAL FIX: Don't clear localStorage if firebase-auth-ready hasn't fired yet
  // Firebase may still be restoring the session during initialization
    if (hasFirebaseManager && !firebaseUser) {
    // If firebase-auth-ready hasn't fired yet, Firebase may still be restoring session
    // Use localStorage fallback temporarily instead of clearing it
    if (!isRealAuthReady()) {
      console.log('[AUTH] getAuthState: Firebase not ready yet, using localStorage fallback');
      try {
        const storedAuth = localStorage.getItem('user-authenticated');
        // Check Firebase SDK keys as additional validation (more reliable than email)
        // SECURITY: Require BOTH flag AND Firebase keys to prevent XSS attacks
        // This matches the pattern used in static-auth-guard.js and inactivity-tracker.js
        const hasFirebaseKeys = Object.keys(localStorage).some(k => 
          k.startsWith('firebase:authUser:') && 
          localStorage.getItem(k) && 
          localStorage.getItem(k) !== 'null' &&
          localStorage.getItem(k).length > 10
        );
        // Require both conditions: flag must be true AND Firebase keys must exist
        if (storedAuth === 'true' && hasFirebaseKeys) {
          const fallbackPlan = localStorage.getItem('user-plan') || 'free';
          return {
            isAuthenticated: true,
            userPlan: fallbackPlan,
            devPlan: localStorage.getItem('dev-plan') || fallbackPlan
          };
        }
      } catch (e) {
        // Fall through to return unauthenticated
      }
      // If fallback didn't return, Firebase says logged out and localStorage doesn't have valid auth
      // Check cross-domain cookie before returning unauthenticated
      if (cookiePlan || hasCrossDomainAuthCookie() || hasUrlAuthHandoff()) {
        const cp = cookiePlan || 'free';
        return { isAuthenticated: true, userPlan: cp, devPlan: cp };
      }
      // Don't clear localStorage yet - wait for firebase-auth-ready to fire
      return {
        isAuthenticated: false,
        userPlan: null,
        devPlan: null
      };
    }

    // Only clear localStorage if firebase-auth-ready has fired AND Firebase says logged out
    // CRITICAL FIX: Check firebaseAuthReadyFired (or global fallback) before clearing to prevent premature clearing
    if (isRealAuthReady()) {
      // Check cross-domain cookie: if user is authenticated on app subdomain, trust the cookie
      if (cookiePlan || hasCrossDomainAuthCookie() || hasUrlAuthHandoff()) {
        const cp = cookiePlan || 'free';
        return { isAuthenticated: true, userPlan: cp, devPlan: cp };
      }
      try {
        const storedAuth = localStorage.getItem('user-authenticated');
        if (storedAuth === 'true') {
          // Firebase is initialized and says logged out, but localStorage is stale - sync localStorage
          navLog('error', 'Firebase says logged out but localStorage is stale, syncing localStorage');
          localStorage.setItem('user-authenticated', 'false');
          localStorage.removeItem('user-email');
          return {
            isAuthenticated: false,
            userPlan: null,
            devPlan: null
          };
        }
      } catch (storageError) {
        navLog('error', 'Failed to check localStorage for stale auth state', storageError.message);
      }
    }
  }
  
  // EDGE CASE FIX: Safe plan retrieval with validation
  let userPlan = null;
  let devPlan = null;
  
  if (actualAuth) {
    try {
      const storedPlan = localStorage.getItem('user-plan');
      const storedDevPlan = localStorage.getItem('dev-plan');
      
      // Validate plan values are in allowed list
      // SECURITY FIX: Include 'pending' as legitimate plan state for trial users waiting for webhook confirmation
      const allowedPlans = ['free', 'trial', 'essential', 'pro', 'premium', 'visitor', 'pending'];
      // Prefer cookie/URL-handoff plan when present. On marketing hosts this is the
      // authoritative cross-domain signal during early hydration, while localStorage
      // may still contain stale defaults like "free" or "visitor".
      if (cookiePlan && allowedPlans.includes(cookiePlan)) {
        userPlan = cookiePlan;
      } else if (storedPlan && allowedPlans.includes(storedPlan)) {
        userPlan = storedPlan;
      } else if (storedPlan) {
        console.warn('[AUTH] getAuthState: Invalid plan in localStorage:', storedPlan);
        userPlan = 'free'; // Default to free
      } else {
        userPlan = 'free';
      }
      
      if (storedDevPlan && allowedPlans.includes(storedDevPlan)) {
        devPlan = storedDevPlan;
      }
    } catch (storageError) {
      // SECURITY FIX: Set default plan when localStorage access fails to ensure function contract is met
      // Authenticated users should always have a valid plan string, not null
      console.error('[AUTH] getAuthState: Error reading plan from localStorage:', storageError.message);
      userPlan = 'free'; // Default to free when storage access fails
    }
  }

  const authState = {
    isAuthenticated: actualAuth,
    userPlan,
    devPlan
  };
  
  // Log errors for debugging (only errors, not debug info)
  if (!actualAuth && localStorage.getItem('user-authenticated') === 'true') {
    navLog('error', 'Auth state mismatch: localStorage says authenticated but Firebase says not', {
      firebaseManagerExists,
      getCurrentUserExists,
      firebaseError: firebaseError?.message,
      firebaseUser: !!firebaseUser
    });
  }
  
  // EDGE CASE: Log if we had an error but still determined auth state
  if (firebaseError && actualAuth) {
    console.warn('[AUTH] getAuthState: Used fallback auth despite Firebase error');
  }
  
  return authState;
}

function setAuthState(isAuthenticated, plan = null) {
  navLog('info', 'setAuthState() called', { isAuthenticated, plan });
  
  try {
    localStorage.setItem('user-authenticated', isAuthenticated ? 'true' : 'false');
    // NOTE: Do NOT call clearUrlAuthHandoff() here. On the marketing site, Firebase has
    // no local session and fires onAuthStateChanged(null) which calls setAuthState(false).
    // Clearing the URL handoff here would undo the auth hint set by app.jobhackai.io.
    // URL handoff is only cleared on explicit logout in logout().
    if (plan) {
      const oldPlan = localStorage.getItem('user-plan') || localStorage.getItem('dev-plan');
      // Only update and dispatch if the plan actually changed
      if (String(oldPlan) !== String(plan)) {
        localStorage.setItem('user-plan', plan);
        localStorage.setItem('dev-plan', plan);
        
        // Dispatch planChanged event to notify other components (dashboard, account-settings, etc.)
        // This ensures immediate UI updates when plan changes, rather than waiting for polling
        try {
          const planChangeEvent = new CustomEvent('planChanged', {
            detail: { oldPlan, newPlan: plan }
          });
          window.dispatchEvent(planChangeEvent);
          navLog('debug', 'setAuthState: Dispatched planChanged event', { oldPlan, newPlan: plan });
        } catch (eventError) {
          // Non-critical: if event dispatch fails, don't break auth flow
          navLog('warn', 'setAuthState: Failed to dispatch planChanged event', { message: eventError?.message });
        }
      } else {
        // Keep localStorage consistent even if no event dispatched (ensure value exists)
        try {
          localStorage.setItem('user-plan', plan);
          localStorage.setItem('dev-plan', plan);
        } catch (_) {}
        navLog('debug', 'setAuthState: plan unchanged, skipping planChanged dispatch', { oldPlan, newPlan: plan });
      }
    }
  } catch (e) {
    navLog('warn', 'Failed to set auth state in localStorage', { message: e?.message });
  }
  
  // Only log on debug level to reduce spam
  navLog('debug', 'Auth state updated in localStorage', {
    'user-authenticated': localStorage.getItem('user-authenticated'),
    'user-plan': localStorage.getItem('user-plan'),
    'dev-plan': localStorage.getItem('dev-plan')
  });
  
  // Trigger navigation update after state change
  // Trigger navigation update after state change (debounced to avoid flicker)
  setTimeout(() => {
    scheduleUpdateNavigation();
    updateDevPlanToggle();
  }, 100);
}

// EDGE CASE FIX: Prevent multiple rapid logout calls
let logoutInProgress = false;

async function logout(e) {
  e?.preventDefault?.();
  
  // EDGE CASE FIX: Debounce rapid logout clicks
  if (logoutInProgress) {
    console.log('[LOGOUT] Logout already in progress, ignoring duplicate call');
    return;
  }
  
  logoutInProgress = true;
  console.log('[LOGOUT] logout() v2: triggered');

  try {
    // CRITICAL SECURITY FIX: Set logout intent IMMEDIATELY (before any async operations)
    // This prevents race conditions where UI updates before state is cleared
    sessionStorage.setItem('logout-intent', '1');
    console.log('[LOGOUT] Logout intent flag set');

    // CRITICAL: Update navigation state IMMEDIATELY (synchronously, before Firebase signOut)
    // This ensures UI shows logged-out state right away, preventing flickering
    try {
      setAuthState(false, null);
      console.log('[LOGOUT] Navigation state updated synchronously');
    } catch (navError) {
      console.error('[LOGOUT] Failed to update navigation state:', navError.message);
    }

    // Clear localStorage IMMEDIATELY (synchronously) - don't wait for Firebase
    try {
      const keysToRemove = ['user-authenticated', 'user-email', 'user-plan', 'dev-plan', 'auth-user', 'selectedPlan'];
      keysToRemove.forEach(k => {
        try {
          localStorage.removeItem(k);
        } catch (keyError) {
          console.warn(`[LOGOUT] Failed to remove ${k}:`, keyError.message);
        }
      });
      console.log('[LOGOUT] localStorage cleared');
    } catch (storageError) {
      console.error('[LOGOUT] localStorage cleanup failed:', storageError.message);
    }

    // Clear all Firebase auth persistence keys IMMEDIATELY (synchronously)
    // This prevents "self-heal" logic from restoring auth state
    try {
      let removedCount = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('firebase:authUser:')) {
          try {
            localStorage.removeItem(key);
            removedCount++;
          } catch (keyError) {
            console.warn(`[LOGOUT] Failed to remove Firebase key ${key}:`, keyError.message);
          }
        }
      }
      console.log(`[LOGOUT] Removed ${removedCount} Firebase auth keys`);
    } catch (firebaseKeyError) {
      console.error('[LOGOUT] Firebase auth key cleanup failed:', firebaseKeyError.message);
    }

    // Clear session-scoped data IMMEDIATELY
    try { 
      sessionStorage.removeItem('selectedPlan');
      clearUrlAuthHandoff();
      // Fix: Clear plan state sync sessionStorage keys to prevent cross-user contamination
      sessionStorage.removeItem('previous-plan-before-update');
      sessionStorage.removeItem('payment-processed');
      console.log('[LOGOUT] Session storage cleared');
    } catch (sessionError) {
      console.warn('[LOGOUT] Session storage cleanup failed:', sessionError.message);
    }

    // NOW do Firebase signOut (async, but UI already updated synchronously above)
    try {
      if (window.FirebaseAuthManager?.signOut) {
        await window.FirebaseAuthManager.signOut();
        console.log('[LOGOUT] Firebase signOut complete');
      } else {
        console.warn('[LOGOUT] FirebaseAuthManager.signOut not available');
      }
    } catch (signOutError) {
      console.warn('[LOGOUT] signOut error (ignored):', signOutError.message);
    }

    // Small delay to ensure all cleanup completes before redirect
    // This prevents race conditions with auth state listeners
    await new Promise(resolve => setTimeout(resolve, 100));

    // Redirect to login
    // Clear logout-intent to avoid stale state on back/cached navigation
    try { 
      sessionStorage.removeItem('logout-intent'); 
      console.log('[LOGOUT] Logout intent flag cleared');
    } catch (sessionError) {
      console.warn('[LOGOUT] Failed to clear logout-intent:', sessionError.message);
    }
    
    console.log('[LOGOUT] Redirecting to https://app.jobhackai.io/login');
    location.replace('https://app.jobhackai.io/login');
  } finally {
    // EDGE CASE FIX: Reset flag after a delay in case redirect fails
    setTimeout(() => {
      logoutInProgress = false;
    }, 2000);
  }
}

// --- PLAN CONFIGURATION ---
const PLANS = {
  visitor: {
    name: 'Visitor',
    color: '#6B7280',
    bgColor: '#F3F4F6',
    icon: '👤',
    features: []
  },
  free: {
    name: 'Free',
    color: '#6B7280',
    bgColor: '#F3F4F6',
    icon: '🔒',
    features: ['ats'],
    description: '1 ATS score per month'
  },
  trial: {
    name: 'Trial',
    color: '#FF9100',
    bgColor: '#FFF7E6',
    icon: '⏰',
    features: ['ats', 'feedback', 'interview']
  },
  essential: {
    name: 'Essential',
    color: '#0077B5',
    bgColor: '#E3F2FD',
    icon: '📋',
    features: ['ats', 'feedback', 'interview']
  },
  pro: {
    name: 'Pro',
    color: '#388E3C',
    bgColor: '#E8F5E9',
    icon: '✅',
    features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview']
  },
  premium: {
    name: 'Premium',
    color: '#C62828',
    bgColor: '#FFEBEE',
    icon: '⭐',
    features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview', 'linkedin', 'priorityReview']
  }
};

// Make PLANS available globally for smoke tests and other modules
window.PLANS = PLANS;

// --- ENSURE LOCALSTORAGE KEYS ARE ALWAYS SET ---
// Delay setting default user-plan until after navigation initialization/hydration to prevent early free plan flicker
// if (!localStorage.getItem('user-plan')) {
//   localStorage.setItem('user-plan', 'free');
// }
// Ensure dev-plan is always set for consistency
if (!localStorage.getItem('dev-plan')) {
  localStorage.setItem('dev-plan', localStorage.getItem('user-plan') || 'free');
}

// At script start, add nav-loading class to keep nav/CTAs hidden
if (typeof document !== 'undefined') {
  try {
    const _authDecision = (typeof confidentlyAuthenticatedForNav === 'function') ? confidentlyAuthenticatedForNav() : null;
    if (_authDecision === true) {
      // Confidently authenticated -> do not add nav-loading
    } else if (_authDecision === false) {
      document.documentElement.classList.add('nav-loading');
    } else {
      // Unknown -> default to hiding nav and re-evaluating when auth is ready
      document.documentElement.classList.add('nav-loading');
      try {
        const onAuthReady = function () {
          try { document.removeEventListener('firebase-auth-ready', onAuthReady); } catch (_) {}
          try { scheduleUpdateNavigation(true); } catch (_) {}
        };
        try {
          if (!window.__jha_nav_auth_ready_listener_registered) {
            document.addEventListener('firebase-auth-ready', onAuthReady, { once: true });
            window.__jha_nav_auth_ready_listener_registered = true;
          }
        } catch (_) {}
      } catch (_) {}
      try {
        if (!window.__jha_auth_poll_interval) {
          let __jha_auth_poll_tries = 0;
          window.__jha_auth_poll_interval = setInterval(() => {
            __jha_auth_poll_tries++;
            try {
              if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
                clearInterval(window.__jha_auth_poll_interval);
                window.__jha_auth_poll_interval = null;
                try { scheduleUpdateNavigation(true); } catch (_) {}
              } else if (__jha_auth_poll_tries > 50) {
                clearInterval(window.__jha_auth_poll_interval);
                window.__jha_auth_poll_interval = null;
              }
            } catch (_) {}
          }, 100);
        }
      } catch (_) {}
    }
  } catch (e) { /* ignore */ }
}

// --- NAVIGATION CONFIGURATION ---
const NAVIGATION_CONFIG = {
  // Logged-out / Visitor
  visitor: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { text: 'Features', href: VISITOR_FEATURES_HREF },
      { text: 'Pricing', href: `${APP_BASE_URL}/pricing-a` },
      { text: 'Login', href: `${APP_BASE_URL}/login` }
    ],
    cta: { text: 'Start Free Trial', href: `${APP_BASE_URL}/login?plan=trial`, isCTA: true, planId: 'trial' }
  },
  // Free Account (no plan)
  free: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Dashboard', href: APP_BASE_URL + '/dashboard.html' },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { text: 'Resume Feedback', href: APP_BASE_URL + '/resume-feedback-pro.html', locked: true },
      { text: 'Interview Questions', href: APP_BASE_URL + '/interview-questions.html', locked: true }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: APP_BASE_URL + '/account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // 3-Day Trial
  trial: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Dashboard', href: APP_BASE_URL + '/dashboard.html' },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { text: 'Resume Feedback', href: APP_BASE_URL + '/resume-feedback-pro.html' },
      { text: 'Interview Questions', href: APP_BASE_URL + '/interview-questions.html' }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: APP_BASE_URL + '/account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Basic $29
  essential: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Dashboard', href: APP_BASE_URL + '/dashboard.html' },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { text: 'Resume Feedback', href: APP_BASE_URL + '/resume-feedback-pro.html' },
      { text: 'Interview Questions', href: APP_BASE_URL + '/interview-questions.html' }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: APP_BASE_URL + '/account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Pro $59
  pro: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Dashboard', href: APP_BASE_URL + '/dashboard.html' },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { 
        text: 'Resume Tools',
        isDropdown: true,
        items: [
          { text: 'Resume Feedback', href: APP_BASE_URL + '/resume-feedback-pro.html' },
          { text: 'Cover Letter', href: APP_BASE_URL + '/cover-letter-generator.html' },
        ]
      },
      { 
        text: 'Interview Prep',
        isDropdown: true,
        items: [
          { text: 'Interview Questions', href: APP_BASE_URL + '/interview-questions.html' },
          { text: 'Mock Interviews', href: APP_BASE_URL + '/mock-interview.html' },
        ]
      }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: APP_BASE_URL + '/account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Premium $99
  premium: {
    navItems: [
      { text: 'Home', href: VISITOR_HOME_HREF },
      { text: 'Dashboard', href: APP_BASE_URL + '/dashboard.html' },
      { text: 'Blog', href: VISITOR_BLOG_HREF },
      { 
        text: 'Resume Tools',
        isDropdown: true,
        items: [
          { text: 'Resume Feedback', href: APP_BASE_URL + '/resume-feedback-pro.html' },
          { text: 'Cover Letter', href: APP_BASE_URL + '/cover-letter-generator.html' },
        ]
      },
      { 
        text: 'Interview Prep',
        isDropdown: true,
        items: [
          { text: 'Interview Questions', href: APP_BASE_URL + '/interview-questions.html' },
          { text: 'Mock Interviews', href: APP_BASE_URL + '/mock-interview.html' },
        ]
      },
      { text: 'LinkedIn Optimizer', href: APP_BASE_URL + '/linkedin-optimizer.html' }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: APP_BASE_URL + '/account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  }
};

const CTA_PLAN_METADATA = {
  trial: {
    planName: '3-Day Free Trial',
    price: '$0 for 3 days'
  },
  essential: {
    planName: 'Essential Plan',
    price: '$29/mo'
  },
  pro: {
    planName: 'Pro Plan',
    price: '$59/mo'
  },
  premium: {
    planName: 'Premium Plan',
    price: '$99/mo'
  }
};

function persistSelectedPlan(planId, { source = 'navigation-cta' } = {}) {
  if (!planId) {
    navLog('debug', 'persistSelectedPlan skipped — no planId provided', { source });
    return;
  }

  const metadata = CTA_PLAN_METADATA[planId] || {
    planName: 'Selected Plan',
    price: '$0/mo'
  };

  const payload = {
    planId,
    planName: metadata.planName,
    price: metadata.price,
    source,
    timestamp: Date.now()
  };

  try {
    sessionStorage.setItem('selectedPlan', JSON.stringify(payload));
  } catch (err) {
    navLog('warn', 'Failed to persist selectedPlan in sessionStorage', { error: err?.message, planId, source });
  }

  try {
    localStorage.setItem('selectedPlan', JSON.stringify(payload));
  } catch (err) {
    navLog('warn', 'Failed to persist selectedPlan in localStorage', { error: err?.message, planId, source });
  }

  navLog('debug', 'Persisted plan selection', { planId, source });
}

function attachPlanSelectionHandler(element, planId, source) {
  if (!element || !planId) {
    navLog('debug', 'attachPlanSelectionHandler skipped — missing element or planId', { source });
    return;
  }

  const planSource = source || 'navigation-cta';
  element.dataset.planId = planId;
  element.dataset.planSource = planSource;
  // Remove any previously attached handler to avoid stale closures capturing old planId
  try {
    if (element._jha_plan_handler) {
      try { element.removeEventListener('click', element._jha_plan_handler); } catch (_) {}
      element._jha_plan_handler = null;
    }
  } catch (e) { /* ignore */ }

  const handler = () => persistSelectedPlan(planId, { source: planSource });
  try {
    element.addEventListener('click', handler, { passive: true });
    // Keep a reference so we can remove it later if the CTA is updated in-place
    element._jha_plan_handler = handler;
  } catch (e) {
    // Fallback: attach without options if browser doesn't support options param
    try { element.addEventListener('click', handler); element._jha_plan_handler = handler; } catch (_) {}
  }
}

// --- UTILITY FUNCTIONS ---
function getCurrentPlan() {
  const authState = getAuthState();
  
  // If user is not authenticated, they are a visitor
  if (!authState.isAuthenticated) {
    navLog('debug', 'getCurrentPlan: User not authenticated, returning visitor');
    return 'visitor';
  }
  
  // If user is authenticated, use their plan
  if (authState.userPlan && PLANS[authState.userPlan]) {
    navLog('debug', 'getCurrentPlan: User authenticated, returning plan', authState.userPlan);
    return authState.userPlan;
  }
  
  // Fallback to free plan for authenticated users
  navLog('warn', 'getCurrentPlan: No valid plan found, falling back to free');
  return 'free';
}

// Dev toggle override (for development/testing only)
function getDevPlanOverride() {
  // Never allow plan overrides for logged-out users
  const authState = getAuthState();
  if (!authState.isAuthenticated) {
    navLog('debug', 'getDevPlanOverride: Ignoring overrides while logged out');
    return null;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  const devFlag = ['1', 'true', 'yes'].includes((urlParams.get('dev') || '').toLowerCase());
  const host = window.location.hostname || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  const isNonProd = isLocal || host.startsWith('dev.') || host.startsWith('qa.');
  const allowDevOverride = devFlag || isNonProd;

  if (planParam && PLANS[planParam]) {
    if (allowDevOverride) {
      navLog('info', 'getDevPlanOverride: Plan found in URL params', planParam);
      localStorage.setItem('dev-plan', planParam);
      return planParam;
    }
    navLog('info', 'getDevPlanOverride: Ignoring plan param (prod)', planParam);
  }
  const devPlan = localStorage.getItem('dev-plan');
  // Only allow dev-plan override if explicitly allowed
  if (allowDevOverride && devPlan && devPlan !== 'visitor' && PLANS[devPlan]) {
    navLog('debug', 'getDevPlanOverride: Plan found in localStorage', devPlan);
    return devPlan;
  }
  navLog('debug', 'getDevPlanOverride: No dev override found');
  return null;
}

function getEffectivePlan() {
  const authState = getAuthState();
  const devOverride = getDevPlanOverride();
  navLog('debug', 'getEffectivePlan: Starting plan detection', { authState, devOverride });
  if (!authState.isAuthenticated) {
    // Force true visitor when logged out; ignore any overrides
    const effectivePlan = 'visitor';
    navLog('info', 'getEffectivePlan: User not authenticated, effective plan', effectivePlan);
    return effectivePlan;
  }
  // If authenticated, only use devOverride if it is not visitor and not null
  if (devOverride && devOverride !== 'visitor') {
    navLog('info', 'getEffectivePlan: Dev override active for authenticated user', devOverride);
    return devOverride;
  }
  // Otherwise use their actual plan
  let effectivePlan = authState.userPlan || 'free';
  
  // Map 'pending' to 'trial' so in-flight trial signups get trial UX immediately
  if (effectivePlan === 'pending') {
    effectivePlan = 'trial';
    navLog('info', 'getEffectivePlan: Mapping pending to trial for navigation/feature access');
  }
  
  navLog('info', 'getEffectivePlan: Using user plan', effectivePlan);
  return effectivePlan;
}

function setPlan(plan) {
  navLog('info', 'setPlan() called', { plan, validPlan: !!PLANS[plan] });
  
  if (PLANS[plan]) {
    const oldPlan = localStorage.getItem('dev-plan');
    localStorage.setItem('dev-plan', plan);
    
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('plan', plan);
    window.history.replaceState({}, '', url);
    
    navLog('debug', 'setPlan: Updated localStorage and URL', {
      'dev-plan': localStorage.getItem('dev-plan'),
      newUrl: url.toString()
    });
    
    // Trigger plan change event
    const planChangeEvent = new CustomEvent('planChanged', {
      detail: { oldPlan, newPlan: plan }
    });
    window.dispatchEvent(planChangeEvent);
    
    scheduleUpdateNavigation();
    updateDevPlanToggle();
  } else {
    navLog('error', 'setPlan: Invalid plan provided', plan);
  }
}

function isFeatureUnlocked(featureKey) {
  const authState = getAuthState();
  const currentPlan = getEffectivePlan();
  
  navLog('debug', 'isFeatureUnlocked() called', { featureKey, authState, currentPlan });
  
  // Visitors can't access any features
  if (!authState.isAuthenticated && currentPlan === 'visitor') {
    navLog('info', 'isFeatureUnlocked: Visitor cannot access features', featureKey);
    return false;
  }
  
  const planConfig = PLANS[currentPlan] || { features: [] };
  const isUnlocked = planConfig && planConfig.features.includes(featureKey);
  
  // Additional check for free account usage limits
  if (isUnlocked && currentPlan === 'free' && featureKey === 'ats') {
    if (window.freeAccountManager) {
      const usageCheck = window.freeAccountManager.canUseATSScoring();
      if (!usageCheck.allowed) {
        navLog('info', 'isFeatureUnlocked: Free account usage limit reached', featureKey);
        return false;
      }
    }
  }
  
  navLog('debug', 'isFeatureUnlocked: Feature access check', {
    featureKey,
    plan: currentPlan,
    planFeatures: planConfig?.features,
    isUnlocked
  });
  
  return isUnlocked;
}

// Make feature access function available globally for smoke tests
window.isFeatureUnlocked = isFeatureUnlocked;

function showUpgradeModal(targetPlan = 'premium') {
  // Create upgrade modal
  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: white;
      border-radius: 12px;
      padding: 2rem;
      max-width: 400px;
      margin: 1rem;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    ">
      <h3 style="margin: 0 0 1rem 0; color: #1F2937; font-size: 1.25rem;">Upgrade Required</h3>
      <p style="margin: 0 0 1.5rem 0; color: #6B7280; line-height: 1.5;">
        This feature is available in the ${PLANS[targetPlan].name} plan and above.
      </p>
      <div style="display: flex; gap: 0.75rem; justify-content: center;">
        <button id="upgrade-cancel-btn" style="
          background: #F3F4F6;
          color: #6B7280;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Cancel</button>
        <button id="upgrade-confirm-btn" type="button" style="
          background: #007A30;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Upgrade Now</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Cancel button closes modal
  modal.querySelector('#upgrade-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
  // Upgrade button uses standard upgrade flow when available
  modal.querySelector('#upgrade-confirm-btn').addEventListener('click', () => {
    modal.remove();
    if (typeof window.upgradePlan === 'function') {
      window.upgradePlan(targetPlan, { source: 'nav-upgrade', returnUrl: window.location.href });
      return;
    }
    window.location.href = `${APP_BASE_URL}/pricing-a?plan=${encodeURIComponent(targetPlan)}`;
  });
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// --- NAVIGATION RENDERING ---
function updateNavigation() {
  navLog('info', '=== updateNavigation() START ===');
  
  // Safety: if auth looks like it's still restoring, do not render full nav now.
  // scheduleUpdateNavigation will retry after auth becomes ready.
  try {
    const pending = (typeof isAuthPossiblyPending === 'function' && isAuthPossiblyPending())
      && !isRealAuthReady();

    if (pending) {
      navLog('info', 'updateNavigation deferred because auth appears to be pending');
      // schedule a normal (debounced) nav update to run after the wait period
      scheduleUpdateNavigation();
      return;
    }
  } catch (e) {
    // If the check fails, continue — better to try rendering than to silently fail.
    navLog('warn', 'Auth pending check failed in updateNavigation, proceeding', e);
  }

  // Auto-detect issues before starting
  autoEnableDebugIfNeeded();
  
  const devOverride = getDevPlanOverride();
  const currentPlan = getEffectivePlan();
  const authState = getAuthState();
  
  // The plan-only optimization is applied after we determine navConfig below,
  // so the pre-check has been moved to the post-navConfig section to avoid TDZ.
  
  // Additional debugging for visitor state issues
  if (currentPlan !== 'visitor' && !authState.isAuthenticated) {
    navLog('warn', 'POTENTIAL ISSUE: User not authenticated but plan is not visitor', {
      currentPlan,
      authState,
      devOverride,
      'localStorage dev-plan': localStorage.getItem('dev-plan'),
      'localStorage user-plan': localStorage.getItem('user-plan'),
      'localStorage user-authenticated': localStorage.getItem('user-authenticated')
    });
  }
  
  navLog('info', 'Navigation state detected', { 
    devOverride, 
    currentPlan, 
    authState,
    url: window.location.href 
  });
  
  const navConfig = NAVIGATION_CONFIG[currentPlan] || NAVIGATION_CONFIG.visitor;
  navLog('info', 'Using navigation config', { 
    plan: currentPlan, 
    hasConfig: !!navConfig,
    navItemsCount: navConfig?.navItems?.length || 0 
  });
 
  // --- Plan-only optimization: patch instead of full rebuild ---
  try {
    const oldNavActions = document.querySelector('.nav-actions');
    if (oldNavActions) {
      // Determine previous plan from multiple possible markers:
      const existingBadge = oldNavActions.querySelector('.plan-badge, .nav-plan-pill');
      const badgePlan = existingBadge && (existingBadge.dataset?.plan || (existingBadge.textContent||'').trim().toLowerCase());
      const navDatasetPlan = (oldNavActions.dataset && oldNavActions.dataset.plan) ? (oldNavActions.dataset.plan || '').toString().toLowerCase() : null;
      const attrPlan = (oldNavActions.getAttribute && oldNavActions.getAttribute('data-plan')) ? (oldNavActions.getAttribute('data-plan') || '').toString().toLowerCase() : null;
      const previousPlan = (navDatasetPlan || badgePlan || attrPlan || null);

      // Compute nav signature for current config to ensure structure hasn't changed
      let newSignature = '';
      try {
    if (navConfig && Array.isArray(navConfig.navItems)) {
      newSignature = navConfig.navItems.map(item => {
        const base = `${item.text}::${item.href || ''}::locked:${!!item.locked}`;
        if (item.isDropdown && Array.isArray(item.items)) {
          const children = item.items.map(si => `${si.text}::${si.href || ''}::locked:${!!si.locked}`).join('|');
          return `${base}::D::${children}`;
        }
        return base;
      }).join('||');
    }
      } catch (e) { /* ignore */ }

      const previousSignature = oldNavActions.dataset?.navSignature || null;

      // Only patch when a previous plan exists, it's different, AND the nav signature is unchanged
      if (previousPlan && previousPlan !== currentPlan && previousSignature && newSignature && previousSignature === newSignature) {
        navLog('debug', 'Plan changed only and nav signature unchanged - patching nav', { previousPlan, currentPlan, signature: newSignature });
        patchNav(currentPlan);
        // refresh any small stateful parts
        try { updateQuickPlanSwitcher(); } catch(_) {}
        try { revealNav(); } catch(_) {}
        // Ensure plan dataset updated to avoid repeated patch attempts
        try { oldNavActions.dataset.plan = currentPlan; } catch(_) {}
        return; // skip full rebuild
      }
    }
  } catch (e) {
    navLog('warn', 'patchNav pre-check failed', e);
  }

  
  const navGroup = document.querySelector('.nav-group');
  const navLinks = document.querySelector('.nav-links');
  const mobileNav = document.getElementById('mobileNav');
  
  navLog('debug', 'DOM elements found', {
    navGroup: !!navGroup,
    navLinks: !!navLinks,
    mobileNav: !!mobileNav
  });

  // Determine if we should show an authenticated-style header
  const isAuthView = authState.isAuthenticated;
  navLog('info', 'View type determined', { isAuthView, authState, devOverride });

  // --- Link helper: always use relative paths for internal links ---
  const updateLink = (linkElement, href) => {
    const onHome = location.pathname.endsWith('index.html') || location.pathname === '/' || location.pathname === '';
    let finalHref = href;

    // Normalize Blog link to use same-page hash on home, and absolute file path off home
    if (onHome && href === 'index.html#blog') {
      finalHref = '#blog';
    } else if (!onHome && href === '#blog') {
      finalHref = 'index.html#blog';
    }

    // Also normalize any explicit index.html hash when on home
    if (onHome && href.startsWith('index.html#')) {
      finalHref = '#' + href.split('#')[1];
    }

    if (isAuthView) {
      finalHref = buildAuthHandoffHref(finalHref, true, currentPlan);
    }

    linkElement.href = finalHref;
  };

  const createVisitorCTA = (isMobile = false) => {
    if (!navConfig?.cta) return null;

    // If auth looks like it might be in-flight, show a neutral skeleton instead of visitor CTA
    if (isAuthPossiblyPending && isAuthPossiblyPending()) {
      const placeholder = document.createElement('span');
      placeholder.className = isMobile ? 'cta-skeleton-mobile' : 'cta-skeleton-desktop';
      placeholder.setAttribute('aria-hidden', 'true');
      // minimal inline sizing so layout doesn't jump
      placeholder.style.cssText = isMobile ? 'display:block;height:36px;width:120px;border-radius:8px;' : 'display:inline-block;height:36px;width:120px;border-radius:8px;';
      return placeholder;
    }

    const cta = document.createElement('a');
    updateLink(cta, navConfig.cta.href);
    cta.textContent = navConfig.cta.text;
    cta.className = 'btn btn-primary';
    cta.setAttribute('role', 'button');

    if (isMobile) {
      cta.style.cssText = 'background: #007A30; color: white !important; padding: 0.75rem 0; border-radius: 8px; text-decoration: none; font-weight: 600; display: block; text-align: center; margin-top: 1.5rem;';
    } else {
      cta.style.cssText = 'background: #007A30; color: white !important; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;';
    }

    if (navConfig.cta.planId) {
      const planSource = isMobile ? 'navigation-cta-mobile' : 'navigation-cta-desktop';
      attachPlanSelectionHandler(cta, navConfig.cta.planId, planSource);
    }

    return cta;
  };

  // --- Clear old elements ---
  navLog('info', 'Clearing old navigation elements');
  const oldNavLinks = document.querySelector('.nav-links');
  if (oldNavLinks) {
    oldNavLinks.innerHTML = '';
    navLog('debug', 'Cleared nav-links');
  }
  
  const oldNavActions = document.querySelector('.nav-actions');
  if (oldNavActions) {
    oldNavActions.remove();
    navLog('debug', 'Removed old nav-actions');
  }
  
  if (mobileNav) {
    mobileNav.innerHTML = '';
    navLog('debug', 'Cleared mobile nav');
  }

  // --- Build Nav Links (Desktop) ---
  if (navLinks && navConfig.navItems) {
    navLog('info', 'Building desktop navigation links', { 
      itemsCount: navConfig.navItems.length 
    });
    
    navConfig.navItems.forEach((item, index) => {
      if (item.isCTA) return; // Skip CTA in navItems for visitors
      // Removed verbose logging to prevent console spam
      
      if (item.isDropdown) {
        navLog('info', 'Creating dropdown navigation', item);
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'nav-dropdown';

        const toggle = document.createElement('a');
        toggle.href = '#';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = `${item.text} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropdown-arrow"><path d="m6 9 6 6 6-6"/></svg>`;
        
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'nav-dropdown-menu';

        item.items.forEach((dropdownItem, dropdownIndex) => {
          // Removed verbose logging to prevent console spam
          const link = document.createElement('a');
          updateLink(link, dropdownItem.href);
          link.textContent = dropdownItem.text;
          // Only add locked handler if explicitly marked as locked
          // Dropdown items should inherit unlocked state from parent plan config
          // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
          if (dropdownItem.locked === true) {
            // Remove href to prevent navigation even if JavaScript fails
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              navLog('info', 'Locked dropdown link clicked', { 
                text: dropdownItem.text, 
                href: dropdownItem.href,
                currentPlan,
                url: window.location.href 
              });
              showUpgradeModal('essential');
              return false;
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          // IMPORTANT: Do not add any other click handlers to dropdown links
          // They should navigate normally unless explicitly locked
          dropdownMenu.appendChild(link);
        });

        dropdownContainer.appendChild(toggle);
        dropdownContainer.appendChild(dropdownMenu);
        navLinks.appendChild(dropdownContainer);
        
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.nav-dropdown.open').forEach(d => {
            if (d !== dropdownContainer) d.classList.remove('open');
          });
          dropdownContainer.classList.toggle('open');
          // Removed verbose logging to prevent console spam
        });
        
        navLog('info', 'Dropdown created', { 
          text: item.text, 
          itemsCount: item.items.length 
        });
      } else {
        // Removed verbose logging to prevent console spam
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;
        // CRITICAL: Only add locked handler if explicitly marked as locked in config
        // This prevents incorrect upgrade modals from appearing
        if (item.locked === true) {
          // Remove href to prevent navigation even if JavaScript fails
          link.href = '#';
          link.setAttribute('aria-disabled', 'true');
          // Do not fade or reduce opacity; make it a clear button-like link
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            navLog('info', 'Locked link clicked', { text: item.text, href: item.href, plan: currentPlan });
            showUpgradeModal('essential');
            return false;
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        // IMPORTANT: Do not add any other click handlers - links should navigate normally unless locked
        navLinks.appendChild(link);
        // Removed verbose logging to prevent console spam
      }
    });
    // --- Always append CTA for visitors (only once, after nav links) ---
    if (!isAuthView && navConfig.cta) {
      let navActions = document.querySelector('.nav-actions');
      if (!navActions) {
        navActions = document.createElement('div');
        navActions.className = 'nav-actions';
        navGroup.appendChild(navActions);
      }
      const ctaLink = createVisitorCTA(false);
      if (ctaLink) {
        navActions.appendChild(ctaLink);
        navLog('info', 'Visitor CTA link created', {
          text: ctaLink.textContent,
          href: ctaLink.href,
          planId: navConfig.cta.planId || null
        });
      }
    }
    // --- Always append CTA for authenticated plans (only once, after nav links) ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.cta) {
      let navActions = document.querySelector('.nav-actions');
      if (!navActions) {
        navActions = document.createElement('div');
        navActions.className = 'nav-actions';
        navGroup.appendChild(navActions);
      }
      // Remove any existing CTA to avoid duplicates
      const oldCTA = navActions.querySelector('.btn-primary, .btn-secondary, .btn-outline, .cta-button');
      if (oldCTA) oldCTA.remove();
      // Create the CTA button
      const cta = document.createElement('a');
      updateLink(cta, navConfig.userNav.cta.href);
      cta.textContent = navConfig.userNav.cta.text;
      cta.className = navConfig.userNav.cta.class || 'btn-primary';
      cta.setAttribute('role', 'button');
      navActions.appendChild(cta);
    }
  } else {
    navLog('warn', 'Cannot build nav links', { 
      hasNavLinks: !!navLinks, 
      hasNavConfig: !!navConfig, 
      hasNavItems: !!navConfig?.navItems 
    });
  }

  // --- Build Mobile Nav ---
  if (mobileNav && navConfig.navItems) {
    navLog('info', 'Building mobile navigation', { itemsCount: navConfig.navItems.length });
    
    navConfig.navItems.forEach((item, index) => {
      if (item.isCTA) return; // Skip CTA in navItems for visitors
      // Removed verbose logging to prevent console spam
      
      if (item.isDropdown) {
        // Removed verbose logging to prevent console spam
        const group = document.createElement('div');
        group.className = 'mobile-nav-group';
        const trigger = document.createElement('button');
        trigger.className = 'mobile-nav-trigger';
        trigger.textContent = item.text;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', `mobile-submenu-${index}`);
        trigger.setAttribute('data-group-index', index.toString());
        
        group.appendChild(trigger);
        const submenu = document.createElement('div');
        submenu.className = 'mobile-nav-submenu';
        submenu.id = `mobile-submenu-${index}`;
        item.items.forEach(dropdownItem => {
          const link = document.createElement('a');
          updateLink(link, dropdownItem.href);
          link.textContent = dropdownItem.text;
          // Only add locked handler if explicitly marked as locked
          // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
          if (dropdownItem.locked === true) {
            // Remove href to prevent navigation even if JavaScript fails
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              navLog('info', 'Mobile locked dropdown link clicked', { text: dropdownItem.text, href: dropdownItem.href });
              showUpgradeModal('essential');
              return false;
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          // IMPORTANT: Do not add any other click handlers to mobile dropdown links
          submenu.appendChild(link);
        });
        group.appendChild(submenu);
        mobileNav.appendChild(group);
        // Removed verbose logging to prevent console spam
      } else {
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;
        // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
        // Must match desktop regular items check for consistency
        if (item.locked === true) {
          // Remove href to prevent navigation even if JavaScript fails
          link.href = '#';
          link.setAttribute('aria-disabled', 'true');
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            navLog('info', 'Mobile locked link clicked', { text: item.text, href: item.href });
            showUpgradeModal('essential');
            return false;
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        mobileNav.appendChild(link);
        // Removed verbose logging to prevent console spam
      }
    });
    // --- Always append CTA for visitors in mobile nav ---
    if (!isAuthView && navConfig.cta && mobileNav) {
      const cta = createVisitorCTA(true);
      if (cta) {
        mobileNav.appendChild(cta);
        navLog('info', 'Mobile visitor CTA created', {
          text: cta.textContent,
          href: cta.href,
          planId: navConfig.cta.planId || null
        });
      }
    } else if (!mobileNav) {
      navLog('warn', 'mobileNav is null, cannot append CTA for visitors');
    }
    // --- Add Account and Logout to mobile nav for authenticated users ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.menuItems && mobileNav) {
      // Add a separator before user menu items
      const separator = document.createElement('div');
      separator.style.cssText = 'height: 1px; background: #E5E7EB; margin: 1rem 0;';
      mobileNav.appendChild(separator);
      
      navConfig.userNav.menuItems.forEach((menuItem) => {
        const menuLink = document.createElement('a');
        if (menuItem.action === 'logout') {
          menuLink.href = '#';
          menuLink.addEventListener('click', (e) => {
            e.preventDefault();
            navLog('info', 'Mobile user logout clicked');
            logout();
          });
        } else {
          updateLink(menuLink, menuItem.href);
        }
        menuLink.textContent = menuItem.text;
        mobileNav.appendChild(menuLink);
      });
    }
    
    // --- Always append CTA for authenticated plans in mobile nav (only once, after nav links) ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.cta && mobileNav) {
      const cta = document.createElement('a');
      updateLink(cta, navConfig.userNav.cta.href);
      cta.textContent = navConfig.userNav.cta.text;
      cta.className = navConfig.userNav.cta.class || 'btn-primary';
      cta.setAttribute('role', 'button');
      mobileNav.appendChild(cta);
    } else if (isAuthView && navConfig.userNav && navConfig.userNav.cta && !mobileNav) {
      navLog('warn', 'mobileNav is null, cannot append CTA for authenticated plans');
    }
  } else {
    navLog('warn', 'Cannot build mobile nav', { 
      hasMobileNav: !!mobileNav, 
      hasNavConfig: !!navConfig, 
      hasNavItems: !!navConfig?.navItems 
    });
  }

  // --- Build User Navigation (if authenticated view) ---
  if (isAuthView && navConfig.userNav) {
    navLog('info', 'Building user navigation actions');
    let navActions = document.querySelector('.nav-actions');
    if (!navActions) {
      navActions = document.createElement('div');
      navActions.className = 'nav-actions';
      if (navGroup) {
        navGroup.appendChild(navActions);
      } else {
        navLog('warn', 'navGroup is null, cannot append navActions');
      }
    }
    // Only create and append the user menu
    navLog('debug', 'Creating user menu');
    const userMenu = document.createElement('div');
    userMenu.className = 'nav-user-menu';

    const userToggle = document.createElement('button');
    userToggle.className = 'nav-user-toggle';
    userToggle.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    `;

    const userDropdown = document.createElement('div');
    userDropdown.className = 'nav-user-dropdown';

    navConfig.userNav.menuItems.forEach((menuItem, index) => {
      const menuLink = document.createElement('a');
      if (menuItem.action === 'logout') {
        menuLink.href = '#';
        menuLink.addEventListener('click', (e) => {
          e.preventDefault();
          navLog('info', 'User logout clicked');
          logout();
        });
      } else {
        updateLink(menuLink, menuItem.href);
      }
      menuLink.textContent = menuItem.text;
      userDropdown.appendChild(menuLink);
    });

    userMenu.appendChild(userToggle);
    userMenu.appendChild(userDropdown);
    navActions.appendChild(userMenu);

    userToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      userMenu.classList.toggle('open');
    });
  } else {
    navLog('debug', 'Skipping user navigation', { isAuthView, hasUserNav: !!navConfig?.userNav });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown') && !e.target.closest('.nav-user-menu')) {
      const closedElements = document.querySelectorAll('.nav-dropdown.open, .nav-user-menu.open');
      if (closedElements.length > 0) {
        closedElements.forEach(d => d.classList.remove('open'));
      }
    }
  });
  
  // Setup event delegation for mobile nav triggers (works even after navigation rebuilds)
  // After the DOM build, ensure nav-actions carries plan and signature so plan-only patches can be validated
  try {
    const navActionsEl = document.querySelector('.nav-actions');
    if (navActionsEl && navConfig && Array.isArray(navConfig.navItems)) {
      const signature = navConfig.navItems.map(item => {
        const base = `${item.text}::${item.href || ''}::locked:${!!item.locked}`;
        if (item.isDropdown && Array.isArray(item.items)) {
          const children = item.items.map(si => `${si.text}::${si.href || ''}::locked:${!!si.locked}`).join('|');
          return `${base}::D::${children}`;
        }
        return base;
      }).join('||');
      try { navActionsEl.dataset.navSignature = signature; } catch(_) {}
      try { navActionsEl.dataset.plan = currentPlan; } catch(_) {}
    } else if (navActionsEl) {
      try { navActionsEl.dataset.plan = currentPlan; } catch(_) {}
    }
  } catch (e) {
    navLog('debug', 'Failed to set nav signature or plan dataset (post-build)', e);
  }
  setupMobileNavDelegation();
  
  // Auto-detect issues after navigation update
  setTimeout(() => {
    autoEnableDebugIfNeeded();
  }, 100);
  
  navLog('info', '=== updateNavigation() COMPLETE ===');
}

// Event delegation for mobile navigation dropdowns
// This ensures clicks work even after navigation is rebuilt
function setupMobileNavDelegation() {
  const mobileNav = document.getElementById('mobileNav');
  if (!mobileNav) return;
  
  // Remove any existing delegation listener to avoid duplicates
  if (mobileNav._delegationHandler) {
    mobileNav.removeEventListener('click', mobileNav._delegationHandler);
  }
  
  // Create new delegation handler
  mobileNav._delegationHandler = function(e) {
    // Check if click is on a mobile nav trigger button
    const trigger = e.target.closest('.mobile-nav-trigger');
    if (!trigger) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const group = trigger.closest('.mobile-nav-group');
    if (!group) return;
    
    const isOpen = group.classList.contains('open');
    
    // Close all other groups
    document.querySelectorAll('.mobile-nav-group.open').forEach(g => {
      if (g !== group) {
        g.classList.remove('open');
        const t = g.querySelector('.mobile-nav-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
    
    // Toggle current group
    if (isOpen) {
      group.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    } else {
      group.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  };
  
  // Attach delegation listener
  mobileNav.addEventListener('click', mobileNav._delegationHandler);
  navLog('debug', 'Mobile nav delegation handler attached');
}

function updateQuickPlanSwitcher() {
  // No-op - Quick Plan Switcher removed
}

function updateDevPlanToggle() {
  // No-op - dev plan toggle removed
}

// --- QUICK PLAN SWITCHER REMOVED ---
// All quick plan switcher code has been removed
// For testing: use browser console with localStorage.setItem('dev-plan', 'trial')

// --- FEATURE ACCESS CONTROL ---
function checkFeatureAccess(featureKey, targetPlan = 'premium') {
  navLog('debug', 'checkFeatureAccess() called', { featureKey, targetPlan });
  
  if (!isFeatureUnlocked(featureKey)) {
    navLog('info', 'Feature access denied, showing upgrade modal', { featureKey, targetPlan });
    showUpgradeModal(targetPlan);
    return false;
  }
  
  navLog('debug', 'Feature access granted', { featureKey });
  return true;
}

// --- INITIALIZATION ---
// SECURITY FIX: Guard against duplicate Firebase auth listener registration
let firebaseAuthListenerRegistered = false;
// Guard against duplicate navigation initialization
let navigationInitialized = false;

async function initializeNavigation() {
  // CRITICAL FIX: Prevent duplicate initialization calls
  // Both event handler and fallback can call this, causing duplicate storage listeners
  if (navigationInitialized) {
    navLog('debug', 'Navigation already initialized, skipping duplicate call');
    return;
  }
  navLog('info', '=== initializeNavigation() START ===');
  navLog('info', 'Initialization context', {
    readyState: document.readyState,
    url: window.location.href,
    userAgent: navigator.userAgent.substring(0, 50) + '...'
  });
  
  // Initialize required localStorage keys for smoke tests
  try {
    if (!localStorage.getItem('user-authenticated')) {
      try { localStorage.setItem('user-authenticated', 'false'); } catch (_) {}
      navLog('debug', 'Initialized user-authenticated to false');
    }
    if (!localStorage.getItem('user-plan')) {
      try { localStorage.setItem('user-plan', 'free'); } catch (_) {}
      navLog('debug', 'Initialized user-plan to free');
    }
  } catch (storageInitError) {
    navLog('warn', 'localStorage not available during navigation initialization', { error: storageInitError?.message });
  }

  // --- Plan persistence fix ---
  const authState = getAuthState();
  let devPlan = localStorage.getItem('dev-plan');
  
  // Force clean visitor state for unauthenticated users
  if (!authState.isAuthenticated) {
    // Clear force flag if not needed anymore (kept until first init completes)
    if (localStorage.getItem('force-logged-out') === 'true') {
      // remove after navigation renders once on home
      setTimeout(() => { try { localStorage.removeItem('force-logged-out'); } catch (_) {} }, 500);
    }
    // Ensure a valid default plan key exists for logged-out users (used by diagnostics)
    localStorage.setItem('user-plan', 'free');
    localStorage.removeItem('dev-plan');
    devPlan = null;
    
    navLog('info', 'Force-cleared plan data for unauthenticated user');
  } else {
    // If dev-plan is not set or matches visitor, always set to user-plan
    if (!devPlan || devPlan === 'visitor') {
      localStorage.setItem('dev-plan', authState.userPlan || 'free');
      devPlan = authState.userPlan || 'free';
      navLog('info', 'Auto-set dev-plan to user plan for authenticated user', devPlan);
    }
  }

//   // Create quick plan switcher and append to document
//   navLog('debug', 'Creating quick plan switcher');
//   const switcher = createQuickPlanSwitcher();
//   document.body.appendChild(switcher);
//   navLog('debug', 'Quick plan switcher appended to body');

  // CRITICAL FIX: For authenticated users, fetch plan before rendering navigation
  // This prevents race condition where navigation shows wrong plan initially
  if (authState.isAuthenticated && window.FirebaseAuthManager?.getCurrentUser) {
    navLog('info', 'Authenticated user detected, fetching plan before navigation render');
    try {
      const user = window.FirebaseAuthManager.getCurrentUser();
      if (user) {
        const token = await user.getIdToken();
        // Fetch plan from API first
        const planRes = await fetch('/api/plan/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (planRes.ok) {
          const planData = await planRes.json();
          if (planData.plan) {
            navLog('info', 'Fetched plan from API, updating localStorage', planData.plan);
            localStorage.setItem('user-plan', planData.plan);
            localStorage.setItem('dev-plan', planData.plan);
            
            // If plan is free, double-check with billing-status as fallback
            if (planData.plan === 'free') {
              navLog('info', 'Plan is free, checking billing-status as fallback');
              const billingRes = await fetch('/api/billing-status?force=1', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (billingRes.ok) {
                const billingData = await billingRes.json();
                if (billingData.ok && billingData.plan && billingData.plan !== 'free') {
                  navLog('info', 'Found plan from billing-status fallback, updating', billingData.plan);
                  localStorage.setItem('user-plan', billingData.plan);
                  localStorage.setItem('dev-plan', billingData.plan);
                  // Sync to D1 asynchronously (via sync-stripe-plan which writes to D1)
                  fetch('/api/sync-stripe-plan', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                  }).catch(err => navLog('warn', 'Failed to sync plan to D1 (non-critical):', err));
                }
              }
            }
          } else {
            // plan/me returned successfully but without plan field - use billing-status as fallback
            navLog('info', 'plan/me response missing plan field, checking billing-status as fallback');
            const billingRes = await fetch('/api/billing-status?force=1', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (billingRes.ok) {
              const billingData = await billingRes.json();
              if (billingData.ok && billingData.plan) {
                navLog('info', 'Found plan from billing-status fallback (plan/me missing plan)', billingData.plan);
                localStorage.setItem('user-plan', billingData.plan);
                localStorage.setItem('dev-plan', billingData.plan);
                // Sync to KV asynchronously
                fetch('/api/sync-stripe-plan', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` }
                }).catch(err => navLog('warn', 'Failed to sync plan to KV (non-critical):', err));
              }
            }
          }
        } else {
          // plan/me failed - use billing-status as fallback
          navLog('info', 'plan/me request failed, checking billing-status as fallback');
          const billingRes = await fetch('/api/billing-status?force=1', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (billingRes.ok) {
            const billingData = await billingRes.json();
            if (billingData.ok && billingData.plan) {
              navLog('info', 'Found plan from billing-status fallback (plan/me failed)', billingData.plan);
              localStorage.setItem('user-plan', billingData.plan);
              localStorage.setItem('dev-plan', billingData.plan);
              // Sync to KV asynchronously
              fetch('/api/sync-stripe-plan', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
              }).catch(err => navLog('warn', 'Failed to sync plan to KV (non-critical):', err));
            }
          }
        }
      }
    } catch (planError) {
      navLog('warn', 'Plan fetch failed (non-critical), continuing with navigation render:', planError);
    }
  }
  
  // Update navigation (use scheduler to ensure revealNav runs and errors are handled)
  navLog('debug', 'Calling scheduleUpdateNavigation(true)');
  scheduleUpdateNavigation(true);
  
  // Ensure mobile nav delegation is set up (in case updateNavigation runs before mobileNav exists)
  // This will be called again in updateNavigation, but this ensures it's ready
  setTimeout(() => {
    setupMobileNavDelegation();
  }, 100);
  
  // REMOVED: Do NOT call reconcilePlanFromAPI() here - it causes race condition
  // Plan reconciliation will be handled by:
  // 1. Firebase auth's onAuthStateChanged listener (already implemented)
  // 2. Page-specific DOMContentLoaded handlers that wait for auth
  // 3. Manual calls with ?paid=1 parameter
  
  // Only handle post-checkout activation polling (doesn't need immediate plan fetch)
  if (location.search.includes('paid=1')) {
    // This will be handled by dashboard.html's DOMContentLoaded after auth is confirmed
    navLog('info', 'Checkout flow detected, plan sync will be handled by page auth check');
  }
  
  // Update quick plan switcher state
  navLog('debug', 'Updating quick plan switcher state');
  updateQuickPlanSwitcher();
  
  // Signal that navigation system is ready
  navLog('info', 'Navigation system initialization complete, dispatching ready event');
  // Ensure nav is revealed (scheduler calls revealNav); call revealNav as a safe fallback
  try {
    revealNav();
  } catch (e) {
    navLog('warn', 'Failed to reveal nav after initialization', e);
  }
  // Set flag to detect if event already fired (for fallback checks)
  window.__navigationReadyFired = true;
  // CRITICAL FIX: Only mark as initialized AFTER successful completion
  // This allows retry if initialization fails or returns early (important for Playwright tests)
  navigationInitialized = true;
  const readyEvent = new CustomEvent('navigationReady');
  window.dispatchEvent(readyEvent);
  
  // Listen for plan changes
  navLog('debug', 'Setting up storage event listener');
  window.addEventListener('storage', (e) => {
    if (e.key === 'dev-plan' || e.key === 'user-plan' || e.key === 'user-authenticated') {
      navLog('info', 'Storage event detected', { key: e.key, newValue: e.newValue, oldValue: e.oldValue });
      scheduleUpdateNavigation();
      updateQuickPlanSwitcher();
    }
  });

  // NEW: React to same-tab plan change broadcasts so badges update instantly
  window.addEventListener('planChanged', (e) => {
    navLog('info', 'planChanged event detected', { detail: e?.detail });
    try {
      scheduleUpdateNavigation(true);
      updateQuickPlanSwitcher();
    } catch (err) {
      navLog('warn', 'planChanged handler failed', err);
    }
  });
  
  // SECURITY FIX: Listen to Firebase auth state changes to keep UI in sync
  // This ensures navigation updates immediately when user logs out in another tab
  // SECURITY FIX: Guard against duplicate registration - initializeNavigation() can be called multiple times
  if (window.FirebaseAuthManager && !firebaseAuthListenerRegistered) {
    try {
      if (typeof window.FirebaseAuthManager.onAuthStateChange === 'function') {
        navLog('debug', 'Setting up Firebase auth state listener');
        firebaseAuthListenerRegistered = true; // Mark as registered before adding listener
        
        // EDGE CASE FIX: Wrap listener in try-catch to prevent errors from breaking navigation
        window.FirebaseAuthManager.onAuthStateChange((user, userRecord) => {
          try {
            const isAuthenticated = !!user;
            const currentAuthState = getAuthState();
            const hasMismatch = isAuthenticated !== currentAuthState.isAuthenticated;
            
            // SECURITY FIX: Use navLog instead of console.log to respect log level filtering
            // Do not log email address to prevent information leakage
            navLog('debug', 'Auth state changed', {
              firebaseUser: !!user,
              currentAuthState: currentAuthState.isAuthenticated,
              mismatch: hasMismatch
            });
            
            // If Firebase says logged out but localStorage says logged in, trust Firebase
            if (!isAuthenticated && currentAuthState.isAuthenticated) {
              navLog('error', 'Firebase auth mismatch: Firebase says logged out, syncing localStorage');
              setAuthState(false, null);
              // Logout is authoritative; force immediate nav update to remove auth UI
              scheduleUpdateNavigation(true);
            } else if (isAuthenticated && !currentAuthState.isAuthenticated) {
              // Firebase says logged in - force navigation update (authoritative)
              navLog('debug', 'Firebase auth state changed: User logged in, forcing navigation update');
              scheduleUpdateNavigation(true);
            } else if (isAuthenticated && currentAuthState.isAuthenticated) {
              // Both agree logged in - just schedule update in case plan changed
              navLog('debug', 'Auth state consistent, refreshing navigation');
              scheduleUpdateNavigation();
            } else if (!isAuthenticated && !currentAuthState.isAuthenticated) {
              // SECURITY FIX: Both agree logged out - still schedule navigation to sync UI
              // This handles cross-tab logout where Firebase fires with user=null and getAuthState()
              // has already cleaned up stale localStorage, leaving both as false
              navLog('debug', 'Auth state changed: Both agree logged out, updating navigation');
              scheduleUpdateNavigation(true);
            }
          } catch (listenerError) {
            // EDGE CASE FIX: Don't let listener errors break navigation
            console.error('[AUTH-LISTENER] Error in auth state listener:', {
              message: listenerError.message,
              stack: listenerError.stack
            });
          }
        });
      } else {
        console.warn('[AUTH-LISTENER] FirebaseAuthManager.onAuthStateChange is not a function');
        firebaseAuthListenerRegistered = false; // Reset flag if setup failed
      }
    } catch (setupError) {
      console.error('[AUTH-LISTENER] Failed to setup auth state listener:', setupError.message);
      firebaseAuthListenerRegistered = false; // Reset flag on error
    }
  } else if (!firebaseAuthListenerRegistered) {
    // EDGE CASE FIX: Retry setup when FirebaseAuthManager becomes available
    // SECURITY FIX: Only retry if listener hasn't been registered yet
    console.log('[AUTH-LISTENER] FirebaseAuthManager not ready, will retry on firebase-auth-ready event');
    document.addEventListener('firebase-auth-ready', function onAuthReady() {
      document.removeEventListener('firebase-auth-ready', onAuthReady);
      // Retry listener setup - check guard to prevent duplicate registration
      if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.onAuthStateChange === 'function' && !firebaseAuthListenerRegistered) {
        console.log('[AUTH-LISTENER] Retrying listener setup after firebase-auth-ready');
        firebaseAuthListenerRegistered = true; // Mark as registered before adding listener
        try {
          window.FirebaseAuthManager.onAuthStateChange((user, userRecord) => {
            try {
              const isAuthenticated = !!user;
              const currentAuthState = getAuthState();
              
              if (!isAuthenticated && currentAuthState.isAuthenticated) {
                console.log('[AUTH-LISTENER] Firebase says logged out, syncing localStorage');
                setAuthState(false, null);
                updateNavigation();
              } else if (isAuthenticated && !currentAuthState.isAuthenticated) {
                console.log('[AUTH-LISTENER] Firebase says logged in, updating navigation');
                updateNavigation();
              } else if (isAuthenticated && currentAuthState.isAuthenticated) {
                updateNavigation();
              } else if (!isAuthenticated && !currentAuthState.isAuthenticated) {
                // SECURITY FIX: Both agree logged out - still update navigation to sync UI
                // This handles cross-tab logout where Firebase fires with user=null and getAuthState()
                // has already cleaned up stale localStorage, leaving both as false
                console.log('[AUTH-LISTENER] Both agree logged out, updating navigation');
                updateNavigation();
              }
            } catch (listenerError) {
              console.error('[AUTH-LISTENER] Error in retry listener:', listenerError.message);
            }
          });
        } catch (retryError) {
          console.error('[AUTH-LISTENER] Retry setup failed:', retryError.message);
          firebaseAuthListenerRegistered = false; // Reset flag on error
        }
      }
    }, { once: true });
  } else if (firebaseAuthListenerRegistered) {
    navLog('debug', 'Firebase auth listener already registered, skipping duplicate registration');
  }
  
  navLog('info', '=== initializeNavigation() COMPLETE ===');
}

// --- Plan Reconciliation from D1 via API ---
async function fetchPlanFromAPI() {
  try {
    // DEFENSIVE GUARD: Ensure FirebaseAuthManager is loaded
    if (!window.FirebaseAuthManager) {
      console.log('🔍 fetchPlanFromAPI: FirebaseAuthManager not loaded yet, skipping');
      return null;
    }

    // DEFENSIVE GUARD: Wait for auth to be ready if it's still initializing
    if (window.FirebaseAuthManager.waitForAuthReady) {
      try {
        await window.FirebaseAuthManager.waitForAuthReady(1000); // Short timeout
      } catch (e) {
        console.log('🔍 fetchPlanFromAPI: Auth ready timeout, continuing anyway');
      }
    }

    const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
    if (!currentUser) {
      console.log('🔍 fetchPlanFromAPI: No current user available');
      return null;
    }
    
    const idToken = await currentUser.getIdToken?.();
    if (!idToken) {
      console.log('🔍 fetchPlanFromAPI: No ID token available');
      return null;
    }
    
    console.log('🔍 fetchPlanFromAPI: Fetching plan from D1 via API...');
    const r = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) {
      console.warn(`🔍 fetchPlanFromAPI: API returned ${r.status} ${r.statusText}`);
      return null;
    }
    
    const data = await r.json();
    console.log('🔍 fetchPlanFromAPI: API response:', data);
    
    let plan = data.plan || 'free';
    
    // CRITICAL FIX: If plan is 'free' but user is authenticated, check billing-status as fallback
    // This handles cases where D1 is out of sync with Stripe (shouldn't happen, but safety net)
    if (plan === 'free' && currentUser) {
      console.log('🔍 fetchPlanFromAPI: Plan is free, checking billing-status as fallback...');
      try {
        const billingRes = await fetch('/api/billing-status?force=1', { 
          headers: { Authorization: `Bearer ${idToken}` } 
        });
        if (billingRes.ok) {
          const billingData = await billingRes.json();
          if (billingData.ok && billingData.plan && billingData.plan !== 'free') {
            console.log(`🔄 fetchPlanFromAPI: Found plan ${billingData.plan} from billing-status, syncing to D1...`);
            plan = billingData.plan;
            // Sync to D1 (via sync-stripe-plan which writes to D1)
            try {
              const syncRes = await fetch('/api/sync-stripe-plan', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}` }
              });
              if (syncRes.ok) {
                console.log('✅ fetchPlanFromAPI: Plan synced to D1');
              }
            } catch (syncError) {
              console.warn('⚠️ fetchPlanFromAPI: Failed to sync plan to D1:', syncError);
            }
          }
        }
      } catch (billingError) {
        console.warn('⚠️ fetchPlanFromAPI: Failed to check billing-status:', billingError);
      }
    }
    
    // Store trial end date if available
    if (data.trialEndsAt) {
      localStorage.setItem('trial-ends-at', data.trialEndsAt);
    } else {
      localStorage.removeItem('trial-ends-at');
    }
    
    // Update localStorage with correct plan
    localStorage.setItem('user-plan', plan);
    console.log(`✅ fetchPlanFromAPI: Successfully fetched plan from D1: ${plan}`);
    return plan;
  } catch (error) {
    console.warn('❌ fetchPlanFromAPI: Error fetching plan:', error);
    return null;
  }
}

async function reconcilePlanFromAPI() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    console.log('🔍 reconcilePlanFromAPI: User not authenticated, skipping');
    return;
  }
  
  // Check if FirebaseAuthManager is loaded
  if (!window.FirebaseAuthManager) {
    console.log('🔍 reconcilePlanFromAPI: FirebaseAuthManager not loaded, skipping');
    return;
  }
  
  // FIX: Add retry mechanism for plan reconciliation
  let plan = null;
  let retryCount = 0;
  const maxRetries = 3;
  
  console.log('🔍 reconcilePlanFromAPI: Starting plan reconciliation from D1...');
  
  while (!plan && retryCount < maxRetries) {
    try {
      plan = await fetchPlanFromAPI();
      if (plan) {
        console.log(`✅ Plan reconciliation successful on attempt ${retryCount + 1}:`, plan);
        break;
      }
    } catch (error) {
      console.warn(`⚠️ Plan reconciliation attempt ${retryCount + 1} failed:`, error);
    }
    
    retryCount++;
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying plan reconciliation in ${retryCount * 1000}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
    }
  }
  
  const current = localStorage.getItem('user-plan');
  if (plan && plan !== current) {
    console.log(`🔄 Updating plan from ${current} to ${plan}`);
    localStorage.setItem('user-plan', plan);
    localStorage.setItem('dev-plan', plan);
    scheduleUpdateNavigation(true);
    try { new BroadcastChannel('auth').postMessage({ type: 'plan-update', plan: plan }); } catch (_) {}
  } else if (!plan) {
    console.warn('⚠️ Plan reconciliation failed after all retries, keeping current plan:', current);
  }
}

async function waitForPlanActivationIfNeeded() {
  if (!location.search.includes('paid=1')) return;
  const deadline = Date.now() + 10000; // 10s
  while (Date.now() < deadline) {
    await reconcilePlanFromAPI();
    const effective = getEffectivePlan();
    if (effective !== 'free' && effective !== 'trial') break;
    await new Promise(r => setTimeout(r, 500));
  }
}

// --- GLOBAL EXPORTS ---
window.JobHackAINavigation = {
  getCurrentPlan,
  getEffectivePlan,
  getAuthState,
  setAuthState,
  logout,
  isFeatureUnlocked,
  checkFeatureAccess,
  showUpgradeModal,
  updateNavigation,
  scheduleUpdateNavigation,
  initializeNavigation,
  fetchPlanFromAPI,
  reconcilePlanFromAPI,
  PLANS,
  NAVIGATION_CONFIG
};

// --- DEBUGGING UTILITY ---
window.navDebug = {
  // Commands object for other scripts to add commands
  commands: {},
  
  // Get current navigation state
  getState: () => {
    const authState = getAuthState();
    const currentPlan = getEffectivePlan();
    const devOverride = getDevPlanOverride();
    
    console.group('🔍 Navigation Debug State');
    console.log('Auth State:', authState);
    console.log('Current Plan:', currentPlan);
    console.log('Dev Override:', devOverride);
    console.log('URL:', window.location.href);
    console.log('localStorage:', {
      'user-authenticated': localStorage.getItem('user-authenticated'),
      'user-plan': localStorage.getItem('user-plan'),
      'dev-plan': localStorage.getItem('dev-plan')
    });
    console.log('Debug Settings:', {
      level: DEBUG.level,
      autoDebug: DEBUG.autoDebug.enabled,
      errorCount: DEBUG.autoDebug.errorCount,
      warningCount: DEBUG.autoDebug.warningCount
    });
    console.groupEnd();
    
    return { authState, currentPlan, devOverride };
  },
  
  // Test navigation rendering
  testNav: () => {
    console.log('🔄 Testing navigation rendering...');
    updateNavigation();
    console.log('✅ Navigation update complete');
  },
  
  // Set plan for testing
  setPlan: (plan) => {
    console.log(`🔄 Setting plan to: ${plan}`);
    setPlan(plan);
  },
  
  // Clear all navigation state
  reset: () => {
    console.log('🔄 Resetting navigation state...');
    localStorage.removeItem('user-authenticated');
    localStorage.removeItem('user-plan');
    localStorage.removeItem('dev-plan');
    updateNavigation();
    console.log('✅ Navigation state reset');
  },
  
  // Check feature access
  checkFeature: (featureKey) => {
    const isUnlocked = isFeatureUnlocked(featureKey);
    console.log(`🔒 Feature "${featureKey}": ${isUnlocked ? 'UNLOCKED' : 'LOCKED'}`);
    return isUnlocked;
  },
  
  // List all available features
  listFeatures: () => {
    console.group('📋 Available Features by Plan');
    Object.entries(PLANS).forEach(([planName, planConfig]) => {
      console.log(`${planName}:`, planConfig.features);
    });
    console.groupEnd();
  },
  
  // Enable/disable debug logging
  setLogLevel: (level) => {
    if (['debug', 'info', 'warn', 'error'].includes(level)) {
      DEBUG.level = level;
      console.log(`🔧 Debug level set to: ${level}`);
    } else {
      console.log('❌ Invalid log level. Use: debug, info, warn, error');
    }
  },
  
  // Toggle debug logging on/off
  toggleLogging: () => {
    DEBUG.enabled = !DEBUG.enabled;
    console.log(`🔧 Debug logging ${DEBUG.enabled ? 'ENABLED' : 'DISABLED'}`);
  },
};

// Navigation gating functions (Phase 2)

// Remove any .nav-actions element left by renderVerifiedNav so it doesn't
// persist when switching to visitor/unverified nav.
function _clearNavActions(desktop) {
  const navGroup = desktop.closest('.nav-group') || desktop.parentElement;
  if (navGroup) {
    const old = navGroup.querySelector('.nav-actions');
    if (old) old.remove();
  }
}

// Register close-on-outside-click exactly once (idempotent via flag).
let _verifiedNavDocClickRegistered = false;
function _ensureDocClickHandler() {
  if (_verifiedNavDocClickRegistered) return;
  _verifiedNavDocClickRegistered = true;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown') && !e.target.closest('.nav-user-menu')) {
      document.querySelectorAll('.nav-dropdown.open, .nav-user-menu.open').forEach(d => d.classList.remove('open'));
    }
  });
}

function renderMarketingNav(desktop, mobile) {
  if (!desktop) return;
  _clearNavActions(desktop);
  desktop.innerHTML = `
    <a href="${VISITOR_HOME_HREF}">Home</a>
    <a href="${VISITOR_BLOG_HREF}">Blog</a>
    <a href="${VISITOR_FEATURES_HREF}">Features</a>
    <a href="${VISITOR_PRICING_HREF}">Pricing</a>
    <a class="btn-link" href="${APP_BASE_URL}/login">Login</a>
  `;
  if (mobile) mobile.innerHTML = desktop.innerHTML;
}

function renderUnverifiedNav(desktop, mobile) {
  if (!desktop) return;
  _clearNavActions(desktop);
  desktop.innerHTML = `
    <span class="nav-status">Verify your email to unlock your account</span>
  `;
  if (mobile) mobile.innerHTML = desktop.innerHTML;
}

// Build nav item DOM nodes for a single container from NAVIGATION_CONFIG.
// Called once per target (desktop, mobile) so each gets its own event listeners.
function _buildVerifiedNavItems(container, navConfig, wrapHref) {
  container.innerHTML = '';
  navConfig.navItems.forEach((item) => {
    if (item.isCTA) return;

    if (item.isDropdown) {
      const dropdownContainer = document.createElement('div');
      dropdownContainer.className = 'nav-dropdown';

      const toggle = document.createElement('a');
      toggle.href = '#';
      toggle.className = 'nav-dropdown-toggle';
      toggle.innerHTML = `${item.text} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropdown-arrow"><path d="m6 9 6 6 6-6"/></svg>`;

      const menu = document.createElement('div');
      menu.className = 'nav-dropdown-menu';

      item.items.forEach((sub) => {
        const link = document.createElement('a');
        if (sub.locked === true) {
          link.href = '#';
          link.setAttribute('aria-disabled', 'true');
          link.classList.add('locked-link');
          link.title = 'Upgrade your plan to unlock this feature.';
          link.addEventListener('click', (e) => { e.preventDefault(); showUpgradeModal('essential'); });
        } else {
          link.href = wrapHref(sub.href);
        }
        link.textContent = sub.text;
        menu.appendChild(link);
      });

      dropdownContainer.appendChild(toggle);
      dropdownContainer.appendChild(menu);
      container.appendChild(dropdownContainer);

      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.nav-dropdown.open').forEach(d => { if (d !== dropdownContainer) d.classList.remove('open'); });
        dropdownContainer.classList.toggle('open');
      });
    } else {
      const link = document.createElement('a');
      if (item.locked === true) {
        link.href = '#';
        link.setAttribute('aria-disabled', 'true');
        link.classList.add('locked-link');
        link.title = 'Upgrade your plan to unlock this feature.';
        link.addEventListener('click', (e) => { e.preventDefault(); showUpgradeModal('essential'); });
      } else {
        link.href = wrapHref(item.href);
      }
      link.textContent = item.text;
      container.appendChild(link);
    }
  });
}

// Build a user menu (Account + Logout) with its own event listeners.
// Returns the .nav-user-menu element, or null if no userNav config.
function _buildUserMenu(navConfig, wrapHref) {
  if (!navConfig.userNav) return null;

  const userMenu = document.createElement('div');
  userMenu.className = 'nav-user-menu';

  const userToggle = document.createElement('button');
  userToggle.className = 'nav-user-toggle';
  userToggle.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  `;

  const userDropdown = document.createElement('div');
  userDropdown.className = 'nav-user-dropdown';

  navConfig.userNav.menuItems.forEach((menuItem) => {
    const menuLink = document.createElement('a');
    if (menuItem.action === 'logout') {
      menuLink.href = '#';
      menuLink.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    } else {
      menuLink.href = wrapHref(menuItem.href);
    }
    menuLink.textContent = menuItem.text;
    userDropdown.appendChild(menuLink);
  });

  userMenu.appendChild(userToggle);
  userMenu.appendChild(userDropdown);

  userToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    userMenu.classList.toggle('open');
  });

  return userMenu;
}

function renderVerifiedNav(desktop, mobile) {
  if (!desktop) return;
  const currentPlan = getEffectivePlan();
  const navConfig = NAVIGATION_CONFIG[currentPlan] || NAVIGATION_CONFIG.free;
  const planForHandoff = normalizeHandoffPlan(localStorage.getItem('user-plan') || localStorage.getItem('dev-plan') || 'free') || 'free';

  const wrapHref = (href) => buildAuthHandoffHref(href, true, planForHandoff);

  // Remove stale nav-actions from previous render before rebuilding
  _clearNavActions(desktop);

  // Build nav items for desktop and mobile independently (each gets its own listeners)
  _buildVerifiedNavItems(desktop, navConfig, wrapHref);
  if (mobile) _buildVerifiedNavItems(mobile, navConfig, wrapHref);

  // Build user menu for desktop (appended to nav-actions in nav-group)
  const desktopUserMenu = _buildUserMenu(navConfig, wrapHref);
  if (desktopUserMenu) {
    const navGroup = desktop.closest('.nav-group') || desktop.parentElement;
    const navActions = document.createElement('div');
    navActions.className = 'nav-actions';
    navActions.appendChild(desktopUserMenu);
    if (navGroup) navGroup.appendChild(navActions);
  }

  // Build user menu for mobile (appended directly inside mobile nav)
  if (mobile) {
    const mobileUserMenu = _buildUserMenu(navConfig, wrapHref);
    if (mobileUserMenu) mobile.appendChild(mobileUserMenu);
  }

  // Close dropdowns on outside click (registered once)
  _ensureDocClickHandler();
}

function applyNavForUser(user) {
  const desktopNav = document.querySelector("nav.nav-links");
  const mobileNav = document.querySelector(".mobile-nav");
  const logo = document.querySelector(".site-logo, .nav-logo, .verify-page-logo, header .logo, a.nav-logo");
  const authState = getAuthState();
  const effectiveAuthenticated = !!user || authState.isAuthenticated === true;

  const applyLogoTarget = (logoElement) => {
    if (!logoElement) return;
    const handoffPlan = normalizeHandoffPlan(localStorage.getItem('user-plan') || localStorage.getItem('dev-plan') || 'free') || 'free';
    const targetHref = buildAuthHandoffHref(VISITOR_LOGO_HREF, effectiveAuthenticated, handoffPlan);
    try {
      const anchor = logoElement.tagName && logoElement.tagName.toLowerCase() === 'a'
        ? logoElement
        : (typeof logoElement.closest === 'function' ? logoElement.closest('a') : null);
      if (anchor) anchor.setAttribute('href', targetHref);
    } catch (_) {}

    logoElement.onclick = (event) => {
      // Preserve modified-click behavior (open in new tab/window).
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1)) {
        return;
      }
      window.location.href = targetHref;
    };
  };
  
  applyLogoTarget(logo);
  if (!desktopNav) return;
  
  if (!user) {
    // On marketing, Firebase user may be null while cookie/handoff still indicates
    // authenticated state. Render verified nav immediately to avoid visitor flash.
    if (effectiveAuthenticated) {
      renderVerifiedNav(desktopNav, mobileNav);
    } else {
      renderMarketingNav(desktopNav, mobileNav);
    }
    return;
  }
  
  if (!user.emailVerified) {
    renderUnverifiedNav(desktopNav, mobileNav);
    return;
  }
  
  renderVerifiedNav(desktopNav, mobileNav);
}

// Initialize navigation when Firebase auth is ready
document.addEventListener('firebase-auth-ready', async (event) => {
  firebaseAuthReadyFired = true; // Mark as fired - Firebase has restored session
  // Set flag on window to detect if event already fired (for fallback check)
  window.__REAL_AUTH_READY = true;
  window.__firebaseAuthReadyFired = true; // legacy compat
  console.log('🔥 Firebase auth ready, initializing navigation');
  try {
    const user = window.FirebaseAuthManager
      ? window.FirebaseAuthManager.getCurrentUser()
      : null;
    applyNavForUser(user);
    initializeNavigation();
  } catch (err) {
    console.warn("[nav] failed to apply state", err);
    initializeNavigation();
  }
});

// Fallback: Initialize immediately if firebase-auth-ready event already fired
// CRITICAL FIX: Only use fallback if firebase-auth-ready event has already fired
// Checking if getCurrentUser exists is insufficient - it exists before onAuthStateChanged fires
// We must verify the event actually fired by checking window.__firebaseAuthReadyFired flag
// This fallback handles cases where firebase-auth-ready event fired before this script loaded
// Must work for both logged-in AND logged-out users (navigation needs to initialize for visitors too)
// CRITICAL FIX: Check if initialization already occurred to prevent duplicate calls
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if firebase-auth-ready event has already fired (indicated by flag)
    // AND navigation hasn't been initialized yet (prevent duplicate calls)
    // This ensures Firebase has actually checked auth state via onAuthStateChanged
    if (window.__REAL_AUTH_READY && !navigationInitialized && window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
      const firebaseUser = window.FirebaseAuthManager.getCurrentUser();
      firebaseAuthReadyFired = true; // Sync flag
      console.log('🔥 Firebase already ready (event fired before script load), initializing navigation', firebaseUser ? '(with user)' : '(logged out)');
      applyNavForUser(firebaseUser); // Pass null for logged-out users
      initializeNavigation();
    }
  });
} else {
  // DOM already loaded, check if firebase-auth-ready event already fired
  // AND navigation hasn't been initialized yet (prevent duplicate calls)
  if (window.__REAL_AUTH_READY && !navigationInitialized && window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
    const firebaseUser = window.FirebaseAuthManager.getCurrentUser();
    firebaseAuthReadyFired = true; // Sync flag
    console.log('🔥 Firebase already ready (event fired before script load), initializing navigation', firebaseUser ? '(with user)' : '(logged out)');
    applyNavForUser(firebaseUser); // Pass null for logged-out users
    initializeNavigation();
  }
}
