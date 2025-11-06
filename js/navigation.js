// JobHackAI Navigation System
// Handles dynamic navigation based on authentication state and user plan

// Version stamp for deployment verification
console.log('🔧 navigation.js VERSION: redirect-fix-v3-SYNC-AND-CLEANUP - ' + new Date().toISOString());

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
  const storedAuth = localStorage.getItem('user-authenticated');
  const isAuthenticated = storedAuth === 'true' && !!localStorage.getItem('user-email');
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
  let isAuthenticated = localStorage.getItem('user-authenticated') === 'true' && !!localStorage.getItem('user-email');
  const userPlan = localStorage.getItem('user-plan') || 'free';
  const devPlan = localStorage.getItem('dev-plan');

  // Self-heal from Firebase auth storage if needed
  const forceTs = parseInt(localStorage.getItem('force-logged-out') || '0', 10);
  const cooldownActive = forceTs && (Date.now() - forceTs) < 60000; // 60s TTL
  if (!isAuthenticated && !cooldownActive) {
    try {
      // 1) Try our own auth-user cache first
      const authUserRaw = localStorage.getItem('auth-user');
      if (authUserRaw) {
        const authUser = JSON.parse(authUserRaw);
        if (authUser && authUser.email) {
          localStorage.setItem('user-email', authUser.email);
          localStorage.setItem('user-authenticated', 'true');
          isAuthenticated = true;
        }
      }
      // 2) Fall back to Firebase SDK local storage
      if (!isAuthenticated) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('firebase:authUser:')) {
            const firebaseAuthRaw = localStorage.getItem(key);
            try {
              const firebaseAuth = JSON.parse(firebaseAuthRaw || '{}');
              if (firebaseAuth && firebaseAuth.email) {
                localStorage.setItem('user-email', firebaseAuth.email);
                localStorage.setItem('user-authenticated', 'true');
                isAuthenticated = true;
                break;
              }
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      navLog('warn', 'Auth self-heal failed', e);
    }
  }

  const authState = {
    isAuthenticated,
    userPlan: isAuthenticated ? userPlan : null,
    devPlan: devPlan || null
  };
  navLog('debug', 'getAuthState() called', authState);
  return authState;
}

