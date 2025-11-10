/**
 * JobHackAI Loading Overlay System
 * Backward compatibility wrapper for modals.js loading overlay functionality
 * Supports the old JobHackAILoading API while using the new modal system
 */

(function() {
  'use strict';

  // Wait for modals.js to be loaded
  function initializeLoadingOverlay() {
    // Check if modals.js functions are available
    if (typeof window.showLoadingOverlay !== 'function') {
      // If modals.js hasn't loaded yet, wait a bit and try again
      setTimeout(initializeLoadingOverlay, 50);
      return;
    }

    // Store reference to the original function
    const showOverlay = window.showLoadingOverlay;

    /**
     * Show contextual loading messages for different actions
     */
    const LoadingMessages = {
      UPLOADING_RESUME: 'Analyzing your résumé...',
      GENERATING_FEEDBACK: 'Optimizing for ATS compliance...',
      GENERATING_REWRITE: 'Generating AI-powered rewrite...',
      SCORING_RESUME: 'Calculating your ATS score...',
      PROCESSING_OCR: 'We\'re scanning your résumé — this may take up to 20 seconds.',
      SAVING_SCORE: 'Saving your score...'
    };

    /**
     * JobHackAILoading API - backward compatible wrapper
     */
    window.JobHackAILoading = {
      /**
       * Show loading overlay
       * @param {string} message - Loading message
       * @param {string} [id] - Optional ID for overlay
       * @returns {HTMLElement|Function} Overlay element or hide function (for backward compatibility)
       */
      show(message = 'Loading...', id = null) {
        const overlayId = id || 'jh-loading-overlay';
        const hideFunction = showOverlay(message, overlayId);
        // Return the overlay element for backward compatibility
        const overlay = document.getElementById(overlayId);
        // Store hide function on overlay for easy access
        if (overlay) {
          overlay._hideFunction = hideFunction;
        }
        return overlay;
      },

      /**
       * Hide loading overlay
       * @param {HTMLElement|string} overlayOrId - Overlay element or ID
       */
      hide(overlayOrId) {
        let overlay;
        if (typeof overlayOrId === 'string') {
          overlay = document.getElementById(overlayOrId);
        } else {
          overlay = overlayOrId;
        }

        if (overlay) {
          // Use stored hide function if available
          if (overlay._hideFunction) {
            overlay._hideFunction();
          } else {
            // Fallback: remove directly
            overlay.remove();
          }
        }
      },

      /**
       * Hide all loading overlays
       */
      hideAll() {
        const overlays = document.querySelectorAll('[id^="jh-loading-overlay"], [id="main-loading-overlay"]');
        overlays.forEach(overlay => {
          if (overlay._hideFunction) {
            overlay._hideFunction();
          } else {
            overlay.remove();
          }
        });
      }
    };

    // Export LoadingMessages for convenience
    window.LoadingMessages = LoadingMessages;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLoadingOverlay);
  } else {
    initializeLoadingOverlay();
  }
})();
