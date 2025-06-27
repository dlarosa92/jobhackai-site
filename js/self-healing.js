// JobHackAI Self-Healing System
// Automatically fixes common issues and provides user guidance

// Ensure global selfHealing object exists
if (!window.selfHealing) window.selfHealing = {};
if (typeof window.selfHealing.showUserAlert !== 'function') {
  window.selfHealing.showUserAlert = function(errors) { 
    // Only show alerts for critical issues, not minor warnings
    console.warn('🔧 Self-healing detected issues:', errors);
    
    // Don't show alerts for minor issues or during development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log('🔧 Development mode: Suppressing user alerts for minor issues');
      return;
    }
    
    // Only show alerts for critical errors, not warnings
    if (typeof errors === 'string') {
      if (errors.includes('critical') || errors.includes('error')) {
        alert('Site issue detected: ' + errors);
      }
    } else if (Array.isArray(errors)) {
      const criticalIssues = errors.filter(issue => 
        issue.includes('critical') || issue.includes('error')
      );
      if (criticalIssues.length > 0) {
        alert('Critical site issues detected:\n' + criticalIssues.join('\n'));
      }
    }
  };
}

window.selfHealing = {
  // Configuration
  config: {
    enabled: true,
    autoFix: true,
    showUserAlerts: true,
    maxFixAttempts: 3,
    fixCooldown: 10000 // 10 seconds between fix attempts
  },
  
  // State tracking
  fixAttempts: 0,
  lastFixTime: 0,
  isFixing: false,
  isChecking: false, // Flag to prevent recursive checks
  recheckCount: 0, // Count of re-checks after fixes
  maxRechecks: 3, // Maximum number of re-checks
  
  // Initialize self-healing
  init: () => {
    if (!selfHealing.config.enabled) return;
    
    // Monitor for issues
    selfHealing.startMonitoring();
    
    // Add global error handler
    window.addEventListener('error', (event) => {
      selfHealing.handleError(event);
    });
    
    console.log('🔧 Self-healing system initialized');
  },
  
  // Start monitoring for issues
  startMonitoring: () => {
    // Check for issues every 30 seconds
    setInterval(() => {
      if (!selfHealing.isFixing && !selfHealing.isChecking) {
        selfHealing.checkForIssues();
      }
    }, 30000);
    
    // Check on page load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => selfHealing.checkForIssues(), 2000);
      });
    } else {
      setTimeout(() => selfHealing.checkForIssues(), 2000);
    }
  },
  
  // Check for common issues
  checkForIssues: () => {
    if (selfHealing.isChecking) return;
    
    selfHealing.isChecking = true;
    
    const issues = [];
    
    // Check navigation (only if not already fixing)
    if (window.siteHealth && !selfHealing.isFixing) {
      try {
        const health = window.siteHealth.checkAll();
        if (!health.navigation.healthy) {
          issues.push(...health.navigation.issues);
        }
        if (!health.dom.healthy) {
          issues.push(...health.dom.missing.map(el => `Missing DOM element: ${el}`));
        }
      } catch (error) {
        console.warn('🔧 Health check failed during self-healing:', error);
      }
    }
    
    // Check localStorage
    const requiredKeys = ['user-authenticated', 'user-plan'];
    requiredKeys.forEach(key => {
      if (!localStorage.getItem(key)) {
        issues.push(`Missing localStorage key: ${key}`);
      }
    });
    
    // Check for broken navigation
    const navElements = [
      '.nav-group',
      '.nav-links',
      '#mobileNav'
    ];
    
    navElements.forEach(selector => {
      if (!document.querySelector(selector)) {
        issues.push(`Missing navigation element: ${selector}`);
      }
    });
    
    // Handle issues if found
    if (issues.length > 0) {
      selfHealing.handleIssues(issues);
    }
    
    // Reset checking flag
    setTimeout(() => {
      selfHealing.isChecking = false;
    }, 100);
  },
  
  // Handle errors
  handleError: (event) => {
    const error = {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    };
    
    // Try to auto-fix common errors
    if (selfHealing.config.autoFix) {
      selfHealing.attemptAutoFix(error);
    }
    
    // Show user-friendly error
    if (selfHealing.config.showUserAlerts) {
      selfHealing.showUserAlert([error]);
    }
  },
  
  // Handle issues
  handleIssues: (issues) => {
    console.warn('🔧 Issues detected:', issues);
    
    // Try to auto-fix
    if (selfHealing.config.autoFix && selfHealing.canAttemptFix()) {
      selfHealing.attemptAutoFix(issues);
    }
    
    // Show user alert
    if (selfHealing.config.showUserAlerts) {
      selfHealing.showUserAlert(issues);
    }
  },
  
  // Check if we can attempt a fix
  canAttemptFix: () => {
    const now = Date.now();
    if (now - selfHealing.lastFixTime < selfHealing.config.fixCooldown) {
      return false;
    }
    if (selfHealing.fixAttempts >= selfHealing.config.maxFixAttempts) {
      return false;
    }
    return true;
  },
  
  // Attempt auto-fix
  attemptAutoFix: (issues) => {
    if (selfHealing.isFixing) return;
    
    selfHealing.isFixing = true;
    selfHealing.fixAttempts++;
    selfHealing.lastFixTime = Date.now();
    
    console.log('🔧 Attempting auto-fix...');
    
    const fixes = [];
    
    // Fix navigation issues
    if (window.updateNavigation) {
      try {
        updateNavigation();
        fixes.push('Navigation updated');
      } catch (error) {
        console.error('Failed to fix navigation:', error);
      }
    }
    
    // Fix localStorage issues
    if (!localStorage.getItem('user-authenticated')) {
      localStorage.setItem('user-authenticated', 'false');
      fixes.push('Set default authentication state');
    }
    
    if (!localStorage.getItem('user-plan')) {
      localStorage.setItem('user-plan', 'free');
      fixes.push('Set default user plan');
    }
    
    // Fix DOM issues
    if (!document.querySelector('.nav-group') && document.querySelector('.site-header')) {
      const header = document.querySelector('.site-header .container');
      if (header) {
        const navGroup = document.createElement('div');
        navGroup.className = 'nav-group';
        header.appendChild(navGroup);
        fixes.push('Created missing nav-group');
      }
    }
    
    // Check if fixes worked
    setTimeout(() => {
      selfHealing.isFixing = false;
      
      if (fixes.length > 0) {
        console.log('🔧 Auto-fix applied:', fixes);
        
        // Re-check for issues (with limit)
        if (selfHealing.recheckCount < selfHealing.maxRechecks) {
          selfHealing.recheckCount++;
          setTimeout(() => {
            selfHealing.checkForIssues();
          }, 2000);
        } else {
          console.log('🔧 Max re-checks reached, stopping auto-fix cycle');
          selfHealing.recheckCount = 0; // Reset for next time
        }
      }
    }, 1000);
  },
  
  // Show notification to user
  showNotification: (message, type = 'info', details = null, buttons = null) => {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `self-healing-notification ${type}`;
    
    // Determine which buttons to show
    let actionsHtml = '';
    if (buttons) {
      if (buttons.includes('fix')) {
        actionsHtml += '<button class="btn-fix-now">Fix Now</button>';
      }
      if (buttons.includes('reload')) {
        actionsHtml += '<button class="btn-reload">Reload</button>';
      }
      if (buttons.includes('dismiss')) {
        actionsHtml += '<button class="btn-dismiss">Dismiss</button>';
      }
    } else {
      // Default: show Fix Now and Dismiss for errors, only Dismiss for info/success
      if (type === 'error' || type === 'warning') {
        actionsHtml = '<button class="btn-fix-now">Fix Now</button><button class="btn-dismiss">Dismiss</button>';
      } else {
        actionsHtml = '<button class="btn-dismiss">Dismiss</button>';
      }
    }
    
    notification.innerHTML = `
      <div class="notification-content">
        <div class="notification-message">${message}</div>
        ${details ? `<div class="notification-details">${details.join(', ')}</div>` : ''}
        <div class="notification-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
    
    // Add styles
    if (!document.querySelector('#self-healing-styles')) {
      const styles = document.createElement('style');
      styles.id = 'self-healing-styles';
      styles.textContent = `
        .self-healing-notification {
          position: fixed;
          top: 20px;
          right: 20px;
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10000;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .self-healing-notification.error {
          border-left: 4px solid #dc3545;
        }
        .self-healing-notification.warning {
          border-left: 4px solid #ffc107;
        }
        .self-healing-notification.info {
          border-left: 4px solid #007bff;
        }
        .notification-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .notification-message {
          font-weight: 500;
          color: #333;
        }
        .notification-details {
          font-size: 12px;
          color: #666;
          background: #f8f9fa;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .notification-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .notification-actions button {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        .btn-fix-now {
          background: #007bff;
          color: white;
        }
        .btn-reload {
          background: #28a745;
          color: white;
        }
        .btn-dismiss {
          background: #6c757d;
          color: white;
        }
      `;
      document.head.appendChild(styles);
    }
    
    // Add event listeners
    if (notification.querySelector('.btn-fix-now')) {
      notification.querySelector('.btn-fix-now').addEventListener('click', () => {
        selfHealing.manualFix();
        notification.remove();
      });
    }
    if (notification.querySelector('.btn-reload')) {
      notification.querySelector('.btn-reload').addEventListener('click', () => {
        location.reload();
      });
    }
    if (notification.querySelector('.btn-dismiss')) {
      notification.querySelector('.btn-dismiss').addEventListener('click', () => {
        notification.remove();
      });
    }
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 10000);
  },
  
  // Manual fix triggered by user
  manualFix: () => {
    console.log('🔧 Manual fix triggered by user');
    
    // Reset fix attempts
    selfHealing.fixAttempts = 0;
    
    // Attempt comprehensive fix
    selfHealing.attemptAutoFix(['manual-fix']);
    
    // Show success message
    setTimeout(() => {
      selfHealing.showFixApplied();
    }, 2000);
  },
  
  // Reset fix attempts
  reset: () => {
    selfHealing.fixAttempts = 0;
    selfHealing.lastFixTime = 0;
    selfHealing.isFixing = false;
    selfHealing.isChecking = false;
    selfHealing.recheckCount = 0;
    console.log('🔧 Self-healing system reset');
  },
  
  // Get status
  getStatus: () => {
    return {
      enabled: selfHealing.config.enabled,
      autoFix: selfHealing.config.autoFix,
      fixAttempts: selfHealing.fixAttempts,
      maxAttempts: selfHealing.config.maxFixAttempts,
      isFixing: selfHealing.isFixing,
      isChecking: selfHealing.isChecking,
      recheckCount: selfHealing.recheckCount,
      maxRechecks: selfHealing.maxRechecks,
      lastFixTime: selfHealing.lastFixTime
    };
  }
};

// Initialize self-healing
selfHealing.init();

// Add to global debugging
if (window.navDebug) {
  window.navDebug.commands.selfHealingStatus = () => selfHealing.getStatus();
  window.navDebug.commands.manualFix = () => selfHealing.manualFix();
  window.navDebug.commands.resetSelfHealing = () => selfHealing.reset();
}

// At end of file, assign to window
window.selfHealing = selfHealing; 