// lead-magnet.js
// Captures emails from the homepage lead-magnet form, posts them to the
// `/api/lead-magnet` endpoint, and fires a `generate_lead` GA4 event so
// the funnel report distinguishes content readers from trial signups.

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function apiBase() {
    return window.JHA.apiBase;
  }

  ready(function () {
    const form = document.getElementById('lead-magnet-form');
    if (!form) return;
    const emailInput = document.getElementById('lead-magnet-email');
    const status = document.getElementById('lead-magnet-status');
    const submitBtn = form.querySelector('button[type="submit"]');

    function setStatus(msg, isError) {
      if (!status) return;
      status.textContent = msg || '';
      status.style.color = isError ? '#B91C1C' : '#0B6B2E';
    }

    function isValidEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = (emailInput?.value || '').trim();
      if (!isValidEmail(email)) {
        setStatus('Please enter a valid email address.', true);
        emailInput?.focus();
        return;
      }

      const originalText = submitBtn?.textContent;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }
      setStatus('');

      try {
        const res = await fetch(apiBase() + '/api/lead-magnet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: email,
            asset: 'ats-checklist',
            source: 'homepage'
          })
        });
        if (!res.ok) {
          let msg = 'Something went wrong. Please try again in a moment.';
          try {
            const data = await res.json();
            if (typeof data?.error === 'string' && data.error.trim()) {
              msg = data.error.trim();
            }
          } catch (_) { /* ignore */ }
          throw new Error(msg);
        }
        setStatus('Check your inbox — the checklist is on its way.', false);
        if (emailInput) emailInput.value = '';
        if (window.JHA?.trackEventSafe) {
          window.JHA.trackEventSafe('generate_lead', {
            asset: 'ats-checklist',
            source: 'homepage',
            method: 'email'
          });
        }
      } catch (err) {
        console.warn('lead-magnet submit failed:', err);
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Something went wrong. Please try again in a moment.';
        setStatus(msg, true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (originalText) submitBtn.textContent = originalText;
        }
      }
    });
  });
})();
