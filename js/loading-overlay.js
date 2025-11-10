// Loading overlay utility (re-exported from modals.js for backward compatibility)
// This file maintains backward compatibility while using the new modal system

import { showLoadingOverlay as showOverlay, showErrorModal, showToast } from './modals.js';

/**
 * Show loading overlay
 * @param {string} message - Loading message
 * @returns {Function} Function to hide the overlay
 */
export function showLoadingOverlay(message = 'Loading...') {
  return showOverlay(message);
}

/**
 * Show contextual loading messages for different actions
 */
export const LoadingMessages = {
  UPLOADING_RESUME: 'Analyzing your résumé...',
  GENERATING_FEEDBACK: 'Optimizing for ATS compliance...',
  GENERATING_REWRITE: 'Generating AI-powered rewrite...',
  SCORING_RESUME: 'Calculating your ATS score...',
  PROCESSING_OCR: 'We\'re scanning your résumé — this may take up to 20 seconds.',
  SAVING_SCORE: 'Saving your score...'
};

// Make available globally
if (typeof window !== 'undefined') {
  window.showLoadingOverlay = showLoadingOverlay;
  window.LoadingMessages = LoadingMessages;
  window.showErrorModal = showErrorModal;
  window.showToast = showToast;
}
