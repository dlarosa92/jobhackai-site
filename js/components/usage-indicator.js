/**
 * Usage Indicator Component
 * Renders usage indicators for features using design tokens
 * 
 * @param {Object} options - Component options
 * @param {string} options.feature - Feature key (e.g., 'resumeFeedback')
 * @param {Object} options.usage - Usage object from /api/usage
 * @param {string} options.plan - Current user plan
 * @param {HTMLElement} options.container - Container element to render into
 */
export function renderUsageIndicator({ feature, usage, plan, container }) {
  if (!container) {
    console.error('[USAGE-INDICATOR] Container element required');
    return;
  }

  if (!usage) {
    console.warn('[USAGE-INDICATOR] Usage data missing for feature:', feature);
    return;
  }

  // Clear container
  container.innerHTML = '';

  // Handle priority review (special case - no usage limit)
  if (feature === 'priorityReview') {
    if (usage.enabled) {
      const indicator = document.createElement('div');
      indicator.className = 'usage-indicator usage-indicator-priority';
      indicator.style.cssText = `
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin: 0.7rem 0 0.2rem 0;
        font-weight: 600;
        color: var(--color-cta-green);
      `;
      indicator.innerHTML = `
        <svg width="22" height="22" fill="none" stroke="var(--color-cta-green)" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4l2.5 2.5"/>
        </svg>
        <span>All your AI-generated content will get priority review.</span>
      `;
      indicator.setAttribute('aria-label', 'Priority review enabled with Premium plan');
      container.appendChild(indicator);
    }
    return;
  }

  // Handle locked features
  if (usage.limit === 0) {
    const indicator = document.createElement('div');
    indicator.className = 'usage-indicator usage-indicator-locked';
    indicator.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    `;
    indicator.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="3" y="11" width="18" height="8" rx="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
      <span>Upgrade to unlock this feature.</span>
    `;
    indicator.setAttribute('aria-label', 'Feature locked - upgrade required');
    container.appendChild(indicator);
    return;
  }

  // Handle unlimited features
  if (usage.limit === null) {
    const indicator = document.createElement('div');
    indicator.className = 'usage-indicator usage-indicator-unlimited';
    indicator.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--color-text-main);
      font-size: var(--font-size-sm);
    `;
    
    const planName = plan === 'pro' ? 'Pro' : plan === 'premium' ? 'Premium' : plan === 'essential' ? 'Essential' : plan === 'trial' ? 'Trial' : '';
    const text = planName ? `Unlimited with your ${planName} plan.` : 'Unlimited.';
    
    indicator.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-cta-green)" stroke-width="2" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <span>${text}</span>
      <span class="jh-tooltip-trigger" tabindex="0" aria-label="More info" style="margin-left:0.4em;vertical-align:middle;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align:middle;color:#9CA3AF;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="8"/>
          <line x1="12" y1="12" x2="12" y2="16"/>
        </svg>
        <span class="jh-tooltip-text">Unlimited usage with your ${planName} plan.</span>
      </span>
    `;
    indicator.setAttribute('aria-label', `Unlimited ${feature} with ${planName} plan`);
    container.appendChild(indicator);
    return;
  }

  // Handle cooldown-based features
  if (usage.cooldown && usage.cooldown > 0) {
    const indicator = document.createElement('div');
    indicator.className = 'usage-indicator usage-indicator-cooldown';
    indicator.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.8rem;
      background: var(--color-accent-blue);
      color: white;
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
    `;
    
    const minutes = Math.floor(usage.cooldown / 60);
    const seconds = usage.cooldown % 60;
    const timeText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    
    indicator.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>Available in ${timeText}</span>
    `;
    indicator.setAttribute('aria-label', `Feature available in ${timeText}`);
    container.appendChild(indicator);
    return;
  }

  // Handle quota-based features (circular meter)
  if (usage.limit !== null && usage.limit > 0) {
    const indicator = document.createElement('div');
    indicator.className = 'usage-indicator usage-indicator-quota';
    indicator.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--color-text-main);
      font-size: var(--font-size-sm);
    `;

    const percentage = Math.min(100, (usage.used / usage.limit) * 100);
    const remaining = usage.remaining !== null ? usage.remaining : Math.max(0, usage.limit - usage.used);
    const isLow = remaining <= 1 && remaining > 0;
    const isExhausted = remaining === 0;

    // Create circular progress SVG
    const size = 40;
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    const svgColor = isExhausted ? 'var(--color-error)' : isLow ? 'var(--color-warning)' : 'var(--color-cta-green)';

    indicator.innerHTML = `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}" style="transform: rotate(-90deg);">
          <circle
            cx="${size / 2}"
            cy="${size / 2}"
            r="${radius}"
            fill="none"
            stroke="var(--color-divider)"
            stroke-width="${strokeWidth}"
          />
          <circle
            cx="${size / 2}"
            cy="${size / 2}"
            r="${radius}"
            fill="none"
            stroke="${svgColor}"
            stroke-width="${strokeWidth}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            style="transition: stroke-dashoffset 0.3s ease;"
          />
        </svg>
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: var(--font-weight-semibold); font-size: var(--font-size-xs); color: ${svgColor};">
          ${remaining}
        </div>
      </div>
      <div style="flex: 1;">
        <div style="font-weight: var(--font-weight-medium);">
          ${remaining} ${feature === 'resumeFeedback' ? 'feedbacks' : feature === 'atsScans' ? 'scans' : 'uses'} remaining
        </div>
        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
          ${usage.used} of ${usage.limit} used
        </div>
      </div>
      <span class="jh-tooltip-trigger" tabindex="0" aria-label="More info" style="margin-left:0.4em;vertical-align:middle;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align:middle;color:#9CA3AF;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="8"/>
          <line x1="12" y1="12" x2="12" y2="16"/>
        </svg>
        <span class="jh-tooltip-text">${remaining === 0 ? 'Upgrade to Pro for unlimited usage.' : `You have ${remaining} remaining this ${feature === 'resumeFeedback' && plan === 'essential' ? 'month' : 'period'}.`}</span>
      </span>
    `;
    
    const ariaLabel = isExhausted 
      ? `No ${feature} remaining. Upgrade required.`
      : `${remaining} ${feature} remaining out of ${usage.limit}`;
    indicator.setAttribute('aria-label', ariaLabel);
    container.appendChild(indicator);
    return;
  }

  // Fallback: simple text indicator
  const indicator = document.createElement('div');
  indicator.className = 'usage-indicator';
  indicator.style.cssText = `
    color: var(--color-text-main);
    font-size: var(--font-size-sm);
  `;
  indicator.textContent = 'Usage information unavailable';
  indicator.setAttribute('aria-label', 'Usage information unavailable');
  container.appendChild(indicator);
}

/**
 * Helper function to format cooldown time
 */
export function formatCooldown(seconds) {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// Make functions available globally for non-module scripts
if (typeof window !== 'undefined') {
  window.renderUsageIndicator = renderUsageIndicator;
  window.formatCooldown = formatCooldown;
}
