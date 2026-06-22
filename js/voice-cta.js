// Voice interview CTA + signup preview gate (repositioning brief sections 1, 4)
//
// Two jobs, both passive until their trigger fires:
//
// 1. CTA injection (signed-in users): when a free tool finishes rendering its
//    output, append a contextual CTA into the voice mock interview. Only when
//    VOICE_INTERVIEW_ENABLED is on (read from /api/plan/me), so promoting
//    this code with the flag off changes nothing user-visible.
//
// 2. Signup preview gate (logged-out visitors): pages that set
//    window.__JHA_ALLOW_PREVIEW__ no longer bounce straight to login; the
//    static content stays visible (crawlers always saw it; humans now do too)
//    under an interaction-blocking overlay with a single signup CTA.
(function () {
  'use strict';

  var PAGE_CONFIG = {
    'interview-questions': {
      watch: '#iq-questions',
      insertAfter: '.iq-questions-section',
      ready: function (el) { return el.children.length > 0; },
      tool: 'interview_questions',
      message: 'You have your questions. Now practice answering them out loud.'
    },
    'mock-interview': {
      watch: '#mi-summary',
      insertAfter: '#mi-summary',
      ready: function (el) { return !el.classList.contains('hidden'); },
      tool: 'mock_interview',
      message: 'You practiced in writing. Now say it out loud.'
    },
    'resume-feedback-pro': {
      watch: '#rf-feedback-content',
      insertAfter: '#rf-feedback-content',
      ready: function (el) { return (el.textContent || '').trim().length > 100; },
      tool: 'resume_feedback',
      message: 'Your resume is interview ready. Now get ready to talk about it.'
    },
    'cover-letter-generator': {
      watch: '#cl-preview',
      insertAfter: '.cl-preview-card',
      ready: function (el) { return (el.value || '').length > 200; },
      tool: 'cover_letter',
      message: 'Cover letter done. The interview comes next.'
    }
  };

  function currentPage() {
    var path = (window.location.pathname || '').split('/').pop() || '';
    return path.replace('.html', '');
  }

  function track(eventName, params) {
    try {
      if (window.JHA && window.JHA.analytics && typeof window.JHA.analytics.track === 'function') {
        window.JHA.analytics.track(eventName, params || {});
      } else if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params || {});
      }
    } catch (_) {}
  }

  // ---------- 1. Voice CTA for signed-in users ----------

  var injected = false;
  var outputSeen = false;

  async function voiceEnabled() {
    try {
      var user = null;
      if (window.FirebaseAuthManager) {
        if (typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
          user = window.FirebaseAuthManager.getCurrentUser();
        }
        if (!user && typeof window.FirebaseAuthManager.waitForAuthReady === 'function') {
          user = await window.FirebaseAuthManager.waitForAuthReady(4000);
        }
      }
      if (!user || user._authPending) return false;
      var token = await user.getIdToken();
      var data = null;
      if (window.PlanCache && typeof window.PlanCache.getPlan === 'function') {
        data = await window.PlanCache.getPlan(token);
      }
      if (!data || !data.voice) {
        var res = await fetch('/api/plan/me', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) data = await res.json();
      }
      return !!(data && data.voice && data.voice.enabled);
    } catch (_) {
      return false;
    }
  }

  function buildCta(config) {
    var box = document.createElement('div');
    box.className = 'jha-voice-cta';
    box.setAttribute('data-cta', 'voice-tool-' + config.tool);
    box.innerHTML =
      '<style>' +
      '.jha-voice-cta{background:#1F2937;color:#fff;border-radius:14px;padding:1.4rem 1.4rem 1.5rem;margin:1.6rem 0;text-align:center}' +
      '.jha-voice-cta h3{color:#fff;margin:0 0 .4rem;font-size:1.15rem}' +
      '.jha-voice-cta p{color:#D1D5DB;margin:0 0 1rem;font-size:.95rem}' +
      '.jha-voice-cta a{display:inline-block;background:#00E676;color:#1F2937;font-weight:700;padding:.75rem 1.6rem;border-radius:8px;text-decoration:none}' +
      '</style>' +
      '<h3>' + config.message + '</h3>' +
      '<p>Run a realistic voice mock interview for your target role and get a scored report. Your first session is free.</p>' +
      '<a href="voice-interview.html">Practice out loud</a>';
    return box;
  }

  function startCtaWatcher() {
    var config = PAGE_CONFIG[currentPage()];
    if (!config) return;

    var enabledPromise = null;

    var interval = setInterval(async function () {
      if (injected) { clearInterval(interval); return; }
      var watchEl = document.querySelector(config.watch);
      if (!watchEl || !config.ready(watchEl)) return;

      if (!outputSeen) {
        outputSeen = true;
        track('tool_output_viewed', { tool: config.tool });
      }

      if (!enabledPromise) enabledPromise = voiceEnabled();
      var on = await enabledPromise;
      if (!on) { clearInterval(interval); return; }

      var anchor = document.querySelector(config.insertAfter) || watchEl;
      if (!anchor || anchor.parentNode === null) return;
      if (document.querySelector('.jha-voice-cta')) { injected = true; clearInterval(interval); return; }
      anchor.parentNode.insertBefore(buildCta(config), anchor.nextSibling);
      injected = true;
      clearInterval(interval);
    }, 1500);
  }

  // ---------- 2. Signup preview gate for logged-out visitors ----------

  function showPreviewGate() {
    if (document.getElementById('jha-preview-gate')) return;
    var overlay = document.createElement('div');
    overlay.id = 'jha-preview-gate';
    overlay.innerHTML =
      '<style>' +
      '#jha-preview-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;' +
      'background:linear-gradient(to bottom, rgba(249,250,251,0) 0%, rgba(249,250,251,.65) 30%, rgba(249,250,251,.97) 62%);}' +
      '#jha-preview-gate .jha-gate-card{background:#fff;border:1px solid #E5E7EB;border-radius:16px 16px 0 0;' +
      'box-shadow:0 -10px 36px rgba(0,0,0,.14);max-width:460px;width:94%;padding:1.6rem 1.5rem 1.9rem;text-align:center;margin-bottom:0}' +
      '#jha-preview-gate h2{color:#1F2937;font-size:1.25rem;margin:0 0 .5rem}' +
      '#jha-preview-gate p{color:#4B5563;font-size:.95rem;margin:0 0 1.1rem}' +
      '#jha-preview-gate .jha-gate-btn{display:inline-block;background:#00E676;color:#1F2937;font-weight:700;' +
      'padding:.85rem 2rem;border-radius:8px;text-decoration:none;font-size:1rem}' +
      '#jha-preview-gate .jha-gate-login{display:block;margin-top:.8rem;color:#00897B;font-weight:600;text-decoration:none;font-size:.92rem}' +
      '</style>' +
      '<div class="jha-gate-card">' +
      '<h2>This tool is free with a JobHackAI account</h2>' +
      '<p>Sign up free to use it. Every account also includes 1 free voice mock interview with a scored report.</p>' +
      '<a class="jha-gate-btn" href="login.html?mode=signup" data-cta="preview-gate-signup">Sign up free</a>' +
      '<a class="jha-gate-login" href="login.html">Already have an account? Log in</a>' +
      '</div>';
    document.body.appendChild(overlay);
    track('sign_up_gate_view', { page: currentPage() });
  }

  function initPreviewGate() {
    if (window.__JHA_PREVIEW_MODE__) {
      showPreviewGate();
      return;
    }
    document.addEventListener('jha-preview-mode', showPreviewGate);
  }

  // ---------- init ----------

  function init() {
    initPreviewGate();
    if (!window.__JHA_PREVIEW_MODE__) startCtaWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
