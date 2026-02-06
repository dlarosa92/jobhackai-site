(function loadMarketingNavigationCore() {
  var coreSrc = '/js/navigation-core.js?v=20260206-1';

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.write('<script src="' + coreSrc + '"><\\/script>');
    return;
  }

  var script = document.createElement('script');
  script.src = coreSrc;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
