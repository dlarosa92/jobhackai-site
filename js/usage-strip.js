/**
 * Usage & Limits Strip
 * Global usage display component for dashboard header
 * Shows plan-aware usage meters and limits for all features
 */

(function() {
  'use strict';

  /**
   * Initialize the usage strip
   * @param {Object} options
   * @param {string} options.containerSelector - Selector for container element
   */
  async function initUsageStrip({ containerSelector = '#usage-strip-container' }) {
    const container = document.querySelector(containerSelector);
    if (!container) {
      console.warn('[USAGE-STRIP] Container not found:', containerSelector);
      return;
    }

    try {
      // Get auth token
      const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
      if (!currentUser) {
        console.warn('[USAGE-STRIP] User not authenticated');
        return;
      }

      const idToken = await currentUser.getIdToken();
      
      // Fetch usage data from API
      const response = await fetch('/api/usage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[USAGE-STRIP] Failed to fetch usage:', response.status);
        return;
      }

      const data = await response.json();
      if (!data.success || !data.usage) {
        console.warn('[USAGE-STRIP] Invalid usage data');
        return;
      }

      const { plan, usage } = data;
      
      // Render usage strip
      container.innerHTML = renderUsageStrip(plan, usage);
      
      // Add responsive behavior for mobile
      setupMobileToggle(container);
      
    } catch (error) {
      console.warn('[USAGE-STRIP] Error initializing:', error);
    }
  }

  /**
   * Render usage strip HTML
   */
  function renderUsageStrip(plan, usage) {
    const items = [];

    // Resume Feedback meter
    if (usage.resumeFeedback) {
      const { used, limit, remaining } = usage.resumeFeedback;
      if (limit !== null) {
        // Show meter for Essential plan (3/month)
        const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
        const renewalDate = getRenewalDate();
        items.push(`
          <div class="usage-item" data-feature="resume-feedback">
            <span class="usage-label">Resume Feedback:</span>
            <span class="usage-meter">
              <span class="usage-value">${used}/${limit}</span>
              <span class="usage-period">this month</span>
            </span>
            <span class="usage-tooltip" title="Renews on ${renewalDate}">ℹ️</span>
          </div>
        `);
      } else if (plan === 'trial') {
        // Trial: show daily limit
        const dailyLimit = 5;
        const dailyUsed = used || 0;
        items.push(`
          <div class="usage-item" data-feature="resume-feedback">
            <span class="usage-label">Resume Feedback:</span>
            <span class="usage-meter">
              <span class="usage-value">${dailyUsed}/${dailyLimit}</span>
              <span class="usage-period">today</span>
            </span>
          </div>
        `);
      } else {
        // Pro/Premium: unlimited
        items.push(`
          <div class="usage-item" data-feature="resume-feedback">
            <span class="usage-label">Resume Feedback:</span>
            <span class="usage-badge usage-unlimited">Unlimited</span>
          </div>
        `);
      }
    }

    // Mock Interviews
    if (usage.mockInterviews) {
      const { used, limit, remaining, cooldown } = usage.mockInterviews;
      if (limit === null) {
        // Unlimited with cooldown
        const cooldownText = cooldown > 0 ? formatCooldown(cooldown) : 'Ready';
        items.push(`
          <div class="usage-item" data-feature="mock-interviews">
            <span class="usage-label">Mock Interviews:</span>
            <span class="usage-badge usage-unlimited">Unlimited</span>
            <span class="usage-cooldown">${cooldownText}</span>
          </div>
        `);
      }
    }

    // Interview Questions cooldown
    if (usage.interviewQuestions) {
      const { cooldown } = usage.interviewQuestions;
      const cooldownText = cooldown > 0 ? formatCooldown(cooldown) : 'Ready';
      items.push(`
        <div class="usage-item" data-feature="interview-questions">
          <span class="usage-label">Interview Questions:</span>
          <span class="usage-cooldown">${cooldownText}</span>
        </div>
      `);
    }

    // Trial countdown
    if (plan === 'trial') {
      const trialEndsAt = localStorage.getItem('trial-ends-at');
      if (trialEndsAt) {
        const daysLeft = getDaysUntil(new Date(trialEndsAt));
        items.push(`
          <div class="usage-item usage-trial" data-feature="trial">
            <span class="usage-label">Trial ends in:</span>
            <span class="usage-badge usage-trial-badge">${daysLeft}d</span>
            <a href="pricing-a.html" class="usage-upgrade-link">Upgrade</a>
          </div>
        `);
      }
    }

    if (items.length === 0) {
      return '';
    }

    return `
      <div class="usage-strip">
        ${items.join('')}
      </div>
    `;
  }

  /**
   * Setup mobile toggle for collapsible drawer
   */
  function setupMobileToggle(container) {
    const strip = container.querySelector('.usage-strip');
    if (!strip) return;

    // Add mobile toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'usage-strip-toggle';
    toggleBtn.setAttribute('aria-label', 'Toggle usage information');
    toggleBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    `;
    
    toggleBtn.addEventListener('click', () => {
      strip.classList.toggle('usage-strip-expanded');
      toggleBtn.setAttribute('aria-expanded', strip.classList.contains('usage-strip-expanded'));
    });

    // Insert toggle button before strip
    container.insertBefore(toggleBtn, strip);

    // Add CSS for mobile behavior
    if (!document.getElementById('usage-strip-styles')) {
      const style = document.createElement('style');
      style.id = 'usage-strip-styles';
      style.textContent = `
        @media (max-width: 768px) {
          .usage-strip-toggle {
            display: block;
            background: transparent;
            border: 1px solid var(--color-divider, #E5E7EB);
            border-radius: var(--radius-md, 6px);
            padding: 0.5rem;
            cursor: pointer;
            margin-bottom: 0.5rem;
          }
          .usage-strip {
            display: none;
            flex-direction: column;
            gap: 0.5rem;
            padding: 1rem;
            background: var(--color-card-bg, #fff);
            border-radius: var(--radius-lg, 8px);
            box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.1));
          }
          .usage-strip.usage-strip-expanded {
            display: flex;
          }
        }
        @media (min-width: 769px) {
          .usage-strip-toggle {
            display: none;
          }
          .usage-strip {
            display: flex;
            flex-direction: row;
            gap: 1rem;
            align-items: center;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Format cooldown time
   */
  function formatCooldown(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get renewal date (first of next month)
   */
  function getRenewalDate() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  /**
   * Get days until date
   */
  function getDaysUntil(date) {
    const now = new Date();
    const diff = date - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  // Export public API
  window.JobHackAIUsageStrip = {
    init: initUsageStrip
  };
})();

