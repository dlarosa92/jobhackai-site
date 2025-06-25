// JobHackAI Navigation System
// Handles dynamic navigation based on authentication state and user plan

// --- AUTHENTICATION STATE MANAGEMENT ---
function getAuthState() {
  // Check for actual authentication (this would integrate with Firebase Auth)
  // For now, we'll use localStorage as a placeholder
  const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
  const userPlan = localStorage.getItem('user-plan') || 'free';
  
  return {
    isAuthenticated,
    userPlan: isAuthenticated ? userPlan : null
  };
}

function setAuthState(isAuthenticated, plan = null) {
  localStorage.setItem('user-authenticated', isAuthenticated.toString());
  if (plan) {
    localStorage.setItem('user-plan', plan);
  }
}

function logout() {
  localStorage.removeItem('user-authenticated');
  localStorage.removeItem('user-plan');
  localStorage.removeItem('dev-plan'); // Clear dev toggle too
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
    return 'visitor';
  }
  
  // If user is authenticated, use their plan
  if (authState.userPlan && PLANS[authState.userPlan]) {
    return authState.userPlan;
  }
  
  // Fallback to free plan for authenticated users
  return 'free';
}

// Dev toggle override (for development/testing only)
function getDevPlanOverride() {
  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  
  if (planParam && PLANS[planParam]) {
    localStorage.setItem('dev-plan', planParam);
    return planParam;
  }
  
  const devPlan = localStorage.getItem('dev-plan');
  if (devPlan && PLANS[devPlan]) {
    return devPlan;
  }
  
  return null;
}

function getEffectivePlan() {
  const authState = getAuthState();
  const devOverride = getDevPlanOverride();
  
  // If user is not authenticated, they can only be visitor
  if (!authState.isAuthenticated) {
    return devOverride || 'visitor';
  }
  
  // If user is authenticated, dev override takes precedence for testing
  if (devOverride) {
    return devOverride;
  }
  
  // Otherwise use their actual plan
  return authState.userPlan || 'free';
}

function setPlan(plan) {
  if (PLANS[plan]) {
    localStorage.setItem('dev-plan', plan);
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('plan', plan);
    window.history.replaceState({}, '', url);
    updateNavigation();
    updateDevPlanToggle();
  }
}

