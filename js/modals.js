/**
 * JobHackAI Modal System
 * Reusable modal components for error, warning, and success messages
 * Uses design system tokens for consistent styling
 */

(function() {
  'use strict';

  // Modal z-index management
  let modalZIndex = 10000;

  /**
   * Base modal function - creates a modal with customizable content
   * @param {Object} options - Modal configuration
   * @param {string} options.type - 'error', 'warning', or 'success'
   * @param {string} options.message - Main message text
   * @param {string} [options.title] - Optional title (defaults based on type)
   * @param {Function} [options.action] - Optional action button callback
   * @param {string} [options.actionLabel] - Action button label
   * @param {boolean} [options.showClose] - Show close button (default: true)
   * @returns {HTMLElement} Modal element
   */
  function createModal({
    type = 'info',
    message,
    title = null,
    action = null,
    actionLabel = 'OK',
    showClose = true
  }) {
    // Default titles by type
    const defaultTitles = {
      error: 'Something went wrong',
      warning: 'Please note',
      success: 'Success',
      info: 'Information'
    };

    const modalTitle = title || defaultTitles[type] || 'Information';

    // Icon SVG by type
    const icons = {
      error: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`,
      warning: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>`,
      success: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`,
      info: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1976D2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>`
    };

    // Background colors by type
    const bgColors = {
      error: '#FEF2F2',
      warning: '#FFFBEB',
      success: '#F0FDF4',
      info: '#EFF6FF'
    };

    // Icon container colors
    const iconBgColors = {
      error: '#FEE2E2',
      warning: '#FEF3C7',
      success: '#D1FAE5',
      info: '#DBEAFE'
    };

    const modal = document.createElement('div');
    modal.className = 'jh-modal-overlay';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: ${modalZIndex++};
      animation: fadeIn 0.2s ease-in-out;
    `;

    const modalContent = document.createElement('div');
    modalContent.className = 'jh-modal-content';
    modalContent.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 2rem;
      max-width: 480px;
      width: 90%;
      margin: 1rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: slideUp 0.3s ease-out;
      position: relative;
    `;

    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = `
      width: 64px;
      height: 64px;
      background: ${iconBgColors[type] || iconBgColors.info};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.25rem;
    `;
    iconContainer.innerHTML = icons[type] || icons.info;

    const titleEl = document.createElement('h3');
    titleEl.style.cssText = `
      margin: 0 0 0.75rem 0;
      color: #232B36;
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
    `;
    titleEl.textContent = modalTitle;

    const messageEl = document.createElement('p');
    messageEl.style.cssText = `
      margin: 0 0 1.5rem 0;
      color: #64748B;
      line-height: 1.6;
      font-size: 1rem;
      text-align: center;
    `;
    messageEl.textContent = message;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    `;

    // Close on Escape key - store handler for cleanup
    const handleEscape = (e) => {
      if (e.key === 'Escape' && modal.parentNode) {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Store cleanup function on modal for removal
    modal._cleanupEscape = () => {
      document.removeEventListener('keydown', handleEscape);
    };

    // Helper function to close modal with cleanup
    const closeModal = () => {
      if (modal._cleanupEscape) {
        modal._cleanupEscape();
      }
      modal.remove();
    };

    // Close button
    if (showClose) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'jh-modal-close';
      closeBtn.style.cssText = `
        background: #F3F4F6;
        color: #4B5563;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 1rem;
        transition: background 0.18s;
        flex: 1;
        min-width: 120px;
      `;
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', closeModal);
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = '#E5E7EB';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = '#F3F4F6';
      });
      buttonContainer.appendChild(closeBtn);
    }

    // Action button
    if (action) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'jh-modal-action';
      actionBtn.style.cssText = `
        background: #00E676;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 1rem;
        transition: background 0.18s;
        flex: 1;
        min-width: 120px;
      `;
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener('click', () => {
        action();
        closeModal();
      });
      actionBtn.addEventListener('mouseenter', () => {
        actionBtn.style.background = '#00c965';
      });
      actionBtn.addEventListener('mouseleave', () => {
        actionBtn.style.background = '#00E676';
      });
      buttonContainer.appendChild(actionBtn);
    }

    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Assemble modal
    modalContent.appendChild(iconContainer);
    modalContent.appendChild(titleEl);
    modalContent.appendChild(messageEl);
    modalContent.appendChild(buttonContainer);
    modal.appendChild(modalContent);

    // Add animations
    if (!document.querySelector('#jh-modal-styles')) {
      const styles = document.createElement('style');
      styles.id = 'jh-modal-styles';
      styles.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(modal);

    // Focus management for accessibility
    const firstButton = modalContent.querySelector('button');
    if (firstButton) {
      setTimeout(() => firstButton.focus(), 100);
    }

    return modal;
  }

  // Export public API
  window.JobHackAIModals = {
    /**
     * Show error modal
     * @param {string} message - Error message
     * @param {Function} [action] - Optional action callback
     * @param {string} [actionLabel] - Action button label
     */
    errorModal(message, action = null, actionLabel = 'Try Again') {
      return createModal({
        type: 'error',
        message,
        action,
        actionLabel
      });
    },

    /**
     * Show warning modal
     * @param {string} message - Warning message
     * @param {Function} [action] - Optional action callback
     * @param {string} [actionLabel] - Action button label
     */
    warningModal(message, action = null, actionLabel = 'Continue') {
      return createModal({
        type: 'warning',
        message,
        action,
        actionLabel
      });
    },

    /**
     * Show success modal
     * @param {string} message - Success message
     * @param {Function} [action] - Optional action callback
     * @param {string} [actionLabel] - Action button label
     */
    successModal(message, action = null, actionLabel = 'OK') {
      return createModal({
        type: 'success',
        message,
        action,
        actionLabel
      });
    },

    /**
     * Show info modal
     * @param {string} message - Info message
     * @param {Function} [action] - Optional action callback
     * @param {string} [actionLabel] - Action button label
     */
    infoModal(message, action = null, actionLabel = 'OK') {
      return createModal({
        type: 'info',
        message,
        action,
        actionLabel
      });
    }
  };
})();

