// Universal Logout Binding
(function(){
  function callRobustSignOut(){
    try {
      if (window.JobHackAINavigation && typeof window.JobHackAINavigation.logout === 'function') {
        return window.JobHackAINavigation.logout();
      }
      if (typeof window.logout === 'function') {
        return window.logout();
      }
    } catch (_) {}
    // Fallback: navigate to marketing home (no login.html on marketing domain)
    try { location.replace('/'); } catch (_) {}
  }

  // Delegate clicks to any logout-looking control
  addEventListener('click', function(e){
    var a = e.target && (e.target.closest && (e.target.closest('[data-action="logout"], [data-logout], a[href="#logout"], a[href="/logout"], a[href*="logout"]')));
    if (!a) return;
    e.preventDefault();
    Promise.resolve(callRobustSignOut()).catch(function(){
      try { location.replace('/'); } catch (_) {}
    });
  }, true);

  // Listen for cross-tab logout
  try {
    var ch = new BroadcastChannel('auth');
    ch.onmessage = function (e) {
      if (e && (e.type === 'logout' || (e.data && e.data.type === 'logout'))) {
        location.replace('/');
      }
    };
  } catch (_) {}
})();

