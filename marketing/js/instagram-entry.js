// Resolve the exact legacy Instagram profile placement before analytics loads.
// This changes future arrivals only; other campaigns and Local links keep their
// original destinations. Instagram's saved website field is mobile-only.
(function () {
  'use strict';
  const url = new URL(window.location.href);
  const p = url.searchParams;
  if (!['jobhackai.io', 'www.jobhackai.io'].includes(url.hostname) || url.pathname !== '/') return;
  if (p.get('utm_source') !== 'ig' || p.get('utm_medium') !== 'social' || p.get('utm_content') !== 'link_in_bio' || p.has('utm_campaign')) return;
  // Ambiguous duplicate parameters are not an exact placement match.
  if (['utm_source', 'utm_medium', 'utm_content'].some(key => p.getAll(key).length !== 1)) return;
  url.pathname = '/features';
  p.set('utm_source', 'instagram');
  p.set('utm_medium', 'organic_social');
  p.set('utm_campaign', 'voice_beta_2026_09');
  p.set('utm_content', 'voice_instagram_profile_01');
  // Keep the redirecting homepage from becoming an internal referrer that
  // would prevent the destination from capturing this external campaign.
  const referrer = document.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  document.head.appendChild(referrer);
  window.location.replace(url.href);
})();
