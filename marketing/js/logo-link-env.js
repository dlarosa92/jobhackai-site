(function () {
  function resolveLogoHref() {
    var hostname = (window.location.hostname || '').toLowerCase();
    var isDevOrQaHost = hostname === 'dev.jobhackai.io' || hostname === 'qa.jobhackai.io';
    return isDevOrQaHost ? '/' : 'https://jobhackai.io/';
  }

  function applyLogoHref() {
    var logoHref = resolveLogoHref();
    var logos = document.querySelectorAll('.nav-logo, .verify-page-logo');
    logos.forEach(function (logo) {
      try {
        var anchor = (logo.tagName && logo.tagName.toLowerCase() === 'a')
          ? logo
          : (typeof logo.closest === 'function' ? logo.closest('a') : null);
        if (anchor) {
          anchor.setAttribute('href', logoHref);
        }
      } catch (_) {}

      logo.onclick = function (event) {
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1)) {
          return;
        }
        window.location.href = logoHref;
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLogoHref);
  } else {
    applyLogoHref();
  }
})();