function setAuthState(isAuthenticated, plan = null) {
  navLog('info', 'setAuthState() called', { isAuthenticated, plan });
  
  localStorage.setItem('user-authenticated', isAuthenticated ? 'true' : 'false');
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

async function logout(e) {
  e?.preventDefault?.();
  console.log('🚪 logout() v2: triggered');

  // Set logout intent immediately - CRITICAL: Must be set before any async operations
  sessionStorage.setItem('logout-intent', '1');

  // Attempt Firebase sign out
  try {
    await window.FirebaseAuthManager?.signOut?.();
    console.log('✅ Firebase signOut complete');
  } catch (err) {
    console.warn('⚠️ signOut error (ignored):', err);
  }

  // Safely clear localStorage
  try {
    ['user-authenticated', 'user-email', 'user-plan', 'dev-plan', 'auth-user', 'selectedPlan']
      .forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('⚠️ localStorage cleanup failed:', err);
  }

  // Clear all Firebase auth persistence keys to prevent automatic re-login
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('firebase:authUser:')) {
        localStorage.removeItem(key);
        console.log('🗑️ Removed Firebase auth key:', key);
      }
    }
  } catch (err) {
    console.warn('⚠️ Firebase auth key cleanup failed:', err);
  }

  // Also clear any session-scoped plan selection
  try { sessionStorage.removeItem('selectedPlan'); } catch (_) {}

  // Small delay to ensure all cleanup completes before redirect
  // This prevents race conditions with auth state listeners
  await new Promise(resolve => setTimeout(resolve, 100));

  // Redirect to login (keep .html for now)
  // Clear logout-intent to avoid stale state on back/cached navigation
  try { sessionStorage.removeItem('logout-intent'); } catch (_) {}
  console.log('➡️ Redirecting to /login.html');
  location.replace('/login.html');
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
// Ensure dev-plan is always set for consistency
if (!localStorage.getItem('dev-plan')) {
  localStorage.setItem('dev-plan', localStorage.getItem('user-plan') || 'free');
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
  let effectivePlan = authState.userPlan || 'free';
  
  // Map 'pending' to 'free' for feature access
  if (effectivePlan === 'pending') {
    effectivePlan = 'free';
    navLog('info', 'getEffectivePlan: Mapping pending to free for feature access');
  }
  
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
          // Only add locked handler if explicitly marked as locked
          // Dropdown items should inherit unlocked state from parent plan config
          if (dropdownItem.locked) {
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              navLog('info', 'Locked dropdown link clicked', { text: dropdownItem.text, href: dropdownItem.href });
              showUpgradeModal('essential');
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          // IMPORTANT: Do not add any other click handlers to dropdown links
          // They should navigate normally unless explicitly locked
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
        // CRITICAL: Only add locked handler if explicitly marked as locked in config
        // This prevents incorrect upgrade modals from appearing
        if (item.locked === true) {
          // Do not fade or reduce opacity; make it a clear button-like link
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            navLog('info', 'Locked link clicked', { text: item.text, href: item.href, plan: currentPlan });
            showUpgradeModal('essential');
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        // IMPORTANT: Do not add any other click handlers - links should navigate normally unless locked
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
          // Only add locked handler if explicitly marked as locked
          if (dropdownItem.locked) {
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              navLog('info', 'Mobile locked dropdown link clicked', { text: dropdownItem.text, href: dropdownItem.href });
              showUpgradeModal('essential');
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          // IMPORTANT: Do not add any other click handlers to mobile dropdown links
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
  // No-op - Quick Plan Switcher removed
}

function updateDevPlanToggle() {
  // No-op - dev plan toggle removed
}

// --- QUICK PLAN SWITCHER REMOVED ---
// All quick plan switcher code has been removed
// For testing: use browser console with localStorage.setItem('dev-plan', 'trial')

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
    // Clear force flag if not needed anymore (kept until first init completes)
    if (localStorage.getItem('force-logged-out') === 'true') {
      // remove after navigation renders once on home
      setTimeout(() => { try { localStorage.removeItem('force-logged-out'); } catch (_) {} }, 500);
    }
    // Ensure a valid default plan key exists for logged-out users (used by diagnostics)
    localStorage.setItem('user-plan', 'free');
    localStorage.removeItem('dev-plan');
    devPlan = null;
    
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
  
  // REMOVED: Do NOT call reconcilePlanFromKV() here - it causes race condition
  // Plan reconciliation will be handled by:
  // 1. Firebase auth's onAuthStateChanged listener (already implemented)
  // 2. Page-specific DOMContentLoaded handlers that wait for auth
  // 3. Manual calls with ?paid=1 parameter
  
  // Only handle post-checkout activation polling (doesn't need immediate plan fetch)
  if (location.search.includes('paid=1')) {
    // This will be handled by dashboard.html's DOMContentLoaded after auth is confirmed
    navLog('info', 'Checkout flow detected, plan sync will be handled by page auth check');
  }
  
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

// --- KV Plan Reconciliation and Post-Checkout Activation ---
async function fetchKVPlan() {
  try {
    // DEFENSIVE GUARD: Ensure FirebaseAuthManager is loaded
    if (!window.FirebaseAuthManager) {
      console.log('🔍 fetchKVPlan: FirebaseAuthManager not loaded yet, skipping');
      return null;
    }

    // DEFENSIVE GUARD: Wait for auth to be ready if it's still initializing
    if (window.FirebaseAuthManager.waitForAuthReady) {
      try {
        await window.FirebaseAuthManager.waitForAuthReady(1000); // Short timeout
      } catch (e) {
        console.log('🔍 fetchKVPlan: Auth ready timeout, continuing anyway');
      }
    }

    const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
    if (!currentUser) {
      console.log('🔍 fetchKVPlan: No current user available');
      return null;
    }
    
    const idToken = await currentUser.getIdToken?.();
    if (!idToken) {
      console.log('🔍 fetchKVPlan: No ID token available');
      return null;
    }
    
    console.log('🔍 fetchKVPlan: Fetching plan from API...');
    const r = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) {
      console.warn(`🔍 fetchKVPlan: API returned ${r.status} ${r.statusText}`);
      return null;
    }
    
    const data = await r.json();
    console.log('🔍 fetchKVPlan: API response:', data);
    
    // Store trial end date if available
    if (data.trialEndsAt) {
      localStorage.setItem('trial-ends-at', data.trialEndsAt);
    } else {
      localStorage.removeItem('trial-ends-at');
    }
    
    const plan = data.plan || 'free';
    console.log(`✅ fetchKVPlan: Successfully fetched plan: ${plan}`);
    return plan;
  } catch (error) {
    console.warn('❌ fetchKVPlan: Error fetching plan:', error);
    return null;
  }
}

async function reconcilePlanFromKV() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    console.log('🔍 reconcilePlanFromKV: User not authenticated, skipping');
    return;
  }
  
  // Check if FirebaseAuthManager is loaded
  if (!window.FirebaseAuthManager) {
    console.log('🔍 reconcilePlanFromKV: FirebaseAuthManager not loaded, skipping');
    return;
  }
  
  // FIX: Add retry mechanism for plan reconciliation
  let kvPlan = null;
  let retryCount = 0;
  const maxRetries = 3;
  
  console.log('🔍 reconcilePlanFromKV: Starting plan reconciliation...');
  
  while (!kvPlan && retryCount < maxRetries) {
    try {
      kvPlan = await fetchKVPlan();
      if (kvPlan) {
        console.log(`✅ Plan reconciliation successful on attempt ${retryCount + 1}:`, kvPlan);
        break;
      }
    } catch (error) {
      console.warn(`⚠️ Plan reconciliation attempt ${retryCount + 1} failed:`, error);
    }
    
    retryCount++;
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying plan reconciliation in ${retryCount * 1000}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
    }
  }
  
  const current = localStorage.getItem('user-plan');
  if (kvPlan && kvPlan !== current) {
    console.log(`🔄 Updating plan from ${current} to ${kvPlan}`);
    localStorage.setItem('user-plan', kvPlan);
    localStorage.setItem('dev-plan', kvPlan);
    updateNavigation();
    try { new BroadcastChannel('auth').postMessage({ type: 'plan-update', plan: kvPlan }); } catch (_) {}
  } else if (!kvPlan) {
    console.warn('⚠️ Plan reconciliation failed after all retries, keeping current plan:', current);
  }
}

