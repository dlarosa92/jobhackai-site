/**
 * Cookie Consent Module
 * Handles cookie consent banner, preferences modal, and analytics gating
 * D1 is the source of truth; localStorage is used for UI performance only
 */

(function() {
  'use strict';

  const CONSENT_KEY = 'jha_cookie_consent_v1';
  const PENDING_CONSENT_KEY = 'jha_cookie_consent_pending_v1';
  let pendingConsentMemory = null;
  const CLIENT_ID_COOKIE = 'jha_client_id';
  const VALID_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const hostname = (window.location.hostname || '').toLowerCase();
  const productionHost = ['jobhackai.io', 'www.jobhackai.io', 'app.jobhackai.io'].includes(hostname);
  const config = { ...(window.JHA_CONFIG || {}) };
  const PRODUCTION_GA_ID = 'G-SQYSWPFM5X';
  const PRODUCTION_CLARITY_ID = 'wskzma4clw';
  // Nonproduction is off by default. An explicit, separate test destination
  // is allowed; accidentally copying production's ID must still fail closed.
  function destination(key, productionId) {
    const value = Object.prototype.hasOwnProperty.call(config, key)
      ? config[key] : (productionHost ? productionId : '');
    return typeof value === 'string' && (productionHost || value !== productionId) ? value : '';
  }
  // Verified existing development property (502443078), stream 12184859894.
  // Only QA opts in; dev, previews and localhost remain off by default.
  if (hostname === 'qa.jobhackai.io' && !Object.prototype.hasOwnProperty.call(config, 'GA_ID')) {
    config.GA_ID = 'G-VH888WWY3M';
  }
  const GA_MEASUREMENT_ID = destination('GA_ID', PRODUCTION_GA_ID);
  const CLARITY_PROJECT_ID = destination('CLARITY_ID', PRODUCTION_CLARITY_ID);
  const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?l=dataLayer&id=${GA_MEASUREMENT_ID}`;
  if (!productionHost) window['ga-disable-' + PRODUCTION_GA_ID] = true;

  // Only the production marketing domains send consent to the production app.
  // Previews and local development must never write production consent records.
  const API_BASE = ['jobhackai.io', 'www.jobhackai.io'].includes(hostname) ? 'https://app.jobhackai.io' : '';
  // Marketing previews have no local policy page. Policy navigation is
  // separate from API routing so preview consent never writes to production.
  const POLICY_BASE = productionHost ? API_BASE
    : ['qa.jobhackai.io', 'develop.jobhackai-app-marketing-seo.pages.dev'].includes(hostname)
      ? 'https://qa.jobhackai.io' : 'https://dev.jobhackai.io';
  window.JHA = window.JHA || {};
  window.JHA.apiBase = API_BASE;
  // Cookie domain: use .jobhackai.io so the client_id cookie is shared across subdomains
  const COOKIE_DOMAIN = productionHost ? '; Domain=.jobhackai.io' : '';
  const CAMPAIGN_COOKIE = 'jha_campaign_' + (productionHost ? 'prod' : hostname === 'qa.jobhackai.io' ? 'qa' : 'dev');
  const CAMPAIGN_MAX_AGE = 90 * 24 * 60 * 60;
  let consentSyncQueue = Promise.resolve(false);

  // Module-level variables for banner and GA loading guard
  let consentRevision = 0;
  let pageViewSent = false;
  let bannerElement = null;
  let gaLoadingPrevented = false;
  let escHandler = null; // Persistent ESC handler for modal

  // Helper: Get consent from localStorage (UI performance)
  function getConsent() {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      const value = stored ? JSON.parse(stored) : null;
      return value?.version === 1 && typeof value.analytics === 'boolean' ? value : null;
    } catch (e) {
      return null;
    }
  }

  // Helper: Fetch consent from server (D1 source of truth)
  async function fetchConsentFromServer() {
    // A failed local save must survive navigation; an older server grant must
    // never overwrite a rejection still waiting to be delivered.
    if (getPendingConsent()) return undefined;
    const revision = consentRevision;
    try {
      const clientId = getOrCreateClientId();
      
      // Get auth token if user is logged in
      let authToken = null;
      if (window.FirebaseAuthManager?.getCurrentUser) {
        const user = window.FirebaseAuthManager.getCurrentUser();
        if (user) {
          authToken = await user.getIdToken();
          if (!authToken) throw new Error('Consent authentication unavailable');
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
        if (data.ok && revision === consentRevision && !getPendingConsent()) {
          if (data.resetConsent === true) {
            // Invalid stored decisions revoke both the cached grant and any
            // events/identity queued while this server check was in flight.
            localStorage.removeItem(CONSENT_KEY);
            _pendingGtagCalls.length = 0;
            _pendingClarityIdentify.length = 0;
            preventGALoading();
            window.dispatchEvent(new CustomEvent('cookie-consent-revoked'));
            return null;
          }
          // Sync server consent to localStorage
          if (data.consent) {
            setConsentLocal(data.consent);
            if (data.consent.analytics !== true) {
              preventGALoading();
              window.dispatchEvent(new CustomEvent('cookie-consent-revoked'));
            }
          }
          return data.consent || null;
        }
      }
    } catch (error) {
      console.warn('[COOKIE-CONSENT] Failed to fetch consent from server:', error);
    }
    return undefined;
  }

  function getPendingConsent() {
    try {
      const value = JSON.parse(localStorage.getItem(PENDING_CONSENT_KEY));
      if (value?.version === 1 && typeof value.analytics === 'boolean') return value;
    } catch (_) { /* Keep the current decision even when browser storage fails. */ }
    return pendingConsentMemory;
  }

  let syncNotice = null;
  function showSyncStatus(saved) {
    if (saved) {
      if (syncNotice) syncNotice.remove();
      syncNotice = null;
      return;
    }
    if (!document.body || syncNotice) return;
    syncNotice = document.createElement('div');
    syncNotice.setAttribute('role', 'status');
    syncNotice.style.cssText = 'position:relative;margin:16px;padding:12px 16px;background:#fff;color:#111;border:1px solid #888;border-radius:8px;font:14px/1.5 system-ui;';
    syncNotice.textContent = 'Your cookie choice is saved on this browser. Account sync is pending; we will retry when you reconnect or reload.';
    document.body.appendChild(syncNotice);
  }

  function rememberPendingConsent(consent) {
    pendingConsentMemory = consent;
    try { localStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(consent)); } catch (_) {}
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
      if (name === CLIENT_ID_COOKIE && VALID_CLIENT_ID.test(value || '')) {
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
  async function postConsentToServer(consent) {
    try {
      const clientId = getOrCreateClientId();
      
      // Get auth token if user is logged in
      let authToken = null;
      if (window.FirebaseAuthManager?.getCurrentUser) {
        const user = window.FirebaseAuthManager.getCurrentUser();
        if (user) {
          authToken = await user.getIdToken();
          if (!authToken) throw new Error('Consent authentication unavailable');
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

      return (await response.json()).ok === true;
    } catch (error) {
      console.warn('[COOKIE-CONSENT] Server sync error:', error);
      return false; // Non-blocking
    }
  }

  // Serialize this tab's writes so a slow grant cannot arrive after its newer
  // rejection. Checkout waits for its own authenticated consent receipt.
  function syncConsentToServer(consent) {
    const revision = consentRevision;
    consentSyncQueue = consentSyncQueue.catch(() => false).then(async () => {
      if (revision !== consentRevision) return false;
      const saved = await postConsentToServer(consent);
      if (revision === consentRevision) {
        if (saved) {
          pendingConsentMemory = null;
          try { localStorage.removeItem(PENDING_CONSENT_KEY); } catch (_) {}
        } else {
          rememberPendingConsent(consent);
        }
        showSyncStatus(saved);
      }
      return saved;
    });
    return consentSyncQueue;
  }

  function clearCampaign() {
    document.cookie = `${CAMPAIGN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${COOKIE_DOMAIN}`;
  }

  function campaignTouch(value) {
    if (!value || !Number.isSafeInteger(value.at) || value.at > Date.now() || value.at < Date.now() - CAMPAIGN_MAX_AGE * 1000) return null;
    const result = { at: value.at };
    for (const key of ['source', 'medium', 'campaign', 'asset', 'id']) {
      if (value[key] != null) {
        if (typeof value[key] !== 'string' || !/^[a-z0-9_.-]{1,100}$/i.test(value[key])) return null;
        result[key] = value[key];
      }
    }
    return result.source && result.medium && result.campaign ? result : null;
  }

  function readCampaign() {
    if (!hasAnalyticsConsent()) return null;
    try {
      const raw = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(CAMPAIGN_COOKIE + '='));
      if (!raw) return null;
      const value = JSON.parse(decodeURIComponent(raw.slice(CAMPAIGN_COOKIE.length + 1)));
      const first = campaignTouch(value.first), last = campaignTouch(value.last);
      return first || last ? { first, last } : null;
    } catch (_) { return null; }
  }

  function captureCampaign() {
    if (!hasAnalyticsConsent()) { clearCampaign(); return; }
    try {
      // Internal links must not replace the campaign that brought the visitor.
      const referrer = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : '';
      if ((productionHost && ['jobhackai.io', 'www.jobhackai.io', 'app.jobhackai.io'].includes(referrer)) || referrer === hostname) return;
      const params = new URL(window.location.href).searchParams;
      const touch = campaignTouch({ at: Date.now(), source: params.get('utm_source'), medium: params.get('utm_medium'),
        campaign: params.get('utm_campaign'), asset: params.get('utm_content'), id: params.get('utm_id') });
      if (!touch) return; // Missing/unsafe tags remain unattributed; never infer from personal data.
      const previous = readCampaign();
      const value = { first: previous?.first || previous?.last || touch, last: touch };
      document.cookie = `${CAMPAIGN_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${CAMPAIGN_MAX_AGE}; Path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}${COOKIE_DOMAIN}`;
    } catch (_) { /* Attribution must never interrupt the page. */ }
  }

  async function getCheckoutAnalyticsContext() {
    if (!hasAnalyticsConsent()) return null;
    const revision = consentRevision;
    // Reconcile account-wide withdrawal before allowing a cached grant to be
    // persisted at checkout. A deliberate unsaved choice is retried instead.
    const receipt = getPendingConsent()
      ? syncConsentToServer(getPendingConsent())
      : fetchConsentFromServer();
    const latest = await Promise.race([receipt, new Promise(resolve => window.setTimeout(() => resolve(undefined), 1500))]);
    if (latest === undefined || latest === false || revision !== consentRevision || !hasAnalyticsConsent()) return null;
    // Missing GA identifiers remain missing. Never invent a server/client ID.
    const getGaValue = (field) => new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      window.setTimeout(() => finish(null), 1200);
      if (!GA_MEASUREMENT_ID || typeof window.gtag !== 'function') { finish(null); return; }
      try { window.gtag('get', GA_MEASUREMENT_ID, field, finish); } catch (_) { finish(null); }
    });
    const sync = Promise.race([syncConsentToServer(getConsent()), new Promise(resolve => window.setTimeout(() => resolve(false), 1500))]);
    const [saved, clientId, sessionId] = await Promise.all([sync, getGaValue('client_id'), getGaValue('session_id')]);
    if (!saved || revision !== consentRevision || !hasAnalyticsConsent()) return null;
    const campaign = readCampaign();
    return { analyticsConsent: true,
      ...(typeof clientId === 'string' && /^\d{1,20}\.\d{1,20}$/.test(clientId) ? { gaClientId: clientId } : {}),
      ...(/^\d{1,20}$/.test(String(sessionId ?? '')) ? { gaSessionId: String(sessionId) } : {}),
      firstTouch: campaign?.first || null, lastTouch: campaign?.last || null };
  }

  // Helper: Set consent (local + server)
  function setConsent(consent) {
    consentRevision++;
    setConsentLocal(consent);
    rememberPendingConsent(consent);
    if (consent.analytics !== true) clearCampaign();
    // Local blocking is immediate; failed delivery remains pending for retry.
    syncConsentToServer(consent);
  }

  // Helper: Check if analytics consent granted
  function hasAnalyticsConsent() {
    const consent = getConsent();
    return consent && consent.version === 1 && consent.analytics === true;
  }

  let clarityStopped = false;
  let clarityScriptFailed = false;
  let clarityBootstrap = null;
  // The vendor's consent-denial API can schedule an internal restart. Stop
  // directly instead, clear its cookies, and keep replay stopped until the
  // next document. GA can resume in this document after a later grant.
  function clearClarityCookies() {
    const domains = ['', '; Domain=' + hostname];
    if (productionHost) {
      domains.push('; Domain=.jobhackai.io');
    }
    for (const name of ['_clck', '_clsk']) {
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
      }
    }
  }
  function teardownClarity() {
    try {
      if (typeof window.clarity === 'function') {
        clarityStopped = true;
        if (Array.isArray(window.clarity.q)) window.clarity.q.length = 0;
        // A pending bootstrap processes this stop when its SDK arrives. Do
        // not queue consentv2 denial: it can restart the vendor internally.
        window.clarity('stop');
      }
    } catch (_) { /* Cookie cleanup must still run if the vendor fails. */ }
    clearClarityCookies();
  }

  // Analytics Script Loading: Prevent if consent denied (covers GA + Clarity)
  function preventGALoading() {
    clearCampaign();
    // Removing a script does not stop listeners that already ran. Google's
    // disable flag also blocks collection by the previously loaded tag.
    if (GA_MEASUREMENT_ID) window['ga-disable-' + GA_MEASUREMENT_ID] = true;
    // Keep the loaded GA tag: removing it does not unload its runtime, and
    // reinserting it after re-grant would leave two collectors in memory.
    // The disable flag and consent-gated gtag wrapper pause this instance.
    teardownClarity();

    // Guard: Only wrap createElement once to avoid nested wrappers,
    // but still allow script removal on subsequent calls.
    if (gaLoadingPrevented) {
      return; // createElement already wrapped
    }
    gaLoadingPrevented = true;

    // Prevent future analytics script loads by intercepting createElement (only once)
    const originalCreateElement = document.createElement;
    function shouldBlockAnalyticsScriptSrc(value) {
      return typeof value === 'string' &&
          (value.includes('googletagmanager.com') ||
           value.includes('google-analytics') ||
           value.includes('clarity.ms'));
    }
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(document, tagName);
      if (tagName.toLowerCase() === 'script' && (!hasAnalyticsConsent() || (!GA_MEASUREMENT_ID && !CLARITY_PROJECT_ID))) {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src' && shouldBlockAnalyticsScriptSrc(value)) {
            console.log('[COOKIE-CONSENT] Blocked analytics script:', value);
            return; // Don't set src
          }
          return originalSetAttribute.call(this, name, value);
        };
        const srcDesc = Object.getOwnPropertyDescriptor(
          HTMLScriptElement.prototype, 'src');
        if (srcDesc && typeof srcDesc.set === 'function') {
          Object.defineProperty(element, 'src', {
            configurable: true,
            enumerable: srcDesc.enumerable,
            get: function() {
              return srcDesc.get.call(this);
            },
            set: function(v) {
              if (shouldBlockAnalyticsScriptSrc(v)) {
                console.log('[COOKIE-CONSENT] Blocked analytics script:', v);
                return;
              }
              srcDesc.set.call(this, v);
            }
          });
        }
      }
      return element;
    };
  }

  // Load only after consent. After withdrawal, replay stays stopped until
  // navigation; never restart an SDK whose storage defaults may have changed.
  function loadClarityScript() {
    if (!CLARITY_PROJECT_ID || !hasAnalyticsConsent()) return;
    let existing = document.querySelector('script[src*="clarity.ms/tag/"]');
    if (clarityScriptFailed && window.clarity === clarityBootstrap) {
      // An external tag that failed to download never executed. Only that
      // known bootstrap is safe to replace; never replace a running SDK.
      if (existing) existing.remove();
      window.clarity = undefined;
      clarityBootstrap = null;
      clarityScriptFailed = false;
      clarityStopped = false;
      existing = null;
    }
    if (clarityStopped || existing) return;
    clarityBootstrap = window.clarity || function() {
      (clarityBootstrap.q = clarityBootstrap.q || []).push(arguments);
    };
    window.clarity = clarityBootstrap;
    window.clarity('consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.clarity.ms/tag/' + CLARITY_PROJECT_ID;
    script.onerror = () => { clarityScriptFailed = true; };
    script.onload = () => {
      clarityScriptFailed = false;
      // A quick withdrawal/regrant does not cancel the stop while loading.
      if (clarityStopped || !hasAnalyticsConsent()) teardownClarity();
    };
    const first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(script, first);
  }

  // Authentication links can contain action tokens and checkout session IDs.
  // Only controlled campaign slugs belong in analytics URLs.
  function analyticsUrl(raw, includeCampaign = false) {
    try {
      const url = new URL(raw, window.location.href);
      const safe = new URL(url.origin + url.pathname);
      if (includeCampaign) {
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_id', 'utm_term']) {
          const value = url.searchParams.get(key);
          if (value && /^[a-z0-9_.-]{1,100}$/i.test(value)) safe.searchParams.set(key, value);
        }
      }
      return safe.href;
    } catch (_) { return ''; }
  }

  // Load GA script if consent granted
  function loadGAScript() {
    if (!hasAnalyticsConsent()) {
      preventGALoading();
      return;
    }
    captureCampaign();
    if (!GA_MEASUREMENT_ID) {
      loadClarityScript();
      return;
    }

    window['ga-disable-' + GA_MEASUREMENT_ID] = false;

    // Check if already loaded
    if (document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`)) {
      // Still try to load Clarity if it hasn't loaded yet
      loadClarityScript();
      flushPendingClarityIdentify();
      return; // Already loaded
    }

    // Load GA script
    const script = document.createElement('script');
    script.async = true;
    script.src = GA_SCRIPT_URL;
    document.head.appendChild(script);

    // Initialize gtag config
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      const args = arguments; // gtag.js consumes the standard Arguments command format.
      if (!hasAnalyticsConsent() || window['ga-disable-' + GA_MEASUREMENT_ID]) return;
      if (args[0] === 'event') {
        const params = { ...(args[2] || {}) };
        if ('page_location' in params) params.page_location = analyticsUrl(params.page_location, true);
        if ('page_referrer' in params) params.page_referrer = analyticsUrl(params.page_referrer);
        if ('page_path' in params) params.page_path = String(params.page_path).split(/[?#]/)[0];
        args[2] = params;
      }
      if (args[0] === 'event' && args[1] === 'page_view') {
        if (pageViewSent) return;
        pageViewSent = true;
      }
      window.dataLayer.push(args);
    }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      ...(!productionHost ? { debug_mode: true } : {}),
      page_location: analyticsUrl(window.location.href, true),
      page_referrer: document.referrer ? analyticsUrl(document.referrer) : '',
      cookie_domain: productionHost ? 'jobhackai.io' : hostname,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Cross-domain measurement: one session across the marketing site and
      // the app (GA4 admin side configured in runbook Task 0).
      linker: { domains: ['jobhackai.io', 'app.jobhackai.io'] }
    });

    // Load Microsoft Clarity alongside GA (consent-gated).
    loadClarityScript();
    flushPendingClarityIdentify();

    // Flush any events that arrived before gtag was available (e.g.
    // blog-cta.js firing on DOMContentLoaded while init() awaits the
    // consent fetch).
    const flushedPageView = flushPendingGtagCalls();
    // Marketing (and other) pages that do not load analytics.js/main.js never
    // call trackPageView(); with send_page_view: false they would emit no
    // page_view. App pages queue page_view via later module scripts —
    // flushPendingGtagCalls() above handles them when scripts run first.
    // If consent resolves mid–defer-queue (cached/failed fetch), init can run
    // before modules: defer this fallback past the defer queue + microtasks
    // then re-flush so we don't double-fire alongside main.js/trackPageView.
    if (!flushedPageView) {
      window.setTimeout(function emitFallbackPageViewIfStillNeeded() {
        if (!hasAnalyticsConsent() || pageViewSent) return;
        if (flushPendingGtagCalls()) return;
        try {
          window.gtag('event', 'page_view', {
            page_location: window.location.href,
            page_path: window.location.pathname + window.location.search,
            page_title: document.title
          });
        } catch (_) { /* ignore */ }
      }, 0);
    }

    // Notify consumers that consented analytics is available.
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
        <p>We use cookies to improve your experience. <a href="${POLICY_BASE}/cookies">Learn more</a></p>
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
      _pendingClarityIdentify.length = 0;
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
                <input type="checkbox" id="jha-toggle-analytics" aria-label="Allow analytics cookies" ${hasAnalyticsConsent() ? 'checked' : ''}>
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
        _pendingClarityIdentify.length = 0;
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
    getConsent,
    getCheckoutAnalyticsContext
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
  const _pendingClarityIdentify = [];
  const MAX_PENDING_CALLS = 50;
  function flushPendingGtagCalls() {
    if (!GA_MEASUREMENT_ID || !hasAnalyticsConsent() || !window.gtag) return false;
    let flushedPageView = false;
    while (_pendingGtagCalls.length) {
      const args = _pendingGtagCalls.shift();
      try {
        if (args[0] === 'event' && args[1] === 'page_view') {
          flushedPageView = true;
        }
        window.gtag.apply(null, args);
      } catch (_) { /* ignore */ }
    }
    return flushedPageView;
  }

  function flushPendingClarityIdentify() {
    if (clarityStopped || !hasAnalyticsConsent() || typeof window.clarity !== 'function') return;
    while (_pendingClarityIdentify.length) {
      const id = _pendingClarityIdentify.shift();
      try {
        window.clarity('identify', id);
      } catch (_) { /* ignore */ }
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
    if (!GA_MEASUREMENT_ID || !hasAnalyticsConsent()) return Promise.resolve();
    if (typeof window.gtag === 'function') {
      flushPendingGtagCalls();
      flushPendingClarityIdentify();
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
          flushPendingClarityIdentify();
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
    if (!GA_MEASUREMENT_ID) return;
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
  // Queues / bootstraps Clarity like gtagSafe: init() may still be awaiting
  // server consent when identifyUser runs, so window.clarity may not exist yet.
  window.JHA.clarityIdentifySafe = function(userId) {
    if (!userId || !CLARITY_PROJECT_ID) return;
    const id = String(userId);
    if (!hasAnalyticsConsent()) {
      // Consent undecided: queue so identify fires after "Accept Analytics".
      // Explicit reject: drop. Reject-all clears _pendingClarityIdentify.
      if (getConsent() === null && _pendingClarityIdentify.length < MAX_PENDING_CALLS) {
        _pendingClarityIdentify.push(id);
      }
      return;
    }
    try { loadClarityScript(); } catch (_) { /* ignore */ }
    if (clarityStopped) return;
    if (typeof window.clarity === 'function') {
      try { window.clarity('identify', id); } catch (_) { /* ignore */ }
      flushPendingClarityIdentify();
      return;
    }
    if (_pendingClarityIdentify.length < MAX_PENDING_CALLS) {
      _pendingClarityIdentify.push(id);
    }
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
        const variantMatch = path.match(/pricing-([ab])(?:\.html)?\/?$/);
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
    const m = path.match(/pricing-([ab])(?:\.html)?\/?$/);
    if (!m) return;
    if (window.JHA?.trackEventSafe) {
      window.JHA.trackEventSafe('pricing_variant_view', { pricing_variant: m[1] });
    }
  }

  // Initialize
  async function init() {
    // Fetch consent from server (D1 source of truth) on page load
    // This ensures multi-device sync and makes D1 the actual source of truth
    const pending = getPendingConsent();
    if (pending) {
      setConsentLocal(pending);
      await syncConsentToServer(pending);
    }
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
  if (window.addEventListener) window.addEventListener('online', () => {
    const pending = getPendingConsent();
    if (pending) syncConsentToServer(pending);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
