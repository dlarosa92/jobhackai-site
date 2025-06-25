// JobHackAI Navigation System
// Handles dynamic navigation based on authentication state and user plan

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

// --- NAVIGATION CONFIGURATION ---
const NAVIGATION_CONFIG = {
  // Logged-out / Visitor
  visitor: {
    navItems: [
      { text: 'Home', href: 'index.html' },
      { text: 'Features', href: 'features.html' },
      { text: 'Pricing', href: 'pricing-a.html' },
      { text: 'Blog', href: '#blog' },
      { text: 'Login', href: 'login.html' },
      { text: 'Start Free Trial', href: 'signup.html', isCTA: true }
    ]
  },
  // Free Account (no plan)
  free: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html', locked: true },
      { text: 'Interview Questions', href: 'interview-questions.html', locked: true },
    ],
    userNav: {
      cta: { text: 'Pricing/Upgrade', href: 'pricing-a.html', isCTA: true },
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
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' },
    ],
    userNav: {
      cta: { text: 'Pricing/Upgrade', href: 'pricing-a.html', isCTA: true },
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
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' },
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
      { text: 'LinkedIn Optimizer', href: 'linkedin-optimizer.html' },
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

function showUpgradeModal(targetPlan = 'premium') {
  // Create upgrade modal
  const modal = document.createElement('div');
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
        <button onclick="this.closest('[style*=\'position: fixed\']').remove()" style="
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
  const isAuthView = authState.isAuthenticated || (devOverride && devOverride !== 'visitor');
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
      // Removed verbose logging to prevent console spam
      
      // For visitor view, the CTA is inside navItems, so handle it here
      if (item.isCTA && !isAuthView) {
        navLog('debug', 'Creating CTA link for visitor view', item);
        const navActions = document.querySelector('.nav-actions') || document.createElement('div');
        navActions.className = 'nav-actions';
        const ctaLink = document.createElement('a');
        updateLink(ctaLink, item.href);
        ctaLink.textContent = item.text;
        ctaLink.className = 'btn btn-primary';
        navActions.appendChild(ctaLink);
        if(!document.querySelector('.nav-actions')) navGroup.appendChild(navActions);
        navLog('info', 'CTA link created', { text: ctaLink.textContent, href: ctaLink.href });
      } else if (!item.isCTA) {
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
      }
    });
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
      // Removed verbose logging to prevent console spam
      
      if (item.isCTA && !isAuthView) {
        const ctaLink = document.createElement('a');
        updateLink(ctaLink, item.href);
        ctaLink.textContent = item.text;
        ctaLink.className = 'btn btn-primary';
        mobileNav.appendChild(ctaLink);
        // Removed verbose logging to prevent console spam
      } else if (!item.isCTA) {
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
      }
    });
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
    const navActions = document.querySelector('.nav-actions') || document.createElement('div');
    navActions.className = 'nav-actions';

    // CTA Button (if exists)
    if (navConfig.userNav.cta) {
      navLog('debug', 'Creating user nav CTA', navConfig.userNav.cta);
      const ctaLink = document.createElement('a');
      updateLink(ctaLink, navConfig.userNav.cta.href);
      ctaLink.textContent = navConfig.userNav.cta.text;
      ctaLink.className = 'btn btn-primary';
      navActions.appendChild(ctaLink);
    }

    // User Menu
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

    if(!document.querySelector('.nav-actions')) navGroup.appendChild(navActions);
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
  
  // Create dev plan toggle and append to document
  navLog('debug', 'Creating dev plan toggle');
  const toggle = createDevPlanToggle();
  document.body.appendChild(toggle);
  navLog('debug', 'Dev plan toggle appended to body');
  
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
  
  // NEW: Auto-debug controls
  autoDebug: {
    // Enable/disable auto-debug
    toggle: () => {
      DEBUG.autoDebug.enabled = !DEBUG.autoDebug.enabled;
      console.log(`🔧 Auto-debug ${DEBUG.autoDebug.enabled ? 'ENABLED' : 'DISABLED'}`);
    },
    
    // Set auto-debug thresholds
    setThresholds: (errors = 3, warnings = 5) => {
      DEBUG.autoDebug.maxErrors = errors;
      DEBUG.autoDebug.maxWarnings = warnings;
      console.log(`🔧 Auto-debug thresholds set: ${errors} errors, ${warnings} warnings`);
    },
    
    // Reset auto-debug counters
    reset: () => {
      DEBUG.autoDebug.errorCount = 0;
      DEBUG.autoDebug.warningCount = 0;
      DEBUG.autoDebug.lastReset = Date.now();
      console.log('🔧 Auto-debug counters reset');
    },
    
    // Get auto-debug status
    status: () => {
      console.group('🔧 Auto-Debug Status');
      console.log('Enabled:', DEBUG.autoDebug.enabled);
      console.log('Error Count:', DEBUG.autoDebug.errorCount);
      console.log('Warning Count:', DEBUG.autoDebug.warningCount);
      console.log('Max Errors:', DEBUG.autoDebug.maxErrors);
      console.log('Max Warnings:', DEBUG.autoDebug.maxWarnings);
      console.log('Time since reset:', Date.now() - DEBUG.autoDebug.lastReset, 'ms');
      console.groupEnd();
    }
  },
  
  // NEW: Manual issue detection
  detectIssues: () => {
    console.log('🔍 Running manual issue detection...');
    const issues = detectNavigationIssues();
    if (issues.length === 0) {
      console.log('✅ No issues detected');
    } else {
      console.log('⚠️ Issues detected:', issues);
    }
    return issues;
  },
  
  // NEW: Force enable debug logging
  forceDebug: () => {
    DEBUG.level = 'debug';
    console.log('🔧 Debug logging force-enabled');
    console.log('🔧 Running issue detection...');
    autoEnableDebugIfNeeded();
  },
  
  // Enhanced debugging commands
  commands: {
    // Health check
    health: () => siteHealth.checkAll(),
    
    // Generate report
    report: () => siteHealth.generateReport(),
    
    // Auto-fix
    fix: () => siteHealth.autoFix(),
    
    // State management
    backup: (name) => stateManager.backup(name),
    restore: (name) => stateManager.restore(name),
    list: () => stateManager.list(),
    delete: (name) => stateManager.delete(name),
    
    // Agent interface
    analyze: () => agentInterface.analyze(),
    agent: () => agentInterface,
    
    // Recovery
    recovery: () => stateManager.createRecoveryPoint('Manual recovery point'),
    emergency: () => stateManager.emergencyRestore(),
    
    // Error reporting
    errorReports: () => errorReporter.getReports(),
    errorSummary: () => errorReporter.generateSummary(),
    exportErrors: () => errorReporter.exportReports(),
    clearErrors: () => errorReporter.clearReports(),
    
    // Audit trail
    auditTrail: () => auditTrail.getEntries(),
    auditSummary: () => auditTrail.generateSummary(),
    exportAudit: () => auditTrail.exportEntries(),
    clearAudit: () => auditTrail.clearEntries(),
    auditTimeline: () => auditTrail.getTimeline(),
    
    // Smoke tests
    smokeTests: () => smokeTests.runAll(),
    smokeResults: () => smokeTests.getResults(),
    smokeStatus: () => smokeTests.getStatus(),
    exportSmokeTests: () => smokeTests.exportResults(),
    clearSmokeTests: () => smokeTests.clearResults(),
    
    // Self-healing
    selfHealingStatus: () => selfHealing.getStatus(),
    manualFix: () => selfHealing.manualFix(),
    resetSelfHealing: () => selfHealing.reset(),
    
    // Auto-debug control
    autoDebug: (enabled) => {
      if (enabled === undefined) {
        return DEBUG.autoDebug.enabled;
      }
      DEBUG.autoDebug.enabled = enabled;
      console.log(`🔧 Auto-debug ${enabled ? 'enabled' : 'disabled'}`);
    },
    
    // System status
    status: () => ({
      navigation: {
        authState: getAuthState(),
        currentPlan: getEffectivePlan(),
        devOverride: getDevPlanOverride()
      },
      health: siteHealth ? siteHealth.checkAll() : null,
      errorReports: errorReporter ? errorReporter.generateSummary() : null,
      auditTrail: auditTrail ? auditTrail.generateSummary() : null,
      smokeTests: smokeTests ? smokeTests.getStatus() : null,
      selfHealing: selfHealing ? selfHealing.getStatus() : null,
      stateManager: stateManager ? { backups: stateManager.list() } : null
    }),
    
    // Quick diagnostics
    diagnose: () => {
      console.group('🔍 Quick Diagnostics');
      
      // Navigation
      console.log('Navigation:', {
        authState: getAuthState(),
        currentPlan: getEffectivePlan(),
        devOverride: getDevPlanOverride()
      });
      
      // Health
      if (siteHealth) {
        const health = siteHealth.checkAll();
        console.log('Health:', health);
      }
      
      // Recent errors
      if (errorReporter) {
        const errors = errorReporter.getRecentReports(3);
        console.log('Recent Errors:', errors);
      }
      
      // Recent audit entries
      if (auditTrail) {
        const audit = auditTrail.getRecentEntries(3);
        console.log('Recent Audit:', audit);
      }
      
      // Smoke test results
      if (smokeTests) {
        const latest = smokeTests.getLatestResult();
        console.log('Latest Smoke Tests:', latest);
      }
      
      console.groupEnd();
    },
    
    // Help
    help: () => {
      console.group('🔧 Available Commands');
      console.log('Navigation: getState, testNavigation, setPlan, resetState');
      console.log('Health: health, report, fix');
      console.log('State: backup(name), restore(name), list, delete(name)');
      console.log('Agent: analyze, agent, recovery, emergency');
      console.log('Errors: errorReports, errorSummary, exportErrors, clearErrors');
      console.log('Audit: auditTrail, auditSummary, exportAudit, clearAudit, auditTimeline');
      console.log('Tests: smokeTests, smokeResults, smokeStatus, exportSmokeTests, clearSmokeTests');
      console.log('Healing: selfHealingStatus, manualFix, resetSelfHealing');
      console.log('System: status, diagnose, autoDebug(enabled), help');
      console.groupEnd();
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNavigation);
} else {
  initializeNavigation();
}

