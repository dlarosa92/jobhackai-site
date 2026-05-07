/**
 * Cookie Consent Module
 * Handles cookie consent banner, preferences modal, and analytics gating
 * D1 is the source of truth; localStorage is used for UI performance only
 */

(function() {
  'use strict';

  const CONSENT_KEY = 'jha_cookie_consent_v1';
  const CLIENT_ID_COOKIE = 'jha_client_id';
  // Allow the GA ID to be overridden per-environment via window.JHA_CONFIG
  // (set inline in the HTML head, e.g. <script>window.JHA_CONFIG={GA_ID:'G-...'}</script>),
  // and fall back to the production property otherwise.
  const GA_MEASUREMENT_ID = (window.JHA_CONFIG && window.JHA_CONFIG.GA_ID) || 'G-X48E90B00S';
  const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?l=dataLayer&id=${GA_MEASUREMENT_ID}`;
  // Microsoft Clarity project ID — optional; loads only if configured.
  const CLARITY_PROJECT_ID = (window.JHA_CONFIG && window.JHA_CONFIG.CLARITY_ID) || '';

  // Domain-aware API routing: marketing site (jobhackai.io) routes API calls
  // to app.jobhackai.io so consent persists in D1 across both domains.
  const hostname = (window.location.hostname || '').toLowerCase();
  const isAppDomain = hostname.startsWith('app.') || hostname.startsWith('dev.') || hostname.startsWith('qa.') || hostname === 'localhost';
  const API_BASE = isAppDomain ? '' : 'https://app.jobhackai.io';
  // Cookie domain: use .jobhackai.io so the client_id cookie is shared across subdomains
  const COOKIE_DOMAIN = hostname.endsWith('jobhackai.io') ? '; Domain=.jobhackai.io' : '';

  // Module-level variables for banner and GA loading guard
  let bannerElement = null;
  let gaLoadingPrevented = false;
  let escHandler = null; // Persistent ESC handler for modal

  // Helper: Get consent from localStorage (UI performance)
  function getConsent() {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  }

  // Helper: Fetch consent from server (D1 source of truth)
  async function fetchConsentFromServer() {
    try {
      const clientId = getOrCreateClientId();
      
      // Get auth token if user is logged in
      let authToken = null;
      if (window.FirebaseAuthManager?.getCurrentUser) {
        const user = window.FirebaseAuthManager.getCurrentUser();
        if (user) {
          authToken = await user.getIdToken().catch(() => null);
        }
      }

      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(API_BASE + '/api/cookie-consent', {
        method: 'GET',
        headers,
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.consent) {
          // Sync server consent to localStorage
          setConsentLocal(data.consent);
          return data.consent;
        }
      }
    } catch (error) {
      console.warn('[COOKIE-CONSENT] Failed to fetch consent from server:', error);
    }
    return null;
  }

  // Helper: Set consent in localStorage
  function setConsentLocal(consent) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
      return true;
    } catch (e) {
      console.warn('[COOKIE-CONSENT] Failed to save to localStorage:', e);
      return false;
    }
  }

  // Helper: Check if consent exists
  function hasConsent() {
    return getConsent() !== null;
  }

  // Helper: Get or create anonymous client ID
  function getOrCreateClientId() {
    // Check cookie first
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === CLIENT_ID_COOKIE && value) {
        return value;
      }
    }

    // Generate new client ID (UUID v4)
    const clientId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    // Set cookie (Secure only on HTTPS, SameSite=Lax, 1 year)
    // Secure flag breaks HTTP localhost development, so make it conditional
    const isSecure = window.location.protocol === 'https:';
    const secureFlag = isSecure ? 'Secure; ' : '';
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `${CLIENT_ID_COOKIE}=${clientId}; ${secureFlag}SameSite=Lax; Max-Age=31536000; Path=/${COOKIE_DOMAIN}`;

    return clientId;
  }

  // Helper: Sync consent to server (D1)
  async function syncConsentToServer(consent) {
    try {
      const clientId = getOrCreateClientId();
      
      // Get auth token if user is logged in
      let authToken = null;
      if (window.FirebaseAuthManager?.getCurrentUser) {
        const user = window.FirebaseAuthManager.getCurrentUser();
        if (user) {
          authToken = await user.getIdToken().catch(() => null);
        }
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(API_BASE + '/api/cookie-consent', {
        method: 'POST',
        headers,
        credentials: 'include', // Include cookies for client_id
        body: JSON.stringify({
          consent,
          clientId
        })
      });

      if (!response.ok) {
        console.warn('[COOKIE-CONSENT] Server sync failed:', response.status);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('[COOKIE-CONSENT] Server sync error:', error);
      return false; // Non-blocking
    }
  }

  // Helper: Set consent (local + server)
  function setConsent(consent) {
    setConsentLocal(consent);
    // Fire-and-forget: don't await server sync so the UI updates instantly
    syncConsentToServer(consent);
  }

  // Helper: Check if analytics consent granted
  function hasAnalyticsConsent() {
    const consent = getConsent();
    return consent && consent.analytics === true;
  }

  // Stop and tear down Microsoft Clarity if it has already been injected.
  // Clarity has no public stop() API, so we remove the script tag and clear
  // window.clarity so any further references resolve to undefined. Direct
  // callers (analytics.js:identifyUser) gate on
  // `typeof window.clarity === 'function' && hasAnalyticsConsent()`, so this
  // turns those calls into no-ops without throwing. We deliberately DO NOT
  // replace clarity with a truthy noop function — if consent is later
  // re-granted, the standard Clarity bootstrap snippet does
  // `c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)}`. A truthy
  // noop short-circuits that `||`, so pre-load `clarity('identify', uid)`
  // calls would silently drop instead of being queued for the loaded
  // script to flush. Future script loads are blocked by the createElement
  // wrapper below, which also matches clarity.ms.
  function teardownClarity() {
    try {
      document.querySelectorAll('script[src*="clarity.ms/tag/"]').forEach(s => s.remove());
      window.clarity = undefined;
    } catch (_) { /* ignore */ }
  }

  // Analytics Script Loading: Prevent if consent denied (covers GA + Clarity)
  function preventGALoading() {
    // Always remove tracker scripts if they exist (needed when revoking after
    // they've already loaded). Clarity is torn down explicitly so any
    // already-loaded queue stops processing for the rest of the session.
    const existingScript = document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`);
    if (existingScript) {
      existingScript.remove();
    }
    teardownClarity();

    // Guard: Only wrap createElement once to avoid nested wrappers,
    // but still allow script removal on subsequent calls.
    if (gaLoadingPrevented) {
      return; // createElement already wrapped
    }
    gaLoadingPrevented = true;

    // Prevent future analytics script loads by intercepting createElement (only once)
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(document, tagName);
      if (tagName.toLowerCase() === 'script' && !hasAnalyticsConsent()) {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src' && typeof value === 'string' &&
              (value.includes('googletagmanager.com') ||
               value.includes('google-analytics') ||
               value.includes('clarity.ms'))) {
            console.log('[COOKIE-CONSENT] Blocked analytics script:', value);
            return; // Don't set src
          }
          return originalSetAttribute.call(this, name, value);
        };
      }
      return element;
    };
  }

  // Load Microsoft Clarity if a project ID is configured.
  // Idempotent: safe to call after Clarity has already loaded.
  function loadClarityScript() {
    if (!CLARITY_PROJECT_ID || !hasAnalyticsConsent()) return;
    if (document.querySelector('script[src*="clarity.ms/tag/"]')) return;
    // Standard Clarity bootstrap snippet, inlined so we avoid an extra file.
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, 'clarity', 'script', CLARITY_PROJECT_ID);
  }

  // Load GA script if consent granted
  function loadGAScript() {
    if (!hasAnalyticsConsent()) {
      preventGALoading();
      return;
    }

    // Check if already loaded
    if (document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`)) {
      // Still try to load Clarity if it hasn't loaded yet
      loadClarityScript();
      return; // Already loaded
    }

    // Load GA script
    const script = document.createElement('script');
    script.async = true;
    script.src = GA_SCRIPT_URL;
    document.head.appendChild(script);

    // Initialize gtag config
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);

    // Load Microsoft Clarity alongside GA (consent-gated).
    loadClarityScript();

    // Flush any events that arrived before gtag was available (e.g.
    // blog-cta.js firing on DOMContentLoaded while init() awaits the
    // consent fetch).
    flushPendingGtagCalls();

    // Dispatch event for firebase-config.js to initialize Firebase Analytics
    window.dispatchEvent(new CustomEvent('cookie-consent-granted'));
  }

  // Helper: Remove banner if it exists
  function removeBanner() {
    if (bannerElement) {
      bannerElement.remove();
      bannerElement = null;
    } else {
      // Fallback: try to find by ID
      const existingBanner = document.getElementById('jha-cookie-banner');
      if (existingBanner) {
        existingBanner.remove();
      }
    }
  }

  // Create banner
  function createBanner() {
    if (hasConsent()) return; // Already has consent

    bannerElement = document.createElement('div');
    bannerElement.id = 'jha-cookie-banner';
    bannerElement.setAttribute('role', 'region');
    bannerElement.setAttribute('aria-label', 'Cookie preferences');
    bannerElement.innerHTML = `
      <div class="jha-cookie-inner">
        <p>We use cookies to improve your experience. <a href="${API_BASE}/cookies.html">Learn more</a></p>
        <div class="jha-cookie-actions">
          <button id="jha-accept-all" class="jha-btn-accept">Accept Analytics</button>
          <button id="jha-reject-all" class="jha-btn-reject">Reject Analytics</button>
          <button id="jha-manage" class="jha-btn-manage">Manage Preferences</button>
        </div>
      </div>
    `;
    document.body.appendChild(bannerElement);

    // Event handlers
    document.getElementById('jha-accept-all').onclick = () => {
      setConsent({ version: 1, analytics: true, updatedAt: new Date().toISOString() });
      removeBanner();
      loadGAScript(); // Load GA now
    };

    document.getElementById('jha-reject-all').onclick = () => {
      _pendingGtagCalls.length = 0;
      setConsent({ version: 1, analytics: false, updatedAt: new Date().toISOString() });
      removeBanner();
      preventGALoading(); // Ensure GA doesn't load
      // Notify other modules (firebase-config) that consent was revoked
      try {
        window.dispatchEvent(new CustomEvent('cookie-consent-revoked'));
      } catch (e) {
        /* ignore */
      }
    };

    document.getElementById('jha-manage').onclick = () => {
      openPreferencesModal();
    };
  }

  // Create preferences modal
  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'jha-cookie-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Cookie preferences');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="jha-cookie-modal-backdrop"></div>
      <div class="jha-cookie-modal-content">
        <div class="jha-cookie-modal-header">
          <h2>Cookie Preferences</h2>
          <button id="jha-modal-close" aria-label="Close">×</button>
        </div>
        <div class="jha-cookie-modal-body">
          <div class="jha-cookie-category">
            <div class="jha-cookie-category-header">
              <h3>Essential Cookies</h3>
              <span class="jha-cookie-badge">Always On</span>
            </div>
            <p>These cookies are necessary for the site to function.</p>
          </div>
          <div class="jha-cookie-category">
            <div class="jha-cookie-category-header">
              <h3>Analytics Cookies</h3>
              <label class="jha-toggle">
                <input type="checkbox" id="jha-toggle-analytics" ${hasAnalyticsConsent() ? 'checked' : ''}>
                <span class="jha-toggle-slider"></span>
              </label>
            </div>
            <p>Help us understand how you use the site to improve our services.</p>
          </div>
        </div>
        <div class="jha-cookie-modal-footer">
          <button id="jha-save-preferences" class="jha-btn-save">Save Preferences</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Event handlers
    document.getElementById('jha-modal-close').onclick = closeModal;
    document.getElementById('jha-save-preferences').onclick = () => {
      const analytics = document.getElementById('jha-toggle-analytics').checked;
      setConsent({ version: 1, analytics, updatedAt: new Date().toISOString() });
      removeBanner(); // Remove banner after saving preferences
      closeModal();
      if (analytics) {
        loadGAScript();
      } else {
        _pendingGtagCalls.length = 0;
        preventGALoading();
        // Notify other modules (firebase-config) that consent was revoked
        try {
          window.dispatchEvent(new CustomEvent('cookie-consent-revoked'));
        } catch (e) {
          /* ignore */
        }
      }
    };

    modal.querySelector('.jha-cookie-modal-backdrop').onclick = closeModal;
    
    // ESC key handler (persistent, doesn't remove itself)
    escHandler = function(e) {
      if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
        closeModal();
      }
    };
    document.addEventListener('keydown', escHandler);

    return modal;
  }

  let modal = null;
  function openPreferencesModal() {
    if (!modal) {
      modal = createModal();
    }
    
    // Sync checkbox state to current consent (fixes stale state issue)
    const analyticsCheckbox = document.getElementById('jha-toggle-analytics');
    if (analyticsCheckbox) {
      analyticsCheckbox.checked = hasAnalyticsConsent();
    }
    
    modal.classList.add('active');
    if (analyticsCheckbox) {
      analyticsCheckbox.focus();
    }
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // Setup Account Settings button handler
  function setupAccountSettingsButton() {
    const button = document.getElementById('open-cookie-preferences');
    if (button) {
      button.addEventListener('click', openPreferencesModal);
    }
  }

  // Expose API for other modules
  window.JHA = window.JHA || {};
  window.JHA.cookieConsent = {
    hasConsent,
    hasAnalyticsConsent,
    openPreferences: openPreferencesModal,
    getConsent
  };

  // Safe analytics wrapper. Two call shapes are supported so both legacy and
  // new code paths work without a migration:
  //   trackEventSafe('Report', 'Download', 'LinkedIn Optimizer Report')
  //   trackEventSafe('sign_up', { method: 'email', plan: 'trial' })
  //
  // Calls fired before the GA script finishes loading (e.g. blog-cta.js
  // running on DOMContentLoaded while init() is still awaiting the
  // server-side consent fetch, or identifyUser firing right before a
  // sign_up event) are queued and flushed by loadGAScript() in original
  // order, so 'set { user_id }' always lands before the next event that
  // should carry it. If the user has not stored a consent decision yet
  // (getConsent() === null), calls are queued so they can fire after
  // "Accept Analytics". If analytics was explicitly declined, the call
  // is dropped. The pre-decision queue is cleared when the user rejects.
  const _pendingGtagCalls = [];
  const MAX_PENDING_CALLS = 50;
  function flushPendingGtagCalls() {
    if (!hasAnalyticsConsent() || !window.gtag) return;
    while (_pendingGtagCalls.length) {
      const args = _pendingGtagCalls.shift();
      try { window.gtag.apply(null, args); } catch (_) { /* ignore */ }
    }
  }

  // Wait until cookie-consent init() has created window.gtag (so queued
  // identify/event calls are flushed) before full-page navigation; otherwise
  // in-memory _pendingGtagCalls is lost when the document unloads.
  // Cap the wait tightly: returning visitors with consent in localStorage
  // can race init()'s server consent fetch — if gtag still isn't loaded,
  // kick off loadGAScript() ourselves so we aren't stuck waiting on a
  // network round-trip that will never produce gtag.
  function flushAnalyticsBeforeNavigate() {
    if (!hasAnalyticsConsent()) return Promise.resolve();
    if (typeof window.gtag === 'function') {
      flushPendingGtagCalls();
      return Promise.resolve();
    }
    try { loadGAScript(); } catch (_) { /* ignore */ }
    const timeoutMs = 1500;
    const start = typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
    return new Promise((resolve) => {
      function tick() {
        if (!hasAnalyticsConsent()) {
          resolve();
          return;
        }
        if (typeof window.gtag === 'function') {
          flushPendingGtagCalls();
          resolve();
          return;
        }
        const now = typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();
        if (now - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(tick, 25);
      }
      tick();
    });
  }
  // Queue-aware generic gtag wrapper. All identity/event/config calls
  // should flow through this so they're applied in correct order
  // regardless of whether GA has finished loading.
  window.JHA.gtagSafe = function(...args) {
    if (!hasAnalyticsConsent()) {
      if (getConsent() === null && _pendingGtagCalls.length < MAX_PENDING_CALLS) {
        _pendingGtagCalls.push(args);
      }
      return;
    }
    if (!window.gtag) {
      if (_pendingGtagCalls.length < MAX_PENDING_CALLS) {
        _pendingGtagCalls.push(args);
      }
      return;
    }
    window.gtag.apply(null, args);
  };
  window.JHA.trackEventSafe = function(arg1, arg2, arg3) {
    if (arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) {
      // GA4-style: (eventName, params)
      window.JHA.gtagSafe('event', arg1, arg2);
    } else {
      // Legacy: (category, action, label). Guard against single-arg callers
      // — if `action` is missing, fall back to `category` as the event name
      // so GA4 never receives an event with name `undefined`.
      const eventName = arg2 || arg1;
      if (!eventName) return;
      window.JHA.gtagSafe('event', eventName, {
        event_category: arg1,
        event_label: arg3
      });
    }
  };

  window.JHA.cookieConsent.flushAnalyticsBeforeNavigate = flushAnalyticsBeforeNavigate;

  // Site-wide delegated CTA click tracking. Any element with `data-cta` (or
  // an ancestor with `data-cta`) fires a `cta_click` GA4 event. Capture phase
  // so we still get the event even if the actual link/button stops the flow.
  function installCtaTracker() {
    if (window.JHA_CTA_TRACKER_INSTALLED) return;
    window.JHA_CTA_TRACKER_INSTALLED = true;
    document.addEventListener('click', function (e) {
      try {
        const el = e.target && e.target.closest && e.target.closest('[data-cta]');
        if (!el) return;
        const label = el.getAttribute('data-cta') || 'unknown';
        const plan = el.getAttribute('data-plan') || undefined;
        const path = (window.location.pathname || '').toLowerCase();
        const variantMatch = path.match(/pricing-([ab])\.html$/);
        if (window.JHA?.trackEventSafe) {
          window.JHA.trackEventSafe('cta_click', {
            cta_label: label,
            cta_plan: plan,
            page_path: window.location.pathname,
            pricing_variant: variantMatch ? variantMatch[1] : undefined
          });
        }
      } catch (_) {
        // Never let analytics break a click handler
      }
    }, { capture: true });
  }

  // Fire pricing_variant_view exactly once per page load, on pricing-a/b.
  function trackPricingVariantOnce() {
    const path = (window.location.pathname || '').toLowerCase();
    const m = path.match(/pricing-([ab])\.html$/);
    if (!m) return;
    if (window.JHA?.trackEventSafe) {
      window.JHA.trackEventSafe('pricing_variant_view', { pricing_variant: m[1] });
    }
  }

  // Initialize
  async function init() {
    // Fetch consent from server (D1 source of truth) on page load
    // This ensures multi-device sync and makes D1 the actual source of truth
    const serverConsent = await fetchConsentFromServer();
    if (serverConsent) {
      // Server consent loaded, use it (already synced to localStorage by fetchConsentFromServer)
      console.log('[COOKIE-CONSENT] Loaded consent from server (D1)');
    }

    // Prevent GA from loading if no consent
    if (!hasAnalyticsConsent()) {
      preventGALoading();
    } else {
      loadGAScript(); // Load if consent exists
    }

    // Show banner if no consent
    createBanner();

    // Setup Account Settings button
    setupAccountSettingsButton();

    // Wire site-wide tracking that doesn't need module loading.
    installCtaTracker();
    trackPricingVariantOnce();
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

