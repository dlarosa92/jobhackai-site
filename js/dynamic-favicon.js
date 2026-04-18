/**
 * Dynamic Favicon Switcher
 * Keeps the official logo favicon across all browser tabs
 */
(function() {
  'use strict';

  const FALLBACK_FAVICON = 'assets/jobhackai_icon_Favicon_128.png';
  const FALLBACK_APPLE_TOUCH_ICON = 'assets/jobhackai_apple_touch_icon_180.png';

  function updateFavicon() {
    const existingIcon = document.querySelector('link[rel="icon"]');
    const existingApple = document.querySelector('link[rel="apple-touch-icon"]');
    const resolvedIconHref = (existingIcon && existingIcon.href) || FALLBACK_FAVICON;
    const resolvedAppleHref = (existingApple && existingApple.href) || FALLBACK_APPLE_TOUCH_ICON;

    // Remove existing favicon links
    const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    existingFavicons.forEach(link => link.remove());
    
    // Create new favicon link
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.type = 'image/png';
    faviconLink.sizes = '128x128';
    faviconLink.href = resolvedIconHref;
    document.head.appendChild(faviconLink);

    // Create apple-touch-icon link
    const appleTouchLink = document.createElement('link');
    appleTouchLink.rel = 'apple-touch-icon';
    appleTouchLink.sizes = '180x180';
    appleTouchLink.href = resolvedAppleHref;
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
