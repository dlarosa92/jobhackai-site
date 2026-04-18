(function scheduleFeedbackWidgetLoad() {
  function loadFeedbackWidget() {
    if (document.querySelector('script[data-jh-feedback-widget]')) return;
    const script = document.createElement('script');
    script.src = 'js/feedback-widget.js?v=20260303-1';
    script.defer = true;
    script.dataset.jhFeedbackWidget = 'true';
    document.body.appendChild(script);
  }

  function queueLoad() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadFeedbackWidget, { timeout: 3000 });
    } else {
      setTimeout(loadFeedbackWidget, 1200);
    }
  }

  if (document.readyState === 'complete') {
    queueLoad();
  } else {
    window.addEventListener('load', queueLoad, { once: true });
  }
})();
