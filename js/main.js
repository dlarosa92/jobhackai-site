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
  const downloadBtn = document.querySelector('#download-report-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      trackEvent('Report', 'Download', 'LinkedIn Optimizer Report');
    });
  }
});