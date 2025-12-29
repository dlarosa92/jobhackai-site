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
    var maxWait = 10000; // Increased to 10 seconds to allow Firebase auth to initialize
    var checkInterval = 100; // 100ms polling

    function checkAndReveal() {
      var elapsed = Date.now() - startTime;

      if (hasFirebaseAuth()) {
        // Firebase auth confirmed - reveal page
        // But still wait for firebase-auth-ready event to ensure proper initialization
        // The page content visibility is controlled by account-protected class
        document.documentElement.classList.remove('auth-pending');
        return;
      }

      if (elapsed >= maxWait) {
        // Timeout - check one more time before redirecting
        // Sometimes Firebase auth takes a moment to initialize even if localStorage is set
        var finalCheck = hasFirebaseAuth();
        if (!finalCheck) {
          // Still no auth after timeout - redirect to login
          console.log('⏰ Static auth guard timeout - no auth found, redirecting to login');
          location.replace('/login.html');
          return;
        } else {
          // Auth found on final check - reveal page
          document.documentElement.classList.remove('auth-pending');
          return;
        }
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