function isFeatureUnlocked(featureKey) {
  const authState = getAuthState();
  const currentPlan = getEffectivePlan();
  
  // Visitors can't access any features
  if (!authState.isAuthenticated && currentPlan === 'visitor') {
    return false;
  }
  
  const planConfig = PLANS[currentPlan];
  return planConfig && planConfig.features.includes(featureKey);
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

// Add logging utility
function navLog(...args) {
  console.log('[NAV LOG]', ...args);
}

// --- NAVIGATION RENDERING ---
function updateNavigation() {
  navLog('--- updateNavigation called ---');
  const devOverride = getDevPlanOverride();
  const currentPlan = getEffectivePlan();
  const authState = getAuthState();
  navLog('Plan detection', { devOverride, currentPlan, authState });
  const navConfig = NAVIGATION_CONFIG[currentPlan] || NAVIGATION_CONFIG.visitor;
  navLog('Using nav config for plan:', currentPlan, navConfig);
  const navGroup = document.querySelector('.nav-group');

  // Determine if we should show an authenticated-style header
  const isAuthView = authState.isAuthenticated || (devOverride && devOverride !== 'visitor');
  navLog('isAuthView:', isAuthView);

  // --- Link helper: always use relative paths for internal links ---
  const updateLink = (linkElement, href) => {
    navLog('Creating link', { text: linkElement.textContent, href });
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) {
      linkElement.href = href;
    } else {
      // Always use relative path for internal navigation
      linkElement.href = href;
    }
    navLog('Link set', linkElement.href);
  };

  // --- Clear old elements ---
  const oldNavLinks = document.querySelector('.nav-links');
  if (oldNavLinks) oldNavLinks.innerHTML = '';
  const oldNavActions = document.querySelector('.nav-actions');
  if (oldNavActions) oldNavActions.remove();
  const mobileNav = document.getElementById('mobileNav');
  if (mobileNav) mobileNav.innerHTML = '';

  // --- Build Nav Links (Desktop) ---
  const navLinks = document.querySelector('.nav-links');
  if (navLinks && navConfig.navItems) {
    navLog('Building nav links for plan:', currentPlan);
    navConfig.navItems.forEach(item => {
      navLog('Processing nav item:', item);
      // For visitor view, the CTA is inside navItems, so handle it here
      if (item.isCTA && !isAuthView) {
        const navActions = document.querySelector('.nav-actions') || document.createElement('div');
        navActions.className = 'nav-actions';
        const ctaLink = document.createElement('a');
        updateLink(ctaLink, item.href);
        ctaLink.textContent = item.text;
        ctaLink.className = 'btn btn-primary';
        navActions.appendChild(ctaLink);
        if(!document.querySelector('.nav-actions')) navGroup.appendChild(navActions);
        navLog('Added CTA link:', ctaLink.textContent, ctaLink.href);
      } else if (!item.isCTA) {
        if (item.isDropdown) {
          navLog('Creating dropdown:', item.text);
          const dropdownContainer = document.createElement('div');
          dropdownContainer.className = 'nav-dropdown';

          const toggle = document.createElement('a');
          toggle.href = '#';
          toggle.className = 'nav-dropdown-toggle';
          toggle.innerHTML = `${item.text} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropdown-arrow"><path d="m6 9 6 6 6-6"/></svg>`;
          
          const dropdownMenu = document.createElement('div');
          dropdownMenu.className = 'nav-dropdown-menu';

          item.items.forEach(dropdownItem => {
            const link = document.createElement('a');
            updateLink(link, dropdownItem.href);
            link.textContent = dropdownItem.text;
            dropdownMenu.appendChild(link);
            navLog('Dropdown link:', link.textContent, link.href);
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
            navLog('Dropdown toggled:', item.text, dropdownContainer.classList.contains('open'));
          });
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
              navLog('Locked link clicked:', item.text);
              showUpgradeModal('essential'); // or appropriate plan
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          navLinks.appendChild(link);
          navLog('Nav link:', link.textContent, link.href);
        }
      }
    });
  }

  // --- Build Mobile Nav ---
  if (mobileNav && navConfig.navItems) {
    navLog('Building mobile nav links for plan:', currentPlan);
    navConfig.navItems.forEach(item => {
      if (item.isCTA && !isAuthView) {
        const ctaLink = document.createElement('a');
        updateLink(ctaLink, item.href);
        ctaLink.textContent = item.text;
        ctaLink.className = 'btn btn-primary';
        mobileNav.appendChild(ctaLink);
      } else if (!item.isCTA) {
        if (item.isDropdown) {
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
              showUpgradeModal('essential');
            });
            link.title = 'Upgrade your plan to unlock this feature.';
          }
          mobileNav.appendChild(link);
        }
      }
    });
  }

  // --- Build User Navigation (if authenticated view) ---
  if (isAuthView && navConfig.userNav) {
    navLog('Building user nav actions');
    const navActions = document.querySelector('.nav-actions') || document.createElement('div');
    navActions.className = 'nav-actions';

    // CTA Button (if exists)
    if (navConfig.userNav.cta) {
      const ctaLink = document.createElement('a');
      updateLink(ctaLink, navConfig.userNav.cta.href);
      ctaLink.textContent = navConfig.userNav.cta.text;
      ctaLink.className = 'btn btn-primary';
      navActions.appendChild(ctaLink);
      navLog('User nav CTA:', ctaLink.textContent, ctaLink.href);
    }

    // User Menu
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

    navConfig.userNav.menuItems.forEach(menuItem => {
      const menuLink = document.createElement('a');
      if (menuItem.action === 'logout') {
        menuLink.href = '#';
        menuLink.addEventListener('click', (e) => {
          e.preventDefault();
          navLog('Logout clicked');
          logout();
        });
      } else {
        updateLink(menuLink, menuItem.href);
      }
      menuLink.textContent = menuItem.text;
      userDropdown.appendChild(menuLink);
      navLog('User menu item:', menuItem.text, menuLink.href);
    });

    userMenu.appendChild(userToggle);
    userMenu.appendChild(userDropdown);
    navActions.appendChild(userMenu);

    userToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      userMenu.classList.toggle('open');
      navLog('User menu toggled:', userMenu.classList.contains('open'));
    });

    if(!document.querySelector('.nav-actions')) navGroup.appendChild(navActions);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown') && !e.target.closest('.nav-user-menu')) {
      document.querySelectorAll('.nav-dropdown.open, .nav-user-menu.open').forEach(d => {
        d.classList.remove('open');
      });
      navLog('Closed all dropdowns/menus');
    }
  });
}

function updateDevPlanToggle() {
  const devPlanToggle = document.getElementById('dev-plan-toggle');
  if (devPlanToggle) {
    const select = devPlanToggle.querySelector('#dev-plan');
    if (select) {
      select.value = getEffectivePlan();
    }
  }
}

// --- DEV ONLY PLAN TOGGLE ---
function createDevPlanToggle() {
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
    setPlan(e.target.value);
  });
  
  // On first load, set to visitor if not already set
  if (!localStorage.getItem('dev-plan')) {
    setPlan('visitor');
    select.value = 'visitor';
  }

  return toggle;
}

// --- FEATURE ACCESS CONTROL ---
function checkFeatureAccess(featureKey, targetPlan = 'premium') {
  if (!isFeatureUnlocked(featureKey)) {
    showUpgradeModal(targetPlan);
    return false;
  }
  return true;
}

// --- INITIALIZATION ---
function initializeNavigation() {
  // Create dev plan toggle and append to document
  const toggle = createDevPlanToggle();
  document.body.appendChild(toggle);
  
  // Update navigation
  updateNavigation();
  
  // Update dev toggle state
  updateDevPlanToggle();
  
  // Listen for plan changes
  window.addEventListener('storage', (e) => {
    if (e.key === 'dev-plan') {
      updateNavigation();
      updateDevPlanToggle();
    }
  });
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNavigation);
} else {
  initializeNavigation();
} 