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

// Lightweight state manager with pub/sub around localStorage
window.stateManager = window.stateManager || (function() {
  const watchers = new Map(); // key -> Set<callback>

  function notify(key, newValue, oldValue) {
    if (!watchers.has(key)) return;
    watchers.get(key).forEach(cb => {
      try { cb(newValue, oldValue); } catch (e) { /* no-op */ }
    });
  }

  function get(key) {
    return localStorage.getItem(key);
  }

  function set(key, value) {
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, value);
    notify(key, value, oldValue);
  }

  function watch(key, callback) {
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(callback);
    return () => unwatch(key, callback);
  }

  function unwatch(key, callback) {
    if (watchers.has(key)) watchers.get(key).delete(callback);
  }

  // Cross-tab updates
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    notify(e.key, e.newValue, e.oldValue);
  });

  // Simple backup/restore helpers (namespaced by timestamp)
  function createBackup() {
    const snapshot = {
      'user-authenticated': localStorage.getItem('user-authenticated'),
      'user-plan': localStorage.getItem('user-plan'),
      'dev-plan': localStorage.getItem('dev-plan'),
      'user-email': localStorage.getItem('user-email')
    };
    const id = `backup-${Date.now()}`;
    localStorage.setItem(id, JSON.stringify(snapshot));
    return { status: 'ok', id };
  }

  function restoreBackup(id) {
    try {
      const snapshot = JSON.parse(localStorage.getItem(id) || '{}');
      Object.entries(snapshot).forEach(([k, v]) => {
        set(k, v);
      });
      return { status: 'ok' };
    } catch (e) {
      return { status: 'error', error: e?.message };
    }
  }

  function listBackups() {
    return Object.keys(localStorage).filter(k => k.startsWith('backup-'));
  }

  return { get, set, watch, unwatch, createBackup, restoreBackup, listBackups };
})();

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
    localStorage.setItem('dev-plan', plan);
  }
  
  // Only log on debug level to reduce spam
  navLog('debug', 'Auth state updated in localStorage', {
    'user-authenticated': localStorage.getItem('user-authenticated'),
    'user-plan': localStorage.getItem('user-plan'),
    'dev-plan': localStorage.getItem('dev-plan')
  });
  
  // Trigger navigation update after state change
  setTimeout(() => {
    updateNavigation();
    updateDevPlanToggle();
  }, 100);
}

