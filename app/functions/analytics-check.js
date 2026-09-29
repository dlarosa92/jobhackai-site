import { notFoundInProductionResponse, STANDARD_SECURITY_HEADERS } from './_lib/debug-access.js';

// Public technical diagnostics only: no tokens, cookies, identifiers, event
// payloads or secrets are rendered. Both environment and hostname fail closed.
export function onRequest({ request, env }) {
  if (env.ENVIRONMENT !== 'qa' || new URL(request.url).hostname !== 'qa.jobhackai.io') {
    return notFoundInProductionResponse();
  }
  return new Response(HTML, { headers: {
    ...STANDARD_SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  } });
}

const HTML = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>QA Analytics delivery check</title>
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/main.css">
<style>body{font:16px system-ui;padding:32px;max-width:900px;margin:auto}button{padding:12px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f3f4f6;color:#111827}.jha-cookie-modal:not(.active){display:none}</style>
</head><body><h1>QA Analytics delivery check</h1>
<p>This page uses QA's normal consent module and development Analytics property. It never simulates a signup, interview or purchase. Google receipt must be verified separately.</p>
<button id="preferences">Cookie preferences</button><button id="send">Send labeled diagnostic event</button><button id="refresh">Refresh diagnostics</button>
<pre id="state" aria-live="polite">Waiting for consent module...</pre><h2>Delivery observations</h2><pre id="observations" aria-live="polite"></pre>
<script>
(function () {
  const observations = document.getElementById('observations');
  function note(message) { observations.textContent += new Date().toISOString() + ' ' + message + '\n'; }
  function originOnly(value) { try { return new URL(value, location.href).origin; } catch (_) { return 'inline or unknown'; } }
  document.addEventListener('securitypolicyviolation', function (e) { note('CSP blocked ' + e.effectiveDirective + ' at ' + originOnly(e.blockedURI)); });
  document.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'SCRIPT') note('Script failed to load from ' + originOnly(e.target.src)); }, true);
  document.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'SCRIPT' && e.target.src) note('Script loaded from ' + originOnly(e.target.src)); }, true);
  window.addEventListener('error', function (e) { if (e.error) note('JavaScript error: ' + e.error.name); });
  function refresh() {
    const consent = window.JHA && window.JHA.cookieConsent;
    const tags = Array.from(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]'));
    const lines = ['Consent module: ' + (consent ? 'ready' : 'not ready'),
      'Analytics consent: ' + (consent ? String(consent.hasAnalyticsConsent()) : 'unknown'),
      'Event helper: ' + typeof (window.JHA && window.JHA.trackEventSafe),
      'Google command function: ' + typeof window.gtag,
      'Google tag elements: ' + tags.length,
      'QA collection disabled: ' + String(window['ga-disable-G-VH888WWY3M'] === true)];
    tags.forEach(function (tag) { lines.push('Tag destination: ' + new URL(tag.src).searchParams.get('id')); });
    performance.getEntriesByType('resource').filter(function (entry) {
      const host = new URL(entry.name, location.href).hostname;
      return /(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com)$/.test(host);
    }).forEach(function (entry) {
      const url = new URL(entry.name);
      lines.push(entry.initiatorType + ': ' + url.origin + url.pathname + ' (status ' + (entry.responseStatus || 'not exposed') + ')');
    });
    document.getElementById('state').textContent = lines.join('\n');
  }
  document.getElementById('refresh').onclick = refresh;
  document.getElementById('preferences').onclick = function () { if (window.JHA && window.JHA.cookieConsent) window.JHA.cookieConsent.openPreferences(); };
  document.getElementById('send').onclick = function () {
    if (!window.JHA || !window.JHA.cookieConsent || !window.JHA.cookieConsent.hasAnalyticsConsent()) { note('No event sent: Analytics consent is not granted.'); refresh(); return; }
    window.JHA.trackEventSafe('analytics_delivery_check', {test_run: 'qa_diagnostic_20260920', engagement_time_msec: 1});
    note('Diagnostic event requested. This is not proof of Google receipt.');
    refresh();
  };
  window.addEventListener('load', refresh);
  window.addEventListener('cookie-consent-granted', refresh);
})();
</script><script src="/js/cookie-consent.js?v=20260920-qa-check" defer></script></body></html>`;
