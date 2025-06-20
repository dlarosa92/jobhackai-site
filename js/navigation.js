// JobHackAI Navigation System
// Handles dynamic navigation based on user plan and Dev Only Plan toggle

// --- PLAN CONFIGURATION ---
const PLANS = {
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
      { text: 'What You Get', href: '#what-you-get' },
      { text: 'Pricing', href: 'pricing-a.html' },
      { text: 'Blog', href: '#blog' },
      { text: 'Login', href: 'login.html' },
      { text: 'Start Free Trial', href: 'pricing-a.html', isCTA: true }
    ]
  },
  // Free Account (no plan)
  free: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'ATS Scoring', href: 'dashboard.html#ats' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html', locked: true },
      { text: 'Interview Questions', href: 'interview-questions.html', locked: true },
    ],
    userNav: {
      cta: { text: 'Pricing/Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: 'login.html' }
      ]
    }
  },
  // 3-Day Trial
  trial: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'ATS Scoring', href: 'dashboard.html#ats' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' },
    ],
    userNav: {
      cta: { text: 'Pricing/Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: 'login.html' }
      ]
    }
  },
  // Basic $29
  essential: {
    navItems: [
      { text: 'Dashboard', href: 'dashboard.html' },
      { text: 'ATS Scoring', href: 'dashboard.html#ats' },
      { text: 'Resume Feedback', href: 'resume-feedback-pro.html' },
      { text: 'Interview Questions', href: 'interview-questions.html' },
    ],
    userNav: {
      cta: { text: 'Upgrade', href: 'pricing-a.html', isCTA: true },
      menuItems: [
        { text: 'Account', href: 'account-setting.html' },
        { text: 'Logout', href: 'login.html' }
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
          { text: 'ATS Scoring', href: 'dashboard.html#ats' },
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
        { text: 'Logout', href: 'login.html' }
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
          { text: 'ATS Scoring', href: 'dashboard.html#ats' },
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
        { text: 'Logout', href: 'login.html' }
      ]
    }
  }
};

// --- UTILITY FUNCTIONS ---
function getCurrentPlan() {
  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');

  // If a plan is explicitly in the URL, it has the highest priority.
  // We make it sticky for subsequent navigation.
  if (planParam && PLANS[planParam]) {
    localStorage.setItem('dev-plan', planParam);
    return planParam;
  }

  // Determine if we are on the homepage.
  const isHomePage = window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/index.html') || window.location.pathname.endsWith('/jobhackai-site/');

  // If on the homepage and no plan is specified in the URL,
  // we reset to the default 'visitor' state and clear any sticky plan.
  if (isHomePage) {
    localStorage.removeItem('dev-plan');
    return 'visitor';
  }

  // For any other page, we check for a sticky plan from previous sessions.
  const devPlan = localStorage.getItem('dev-plan');
  if (devPlan) {
    return devPlan;
  }

  // If no other rules match, default to visitor.
  return 'visitor';
}

function setPlan(plan) {
  if (PLANS[plan]) {
    localStorage.setItem('dev-plan', plan);
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('plan', plan);
    window.history.replaceState({}, '', url);
    updateNavigation();
  }
}

