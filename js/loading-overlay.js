// Loading overlay utility (re-exported from modals.js for backward compatibility)
// This file maintains backward compatibility while using the new modal system

import { showLoadingOverlay as showOverlay, showErrorModal, showToast } from './modals.js';

/**
 * Show loading overlay
 * @param {string} message - Loading message
 * @param {string} [id] - Optional overlay ID
 * @returns {Function} Function to hide the overlay
 */
export function showLoadingOverlay(message = 'Loading...', id) {
  return showOverlay(message, id);
}

/**
 * Show contextual loading messages for different actions
 */
export const LoadingMessages = {
  UPLOADING_RESUME: 'Analyzing your résumé...',
  GENERATING_FEEDBACK: 'Optimizing for ATS compliance...',
  GENERATING_REWRITE: 'Generating AI-powered rewrite...',
  SCORING_RESUME: 'Calculating your ATS score...',
  PROCESSING_OCR: "We're scanning your résumé — this may take up to 20 seconds.",
  SAVING_SCORE: 'Saving your score...'
};

function initializeLegacyWrapper() {
  if (typeof window === 'undefined') {
    return;
  }

  window.showLoadingOverlay = showLoadingOverlay;
  window.LoadingMessages = LoadingMessages;
  window.showErrorModal = showErrorModal;
  window.showToast = showToast;

  // Legacy JobHackAILoading API
  window.JobHackAILoading = {
    show(message = 'Loading...', id = null) {
      const overlayId = id || 'jh-loading-overlay';
      const hideFunction = showLoadingOverlay(message, overlayId);
      const overlay = document.getElementById(overlayId);
      if (overlay) {
        overlay._hideFunction = hideFunction;
      }
      return overlay;
    },
    hide(overlayOrId) {
      let overlay = overlayOrId;
      if (typeof overlayOrId === 'string') {
        overlay = document.getElementById(overlayOrId);
      }
      if (overlay) {
        if (overlay._hideFunction) {
          overlay._hideFunction();
        } else {
          overlay.remove();
        }
      }
    },
    hideAll() {
      const overlays = document.querySelectorAll('[id^="jh-loading-overlay"], [id="main-loading-overlay"]');
      overlays.forEach((overlay) => {
        if (overlay._hideFunction) {
          overlay._hideFunction();
        } else {
          overlay.remove();
        }
      });
    }
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLegacyWrapper);
  } else {
    initializeLegacyWrapper();
  }
}
