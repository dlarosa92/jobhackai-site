// Static Auth Guard for protected HTML pages
// Hides content until auth is confirmed. Redirects unauthenticated users.
// Version: auth-guard-v2-FIREBASE-FIX
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

    function isAuthed() {
      try {
        var ua = localStorage.getItem('user-authenticated') === 'true';
        var email = !!localStorage.getItem('user-email');
        if (ua && email) return true;
        // Optional: trust firebase shard only if present (same profile)
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf('firebase:authUser:') === 0 || k.indexOf('firebase:host:') === 0)) {
            return true;
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

    // Decide with a short grace period (longer after Stripe return)
    var isPaidReturn = location.search.indexOf('paid=1') !== -1;
    var grace = isPaidReturn ? 10000 : 5000;
    if (!isAuthed()) {
      setTimeout(function(){ if (!isAuthed()) location.replace('/login.html'); }, grace);
    }

    // Reveal when authenticated
    document.documentElement.classList.remove('auth-pending');
  } catch (_) {
    // Fail safe: if guard errors, go conservative
    try { location.replace('/login.html'); } catch (_) {}
  }
})();


