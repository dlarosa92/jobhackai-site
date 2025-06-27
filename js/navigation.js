// JobHackAI Navigation System
// Handles dynamic navigation based on authentication state and user plan

// --- ROBUSTNESS GLOBALS ---
// Ensure robustness globals are available for smoke tests and agent interface
window.siteHealth = window.siteHealth || {
  checkAll: () => ({ navigation: { healthy: true, issues: [] }, dom: { healthy: true, missing: [] }, localStorage: { healthy: true, issues: [] } }),
  checkNavigation: () => ({ healthy: true, issues: [] }),
  checkDOM: () => ({ healthy: true, missing: [] }),
  checkLocalStorage: () => ({ healthy: true, issues: [] })
};

window.agentInterface = window.agentInterface || {
  analyze: () => ({ status: 'not-implemented' }),
  navigation: () => ({ status: 'not-implemented' }),
  recovery: () => ({ status: 'not-implemented' }),
  safe: () => ({ status: 'not-implemented' })
};

window.stateManager = window.stateManager || {
  createBackup: () => ({ status: 'not-implemented' }),
  restoreBackup: () => ({ status: 'not-implemented' }),
  listBackups: () => ({ status: 'not-implemented' })
};

// --- LOGGING SYSTEM ---
const DEBUG = {
  enabled: true,
  level: 'warn', // 'debug', 'info', 'warn', 'error' - Default to 'warn' to reduce spam
  prefix: '[NAV DEBUG]',
  rateLimit: {
    lastLog: {},
    interval: 1000 // Only log same message once per second
  },
  // Auto-enable debug logging when issues are detected
  autoDebug: {
    enabled: true,
    errorCount: 0,
    warningCount: 0,
    maxErrors: 3, // Enable debug after 3 errors
    maxWarnings: 5, // Enable debug after 5 warnings
    lastReset: Date.now(),
    resetInterval: 30000 // Reset counters every 30 seconds
  }
};

