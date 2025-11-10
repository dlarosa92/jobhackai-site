/**
 * JobHackAI Toast Notification System
 * Subtle toast notifications for success messages and quick feedback
 */

(function() {
  'use strict';

  let toastZIndex = 10001;
  const toastContainer = (function() {
    let container = document.getElementById('jh-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'jh-toast-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: ${toastZIndex};
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        pointer-events: none;
        max-width: 400px;
      `;
      document.body.appendChild(container);
    }
    return container;
  })();

  /**
   * Create and show toast notification
   * @param {Object} options - Toast configuration
   * @param {string} options.message - Toast message
   * @param {string} [options.type] - 'success', 'error', 'warning', 'info' (default: 'success')
   * @param {number} [options.duration] - Duration in ms (default: 3000)
   * @returns {HTMLElement} Toast element
   */
  function createToast({
    message,
    type = 'success',
    duration = 3000
  }) {
    const toast = document.createElement('div');
    toast.className = `jh-toast jh-toast-${type}`;
    
    // Colors by type
    const colors = {
      success: { bg: '#F0FDF4', border: '#10B981', icon: '#10B981' },
      error: { bg: '#FEF2F2', border: '#EF4444', icon: '#EF4444' },
      warning: { bg: '#FFFBEB', border: '#F59E0B', icon: '#F59E0B' },
      info: { bg: '#EFF6FF', border: '#3B82F6', icon: '#3B82F6' }
    };

    const color = colors[type] || colors.success;

    toast.style.cssText = `
      background: white;
      border-left: 4px solid ${color.border};
      border-radius: 8px;
      padding: 1rem 1.25rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      pointer-events: auto;
      animation: slideInRight 0.3s ease-out;
      min-width: 280px;
      max-width: 400px;
    `;

    // Icon
    const icons = {
      success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`,
      error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`,
      warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>`,
      info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>`
    };

    const iconEl = document.createElement('div');
    iconEl.style.cssText = `
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    iconEl.innerHTML = icons[type] || icons.success;

    const messageEl = document.createElement('div');
    messageEl.style.cssText = `
      flex: 1;
      color: #232B36;
      font-size: 0.95rem;
      line-height: 1.5;
    `;
    messageEl.textContent = message;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #9CA3AF;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      transition: color 0.18s;
    `;
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
    closeBtn.addEventListener('click', () => hideToast(toast));
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#4B5563';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = '#9CA3AF';
    });

    toast.appendChild(iconEl);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);

    // Add animations if not already present
    if (!document.querySelector('#jh-toast-styles')) {
      const styles = document.createElement('style');
      styles.id = 'jh-toast-styles';
      styles.textContent = `
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes slideOutRight {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }
      `;
      document.head.appendChild(styles);
    }

    toastContainer.appendChild(toast);

    // Auto-hide after duration
    if (duration > 0) {
      setTimeout(() => hideToast(toast), duration);
    }

    return toast;
  }

  /**
   * Hide toast notification
   * @param {HTMLElement} toast - Toast element
   */
  function hideToast(toast) {
    if (toast && toast.parentNode) {
      toast.style.animation = 'slideOutRight 0.3s ease-in';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }
  }

  // Export public API
  window.JobHackAIToast = {
    /**
     * Show success toast
     * @param {string} message - Success message
     * @param {number} duration - Duration in ms (default: 3000)
     */
    success(message, duration = 3000) {
      return createToast({ message, type: 'success', duration });
    },

    /**
     * Show error toast
     * @param {string} message - Error message
     * @param {number} duration - Duration in ms (default: 4000)
     */
    error(message, duration = 4000) {
      return createToast({ message, type: 'error', duration });
    },

    /**
     * Show warning toast
     * @param {string} message - Warning message
     * @param {number} duration - Duration in ms (default: 4000)
     */
    warning(message, duration = 4000) {
      return createToast({ message, type: 'warning', duration });
    },

    /**
     * Show info toast
     * @param {string} message - Info message
     * @param {number} duration - Duration in ms (default: 3000)
     */
    info(message, duration = 3000) {
      return createToast({ message, type: 'info', duration });
    }
  };
})();

