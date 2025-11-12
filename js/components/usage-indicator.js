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
  let ariaLabel = '';
  let contentHTML = '';

  // Cooldown chip (time-based limit)
  if (hasCooldown) {
    const minutes = Math.floor(usage.cooldown / 60);
    const seconds = usage.cooldown % 60;
    const timeStr = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
    
    ariaLabel = `${featureName} cooldown: ${timeStr} remaining`;
    indicatorHTML += ` aria-label="${ariaLabel}">`;
    
    contentHTML = `
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
    `;
  }
  // Quota-based (circular meter)
  else if (hasQuota) {
    const percentage = usage.remaining !== null ? (usage.remaining / usage.limit) * 100 : 0;
    const isLow = percentage < 33;
    const isMedium = percentage >= 33 && percentage < 66;
    
    ariaLabel = `${featureName}: ${usage.used || 0} of ${usage.limit} used, ${usage.remaining || 0} remaining`;
    indicatorHTML += ` aria-label="${ariaLabel}">`;
    
    // Circular progress indicator
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    
    contentHTML = `
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
            stroke="${isLow ? 'var(--color-error)' : isMedium ? 'var(--color-warning)' : 'var(--color-cta-green)'}" 
            stroke-width="3"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            style="transition: stroke-dashoffset 0.3s ease;"
          />
        </svg>
        <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
          ${customText || `${usage.used || 0} / ${usage.limit} used`}
          ${usage.remaining !== null ? ` • ${usage.remaining} remaining` : ''}
        </span>
      </div>
    `;
  }
  // Unlimited badge
  else if (isUnlimited) {
    const planName = plan === 'trial' ? 'Trial' : 
                     plan === 'essential' ? 'Essential' : 
                     plan === 'pro' ? 'Pro' : 
                     plan === 'premium' ? 'Premium' : plan;
    
    ariaLabel = `${featureName}: Unlimited with ${planName} plan`;
    indicatorHTML += ` aria-label="${ariaLabel}">`;
    
    contentHTML = `
      <span style="color: var(--color-text-secondary); font-size: 0.95rem;">
        ${customText || `Unlimited with your ${planName} plan.`}
      </span>
    `;
  }
  // Fallback
  else {
    ariaLabel = `${featureName} usage information`;
    indicatorHTML += ` aria-label="${ariaLabel}">`;
    contentHTML = `<span style="color: var(--color-text-secondary); font-size: 0.95rem;">${customText || 'Usage information unavailable'}</span>`;
  }

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