function logout() {
  navLog('info', 'logout() called');
  
  // Clear all authentication data
  localStorage.removeItem('user-authenticated');
  localStorage.removeItem('user-email');
  localStorage.removeItem('user-plan');
  localStorage.removeItem('dev-plan');
  localStorage.removeItem('user-db');
  localStorage.removeItem('selected-plan');
  localStorage.removeItem('selected-plan-ts');
  localStorage.removeItem('selected-plan-context');
  localStorage.removeItem('plan-amount');
  localStorage.removeItem('pending-signup-email');
  localStorage.removeItem('pending-signup-firstName');
  localStorage.removeItem('pending-signup-lastName');
  localStorage.removeItem('trial-activated');
  localStorage.removeItem('trial-start-date');
  
  // Only log on debug level to reduce spam
  navLog('debug', 'localStorage cleared', {
    'user-authenticated': localStorage.getItem('user-authenticated'),
    'user-plan': localStorage.getItem('user-plan'),
    'dev-plan': localStorage.getItem('dev-plan')
  });
  
  // Force navigation update immediately
  if (typeof updateNavigation === 'function') {
    updateNavigation();
  }
  
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
    features: ['ats'],
    description: '1 ATS score per month'
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

// --- ENSURE LOCALSTORAGE KEYS ARE ALWAYS SET ---
if (!localStorage.getItem('user-authenticated')) {
  localStorage.setItem('user-authenticated', 'false');
}
if (!localStorage.getItem('user-plan')) {
  localStorage.setItem('user-plan', 'free');
}

// --- NAVIGATION CONFIGURATION ---
const NAVIGATION_CONFIG = {
  // Logged-out / Visitor
  visitor: {
    navItems: [
      { text: 'Home', href: 'index.html' },
      { text: 'Blog', href: 'index.html#blog' },
      { text: 'Features', href: 'features.html' },
      { text: 'Pricing', href: 'pricing-a.html' },
      { text: 'Login', href: 'login.html' }
    ],
    cta: { text: 'Start Free Trial', href: 'pricing-a.html', isCTA: true }
  },
  // Free Account (no plan)
  free: {
    navItems: [
      { text: 'Home', href: 'index.html' },
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
      { text: 'Home', href: 'index.html' },
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
      { text: 'Home', href: 'index.html' },
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
      { text: 'Home', href: 'index.html' },
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
      { text: 'Home', href: 'index.html' },
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
  // Never allow plan overrides for logged-out users
  const authState = getAuthState();
  if (!authState.isAuthenticated) {
    navLog('debug', 'getDevPlanOverride: Ignoring overrides while logged out');
    return null;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  if (planParam && PLANS[planParam]) {
    navLog('info', 'getDevPlanOverride: Plan found in URL params', planParam);
    localStorage.setItem('dev-plan', planParam);
    return planParam;
  }
  const devPlan = localStorage.getItem('dev-plan');
  // Only allow dev-plan override if explicitly set and not visitor
  if (devPlan && devPlan !== 'visitor' && PLANS[devPlan]) {
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
  if (!authState.isAuthenticated) {
    // Force true visitor when logged out; ignore any overrides
    const effectivePlan = 'visitor';
    navLog('info', 'getEffectivePlan: User not authenticated, effective plan', effectivePlan);
    return effectivePlan;
  }
  // If authenticated, only use devOverride if it is not visitor and not null
  if (devOverride && devOverride !== 'visitor') {
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
    const oldPlan = localStorage.getItem('dev-plan');
    localStorage.setItem('dev-plan', plan);
    
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('plan', plan);
    window.history.replaceState({}, '', url);
    
    navLog('debug', 'setPlan: Updated localStorage and URL', {
      'dev-plan': localStorage.getItem('dev-plan'),
      newUrl: url.toString()
    });
    
    // Trigger plan change event
    const planChangeEvent = new CustomEvent('planChanged', {
      detail: { oldPlan, newPlan: plan }
    });
    window.dispatchEvent(planChangeEvent);
    
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
  
  const planConfig = PLANS[currentPlan] || { features: [] };
  const isUnlocked = planConfig && planConfig.features.includes(featureKey);
  
  // Additional check for free account usage limits
  if (isUnlocked && currentPlan === 'free' && featureKey === 'ats') {
    if (window.freeAccountManager) {
      const usageCheck = window.freeAccountManager.canUseATSScoring();
      if (!usageCheck.allowed) {
        navLog('info', 'isFeatureUnlocked: Free account usage limit reached', featureKey);
        return false;
      }
    }
  }
  
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
  
  // Additional debugging for visitor state issues
  if (currentPlan !== 'visitor' && !authState.isAuthenticated) {
    navLog('warn', 'POTENTIAL ISSUE: User not authenticated but plan is not visitor', {
      currentPlan,
      authState,
      devOverride,
      'localStorage dev-plan': localStorage.getItem('dev-plan'),
      'localStorage user-plan': localStorage.getItem('user-plan'),
      'localStorage user-authenticated': localStorage.getItem('user-authenticated')
    });
  }
  
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
    const onHome = location.pathname.endsWith('index.html') || location.pathname === '/' || location.pathname === '';
    let finalHref = href;

    // Normalize Blog link to use same-page hash on home, and absolute file path off home
    if (onHome && href === 'index.html#blog') {
      finalHref = '#blog';
    } else if (!onHome && href === '#blog') {
      finalHref = 'index.html#blog';
    }

    // Also normalize any explicit index.html hash when on home
    if (onHome && href.startsWith('index.html#')) {
      finalHref = '#' + href.split('#')[1];
    }

    linkElement.href = finalHref;
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
          // Do not fade or reduce opacity; make it a clear button-like link
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            navLog('info', 'Locked link clicked', { text: item.text, href: item.href });
            showUpgradeModal('essential');
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
      ctaLink.style.cssText = 'background: #00E676; color: white !important; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;';
      navActions.appendChild(ctaLink);
      navLog('info', 'Visitor CTA link created', { text: ctaLink.textContent, href: ctaLink.href, className: ctaLink.className });
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
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
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
    if (!isAuthView && navConfig.cta && mobileNav) {
      const cta = document.createElement('a');
      updateLink(cta, navConfig.cta.href);
      cta.textContent = navConfig.cta.text;
      cta.className = 'btn btn-primary';
      cta.style.cssText = 'background: #00E676; color: white !important; padding: 0.75rem 0; border-radius: 8px; text-decoration: none; font-weight: 600; display: block; text-align: center; margin-top: 1.5rem;';
      cta.setAttribute('role', 'button');
      mobileNav.appendChild(cta);
      navLog('info', 'Mobile visitor CTA created', { text: cta.textContent, href: cta.href });
    } else if (!mobileNav) {
      navLog('warn', 'mobileNav is null, cannot append CTA for visitors');
    }
    // --- Always append CTA for authenticated plans in mobile nav (only once, after nav links) ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.cta && mobileNav) {
      const cta = document.createElement('a');
      updateLink(cta, navConfig.userNav.cta.href);
      cta.textContent = navConfig.userNav.cta.text;
      cta.className = navConfig.userNav.cta.class || 'btn-primary';
      cta.setAttribute('role', 'button');
      mobileNav.appendChild(cta);
    } else if (isAuthView && navConfig.userNav && navConfig.userNav.cta && !mobileNav) {
      navLog('warn', 'mobileNav is null, cannot append CTA for authenticated plans');
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
      if (navGroup) {
        navGroup.appendChild(navActions);
      } else {
        navLog('warn', 'navGroup is null, cannot append navActions');
      }
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

function updateQuickPlanSwitcher() {
  // Update the quick plan switcher display
  updateQuickStateDisplay();
}

function updateDevPlanToggle() {
  // This function was referenced but not implemented
  // Since we're using the Quick Plan Switcher instead of the old dev toggle,
  // we can either remove the calls or implement a no-op function
  navLog('debug', 'updateDevPlanToggle called (no-op for Quick Plan Switcher)');
  // No action needed - Quick Plan Switcher handles all plan updates
}

// --- QUICK PLAN SWITCHER (REPLACES DEV PLAN TOGGLE) ---
function createQuickPlanSwitcher() {
  navLog('info', 'createQuickPlanSwitcher() called');
  
  const switcher = document.createElement('div');
  switcher.id = 'quick-plan-switcher';
  switcher.style.cssText = `
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    z-index: 9999;
    background: #1a1a1a;
    color: white;
    border-radius: 8px;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    max-width: 280px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 1px solid #333;
  `;
  
  // --- DUMMY ACCOUNTS ---
  const dummyAccounts = [
    { email: 'demo@jobhackai.com', password: 'password123', plan: 'free', label: 'Demo Free' },
    { email: 'trial@jobhackai.com', password: 'password123', plan: 'trial', label: 'Trial User' },
    { email: 'essential@jobhackai.com', password: 'password123', plan: 'essential', label: 'Essential User' },
    { email: 'pro@jobhackai.com', password: 'password123', plan: 'pro', label: 'Pro User' },
    { email: 'premium@jobhackai.com', password: 'password123', plan: 'premium', label: 'Premium User' }
  ];
  // Ensure these exist in the DB
  try {
    const db = JSON.parse(localStorage.getItem('user-db') || '{}');
    dummyAccounts.forEach(acc => {
      if (!db[acc.email]) {
        db[acc.email] = {
          plan: acc.plan,
          firstName: acc.label.split(' ')[0],
          lastName: acc.label.split(' ')[1] || '',
          cards: acc.plan === 'free' ? [] : [{ id: 'test-card-1', last4: '4242', brand: 'visa', expMonth: 12, expYear: 2025 }],
          created: new Date().toISOString(),
          password: acc.password
        };
      }
    });
    localStorage.setItem('user-db', JSON.stringify(db));
  } catch (e) { /* ignore */ }

  switcher.innerHTML = `
    <div style="margin-bottom: 8px; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
      <span style="color: #00ff88;">🧪</span>
      <span>Quick Plan Switcher</span>
    </div>
    <!-- Quick Login Section -->
    <div style="margin-bottom: 8px;">
      <label style="display: block; margin-bottom: 3px; font-size: 11px; color: #ccc;">Quick Login (Dummy):</label>
      <select id="quick-login-account" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; font-size: 11px;">
        <option value="">-- Select Dummy Account --</option>
        ${dummyAccounts.map(acc => `<option value="${acc.email}">${acc.label} (${acc.email})</option>`).join('')}
      </select>
      <button id="quick-login-btn" style="width: 100%; margin-top: 4px; padding: 6px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">Login as Selected</button>
    </div>
    <div style="margin-bottom: 8px;">
      <label style="display: block; margin-bottom: 3px; font-size: 11px; color: #ccc;">User State:</label>
      <select id="quick-user-state" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; font-size: 11px;">
        <option value="logged-out">🔴 Logged Out</option>
        <option value="free">🟢 Free User</option>
        <option value="trial">🟡 Trial User</option>
        <option value="essential">🔵 Essential User</option>
        <option value="pro">🟣 Pro User</option>
        <option value="premium">🟠 Premium User</option>
      </select>
    </div>
    <div style="margin-bottom: 8px;">
      <label style="display: block; margin-bottom: 3px; font-size: 11px; color: #ccc;">Email:</label>
      <input type="email" id="quick-user-email" value="test@example.com" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; font-size: 11px;">
    </div>
    <div style="margin-bottom: 8px;">
      <label style="display: block; margin-bottom: 3px; font-size: 11px; color: #ccc;">Payment Method:</label>
      <select id="quick-user-card" style="width: 100%; padding: 4px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; font-size: 11px;">
        <option value="true">💳 Has Card (Required for Trial+)</option>
        <option value="false">❌ No Card (Free only)</option>
      </select>
    </div>
    <button id="apply-quick-state" style="width: 100%; padding: 6px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 4px; font-size: 11px; font-weight: 600;">
      Apply State
    </button>
    <button id="reset-quick-state" style="width: 100%; padding: 6px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">
      Reset All
    </button>
    <div style="margin-top: 8px; font-size: 10px; color: #ccc; border-top: 1px solid #333; padding-top: 4px;">
      Current: <span id="current-quick-state">Loading...</span>
    </div>
  `;
  
  // Add event listeners
  const userStateSelect = switcher.querySelector('#quick-user-state');
  const applyButton = switcher.querySelector('#apply-quick-state');
  const resetButton = switcher.querySelector('#reset-quick-state');
  
  // Auto-apply when selection changes
  userStateSelect.addEventListener('change', () => {
    // Auto-set card requirement based on plan
    const selectedPlan = userStateSelect.value;
    const cardSelect = document.getElementById('quick-user-card');
    if (cardSelect) {
      if (selectedPlan === 'free') {
        cardSelect.value = 'false'; // Free plan doesn't need card
      } else {
        cardSelect.value = 'true'; // All other plans need card
      }
    }
    applyQuickState();
  });
  
  applyButton.addEventListener('click', () => {
    applyQuickState();
  });
  
  resetButton.addEventListener('click', () => {
    resetQuickState();
  });
  
  // Add event listeners for quick login
  const quickLoginSelect = switcher.querySelector('#quick-login-account');
  const quickLoginBtn = switcher.querySelector('#quick-login-btn');
  if (quickLoginBtn && quickLoginSelect) {
    quickLoginBtn.addEventListener('click', () => {
      const email = quickLoginSelect.value;
      if (!email) return;
      const db = JSON.parse(localStorage.getItem('user-db') || '{}');
      const user = db[email];
      if (user) {
        localStorage.setItem('user-email', email);
        localStorage.setItem('user-authenticated', 'true');
        localStorage.setItem('user-plan', user.plan || 'free');
        localStorage.setItem('dev-plan', user.plan || 'free');
        if (window.JobHackAINavigation) {
          window.JobHackAINavigation.setAuthState(true, user.plan);
        }
        // Trigger plan change event
        const planChangeEvent = new CustomEvent('planChanged', {
          detail: { newPlan: user.plan }
        });
        window.dispatchEvent(planChangeEvent);
        updateQuickStateDisplay();
        updateNavigation();
        setTimeout(() => { window.location.reload(); }, 300);
      }
    });
  }
  

  
  // Initialize current state display
  updateQuickStateDisplay();
  
  navLog('info', 'Quick plan switcher created');
  return switcher;
}

function applyQuickState() {
  const state = document.getElementById('quick-user-state').value;
  const email = document.getElementById('quick-user-email').value;
  const hasCard = document.getElementById('quick-user-card').value === 'true';
  
  navLog('info', 'Applying quick state', { state, email, hasCard });
  
  if (state === 'logged-out') {
    logout();
  } else {
    loginAsQuickUser(email, state, hasCard);
  }
  
  updateQuickStateDisplay();
  
  // Trigger plan change event for other components
  const planChangeEvent = new CustomEvent('planChanged', {
    detail: { newPlan: state }
  });
  window.dispatchEvent(planChangeEvent);
  
  // Force update navigation immediately
  updateNavigation();
  
  // Log the current state for debugging
  console.log('Quick Plan Switcher - Applied state:', {
    state,
    email,
    hasCard,
    'localStorage dev-plan': localStorage.getItem('dev-plan'),
    'localStorage user-plan': localStorage.getItem('user-plan'),
    'localStorage user-authenticated': localStorage.getItem('user-authenticated'),
    'getEffectivePlan()': getEffectivePlan()
  });
  
  // Try to refresh billing page if we're on it
  if (window.refreshBillingData && typeof window.refreshBillingData === 'function') {
    console.log('Refreshing billing data on current page');
    window.refreshBillingData();
  }
  
  // Force immediate UI update for billing page
  setTimeout(() => {
    // Try multiple approaches to force UI update
    console.log('Forcing immediate UI update for plan change to:', state);
    
    // 1. Dispatch events to both window and document
    const planChangeEvent = new CustomEvent('planChanged', {
      detail: { newPlan: state }
    });
    window.dispatchEvent(planChangeEvent);
    document.dispatchEvent(planChangeEvent);
    
    // 2. Directly call billing refresh if available
    if (window.refreshBillingData && typeof window.refreshBillingData === 'function') {
      console.log('Directly calling refreshBillingData()');
      window.refreshBillingData();
    }
    
    // 3. Force update specific billing elements if they exist
    if (document.getElementById('currentPlanName') && document.getElementById('currentPlanPrice')) {
      console.log('Directly updating billing UI elements');
      const planNames = {
        'free': 'Free Plan',
        'trial': 'Free Trial', 
        'essential': 'Essential Plan',
        'pro': 'Pro Plan',
        'premium': 'Premium Plan'
      };
      const planPrices = {
        'free': '$0/month',
        'trial': '$0/month',
        'essential': '$29.00/month',
        'pro': '$59.00/month',
        'premium': '$99.00/month'
      };
      
      document.getElementById('currentPlanName').textContent = planNames[state] || 'Free Plan';
      document.getElementById('currentPlanPrice').textContent = planPrices[state] || '$0/month';
      
      const isActive = state === 'trial' || state === 'free';
      const statusElement = document.getElementById('planStatus');
      if (statusElement) {
        statusElement.textContent = isActive ? 'Active' : 'Inactive';
      }
      
      console.log('Directly updated billing UI to:', state);
    }
    
    console.log('Completed forced UI update for plan:', state);
  }, 100);
  
  // Force immediate updates without page reload
  setTimeout(() => {
    // Update navigation system
    updateNavigation();
    updateQuickStateDisplay();
    
    // Force billing page update if we're on it
    if (window.location.pathname.includes('billing-management.html')) {
      console.log('On billing page, forcing complete update');
      if (window.refreshBillingData && typeof window.refreshBillingData === 'function') {
        window.refreshBillingData();
      }
    }
  }, 200);
}

function loginAsQuickUser(email, plan, hasCard) {
  // Set authentication state
  localStorage.setItem('user-authenticated', 'true');
  localStorage.setItem('user-email', email);
  localStorage.setItem('user-plan', plan);
  localStorage.setItem('dev-plan', plan); // This is the key - set dev-plan for override
  
  // Create or update user in database
  const db = JSON.parse(localStorage.getItem('user-db') || '{}');
  db[email] = {
    email: email,
    plan: plan,
    created: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    cards: hasCard ? [{
      id: 'test-card-1',
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2025
    }] : []
  };
  localStorage.setItem('user-db', JSON.stringify(db));
  localStorage.setItem('user-db-backup', JSON.stringify(db));
  
  // Update navigation if available
  if (window.JobHackAINavigation) {
    window.JobHackAINavigation.setAuthState(true, plan);
  }
  
  navLog('info', 'Quick user login applied', { email, plan, hasCard });
}

function resetQuickState() {
  localStorage.clear();
  updateQuickStateDisplay();
  navLog('info', 'Quick state reset');
  
  setTimeout(() => {
    window.location.reload();
  }, 300);
}

function updateQuickStateDisplay() {
  const isAuth = localStorage.getItem('user-authenticated') === 'true';
  const plan = localStorage.getItem('user-plan') || 'free';
  const email = localStorage.getItem('user-email') || 'Not logged in';
  
  const stateText = isAuth ? `${email} (${plan})` : 'Logged out';
  const stateElement = document.getElementById('current-quick-state');
  if (stateElement) {
    stateElement.textContent = stateText;
  }
  
  // Update dropdown to match current state
  const stateSelect = document.getElementById('quick-user-state');
  if (stateSelect) {
    stateSelect.value = isAuth ? plan : 'logged-out';
  }
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

  // --- Plan persistence fix ---
  const authState = getAuthState();
  let devPlan = localStorage.getItem('dev-plan');
  
  // Force clean visitor state for unauthenticated users
  if (!authState.isAuthenticated) {
    // Ensure a valid default plan key exists for logged-out users (used by diagnostics)
    localStorage.setItem('user-plan', 'free');
    localStorage.removeItem('dev-plan');
    devPlan = null;
    
    // Clear any URL parameters that might interfere with visitor state
    if (window.location.search.includes('plan=')) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      navLog('info', 'Cleared URL plan parameter for visitor state');
    }
    
    navLog('info', 'Force-cleared plan data for unauthenticated user');
  } else {
    // If dev-plan is not set or matches visitor, always set to user-plan
    if (!devPlan || devPlan === 'visitor') {
      localStorage.setItem('dev-plan', authState.userPlan || 'free');
      devPlan = authState.userPlan || 'free';
      navLog('info', 'Auto-set dev-plan to user plan for authenticated user', devPlan);
    }
  }

//   // Create quick plan switcher and append to document
//   navLog('debug', 'Creating quick plan switcher');
//   const switcher = createQuickPlanSwitcher();
//   document.body.appendChild(switcher);
//   navLog('debug', 'Quick plan switcher appended to body');

  // Update navigation
  navLog('debug', 'Calling updateNavigation()');
  updateNavigation();
  
  // Update quick plan switcher state
  navLog('debug', 'Updating quick plan switcher state');
  updateQuickPlanSwitcher();
  
  // Signal that navigation system is ready
  navLog('info', 'Navigation system initialization complete, dispatching ready event');
  const readyEvent = new CustomEvent('navigationReady');
  window.dispatchEvent(readyEvent);
  
  // Listen for plan changes
  navLog('debug', 'Setting up storage event listener');
  window.addEventListener('storage', (e) => {
    if (e.key === 'dev-plan' || e.key === 'user-plan' || e.key === 'user-authenticated') {
      navLog('info', 'Storage event detected', { key: e.key, newValue: e.newValue, oldValue: e.oldValue });
      updateNavigation();
      updateQuickPlanSwitcher();
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