// --- HEALTH CHECK SYSTEM ---
window.siteHealth = {
  // Rate limiting for health checks
  rateLimit: {
    lastCheck: 0,
    minInterval: 1000, // Minimum 1 second between health checks
    checkCount: 0,
    maxChecksPerMinute: 30 // Maximum 30 health checks per minute
  },
  
  // Comprehensive site health check
  checkAll: () => {
    const now = Date.now();
    
    // Rate limiting
    if (now - siteHealth.rateLimit.lastCheck < siteHealth.rateLimit.minInterval) {
      console.log('🏥 Health check rate limited - too frequent');
      return siteHealth.lastHealthResult || { healthy: false, rateLimited: true };
    }
    
    // Check frequency limit
    siteHealth.rateLimit.checkCount++;
    if (siteHealth.rateLimit.checkCount > siteHealth.rateLimit.maxChecksPerMinute) {
      console.warn('🏥 Health check frequency limit exceeded');
      return siteHealth.lastHealthResult || { healthy: false, frequencyLimited: true };
    }
    
    // Reset counter every minute
    setTimeout(() => {
      siteHealth.rateLimit.checkCount = Math.max(0, siteHealth.rateLimit.checkCount - 1);
    }, 60000);
    
    siteHealth.rateLimit.lastCheck = now;
    
    const health = {
      timestamp: new Date().toISOString(),
      navigation: siteHealth.checkNavigation(),
      dom: siteHealth.checkDOM(),
      localStorage: siteHealth.checkLocalStorage(),
      scripts: siteHealth.checkScripts(),
      styles: siteHealth.checkStyles(),
      errors: siteHealth.checkErrors(),
      performance: siteHealth.checkPerformance()
    };
    
    // Cache the result
    siteHealth.lastHealthResult = health;
    
    console.group('🏥 Site Health Check');
    console.log('Overall Status:', health.navigation.healthy && health.dom.healthy ? '✅ HEALTHY' : '⚠️ ISSUES DETECTED');
    console.log('Navigation:', health.navigation);
    console.log('DOM:', health.dom);
    console.log('LocalStorage:', health.localStorage);
    console.log('Scripts:', health.scripts);
    console.log('Styles:', health.styles);
    console.log('Errors:', health.errors);
    console.log('Performance:', health.performance);
    console.groupEnd();
    
    return health;
  },
  
  // Navigation-specific health check
  checkNavigation: () => {
    const issues = detectNavigationIssues();
    const authState = getAuthState();
    const currentPlan = getEffectivePlan();
    
    return {
      healthy: issues.length === 0,
      issues: issues,
      authState: authState,
      currentPlan: currentPlan,
      navElements: {
        navGroup: !!document.querySelector('.nav-group'),
        navLinks: !!document.querySelector('.nav-links'),
        mobileNav: !!document.getElementById('mobileNav'),
        devToggle: !!document.getElementById('dev-plan-toggle')
      }
    };
  },
  
  // DOM health check
  checkDOM: () => {
    const requiredElements = [
      'header',
      'main',
      'footer',
      '.site-header',
      '.site-footer'
    ];
    
    const missing = requiredElements.filter(selector => !document.querySelector(selector));
    
    return {
      healthy: missing.length === 0,
      missing: missing,
      totalElements: document.querySelectorAll('*').length,
      bodyReady: document.body !== null,
      headReady: document.head !== null
    };
  },
  
  // LocalStorage health check
  checkLocalStorage: () => {
    const keys = ['user-authenticated', 'user-plan', 'dev-plan'];
    const values = {};
    const issues = [];
    
    keys.forEach(key => {
      values[key] = localStorage.getItem(key);
      if (values[key] === null && key !== 'dev-plan') {
        issues.push(`Missing ${key}`);
      }
    });
    
    return {
      healthy: issues.length === 0,
      issues: issues,
      values: values,
      totalKeys: localStorage.length
    };
  },
  
  // Script loading health check
  checkScripts: () => {
    const requiredScripts = [
      'js/navigation.js',
      'js/main.js',
      'js/analytics.js'
    ];
    
    const scripts = Array.from(document.scripts);
    const loaded = requiredScripts.map(src => {
      const found = scripts.find(script => script.src.includes(src));
      return { src, loaded: !!found, element: found };
    });
    
    const missing = loaded.filter(script => !script.loaded);
    
    return {
      healthy: missing.length === 0,
      missing: missing.map(m => m.src),
      loaded: loaded.filter(script => script.loaded).map(script => script.src),
      totalScripts: scripts.length
    };
  },
  
  // CSS loading health check
  checkStyles: () => {
    const requiredStyles = [
      'css/main.css',
      'css/header.css',
      'css/footer.css',
      'css/tokens.css'
    ];
    
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const loaded = requiredStyles.map(href => {
      const found = links.find(link => link.href.includes(href));
      return { href, loaded: !!found, element: found };
    });
    
    const missing = loaded.filter(style => !style.loaded);
    
    return {
      healthy: missing.length === 0,
      missing: missing.map(m => m.href),
      loaded: loaded.filter(style => style.loaded).map(style => style.href),
      totalStyles: links.length
    };
  },
  
  // Error monitoring
  checkErrors: () => {
    // Capture any console errors that occurred
    const errors = window.navErrors || [];
    
    return {
      healthy: errors.length === 0,
      errors: errors,
      count: errors.length,
      lastError: errors[errors.length - 1] || null
    };
  },
  
  // Performance check
  checkPerformance: () => {
    const perf = performance.getEntriesByType('navigation')[0];
    
    return {
      healthy: true, // Always healthy for now
      loadTime: perf ? perf.loadEventEnd - perf.loadEventStart : 'N/A',
      domContentLoaded: perf ? perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart : 'N/A',
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 'N/A',
      firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 'N/A'
    };
  },
  
  // Auto-fix common issues
  autoFix: () => {
    console.log('🔧 Attempting auto-fix...');
    const health = siteHealth.checkAll();
    let fixes = [];
    
    // Fix navigation issues
    if (!health.navigation.healthy) {
      console.log('🔧 Fixing navigation...');
      updateNavigation();
      fixes.push('Navigation updated');
    }
    
    // Fix localStorage issues
    if (!health.localStorage.healthy) {
      console.log('🔧 Fixing localStorage...');
      if (!localStorage.getItem('user-authenticated')) {
        localStorage.setItem('user-authenticated', 'false');
        fixes.push('Set default authentication state');
      }
      if (!localStorage.getItem('user-plan')) {
        localStorage.setItem('user-plan', 'free');
        fixes.push('Set default user plan');
      }
    }
    
    // Re-check after fixes
    const newHealth = siteHealth.checkAll();
    console.log('🔧 Auto-fix complete. Fixes applied:', fixes);
    console.log('🔧 New health status:', newHealth.navigation.healthy && newHealth.dom.healthy ? '✅ HEALTHY' : '⚠️ STILL HAS ISSUES');
    
    return { fixes, newHealth };
  },
  
  // Generate report for autonomous agents
  generateReport: () => {
    const health = siteHealth.checkAll();
    const report = {
      summary: {
        overall: health.navigation.healthy && health.dom.healthy ? 'HEALTHY' : 'ISSUES_DETECTED',
        timestamp: health.timestamp,
        url: window.location.href
      },
      issues: {
        navigation: health.navigation.issues,
        dom: health.dom.missing,
        localStorage: health.localStorage.issues,
        scripts: health.scripts.missing,
        styles: health.styles.missing,
        errors: health.errors.errors
      },
      recommendations: siteHealth.generateRecommendations(health)
    };
    
    return report;
  },
  
  // Generate recommendations based on health check
  generateRecommendations: (health) => {
    const recommendations = [];
    
    if (!health.navigation.healthy) {
      recommendations.push('Run updateNavigation() to fix navigation issues');
    }
    
    if (!health.localStorage.healthy) {
      recommendations.push('Reset localStorage state using navDebug.reset()');
    }
    
    if (health.scripts.missing.length > 0) {
      recommendations.push('Check script loading - missing: ' + health.scripts.missing.join(', '));
    }
    
    if (health.styles.missing.length > 0) {
      recommendations.push('Check CSS loading - missing: ' + health.styles.missing.join(', '));
    }
    
    if (health.errors.count > 0) {
      recommendations.push('Review console errors and fix JavaScript issues');
    }
    
    return recommendations;
  }
};

