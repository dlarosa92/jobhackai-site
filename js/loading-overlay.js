/**
 * JobHackAI Loading Overlay System
 * Full-screen loading overlay with brand-aligned spinner and text
 */

(function() {
  'use strict';

  let overlayZIndex = 9999;
  let activeOverlays = [];

  /**
   * Create and show loading overlay
   * @param {Object} options - Loading overlay configuration
   * @param {string} [options.message] - Loading message (default: "Loading...")
   * @param {boolean} [options.fullScreen] - Full screen overlay (default: true)
   * @param {string} [options.id] - Optional ID for overlay
   * @returns {HTMLElement} Overlay element
   */
  function createLoadingOverlay({
    message = 'Loading...',
    fullScreen = true,
    id = null
  } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'jh-loading-overlay';
    if (id) overlay.id = id;

    overlay.style.cssText = `
      position: ${fullScreen ? 'fixed' : 'absolute'};
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(4px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: ${overlayZIndex++};
      animation: fadeIn 0.2s ease-in-out;
    `;

    // Spinner container
    const spinnerContainer = document.createElement('div');
    spinnerContainer.style.cssText = `
      position: relative;
      width: 64px;
      height: 64px;
      margin-bottom: 1.5rem;
    `;

    // Brand-aligned spinner (using JobHackAI green #00E676)
    const spinner = document.createElement('div');
    spinner.className = 'jh-loading-spinner';
    spinner.style.cssText = `
      width: 64px;
      height: 64px;
      border: 4px solid #E5E7EB;
      border-top-color: #00E676;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    `;

    spinnerContainer.appendChild(spinner);

    // Loading message
    const messageEl = document.createElement('div');
    messageEl.className = 'jh-loading-message';
    messageEl.style.cssText = `
      color: #232B36;
      font-size: 1.125rem;
      font-weight: 600;
      text-align: center;
      margin-top: 0.5rem;
    `;
    messageEl.textContent = message;

    overlay.appendChild(spinnerContainer);
    overlay.appendChild(messageEl);

    // Add animations if not already present
    if (!document.querySelector('#jh-loading-styles')) {
      const styles = document.createElement('style');
      styles.id = 'jh-loading-styles';
      styles.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(styles);
    }

    // Disable form controls
    const formControls = document.querySelectorAll('input, button, select, textarea');
    formControls.forEach(control => {
      if (!control.disabled) {
        control.setAttribute('data-jh-loading-disabled', 'true');
        control.disabled = true;
      }
    });

    document.body.appendChild(overlay);
    activeOverlays.push(overlay);

    return overlay;
  }

  /**
   * Hide and remove loading overlay
   * @param {HTMLElement|string} overlayOrId - Overlay element or ID
   */
  function hideLoadingOverlay(overlayOrId) {
    let overlay;
    
    if (typeof overlayOrId === 'string') {
      overlay = document.getElementById(overlayOrId) || document.querySelector(`.jh-loading-overlay[id="${overlayOrId}"]`);
    } else {
      overlay = overlayOrId;
    }

    if (overlay) {
      overlay.style.animation = 'fadeOut 0.2s ease-in-out';
      setTimeout(() => {
        overlay.remove();
        activeOverlays = activeOverlays.filter(o => o !== overlay);
      }, 200);
    }

    // Re-enable form controls
    const disabledControls = document.querySelectorAll('[data-jh-loading-disabled="true"]');
    disabledControls.forEach(control => {
      control.disabled = false;
      control.removeAttribute('data-jh-loading-disabled');
    });

    // Add fadeOut animation if needed
    if (!document.querySelector('#jh-loading-fadeout')) {
      const styles = document.createElement('style');
      styles.id = 'jh-loading-fadeout';
      styles.textContent = `
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `;
      document.head.appendChild(styles);
    }
  }

  /**
   * Hide all loading overlays
   */
  function hideAllLoadingOverlays() {
    activeOverlays.forEach(overlay => {
      hideLoadingOverlay(overlay);
    });
    activeOverlays = [];
  }

  // Export public API
  window.JobHackAILoading = {
    /**
     * Show loading overlay
     * @param {string} message - Loading message
     * @param {string} id - Optional ID for overlay
     * @returns {HTMLElement} Overlay element
     */
    show(message = 'Loading...', id = null) {
      return createLoadingOverlay({ message, id });
    },

    /**
     * Hide loading overlay
     * @param {HTMLElement|string} overlayOrId - Overlay element or ID
     */
    hide(overlayOrId) {
      hideLoadingOverlay(overlayOrId);
    },

    /**
     * Hide all loading overlays
     */
    hideAll() {
      hideAllLoadingOverlays();
    }
  };
})();

