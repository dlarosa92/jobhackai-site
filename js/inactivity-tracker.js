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
    
    // Throttle activity handler to prevent excessive timer resets and console spam
    // Only process activity at most once per second
    ACTIVITY_THROTTLE_MS: 1000,
    
    // Maximum time an operation can be tracked (prevents hanging requests from blocking logout)
    MAX_OPERATION_TIME_MS: 10 * 60 * 1000, // 10 minutes
    
    // Debounce timer resets for operations (prevent rapid resets from retries)
    OPERATION_RESET_DEBOUNCE_MS: 30 * 1000, // 30 seconds
    
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
  let operationTimeouts = new Map(); // Track operation timeout timers
  let broadcastChannel = null;
  let countdownInterval = null;
  let activityThrottleTimer = null;
  let lastActivityProcessTime = 0;
  let resetTimerDebounce = null; // Debounce timer for operation resets
  let lastResetAt = 0; // Timestamp of the last timers reset (used to debounce resetTimers)
  let lastBroadcastResetAt = 0; // Timestamp of last reset triggered by BroadcastChannel (throttle fallback)

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
    // SECURITY FIX: Match navigation.js pattern - check both FirebaseAuthManager exists AND getCurrentUser is a function
    // During initialization, FirebaseAuthManager may exist but getCurrentUser may not be ready yet
    const firebaseManagerExists = !!window.FirebaseAuthManager;
    const getCurrentUserExists = typeof window.FirebaseAuthManager?.getCurrentUser === 'function';
    const hasFirebaseManager = firebaseManagerExists && getCurrentUserExists;
    
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
    
    // Auto-untrack after max operation time (prevents hanging requests from blocking logout)
    // Clear any existing timeout for this operation
    if (operationTimeouts.has(operationId)) {
      clearTimeout(operationTimeouts.get(operationId));
    }
    
    const timeoutId = setTimeout(() => {
      console.log(`[INACTIVITY] Operation ${operationId} exceeded max time (${CONFIG.MAX_OPERATION_TIME_MS / 60000}min), auto-untracking`);
      untrackOperation(operationId);
      operationTimeouts.delete(operationId);
    }, CONFIG.MAX_OPERATION_TIME_MS);
    
    operationTimeouts.set(operationId, timeoutId);
    
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
    
    // Clear timeout if it exists
    if (operationTimeouts.has(operationId)) {
      clearTimeout(operationTimeouts.get(operationId));
      operationTimeouts.delete(operationId);
    }
  }

  /**
   * Extend timer when operations are active
   */
  function extendTimerForOperations() {
    if (activeOperations.size === 0 || !isAuthenticated()) return;
    
    // Debounce rapid resets (prevent rapid retries from resetting timer too often)
    // Only reset once per OPERATION_RESET_DEBOUNCE_MS
    if (resetTimerDebounce) {
      // Already scheduled, skip
      return;
    }
    
    resetTimerDebounce = setTimeout(() => {
      console.log('[INACTIVITY] Extending timer due to active operations');
      // Force bypass debounce for long-running operations so they extend the timers immediately
      resetTimers(true);
      resetTimerDebounce = null;
    }, CONFIG.OPERATION_RESET_DEBOUNCE_MS);
  }

  /**
   * Intercept fetch to detect long-running API calls
   * Handles external wrappers by maintaining a chain of fetch wrappers
   */
  function setupFetchInterceptor() {
    // Check if fetch was already intercepted by this tracker
    if (window.fetch && window.fetch._inactivityTrackerIntercepted) {
      console.log('[INACTIVITY] Fetch already intercepted, skipping');
      return;
    }
    
    // Store the current fetch (before our wrapper) - this maintains the wrapper chain
    // If another script wrapped fetch before us, currentFetch is their wrapper
    // If fetch is native, currentFetch is native fetch
    const currentFetch = window.fetch;
    
    // Store reference to native fetch for potential restoration
    // If fetch has been wrapped, try to get native via _originalFetch chain
    let nativeFetch = window.fetch;
    if (window.fetch._originalFetch) {
      // Another script has wrapped fetch - follow the chain to get native
      nativeFetch = window.fetch._originalFetch;
      console.log('[INACTIVITY] Detected external fetch wrapper, following chain to native fetch');
    }
    
    window.fetch = function(...args) {
      const urlArg = args[0];
      // SECURITY FIX: Handle all fetch() argument types - string, Request object, or URL object
      // fetch() can be called with: fetch('/api/endpoint'), fetch(new Request(...)), or fetch(new URL(...))
      let urlString = null;
      if (typeof urlArg === 'string') {
        urlString = urlArg;
      } else if (urlArg instanceof Request) {
        urlString = urlArg.url;
      } else if (urlArg instanceof URL) {
        urlString = urlArg.href;
      }
      
      const isLongOperation = urlString && CONFIG.LONG_OPERATION_ENDPOINTS.some(
        endpoint => urlString.includes(endpoint)
      );
      
      if (isLongOperation) {
        const operationId = `op_${Date.now()}_${Math.random()}`;
        trackOperation(operationId);
        
        // Use currentFetch to maintain wrapper chain (calls through any external wrappers)
        // This ensures api-retry.js and other wrappers still work correctly
        const fetchPromise = currentFetch.apply(this, args);
        fetchPromise.finally(() => {
          setTimeout(() => untrackOperation(operationId), 2000);
        });
        
        return fetchPromise;
      }
      
      // For non-long operations, pass through to current fetch (maintains wrapper chain)
      return currentFetch.apply(this, args);
    };
    
    // Mark as intercepted and store references for potential restoration and other scripts
    window.fetch._inactivityTrackerIntercepted = true;
    window.fetch._originalFetch = nativeFetch; // Store native fetch (for restoration)
    window.fetch._currentFetch = currentFetch; // Store fetch before our wrapper (for chaining)
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
   * @param {boolean} force - if true, bypass debounce and reset immediately (used by long-running operations)
   */
  function resetTimers(force = false) {
    // Debounce repeated resets coming from internal activity/broadcasts.
    // This prevents the warning/logout schedule from being continuously postponed.
    const now = Date.now();
    const MIN_RESET_INTERVAL_MS = CONFIG.ACTIVITY_THROTTLE_MS || 1000;

    if (!force && (now - lastResetAt < MIN_RESET_INTERVAL_MS)) {
      // Skip if called too soon after the previous reset
      console.log('[INACTIVITY] resetTimers skipped (debounced)', { sinceMs: now - lastResetAt });
      return;
    }
    lastResetAt = now;

    // Clear existing timers
    clearTimers();
    
    // Only set timers if user is authenticated and page is not excluded
    if (!isAuthenticated() || isExcludedPage() || !CONFIG.ENABLED) {
      return;
    }

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
    if (activityThrottleTimer) {
      clearTimeout(activityThrottleTimer);
      activityThrottleTimer = null;
    }
  }

  /**
   * Handle user activity - reset timers (throttled to prevent excessive calls)
   */
  function handleActivity() {
    if (!isAuthenticated() || isExcludedPage()) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastProcess = now - lastActivityProcessTime;
    
    // Throttle: only process activity if enough time has passed
    if (timeSinceLastProcess < CONFIG.ACTIVITY_THROTTLE_MS) {
      // Clear any pending throttle timer and schedule for later
      if (activityThrottleTimer) {
        clearTimeout(activityThrottleTimer);
      }
      
      activityThrottleTimer = setTimeout(() => {
        processActivity();
      }, CONFIG.ACTIVITY_THROTTLE_MS - timeSinceLastProcess);
      
      return;
    }
    
    // Process immediately
    processActivity();
  }
  
  /**
   * Process activity - reset timers and broadcast (called after throttling)
   */
  function processActivity() {
    if (!isAuthenticated() || isExcludedPage()) {
      return;
    }
    
    lastActivityProcessTime = Date.now();
    
    // Clear any pending throttle timer
    if (activityThrottleTimer) {
      clearTimeout(activityThrottleTimer);
      activityThrottleTimer = null;
    }
    
    // Reset timers on any activity
    resetTimers();
    
    // Hide warning if user becomes active again
    if (warningShown) {
      hideWarning();
    }
    
    // Broadcast activity to other tabs (mark as user-initiated so other tabs treat it as real user activity)
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'activity',
        timestamp: Date.now(),
        userInitiated: true
      });
    }
  }

  /**
   * Setup cross-tab synchronization
   */
  function setupCrossTabSync() {
    // Check for BroadcastChannel support before attempting to use it
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[INACTIVITY] BroadcastChannel not supported in this browser, cross-tab sync disabled');
      return;
    }
    
    try {
      broadcastChannel = new BroadcastChannel('inactivity-tracker');
      
      broadcastChannel.onmessage = (event) => {
        const { type } = event.data || {};

        if (type === 'activity') {
          // Prefer explicit user-initiated broadcasts. Producers should send { type: 'activity', userInitiated: true }
          // for real user activity. Otherwise use a throttled fallback to avoid programmatic noise.
          const userInitiated = event.data && event.data.userInitiated === true;
          if (userInitiated && isAuthenticated() && !isExcludedPage()) {
            resetTimers();
            if (warningShown) {
              hideWarning();
            }
          } else {
            // Fallback: allow at most one broadcast-origin reset per BROADCAST_MIN_MS window
            const now = Date.now();
            const BROADCAST_MIN_MS = 30 * 1000; // 30s
            if (!isAuthenticated() || isExcludedPage()) {
              // Don't act on broadcasts for unauthenticated or excluded pages
              return;
            }
            if (now - lastBroadcastResetAt > BROADCAST_MIN_MS) {
              lastBroadcastResetAt = now;
              resetTimers();
              if (warningShown) {
                hideWarning();
              }
              console.log('[INACTIVITY] Broadcast activity accepted (throttled)', event.data);
            } else {
              console.log('[INACTIVITY] Ignoring broadcast activity (not userInitiated, throttled)', { sinceMs: now - lastBroadcastResetAt, data: event.data });
            }
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
      
      console.log('[INACTIVITY] BroadcastChannel initialized successfully');
    } catch (e) {
      console.warn('[INACTIVITY] BroadcastChannel failed to initialize, cross-tab sync disabled:', e);
      broadcastChannel = null;
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
    // SECURITY FIX: firebase-auth-ready event is dispatched on document, not window
    // Custom events dispatched on document do not propagate to window
    // SECURITY FIX: Add listener unconditionally - if FirebaseAuthManager already exists,
    // the event may have already fired, but if it doesn't exist yet, we need to wait for it
    // Match pattern used in navigation.js (line 2148) and cover-letter.js (line 82)
    document.addEventListener('firebase-auth-ready', () => {
      setTimeout(checkAuthAndInit, 500);
    });

    // Also listen for auth state changes via localStorage (if navigation.js updates it)
    window.addEventListener('storage', (e) => {
      if (e.key === 'user-authenticated' || e.key === 'user-email') {
        setTimeout(checkAuthAndInit, 100);
      }
    });

    // Listen for navigation system events
    // Only treat plan changes as user activity when they are explicitly user-initiated.
    window.addEventListener('planChanged', (e) => {
      try {
        const userInitiated = e && e.detail && e.detail.userInitiated === true;
        if (userInitiated && isAuthenticated()) {
          // Genuine user action — reset timers
          resetTimers();
        } else {
          // Programmatic/internal plan change — ignore for inactivity tracking
          console.log('[INACTIVITY] Ignoring programmatic planChanged event for inactivity timers', { userInitiated: !!userInitiated, detail: e && e.detail });
        }
      } catch (err) {
        console.warn('[INACTIVITY] planChanged handler error', err);
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
    
    // Clear all operation timeouts
    operationTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    operationTimeouts.clear();
    
    // Clear reset timer debounce
    if (resetTimerDebounce) {
      clearTimeout(resetTimerDebounce);
      resetTimerDebounce = null;
    }
    
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

