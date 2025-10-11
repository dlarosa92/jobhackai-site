/**
 * Login Page Logic with Firebase Authentication
 * Integrates with firebase-auth.js for secure authentication
 */

// Version stamp for deployment verification
console.log('🔧 login-page.js VERSION: redirect-fix-v1 - ' + new Date().toISOString());

import authManager from './firebase-auth.js';

// Helper function to check if plan requires payment
function planRequiresPayment(plan) {
  return ['essential', 'pro', 'premium', 'trial'].includes(plan);
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async function() {
  // Get DOM elements
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const loginLinks = document.getElementById('loginLinks');
  const signupLinks = document.getElementById('signupLinks');
  const showSignUpLink = document.getElementById('showSignUpLink');
  const showLoginLink = document.getElementById('showLoginLink');
  const googleSignInBtn = document.getElementById('googleSignIn');
  const linkedinSignInBtn = document.getElementById('linkedinSignIn');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const authTitle = document.getElementById('auth-title');
  
  // Error display elements
  const loginError = document.getElementById('loginError');
  const signupError = document.getElementById('signupError');
  
  // Check if user is already authenticated (multiple approaches)
  const checkAuth = async () => {
    // Method 1: Check localStorage first (fastest)
    const isAuthInStorage = localStorage.getItem('user-authenticated') === 'true';
    const authUser = localStorage.getItem('auth-user');
    
    if (isAuthInStorage && authUser) {
      console.log('✅ User authenticated (from localStorage), redirecting to dashboard');
      // Add smooth transition with loading state
      document.body.style.opacity = '0.7';
      document.body.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 100);
      return true;
    }
    
    // Method 2: Wait for Firebase auth to be ready with longer timeout
    try {
      console.log('🔍 Checking Firebase auth state...');
      const user = await authManager.waitForAuthReady(5000); // Increased to 5 seconds
      if (user) {
        console.log('✅ User authenticated (from Firebase), redirecting to dashboard');
        // Add smooth transition with loading state
        document.body.style.opacity = '0.7';
        document.body.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 100);
        return true;
      }
    } catch (error) {
      console.log('Firebase auth check timeout, proceeding with login form');
    }
    
    return false;
  };
  
  const isAuthenticated = await checkAuth();
  if (isAuthenticated) return;
  
  // Listen for auth state changes in case user gets authenticated after page load
  const unsubscribe = authManager.onAuthStateChange((user) => {
    if (user) {
      const plan = selectedPlan || localStorage.getItem('selected-plan');
      if (plan && planRequiresPayment(plan)) {
        console.log('✅ Auth changed but paid plan selected, skipping auto-redirect');
        return;
      }
      console.log('✅ Auth state changed: User authenticated, redirecting to dashboard');
      document.body.style.opacity = '0.7';
      document.body.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 200);
      unsubscribe(); // Stop listening after redirect
    }
  });
  
  // Check for selected plan with enhanced validation
  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  const storedSelection = localStorage.getItem('selected-plan');
  const planContext = localStorage.getItem('selected-plan-context');
  const referrer = document.referrer ? new URL(document.referrer) : null;
  const cameFromPricing = !!(referrer && /pricing-(a|b)\.html$/.test(referrer.pathname));
  const cameFromCheckout = !!(referrer && /(checkout)\.html$/.test(referrer.pathname));
  
  // Accept recent plan selections with context validation
  const selectionTs = parseInt(localStorage.getItem('selected-plan-ts') || '0', 10);
  const isFreshSelection = Date.now() - selectionTs < 10 * 60 * 1000; // 10 minutes (increased for better UX)
  const hasValidContext = planContext && ['pricing-a', 'pricing-b', 'checkout'].includes(planContext);
  
  // Priority: URL param > fresh selection with valid context > referrer-based
  const selectedPlan = planParam || 
    ((hasValidContext && isFreshSelection) ? storedSelection : null) ||
    ((cameFromPricing || cameFromCheckout) ? storedSelection : null);
  
  // DEBUG: Log plan detection
  console.log('🔍 Plan Detection Debug:', {
    planParam,
    storedSelection,
    planContext,
    cameFromPricing,
    cameFromCheckout,
    selectionTs,
    isFreshSelection,
    hasValidContext,
    selectedPlan,
    referrer: document.referrer
  });

  // Clear stale selection if it's not fresh and no valid context
  if (!planParam && !cameFromPricing && !cameFromCheckout && storedSelection && (!isFreshSelection || !hasValidContext)) {
    localStorage.removeItem('selected-plan');
    localStorage.removeItem('selected-plan-ts');
    localStorage.removeItem('selected-plan-context');
    console.log('🧹 Cleared stale plan selection');
  }
  
  if (selectedPlan && selectedPlan !== 'create-account') {
    // Store selected plan
    localStorage.setItem('selected-plan', selectedPlan);
    
    // Auto-switch to signup form for new users with plan
    if (!localStorage.getItem('user-email')) {
      showSignupForm(selectedPlan);
    } else {
      // Existing user who somehow landed here - show login
      showLoginForm();
    }
  } else {
    // No explicit plan selected: hide banner and show Login by default
    hideSelectedPlanBanner();
    showLoginForm();
  }
  
  // ===== FORM TOGGLING =====
  showSignUpLink?.addEventListener('click', function(e) {
    e.preventDefault();
    // Preserve plan selection when manually switching to signup
    const currentPlan = localStorage.getItem('selected-plan');
    showSignupForm(currentPlan);
  });
  
  showLoginLink?.addEventListener('click', function(e) {
    e.preventDefault();
    // Clear plan selection when manually switching to login
    localStorage.removeItem('selected-plan');
    showLoginForm();
  });
  
  // ===== GOOGLE SIGN-IN =====
  googleSignInBtn?.addEventListener('click', async function(e) {
    e.preventDefault();
    
    // Show loading state
    const originalText = this.textContent;
    this.textContent = 'Signing in...';
    this.disabled = true;
    
    try {
      const result = await authManager.signInWithGoogle();
      
      if (result.success) {
        // Route based on selected plan
        const plan = selectedPlan || localStorage.getItem('selected-plan') || 'free';
        
        // Show loading state with smooth transition
        document.body.style.opacity = '0.7';
        document.body.style.transition = 'opacity 0.3s ease';
        this.textContent = 'Redirecting...';
        
        // Longer delay to ensure auth state is fully persisted
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (planRequiresPayment(plan)) {
          // Start server-driven checkout; trial requires card
          try {
            const idToken = await authManager.getCurrentUser()?.getIdToken?.(true); // Force refresh
            const res = await fetch('/api/stripe-checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
              body: JSON.stringify({ plan, startTrial: plan === 'trial' })
            });
            const data = await res.json();
            if (data && data.ok && data.url) { 
              console.log('🚀 Redirecting to Stripe checkout:', data.url);
              window.location.href = data.url; 
              return; 
            }
          } catch (error) {
            console.error('Checkout error:', error);
          }
          window.location.href = 'pricing-a.html';
        } else {
          // Free (no subscription) -> take user to dashboard
          localStorage.removeItem('selected-plan');
          localStorage.removeItem('selected-plan-ts');
          localStorage.removeItem('selected-plan-context');
          console.log('🚀 Redirecting to dashboard for free plan');
          window.location.href = 'dashboard.html';
        }
      } else if (result.error) {
        // Show error (but not if user just closed popup)
        showError(loginError, result.error);
        this.textContent = originalText;
        this.disabled = false;
      } else {
        // Silent failure (user closed popup)
        this.textContent = originalText;
        this.disabled = false;
      }
    } catch (error) {
      console.error('Google sign-in error:', error);
      showError(loginError, 'An unexpected error occurred. Please try again.');
      this.textContent = originalText;
      this.disabled = false;
    }
  });
  
  // ===== LinkedIn SIGN-IN (NOT YET IMPLEMENTED) =====
  linkedinSignInBtn?.addEventListener('click', function(e) {
    e.preventDefault();
    showError(loginError, 'LinkedIn sign-in coming soon! Please use Google or email/password.');
  });
  
  // ===== EMAIL/PASSWORD LOGIN =====
  loginForm?.addEventListener('submit', async function(e) {
    e.preventDefault();
    hideError(loginError);
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const submitBtn = document.getElementById('loginContinueBtn');
    
    // Validation
    if (!email || !password) {
      showError(loginError, 'Please enter both email and password.');
      return;
    }
    
    if (!isValidEmail(email)) {
      showError(loginError, 'Please enter a valid email address.');
      return;
    }
    
    // Show loading state
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Signing in...';
    submitBtn.disabled = true;
    
    try {
      const result = await authManager.signIn(email, password);
      
      if (result.success) {
        // Route based on selected plan
        const plan = selectedPlan || 'free';
        if (planRequiresPayment(plan)) {
          try {
            const idToken = await authManager.getCurrentUser()?.getIdToken?.();
            const res = await fetch('/api/stripe-checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
              body: JSON.stringify({ plan, startTrial: plan === 'trial' })
            });
            const data = await res.json();
            if (data && data.ok && data.url) { window.location.href = data.url; return; }
          } catch (_) {}
          window.location.href = 'pricing-a.html';
        } else {
          localStorage.removeItem('selected-plan');
          // Route free users to onboarding
          if (plan === 'free') {
            // Take user to dashboard (no subscription yet)
            window.location.href = 'dashboard.html';
          } else {
            window.location.href = 'dashboard.html';
          }
        }
      } else {
        // Show error
        showError(loginError, result.error);
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    } catch (error) {
      console.error('Login error:', error);
      showError(loginError, 'An unexpected error occurred. Please try again.');
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });
  
  // ===== EMAIL/PASSWORD SIGNUP =====
  signupForm?.addEventListener('submit', async function(e) {
    e.preventDefault();
    hideError(signupError);
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();
    const submitBtn = document.getElementById('signupContinueBtn');
    
    // Validation
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      showError(signupError, 'Please fill in all fields.');
      return;
    }
    
    if (!isValidEmail(email)) {
      showError(signupError, 'Please enter a valid email address.');
      return;
    }
    
    if (password.length < 8) {
      showError(signupError, 'Password must be at least 8 characters long.');
      return;
    }
    
    if (password !== confirmPassword) {
      showError(signupError, 'Passwords do not match.');
      return;
    }
    
    // Password strength check
    if (!isStrongPassword(password)) {
      showError(signupError, 'Password must include at least one uppercase letter, one lowercase letter, and one number.');
      return;
    }
    
    // Show loading state
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Creating account...';
    submitBtn.disabled = true;
    
    try {
      const result = await authManager.signUp(email, password, firstName, lastName);
      
      if (result.success) {
        // Check if plan requires payment
        const plan = selectedPlan || 'free';
        
        if (planRequiresPayment(plan)) {
          try {
            const idToken = await authManager.getCurrentUser()?.getIdToken?.();
            const res = await fetch('/api/stripe-checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
              body: JSON.stringify({ plan, startTrial: plan === 'trial' })
            });
            const data = await res.json();
            if (data && data.ok && data.url) { window.location.href = data.url; return; }
          } catch (_) {}
          window.location.href = 'pricing-a.html';
        } else {
          // Success! Redirect to dashboard
          localStorage.removeItem('selected-plan');
          window.location.href = 'dashboard.html';
        }
      } else {
        // Show error
        showError(signupError, result.error);
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    } catch (error) {
      console.error('Signup error:', error);
      showError(signupError, 'An unexpected error occurred. Please try again.');
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });
  
  // ===== FORGOT PASSWORD =====
  forgotPasswordLink?.addEventListener('click', async function(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim();
    
    if (!email) {
      showError(loginError, 'Please enter your email address first.');
      return;
    }
    
    if (!isValidEmail(email)) {
      showError(loginError, 'Please enter a valid email address.');
      return;
    }
    
    // Show confirmation dialog
    const confirmed = confirm(`Send password reset email to ${email}?`);
    
    if (confirmed) {
      try {
        const result = await authManager.resetPassword(email);
        
        if (result.success) {
          alert(`Password reset email sent to ${email}. Please check your inbox.`);
          hideError(loginError);
        } else {
          showError(loginError, result.error);
        }
      } catch (error) {
        console.error('Password reset error:', error);
        showError(loginError, 'An unexpected error occurred. Please try again.');
      }
    }
  });
  
  // ===== HELPER FUNCTIONS =====
  
  function showSignupForm(planOverride = null) {
    loginForm.style.display = 'none';
    loginLinks.style.display = 'none';
    signupForm.style.display = 'flex';
    signupLinks.style.display = 'block';
    hideError(loginError);
    hideError(signupError);
    
    // Show banner only when plan is explicitly selected and equals 'trial' or paid
    const plan = planOverride || localStorage.getItem('selected-plan');
    
    // Update title based on plan context
    const planNames = {
      'trial': '3-Day Free Trial',
      'essential': 'Essential Plan',
      'pro': 'Pro Plan',
      'premium': 'Premium Plan',
      'free': 'Free Account'
    };
    
    // DEBUG: Log plan processing
    console.log('🎯 showSignupForm Debug:', {
      planOverride,
      plan,
      planNames: planNames[plan],
      authTitle: authTitle.textContent
    });
    
    if (plan && planNames[plan]) {
      if (plan === 'free') {
        authTitle.textContent = 'Create your free account';
        showSelectedPlanBanner(plan);  // Show banner for free account too
        console.log('✅ Showing free account form with banner');
      } else {
        authTitle.textContent = `Sign up for ${planNames[plan]}`;
        showSelectedPlanBanner(plan);
        console.log('✅ Showing plan banner for:', plan);
      }
    } else {
      authTitle.textContent = 'Create your account';
      hideSelectedPlanBanner();
      console.log('⚠️ No plan detected, showing generic form');
    }
  }
  
  function showLoginForm() {
    signupForm.style.display = 'none';
    signupLinks.style.display = 'none';
    loginForm.style.display = 'flex';
    loginLinks.style.display = 'block';
    authTitle.textContent = 'Welcome back';
    hideError(loginError);
    hideError(signupError);
    
    // Login never shows a plan banner
    hideSelectedPlanBanner();
  }
  
  function showSelectedPlanBanner(plan) {
    const banner = document.getElementById('selectedPlanBanner');
    const planName = document.getElementById('selectedPlanName');
    const planPrice = document.getElementById('selectedPlanPrice');
    
    const planNames = {
      'trial': '3-Day Free Trial',
      'essential': 'Essential Plan',
      'pro': 'Pro Plan',
      'premium': 'Premium Plan',
      'free': 'Free Account'
    };
    
    const planPrices = {
      'trial': '$0 for 3 days',
      'essential': '$29/mo',
      'pro': '$59/mo',
      'premium': '$99/mo',
      'free': '$0/mo'
    };
    
    if (banner && planName && planPrice) {
      if (!plan) {
        banner.style.display = 'none';
        return;
      }
      planName.textContent = planNames[plan] || 'Selected Plan';
      planPrice.textContent = planPrices[plan] || '$0/mo';
      banner.style.display = 'block';
    }
  }

  function hideSelectedPlanBanner() {
    const banner = document.getElementById('selectedPlanBanner');
    if (banner) {
      banner.style.display = 'none';
      // Also clear any text to avoid confusion in screen readers
      const planName = document.getElementById('selectedPlanName');
      const planPrice = document.getElementById('selectedPlanPrice');
      if (planName) planName.textContent = '';
      if (planPrice) planPrice.textContent = '';
    }
  }
  
  function showError(errorElement, message) {
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      errorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  function hideError(errorElement) {
    if (errorElement) {
      errorElement.style.display = 'none';
      errorElement.textContent = '';
    }
  }
  
  function isValidEmail(email) {
    // RFC 5322 compliant email regex (simplified)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  function isStrongPassword(password) {
    // At least one uppercase, one lowercase, one number
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    
    return hasUppercase && hasLowercase && hasNumber;
  }
  
});

// Hamburger menu toggle
const mobileToggle = document.querySelector('.mobile-toggle');
const mobileNav = document.getElementById('mobileNav');
if (mobileToggle && mobileNav) {
  mobileToggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    mobileToggle.setAttribute('aria-expanded', isOpen);
  });
  document.querySelectorAll('.mobile-nav a').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      mobileToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

