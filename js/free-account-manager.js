/**
 * Free Account Manager for JobHackAI
 * Handles 1-resume ATS scoring limit for free accounts
 * Integrates with authentication and usage tracking
 */

class FreeAccountManager {
  constructor() {
    this.USAGE_KEY = 'free-ats-usage';
    this.LIFETIME_LIMIT = 1; // Changed from monthly to lifetime
  }

  /**
   * Get current usage data for free accounts
   * Handles migration from old monthly format to new lifetime format
   */
  getUsageData() {
    try {
      const stored = localStorage.getItem(this.USAGE_KEY);
      if (!stored) {
        return {
          used: false,
          usedAt: null
        };
      }
      
      const parsed = JSON.parse(stored);
      
      // Check if data is in old format (monthly tracking)
      if (parsed.count !== undefined || parsed.lastReset !== undefined || parsed.usageHistory !== undefined) {
        // Migrate from old format to new format
        const hasUsedCredit = parsed.count > 0 || 
                              (parsed.usageHistory && parsed.usageHistory.length > 0 && 
                               parsed.usageHistory.some(entry => entry.count > 0));
        
        const migratedData = {
          used: hasUsedCredit,
          usedAt: hasUsedCredit ? (parsed.usageHistory && parsed.usageHistory.length > 0 
            ? parsed.usageHistory[parsed.usageHistory.length - 1].month + '-01' 
            : new Date().toISOString()) : null
        };
        
        // Save migrated data
        this.saveUsageData(migratedData);
        console.log('✅ Migrated usage data from old monthly format to lifetime format');
        
        return migratedData;
      }
      
      // Data is already in new format
      return parsed;
    } catch (error) {
      console.error('Error loading usage data:', error);
      return {
        used: false,
        usedAt: null
      };
    }
  }

  /**
   * Save usage data
   */
  saveUsageData(data) {
    try {
      localStorage.setItem(this.USAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving usage data:', error);
    }
  }

  /**
   * Check if free user can use ATS scoring (lifetime limit)
   */
  canUseATSScoring() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    // Non-free plans have unlimited access
    if (userPlan !== 'free') {
      return { allowed: true, reason: 'unlimited' };
    }

    // Check lifetime credit using Firebase UID-based credits
    const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
    if (currentUser && currentUser.uid) {
      const creditKey = `creditsByUid:${currentUser.uid}`;
      const creditsData = localStorage.getItem(creditKey);
      if (creditsData) {
        try {
          const credits = JSON.parse(creditsData);
          const hasCredit = credits.ats_free_lifetime > 0;
          return {
            allowed: hasCredit,
            remaining: hasCredit ? 1 : 0,
            total: this.LIFETIME_LIMIT,
            used: hasCredit ? 0 : 1,
            reason: hasCredit ? 'available' : 'limit_reached'
          };
        } catch (e) {
          console.warn('Failed to parse credits data:', e);
        }
      }
    }

    // Fallback to legacy usage tracking
    const usageData = this.getUsageData();
    const hasRemaining = !usageData.used;

    return {
      allowed: hasRemaining,
      remaining: hasRemaining ? 1 : 0,
      total: this.LIFETIME_LIMIT,
      used: hasRemaining ? 0 : 1,
      reason: hasRemaining ? 'available' : 'limit_reached'
    };
  }

  /**
   * Record ATS scoring usage (lifetime limit)
   */
  recordATSUsage() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    // Non-free plans don't need tracking
    if (userPlan !== 'free') {
      return { success: true, reason: 'unlimited' };
    }

    // Check lifetime credit using Firebase UID-based credits
    const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
    if (currentUser && currentUser.uid) {
      const creditKey = `creditsByUid:${currentUser.uid}`;
      const creditsData = localStorage.getItem(creditKey);
      let credits = { ats_free_lifetime: 1 };
      if (creditsData) {
        try {
          credits = JSON.parse(creditsData);
        } catch (e) {
          console.warn('Failed to parse credits data:', e);
        }
      }
      
      // Check if limit reached
      if (credits.ats_free_lifetime <= 0) {
        return { 
          success: false, 
          reason: 'limit_reached',
          message: 'You have used your 1 free lifetime ATS score. Upgrade to continue.',
          remaining: 0,
          total: this.LIFETIME_LIMIT
        };
      }

      // Credit consumption is handled in dashboard.html
      // This function just validates
      return {
        success: true,
        reason: 'recorded',
        remaining: 0,
        total: this.LIFETIME_LIMIT,
        used: 1
      };
    }

    // Fallback to legacy usage tracking
    const usageData = this.getUsageData();
    
    // Check if limit reached
    if (usageData.used) {
      return { 
        success: false, 
        reason: 'limit_reached',
        message: 'You have used your 1 free lifetime ATS score. Upgrade to continue.',
        remaining: 0,
        total: this.LIFETIME_LIMIT
      };
    }

    // Record usage
    this.saveUsageData({
      used: true,
      usedAt: new Date().toISOString()
    });

    return {
      success: true,
      reason: 'recorded',
      remaining: 0,
      total: this.LIFETIME_LIMIT,
      used: 1
    };
  }

  /**
   * Get usage display text
   */
  getUsageDisplayText() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    if (userPlan !== 'free') {
      return null; // No limit display for paid plans
    }

    const usageCheck = this.canUseATSScoring();
    
    if (usageCheck.reason === 'unlimited') {
      return null;
    }

    const remaining = usageCheck.remaining;
    const total = usageCheck.total;
    
    if (remaining === 0) {
      return `Free ATS score used (lifetime). Upgrade for unlimited scoring.`;
    } else if (remaining === 1) {
      return `1 free ATS score (lifetime)`;
    } else {
      return `${remaining} free ATS scores remaining`;
    }
  }

  /**
   * Get upgrade prompt message
   */
  getUpgradeMessage() {
    const usageCheck = this.canUseATSScoring();
    
    if (usageCheck.allowed) {
      return null;
    }

    return {
      title: 'Free ATS Score Used',
      message: 'You\'ve used your 1 free lifetime ATS resume score. Upgrade to continue scoring unlimited resumes.',
      cta: 'Upgrade Now',
      features: [
        'Unlimited ATS scoring',
        'Detailed resume feedback',
        'Interview question generator',
        'Priority support'
      ]
    };
  }

  /**
   * Initialize usage tracking for new free users
   */
  initializeForNewUser() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    if (userPlan === 'free') {
      // Ensure usage tracking is initialized
      const usageData = this.getUsageData();
      if (usageData.used === undefined) {
        this.saveUsageData({
          used: false,
          usedAt: null
        });
      }
    }
  }

  /**
   * Get usage statistics for dashboard
   */
  getUsageStats() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    if (userPlan !== 'free') {
      return {
        plan: userPlan,
        atsScoring: 'unlimited',
        lifetimeLimit: null
      };
    }

    const usageCheck = this.canUseATSScoring();
    const usageData = this.getUsageData();

    return {
      plan: 'free',
      atsScoring: {
        remaining: usageCheck.remaining,
        total: usageCheck.total,
        used: usageData.used ? 1 : 0,
        canUse: usageCheck.allowed
      },
      lifetimeLimit: this.LIFETIME_LIMIT
    };
  }
}

// Create singleton instance
const freeAccountManager = new FreeAccountManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FreeAccountManager;
}

// Make available globally
window.FreeAccountManager = FreeAccountManager;
window.freeAccountManager = freeAccountManager;
