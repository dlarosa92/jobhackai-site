(function () {
  'use strict';
  const form = document.getElementById('directory-request');
  if (!form) return;
  const button = document.getElementById('request-submit');
  const error = document.getElementById('request-error');
  const host = window.location.hostname;
  // Only the canonical dev marketing alias can send to the isolated dev API.
  // Arbitrary previews, QA and production cannot accidentally write dev data.
  const endpoint = host === 'dev0.jobhackai-app-marketing-seo.pages.dev' || host === 'dev.jobhackai.io'
    ? 'https://dev.jobhackai.io/api/directory-requests'
    : ['localhost','127.0.0.1'].includes(host) ? '/api/directory-requests' : null;
  if (!endpoint) return;
  document.getElementById('request-environment').textContent = 'Development test form. Please use clearly labeled test details. No public listing will be created.';
  button.disabled = false;
  // One key per logical payload, retained in memory across network retries.
  // No contact details or new tracking identifiers are written to browser storage.
  let key = crypto.randomUUID(), previousPayload = '', pending = false;
  function showError(message) {
    error.textContent = message; error.hidden = false; error.focus();
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const payload = JSON.stringify(data);
    if (previousPayload && previousPayload !== payload) key = crypto.randomUUID();
    previousPayload = payload;
    data.submission_key = key;
    pending = true; button.disabled = true; button.textContent = 'Saving request…'; error.hidden = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),20000);
    try {
      const response = await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
      const result = await response.json();
      if (!response.ok || result.ok !== true || typeof result.request_id !== 'string') {
        if (result.errors) showError(Object.values(result.errors).join(' '));
        else showError(response.status===429 ? 'Too many requests. Please wait an hour before trying again. Your details are still here.' : 'We could not confirm that your request was saved. Your details are still here. Please try again.');
        return;
      }
      form.hidden = true;
      document.getElementById('request-reference').textContent = 'Reference: ' + result.request_id;
      const success = document.getElementById('request-success'); success.hidden = false; success.focus();
      // Storage, not a sale or an inbox receipt. Never include form fields/IDs.
      if (!result.duplicate && window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true) {
        window.JHA?.gtagSafe?.('event','directory_request_saved',{business_line:'local_directory',directory_category:'mobile_detailing',directory_market:'nky_cincinnati',interest_type:'listing'});
      }
    } catch (_) { showError('We could not confirm that your request was saved. Your details are still here. Please try again; the same request will not be added twice.'); }
    finally { clearTimeout(timer); pending = false; button.disabled = false; button.textContent = 'Save listing request'; }
  });
})();
