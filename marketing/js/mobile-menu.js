// Centralized Mobile Menu Handler
// Prevents conflicts from multiple initializations and ensures proper state management

(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.MobileMenuInitialized) {
    console.warn('[MobileMenu] Already initialized, skipping duplicate initialization');
    return;
  }

  let isMenuOpen = false;
  let mobileToggle = null;
  let mobileNav = null;
  let backdrop = null;
  let eventListeners = [];

  // Cleanup function to remove all event listeners
  function cleanup() {
    eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    eventListeners = [];
  }

  // Helper to add event listener with tracking
  function addTrackedListener(element, event, handler) {
    element.addEventListener(event, handler);
    eventListeners.push({ element, event, handler });
  }

  // Function to open menu
  function openMenu() {
    if (isMenuOpen || !mobileNav) return;
    
    isMenuOpen = true;
    mobileNav.classList.add('open');
    if (backdrop) {
      backdrop.classList.add('show');
    }
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', 'true');
    }
    // Prevent body scroll when menu is open
    document.body.style.overflow = 'hidden';
    
    // Ensure backdrop exists
    if (!backdrop) {
      backdrop = document.getElementById('mobileNavBackdrop');
      if (!backdrop) {
        // Create backdrop if it doesn't exist
        backdrop = document.createElement('div');
        backdrop.id = 'mobileNavBackdrop';
        backdrop.className = 'mobile-nav-backdrop';
        document.body.appendChild(backdrop);
        addTrackedListener(backdrop, 'click', closeMenu);
      }
    }
  }

  // Function to close menu
  function closeMenu() {
    if (!isMenuOpen) return;
    
    isMenuOpen = false;
    if (mobileNav) {
      mobileNav.classList.remove('open');
    }
    if (backdrop) {
      backdrop.classList.remove('show');
    }
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
    // Restore body scroll
    document.body.style.overflow = '';
  }

  // Toggle menu function
  function toggleMenu(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Initialize mobile menu
  function initMobileMenu() {
    // Get elements
    mobileToggle = document.querySelector('.mobile-toggle');
    mobileNav = document.getElementById('mobileNav');
    backdrop = document.getElementById('mobileNavBackdrop');

    if (!mobileToggle || !mobileNav) {
      console.warn('[MobileMenu] Required elements not found:', {
        toggle: !!mobileToggle,
        nav: !!mobileNav
      });
      return false;
    }

    // Ensure backdrop exists
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'mobileNavBackdrop';
      backdrop.className = 'mobile-nav-backdrop';
      document.body.appendChild(backdrop);
    }

    // Reset state
    isMenuOpen = false;
    closeMenu();

    // Add event listeners
    addTrackedListener(mobileToggle, 'click', toggleMenu);
    addTrackedListener(backdrop, 'click', closeMenu);

    // Close menu when clicking on a link inside mobile nav
    addTrackedListener(mobileNav, 'click', function(e) {
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        // Small delay to allow navigation
        setTimeout(closeMenu, 100);
      }
    });

    // Close menu on Escape key
    addTrackedListener(document, 'keydown', function(e) {
      if (e.key === 'Escape' && isMenuOpen) {
        closeMenu();
      }
    });

    // Close menu on window resize (if resizing to desktop)
    addTrackedListener(window, 'resize', function() {
      if (window.innerWidth > 900 && isMenuOpen) {
        closeMenu();
      }
    });

    // Close menu when clicking outside (but not on toggle or nav)
    addTrackedListener(document, 'click', function(e) {
      if (isMenuOpen && 
          !mobileNav.contains(e.target) && 
          !mobileToggle.contains(e.target) &&
          !backdrop.contains(e.target)) {
        closeMenu();
      }
    });

    console.log('[MobileMenu] Initialized successfully');
    return true;
  }

  // Re-initialize when navigation updates (for dynamic content)
  function reinitOnNavigationUpdate() {
    // Cleanup old listeners
    cleanup();
    
    // Re-get elements (they might have been replaced)
    mobileToggle = document.querySelector('.mobile-toggle');
    mobileNav = document.getElementById('mobileNav');
    backdrop = document.getElementById('mobileNavBackdrop');
    
    // Re-initialize
    if (mobileToggle && mobileNav) {
      initMobileMenu();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileMenu);
  } else {
    // DOM already loaded
    initMobileMenu();
  }

  // Re-initialize when navigation system updates (for dynamic nav content)
  window.addEventListener('navigationReady', function() {
    setTimeout(reinitOnNavigationUpdate, 100);
  });

  // Also listen for custom navigation update events
  window.addEventListener('navigationUpdated', reinitOnNavigationUpdate);

  // Expose API for manual control
  window.MobileMenu = {
    open: openMenu,
    close: closeMenu,
    toggle: toggleMenu,
    isOpen: () => isMenuOpen,
    reinit: reinitOnNavigationUpdate
  };

  // Mark as initialized
  window.MobileMenuInitialized = true;
})();

