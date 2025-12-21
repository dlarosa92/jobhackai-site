/**
 * Usage Indicator Component
 * Reusable component for rendering feature usage indicators using design tokens
 * 
 * @param {Object} options - Component options
 * @param {string} options.feature - Feature key (e.g., 'resumeFeedback', 'atsScans')
 * @param {Object} options.usage - Usage object from /api/usage
 * @param {string} options.plan - Current user plan
 * @param {HTMLElement} options.container - Container element to render into
 * @param {Object} [options.customText] - Optional custom text override
 */

export function renderUsageIndicator({ feature, usage, plan, container, customText }) {
  if (!container) {
    console.warn('[UsageIndicator] Container element required');
    return;
  }

  // Feature name mapping
  const featureNames = {
    atsScans: 'ATS Scans',
    resumeFeedback: 'Resume Feedback',
    resumeRewrite: 'Resume Rewriting',
    coverLetters: 'Cover Letters',
    interviewQuestions: 'Interview Questions',
    mockInterviews: 'Mock Interviews',
    linkedInOptimizer: 'LinkedIn Optimizer',
    priorityReview: 'Priority Review'
  };

  const featureName = featureNames[feature] || feature;

  // Priority Review is special - it's a boolean enabled/disabled feature
  if (feature === 'priorityReview') {
    if (usage.enabled) {
      container.innerHTML = `
        <div class="usage-indicator usage-indicator--priority" role="status" aria-label="Priority Review enabled">
          <svg width="22" height="22" fill="none" stroke="var(--color-cta-green)" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4l2.5 2.5"/>
          </svg>
          <span style="font-weight: 600; color: var(--color-cta-green);">
            All your AI-generated content will get priority review.
          </span>
        </div>
      `;
    } else {
      // Don't render anything for disabled priority review
      container.innerHTML = '';
    }
    return;
  }

  // Determine indicator type based on usage state
  const isLocked = usage.limit === 0;
  const isUnlimited = usage.limit === null;
  const hasCooldown = usage.cooldown && usage.cooldown > 0;
  const hasQuota = usage.limit !== null && usage.limit > 0;

  // Locked feature
  if (isLocked) {
    container.innerHTML = `
      <div class="usage-indicator usage-indicator--locked" role="status" aria-label="${featureName} is locked">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="11" width="18" height="8" rx="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <span>Upgrade to unlock ${featureName}.</span>
      </div>
    `;
    return;
  }

  // Build indicator HTML
  let indicatorHTML = '<div class="usage-indicator" role="status"';
  let ariaLabelParts = [];
  let contentParts = [];

  // Cooldown chip (time-based limit) - can coexist with quota
  if (hasCooldown) {
    const minutes = Math.floor(usage.cooldown / 60);
    const seconds = usage.cooldown % 60;
    const timeStr = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
    
    ariaLabelParts.push(`cooldown: ${timeStr} remaining`);
    
    contentParts.push(`
      <span class="usage-indicator__cooldown" style="
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.6rem;
        background: rgba(0, 123, 255, 0.1);
        color: var(--color-accent-blue);
        border-radius: var(--radius-md);
        font-size: 0.875rem;
        font-weight: 500;
      ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        ${timeStr} cooldown
      </span>
    `);
  }

  // Quota-based (circular meter) - can coexist with cooldown
  if (hasQuota) {
    // Calculate percentage of items USED (not remaining) for progress meter
    // If usage.used is available, use it; otherwise calculate from remaining
    const used = usage.used !== null && usage.used !== undefined 
      ? usage.used 
      : (usage.remaining !== null ? usage.limit - usage.remaining : 0);
    const percentage = (used / usage.limit) * 100;
    
    // Color thresholds based on usage percentage (high usage = warning/error)
    const isHighUsage = percentage >= 66; // 66%+ used = error (red)
    const isMediumUsage = percentage >= 33 && percentage < 66; // 33-66% used = warning (yellow)
    
    ariaLabelParts.push(`${used} of ${usage.limit} used, ${usage.remaining !== null ? usage.remaining : usage.limit - used} remaining`);
    
    // Circular progress indicator
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    
    contentParts.push(`
      <div class="usage-indicator__meter" style="
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      ">
        <svg width="36" height="36" viewBox="0 0 36 36" style="transform: rotate(-90deg);" aria-hidden="true">
          <circle cx="18" cy="18" r="${radius}" fill="none" stroke="var(--color-divider)" stroke-width="3"/>
          <circle 
            cx="18" 
            cy="18" 
            r="${radius}" 
            fill="none" 
            stroke="${isHighUsage ? 'var(--color-error)' : isMediumUsage ? 'var(--color-warning)' : 'var(--color-cta-green)'}" 
            stroke-width="3"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            style="transition: stroke-dashoffset 0.3s ease;"
          />
        </svg>
        <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
          ${customText || `${used} / ${usage.limit} used`}
          ${usage.remaining !== null ? ` • ${usage.remaining} remaining` : ''}
        </span>
      </div>
    `);
  }

  // If we have cooldown or quota, use those; otherwise check for unlimited or fallback
  let ariaLabel = '';
  let contentHTML = '';
  
  if (contentParts.length > 0) {
    // We have cooldown and/or quota indicators
    ariaLabel = ariaLabelParts.length > 0 
      ? `${featureName}: ${ariaLabelParts.join('; ')}`
      : `${featureName} usage information`;
    contentHTML = contentParts.join('<span style="margin: 0 0.5rem;">•</span>');
  } else if (isUnlimited) {
    // Unlimited: show infinity symbol + monthly used count when available
    const planName = plan === 'trial' ? 'Trial' : 
                     plan === 'essential' ? 'Essential' : 
                     plan === 'pro' ? 'Pro' : 
                     plan === 'premium' ? 'Premium' : plan;

    const used = usage && usage.used !== null && usage.used !== undefined ? usage.used : null;

    // Special handling for interview questions with daily limits
    if (feature === 'interviewQuestions' && usage && usage.dailyLimit !== null && usage.dailyLimit !== undefined) {
      const dailyUsed = usage.dailyUsed !== null && usage.dailyUsed !== undefined ? usage.dailyUsed : 0;
      const dailyLimit = usage.dailyLimit;
      const dailyRemaining = usage.dailyRemaining !== null && usage.dailyRemaining !== undefined ? usage.dailyRemaining : Math.max(0, dailyLimit - dailyUsed);
      const dailyPercentage = (dailyUsed / dailyLimit) * 100;
      
      // Color thresholds for daily usage
      const isHighUsage = dailyPercentage >= 90; // 90%+ used = error (red)
      const isMediumUsage = dailyPercentage >= 66 && dailyPercentage < 90; // 66-90% used = warning (yellow)
      
      // Circular progress indicator for daily usage
      const radius = 16;
      const circumference = 2 * Math.PI * radius;
      const dailyOffset = circumference - (dailyPercentage / 100) * circumference;
      
      ariaLabel = `${featureName}: ${dailyUsed} of ${dailyLimit} sets used today, ${dailyRemaining} remaining today; ${used || 0} sets used this month (unlimited)`;
      
      // Build daily usage indicator
      let dailyIndicatorHTML = `
        <div class="usage-indicator__meter" style="
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        ">
          <svg width="36" height="36" viewBox="0 0 36 36" style="transform: rotate(-90deg);" aria-hidden="true">
            <circle cx="18" cy="18" r="${radius}" fill="none" stroke="var(--color-divider)" stroke-width="3"/>
            <circle 
              cx="18" 
              cy="18" 
              r="${radius}" 
              fill="none" 
              stroke="${isHighUsage ? 'var(--color-error)' : isMediumUsage ? 'var(--color-warning)' : 'var(--color-cta-green)'}" 
              stroke-width="3"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${dailyOffset}"
              stroke-linecap="round"
              style="transition: stroke-dashoffset 0.3s ease;"
            />
          </svg>
          <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
            ${dailyUsed} / ${dailyLimit} sets today
            ${dailyRemaining > 0 ? ` • ${dailyRemaining} remaining` : ''}
          </span>
        </div>
      `;
      
      // Add monthly usage indicator below daily (if monthly data available)
      if (used !== null) {
        dailyIndicatorHTML += `
          <div class="usage-indicator__meter" style="
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.5rem;
          ">
            <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" style="flex-shrink: 0;">
              <path
                d="M 6 18 C 6 12, 14 12, 18 18 C 22 24, 30 24, 30 18 C 30 12, 22 12, 18 18 C 14 24, 6 24, 6 18"
                fill="none"
                stroke="var(--color-cta-green)"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
              ${customText || `Sets generated this month: ${used}`}
            </span>
          </div>
        `;
      }
      
      contentHTML = dailyIndicatorHTML;
    } else if (used !== null) {
      // Determine the feature-specific label
      const featureLabel = feature === 'mockInterviews' ? 'Sessions' :
                          feature === 'interviewQuestions' ? 'Sets' :
                          feature === 'resumeFeedback' ? 'Feedback runs' :
                          feature === 'atsScans' ? 'Scans' :
                          feature === 'coverLetters' ? 'Letters' :
                          'Items';

      ariaLabel = `${featureName}: ${used} ${featureLabel.toLowerCase()} used this month (unlimited) with ${planName} plan`;
      contentHTML = `
        <div class="usage-indicator__meter" style="
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        ">
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" style="flex-shrink: 0;">
            <path
              d="M 6 18 C 6 12, 14 12, 18 18 C 22 24, 30 24, 30 18 C 30 12, 22 12, 18 18 C 14 24, 6 24, 6 18"
              fill="none"
              stroke="var(--color-cta-green)"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
            ${customText || `${featureLabel} used this month: ${used}`}
          </span>
        </div>
      `;
    } else {
      ariaLabel = `${featureName}: Unlimited with ${planName} plan`;
      contentHTML = `
        <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
          ${customText || `Unlimited with your ${planName} plan.`}
        </span>
      `;
    }
  } else {
    // Fallback
    ariaLabel = `${featureName} usage information`;
    contentHTML = `<span style="color: var(--color-text-secondary); font-size: 0.95rem;">${customText || 'Usage information unavailable'}</span>`;
  }
  
  indicatorHTML += ` aria-label="${ariaLabel}">`;

  indicatorHTML += contentHTML + '</div>';
  container.innerHTML = indicatorHTML;

  // Add tooltip if needed (for upgrade prompts)
  if (hasQuota && usage.remaining !== null && usage.remaining <= 1) {
    const tooltipTrigger = document.createElement('span');
    tooltipTrigger.className = 'jh-tooltip-trigger';
    tooltipTrigger.setAttribute('tabindex', '0');
    tooltipTrigger.setAttribute('aria-label', 'More info');
    tooltipTrigger.style.cssText = 'margin-left: 0.4em; vertical-align: middle; cursor: help;';
    tooltipTrigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle; color: var(--color-text-muted);">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="8"/>
        <line x1="12" y1="12" x2="12" y2="16"/>
      </svg>
      <span class="jh-tooltip-text">Upgrade to Pro for unlimited ${featureName.toLowerCase()}.</span>
    `;
    container.querySelector('.usage-indicator').appendChild(tooltipTrigger);
  }
}

/**
 * Format cooldown seconds into human-readable string
 * @param {number} seconds - Cooldown in seconds
 * @returns {string} Formatted cooldown string (e.g., "1:30" or "45s")
 */
export function formatCooldown(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

// Make function available globally for non-module scripts
if (typeof window !== 'undefined') {
  window.renderUsageIndicator = renderUsageIndicator;
  window.formatCooldown = formatCooldown;
}

