// analytics.js
// Google Analytics / GA4 or other tracking initialization
// Only tracks if user has granted analytics consent

/**
 * Check if analytics consent has been granted
 */
function hasAnalyticsConsent() {
  return window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true;
}

/**
 * Tracks a page view event (only if consent granted).
 */
export function trackPageView() {
  if (!hasAnalyticsConsent()) {
    return; // No consent, don't track
  }
  
  if (window.ga) {
    window.ga('send', 'pageview');
  } else if (window.gtag) {
    window.gtag('event', 'page_view');
  }
}

/**
 * Tracks a custom event (only if consent granted).
 * @param {string} category - Event category
 * @param {string} action - Event action
 * @param {string} label - Event label
 */
export function trackEvent(category, action, label) {
  if (!hasAnalyticsConsent()) {
    return; // No consent, don't track
  }
  
  if (window.ga) {
    window.ga('send', 'event', category, action, label);
  } else if (window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label
    });
  }
}
  