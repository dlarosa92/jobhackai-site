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
  level: 'error', // 'debug', 'info', 'warn', 'error' - Default to 'error' to reduce info leakage
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
  // CRITICAL SECURITY FIX: Check Firebase auth state FIRST (source of truth)
  // This prevents dangerous "self-heal" logic that can restore auth state after logout
  const logoutIntent = sessionStorage.getItem('logout-intent');
  
  // If logout is in progress, always return unauthenticated
  if (logoutIntent === '1') {
    return {
      isAuthenticated: false,
      userPlan: null,
      devPlan: null
    };
  }
  
  // Firebase user is the source of truth - check it first
  const firebaseUser = window.FirebaseAuthManager?.getCurrentUser?.();
  const isAuthenticatedFromFirebase = !!firebaseUser;
  
  // Only fall back to localStorage if Firebase hasn't initialized yet
  // But don't "self-heal" - that's dangerous and causes logout issues
  let fallbackAuth = false;
  if (!window.FirebaseAuthManager && !firebaseUser) {
    // Firebase not initialized - use localStorage as fallback (for initial page load)
    fallbackAuth = localStorage.getItem('user-authenticated') === 'true' && 
                   !!localStorage.getItem('user-email');
  }
  
  const actualAuth = isAuthenticatedFromFirebase || fallbackAuth;
  
  // If localStorage says authenticated but Firebase says not, trust Firebase
  // This handles cases where logout cleared Firebase but localStorage is stale
  if (!firebaseUser && actualAuth && window.FirebaseAuthManager) {
    // Firebase is initialized and says logged out - sync localStorage to match
    localStorage.setItem('user-authenticated', 'false');
    localStorage.removeItem('user-email');
    return {
      isAuthenticated: false,
      userPlan: null,
      devPlan: null
    };
  }
  
  const userPlan = actualAuth ? (localStorage.getItem('user-plan') || 'free') : null;
  const devPlan = actualAuth ? localStorage.getItem('dev-plan') : null;

  const authState = {
    isAuthenticated: actualAuth,
    userPlan,
    devPlan
  };
  
  // Only log errors, not debug info (reduces info leakage)
  if (!actualAuth && localStorage.getItem('user-authenticated') === 'true') {
    navLog('error', 'Auth state mismatch: localStorage says authenticated but Firebase says not');
  }
  
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

  // CRITICAL SECURITY FIX: Set logout intent IMMEDIATELY (before any async operations)
  // This prevents race conditions where UI updates before state is cleared
  sessionStorage.setItem('logout-intent', '1');

  // CRITICAL: Update navigation state IMMEDIATELY (synchronously, before Firebase signOut)
  // This ensures UI shows logged-out state right away, preventing flickering
  setAuthState(false, null);

  // Clear localStorage IMMEDIATELY (synchronously) - don't wait for Firebase
  try {
    ['user-authenticated', 'user-email', 'user-plan', 'dev-plan', 'auth-user', 'selectedPlan']
      .forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('⚠️ localStorage cleanup failed:', err);
  }

  // Clear all Firebase auth persistence keys IMMEDIATELY (synchronously)
  // This prevents "self-heal" logic from restoring auth state
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('firebase:authUser:')) {
        localStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.warn('⚠️ Firebase auth key cleanup failed:', err);
  }

  // Clear session-scoped data IMMEDIATELY
  try { sessionStorage.removeItem('selectedPlan'); } catch (_) {}

  // NOW do Firebase signOut (async, but UI already updated synchronously above)
  try {
    await window.FirebaseAuthManager?.signOut?.();
    console.log('✅ Firebase signOut complete');
  } catch (err) {
    console.warn('⚠️ signOut error (ignored):', err);
  }

  // Small delay to ensure all cleanup completes before redirect
  // This prevents race conditions with auth state listeners
  await new Promise(resolve => setTimeout(resolve, 100));

  // Redirect to login
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
      { text: 'Pricing', href: '/pricing-a' },
      { text: 'Login', href: 'login.html' }
    ],
    cta: { text: 'Start Free Trial', href: '/login.html?plan=trial', isCTA: true, planId: 'trial' }
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

const CTA_PLAN_METADATA = {
  trial: {
    planName: '3-Day Free Trial',
    price: '$0 for 3 days'
  },
  essential: {
    planName: 'Essential Plan',
    price: '$29/mo'
  },
  pro: {
    planName: 'Pro Plan',
    price: '$59/mo'
  },
  premium: {
    planName: 'Premium Plan',
    price: '$99/mo'
  }
};

