// Optional measurement for the three public tool examples. Load before consent.
// Never collect form values, generated content, destinations, or raw URL queries.
(function () {
  'use strict';
  var pages = {
    'linkedin-optimizer': { tool: 'linkedin_optimizer', prefix: 'linkedin', selector: '#lo-preview' },
    'interview-questions': { tool: 'interview_questions', prefix: 'interview-questions', selector: '#jha-preview-gate' },
    'resume-feedback-pro': { tool: 'resume_feedback', prefix: 'resume-feedback', selector: '#jha-preview-gate' }
  };
  var page = location.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
  var config = pages[page];
  if (!config) return;

  // Unlike a marketing page, tool URLs can carry functional state. Do not
  // rewrite it. Suppress replay on an unsafe URL/referrer before Clarity loads;
  // GA's owning consent bundle independently sanitizes its page URL/referrer.
  function replaySafeUrl(raw, current) {
    if (!raw) return true;
    try {
      var url = new URL(raw, location.href);
      if (current && url.pathname !== location.pathname) return false;
      if (!current && url.pathname !== '/' &&
          !(url.origin === location.origin && /^\/(?:features|pricing|login|dashboard|linkedin-optimizer|interview-questions|resume-feedback-pro|voice-interview)(?:\.html)?\/?$/.test(url.pathname))) return false;
      for (var entry of url.searchParams) {
        if (entry[1] !== entry[1].trim()) return false;
        if (/^utm_(source|medium|campaign|content|id|term)$/.test(entry[0]) && /^[a-z0-9_.-]{1,100}$/i.test(entry[1])) continue;
        if (entry[0] === 'jha_staff_test' && /^[01]$/.test(entry[1])) continue;
        if (entry[0] === 'mode' && /^(signup|login)$/.test(entry[1])) continue;
        if (entry[0] === 'plan' && /^(free|trial|essential|pro|premium|weekly|monthly|pack)$/.test(entry[1])) continue;
        if (entry[0] === 'redirect' && /^\/(linkedin-optimizer|interview-questions|resume-feedback-pro|voice-interview)\.html$/.test(entry[1])) continue;
        return false;
      }
      return !url.hash || (current && /^[a-z][a-z0-9-]*$/i.test(url.hash.slice(1)) && !!document.getElementById(url.hash.slice(1)));
    } catch (_) { return false; }
  }
  if (!replaySafeUrl(location.href, true) || !replaySafeUrl(document.referrer, false)) {
    window.JHA_CONFIG = Object.assign({}, window.JHA_CONFIG, { CLARITY_ID: '' });
  }

  var asset = 'tool_preview_' + config.tool;
  if (document.body) {
    document.body.setAttribute('data-asset-id', asset);
    document.body.setAttribute('data-clarity-mask', 'true');
  }
  var recorded = false;
  var element = null;
  var observer = null;
  var visible = false;
  function eligible() {
    return element && element.isConnected && !element.hidden && element.getClientRects().length > 0 &&
      visible && document.visibilityState !== 'hidden' && window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true;
  }
  function record() {
    if (recorded || !eligible() || typeof window.JHA?.trackEventSafe !== 'function') return;
    try {
      window.JHA.trackEventSafe('sign_up_gate_view', {
        page: page, page_path: '/' + page + '.html', tool: config.tool,
        asset_id: asset, business_line: 'career_product', preview_type: 'illustrative'
      });
      recorded = true;
      observer?.disconnect();
    } catch (_) { /* An optional vendor must never interrupt the tool. */ }
  }
  function observePreview(candidate) {
    if (!candidate || !candidate.matches(config.selector)) return;
    // The existing delegated handler owns clicks; this only supplies labels
    // and opts these actions out of the legacy pre-decision event queue.
    var signup = candidate.querySelector('.jha-gate-btn, [data-cta="linkedin-preview-signup"]');
    var login = candidate.querySelector('.jha-gate-login, [data-cta="linkedin-preview-login"]');
    [[signup, 'signup'], [login, 'login']].forEach(function (item) {
      if (!item[0]) return;
      item[0].setAttribute('data-cta', config.prefix + '-preview-' + item[1]);
      item[0].setAttribute('data-analytics-consent', 'required');
      item[0].setAttribute('data-analytics-action', item[1]);
    });
    if (recorded || element === candidate) return;
    observer?.disconnect();
    element = candidate;
    visible = false;
    if (typeof IntersectionObserver !== 'function') return; // Do not invent a view.
    observer = new IntersectionObserver(function (entries) {
      visible = entries.some(function (entry) { return entry.isIntersecting && entry.intersectionRatio >= 0.5; });
      record();
    }, { threshold: 0.5 });
    // A heading is usable as a visibility marker even on a tall mobile card.
    observer.observe(candidate.querySelector('h1, h2') || candidate);
  }
  window.JHA = window.JHA || {};
  window.JHA.toolPreviewTelemetry = { observe: observePreview };
  window.addEventListener('cookie-consent-granted', record);
  document.addEventListener('visibilitychange', record);
})();
