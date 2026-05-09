// analytics.js
// JobHackAI client-side analytics (GA4 + Microsoft Clarity).
// All tracking is gated on the user's analytics consent; cookie-consent.js
// owns loading/unloading the underlying scripts. This module provides a
// single helper surface so the rest of the app can fire events without
// caring about consent or which vendor is configured.

function hasAnalyticsConsent() {
  return window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true;
}

// Route through cookie-consent.js's queue-aware wrapper when present so
// identity/config calls survive the GA-not-yet-loaded race; if it isn't
// available (page didn't load cookie-consent.js), fall back to a direct
// call gated on consent + gtag readiness.
function gtagSafe(...args) {
  if (typeof window === 'undefined') return;
  if (window.JHA?.gtagSafe) {
    window.JHA.gtagSafe(...args);
    return;
  }
  if (!hasAnalyticsConsent()) return;
  if (typeof window.gtag === 'function') {
    window.gtag(...args);
  }
}

/**
 * Tracks a page view (only if consent granted).
 * GA4 fires this automatically on config; we also fire it explicitly so
 * SPA-style navigations and manual triggers work.
 */
export function trackPageView() {
  gtagSafe('event', 'page_view', {
    page_location: window.location.href,
    page_path: window.location.pathname + window.location.search,
    page_title: document.title
  });
}

/**
 * Backwards-compat helper used by older call sites.
 */
export function trackEvent(category, action, label) {
  gtagSafe('event', action, {
    event_category: category,
    event_label: label
  });
}

/**
 * Tells GA4 which user is in the current session so events from this
 * device can be joined with events from the user's other devices.
 * Pass the Firebase UID — never an email address (PII).
 */
export function identifyUser(userId) {
  if (!userId) return;
  const id = String(userId);
  gtagSafe('set', { user_id: id });
  // Also identify in Microsoft Clarity for session-recording attribution.
  if (window.JHA?.clarityIdentifySafe) {
    window.JHA.clarityIdentifySafe(id);
    return;
  }
  if (typeof window.clarity === 'function' && hasAnalyticsConsent()) {
    try { window.clarity('identify', id); } catch (_) { /* ignore */ }
  }
}

// Expose the same surface to non-module scripts (HTML pages that include
// individual <script> tags rather than importing main.js as a module).
if (typeof window !== 'undefined') {
  window.JHA = window.JHA || {};
  window.JHA.analytics = {
    trackPageView,
    trackEvent,
    identifyUser
  };
}
