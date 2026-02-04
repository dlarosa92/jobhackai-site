/**
 * Cookie Consent Module
 * Handles cookie consent banner, preferences modal, and analytics gating
 * D1 is the source of truth; localStorage is used for UI performance only
 */

(function() {
  'use strict';

  const CONSENT_KEY = 'jha_cookie_consent_v1';
  const CLIENT_ID_COOKIE = 'jha_client_id';
  const GA_MEASUREMENT_ID = 'G-X48E90B00S'; // From console data
  const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?l=dataLayer&id=${GA_MEASUREMENT_ID}`;

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

      const response = await fetch('/api/cookie-consent', {
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
    document.cookie = `${CLIENT_ID_COOKIE}=${clientId}; ${secureFlag}SameSite=Lax; Max-Age=31536000; Path=/`;

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

      const response = await fetch('/api/cookie-consent', {
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
  async function setConsent(consent) {
    setConsentLocal(consent);
    await syncConsentToServer(consent);
  }

  // Helper: Check if analytics consent granted
  function hasAnalyticsConsent() {
    const consent = getConsent();
    return consent && consent.analytics === true;
  }

  // GA Script Loading: Prevent if consent denied
  function preventGALoading() {
    // Always remove GA script if it exists (needed when revoking after GA already loaded)
    const existingScript = document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`);
    if (existingScript) {
      existingScript.remove();
    }

    // Guard: Only wrap createElement once to avoid nested wrappers,
    // but still allow script removal on subsequent calls.
    if (gaLoadingPrevented) {
      return; // createElement already wrapped
    }
    gaLoadingPrevented = true;

    // Prevent future GA script loads by intercepting createElement (only once)
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(document, tagName);
      if (tagName.toLowerCase() === 'script' && !hasAnalyticsConsent()) {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src' && typeof value === 'string' && 
              (value.includes('googletagmanager.com') || value.includes('google-analytics'))) {
            console.log('[COOKIE-CONSENT] Blocked GA script:', value);
            return; // Don't set src
          }
          return originalSetAttribute.call(this, name, value);
        };
      }
      return element;
    };
  }

  // Load GA script if consent granted
  function loadGAScript() {
    if (!hasAnalyticsConsent()) {
      preventGALoading();
      return;
    }

    // Check if already loaded
    if (document.querySelector(`script[src*="googletagmanager.com/gtag/js"]`)) {
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
        <p>We use cookies to improve your experience. <a href="/cookies.html">Learn more</a></p>
        <div class="jha-cookie-actions">
          <button id="jha-accept-all" class="jha-btn-accept">Accept Analytics</button>
          <button id="jha-reject-all" class="jha-btn-reject">Reject Analytics</button>
          <button id="jha-manage" class="jha-btn-manage">Manage Preferences</button>
        </div>
      </div>
    `;
    document.body.appendChild(bannerElement);

    // Event handlers
    document.getElementById('jha-accept-all').onclick = async () => {
      await setConsent({ version: 1, analytics: true, updatedAt: new Date().toISOString() });
      removeBanner();
      loadGAScript(); // Load GA now
    };

    document.getElementById('jha-reject-all').onclick = async () => {
      await setConsent({ version: 1, analytics: false, updatedAt: new Date().toISOString() });
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
    document.getElementById('jha-save-preferences').onclick = async () => {
      const analytics = document.getElementById('jha-toggle-analytics').checked;
      await setConsent({ version: 1, analytics, updatedAt: new Date().toISOString() });
      removeBanner(); // Remove banner after saving preferences
      closeModal();
      if (analytics) {
        loadGAScript();
      } else {
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

  // Safe analytics wrapper
  window.JHA.trackEventSafe = function(category, action, label) {
    if (hasAnalyticsConsent() && window.gtag) {
      window.gtag('event', action, {
        event_category: category,
        event_label: label
      });
    }
  };

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
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
