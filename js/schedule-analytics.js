(function scheduleAnalyticsLoad() {
  function loadAnalytics() {
    if (document.querySelector('script[data-jh-analytics]')) return;
    var script = document.createElement('script');
    script.src = 'js/analytics.js';
    script.type = 'module';
    script.dataset.jhAnalytics = 'true';
    document.body.appendChild(script);
  }

  function queueLoad() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadAnalytics, { timeout: 3000 });
    } else {
      setTimeout(loadAnalytics, 1200);
    }
  }

  if (document.readyState === 'complete') {
    queueLoad();
  } else {
    window.addEventListener('load', queueLoad, { once: true });
  }
})();
