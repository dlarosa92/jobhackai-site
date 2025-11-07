/**
 * Dynamic Favicon Switcher
 * Swaps favicon based on browser color scheme preference (light/dark mode)
 */
(function() {
  'use strict';

  // Favicon paths - update these if you create separate light/dark versions
  const FAVICON_LIGHT = 'assets/jobhackai_icon_only_128.png';  // Dark icon for light backgrounds
  const FAVICON_DARK = 'assets/jobhackai_favicon_dark.png';     // White outline icon for dark backgrounds

  function updateFavicon(isDarkMode) {
    // Remove existing favicon links
    const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    existingFavicons.forEach(link => link.remove());

    // Determine which favicon to use
    const faviconPath = isDarkMode ? FAVICON_DARK : FAVICON_LIGHT;
    
    // Create new favicon link
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.type = 'image/png';
    faviconLink.href = faviconPath;
    document.head.appendChild(faviconLink);

    // Create apple-touch-icon link
    const appleTouchLink = document.createElement('link');
    appleTouchLink.rel = 'apple-touch-icon';
    appleTouchLink.href = faviconPath;
    document.head.appendChild(appleTouchLink);
  }

  function detectColorScheme() {
    // Check if prefers-color-scheme is supported
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true; // Dark mode
    }
    return false; // Light mode (default)
  }

  function initDynamicFavicon() {
    // Set initial favicon based on current color scheme
    const isDarkMode = detectColorScheme();
    updateFavicon(isDarkMode);

    // Listen for changes in color scheme preference
    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // Modern browsers support addEventListener
      if (darkModeQuery.addEventListener) {
        darkModeQuery.addEventListener('change', (e) => {
          updateFavicon(e.matches);
        });
      } 
      // Fallback for older browsers
      else if (darkModeQuery.addListener) {
        darkModeQuery.addListener((e) => {
          updateFavicon(e.matches);
        });
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDynamicFavicon);
  } else {
    // DOM is already ready
    initDynamicFavicon();
  }
})();

