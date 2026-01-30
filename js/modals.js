// Modal and Toast utilities for user-facing errors and notifications
// Replaces console-only errors with user-facing modals

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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
    buttonText = 'Got it',
    showUpgrade = false,  // NEW: Enable upgrade button
    upgradeCallback = null,  // NEW: Callback for upgrade action
    upgradeButtonText = 'Upgrade to Pro'  // NEW: Custom upgrade button text
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

  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);
  const escapedButtonText = escapeHtml(buttonText);
  const escapedUpgradeText = escapeHtml(upgradeButtonText);

  // Use green checkmark for upgrade modals, red error icon for others
  const iconColor = showUpgrade ? '#007A30' : '#EF4444';
  const iconSvg = showUpgrade ? `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" style="margin-right: 0.75rem;">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  ` : `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" style="margin-right: 0.75rem;">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  `;

  modal.innerHTML = `
    <div style="
      background: #FFFFFF;
      border-radius: 16px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 24px rgba(31, 41, 55, 0.07);
      animation: slideUp 0.3s ease;
    ">
      <div style="display: flex; align-items: center; margin-bottom: 1rem;">
        ${iconSvg}
        <h2 style="margin: 0; color: #1F2937; font-size: 1.25rem; font-weight: 600; font-family: 'Inter', sans-serif;">
          ${escapedTitle}
        </h2>
      </div>
      <p style="margin: 0 0 1.5rem 0; color: #4B5563; line-height: 1.6; font-size: 1rem; font-family: 'Inter', sans-serif;">
        ${escapedMessage}
      </p>
      <div style="display: flex; gap: 0.75rem; justify-content: ${showUpgrade ? 'space-between' : 'flex-end'};">
        ${showUpgrade ? `
          <button id="jh-error-upgrade" style="
            background: #007A30;
            color: #FFFFFF;
            border: none;
            border-radius: 8px;
            padding: 0.7rem 2rem;
            font-size: 1rem;
            font-weight: 700;
            font-family: 'Inter', sans-serif;
            cursor: pointer;
            transition: all 0.18s;
            flex: 1;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          " onmouseover="this.style.background='#006B28'; this.style.boxShadow='0 4px 12px rgba(0, 122, 48, 0.2)'" 
             onmouseout="this.style.background='#007A30'; this.style.boxShadow='0 2px 8px rgba(0, 0, 0, 0.04)'">
            ${escapedUpgradeText}
          </button>
          <button id="jh-error-close" style="
            background: transparent;
            color: #6B7280;
            border: 1px solid #E5E7EB;
            border-radius: 8px;
            padding: 0.7rem 1.5rem;
            font-size: 1rem;
            font-weight: 500;
            font-family: 'Inter', sans-serif;
            cursor: pointer;
            transition: all 0.18s;
          " onmouseover="this.style.background='#F9FAFB'; this.style.borderColor='#D1D5DB'" 
             onmouseout="this.style.background='transparent'; this.style.borderColor='#E5E7EB'">
            Maybe Later
          </button>
        ` : `
          ${showRetry && retryCallback ? `
            <button id="jh-error-retry" style="
              background: #007A30;
              color: #fff;
              border: none;
              border-radius: 8px;
              padding: 0.75rem 1.5rem;
              font-size: 1rem;
              font-weight: 600;
              font-family: 'Inter', sans-serif;
              cursor: pointer;
              transition: opacity 0.2s;
            ">Try Again</button>
          ` : ''}
          <button id="jh-error-close" style="
            background: ${showRetry ? '#F3F4F6' : '#007A30'};
            color: ${showRetry ? '#1F2937' : '#fff'};
            border: none;
            border-radius: 8px;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            font-weight: 600;
            font-family: 'Inter', sans-serif;
            cursor: pointer;
            transition: opacity 0.2s;
          ">${escapedButtonText}</button>
        `}
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

  const closeModal = () => {
    modal.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => {
      modal.remove();
      if (onClose) onClose();
    }, 200);
  };

  document.getElementById('jh-error-close').addEventListener('click', closeModal);

  if (showRetry && retryCallback) {
    const retryBtn = document.getElementById('jh-error-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        closeModal();
        setTimeout(() => retryCallback(), 100);
      });
    }
  }

  // NEW: Add upgrade button handler
  if (showUpgrade && upgradeCallback) {
    const upgradeBtn = document.getElementById('jh-error-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        closeModal();
        setTimeout(() => upgradeCallback(), 100);
      });
    }
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

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
    background: #007A30;
    color: #fff;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 122, 48, 0.3);
    z-index: 10001;
    animation: slideInRight 0.3s ease;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: 400px;
  `;

  const escapedMessage = escapeHtml(message);

  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
    <span style="font-weight: 500;">${escapedMessage}</span>
  `;

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

  const escapedMessage = escapeHtml(message);

  overlay.innerHTML = `
    <div style="text-align: center;">
      <div style="
        width: 48px;
        height: 48px;
        border: 4px solid #E5E7EB;
        border-top: 4px solid #007A30;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      "></div>
      <p style="margin: 0; color: #4B5563; font-size: 1rem; font-weight: 500;">${escapedMessage}</p>
    </div>
  `;

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
    }, 200);
  };
}

if (typeof window !== 'undefined') {
  window.showErrorModal = showErrorModal;
  window.showToast = showToast;
  window.showLoadingOverlay = showLoadingOverlay;
}
