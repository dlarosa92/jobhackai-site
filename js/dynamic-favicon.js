/**
 * Dynamic Favicon Switcher
 * Uses the same favicon for all browser tabs (light and dark mode)
 */
(function() {
  'use strict';

  // Use the same favicon for all tabs
  const FALLBACK_FAVICON = 'assets/jobhackai_icon_only_128.png';

  function updateFavicon() {
    const existingIcon = document.querySelector('link[rel="icon"]');
    const existingApple = document.querySelector('link[rel="apple-touch-icon"]');
    const resolvedHref = (existingIcon && existingIcon.href) || (existingApple && existingApple.href) || FALLBACK_FAVICON;

    // Remove existing favicon links
    const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    existingFavicons.forEach(link => link.remove());
    
    // Create new favicon link
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.type = 'image/png';
    faviconLink.href = resolvedHref;
    document.head.appendChild(faviconLink);

    // Create apple-touch-icon link
    const appleTouchLink = document.createElement('link');
    appleTouchLink.rel = 'apple-touch-icon';
    appleTouchLink.href = resolvedHref;
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

