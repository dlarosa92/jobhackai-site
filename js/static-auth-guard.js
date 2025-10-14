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
        // Check for actual Firebase auth user shard
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('firebase:authUser:') === 0) {
            var userData = localStorage.getItem(k);
            if (userData && userData !== 'null' && userData.length > 10) {
              return true;
            }
          }
        }
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
    var maxWait = 8000; // 8 seconds max
    var checkInterval = 100; // 100ms polling

    function checkAndReveal() {
      var elapsed = Date.now() - startTime;

      if (hasFirebaseAuth()) {
        // Firebase auth confirmed - reveal page
        document.documentElement.classList.remove('auth-pending');
        return;
      }

      if (elapsed >= maxWait) {
        // Timeout - redirect to login
        location.replace('/login.html');
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


