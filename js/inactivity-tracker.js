// JobHackAI Inactivity Tracker
// Automatically logs out users after 30 minutes of inactivity with 5-minute warning
// Follows UX best practices: clear communication, graceful handling, accessibility
// Integrates with Firebase-first auth system and existing logout flow

(function() {
  'use strict';

  // Configuration - Single timeout for all users/pages
  const CONFIG = {
    // Total inactivity timeout: 30 minutes
    INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
    
    // Warning appears 5 minutes before logout (at 25 minutes)
    WARNING_TIMEOUT_MS: 25 * 60 * 1000,
    
    // Extension for long-running operations (AI generation, etc.)
    LONG_OPERATION_EXTENSION_MS: 5 * 60 * 1000,
    
    // Minimum time between warnings (prevent spam)
    WARNING_COOLDOWN_MS: 2 * 60 * 1000,
    
    // Only track these long-running endpoints (not all fetches)
    LONG_OPERATION_ENDPOINTS: [
      '/api/resume-feedback',
      '/api/resume-rewrite',
      '/api/ats-score',
      '/api/cover-letter',
      '/api/interview-questions'
    ],
    
    // Activity events to track
    ACTIVITY_EVENTS: ['mousedown', 'mousemove', 'keypress', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'],
    
    // Pages where tracking is disabled
    EXCLUDED_PAGES: ['/login.html', '/index.html'],
    
    // Enable/disable tracker
    ENABLED: true
  };

  // State
  let inactivityTimer = null;
  let warningTimer = null;
  let warningShown = false;
  let lastWarningTime = 0;
  let isInitialized = false;
  let activeOperations = new Set();
  let broadcastChannel = null;
  let countdownInterval = null;

  /**
   * Check if user is authenticated - Firebase-first (matches navigation.js pattern)
   */
  function isAuthenticated() {
    // Match navigation.js getAuthState() pattern - Firebase first
    const logoutIntent = sessionStorage.getItem('logout-intent');
    if (logoutIntent === '1') {
      return false;
    }
    
    // Firebase is source of truth
    let firebaseUser = null;
    try {
      if (window.FirebaseAuthManager) {
        const getCurrentUserExists = typeof window.FirebaseAuthManager.getCurrentUser === 'function';
        if (getCurrentUserExists) {
          firebaseUser = window.FirebaseAuthManager.getCurrentUser();
        }
      }
    } catch (error) {
      console.warn('[INACTIVITY] Error checking Firebase auth:', error.message);
    }
    
    if (firebaseUser) {
      return true;
    }
    
    // Only check localStorage if Firebase not initialized
    const hasFirebaseManager = !!window.FirebaseAuthManager;
    if (!hasFirebaseManager) {
      try {
        const authState = localStorage.getItem('user-authenticated');
        const userEmail = localStorage.getItem('user-email');
        // Validate email format (matches navigation.js validation)
        return authState === 'true' && userEmail && userEmail.length > 0 && userEmail.includes('@');
      } catch (e) {
        return false;
      }
    }
    
    return false;
  }

  /**
   * Check if current page should be excluded
   */
  function isExcludedPage() {
    const path = window.location.pathname;
    return CONFIG.EXCLUDED_PAGES.some(excluded => path.includes(excluded));
  }

  /**
   * Track active operations (API calls, AI generation)
   */
  function trackOperation(operationId) {
    activeOperations.add(operationId);
    // Extend timer if operation is active
    if (activeOperations.size > 0) {
      extendTimerForOperations();
    }
  }

  /**
   * Stop tracking an operation
   */
  function untrackOperation(operationId) {
    activeOperations.delete(operationId);
  }

  /**
   * Extend timer when operations are active
   */
  function extendTimerForOperations() {
    if (activeOperations.size === 0 || !isAuthenticated()) return;
    
    // Reset timers to give more time for operations
    console.log('[INACTIVITY] Extending timer due to active operations');
    resetTimers();
  }

  /**
   * Intercept fetch to detect long-running API calls
   */
  function setupFetchInterceptor() {
    // Check if fetch was already intercepted by this tracker
    if (window.fetch && window.fetch._inactivityTrackerIntercepted) {
      console.log('[INACTIVITY] Fetch already intercepted, skipping');
      return;
    }
    
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      const isLongOperation = CONFIG.LONG_OPERATION_ENDPOINTS.some(
        endpoint => typeof url === 'string' && url.includes(endpoint)
      );
      
      if (isLongOperation) {
        const operationId = `op_${Date.now()}_${Math.random()}`;
        trackOperation(operationId);
        
        const fetchPromise = originalFetch.apply(this, args);
        fetchPromise.finally(() => {
          setTimeout(() => untrackOperation(operationId), 2000);
        });
        
        return fetchPromise;
      }
      
      return originalFetch.apply(this, args);
    };
    
    // Mark as intercepted and store original for potential restoration
    window.fetch._inactivityTrackerIntercepted = true;
    window.fetch._originalFetch = originalFetch;
  }

  /**
   * Show warning banner with countdown - Matches JobHackAI Design System
   */
  function showWarning() {
    const now = Date.now();
    
    // Respect cooldown
    if (now - lastWarningTime < CONFIG.WARNING_COOLDOWN_MS && warningShown) {
      return;
    }
    
    if (warningShown) return;
    
    // Clear any existing countdown interval before creating new one
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    
    warningShown = true;
    lastWarningTime = now;

    // Calculate time remaining
    const timeRemaining = CONFIG.INACTIVITY_TIMEOUT_MS - CONFIG.WARNING_TIMEOUT_MS;
    let minutesRemaining = Math.ceil(timeRemaining / 60000);

    // Inject styles if not already present
    if (!document.getElementById('inactivity-warning-styles')) {
      const style = document.createElement('style');
      style.id = 'inactivity-warning-styles';
      style.textContent = `
        /* Inactivity Warning Banner - Matches JobHackAI Design System */
        #inactivity-warning {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 10000;
          background: #FEF3C7;
          border-bottom: 4px solid #D97706;
          color: #92400E;
          font-family: var(--font-family-base, 'Inter', sans-serif);
          font-size: var(--font-size-sm, 0.95rem);
          font-weight: var(--font-weight-medium, 500);
          line-height: 1.5;
          padding: var(--space-sm, 1rem) var(--space-lg, 2rem);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-md, 0 2px 6px rgba(0,0,0,0.05));
          animation: inactivitySlideDown 0.3s ease-out;
          transform-origin: top;
        }
        
        #inactivity-warning .warning-content {
          max-width: 1200px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-sm, 1rem);
          flex-wrap: wrap;
        }
        
        #inactivity-warning .warning-message {
          flex: 1;
          min-width: 200px;
          display: flex;
          align-items: center;
          gap: var(--space-xs, 0.5rem);
        }
        
        #inactivity-warning .warning-icon {
          font-size: 1.2rem;
          flex-shrink: 0;
        }
        
        #inactivity-warning .warning-text {
          color: #92400E;
          font-weight: var(--font-weight-medium, 500);
        }
        
        #inactivity-warning .countdown {
          font-weight: var(--font-weight-semibold, 600);
          color: #92400E;
        }
        
        #inactivity-stay-logged-in {
          background: var(--color-cta-green, #00E676);
          color: #FFFFFF !important;
          font-weight: var(--font-weight-bold, 700);
          font-size: var(--font-size-base, 1rem);
          border: none;
          border-radius: var(--radius-lg, 12px);
          padding: 0.7rem 1.5rem;
          cursor: pointer;
          box-shadow: var(--shadow-button, 0 2px 8px rgba(0,0,0,0.04));
          transition: background var(--transition-normal, 200ms ease-in-out),
                      box-shadow var(--transition-normal, 200ms ease-in-out),
                      transform var(--transition-fast, 150ms ease-in-out);
          white-space: nowrap;
          flex-shrink: 0;
        }
        
        #inactivity-stay-logged-in:hover {
          background: var(--color-cta-green-hover, #00c965);
          box-shadow: var(--shadow-button-hover, 0 4px 16px rgba(0,230,118,0.10));
          transform: translateY(-1px);
        }
        
        #inactivity-stay-logged-in:focus {
          outline: 3px solid rgba(0, 230, 118, 0.3);
          outline-offset: 2px;
        }
        
        #inactivity-stay-logged-in:active {
          transform: translateY(0);
        }
        
        @keyframes inactivitySlideDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        
        @media (max-width: 768px) {
          #inactivity-warning {
            padding: var(--space-sm, 1rem);
          }
          
          #inactivity-warning .warning-content {
            flex-direction: column;
            align-items: stretch;
            gap: var(--space-xs, 0.5rem);
          }
          
          #inactivity-warning .warning-message {
            text-align: center;
            justify-content: center;
          }
          
          #inactivity-stay-logged-in {
            width: 100%;
            padding: 0.75rem 1.5rem;
          }
        }
        
        @media (prefers-reduced-motion: reduce) {
          #inactivity-warning {
            animation: none;
          }
          
          @keyframes inactivitySlideDown {
            from, to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Create warning banner
    const warningBanner = document.createElement('div');
    warningBanner.id = 'inactivity-warning';
    warningBanner.setAttribute('role', 'alert');
    warningBanner.setAttribute('aria-live', 'polite');
    
    const countdownId = `inactivity-countdown-${Date.now()}`;
    warningBanner.innerHTML = `
      <div class="warning-content">
        <div class="warning-message">
          <span class="warning-icon" aria-hidden="true">⚠️</span>
          <span class="warning-text">
            You've been inactive for a while. You'll be logged out in 
            <span class="countdown" id="${countdownId}">${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}</span> 
            for security.
          </span>
        </div>
        <button 
          id="inactivity-stay-logged-in" 
          type="button"
          aria-label="Stay logged in and reset inactivity timer"
        >
          Stay Logged In
        </button>
      </div>
    `;

    document.body.appendChild(warningBanner);

    // Update countdown every minute
    let remaining = minutesRemaining;
    countdownInterval = setInterval(() => {
      remaining--;
      const countdownEl = document.getElementById(countdownId);
      if (countdownEl && remaining > 0) {
        countdownEl.textContent = `${remaining} minute${remaining !== 1 ? 's' : ''}`;
        // Announce to screen readers
        warningBanner.setAttribute('aria-live', 'assertive');
      } else {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }, 60000);

    // Handle "Stay Logged In" button
    const stayButton = document.getElementById('inactivity-stay-logged-in');
    if (stayButton) {
      stayButton.addEventListener('click', (e) => {
        e.preventDefault();
        resetTimers();
        hideWarning();
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        
        // Announce to screen readers
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.className = 'sr-only';
        announcement.style.cssText = 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0;';
        announcement.textContent = 'Inactivity timer reset. You will remain logged in.';
        document.body.appendChild(announcement);
        setTimeout(() => announcement.remove(), 1000);
      });
      
      // Focus the button for keyboard accessibility
      setTimeout(() => stayButton.focus(), 100);
    }

    // Broadcast warning to other tabs
    if (broadcastChannel) {
      broadcastChannel.postMessage({ 
        type: 'inactivity-warning', 
        timestamp: now 
      });
    }

    console.log(`[INACTIVITY] Warning shown: ${minutesRemaining} minutes remaining`);
  }

  /**
   * Hide warning banner
   */
  function hideWarning() {
    if (!warningShown) return;
    
    warningShown = false;
    const warningBanner = document.getElementById('inactivity-warning');
    if (warningBanner) {
      // Clear any pending hide timeout to prevent race conditions
      if (warningBanner._hideTimeout) {
        clearTimeout(warningBanner._hideTimeout);
        warningBanner._hideTimeout = null;
      }
      
      warningBanner.style.animation = 'inactivitySlideDown 0.3s ease-out reverse';
      warningBanner._hideTimeout = setTimeout(() => {
        if (warningBanner.parentNode) {
          warningBanner.remove();
        }
        warningBanner._hideTimeout = null;
      }, 300);
    }
    
    // Clear countdown interval
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  /**
   * Logout user due to inactivity
   */
  function logoutDueToInactivity() {
    console.log('[INACTIVITY] Auto-logout due to inactivity');
    
    // Hide warning
    hideWarning();
    
    // Clear timers
    clearTimers();
    
    // Broadcast logout to other tabs
    if (broadcastChannel) {
      broadcastChannel.postMessage({ 
        type: 'inactivity-logout', 
        timestamp: Date.now() 
      });
    }
    
    // Use existing logout function from navigation.js (matches our recent fixes)
    if (window.JobHackAINavigation && typeof window.JobHackAINavigation.logout === 'function') {
      window.JobHackAINavigation.logout();
    } else if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.signOut === 'function') {
      window.FirebaseAuthManager.signOut().then(() => {
        window.location.replace('/login.html?reason=inactivity');
      }).catch(() => {
        window.location.replace('/login.html?reason=inactivity');
      });
    } else {
      // Fallback: clear storage and redirect
      try {
        localStorage.removeItem('user-authenticated');
        localStorage.removeItem('user-email');
        localStorage.removeItem('user-plan');
        localStorage.removeItem('auth-user');
        // Clear Firebase auth keys
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith('firebase:authUser:')) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.warn('[INACTIVITY] Failed to clear storage:', e);
      }
      window.location.replace('/login.html?reason=inactivity');
    }
  }

  /**
   * Reset inactivity timers
   */
  function resetTimers() {
    // Clear existing timers
    clearTimers();
    
    // Only set timers if user is authenticated and page is not excluded
    if (!isAuthenticated() || isExcludedPage() || !CONFIG.ENABLED) {
      return;
    }

    const now = Date.now();
    lastWarningTime = now;

    // Set warning timer
    warningTimer = setTimeout(() => {
      if (isAuthenticated() && !isExcludedPage()) {
        showWarning();
      }
    }, CONFIG.WARNING_TIMEOUT_MS);

    // Set logout timer
    inactivityTimer = setTimeout(() => {
      if (isAuthenticated() && !isExcludedPage()) {
        logoutDueToInactivity();
      }
    }, CONFIG.INACTIVITY_TIMEOUT_MS);

    console.log(`[INACTIVITY] Timers reset. Warning in ${CONFIG.WARNING_TIMEOUT_MS / 60000}min, logout in ${CONFIG.INACTIVITY_TIMEOUT_MS / 60000}min`);
  }

  /**
   * Clear all timers
   */
  function clearTimers() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  /**
   * Handle user activity - reset timers
   */
  function handleActivity() {
    if (!isAuthenticated() || isExcludedPage()) {
      return;
    }
    
    // Reset timers on any activity
    resetTimers();
    
    // Hide warning if user becomes active again
    if (warningShown) {
      hideWarning();
    }
    
    // Broadcast activity to other tabs
    if (broadcastChannel) {
      broadcastChannel.postMessage({ 
        type: 'activity', 
        timestamp: Date.now() 
      });
    }
  }

  /**
   * Setup cross-tab synchronization
   */
  function setupCrossTabSync() {
    try {
      broadcastChannel = new BroadcastChannel('inactivity-tracker');
      
      broadcastChannel.onmessage = (event) => {
        const { type } = event.data || {};
        
        if (type === 'activity') {
          // Another tab detected activity, reset timers
          resetTimers();
          if (warningShown) {
            hideWarning();
          }
        } else if (type === 'inactivity-warning') {
          // Another tab showed warning, show it here too
          if (!warningShown && isAuthenticated() && !isExcludedPage()) {
            showWarning();
          }
        } else if (type === 'inactivity-logout') {
          // Another tab logged out, logout here too
          if (isAuthenticated()) {
            logoutDueToInactivity();
          }
        }
      };
    } catch (e) {
      console.warn('[INACTIVITY] BroadcastChannel not supported, cross-tab sync disabled:', e);
    }
  }

  /**
   * Initialize the inactivity tracker
   */
  function init() {
    if (isInitialized) {
      console.warn('[INACTIVITY] Tracker already initialized');
      return;
    }

    if (!CONFIG.ENABLED) {
      console.log('[INACTIVITY] Tracker disabled');
      return;
    }

    // Setup cross-tab sync
    setupCrossTabSync();

    // Setup fetch interceptor for long operations
    setupFetchInterceptor();

    // Wait for auth state to be ready
    const checkAuthAndInit = () => {
      // Prevent duplicate initialization and listener registration
      if (isInitialized) {
        return;
      }
      
      if (isAuthenticated() && !isExcludedPage()) {
        // Set up activity listeners
        CONFIG.ACTIVITY_EVENTS.forEach(eventType => {
          document.addEventListener(eventType, handleActivity, { passive: true });
        });

        // Listen for visibility changes (tab focus/blur)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && isAuthenticated() && !isExcludedPage()) {
            // Reset timers when tab becomes visible
            resetTimers();
          }
        });

        // Listen for focus events (window focus)
        window.addEventListener('focus', () => {
          if (isAuthenticated() && !isExcludedPage()) {
            resetTimers();
          }
        });

        // Initialize timers
        resetTimers();
        isInitialized = true;
        console.log('[INACTIVITY] Tracker initialized (30min timeout, 5min warning)');
      }
    };

    // Try to initialize immediately
    checkAuthAndInit();

    // Listen for auth state changes
    if (window.FirebaseAuthManager) {
      window.addEventListener('firebase-auth-ready', () => {
        setTimeout(checkAuthAndInit, 500);
      });
    }

    // Also listen for auth state changes via localStorage (if navigation.js updates it)
    window.addEventListener('storage', (e) => {
      if (e.key === 'user-authenticated' || e.key === 'user-email') {
        setTimeout(checkAuthAndInit, 100);
      }
    });

    // Listen for navigation system events
    window.addEventListener('planChanged', () => {
      // Reset timers on plan change (user is active)
      if (isAuthenticated()) {
        resetTimers();
      }
    });

    // Fallback: check periodically if auth becomes available
    let checkAttempts = 0;
    const maxAttempts = 10;
    const checkInterval = setInterval(() => {
      checkAttempts++;
      if (isAuthenticated() && !isExcludedPage() && !isInitialized) {
        checkAuthAndInit();
      }
      if (checkAttempts >= maxAttempts || isInitialized) {
        clearInterval(checkInterval);
      }
    }, 1000);
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    clearTimers();
    hideWarning();
    activeOperations.clear();
    
    CONFIG.ACTIVITY_EVENTS.forEach(eventType => {
      document.removeEventListener(eventType, handleActivity);
    });
    
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
    
    isInitialized = false;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    setTimeout(init, 100);
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  // Export for manual control and testing
  window.InactivityTracker = {
    init,
    reset: resetTimers,
    cleanup,
    showWarning: () => { if (isAuthenticated()) showWarning(); }, // For testing
    config: CONFIG,
    // Manual operation tracking (for pages that want to explicitly track operations)
    trackOperation,
    untrackOperation
  };

  console.log('[INACTIVITY] Inactivity tracker module loaded');
})();

