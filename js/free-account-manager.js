/**
 * Free Account Manager for JobHackAI
 * Handles 1-resume ATS scoring limit for free accounts
 * Integrates with authentication and usage tracking
 */

class FreeAccountManager {
  constructor() {
    this.USAGE_KEY = 'free-ats-usage';
    this.MONTHLY_LIMIT = 1;
    this.RESET_DAY = 1; // Reset on the 1st of each month
  }

  /**
   * Get current usage data for free accounts
   */
  getUsageData() {
    try {
      const stored = localStorage.getItem(this.USAGE_KEY);
      if (!stored) {
        return {
          count: 0,
          lastReset: new Date().toISOString().slice(0, 7), // YYYY-MM format
          usageHistory: []
        };
      }
      return JSON.parse(stored);
    } catch (error) {
      console.error('Error loading usage data:', error);
      return {
        count: 0,
        lastReset: new Date().toISOString().slice(0, 7),
        usageHistory: []
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
   * Check if usage should be reset for new month
   */
  shouldResetUsage() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usageData = this.getUsageData();
    return usageData.lastReset !== currentMonth;
  }

  /**
   * Reset usage for new month
   */
  resetMonthlyUsage() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usageData = this.getUsageData();
    
    // Archive previous month's usage
    if (usageData.usageHistory.length === 0 || usageData.usageHistory[usageData.usageHistory.length - 1].month !== usageData.lastReset) {
      usageData.usageHistory.push({
        month: usageData.lastReset,
        count: usageData.count
      });
    }

    // Reset for new month
    this.saveUsageData({
      count: 0,
      lastReset: currentMonth,
      usageHistory: usageData.usageHistory.slice(-12) // Keep last 12 months
    });

    return true;
  }

  /**
   * Check if free user can use ATS scoring
   */
  canUseATSScoring() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    // Non-free plans have unlimited access
    if (userPlan !== 'free') {
      return { allowed: true, reason: 'unlimited' };
    }

    // Check if we need to reset for new month
    if (this.shouldResetUsage()) {
      this.resetMonthlyUsage();
    }

    const usageData = this.getUsageData();
    const remaining = this.MONTHLY_LIMIT - usageData.count;

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      total: this.MONTHLY_LIMIT,
      used: usageData.count,
      reason: remaining > 0 ? 'available' : 'limit_reached'
    };
  }

  /**
   * Record ATS scoring usage
   */
  recordATSUsage() {
    const userPlan = localStorage.getItem('user-plan') || 'free';
    
    // Non-free plans don't need tracking
    if (userPlan !== 'free') {
      return { success: true, reason: 'unlimited' };
    }

    // Check if we need to reset for new month
    if (this.shouldResetUsage()) {
      this.resetMonthlyUsage();
    }

    const usageData = this.getUsageData();
    
    // Check if limit reached
    if (usageData.count >= this.MONTHLY_LIMIT) {
      return { 
        success: false, 
        reason: 'limit_reached',
        message: 'You have reached your monthly limit of 1 free ATS score. Upgrade to continue.',
        remaining: 0,
        total: this.MONTHLY_LIMIT
      };
    }

    // Record usage
    usageData.count++;
    this.saveUsageData(usageData);

    return {
      success: true,
      reason: 'recorded',
      remaining: this.MONTHLY_LIMIT - usageData.count,
      total: this.MONTHLY_LIMIT,
      used: usageData.count
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
      return `${total}/${total} ATS scores used this month`;
    } else if (remaining === 1) {
      return `1 ATS score remaining this month`;
    } else {
      return `${remaining} ATS scores remaining this month`;
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
      title: 'Monthly Limit Reached',
      message: 'You\'ve used your 1 free ATS resume score for this month. Upgrade to continue scoring unlimited resumes.',
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
      if (!usageData.lastReset) {
        this.resetMonthlyUsage();
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
        monthlyLimit: null
      };
    }

    const usageCheck = this.canUseATSScoring();
    const usageData = this.getUsageData();

    return {
      plan: 'free',
      atsScoring: {
        remaining: usageCheck.remaining,
        total: usageCheck.total,
        used: usageData.count,
        canUse: usageCheck.allowed
      },
      monthlyLimit: this.MONTHLY_LIMIT,
      resetDate: this.getNextResetDate()
    };
  }

  /**
   * Get next reset date
   */
  getNextResetDate() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, this.RESET_DAY);
    return nextMonth.toISOString().slice(0, 10);
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