function persistSelectedPlan(planId, { source = 'navigation-cta' } = {}) {
  if (!planId) {
    navLog('debug', 'persistSelectedPlan skipped — no planId provided', { source });
    return;
  }

  const metadata = CTA_PLAN_METADATA[planId] || {
    planName: 'Selected Plan',
    price: '$0/mo'
  };

  const payload = {
    planId,
    planName: metadata.planName,
    price: metadata.price,
    source,
    timestamp: Date.now()
  };

  try {
    sessionStorage.setItem('selectedPlan', JSON.stringify(payload));
  } catch (err) {
    navLog('warn', 'Failed to persist selectedPlan in sessionStorage', { error: err?.message, planId, source });
  }

  try {
    localStorage.setItem('selectedPlan', JSON.stringify(payload));
  } catch (err) {
    navLog('warn', 'Failed to persist selectedPlan in localStorage', { error: err?.message, planId, source });
  }

  navLog('debug', 'Persisted plan selection', { planId, source });
}

function attachPlanSelectionHandler(element, planId, source) {
  if (!element || !planId) {
    navLog('debug', 'attachPlanSelectionHandler skipped — missing element or planId', { source });
    return;
  }

  const planSource = source || 'navigation-cta';
  element.dataset.planId = planId;
  element.dataset.planSource = planSource;

  const handler = () => persistSelectedPlan(planId, { source: planSource });
  element.addEventListener('click', handler, { passive: true });
}

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
        <a href="/pricing-a?plan=${targetPlan}" style="
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

  const createVisitorCTA = (isMobile = false) => {
    if (!navConfig?.cta) return null;

    const cta = document.createElement('a');
    updateLink(cta, navConfig.cta.href);
    cta.textContent = navConfig.cta.text;
    cta.className = 'btn btn-primary';
    cta.setAttribute('role', 'button');

    if (isMobile) {
      cta.style.cssText = 'background: #00E676; color: white !important; padding: 0.75rem 0; border-radius: 8px; text-decoration: none; font-weight: 600; display: block; text-align: center; margin-top: 1.5rem;';
    } else {
      cta.style.cssText = 'background: #00E676; color: white !important; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;';
    }

    if (navConfig.cta.planId) {
      const planSource = isMobile ? 'navigation-cta-mobile' : 'navigation-cta-desktop';
      attachPlanSelectionHandler(cta, navConfig.cta.planId, planSource);
    }

    return cta;
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
          // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
          if (dropdownItem.locked === true) {
            // Remove href to prevent navigation even if JavaScript fails
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              navLog('info', 'Locked dropdown link clicked', { 
                text: dropdownItem.text, 
                href: dropdownItem.href,
                currentPlan,
                url: window.location.href 
              });
              showUpgradeModal('essential');
              return false;
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
          // Remove href to prevent navigation even if JavaScript fails
          link.href = '#';
          link.setAttribute('aria-disabled', 'true');
          // Do not fade or reduce opacity; make it a clear button-like link
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            navLog('info', 'Locked link clicked', { text: item.text, href: item.href, plan: currentPlan });
            showUpgradeModal('essential');
            return false;
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
      const ctaLink = createVisitorCTA(false);
      if (ctaLink) {
        navActions.appendChild(ctaLink);
        navLog('info', 'Visitor CTA link created', {
          text: ctaLink.textContent,
          href: ctaLink.href,
          planId: navConfig.cta.planId || null
        });
      }
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
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', `mobile-submenu-${index}`);
        trigger.setAttribute('data-group-index', index.toString());
        
        group.appendChild(trigger);
        const submenu = document.createElement('div');
        submenu.className = 'mobile-nav-submenu';
        submenu.id = `mobile-submenu-${index}`;
        item.items.forEach(dropdownItem => {
          const link = document.createElement('a');
          updateLink(link, dropdownItem.href);
          link.textContent = dropdownItem.text;
          // Only add locked handler if explicitly marked as locked
          // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
          if (dropdownItem.locked === true) {
            // Remove href to prevent navigation even if JavaScript fails
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.classList.add('locked-link');
            link.style.opacity = '1';
            link.style.cursor = 'pointer';
            link.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              navLog('info', 'Mobile locked dropdown link clicked', { text: dropdownItem.text, href: dropdownItem.href });
              showUpgradeModal('essential');
              return false;
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
        // CRITICAL: Use strict equality to prevent issues with truthy non-boolean values
        // Must match desktop regular items check for consistency
        if (item.locked === true) {
          // Remove href to prevent navigation even if JavaScript fails
          link.href = '#';
          link.setAttribute('aria-disabled', 'true');
          link.classList.add('locked-link');
          link.style.opacity = '1';
          link.style.cursor = 'pointer';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            navLog('info', 'Mobile locked link clicked', { text: item.text, href: item.href });
            showUpgradeModal('essential');
            return false;
          });
          link.title = 'Upgrade your plan to unlock this feature.';
        }
        mobileNav.appendChild(link);
        // Removed verbose logging to prevent console spam
      }
    });
    // --- Always append CTA for visitors in mobile nav ---
    if (!isAuthView && navConfig.cta && mobileNav) {
      const cta = createVisitorCTA(true);
      if (cta) {
        mobileNav.appendChild(cta);
        navLog('info', 'Mobile visitor CTA created', {
          text: cta.textContent,
          href: cta.href,
          planId: navConfig.cta.planId || null
        });
      }
    } else if (!mobileNav) {
      navLog('warn', 'mobileNav is null, cannot append CTA for visitors');
    }
    // --- Add Account and Logout to mobile nav for authenticated users ---
    if (isAuthView && navConfig.userNav && navConfig.userNav.menuItems && mobileNav) {
      // Add a separator before user menu items
      const separator = document.createElement('div');
      separator.style.cssText = 'height: 1px; background: #E5E7EB; margin: 1rem 0;';
      mobileNav.appendChild(separator);
      
      navConfig.userNav.menuItems.forEach((menuItem) => {
        const menuLink = document.createElement('a');
        if (menuItem.action === 'logout') {
          menuLink.href = '#';
          menuLink.addEventListener('click', (e) => {
            e.preventDefault();
            navLog('info', 'Mobile user logout clicked');
            logout();
          });
        } else {
          updateLink(menuLink, menuItem.href);
        }
        menuLink.textContent = menuItem.text;
        mobileNav.appendChild(menuLink);
      });
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
  
  // Setup event delegation for mobile nav triggers (works even after navigation rebuilds)
  setupMobileNavDelegation();
  
  // Auto-detect issues after navigation update
  setTimeout(() => {
    autoEnableDebugIfNeeded();
  }, 100);
  
  navLog('info', '=== updateNavigation() COMPLETE ===');
}

