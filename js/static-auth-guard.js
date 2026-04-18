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

    function getFirebaseAuthStorages() {
      return [sessionStorage, localStorage];
    }

    function hasFirebaseAuthShardInStorage(storage) {
      if (!storage) return false;
      try {
        for (var i = 0; i < storage.length; i++) {
          var key = storage.key(i);
          var value = key ? storage.getItem(key) : null;
          if (key && key.indexOf('firebase:authUser:') === 0 && value && value !== 'null' && value.length > 10) {
            return true;
          }
        }
      } catch (_) {}
      return false;
    }

    function hasFirebaseAuth() {
      try {
        // First check: Look for our auth state flag (set by firebase-auth.js)
        const hasAuthStateFlag = localStorage.getItem('user-authenticated') === 'true'
          || sessionStorage.getItem('user-authenticated') === 'true';
        
        let hasFirebaseKeys = false;
        var storages = getFirebaseAuthStorages();
        for (var storageIndex = 0; storageIndex < storages.length; storageIndex++) {
          if (hasFirebaseAuthShardInStorage(storages[storageIndex])) {
            hasFirebaseKeys = true;
            break;
          }
        }
        
        // Require both conditions: flag must be true AND Firebase keys must exist
        // This prevents stale flags or XSS attacks from incorrectly identifying users as authenticated
        return hasAuthStateFlag && hasFirebaseKeys;
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