// Error capture for health monitoring
window.navErrors = [];
const originalError = console.error;
console.error = function(...args) {
  window.navErrors.push({
    timestamp: new Date().toISOString(),
    message: args.join(' '),
    stack: new Error().stack
  });
  originalError.apply(console, args);
};

// --- STATE BACKUP & RECOVERY SYSTEM ---
window.stateManager = {
  // Flag to prevent recursive backups during restore
  isRestoring: false,
  
  // Save current state
  backup: (name = 'auto-backup') => {
    // Don't backup during restore operations
    if (stateManager.isRestoring) {
      console.log('💾 Skipping backup during restore operation');
      return null;
    }
    
    const state = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      localStorage: {},
      navigation: {
        authState: getAuthState(),
        currentPlan: getEffectivePlan(),
        devOverride: getDevPlanOverride()
      },
      dom: {
        navGroup: document.querySelector('.nav-group')?.innerHTML || null,
        navLinks: document.querySelector('.nav-links')?.innerHTML || null,
        mobileNav: document.getElementById('mobileNav')?.innerHTML || null
      }
    };
    
    // Backup localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        state.localStorage[key] = localStorage.getItem(key);
      }
    }
    
    // Store backup
    const backups = JSON.parse(localStorage.getItem('nav-backups') || '{}');
    backups[name] = state;
    localStorage.setItem('nav-backups', JSON.stringify(backups));
    
    console.log(`💾 State backup created: ${name}`);
    return state;
  },
  
  // Restore state
  restore: (name = 'auto-backup') => {
    const backups = JSON.parse(localStorage.getItem('nav-backups') || '{}');
    const backup = backups[name];
    
    if (!backup) {
      console.error(`❌ Backup not found: ${name}`);
      return false;
    }
    
    console.log(`🔄 Restoring state from: ${name}`);
    
    // Set restoring flag to prevent recursive backups
    stateManager.isRestoring = true;
    
    try {
      // Restore localStorage
      Object.entries(backup.localStorage).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      
      // Restore navigation (this will trigger updateNavigation but won't create backups)
      updateNavigation();
      
      console.log(`✅ State restored from: ${name}`);
      return true;
    } catch (error) {
      console.error(`❌ Error during restore: ${error.message}`);
      return false;
    } finally {
      // Clear restoring flag
      stateManager.isRestoring = false;
    }
  },
  
  // List available backups
  list: () => {
    const backups = JSON.parse(localStorage.getItem('nav-backups') || '{}');
    console.group('💾 Available Backups');
    Object.entries(backups).forEach(([name, backup]) => {
      console.log(`${name}: ${backup.timestamp} (${backup.url})`);
    });
    console.groupEnd();
    return Object.keys(backups);
  },
  
  // Delete backup
  delete: (name) => {
    const backups = JSON.parse(localStorage.getItem('nav-backups') || '{}');
    if (backups[name]) {
      delete backups[name];
      localStorage.setItem('nav-backups', JSON.stringify(backups));
      console.log(`🗑️ Backup deleted: ${name}`);
      return true;
    }
    console.error(`❌ Backup not found: ${name}`);
    return false;
  },
  
  // Auto-backup before changes
  autoBackup: () => {
    // Don't backup during restore operations
    if (stateManager.isRestoring) {
      return null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return stateManager.backup(`auto-${timestamp}`);
  },
  
  // Create recovery point
  createRecoveryPoint: (description = '') => {
    // Don't create recovery points during restore operations
    if (stateManager.isRestoring) {
      console.log('🎯 Skipping recovery point during restore operation');
      return null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `recovery-${timestamp}`;
    const state = stateManager.backup(name);
    
    if (state) {
      // Add description
      const backups = JSON.parse(localStorage.getItem('nav-backups') || '{}');
      if (backups[name]) {
        backups[name].description = description;
        localStorage.setItem('nav-backups', JSON.stringify(backups));
      }
      
      console.log(`🎯 Recovery point created: ${name}${description ? ` - ${description}` : ''}`);
      return name;
    }
    
    return null;
  },
  
  // Emergency restore
  emergencyRestore: () => {
    const backups = stateManager.list();
    const latest = backups[backups.length - 1];
    if (latest) {
      console.log(`🤖 Agent emergency restore to: ${latest}`);
      return stateManager.restore(latest);
    }
    return false;
  }
};

// Auto-backup before risky operations
const originalSetPlan = setPlan;
setPlan = function(plan) {
  stateManager.autoBackup();
  return originalSetPlan(plan);
};

const originalSetAuthState = setAuthState;
setAuthState = function(isAuthenticated, plan = null) {
  stateManager.autoBackup();
  return originalSetAuthState(isAuthenticated, plan);
};

// --- AUTONOMOUS AGENT INTERFACE ---
window.agentInterface = {
  // Main entry point for agents
  analyze: () => {
    console.log('🤖 Agent Analysis Starting...');
    
    // Create recovery point
    const recoveryPoint = stateManager.createRecoveryPoint('Agent analysis started');
    
    // Run comprehensive health check
    const health = siteHealth.checkAll();
    const report = siteHealth.generateReport();
    
    // Auto-fix if issues detected
    let fixes = [];
    if (!health.navigation.healthy || !health.dom.healthy) {
      const fixResult = siteHealth.autoFix();
      fixes = fixResult.fixes;
    }
    
    const analysis = {
      recoveryPoint,
      health,
      report,
      fixes,
      recommendations: report.recommendations,
      safeToProceed: health.navigation.healthy && health.dom.healthy
    };
    
    console.group('🤖 Agent Analysis Complete');
    console.log('Recovery Point:', recoveryPoint);
    console.log('Safe to Proceed:', analysis.safeToProceed);
    console.log('Issues Found:', health.navigation.issues.length + health.dom.missing.length);
    console.log('Fixes Applied:', fixes);
    console.log('Recommendations:', analysis.recommendations);
    console.groupEnd();
    
    return analysis;
  },
  
  // Safe navigation operations
  navigation: {
    // Get current navigation state
    getState: () => {
      return {
        authState: getAuthState(),
        currentPlan: getEffectivePlan(),
        devOverride: getDevPlanOverride(),
        navConfig: NAVIGATION_CONFIG[getEffectivePlan()]
      };
    },
    
    // Safely change plan
    setPlan: (plan) => {
      console.log(`🤖 Agent setting plan to: ${plan}`);
      stateManager.autoBackup();
      return setPlan(plan);
    },
    
    // Safely update navigation
    update: () => {
      console.log('🤖 Agent updating navigation...');
      stateManager.autoBackup();
      updateNavigation();
      return siteHealth.checkNavigation();
    },
    
    // Test navigation changes
    test: () => {
      console.log('🤖 Agent testing navigation...');
      const before = siteHealth.checkNavigation();
      updateNavigation();
      const after = siteHealth.checkNavigation();
      
      return {
        before,
        after,
        improved: after.issues.length < before.issues.length,
        newIssues: after.issues.filter(issue => !before.issues.includes(issue))
      };
    }
  },
  
  // Safe debugging operations
  debug: {
    // Enable detailed logging
    enable: () => {
      navDebug.setLogLevel('debug');
      return { level: DEBUG.level, enabled: DEBUG.enabled };
    },
    
    // Disable logging
    disable: () => {
      navDebug.setLogLevel('warn');
      return { level: DEBUG.level, enabled: DEBUG.enabled };
    },
    
    // Get debug state
    getState: () => {
      return navDebug.getState();
    },
    
    // Run issue detection
    detectIssues: () => {
      return navDebug.detectIssues();
    }
  },
  
  // Recovery operations
  recovery: {
    // Create recovery point
    createPoint: (description) => {
      return stateManager.createRecoveryPoint(description);
    },
    
    // List recovery points
    list: () => {
      return stateManager.list();
    },
    
    // Restore to point
    restore: (name) => {
      console.log(`🤖 Agent restoring to: ${name}`);
      return stateManager.restore(name);
    },
    
    // Emergency restore
    emergency: () => {
      const backups = stateManager.list();
      const latest = backups[backups.length - 1];
      if (latest) {
        console.log(`🤖 Agent emergency restore to: ${latest}`);
        return stateManager.restore(latest);
      }
      return false;
    }
  },
  
  // Health monitoring
  health: {
    // Quick health check
    check: () => {
      return siteHealth.checkAll();
    },
    
    // Auto-fix issues
    fix: () => {
      return siteHealth.autoFix();
    },
    
    // Generate report
    report: () => {
      return siteHealth.generateReport();
    }
  },
  
  // Safe operations
  safe: {
    // Execute function with backup
    execute: (operation, description = 'Agent operation') => {
      console.log(`🤖 Agent executing: ${description}`);
      
      // Create recovery point
      const recoveryPoint = stateManager.createRecoveryPoint(description);
      
      try {
        // Execute operation
        const result = operation();
        
        // Check health after operation
        const health = siteHealth.checkAll();
        
        return {
          success: true,
          result,
          recoveryPoint,
          health,
          safeToContinue: health.navigation.healthy && health.dom.healthy
        };
      } catch (error) {
        console.error(`🤖 Agent operation failed: ${error.message}`);
        
        // Auto-restore on failure
        stateManager.restore(recoveryPoint);
        
        return {
          success: false,
          error: error.message,
          recoveryPoint,
          restored: true
        };
      }
    },
    
    // Batch operations
    batch: (operations) => {
      console.log(`🤖 Agent executing batch of ${operations.length} operations`);
      
      const recoveryPoint = stateManager.createRecoveryPoint('Agent batch operation');
      const results = [];
      
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        console.log(`🤖 Agent executing operation ${i + 1}/${operations.length}`);
        
        try {
          const result = operation();
          results.push({ success: true, result, operationIndex: i });
          
          // Check health after each operation
          const health = siteHealth.checkAll();
          if (!health.navigation.healthy || !health.dom.healthy) {
            console.warn(`🤖 Agent stopping batch due to health issues after operation ${i + 1}`);
            break;
          }
        } catch (error) {
          console.error(`🤖 Agent batch operation ${i + 1} failed: ${error.message}`);
          results.push({ success: false, error: error.message, operationIndex: i });
          
          // Restore and stop batch
          stateManager.restore(recoveryPoint);
          break;
        }
      }
      
      return {
        recoveryPoint,
        results,
        completed: results.length === operations.length
      };
    }
  },
  
  // Validation helpers
  validate: {
    // Validate plan exists
    plan: (plan) => {
      return PLANS.hasOwnProperty(plan);
    },
    
    // Validate feature exists
    feature: (feature) => {
      return Object.values(PLANS).some(plan => plan.features.includes(feature));
    },
    
    // Validate navigation config
    navConfig: (plan) => {
      return NAVIGATION_CONFIG.hasOwnProperty(plan);
    }
  },
  
  // Information helpers
  info: {
    // Get available plans
    plans: () => {
      return Object.keys(PLANS);
    },
    
    // Get available features
    features: () => {
      const allFeatures = new Set();
      Object.values(PLANS).forEach(plan => {
        plan.features.forEach(feature => allFeatures.add(feature));
      });
      return Array.from(allFeatures);
    },
    
    // Get plan features
    planFeatures: (plan) => {
      return PLANS[plan]?.features || [];
    },
    
    // Get navigation items for plan
    navItems: (plan) => {
      return NAVIGATION_CONFIG[plan]?.navItems || [];
    }
  }
};

// Auto-initialize agent interface
console.log('🤖 Autonomous Agent Interface loaded');
console.log('🤖 Use agentInterface.analyze() to start analysis'); 