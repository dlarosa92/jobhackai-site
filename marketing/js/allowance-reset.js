// Display the next calendar-month allowance reset in the visitor's time zone.
// This does not set or change interview entitlements or billing dates.
(function (global) {
  'use strict';

  function nextReset(now) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  function formatReset(date, locale, timeZone) {
    var options = {
      month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short'
    };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  var document = global.document;
  var timer;
  function refresh() {
    global.clearTimeout(timer);
    if (!document || document.hidden) return;
    var hints = document.querySelectorAll('[data-allowance-reset]');
    if (!hints.length) return;
    var now = new Date();
    var reset = nextReset(now);
    var label;
    try {
      label = formatReset(reset);
    } catch (_) {
      // Keep the static monthly-reset explanation if formatting is unavailable.
      hints.forEach(function (hint) { hint.hidden = true; });
      return;
    }
    hints.forEach(function (hint) {
      var time = hint.querySelector('time');
      if (!time) return;
      time.dateTime = reset.toISOString();
      time.textContent = label;
      hint.hidden = false;
    });
    // Refresh at the boundary. A daily cap avoids long timer overflow and also
    // picks up local clock/time-zone changes during a long open visit.
    timer = global.setTimeout(refresh, Math.min(reset.getTime() - now.getTime() + 50, 86400000));
  }

  global.JobHackAIAllowanceReset = { nextReset: nextReset, formatReset: formatReset, refresh: refresh };
  if (!document) return;
  document.addEventListener('visibilitychange', refresh);
  global.addEventListener('pageshow', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
})(typeof window !== 'undefined' ? window : globalThis);
