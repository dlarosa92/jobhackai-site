// JobHackAI Error Reporting System
// Captures errors, health issues, and user context for debugging

// Ensure global errorReports array exists
if (!window.errorReports) window.errorReports = [];

window.errorReporter = {
  // Configuration
  config: {
    enabled: true,
    maxReports: 50, // Keep last 50 reports
    reportInterval: 5000, // Don't send reports more than once every 5 seconds
    includeUserContext: true,
    includeHealthData: true,
    includeConsoleLogs: false, // Set to true for debugging
    endpoint: null // Set to your endpoint if you want to send reports
  },
  
  // Storage for reports
  reports: [],
  lastReportTime: 0,
  isCapturing: false, // Flag to prevent recursive captures
  
  // Initialize error reporting
  init: () => {
    if (!errorReporter.config.enabled) return;
    
    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      errorReporter.captureError('unhandled', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack
      });
    });
    
    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      errorReporter.captureError('unhandled-promise', {
        message: event.reason?.message || 'Promise rejected',
        reason: event.reason
      });
    });
    
    // Capture navigation errors
    const originalUpdateNavigation = window.updateNavigation;
    if (originalUpdateNavigation) {
      window.updateNavigation = function() {
        try {
          return originalUpdateNavigation.apply(this, arguments);
        } catch (error) {
          errorReporter.captureError('navigation-update', {
            message: error.message,
            stack: error.stack
          });
          throw error;
        }
      };
    }
    
    console.log('🔍 Error reporting initialized');
  },
  
  // Capture an error
  captureError: (type, data) => {
    if (!errorReporter.config.enabled || errorReporter.isCapturing) return;
    
    errorReporter.isCapturing = true;
    
    const report = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: type,
      data: data,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
    
    // Add user context
    if (errorReporter.config.includeUserContext) {
      report.userContext = {
        authenticated: localStorage.getItem('user-authenticated') === 'true',
        plan: localStorage.getItem('user-plan') || 'unknown',
        devPlan: localStorage.getItem('dev-plan') || null,
        sessionId: errorReporter.getSessionId()
      };
    }
    
    // Add health data (only if not already capturing from health check)
    if (errorReporter.config.includeHealthData && window.siteHealth && type !== 'health-issue') {
      try {
        report.health = window.siteHealth.checkAll();
      } catch (error) {
        report.health = { error: 'Failed to get health data' };
      }
    }
    
    // Add console logs if enabled
    if (errorReporter.config.includeConsoleLogs) {
      report.consoleLogs = errorReporter.getRecentConsoleLogs();
    }
    
    // Store report
    errorReporter.reports.push(report);
    
    // Keep only the last N reports
    if (errorReporter.reports.length > errorReporter.config.maxReports) {
      errorReporter.reports = errorReporter.reports.slice(-errorReporter.config.maxReports);
    }
    
    // Save to localStorage
    errorReporter.saveReports();
    
    // Send report if endpoint is configured
    errorReporter.sendReport(report);
    
    console.error(`🔍 Error captured: ${type}`, report);
    
    // Reset capture flag
    setTimeout(() => {
      errorReporter.isCapturing = false;
    }, 100);
  },
  
  // Capture health issues
  captureHealthIssue: (issues, context = {}) => {
    errorReporter.captureError('health-issue', {
      issues: issues,
      context: context
    });
  },
  
  // Capture agent actions
  captureAgentAction: (action, result, context = {}) => {
    errorReporter.captureError('agent-action', {
      action: action,
      result: result,
      context: context
    });
  },
  
  // Get session ID
  getSessionId: () => {
    let sessionId = localStorage.getItem('error-reporter-session');
    if (!sessionId) {
      sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('error-reporter-session', sessionId);
    }
    return sessionId;
  },
  
  // Get recent console logs
  getRecentConsoleLogs: () => {
    // This would need to be implemented by overriding console methods
    // For now, return empty array
    return [];
  },
  
  // Save reports to localStorage
  saveReports: () => {
    try {
      localStorage.setItem('error-reports', JSON.stringify(errorReporter.reports));
    } catch (error) {
      console.warn('Failed to save error reports:', error);
    }
  },
  
  // Load reports from localStorage
  loadReports: () => {
    try {
      const saved = localStorage.getItem('error-reports');
      if (saved) {
        errorReporter.reports = JSON.parse(saved);
      }
    } catch (error) {
      console.warn('Failed to load error reports:', error);
    }
  },
  
  // Send report to endpoint
  sendReport: (report) => {
    if (!errorReporter.config.endpoint) return;
    
    const now = Date.now();
    if (now - errorReporter.lastReportTime < errorReporter.config.reportInterval) {
      return; // Rate limiting
    }
    
    errorReporter.lastReportTime = now;
    
    // Send via fetch (you can modify this for your endpoint)
    fetch(errorReporter.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report)
    }).catch(error => {
      console.warn('Failed to send error report:', error);
    });
  },
  
  // Get all reports
  getReports: () => {
    return errorReporter.reports;
  },
  
  // Get recent reports
  getRecentReports: (count = 10) => {
    return errorReporter.reports.slice(-count);
  },
  
  // Clear reports
  clearReports: () => {
    errorReporter.reports = [];
    localStorage.removeItem('error-reports');
    console.log('🔍 Error reports cleared');
  },
  
  // Generate summary
  generateSummary: () => {
    const reports = errorReporter.reports;
    const summary = {
      total: reports.length,
      byType: {},
      recent: reports.slice(-5),
      sessionId: errorReporter.getSessionId()
    };
    
    reports.forEach(report => {
      summary.byType[report.type] = (summary.byType[report.type] || 0) + 1;
    });
    
    return summary;
  },
  
  // Export reports
  exportReports: () => {
    const data = {
      timestamp: new Date().toISOString(),
      reports: errorReporter.reports,
      summary: errorReporter.generateSummary()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-reports-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
};

// Initialize error reporting
errorReporter.loadReports();
errorReporter.init();

// Add to global debugging
if (window.navDebug) {
  window.navDebug.commands.errorReports = () => errorReporter.getReports();
  window.navDebug.commands.errorSummary = () => errorReporter.generateSummary();
  window.navDebug.commands.exportErrors = () => errorReporter.exportReports();
  window.navDebug.commands.clearErrors = () => errorReporter.clearReports();
} 