// main.js
// Entry-point for JobHackAI frontend scripts

import { initUsageMeter } from './usageMeter.js';
import { trackPageView, trackEvent } from './analytics.js';

// Initialize analytics tracking
trackPageView();

// Initialize usage meters (mock-interview & feedback)
document.addEventListener('DOMContentLoaded', () => {
  initUsageMeter({
    interviewSelector: '#mock-interview-form',
    feedbackSelector: '#feedback-section'
  });

  // Example: track when report is downloaded
  try {
    const downloadBtn = document.querySelector('#download-report-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        trackEvent('Report', 'Download', 'LinkedIn Optimizer Report');
      });
    }
  } catch (e) {
    // Defensive: avoid throwing on pages without this selector
  }
});

// Smooth-scroll for same-page anchors (Blog and others), with a11y respect
(function () {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smoothTo = (el) => el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (prefersReduced) return;

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;

    const href = a.getAttribute('href');
    if (!href || !href.includes('#')) return;

    const url = new URL(href, window.location.href);
    const sameOrigin = url.origin === location.origin;
    const samePage =
      url.pathname === location.pathname ||
      ((location.pathname === '/' || location.pathname === '') && url.pathname.endsWith('/index.html'));

    if (!sameOrigin || !samePage) return;

    const target = document.querySelector(url.hash);
    if (!target) return;

    e.preventDefault();
    smoothTo(target);
    history.pushState(null, '', url.hash);
  });

  window.addEventListener('load', () => {
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) setTimeout(() => smoothTo(target), 0);
    }
  });
})();