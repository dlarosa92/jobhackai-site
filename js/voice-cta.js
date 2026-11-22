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
//    Interview Questions and Resume Feedback show an inline example with
//    one signup action. Their real tool controls remain hidden and inert.
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
    var path = (window.location.pathname || '').replace(/\/+$/, '').split('/').pop() || '';
    return path.replace('.html', '');
  }

  function track(eventName, params) {
    try {
      if (window.JHA && typeof window.JHA.trackEventSafe === 'function') {
        window.JHA.trackEventSafe(eventName, params || {});
      }
    } catch (_) {}
  }

  // ---------- 1. Voice CTA for signed-in users ----------

  var injected = false;
  var outputSeen = false;

  async function getVoiceOffer() {
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
      if (!user || user._authPending) return null;
      var token = await user.getIdToken();
      var data = null;
      if (window.PlanCache && typeof window.PlanCache.getPlan === 'function') {
        data = await window.PlanCache.getPlan(token);
      }
      if (!data || !data.voice) {
        var res = await fetch('/api/plan/me', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) data = await res.json();
      }
      var voice = data && data.voice;
      if (!voice || !voice.enabled) return null;
      if (voice.canStart && voice.mode === 'free') {
        return { label: 'Start your free voice interview', href: 'voice-interview.html',
          message: 'Your first voice interview includes a feedback preview. Paid plans unlock full reports and transcripts.' };
      }
      if (voice.canStart && (voice.mode === 'subscription' || voice.mode === 'pack')) {
        return { label: 'Start a voice interview', href: 'voice-interview.html',
          message: 'Practice for your target role and get a full scored report and transcript.' };
      }
      if (voice.reason === 'limit_reached') {
        return { label: 'View your interview history', href: 'voice-interview.html#vi-history-list',
          message: 'You have reached your subscription session limit for this UTC calendar month. Your previous reports are still available.' };
      }
      if (voice.reason === 'paywall') {
        return { label: 'Explore voice interview plans', href: 'pricing.html',
          message: 'Choose a plan for more voice practice, full scored reports, and transcripts.' };
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function buildCta(config, offer) {
    var box = document.createElement('div');
    box.className = 'jha-voice-cta';
    box.setAttribute('data-cta', 'voice-tool-' + config.tool);
    box.innerHTML =
      '<style>' +
      '.jha-voice-cta{background:var(--color-card-bg);border:1px solid var(--color-divider);border-radius:var(--radius-xl);box-shadow:var(--shadow-card);padding:1.4rem 1.4rem 1.5rem;margin:1.6rem 0;text-align:center}' +
      '.jha-voice-cta h3{color:var(--color-text-main);margin:0 0 .4rem;font-size:1.15rem}' +
      '.jha-voice-cta p{color:var(--color-text-secondary);margin:0 0 1rem;font-size:.95rem}' +
      '.jha-voice-cta a{display:inline-block;background:var(--color-cta-green);color:#fff;font-weight:700;padding:.75rem 1.6rem;border-radius:var(--radius-button);text-decoration:none}' +
      '.jha-voice-cta a:hover{background:var(--color-cta-green-hover)}' +
      '</style>' +
      '<h3>' + config.message + '</h3>' +
      '<p>' + offer.message + '</p>' +
      '<a href="' + offer.href + '">' + offer.label + '</a>';
    return box;
  }

  function startCtaWatcher() {
    var config = PAGE_CONFIG[currentPage()];
    if (!config) return;

    var offerPromise = null;

    var interval = setInterval(async function () {
      if (injected) { clearInterval(interval); return; }
      var watchEl = document.querySelector(config.watch);
      if (!watchEl || !config.ready(watchEl)) return;

      if (!outputSeen) {
        outputSeen = true;
        track('tool_output_viewed', { tool: config.tool });
      }

      if (!offerPromise) offerPromise = getVoiceOffer();
      var offer = await offerPromise;
      if (!offer) { clearInterval(interval); return; }

      var anchor = document.querySelector(config.insertAfter) || watchEl;
      if (!anchor || anchor.parentNode === null) return;
      if (document.querySelector('.jha-voice-cta')) { injected = true; clearInterval(interval); return; }
      anchor.parentNode.insertBefore(buildCta(config, offer), anchor.nextSibling);
      injected = true;
      clearInterval(interval);
    }, 1500);
  }

  // ---------- 2. Signup preview gate for logged-out visitors ----------

  var TOOL_PREVIEWS = {
    'interview-questions': {
      title: 'Interview Questions',
      description: 'Practice starts with a good question. Create your free account to generate questions for your target role and save the ones you want to practice.',
      example: '<p class="jha-preview-label">Example questions · Product Manager</p>' +
        '<h2>Turn your experience into a story.</h2>' +
        '<ol class="jha-preview-questions"><li>Tell me about a time you had to prioritize competing customer needs.</li>' +
        '<li>How did you know your product decision was working?</li></ol>' +
        '<p class="jha-preview-note">Illustrative examples. Your questions are tailored to the role you choose.</p>'
    },
    'resume-feedback-pro': {
      title: 'Resume Feedback',
      description: 'Make your experience easier to understand. Create your free account to check your resume, get role-specific feedback, and work on a clearer rewrite.',
      example: '<p class="jha-preview-label">Example feedback · Experience</p>' +
        '<h2>Make your contribution clear.</h2>' +
        '<div class="jha-preview-excerpt"><h3>Original</h3><p>Worked with sales and support on onboarding.</p></div>' +
        '<div class="jha-preview-excerpt jha-preview-rewrite"><h3>Suggested rewrite</h3><p>Partnered with sales and support to identify onboarding friction and prioritize improvements for new customers.</p></div>' +
        '<p class="jha-preview-note">Illustrative example. Add a measurable outcome when you can support it.</p>'
    }
  };

  var previewContentState = [];

  function showInlineToolPreview(preview) {
    var main = document.querySelector('main');
    if (!main) return;
    // Preserve node identity and page listeners. Hiding the actual controls
    // keeps the example separate from the authenticated tool and its actions.
    Array.prototype.forEach.call(main.children, function (child) {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') return;
      previewContentState.push({ element: child, hidden: child.hidden, inert: child.inert });
      child.setAttribute('data-jha-preview-content', '');
      child.hidden = true;
      child.inert = true;
    });
    var section = document.createElement('section');
    section.id = 'jha-preview-gate';
    section.setAttribute('aria-labelledby', 'jha-preview-title');
    section.innerHTML =
      '<style>' +
      '[data-jha-preview-content]{display:none!important}' +
      '#jha-preview-gate{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(1.5rem,4vw,3rem);align-items:center;max-width:1100px;margin:0 auto;padding:clamp(1.25rem,4vw,3rem);background:var(--color-card-bg,#fff);border:1px solid var(--color-divider,#e5e7eb);border-radius:var(--radius-xl,16px);box-sizing:border-box}' +
      '#jha-preview-gate *{box-sizing:border-box;min-width:0}' +
      '#jha-preview-gate h1{font-size:clamp(1.8rem,4vw,2.5rem);line-height:1.15;letter-spacing:-.03em;margin:0 0 1rem;color:var(--color-text-main,#1f2937)}' +
      '#jha-preview-gate p{font-size:1rem;line-height:1.65;color:var(--color-text-secondary,#4b5563);margin:0 0 1.25rem}' +
      '#jha-preview-gate .jha-preview-label{font-size:.75rem;line-height:1.5;letter-spacing:.06em;font-weight:700;color:var(--color-cta-green,#007a30);margin:0 0 .75rem}' +
      '#jha-preview-gate .jha-gate-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.85rem 1.3rem;border-radius:var(--radius-button,8px);background:var(--color-cta-green,#007a30);color:#fff;font-size:1rem;font-weight:700;text-decoration:none;text-align:center}' +
      '#jha-preview-gate .jha-gate-btn:hover{background:var(--color-cta-green-hover,#006627)}' +
      '#jha-preview-gate .jha-gate-login{display:block;width:fit-content;padding:.75rem 0;color:var(--color-accent-blue,#007bff);font-weight:600;text-underline-offset:3px;line-height:1.5}' +
      '#jha-preview-gate a:focus-visible{outline:3px solid var(--color-accent-blue,#007bff);outline-offset:4px}' +
      '#jha-preview-gate .jha-preview-example{background:#f3f8f5;border:1px solid #dce9df;border-radius:12px;padding:clamp(1.15rem,3vw,1.75rem)}' +
      '#jha-preview-gate h2{font-size:1.2rem;line-height:1.4;margin:0 0 1rem;color:var(--color-text-main,#1f2937)}' +
      '#jha-preview-gate .jha-preview-questions{padding-left:1.4rem;margin:0 0 1.25rem;color:var(--color-text-main,#1f2937);line-height:1.6}' +
      '#jha-preview-gate .jha-preview-questions li+li{margin-top:1rem}' +
      '#jha-preview-gate .jha-preview-excerpt{padding:1rem;background:#fff;border:1px solid var(--color-divider,#e5e7eb);border-radius:8px;margin-bottom:.75rem}' +
      '#jha-preview-gate .jha-preview-rewrite{border-left:3px solid var(--color-cta-green,#007a30)}' +
      '#jha-preview-gate h3{font-size:.8rem;line-height:1.5;margin:0 0 .4rem;color:var(--color-text-main,#1f2937)}' +
      '#jha-preview-gate .jha-preview-excerpt p{font-size:.9rem;margin:0}' +
      '#jha-preview-gate .jha-preview-note{font-size:.8rem;margin:0;line-height:1.6}' +
      '@media(max-width:700px){#jha-preview-gate{grid-template-columns:minmax(0,1fr)}#jha-preview-gate .jha-gate-btn{width:100%}}' +
      '</style>' +
      '<div><p class="jha-preview-label">Free with a JobHackAI account</p>' +
      '<h1 id="jha-preview-title">' + preview.title + '</h1><p>' + preview.description + '</p>' +
      '<a class="jha-gate-btn" data-cta="preview-gate-signup">Create your free account</a>' +
      '<a class="jha-gate-login">Already have an account? Log in</a></div>' +
      '<div class="jha-preview-example">' + preview.example + '</div>';
    // Return only to this page, never preserve an arbitrary query or hash.
    var redirect = encodeURIComponent(window.location.pathname);
    section.querySelector('.jha-gate-btn').href = '/login.html?mode=signup&redirect=' + redirect;
    section.querySelector('.jha-gate-login').href = '/login.html?redirect=' + redirect;
    main.appendChild(section);
  }

  function showPreviewGate() {
    if (document.getElementById('jha-preview-gate')) return;
    var preview = TOOL_PREVIEWS[currentPage()];
    if (preview) {
      if (window.__JOBHACKAI_ACCESS_VERIFIED__) return;
      var manager = window.FirebaseAuthManager;
      var user = manager && typeof manager.getCurrentUser === 'function' ? manager.getCurrentUser() : null;
      if (user && !user._authPending) return;
      showInlineToolPreview(preview);
      track('sign_up_gate_view', { page: currentPage() });
      return;
    }
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
      '#jha-preview-gate .jha-gate-btn{display:inline-block;background:var(--color-cta-green);color:#fff;font-weight:700;' +
      'padding:.85rem 2rem;border-radius:var(--radius-button);text-decoration:none;font-size:1rem}' +
      '#jha-preview-gate .jha-gate-btn:hover{background:var(--color-cta-green-hover)}' +
      '#jha-preview-gate .jha-gate-login{display:block;margin-top:.8rem;color:var(--color-accent-blue);font-weight:600;text-decoration:none;font-size:.92rem}' +
      '</style>' +
      '<div class="jha-gate-card">' +
      '<h2>This tool is free with a JobHackAI account</h2>' +
      '<p>Sign up free to use it. Every account also includes one lifetime free voice mock interview with a feedback preview. Paid plans unlock full reports and transcripts.</p>' +
      '<a class="jha-gate-btn" href="login.html?mode=signup" data-cta="preview-gate-signup">Sign up free</a>' +
      '<a class="jha-gate-login" href="login.html">Already have an account? Log in</a>' +
      '</div>';
    document.body.appendChild(overlay);
    track('sign_up_gate_view', { page: currentPage() });
  }

  function restoreToolAfterAuth() {
    if (!TOOL_PREVIEWS[currentPage()] || !previewContentState.length) return;
    var manager = window.FirebaseAuthManager;
    var user = manager && typeof manager.getCurrentUser === 'function' ? manager.getCurrentUser() : null;
    if (!user || user._authPending) return;
    var gate = document.getElementById('jha-preview-gate');
    var moveFocus = gate && gate.contains(document.activeElement);
    if (gate) gate.remove();
    previewContentState.forEach(function (state) {
      state.element.removeAttribute('data-jha-preview-content');
      state.element.hidden = state.hidden;
      state.element.inert = state.inert;
    });
    previewContentState = [];
    window.__JHA_PREVIEW_MODE__ = false;
    // The page still performs its normal auth and plan checks. This event only
    // restarts initializers that were paused for an anonymous visitor.
    document.dispatchEvent(new CustomEvent('jha-preview-authenticated'));
    if (moveFocus) {
      var main = document.querySelector('main');
      main.setAttribute('tabindex', '-1');
      main.focus();
    }
  }

  function initPreviewGate() {
    document.addEventListener('firebase-auth-ready', restoreToolAfterAuth);
    if (window.__JHA_PREVIEW_MODE__) {
      showPreviewGate();
      return;
    }
    document.addEventListener('jha-preview-mode', showPreviewGate);
  }

  // ---------- init ----------

  var offersStarted = false;
  function startPersonalizedOffers() {
    if (offersStarted || !window.FirebaseAuthManager) return;
    var user = typeof window.FirebaseAuthManager.getCurrentUser === 'function' ? window.FirebaseAuthManager.getCurrentUser() : null;
    if (!user || user._authPending) return;
    offersStarted = true;
    document.removeEventListener('firebase-auth-ready', startPersonalizedOffers);
    if (!window.__JHA_PREVIEW_MODE__) startCtaWatcher();
    if (currentPage() === 'pricing') {
      getVoiceOffer().then(function (offer) {
        var button = document.querySelector('.vp-hero-cta');
        var detail = document.querySelector('.vp-hero-sub');
        if (!offer || !button || !detail) return;
        // A customer already on pricing should jump to the offers, not reload.
        button.href = offer.href === 'pricing.html' ? '#plans' : offer.href;
        button.textContent = offer.label;
        detail.textContent = offer.message;
      });
    }
  }

  function init() {
    initPreviewGate();
    // The Firebase module may still be loading. No polling or pending offer
    // promise is needed until it signals readiness. If its imports fail, the
    // neutral CTA remains usable and no tool watcher is started.
    document.addEventListener('firebase-auth-ready', startPersonalizedOffers);
    var manager = window.FirebaseAuthManager;
    var user = manager && typeof manager.getCurrentUser === 'function' ? manager.getCurrentUser() : null;
    // Support navigation after auth has already resolved, when its event fired
    // before this script. Pending restoration waits for the ready event above.
    if (user && !user._authPending) startPersonalizedOffers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
