// Modal and Toast utilities for user-facing errors and notifications
// Replaces console-only errors with user-facing modals

/**
 * Show error modal to user
 * @param {string} title - Modal title
 * @param {string} message - Error message
 * @param {Object} options - Additional options
 */
export function showErrorModal(title, message, options = {}) {
  const {
    onClose = null,
    showRetry = false,
    retryCallback = null,
    buttonText = 'Got it'
  } = options;

  // Remove existing error modal if present
  const existingModal = document.getElementById('jh-error-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'jh-error-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease;
  `;

  modal.innerHTML = `
    <div style="
      background: #fff;
      border-radius: 16px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 32px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
    ">
      <div style="display: flex; align-items: center; margin-bottom: 1rem;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" style="margin-right: 0.75rem;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h2 style="margin: 0; color: #1F2937; font-size: 1.25rem; font-weight: 600;">${title}</h2>
      </div>
      <p style="margin: 0 0 1.5rem 0; color: #4B5563; line-height: 1.6;">${message}</p>
      <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
        ${showRetry && retryCallback ? `
          <button id="jh-error-retry" style="
            background: #00E676;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          ">Try Again</button>
        ` : ''}
        <button id="jh-error-close" style="
          background: ${showRetry ? '#F3F4F6' : '#00E676'};
          color: ${showRetry ? '#1F2937' : '#fff'};
          border: none;
          border-radius: 8px;
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
        ">${buttonText}</button>
      </div>
    </div>
  `;

  // Add animations (only if style doesn't already exist to prevent duplicates)
  let style = document.getElementById('jh-modal-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'jh-modal-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);

  // Close handlers
  const closeModal = () => {
    modal.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => {
      modal.remove();
      // Don't remove style element - it's shared and may be needed by other modals
      if (onClose) onClose();
    }, 200);
  };

  document.getElementById('jh-error-close').addEventListener('click', closeModal);
  
  if (showRetry && retryCallback) {
    document.getElementById('jh-error-retry').addEventListener('click', () => {
      closeModal();
      setTimeout(() => retryCallback(), 100);
    });
  }

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

/**
 * Show success toast notification
 * @param {string} message - Success message
 * @param {number} duration - Display duration in ms (default: 3000)
 */
export function showToast(message, duration = 3000) {
  // Remove existing toast if present
  const existingToast = document.getElementById('jh-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'jh-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    background: #00E676;
    color: #fff;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 230, 118, 0.3);
    z-index: 10001;
    animation: slideInRight 0.3s ease;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 400px;
  `;

  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
    <span style="font-weight: 500;">${message}</span>
  `;

  // Add animation (only if style doesn't already exist to prevent duplicates)
  let style = document.getElementById('jh-toast-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'jh-toast-styles';
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => {
      toast.remove();
      // Don't remove style element - it's shared and may be needed by other toasts
    }, 300);
  }, duration);
}

/**
 * Show loading overlay with message
 * @param {string} message - Loading message
 * @param {string} [id] - Optional custom ID for the overlay (default: 'jh-loading-overlay')
 * @returns {Function} Function to hide the overlay
 */
export function showLoadingOverlay(message = 'Loading...', id = 'jh-loading-overlay') {
  // Remove existing overlay with this ID if present (prevents duplicate IDs)
  const existingOverlay = document.getElementById(id);
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.2s ease;
  `;

  overlay.innerHTML = `
    <div style="text-align: center;">
      <div style="
        width: 48px;
        height: 48px;
        border: 4px solid #E5E7EB;
        border-top: 4px solid #00E676;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      "></div>
      <p style="margin: 0; color: #4B5563; font-size: 1rem; font-weight: 500;">${message}</p>
    </div>
  `;

  // Add animations (only if style doesn't already exist to prevent duplicates)
  let style = document.getElementById('jh-loading-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'jh-loading-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  return () => {
    overlay.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => {
      overlay.remove();
      // Don't remove style element - it's shared and may be needed by other overlays
    }, 200);
  };
}

// Make functions available globally for backward compatibility
if (typeof window !== 'undefined') {
  window.showErrorModal = showErrorModal;
  window.showToast = showToast;
  window.showLoadingOverlay = showLoadingOverlay;
}
