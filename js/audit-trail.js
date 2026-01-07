// JobHackAI Audit Trail System
// Logs all agent actions, plan/auth changes, and restores for debugging

// Ensure global auditTrail object exists
if (!window.auditTrail) window.auditTrail = {};

window.auditTrail = {
  // Configuration
  config: {
    enabled: true,
    maxEntries: 100, // Keep last 100 entries
    includeDetails: true,
    includeTimestamps: true,
    includeUserContext: true,
    includeHealthData: false, // Set to true for debugging
    autoSave: true,
    saveInterval: 5000 // Save every 5 seconds
  },
  
  // Storage
  entries: [],
  lastSaveTime: 0,
  isLogging: false, // Flag to prevent recursive logging
  
  // Entry types
  types: {
    AGENT_ACTION: 'agent_action',
    PLAN_CHANGE: 'plan_change',
    AUTH_CHANGE: 'auth_change',
    NAVIGATION_UPDATE: 'navigation_update',
    BACKUP_CREATED: 'backup_created',
    BACKUP_RESTORED: 'backup_restored',
    HEALTH_CHECK: 'health_check',
    ERROR_OCCURRED: 'error_occurred',
    SELF_HEALING: 'self_healing',
    USER_ACTION: 'user_action'
  },
  
  // Initialize audit trail
  init: () => {
    if (!auditTrail.config.enabled) return;
    
    // Load existing entries
    auditTrail.loadEntries();
    
    // Set up auto-save
    if (auditTrail.config.autoSave) {
      setInterval(() => {
        auditTrail.saveEntries();
      }, auditTrail.config.saveInterval);
    }
    
    // Hook into existing functions
    auditTrail.hookIntoFunctions();
    
    console.log('📋 Audit trail initialized');
  },
  
  // Hook into existing functions to capture actions
  hookIntoFunctions: () => {
    // Hook into setPlan
    const originalSetPlan = window.setPlan;
    if (originalSetPlan) {
      window.setPlan = function(plan) {
        auditTrail.log(auditTrail.types.PLAN_CHANGE, {
          action: 'setPlan',
          plan: plan,
          previousPlan: localStorage.getItem('user-plan')
        });
        return originalSetPlan.apply(this, arguments);
      };
    }
    
    // Hook into setAuthState
    const originalSetAuthState = window.setAuthState;
    if (originalSetAuthState) {
      window.setAuthState = function(isAuthenticated, plan) {
        auditTrail.log(auditTrail.types.AUTH_CHANGE, {
          action: 'setAuthState',
          isAuthenticated: isAuthenticated,
          plan: plan,
          previousAuth: localStorage.getItem('user-authenticated')
        });
        return originalSetAuthState.apply(this, arguments);
      };
    }
    
    // Hook into updateNavigation (legacy)
    const originalUpdateNavigation = window.updateNavigation;
    if (originalUpdateNavigation) {
      window.updateNavigation = function() {
        auditTrail.log(auditTrail.types.NAVIGATION_UPDATE, {
          action: 'updateNavigation',
          currentPlan: localStorage.getItem('user-plan'),
          currentAuth: localStorage.getItem('user-authenticated')
        });
        return originalUpdateNavigation.apply(this, arguments);
      };
    }

    // Hook into scheduleUpdateNavigation (new scheduler) if present on global nav object
    if (window.JobHackAINavigation && typeof window.JobHackAINavigation.scheduleUpdateNavigation === 'function') {
      const origSched = window.JobHackAINavigation.scheduleUpdateNavigation;
      window.JobHackAINavigation.scheduleUpdateNavigation = function(...args) {
        auditTrail.log(auditTrail.types.NAVIGATION_UPDATE, {
          action: 'scheduleUpdateNavigation',
          args,
          currentPlan: localStorage.getItem('user-plan'),
          currentAuth: localStorage.getItem('user-authenticated')
        });
        return origSched.apply(this, args);
      };
    }
    
    // Hook into stateManager
    if (window.stateManager) {
      const originalBackup = window.stateManager.backup;
      if (originalBackup) {
        window.stateManager.backup = function(name) {
          auditTrail.log(auditTrail.types.BACKUP_CREATED, {
            action: 'backup',
            name: name,
            url: window.location.href
          });
          return originalBackup.apply(this, arguments);
        };
      }
      
      const originalRestore = window.stateManager.restore;
      if (originalRestore) {
        window.stateManager.restore = function(name) {
          auditTrail.log(auditTrail.types.BACKUP_RESTORED, {
            action: 'restore',
            name: name,
            url: window.location.href
          });
          return originalRestore.apply(this, arguments);
        };
      }
    }
    
    // Hook into agentInterface
    if (window.agentInterface) {
      const originalAnalyze = window.agentInterface.analyze;
      if (originalAnalyze) {
        window.agentInterface.analyze = function() {
          auditTrail.log(auditTrail.types.AGENT_ACTION, {
            action: 'analyze',
            agent: 'agentInterface'
          });
          return originalAnalyze.apply(this, arguments);
        };
      }
      
      // Hook into safe operations
      if (window.agentInterface.safe) {
        const originalExecute = window.agentInterface.safe.execute;
        if (originalExecute) {
          window.agentInterface.safe.execute = function(operation, description) {
            auditTrail.log(auditTrail.types.AGENT_ACTION, {
              action: 'safe_execute',
              description: description,
              agent: 'agentInterface'
            });
            return originalExecute.apply(this, arguments);
          };
        }
      }
    }
    
    // Hook into self-healing
    if (window.selfHealing) {
      const originalAttemptAutoFix = window.selfHealing.attemptAutoFix;
      if (originalAttemptAutoFix) {
        window.selfHealing.attemptAutoFix = function(issues) {
          auditTrail.log(auditTrail.types.SELF_HEALING, {
            action: 'attemptAutoFix',
            issues: issues,
            fixAttempts: window.selfHealing.fixAttempts
          });
          return originalAttemptAutoFix.apply(this, arguments);
        };
      }
    }
  },
  
  // Log an entry
  log: (type, data = {}) => {
    if (!auditTrail.config.enabled || auditTrail.isLogging) return;
    
    auditTrail.isLogging = true;
    
    const entry = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: type,
      data: data,
      url: window.location.href
    };
    
    // Add user context
    if (auditTrail.config.includeUserContext) {
      entry.userContext = {
        authenticated: localStorage.getItem('user-authenticated') === 'true',
        plan: localStorage.getItem('user-plan') || 'unknown',
        devPlan: localStorage.getItem('dev-plan') || null,
        sessionId: auditTrail.getSessionId()
      };
    }
    
    // Add health data if requested (only for non-health related entries)
    if (auditTrail.config.includeHealthData && window.siteHealth && type !== 'health_check') {
      try {
        entry.health = window.siteHealth.checkAll();
      } catch (error) {
        entry.health = { error: 'Failed to get health data' };
      }
    }
    
    // Add to entries
    auditTrail.entries.push(entry);
    
    // Keep only the last N entries
    if (auditTrail.entries.length > auditTrail.config.maxEntries) {
      auditTrail.entries = auditTrail.entries.slice(-auditTrail.config.maxEntries);
    }
    
    // Auto-save if enabled
    if (auditTrail.config.autoSave) {
      auditTrail.saveEntries();
    }
    
    console.log(`📋 Audit log: ${type}`, entry);
    
    // Reset logging flag
    setTimeout(() => {
      auditTrail.isLogging = false;
    }, 100);
  },
  
  // Log agent action
  logAgentAction: (action, result, context = {}) => {
    auditTrail.log(auditTrail.types.AGENT_ACTION, {
      action: action,
      result: result,
      context: context
    });
  },
  
  // Log user action
  logUserAction: (action, details = {}) => {
    auditTrail.log(auditTrail.types.USER_ACTION, {
      action: action,
      details: details
    });
  },
  
  // Log error
  logError: (error, context = {}) => {
    auditTrail.log(auditTrail.types.ERROR_OCCURRED, {
      error: error,
      context: context
    });
  },
  
  // Get session ID
  getSessionId: () => {
    let sessionId = localStorage.getItem('audit-trail-session');
    if (!sessionId) {
      sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('audit-trail-session', sessionId);
    }
    return sessionId;
  },
  
  // Save entries to localStorage
  saveEntries: () => {
    try {
      localStorage.setItem('audit-trail', JSON.stringify(auditTrail.entries));
      auditTrail.lastSaveTime = Date.now();
    } catch (error) {
      console.warn('Failed to save audit trail:', error);
    }
  },
  
  // Load entries from localStorage
  loadEntries: () => {
    try {
      const saved = localStorage.getItem('audit-trail');
      if (saved) {
        auditTrail.entries = JSON.parse(saved);
      }
    } catch (error) {
      console.warn('Failed to load audit trail:', error);
    }
  },
  
  // Get all entries
  getEntries: () => {
    return auditTrail.entries;
  },
  
  // Get entries by type
  getEntriesByType: (type) => {
    return auditTrail.entries.filter(entry => entry.type === type);
  },
  
  // Get recent entries
  getRecentEntries: (count = 10) => {
    return auditTrail.entries.slice(-count);
  },
  
  // Get entries since timestamp
  getEntriesSince: (timestamp) => {
    return auditTrail.entries.filter(entry => new Date(entry.timestamp) > new Date(timestamp));
  },
  
  // Clear entries
  clearEntries: () => {
    auditTrail.entries = [];
    localStorage.removeItem('audit-trail');
    console.log('📋 Audit trail cleared');
  },
  
  // Generate summary
  generateSummary: () => {
    const entries = auditTrail.entries;
    const summary = {
      total: entries.length,
      byType: {},
      recent: entries.slice(-5),
      sessionId: auditTrail.getSessionId(),
      firstEntry: entries[0]?.timestamp,
      lastEntry: entries[entries.length - 1]?.timestamp
    };
    
    entries.forEach(entry => {
      summary.byType[entry.type] = (summary.byType[entry.type] || 0) + 1;
    });
    
    return summary;
  },
  
  // Export entries
  exportEntries: () => {
    const data = {
      timestamp: new Date().toISOString(),
      entries: auditTrail.entries,
      summary: auditTrail.generateSummary()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  
  // Search entries
  searchEntries: (query) => {
    const searchTerm = query.toLowerCase();
    return auditTrail.entries.filter(entry => {
      return (
        entry.type.toLowerCase().includes(searchTerm) ||
        JSON.stringify(entry.data).toLowerCase().includes(searchTerm) ||
        entry.url.toLowerCase().includes(searchTerm)
      );
    });
  },
  
  // Get timeline
  getTimeline: () => {
    return auditTrail.entries.map(entry => ({
      timestamp: entry.timestamp,
      type: entry.type,
      action: entry.data.action || entry.type,
      url: entry.url
    }));
  }
};

// Initialize audit trail
auditTrail.init();

// Add to global debugging
if (window.navDebug) {
  window.navDebug.commands.auditTrail = () => auditTrail.getEntries();
  window.navDebug.commands.auditSummary = () => auditTrail.generateSummary();
  window.navDebug.commands.exportAudit = () => auditTrail.exportEntries();
  window.navDebug.commands.clearAudit = () => auditTrail.clearEntries();
  window.navDebug.commands.auditTimeline = () => auditTrail.getTimeline();
}

// At end of file, assign to window
window.auditTrail = auditTrail; 