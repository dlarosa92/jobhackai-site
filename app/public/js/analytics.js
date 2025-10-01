// analytics.js
// Google Analytics / GA4 or other tracking initialization

/**
 * Tracks a page view event.
 */
export function trackPageView() {
    if (window.ga) {
      window.ga('send', 'pageview');
    } else if (window.gtag) {
      window.gtag('event', 'page_view');
    }
  }
  
  /**
   * Tracks a custom event.
   * @param {string} category - Event category
   * @param {string} action - Event action
   * @param {string} label - Event label
   */
  export function trackEvent(category, action, label) {
    if (window.ga) {
      window.ga('send', 'event', category, action, label);
    } else if (window.gtag) {
      window.gtag('event', action, {
        event_category: category,
        event_label: label
      });
    }
  }
  