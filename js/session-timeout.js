// Session Timeout Manager for JobHackAI
// Automatically logs out users after 30 minutes of inactivity
// Version: 1.0

(function () {
  'use strict';

  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const WARNING_TIMEOUT_MS = SESSION_TIMEOUT_MS - (2 * 60 * 1000); // 2 minutes before logout
  const CHECK_INTERVAL_MS = 60000; // Check every minute

  let lastActivityTime = Date.now();
  let sessionTimer = null;
  let warningTimer = null;
  let isWarningShown = false;
  let checkInterval = null;

  // Activity events that reset the session timer
  const ACTIVITY_EVENTS = [
    'mousedown',
    'mousemove',
    'keypress',
    'scroll',
    'touchstart',
    'click'
  ];

  /**
   * Reset session timer when user activity is detected
   */
  function resetSessionTimer() {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;
    
    // Only reset if it's been at least 1 minute since last activity
    // This prevents excessive resets during active use
    if (timeSinceLastActivity >= 60000) {
      lastActivityTime = now;
      console.log('⏱️ Session activity detected, timer reset');
      
      // Hide warning if showing
      if (isWarningShown) {
        hideWarning();
      }
      
      // Restart timers
      setupTimers();
    }
  }

  /**
   * Show session warning modal
   */
  function showWarning() {
    if (isWarningShown) return;
    isWarningShown = true;

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'session-warning-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:100000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s;';
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background:#fff;border-radius:16px;padding:2rem 2.5rem;max-width:450px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    const title = document.createElement('h2');
    title.style.cssText = 'margin:0 0 1rem 0;color:#232B36;font-size:1.5rem;font-weight:700;';
    title.textContent = '⚠️ Session Timeout Warning';
    
    const message = document.createElement('p');
    message.style.cssText = 'margin:0 0 1.5rem 0;color:#4B5563;font-size:1.05rem;line-height:1.6;';
    message.textContent = 'Your session will expire in 2 minutes due to inactivity. Click "Stay Logged In" to continue.';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display:flex;gap:0.75rem;justify-content:flex-end;';
    
    const stayLoggedInBtn = document.createElement('button');
    stayLoggedInBtn.style.cssText = 'background:#00E676;color:#fff;border:none;padding:0.75rem 1.5rem;border-radius:8px;font-weight:600;font-size:1.05rem;cursor:pointer;transition:background 0.2s;';
    stayLoggedInBtn.textContent = 'Stay Logged In';
    stayLoggedInBtn.onmouseover = () => stayLoggedInBtn.style.background = '#00c965';
    stayLoggedInBtn.onmouseout = () => stayLoggedInBtn.style.background = '#00E676';
    stayLoggedInBtn.onclick = () => {
      resetSessionTimer();
      hideWarning();
    };
    
    const logoutBtn = document.createElement('button');
    logoutBtn.style.cssText = 'background:#F3F4F6;color:#6B7280;border:none;padding:0.75rem 1.5rem;border-radius:8px;font-weight:600;font-size:1.05rem;cursor:pointer;transition:background 0.2s;';
    logoutBtn.textContent = 'Log Out Now';
    logoutBtn.onmouseover = () => logoutBtn.style.background = '#E5E7EB';
    logoutBtn.onmouseout = () => logoutBtn.style.background = '#F3F4F6';
    logoutBtn.onclick = () => {
      handleSessionTimeout();
    };
    
    buttonContainer.appendChild(stayLoggedInBtn);
    buttonContainer.appendChild(logoutBtn);
    modalContent.appendChild(title);
    modalContent.appendChild(message);
    modalContent.appendChild(buttonContainer);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add fade-in animation if not already in stylesheet
    if (!document.getElementById('session-timeout-styles')) {
      const styles = document.createElement('style');
      styles.id = 'session-timeout-styles';
      styles.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}';
      document.head.appendChild(styles);
    }
    
    console.log('⚠️ Session warning shown');
  }

  /**
   * Hide session warning modal
   */
  function hideWarning() {
    const modal = document.getElementById('session-warning-modal');
    if (modal) {
      modal.remove();
      isWarningShown = false;
    }
  }

  /**
   * Handle session timeout by logging out the user
   */
  function handleSessionTimeout() {
    console.log('⏱️ Session expired - logging out');
    
    // Clear timers
    if (sessionTimer) clearTimeout(sessionTimer);
    if (warningTimer) clearTimeout(warningTimer);
    if (checkInterval) clearInterval(checkInterval);
    
    // Hide warning
    hideWarning();
    
    // Try to use Firebase auth signOut if available
    if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.signOut === 'function') {
      window.FirebaseAuthManager.signOut();
    } else if (window.authManager && typeof window.authManager.signOut === 'function') {
      window.authManager.signOut();
    } else {
      // Fallback: Clear localStorage and redirect
      localStorage.clear();
      sessionStorage.clear();
    }
    
    // Redirect to login with expired parameter
    const currentPath = window.location.pathname;
    if (currentPath.includes('dashboard') || currentPath.includes('account') || currentPath.includes('billing')) {
      window.location.href = '/login.html?expired=1';
    } else {
      window.location.href = '/login.html?expired=1';
    }
  }

  /**
   * Setup session timers
   */
  function setupTimers() {
    // Clear existing timers
    if (sessionTimer) clearTimeout(sessionTimer);
    if (warningTimer) clearTimeout(warningTimer);
    
    // Warning timer (2 minutes before logout)
    warningTimer = setTimeout(() => {
      showWarning();
    }, WARNING_TIMEOUT_MS);
    
    // Session timeout (actual logout)
    sessionTimer = setTimeout(() => {
      handleSessionTimeout();
    }, SESSION_TIMEOUT_MS);
    
    console.log(`⏱️ Session timers setup: ${SESSION_TIMEOUT_MS / 1000}s timeout, ${WARNING_TIMEOUT_MS / 1000}s warning`);
  }

  /**
   * Initialize session timeout manager
   */
  function init() {
    // Only run on authenticated pages
    const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
    if (!isAuthenticated) {
      console.log('⏱️ Session timeout skipped - user not authenticated');
      return;
    }

    console.log('⏱️ Session timeout manager initialized');
    
    // Listen for user activity
    ACTIVITY_EVENTS.forEach(eventType => {
      document.addEventListener(eventType, resetSessionTimer, { passive: true });
    });
    
    // Initial timer setup
    setupTimers();
    
    // Periodic check to ensure timers are running
    checkInterval = setInterval(() => {
      const timeSinceLastActivity = Date.now() - lastActivityTime;
      const shouldBeWarned = timeSinceLastActivity >= WARNING_TIMEOUT_MS;
      const shouldBeTimedOut = timeSinceLastActivity >= SESSION_TIMEOUT_MS;
      
      if (shouldBeTimedOut) {
        handleSessionTimeout();
      } else if (shouldBeWarned && !isWarningShown) {
        showWarning();
      }
    }, CHECK_INTERVAL_MS);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for manual control if needed
  window.SessionTimeout = {
    reset: resetSessionTimer,
    logout: handleSessionTimeout
  };
})();

