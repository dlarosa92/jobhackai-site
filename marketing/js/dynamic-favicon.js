/**
 * Favicon Loader
 * Uses the same favicon for all browser tabs (light and dark mode)
 */
(function() {
  'use strict';

  // Use the same favicon for all tabs
  const FAVICON = '../assets/jobhackai_icon_only_128.png';

  function updateFavicon() {
    // Remove existing favicon links
    const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    existingFavicons.forEach(link => link.remove());
    
    // Create new favicon link
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.type = 'image/png';
    faviconLink.href = FAVICON;
    document.head.appendChild(faviconLink);

    // Create apple-touch-icon link
    const appleTouchLink = document.createElement('link');
    appleTouchLink.rel = 'apple-touch-icon';
    appleTouchLink.href = FAVICON;
    document.head.appendChild(appleTouchLink);
  }

  function initDynamicFavicon() {
    // Set favicon (same for all tabs)
    updateFavicon();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDynamicFavicon);
  } else {
    // DOM is already ready
    initDynamicFavicon();
  }
})();