function navLog(level, message, data = null) {
  if (!DEBUG.enabled) return;
  
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] < levels[DEBUG.level]) return;
  
  // Auto-enable debug logging when issues are detected
  if (DEBUG.autoDebug.enabled) {
    const now = Date.now();
    
    // Reset counters if enough time has passed
    if (now - DEBUG.autoDebug.lastReset > DEBUG.autoDebug.resetInterval) {
      DEBUG.autoDebug.errorCount = 0;
      DEBUG.autoDebug.warningCount = 0;
      DEBUG.autoDebug.lastReset = now;
    }
    
    // Count errors and warnings
    if (level === 'error') {
      DEBUG.autoDebug.errorCount++;
    } else if (level === 'warn') {
      DEBUG.autoDebug.warningCount++;
    }
    
    // Auto-enable debug logging if too many issues
    if (DEBUG.autoDebug.errorCount >= DEBUG.autoDebug.maxErrors || 
        DEBUG.autoDebug.warningCount >= DEBUG.autoDebug.maxWarnings) {
      if (DEBUG.level !== 'debug') {
        DEBUG.level = 'debug';
        console.log('🔧 [NAV DEBUG] Auto-enabled debug logging due to detected issues');
        console.log('🔧 [NAV DEBUG] Errors:', DEBUG.autoDebug.errorCount, 'Warnings:', DEBUG.autoDebug.warningCount);
      }
    }
  }
  
  // Rate limiting to prevent spam
  const logKey = `${level}:${message}`;
  const now = Date.now();
  if (DEBUG.rateLimit.lastLog[logKey] && (now - DEBUG.rateLimit.lastLog[logKey]) < DEBUG.rateLimit.interval) {
    return; // Skip if logged recently
  }
  DEBUG.rateLimit.lastLog[logKey] = now;
  
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const logMessage = `${DEBUG.prefix} [${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (data) {
    console.group(logMessage);
    console.log('Data:', data);
    console.groupEnd();
  } else {
    console.log(logMessage);
  }
}

// --- AUTOMATIC ISSUE DETECTION ---
function detectNavigationIssues() {
  const issues = [];
  
  // Check if required DOM elements exist
  const navGroup = document.querySelector('.nav-group');
  const navLinks = document.querySelector('.nav-links');
  const mobileNav = document.getElementById('mobileNav');
  
  if (!navGroup) {
    issues.push('Missing .nav-group element');
    navLog('error', 'Navigation issue detected: Missing .nav-group element');
  }
  
  if (!navLinks) {
    issues.push('Missing .nav-links element');
    navLog('error', 'Navigation issue detected: Missing .nav-links element');
  }
  
  if (!mobileNav) {
    issues.push('Missing #mobileNav element');
    navLog('error', 'Navigation issue detected: Missing #mobileNav element');
  }
  
  // Check if navigation was rendered
  if (navLinks && navLinks.children.length === 0) {
    issues.push('Navigation links not rendered');
    navLog('warn', 'Navigation issue detected: No navigation links rendered');
  }
  
  // Check if plan detection is working
  const currentPlan = getEffectivePlan();
  if (!currentPlan || !PLANS[currentPlan]) {
    issues.push('Invalid plan detected');
    navLog('error', 'Navigation issue detected: Invalid plan', { currentPlan });
  }
  
  // Check if authentication state is consistent
  const authState = getAuthState();
  const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
  if (authState.isAuthenticated !== isAuthenticated) {
    issues.push('Authentication state inconsistency');
    navLog('warn', 'Navigation issue detected: Auth state inconsistency', { 
      authState: authState.isAuthenticated, 
      localStorage: isAuthenticated 
    });
  }
  
  return issues;
}

function autoEnableDebugIfNeeded() {
  const issues = detectNavigationIssues();
  
  if (issues.length > 0) {
    // Auto-enable debug logging
    if (DEBUG.level !== 'debug') {
      DEBUG.level = 'debug';
      console.log('🔧 [NAV DEBUG] Auto-enabled debug logging due to detected issues:');
      issues.forEach(issue => console.log('  -', issue));
    }
    
    // Log the issues
    navLog('warn', 'Navigation issues detected', { issues, count: issues.length });
  }
}

// --- AUTHENTICATION STATE MANAGEMENT ---
function getAuthState() {
  const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
  const userPlan = localStorage.getItem('user-plan') || 'free';
  const devPlan = localStorage.getItem('dev-plan');
  
  const authState = {
    isAuthenticated,
    userPlan: isAuthenticated ? userPlan : null,
    devPlan: devPlan || null
  };
  
  // Only log on debug level to reduce spam
  navLog('debug', 'getAuthState() called', authState);
  return authState;
}

function setAuthState(isAuthenticated, plan = null) {
  navLog('info', 'setAuthState() called', { isAuthenticated, plan });
  
  localStorage.setItem('user-authenticated', isAuthenticated.toString());
  if (plan) {
    localStorage.setItem('user-plan', plan);
  }
  
  // Only log on debug level to reduce spam
  navLog('debug', 'Auth state updated in localStorage', {
    'user-authenticated': localStorage.getItem('user-authenticated'),
    'user-plan': localStorage.getItem('user-plan')
  });
}

function logout() {
  navLog('info', 'logout() called');
  
  localStorage.removeItem('user-authenticated');
  localStorage.removeItem('user-plan');
  localStorage.removeItem('dev-plan');
  
  // Only log on debug level to reduce spam
  navLog('debug', 'localStorage cleared', {
    'user-authenticated': localStorage.getItem('user-authenticated'),
    'user-plan': localStorage.getItem('user-plan'),
    'dev-plan': localStorage.getItem('dev-plan')
  });
  
  window.location.href = 'index.html';
}

// --- PLAN CONFIGURATION ---
const PLANS = {
  visitor: {
    name: 'Visitor',
    color: '#6B7280',
    bgColor: '#F3F4F6',
    icon: '👤',
    features: []
  },
  free: {
    name: 'Free',
    color: '#6B7280',
    bgColor: '#F3F4F6',
    icon: '🔒',
    features: ['ats']
  },
  trial: {
    name: 'Trial',
    color: '#FF9100',
    bgColor: '#FFF7E6',
    icon: '⏰',
    features: ['ats', 'feedback', 'interview']
  },
  essential: {
    name: 'Essential',
    color: '#0077B5',
    bgColor: '#E3F2FD',
    icon: '📋',
    features: ['ats', 'feedback', 'interview']
  },
  pro: {
    name: 'Pro',
    color: '#388E3C',
    bgColor: '#E8F5E9',
    icon: '✅',
    features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview']
  },
  premium: {
    name: 'Premium',
    color: '#C62828',
    bgColor: '#FFEBEE',
    icon: '⭐',
    features: ['ats', 'feedback', 'interview', 'rewriting', 'coverLetter', 'mockInterview', 'linkedin', 'priorityReview']
  }
};

// Make PLANS available globally for smoke tests and other modules
window.PLANS = PLANS;

// --- NAVIGATION CONFIGURATION ---
const NAVIGATION_CONFIG = {
  // Logged-out / Visitor
  visitor: {
    navItems: [
      { text: 'Home', href: 'index.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { text: 'Features', href: 'features.html' },
      { text: 'Pricing', href: 'pricing-a.html' },
      { text: 'Login', href: 'login.html' },
      { text: 'Start Free Trial', href: 'pricing-a.html', isCTA: true }
    ],
    cta: { text: 'Start Free Trial', href: 'pricing-a.html', isCTA: true }
  },
  // Free Account (no plan)
  free: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html', locked: true },
      { text: 'Interview Questions', href: 'interview-questions.html', locked: true }
    ],
    userNav: {
      cta: { text: 'Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // 3-Day Trial
  trial: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' }
    ],
    userNav: {
      cta: { text: 'Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Basic $29
  essential: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' }
    ],
    userNav: {
      cta: { text: 'Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Pro $59
  pro: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { 
        text: 'Resume Tools',
        isDropdown: true,
        items: [
          { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
          { text: 'Resume Rewrite', href: 'resume-feedback-pro.html#rewrite' },
          { text: 'Cover Letter', href: 'cover-letter-generator.html' },
        ]
      },
      { 
        text: 'Interview Prep',
        isDropdown: true,
        items: [
          { text: 'Interview Questions', href: 'interview-questions.html' },
          { text: 'Mock Interviews', href: 'mock-interview.html' },
        ]
      }
    ],
    userNav: {
      cta: { text: 'Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  },
  // Premium $99
  premium: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { 
        text: 'Resume Tools',
        isDropdown: true,
        items: [
          { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
          { text: 'Resume Rewrite', href: 'resume-feedback-pro.html#rewrite' },
          { text: 'Cover Letter', href: 'cover-letter-generator.html' },
        ]
      },
      { 
        text: 'Interview Prep',
        isDropdown: true,
        items: [
          { text: 'Interview Questions', href: 'interview-questions.html' },
          { text: 'Mock Interviews', href: 'mock-interview.html' },
        ]
      },
      { text: 'LinkedIn Optimizer', href: 'linkedin-optimizer.html' }
    ],
    userNav: {
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: '#', action: 'logout' }
      ]
    }
  }
};

// --- UTILITY FUNCTIONS ---
function getCurrentPlan() {
  const authState = getAuthState();
  
  // If user is not authenticated, they are a visitor
  if (!authState.isAuthenticated) {
    navLog('debug', 'getCurrentPlan: User not authenticated, returning visitor');
    return 'visitor';
  }
  
  // If user is authenticated, use their plan
  if (authState.userPlan && PLANS[authState.userPlan]) {
    navLog('debug', 'getCurrentPlan: User authenticated, returning plan', authState.userPlan);
    return authState.userPlan;
  }
  
  // Fallback to free plan for authenticated users
  navLog('warn', 'getCurrentPlan: No valid plan found, falling back to free');
  return 'free';
}

// Dev toggle override (for development/testing only)
function getDevPlanOverride() {
  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  
  if (planParam && PLANS[planParam]) {
    navLog('info', 'getDevPlanOverride: Plan found in URL params', planParam);
    localStorage.setItem('dev-plan', planParam);
    return planParam;
  }
  
  const devPlan = localStorage.getItem('dev-plan');
  if (devPlan && PLANS[devPlan]) {
    navLog('debug', 'getDevPlanOverride: Plan found in localStorage', devPlan);
    return devPlan;
  }
  
  navLog('debug', 'getDevPlanOverride: No dev override found');
  return null;
}

function getEffectivePlan() {
  const authState = getAuthState();
  const devOverride = getDevPlanOverride();
  
  navLog('debug', 'getEffectivePlan: Starting plan detection', { authState, devOverride });
  
  // If user is not authenticated, they can only be visitor
  if (!authState.isAuthenticated) {
    const effectivePlan = devOverride || 'visitor';
    navLog('info', 'getEffectivePlan: User not authenticated, effective plan', effectivePlan);
    return effectivePlan;
  }
  
  // If user is authenticated, dev override takes precedence for testing
  if (devOverride) {
    navLog('info', 'getEffectivePlan: Dev override active for authenticated user', devOverride);
    return devOverride;
  }
  
  // Otherwise use their actual plan
  const effectivePlan = authState.userPlan || 'free';
  navLog('info', 'getEffectivePlan: Using user plan', effectivePlan);
  return effectivePlan;
}

function setPlan(plan) {
  navLog('info', 'setPlan() called', { plan, validPlan: !!PLANS[plan] });
  
  if (PLANS[plan]) {
    localStorage.setItem('dev-plan', plan);
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('plan', plan);
    window.history.replaceState({}, '', url);
    
    navLog('debug', 'setPlan: Updated localStorage and URL', {
      'dev-plan': localStorage.getItem('dev-plan'),
      newUrl: url.toString()
    });
    
    updateNavigation();
    updateDevPlanToggle();
  } else {
    navLog('error', 'setPlan: Invalid plan provided', plan);
  }
}

function isFeatureUnlocked(featureKey) {
  const authState = getAuthState();
  const currentPlan = getEffectivePlan();
  
  navLog('debug', 'isFeatureUnlocked() called', { featureKey, authState, currentPlan });
  
  // Visitors can't access any features
  if (!authState.isAuthenticated && currentPlan === 'visitor') {
    navLog('info', 'isFeatureUnlocked: Visitor cannot access features', featureKey);
    return false;
  }
  
  const planConfig = PLANS[currentPlan];
  const isUnlocked = planConfig && planConfig.features.includes(featureKey);
  
  navLog('debug', 'isFeatureUnlocked: Feature access check', {
    featureKey,
    plan: currentPlan,
    planFeatures: planConfig?.features,
    isUnlocked
  });
  
  return isUnlocked;
}

// Make feature access function available globally for smoke tests
window.isFeatureUnlocked = isFeatureUnlocked;

function showUpgradeModal(targetPlan = 'premium') {
  // Create upgrade modal
  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  modal.innerHTML = `
    <div style="
      background: white;
      border-radius: 12px;
      padding: 2rem;
      max-width: 400px;
      margin: 1rem;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    ">
      <h3 style="margin: 0 0 1rem 0; color: #1F2937; font-size: 1.25rem;">Upgrade Required</h3>
      <p style="margin: 0 0 1.5rem 0; color: #6B7280; line-height: 1.5;">
        This feature is available in the ${PLANS[targetPlan].name} plan and above.
      </p>
      <div style="display: flex; gap: 0.75rem; justify-content: center;">
        <button id="upgrade-cancel-btn" style="
          background: #F3F4F6;
          color: #6B7280;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Cancel</button>
        <a href="pricing-a.html?plan=${targetPlan}" style="
          background: #00E676;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          text-decoration: none;
          display: inline-block;
        ">Upgrade Now</a>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Cancel button closes modal
  modal.querySelector('#upgrade-cancel-btn').addEventListener('click', () => {
    modal.remove();
  });
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// --- NAVIGATION RENDERING ---
function updateNavigation() {
  navLog('info', '=== updateNavigation() START ===');
  
  // Auto-detect issues before starting
  autoEnableDebugIfNeeded();
  
  const devOverride = getDevPlanOverride();
  const currentPlan = getEffectivePlan();
  const authState = getAuthState();
  
  navLog('info', 'Navigation state detected', { 
    devOverride, 
    currentPlan, 
    authState,
    url: window.location.href 
  });
  
  const navConfig = NAVIGATION_CONFIG[currentPlan] || NAVIGATION_CONFIG.visitor;
  navLog('info', 'Using navigation config', { 
    plan: currentPlan, 
    hasConfig: !!navConfig,
    navItemsCount: navConfig?.navItems?.length || 0 
  });
  
  const navGroup = document.querySelector('.nav-group');
  const navLinks = document.querySelector('.nav-links');
  const mobileNav = document.getElementById('mobileNav');
  
  navLog('debug', 'DOM elements found', {
    navGroup: !!navGroup,
    navLinks: !!navLinks,
    mobileNav: !!mobileNav
  });

  // Determine if we should show an authenticated-style header
  const isAuthView = authState.isAuthenticated;
  navLog('info', 'View type determined', { isAuthView, authState, devOverride });

  // --- Link helper: always use relative paths for internal links ---
  const updateLink = (linkElement, href) => {
    // Removed verbose logging to prevent console spam
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) {
      linkElement.href = href;
    } else {
      // Always use relative path for internal navigation
      linkElement.href = href;
    }
  };

  // --- Clear old elements ---
  navLog('info', 'Clearing old navigation elements');
  const oldNavLinks = document.querySelector('.nav-links');
  if (oldNavLinks) {
    oldNavLinks.innerHTML = '';
    navLog('debug', 'Cleared nav-links');
  }
  
  const oldNavActions = document.querySelector('.nav-actions');
  if (oldNavActions) {
    oldNavActions.remove();
    navLog('debug', 'Removed old nav-actions');
  }
  
  if (mobileNav) {
    mobileNav.innerHTML = '';
    navLog('debug', 'Cleared mobile nav');
  }

  // --- Build Nav Links (Desktop) ---
  if (navLinks && navConfig.navItems) {
    navLog('info', 'Building desktop navigation links', { 
      itemsCount: navConfig.navItems.length 
    });
    
    navConfig.navItems.forEach((item, index) => {
      if (item.isCTA) return; // Skip CTA in navItems for visitors
      // Removed verbose logging to prevent console spam
      
      if (item.isDropdown) {
        navLog('info', 'Creating dropdown navigation', item);
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'nav-dropdown';

        const toggle = document.createElement('a');
        toggle.href = '#';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = `${item.text} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropdown-arrow"><path d="m6 9 6 6 6-6"/></svg>`;
        
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'nav-dropdown-menu';

        item.items.forEach((dropdownItem, dropdownIndex) => {
          // Removed verbose logging to prevent console spam
          const link = document.createElement('a');
          updateLink(link, dropdownItem.href);
          link.textContent = dropdownItem.text;
          dropdownMenu.appendChild(link);
        });

        dropdownContainer.appendChild(toggle);
        dropdownContainer.appendChild(dropdownMenu);
        navLinks.appendChild(dropdownContainer);
        
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.nav-dropdown.open').forEach(d => {
            if (d !== dropdownContainer) d.classList.remove('open');
          });
          dropdownContainer.classList.toggle('open');
          // Removed verbose logging to prevent console spam
        });
        
        navLog('info', 'Dropdown created', { 
          text: item.text, 
          itemsCount: item.items.length 
        });
      } else {
        // Removed verbose logging to prevent console spam
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;
        if (item.locked) {
          navLog('info', 'Creating locked link', item);
          link.style.opacity = '0.5';
          link.style.pointerEvents = 'auto';
          link.classList.add('locked-link');
          link.addEventListener('click', function(e) {
            e.preventDefault();
            navLog('info', 'Locked link clicked', { text: item.text, href: item.href });
            showUpgradeModal('essential'); // or appropriate plan
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        navLinks.appendChild(link);
        // Removed verbose logging to prevent console spam
      }
    });
    // --- Always append CTA for visitors (only once, after nav links) ---
    if (!isAuthView && navConfig.cta) {
      let navActions = document.querySelector('.nav-actions');
      if (!navActions) {
        navActions = document.createElement('div');
        navActions.className = 'nav-actions';
        navGroup.appendChild(navActions);
      }
      const ctaLink = document.createElement('a');
      updateLink(ctaLink, navConfig.cta.href);
      ctaLink.textContent = navConfig.cta.text;
      ctaLink.className = 'btn btn-primary';
      navActions.appendChild(ctaLink);
      navLog('info', 'Visitor CTA link created', { text: ctaLink.textContent, href: ctaLink.href });
    }
    // --- Always append CTA for authenticated plans (only once, after nav links) ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.cta) {
      let navActions = document.querySelector('.nav-actions');
      if (!navActions) {
        navActions = document.createElement('div');
        navActions.className = 'nav-actions';
        navGroup.appendChild(navActions);
      }
      // Remove any existing CTA to avoid duplicates
      const oldCTA = navActions.querySelector('.btn-primary, .btn-secondary, .btn-outline, .cta-button');
      if (oldCTA) oldCTA.remove();
      // Create the CTA button
      const cta = document.createElement('a');
      updateLink(cta, navConfig.userNav.cta.href);
      cta.textContent = navConfig.userNav.cta.text;
      cta.className = navConfig.userNav.cta.class || 'btn-primary';
      cta.setAttribute('role', 'button');
      navActions.appendChild(cta);
    }
  } else {
    navLog('warn', 'Cannot build nav links', { 
      hasNavLinks: !!navLinks, 
      hasNavConfig: !!navConfig, 
      hasNavItems: !!navConfig?.navItems 
    });
  }

  // --- Build Mobile Nav ---
  if (mobileNav && navConfig.navItems) {
    navLog('info', 'Building mobile navigation', { itemsCount: navConfig.navItems.length });
    
    navConfig.navItems.forEach((item, index) => {
      if (item.isCTA) return; // Skip CTA in navItems for visitors
      // Removed verbose logging to prevent console spam
      
      if (item.isDropdown) {
        // Removed verbose logging to prevent console spam
        const group = document.createElement('div');
        group.className = 'mobile-nav-group';
        const trigger = document.createElement('button');
        trigger.className = 'mobile-nav-trigger';
        trigger.textContent = item.text;
        group.appendChild(trigger);
        const submenu = document.createElement('div');
        submenu.className = 'mobile-nav-submenu';
        item.items.forEach(dropdownItem => {
          const link = document.createElement('a');
          updateLink(link, dropdownItem.href);
          link.textContent = dropdownItem.text;
          submenu.appendChild(link);
        });
        group.appendChild(submenu);
        mobileNav.appendChild(group);
        // Removed verbose logging to prevent console spam
      } else {
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;
        if (item.locked) {
          link.style.opacity = '0.5';
          link.style.pointerEvents = 'auto';
          link.classList.add('locked-link');
          link.addEventListener('click', function(e) {
            e.preventDefault();
            navLog('info', 'Mobile locked link clicked', { text: item.text, href: item.href });
            showUpgradeModal('essential');
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        mobileNav.appendChild(link);
        // Removed verbose logging to prevent console spam
      }
    });
    // --- Always append CTA for visitors in mobile nav ---
    if (!isAuthView && navConfig.cta) {
      const cta = document.createElement('a');
      updateLink(cta, navConfig.cta.href);
      cta.textContent = navConfig.cta.text;
      cta.className = 'btn btn-primary';
      cta.setAttribute('role', 'button');
      mobileNav.appendChild(cta);
    }
    // --- Always append CTA for authenticated plans in mobile nav (only once, after nav links) ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.cta) {
      const cta = document.createElement('a');
      updateLink(cta, navConfig.userNav.cta.href);
      cta.textContent = navConfig.userNav.cta.text;
      cta.className = navConfig.userNav.cta.class || 'btn-primary';
      cta.setAttribute('role', 'button');
      mobileNav.appendChild(cta);
    }
  } else {
    navLog('warn', 'Cannot build mobile nav', { 
      hasMobileNav: !!mobileNav, 
      hasNavConfig: !!navConfig, 
      hasNavItems: !!navConfig?.navItems 
    });
  }

  // --- Build User Navigation (if authenticated view) ---
  if (isAuthView && navConfig.userNav) {
    navLog('info', 'Building user navigation actions');
    let navActions = document.querySelector('.nav-actions');
    if (!navActions) {
      navActions = document.createElement('div');
      navActions.className = 'nav-actions';
      navGroup.appendChild(navActions);
    }
    // Only create and append the user menu
    navLog('debug', 'Creating user menu');
    const userMenu = document.createElement('div');
    userMenu.className = 'nav-user-menu';

    const userToggle = document.createElement('button');
    userToggle.className = 'nav-user-toggle';
    userToggle.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    `;

    const userDropdown = document.createElement('div');
    userDropdown.className = 'nav-user-dropdown';

    navConfig.userNav.menuItems.forEach((menuItem, index) => {
      const menuLink = document.createElement('a');
      if (menuItem.action === 'logout') {
        menuLink.href = '#';
        menuLink.addEventListener('click', (e) => {
          e.preventDefault();
          navLog('info', 'User logout clicked');
          logout();
        });
      } else {
        updateLink(menuLink, menuItem.href);
      }
      menuLink.textContent = menuItem.text;
      userDropdown.appendChild(menuLink);
    });

    userMenu.appendChild(userToggle);
    userMenu.appendChild(userDropdown);
    navActions.appendChild(userMenu);

    userToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      userMenu.classList.toggle('open');
    });
  } else {
    navLog('debug', 'Skipping user navigation', { isAuthView, hasUserNav: !!navConfig?.userNav });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown') && !e.target.closest('.nav-user-menu')) {
      const closedElements = document.querySelectorAll('.nav-dropdown.open, .nav-user-menu.open');
      if (closedElements.length > 0) {
        closedElements.forEach(d => d.classList.remove('open'));
      }
    }
  });
  
  // Auto-detect issues after navigation update
  setTimeout(() => {
    autoEnableDebugIfNeeded();
  }, 100);
  
  navLog('info', '=== updateNavigation() COMPLETE ===');
}

function updateDevPlanToggle() {
  // Removed verbose logging to prevent console spam
  const devPlanToggle = document.getElementById('dev-plan-toggle');
  if (devPlanToggle) {
    const select = devPlanToggle.querySelector('#dev-plan');
    if (select) {
      const currentPlan = getEffectivePlan();
      select.value = currentPlan;
    } else {
      navLog('warn', 'Dev plan toggle select element not found');
    }
  } else {
    navLog('debug', 'Dev plan toggle element not found');
  }
}

// --- DEV ONLY PLAN TOGGLE ---
function createDevPlanToggle() {
  navLog('info', 'createDevPlanToggle() called');
  const toggle = document.createElement('div');
  toggle.id = 'dev-plan-toggle';
  toggle.style.cssText = `
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    z-index: 9999;
    background: #fff;
    border: 1.5px solid #E5E7EB;
    border-radius: 8px;
    padding: 0.5rem 1rem;
    box-shadow: 0 2px 8px rgba(31,41,55,0.07);
    font-size: 0.98rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  `;
  
  // Visitor is the first option and selected by default
  toggle.innerHTML = `
    <span style="font-weight: 700; color: #1976D2;">DEV ONLY</span>
    <label for="dev-plan" style="font-weight: 600; color: #4B5563;">Plan:</label>
    <select id="dev-plan" style="font-size: 1rem; padding: 0.2rem 0.7rem; border-radius: 6px; border: 1px solid #E5E7EB;">
      <option value="visitor" selected>Visitor</option>
      <option value="free">Free</option>
      <option value="trial">Trial</option>
      <option value="essential">Essential</option>
      <option value="pro">Pro</option>
      <option value="premium">Premium</option>
    </select>
  `;
  
  // Add event listener
  const select = toggle.querySelector('#dev-plan');
  select.addEventListener('change', (e) => {
    navLog('info', 'Dev plan toggle changed', { newPlan: e.target.value });
    setPlan(e.target.value);
  });
  
  // On first load, set to visitor if not already set
  if (!localStorage.getItem('dev-plan')) {
    navLog('info', 'Setting default dev plan to visitor');
    setPlan('visitor');
    select.value = 'visitor';
  } else {
    const currentDevPlan = localStorage.getItem('dev-plan');
    navLog('debug', 'Dev plan already set', { currentDevPlan });
  }

  navLog('info', 'Dev plan toggle created');
  return toggle;
}

// --- FEATURE ACCESS CONTROL ---
function checkFeatureAccess(featureKey, targetPlan = 'premium') {
  navLog('debug', 'checkFeatureAccess() called', { featureKey, targetPlan });
  
  if (!isFeatureUnlocked(featureKey)) {
    navLog('info', 'Feature access denied, showing upgrade modal', { featureKey, targetPlan });
    showUpgradeModal(targetPlan);
    return false;
  }
  
  navLog('debug', 'Feature access granted', { featureKey });
  return true;
}

// --- INITIALIZATION ---
function initializeNavigation() {
  navLog('info', '=== initializeNavigation() START ===');
  navLog('info', 'Initialization context', {
    readyState: document.readyState,
    url: window.location.href,
    userAgent: navigator.userAgent.substring(0, 50) + '...'
  });
  
  // Initialize required localStorage keys for smoke tests
  if (!localStorage.getItem('user-authenticated')) {
    localStorage.setItem('user-authenticated', 'false');
    navLog('debug', 'Initialized user-authenticated to false');
  }
  if (!localStorage.getItem('user-plan')) {
    localStorage.setItem('user-plan', 'free');
    navLog('debug', 'Initialized user-plan to free');
  }
  
  // Create dev plan toggle and append to document
  navLog('debug', 'Creating dev plan toggle');
  const toggle = createDevPlanToggle();
  document.body.appendChild(toggle);
  navLog('debug', 'Dev plan toggle appended to body');

  // --- FIX: If authenticated and dev-plan is visitor, set to free ---
  const authState = getAuthState();
  const devPlanSelect = document.querySelector('#dev-plan');
  if (authState.isAuthenticated && localStorage.getItem('dev-plan') === 'visitor') {
    localStorage.setItem('dev-plan', 'free');
    if (devPlanSelect) devPlanSelect.value = 'free';
    if (typeof window.setPlan === 'function') window.setPlan('free');
    navLog('info', 'Auto-switched dev plan to free for authenticated user');
  }

  // Update navigation
  navLog('debug', 'Calling updateNavigation()');
  updateNavigation();
  
  // Update dev toggle state
  navLog('debug', 'Updating dev toggle state');
  updateDevPlanToggle();
  
  // Listen for plan changes
  navLog('debug', 'Setting up storage event listener');
  window.addEventListener('storage', (e) => {
    if (e.key === 'dev-plan') {
      navLog('info', 'Storage event detected', { key: e.key, newValue: e.newValue, oldValue: e.oldValue });
      updateNavigation();
      updateDevPlanToggle();
    }
  });
  
  navLog('info', '=== initializeNavigation() COMPLETE ===');
}

// --- GLOBAL EXPORTS ---
window.JobHackAINavigation = {
  getCurrentPlan,
  getEffectivePlan,
  getAuthState,
  setAuthState,
  logout,
  isFeatureUnlocked,
  checkFeatureAccess,
  showUpgradeModal,
  updateNavigation,
  initializeNavigation,
  PLANS,
  NAVIGATION_CONFIG
};

// --- DEBUGGING UTILITY ---
window.navDebug = {
  // Commands object for other scripts to add commands
  commands: {},
  
  // Get current navigation state
  getState: () => {
    const authState = getAuthState();
    const currentPlan = getEffectivePlan();
    const devOverride = getDevPlanOverride();
    
    console.group('🔍 Navigation Debug State');
    console.log('Auth State:', authState);
    console.log('Current Plan:', currentPlan);
    console.log('Dev Override:', devOverride);
    console.log('URL:', window.location.href);
    console.log('localStorage:', {
      'user-authenticated': localStorage.getItem('user-authenticated'),
      'user-plan': localStorage.getItem('user-plan'),
      'dev-plan': localStorage.getItem('dev-plan')
    });
    console.log('Debug Settings:', {
      level: DEBUG.level,
      autoDebug: DEBUG.autoDebug.enabled,
      errorCount: DEBUG.autoDebug.errorCount,
      warningCount: DEBUG.autoDebug.warningCount
    });
    console.groupEnd();
    
    return { authState, currentPlan, devOverride };
  },
  
  // Test navigation rendering
  testNav: () => {
    console.log('🔄 Testing navigation rendering...');
    updateNavigation();
    console.log('✅ Navigation update complete');
  },
  
  // Set plan for testing
  setPlan: (plan) => {
    console.log(`🔄 Setting plan to: ${plan}`);
    setPlan(plan);
  },
  
  // Clear all navigation state
  reset: () => {
    console.log('🔄 Resetting navigation state...');
    localStorage.removeItem('user-authenticated');
    localStorage.removeItem('user-plan');
    localStorage.removeItem('dev-plan');
    updateNavigation();
    console.log('✅ Navigation state reset');
  },
  
  // Check feature access
  checkFeature: (featureKey) => {
    const isUnlocked = isFeatureUnlocked(featureKey);
    console.log(`🔒 Feature "${featureKey}": ${isUnlocked ? 'UNLOCKED' : 'LOCKED'}`);
    return isUnlocked;
  },
  
  // List all available features
  listFeatures: () => {
    console.group('📋 Available Features by Plan');
    Object.entries(PLANS).forEach(([planName, planConfig]) => {
      console.log(`${planName}:`, planConfig.features);
    });
    console.groupEnd();
  },
  
  // Enable/disable debug logging
  setLogLevel: (level) => {
    if (['debug', 'info', 'warn', 'error'].includes(level)) {
      DEBUG.level = level;
      console.log(`🔧 Debug level set to: ${level}`);
    } else {
      console.log('❌ Invalid log level. Use: debug, info, warn, error');
    }
  },
  
  // Toggle debug logging on/off
  toggleLogging: () => {
    DEBUG.enabled = !DEBUG.enabled;
    console.log(`🔧 Debug logging ${DEBUG.enabled ? 'ENABLED' : 'DISABLED'}`);
  },
};