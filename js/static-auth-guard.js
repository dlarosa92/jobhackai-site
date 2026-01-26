// Static Auth Guard for protected HTML pages
// Hides content until auth is confirmed. Redirects unauthenticated users.
// Version: auth-guard-v3-FIREBASE-FIRST
(function () {
  try {
    // Hide page until decision
    document.documentElement.classList.add('auth-pending');

    // Respect forced logout cooldown (60s)
    var ts = parseInt(localStorage.getItem('force-logged-out') || '0', 10);
    if (ts && (Date.now() - ts) < 60000) {
      location.replace('/login.html');
      return;
    }

    function hasFirebaseAuth() {
      try {
        // First check: Look for our auth state flag (set by firebase-auth.js)
        const hasLocalStorageAuth = localStorage.getItem('user-authenticated') === 'true';
        
        // Second check: Look for Firebase SDK auth user shard (more reliable)
        // Firebase SDK writes these keys synchronously on page load if user is authenticated
        // SECURITY: Require BOTH flag AND Firebase keys to prevent XSS attacks from bypassing guard
        // An attacker would need to set both values, not just one
        let hasFirebaseKeys = false;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('firebase:authUser:') === 0) {
            var userData = localStorage.getItem(k);
            if (userData && userData !== 'null' && userData.length > 10) {
              hasFirebaseKeys = true;
              break;
            }
          }
        }
        
        // Require both conditions: flag must be true AND Firebase keys must exist
        // This prevents stale flags or XSS attacks from incorrectly identifying users as authenticated
        return hasLocalStorageAuth && hasFirebaseKeys;
      } catch (_) {}
      return false;
    }

    // Cross-tab logout sync
    try {
      var ch = new BroadcastChannel('auth');
      ch.onmessage = function (e) {
        if (e && (e.type === 'logout' || (e.data && e.data.type === 'logout'))) {
          location.replace('/index.html');
        }
      };
    } catch (_) {}

    // Decide after actively waiting for Firebase auth to appear
    var startTime = Date.now();
    var maxWait = 20000; // Allow extra time for Firebase to rehydrate after cache clears
    var checkInterval = 120; // 120ms polling
    var resolved = false;

    function resolveDecision(isAuthenticated) {
      if (resolved) return;
      resolved = true;
      if (isAuthenticated) {
        document.documentElement.classList.remove('auth-pending');
      } else {
        console.log('⏰ Static auth guard resolved unauthenticated, redirecting to login');
        location.replace('/login.html');
      }
    }

    function resolveFromAuthManager() {
      try {
        if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.isAuthReady === 'function') {
          if (window.FirebaseAuthManager.isAuthReady()) {
            var user = window.FirebaseAuthManager.getCurrentUser && window.FirebaseAuthManager.getCurrentUser();
            resolveDecision(!!user);
            return true;
          }
        }
        if (window.__REAL_AUTH_READY === true) {
          var fallbackUser = window.FirebaseAuthManager && window.FirebaseAuthManager.getCurrentUser && window.FirebaseAuthManager.getCurrentUser();
          resolveDecision(!!fallbackUser);
          return true;
        }
      } catch (_) {}
      return false;
    }

    // Listen for the real auth-ready signal to avoid premature redirects
    try {
      document.addEventListener('firebase-auth-ready', function (e) {
        var user = e && e.detail ? e.detail.user : null;
        resolveDecision(!!user);
      }, { once: true });
    } catch (_) {}

    function checkAndReveal() {
      if (resolved) return;

      if (hasFirebaseAuth()) {
        resolveDecision(true);
        return;
      }

      if (resolveFromAuthManager()) {
        return;
      }

      var elapsed = Date.now() - startTime;
      if (elapsed >= maxWait) {
        // Final check before redirecting
        if (hasFirebaseAuth()) {
          resolveDecision(true);
          return;
        }
        if (resolveFromAuthManager()) {
          return;
        }
        resolveDecision(false);
        return;
      }

      // Keep checking
      setTimeout(checkAndReveal, checkInterval);
    }

    checkAndReveal();
  } catch (_) {
    // Fail safe: if guard errors, go conservative
    try { location.replace('/login.html'); } catch (_) {}
  }
})();