async function waitForPlanActivationIfNeeded() {
  if (!location.search.includes('paid=1')) return;
  const deadline = Date.now() + 10000; // 10s
  while (Date.now() < deadline) {
    await reconcilePlanFromKV();
    const effective = getEffectivePlan();
    if (effective !== 'free' && effective !== 'trial') break;
    await new Promise(r => setTimeout(r, 500));
  }
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
  fetchKVPlan,
  reconcilePlanFromKV,
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

// Navigation gating functions (Phase 2)
function renderMarketingNav(desktop, mobile) {
  if (!desktop) return;
  desktop.innerHTML = `
    <a href="/index.html">Home</a>
    <a href="/blog.html">Blog</a>
    <a href="/features.html">Features</a>
    <a href="/pricing.html">Pricing</a>
    <a class="btn-link" href="/login.html">Login</a>
    <a class="btn-primary" href="/signup.html">Start Free Trial</a>
  `;
  if (mobile) mobile.innerHTML = desktop.innerHTML;
}

function renderUnverifiedNav(desktop, mobile) {
  if (!desktop) return;
  desktop.innerHTML = `
    <span class="nav-status">Verify your email to unlock your account</span>
    <button id="nav-logout-btn" class="btn-outline">Logout</button>
  `;
  if (mobile) mobile.innerHTML = desktop.innerHTML;
  const btn = document.getElementById("nav-logout-btn");
  if (btn && window.FirebaseAuthManager) {
    btn.onclick = () => window.FirebaseAuthManager.signOut();
  }
}

function renderVerifiedNav(desktop, mobile) {
  if (!desktop) return;
  desktop.innerHTML = `
    <a href="/dashboard.html">Dashboard</a>
    <a href="/interview-questions.html">Interview Questions</a>
    <a href="/pricing.html">Pricing</a>
    <a href="/account-setting.html" class="nav-account-link">Account</a>
    <button id="nav-logout-btn" class="btn-outline">Logout</button>
  `;
  if (mobile) mobile.innerHTML = desktop.innerHTML;
  const btn = document.getElementById("nav-logout-btn");
  if (btn && window.FirebaseAuthManager) {
    btn.onclick = () => window.FirebaseAuthManager.signOut();
  }
}

function applyNavForUser(user) {
  const desktopNav = document.querySelector("nav.nav-links");
  const mobileNav = document.querySelector(".mobile-nav");
  const logo = document.querySelector(".site-logo, .nav-logo, header .logo, a.nav-logo");
  
  if (!desktopNav) return;
  
  if (!user) {
    renderMarketingNav(desktopNav, mobileNav);
    if (logo) logo.onclick = () => (window.location.href = "/index.html");
    return;
  }
  
  if (!user.emailVerified) {
    renderUnverifiedNav(desktopNav, mobileNav);
    if (logo) logo.onclick = () => (window.location.href = "/verify-email.html?email=" + encodeURIComponent(user.email || ""));
    return;
  }
  
  renderVerifiedNav(desktopNav, mobileNav);
  if (logo) logo.onclick = () => (window.location.href = "/dashboard.html");
}

// Initialize navigation when Firebase auth is ready
document.addEventListener('firebase-auth-ready', async (event) => {
  console.log('🔥 Firebase auth ready, initializing navigation');
  try {
    const user = window.FirebaseAuthManager
      ? window.FirebaseAuthManager.getCurrentUser()
      : null;
    applyNavForUser(user);
    initializeNavigation();
  } catch (err) {
    console.warn("[nav] failed to apply state", err);
    initializeNavigation();
  }
});

// Fallback: Initialize immediately if Firebase is already ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if Firebase is already ready (auth state already changed)
    if (window.FirebaseAuthManager && window.FirebaseAuthManager.currentUser !== undefined) {
      console.log('🔥 Firebase already ready, initializing navigation');
      const user = window.FirebaseAuthManager.getCurrentUser();
      applyNavForUser(user);
      initializeNavigation();
    }
  });
} else {
  // DOM already loaded, check if Firebase is ready
  if (window.FirebaseAuthManager && window.FirebaseAuthManager.currentUser !== undefined) {
    console.log('🔥 Firebase already ready, initializing navigation');
    const user = window.FirebaseAuthManager.getCurrentUser();
    applyNavForUser(user);
    initializeNavigation();
  }
}