function isFeatureUnlocked(featureKey) {
  const currentPlan = getCurrentPlan();
  if (currentPlan === 'visitor') return false;
  
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

// --- NAVIGATION RENDERING ---
function updateNavigation() {
  const currentPlan = getCurrentPlan();
  const navConfig = NAVIGATION_CONFIG[currentPlan] || NAVIGATION_CONFIG.visitor;
  const navGroup = document.querySelector('.nav-group');

  const updateLink = (linkElement, href) => {
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) {
      linkElement.href = href;
    } else {
      const url = new URL(href, window.location.href);
      if (currentPlan !== 'visitor') {
        url.searchParams.set('plan', currentPlan);
      } else {
        url.searchParams.delete('plan');
      }
      linkElement.href = url.href;
    }
  };

  // --- Clear old elements ---
  const oldNavLinks = document.querySelector('.nav-links');
  if (oldNavLinks) oldNavLinks.innerHTML = '';
  const oldNavActions = document.querySelector('.nav-actions');
  if (oldNavActions) oldNavActions.remove();

  // --- Build Nav Links ---
  const navLinks = document.querySelector('.nav-links');
  if (navLinks && navConfig.navItems) {
    navConfig.navItems.forEach(item => {

      if (item.isDropdown) {
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
        });

        dropdownContainer.appendChild(toggle);
        dropdownContainer.appendChild(dropdownMenu);
        navLinks.appendChild(dropdownContainer);
        
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Close other dropdowns
          document.querySelectorAll('.nav-dropdown.open').forEach(d => {
            if (d !== dropdownContainer) d.classList.remove('open');
          });
          dropdownContainer.classList.toggle('open');
        });

      } else {
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;

        if (item.locked) {
          link.innerHTML += ' 🔒';
          link.style.opacity = '0.6';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            showUpgradeModal();
          });
        }
        if (item.isCTA) {
          link.classList.add('cta-button');
        }
        navLinks.appendChild(link);
      }
    });
  }

  // --- Build User Navigation ---
  if (navGroup && navConfig.userNav) {
    let navActions = document.createElement('div');
    navActions.className = 'nav-actions';

    // Build CTA
    if (navConfig.userNav.cta) {
      const ctaLink = document.createElement('a');
      updateLink(ctaLink, navConfig.userNav.cta.href);
      ctaLink.textContent = navConfig.userNav.cta.text;
      ctaLink.classList.add('cta-button');
      navActions.appendChild(ctaLink);
    }

    // Build User Menu
    if (navConfig.userNav.menuItems) {
      const userMenuContainer = document.createElement('div');
      userMenuContainer.className = 'user-menu';

      const toggle = document.createElement('button');
      toggle.className = 'user-menu-toggle';
      toggle.setAttribute('aria-label', 'Open user menu');
      toggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="user-menu-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
      
      const dropdownMenu = document.createElement('div');
      dropdownMenu.className = 'user-menu-dropdown';

      navConfig.userNav.menuItems.forEach(item => {
        const link = document.createElement('a');
        updateLink(link, item.href);
        link.textContent = item.text;
        dropdownMenu.appendChild(link);
      });

      userMenuContainer.appendChild(toggle);
      userMenuContainer.appendChild(dropdownMenu);
      navActions.appendChild(userMenuContainer);
      
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        userMenuContainer.classList.toggle('open');
      });
    }
    
    if (navGroup.parentElement.contains(navGroup)) {
      navGroup.appendChild(navActions);
    }
  }

  // --- Build Mobile Navigation ---
  const mobileNav = document.getElementById('mobileNav');
  if (mobileNav) {
    mobileNav.innerHTML = '';
    let mobileNavItems = [];

    if (navConfig.navItems) {
      mobileNavItems.push(...navConfig.navItems);
    }
    if (navConfig.userNav && navConfig.userNav.menuItems) {
      mobileNavItems.push(...navConfig.userNav.menuItems);
    }
    if (navConfig.userNav && navConfig.userNav.cta) {
      // Add the CTA button last on mobile
      mobileNavItems.push(navConfig.userNav.cta);
    }

    mobileNavItems.forEach(item => {
      const link = document.createElement('a');
      updateLink(link, item.href);
      link.textContent = item.text;
      
      if (item.locked) {
        link.innerHTML += ' 🔒';
        link.style.opacity = '0.6';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          showUpgradeModal();
        });
      }
      
      if (item.isCTA) {
        link.classList.add('cta-button');
      }
      
      mobileNav.appendChild(link);
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-dropdown.open, .user-menu.open').forEach(openDropdown => {
      if (!openDropdown.contains(e.target)) {
        openDropdown.classList.remove('open');
      }
    });
  });
  
  // Update Dev Only Plan toggle
  updateDevPlanToggle();
}

function updateDevPlanToggle() {
  const devPlanToggle = document.getElementById('dev-plan-toggle');
  if (devPlanToggle) {
    const select = devPlanToggle.querySelector('#dev-plan');
    if (select) {
      select.value = getCurrentPlan();
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
  
  toggle.innerHTML = `
    <span style="font-weight: 700; color: #1976D2;">DEV ONLY</span>
    <label for="dev-plan" style="font-weight: 600; color: #4B5563;">Plan:</label>
    <select id="dev-plan" style="font-size: 1rem; padding: 0.2rem 0.7rem; border-radius: 6px; border: 1px solid #E5E7EB;">
      <option value="visitor">Visitor</option>
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
  // Add Dev Only Plan toggle if not already present
  if (!document.getElementById('dev-plan-toggle')) {
    const toggle = createDevPlanToggle();
    document.body.appendChild(toggle);
  }
  
  // Update navigation based on current plan
  updateNavigation();
  
  // Add event listeners for locked features
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href.includes('linkedin-optimizer.html') && !isFeatureUnlocked('linkedin')) {
      e.preventDefault();
      showUpgradeModal('premium');
    }
  });
}

// --- EXPORT FOR GLOBAL USE ---
window.JobHackAINavigation = {
  getCurrentPlan,
  setPlan,
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