// Event delegation for mobile navigation dropdowns
// This ensures clicks work even after navigation is rebuilt
function setupMobileNavDelegation() {
  const mobileNav = document.getElementById('mobileNav');
  if (!mobileNav) return;
  
  // Remove any existing delegation listener to avoid duplicates
  if (mobileNav._delegationHandler) {
    mobileNav.removeEventListener('click', mobileNav._delegationHandler);
  }
  
  // Create new delegation handler
  mobileNav._delegationHandler = function(e) {
    // Check if click is on a mobile nav trigger button
    const trigger = e.target.closest('.mobile-nav-trigger');
    if (!trigger) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const group = trigger.closest('.mobile-nav-group');
    if (!group) return;
    
    const isOpen = group.classList.contains('open');
    
    // Close all other groups
    document.querySelectorAll('.mobile-nav-group.open').forEach(g => {
      if (g !== group) {
        g.classList.remove('open');
        const t = g.querySelector('.mobile-nav-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
    
    // Toggle current group
    if (isOpen) {
      group.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    } else {
      group.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  };
  
  // Attach delegation listener
  mobileNav.addEventListener('click', mobileNav._delegationHandler);
  navLog('debug', 'Mobile nav delegation handler attached');
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
async function initializeNavigation() {
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

  // CRITICAL FIX: For authenticated users, fetch plan before rendering navigation
  // This prevents race condition where navigation shows wrong plan initially
  if (authState.isAuthenticated && window.FirebaseAuthManager?.getCurrentUser) {
    navLog('info', 'Authenticated user detected, fetching plan before navigation render');
    try {
      const user = window.FirebaseAuthManager.getCurrentUser();
      if (user) {
        const token = await user.getIdToken();
        // Fetch plan from API first
        const planRes = await fetch('/api/plan/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (planRes.ok) {
          const planData = await planRes.json();
          if (planData.plan) {
            navLog('info', 'Fetched plan from API, updating localStorage', planData.plan);
            localStorage.setItem('user-plan', planData.plan);
            localStorage.setItem('dev-plan', planData.plan);
            
            // If plan is free, double-check with billing-status as fallback
            if (planData.plan === 'free') {
              navLog('info', 'Plan is free, checking billing-status as fallback');
              const billingRes = await fetch('/api/billing-status', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (billingRes.ok) {
                const billingData = await billingRes.json();
                if (billingData.ok && billingData.plan && billingData.plan !== 'free') {
                  navLog('info', 'Found plan from billing-status fallback, updating', billingData.plan);
                  localStorage.setItem('user-plan', billingData.plan);
                  localStorage.setItem('dev-plan', billingData.plan);
                  // Sync to D1 asynchronously (via sync-stripe-plan which writes to D1)
                  fetch('/api/sync-stripe-plan', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                  }).catch(err => navLog('warn', 'Failed to sync plan to D1 (non-critical):', err));
                }
              }
            }
          } else {
            // plan/me returned successfully but without plan field - use billing-status as fallback
            navLog('info', 'plan/me response missing plan field, checking billing-status as fallback');
            const billingRes = await fetch('/api/billing-status', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (billingRes.ok) {
              const billingData = await billingRes.json();
              if (billingData.ok && billingData.plan) {
                navLog('info', 'Found plan from billing-status fallback (plan/me missing plan)', billingData.plan);
                localStorage.setItem('user-plan', billingData.plan);
                localStorage.setItem('dev-plan', billingData.plan);
                // Sync to KV asynchronously
                fetch('/api/sync-stripe-plan', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` }
                }).catch(err => navLog('warn', 'Failed to sync plan to KV (non-critical):', err));
              }
            }
          }
        } else {
          // plan/me failed - use billing-status as fallback
          navLog('info', 'plan/me request failed, checking billing-status as fallback');
          const billingRes = await fetch('/api/billing-status', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (billingRes.ok) {
            const billingData = await billingRes.json();
            if (billingData.ok && billingData.plan) {
              navLog('info', 'Found plan from billing-status fallback (plan/me failed)', billingData.plan);
              localStorage.setItem('user-plan', billingData.plan);
              localStorage.setItem('dev-plan', billingData.plan);
              // Sync to KV asynchronously
              fetch('/api/sync-stripe-plan', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
              }).catch(err => navLog('warn', 'Failed to sync plan to KV (non-critical):', err));
            }
          }
        }
      }
    } catch (planError) {
      navLog('warn', 'Plan fetch failed (non-critical), continuing with navigation render:', planError);
    }
  }
  
  // Update navigation
  navLog('debug', 'Calling updateNavigation()');
  updateNavigation();
  
  // Ensure mobile nav delegation is set up (in case updateNavigation runs before mobileNav exists)
  // This will be called again in updateNavigation, but this ensures it's ready
  setTimeout(() => {
    setupMobileNavDelegation();
  }, 100);
  
  // REMOVED: Do NOT call reconcilePlanFromAPI() here - it causes race condition
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
  
  // SECURITY FIX: Listen to Firebase auth state changes to keep UI in sync
  // This ensures navigation updates immediately when user logs out in another tab
  if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.onAuthStateChange === 'function') {
    navLog('debug', 'Setting up Firebase auth state listener');
    window.FirebaseAuthManager.onAuthStateChange((user) => {
      const isAuthenticated = !!user;
      const currentAuthState = getAuthState();
      
      // If Firebase says logged out but localStorage says logged in, trust Firebase
      if (!isAuthenticated && currentAuthState.isAuthenticated) {
        navLog('error', 'Firebase auth mismatch: Firebase says logged out, syncing localStorage');
        setAuthState(false, null);
        updateNavigation();
      } else if (isAuthenticated && !currentAuthState.isAuthenticated) {
        // Firebase says logged in - update navigation
        navLog('debug', 'Firebase auth state changed: User logged in, updating navigation');
        updateNavigation();
      }
    });
  }
  
  navLog('info', '=== initializeNavigation() COMPLETE ===');
}

// --- Plan Reconciliation from D1 via API ---
async function fetchPlanFromAPI() {
  try {
    // DEFENSIVE GUARD: Ensure FirebaseAuthManager is loaded
    if (!window.FirebaseAuthManager) {
      console.log('🔍 fetchPlanFromAPI: FirebaseAuthManager not loaded yet, skipping');
      return null;
    }

    // DEFENSIVE GUARD: Wait for auth to be ready if it's still initializing
    if (window.FirebaseAuthManager.waitForAuthReady) {
      try {
        await window.FirebaseAuthManager.waitForAuthReady(1000); // Short timeout
      } catch (e) {
        console.log('🔍 fetchPlanFromAPI: Auth ready timeout, continuing anyway');
      }
    }

    const currentUser = window.FirebaseAuthManager?.getCurrentUser?.();
    if (!currentUser) {
      console.log('🔍 fetchPlanFromAPI: No current user available');
      return null;
    }
    
    const idToken = await currentUser.getIdToken?.();
    if (!idToken) {
      console.log('🔍 fetchPlanFromAPI: No ID token available');
      return null;
    }
    
    console.log('🔍 fetchPlanFromAPI: Fetching plan from D1 via API...');
    const r = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) {
      console.warn(`🔍 fetchPlanFromAPI: API returned ${r.status} ${r.statusText}`);
      return null;
    }
    
    const data = await r.json();
    console.log('🔍 fetchPlanFromAPI: API response:', data);
    
    let plan = data.plan || 'free';
    
    // CRITICAL FIX: If plan is 'free' but user is authenticated, check billing-status as fallback
    // This handles cases where D1 is out of sync with Stripe (shouldn't happen, but safety net)
    if (plan === 'free' && currentUser) {
      console.log('🔍 fetchPlanFromAPI: Plan is free, checking billing-status as fallback...');
      try {
        const billingRes = await fetch('/api/billing-status', { 
          headers: { Authorization: `Bearer ${idToken}` } 
        });
        if (billingRes.ok) {
          const billingData = await billingRes.json();
          if (billingData.ok && billingData.plan && billingData.plan !== 'free') {
            console.log(`🔄 fetchPlanFromAPI: Found plan ${billingData.plan} from billing-status, syncing to D1...`);
            plan = billingData.plan;
            // Sync to D1 (via sync-stripe-plan which writes to D1)
            try {
              const syncRes = await fetch('/api/sync-stripe-plan', {
                method: 'POST',
                headers: { Authorization: `Bearer ${idToken}` }
              });
              if (syncRes.ok) {
                console.log('✅ fetchPlanFromAPI: Plan synced to D1');
              }
            } catch (syncError) {
              console.warn('⚠️ fetchPlanFromAPI: Failed to sync plan to D1:', syncError);
            }
          }
        }
      } catch (billingError) {
        console.warn('⚠️ fetchPlanFromAPI: Failed to check billing-status:', billingError);
      }
    }
    
    // Store trial end date if available
    if (data.trialEndsAt) {
      localStorage.setItem('trial-ends-at', data.trialEndsAt);
    } else {
      localStorage.removeItem('trial-ends-at');
    }
    
    // Update localStorage with correct plan
    localStorage.setItem('user-plan', plan);
    console.log(`✅ fetchPlanFromAPI: Successfully fetched plan from D1: ${plan}`);
    return plan;
  } catch (error) {
    console.warn('❌ fetchPlanFromAPI: Error fetching plan:', error);
    return null;
  }
}

async function reconcilePlanFromAPI() {
  const auth = getAuthState();
  if (!auth.isAuthenticated) {
    console.log('🔍 reconcilePlanFromAPI: User not authenticated, skipping');
    return;
  }
  
  // Check if FirebaseAuthManager is loaded
  if (!window.FirebaseAuthManager) {
    console.log('🔍 reconcilePlanFromAPI: FirebaseAuthManager not loaded, skipping');
    return;
  }
  
  // FIX: Add retry mechanism for plan reconciliation
  let plan = null;
  let retryCount = 0;
  const maxRetries = 3;
  
  console.log('🔍 reconcilePlanFromAPI: Starting plan reconciliation from D1...');
  
  while (!plan && retryCount < maxRetries) {
    try {
      plan = await fetchPlanFromAPI();
      if (plan) {
        console.log(`✅ Plan reconciliation successful on attempt ${retryCount + 1}:`, plan);
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
  if (plan && plan !== current) {
    console.log(`🔄 Updating plan from ${current} to ${plan}`);
    localStorage.setItem('user-plan', plan);
    localStorage.setItem('dev-plan', plan);
    updateNavigation();
    try { new BroadcastChannel('auth').postMessage({ type: 'plan-update', plan: plan }); } catch (_) {}
  } else if (!plan) {
    console.warn('⚠️ Plan reconciliation failed after all retries, keeping current plan:', current);
  }
}

async function waitForPlanActivationIfNeeded() {
  if (!location.search.includes('paid=1')) return;
  const deadline = Date.now() + 10000; // 10s
  while (Date.now() < deadline) {
    await reconcilePlanFromAPI();
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
  fetchPlanFromAPI,
  reconcilePlanFromAPI,
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