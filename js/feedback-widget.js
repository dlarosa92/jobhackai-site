/**
 * JobHackAI Feedback Widget
 * Self-contained floating feedback button + popup form.
 * Sends feedback to /api/feedback which emails feedback@jobhackai.io via Resend.
 */
(function () {
  'use strict';

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = `
    /* --- Feedback Widget --- */
    .jh-feedback-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1045;
      background: var(--color-card-bg, #fff);
      color: var(--color-text-secondary, #4B5563);
      border: 1px solid var(--color-divider, #E5E7EB);
      border-radius: var(--radius-full, 9999px);
      padding: 10px 18px;
      font-family: 'Inter', sans-serif;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: var(--shadow-md, 0 2px 6px rgba(0,0,0,0.05));
      transition: box-shadow 200ms ease, border-color 200ms ease, opacity 200ms ease;
      opacity: 0.85;
    }
    .jh-feedback-btn:hover {
      box-shadow: var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.07));
      border-color: var(--color-text-muted, #6B7280);
      opacity: 1;
    }
    .jh-feedback-btn svg { flex-shrink: 0; }

    /* Popup */
    .jh-feedback-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1049;
      background: rgba(0,0,0,0.25);
      opacity: 0;
      transition: opacity 200ms ease;
      pointer-events: none;
    }
    .jh-feedback-backdrop.open { opacity: 1; pointer-events: auto; }

    .jh-feedback-popup {
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 1050;
      width: 340px;
      max-width: calc(100vw - 48px);
      background: var(--color-card-bg, #fff);
      border: 1px solid var(--color-divider, #E5E7EB);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-xl, 0 8px 24px rgba(0,0,0,0.1));
      font-family: 'Inter', sans-serif;
      transform: translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: transform 200ms ease, opacity 200ms ease;
    }
    .jh-feedback-popup.open {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    .jh-feedback-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 0;
    }
    .jh-feedback-header h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--color-text-main, #1F2937);
    }
    .jh-feedback-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text-muted, #6B7280);
      padding: 4px;
      line-height: 1;
      border-radius: 4px;
      transition: background 150ms ease;
    }
    .jh-feedback-close:hover { background: var(--color-bg-light, #F9FAFB); }

    .jh-feedback-body { padding: 16px 20px 20px; }

    .jh-feedback-body textarea {
      width: 100%;
      min-height: 100px;
      resize: vertical;
      border: 1px solid var(--color-divider, #E5E7EB);
      border-radius: var(--radius-md, 8px);
      padding: 10px 12px;
      font-family: 'Inter', sans-serif;
      font-size: 0.875rem;
      color: var(--color-text-main, #1F2937);
      background: var(--color-card-bg, #fff);
      transition: border-color 150ms ease;
      box-sizing: border-box;
    }
    .jh-feedback-body textarea:focus {
      outline: none;
      border-color: var(--color-accent-blue, #007BFF);
      box-shadow: 0 0 0 2px rgba(0,123,255,0.12);
    }
    .jh-feedback-body textarea::placeholder {
      color: var(--color-text-muted, #6B7280);
    }

    .jh-feedback-submit {
      margin-top: 12px;
      width: 100%;
      padding: 10px;
      background: var(--color-cta-green, #007A30);
      color: #fff;
      border: none;
      border-radius: var(--radius-button, 8px);
      font-family: 'Inter', sans-serif;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease;
    }
    .jh-feedback-submit:hover { background: var(--color-cta-green-hover, #006B28); }
    .jh-feedback-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .jh-feedback-success {
      text-align: center;
      padding: 32px 20px;
      color: var(--color-text-secondary, #4B5563);
      font-size: 0.9rem;
    }
    .jh-feedback-success svg { margin-bottom: 8px; }
    .jh-feedback-success p { margin: 0; }

    .jh-feedback-error {
      margin: 8px 0 0;
      font-size: 0.8rem;
      color: var(--color-error, #DC2626);
    }

    /* Mobile adjustments */
    @media (max-width: 480px) {
      .jh-feedback-btn { bottom: 16px; right: 16px; padding: 8px 14px; font-size: 0.8rem; }
      .jh-feedback-popup { bottom: 68px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // Build DOM
  var backdrop = document.createElement('div');
  backdrop.className = 'jh-feedback-backdrop';

  var btn = document.createElement('button');
  btn.className = 'jh-feedback-btn';
  btn.setAttribute('aria-label', 'Send feedback');
  btn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '</svg>' +
    'Feedback';

  var popup = document.createElement('div');
  popup.className = 'jh-feedback-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Send feedback');
  popup.innerHTML =
    '<div class="jh-feedback-header">' +
      '<h3>Send us feedback</h3>' +
      '<button class="jh-feedback-close" aria-label="Close feedback form">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<div class="jh-feedback-body">' +
      '<textarea id="jh-feedback-text" placeholder="What\'s on your mind? We\'d love to hear from you." aria-label="Your feedback"></textarea>' +
      '<button class="jh-feedback-submit" id="jh-feedback-send">Send Feedback</button>' +
    '</div>';

  document.body.appendChild(backdrop);
  document.body.appendChild(btn);
  document.body.appendChild(popup);

  // Interaction logic
  var textarea = document.getElementById('jh-feedback-text');
  var sendBtn = document.getElementById('jh-feedback-send');
  var successTimeoutId = null;

  function openPopup() {
    popup.classList.add('open');
    backdrop.classList.add('open');
    btn.style.display = 'none';
    setTimeout(function () { textarea && textarea.focus(); }, 220);
  }

  function closePopup() {
    popup.classList.remove('open');
    backdrop.classList.remove('open');
    btn.style.display = '';
    if (successTimeoutId !== null) {
      clearTimeout(successTimeoutId);
      successTimeoutId = null;
    }
  }

  function resetForm() {
    popup.querySelector('.jh-feedback-body').innerHTML =
      '<textarea id="jh-feedback-text" placeholder="What\'s on your mind? We\'d love to hear from you." aria-label="Your feedback"></textarea>' +
      '<button class="jh-feedback-submit" id="jh-feedback-send">Send Feedback</button>';
    textarea = document.getElementById('jh-feedback-text');
    sendBtn = document.getElementById('jh-feedback-send');
    sendBtn.addEventListener('click', handleSend);
  }

  function showSuccess() {
    var body = popup.querySelector('.jh-feedback-body');
    body.innerHTML =
      '<div class="jh-feedback-success">' +
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>' +
          '<polyline points="22 4 12 14.01 9 11.01"/>' +
        '</svg>' +
        '<p><strong>Thank you!</strong></p>' +
        '<p>Your feedback has been sent.</p>' +
      '</div>';
    if (successTimeoutId !== null) {
      clearTimeout(successTimeoutId);
    }
    successTimeoutId = setTimeout(function () {
      closePopup();
      setTimeout(resetForm, 300);
      successTimeoutId = null;
    }, 2000);
  }

  async function handleSend() {
    var text = textarea.value.trim();
    if (!text) { textarea.focus(); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending\u2026';

    var page = window.location.pathname;

    // Get auth token if available
    var headers = { 'Content-Type': 'application/json' };
    try {
      if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
        var user = window.FirebaseAuthManager.getCurrentUser();
        if (user && typeof user.getIdToken === 'function') {
          var idToken = await user.getIdToken();
          if (idToken) {
            headers['Authorization'] = 'Bearer ' + idToken;
          }
        }
      }
    } catch (e) {
      // If token fetch fails, proceed without auth (will get 401 from server)
    }

    fetch('/api/feedback', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ message: text, page: page })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed');
        showSuccess();
      })
      .catch(function () {
        // Show inline error — keep the user's text so they can retry
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Feedback';
        var errEl = popup.querySelector('.jh-feedback-error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'jh-feedback-error';
          errEl.textContent = 'Something went wrong. Please try again.';
          popup.querySelector('.jh-feedback-body').insertBefore(errEl, sendBtn);
        }
      });
  }

  btn.addEventListener('click', openPopup);
  backdrop.addEventListener('click', closePopup);
  popup.querySelector('.jh-feedback-close').addEventListener('click', closePopup);
  sendBtn.addEventListener('click', handleSend);

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popup.classList.contains('open')) closePopup();
  });
})();
