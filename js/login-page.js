/**
 * Login Page Logic with Firebase Authentication
 * Integrates with firebase-auth.js for secure authentication
 */

// Version stamp for deployment verification
console.log('🔧 login-page.js VERSION: redirect-fix-v2 - ' + new Date().toISOString());

import authManager from './firebase-auth.js';
import { waitForAuthReady } from './firebase-auth.js';

// Helper function to check if plan requires payment
function planRequiresPayment(plan) {
  return ['essential', 'pro', 'premium', 'trial'].includes(plan);
}

// Unified post-auth redirect helper (Stripe or Dashboard)
async function handlePostAuthRedirect(plan) {
  if (planRequiresPayment(plan)) {
    try {
      const idToken = await authManager.getCurrentUser()?.getIdToken?.(true);
      const res = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ plan, startTrial: plan === 'trial' })
      });
      const data = await res.json();
      if (data && data.ok && data.url) { window.location.href = data.url; return; }
    } catch (error) {
      console.error('Checkout error:', error);
    }
    window.location.href = 'pricing-a.html';
  } else {
    localStorage.removeItem('selected-plan');
    localStorage.removeItem('selected-plan-ts');
    localStorage.removeItem('selected-plan-context');
    window.location.href = 'dashboard.html';
  }
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🧭 login-page.js v2 starting');

  // Prevent bounce if coming from logout
  if (sessionStorage.getItem('logout-intent') === '1') {
    console.log('🚫 Logout intent detected — staying on login');
    sessionStorage.removeItem('logout-intent');
    return;
  }

  // Prevent auto-redirect races when user is actively logging in
  let loginInProgress = false;
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
  const forgotPasswordOverlay = document.getElementById('forgotPasswordOverlay');
  const forgotPasswordEmailInput = document.getElementById('forgotPasswordEmail');
  const forgotPasswordSendBtn = document.getElementById('forgotPasswordSendBtn');
  const forgotPasswordCloseBtn = document.getElementById('forgotPasswordCloseBtn');
  const forgotPasswordError = document.getElementById('forgotPasswordError');
  const forgotPasswordSuccess = document.getElementById('forgotPasswordSuccess');
  
  // Error display elements
  const loginError = document.getElementById('loginError');
  const signupError = document.getElementById('signupError');
  
  // Check if user is already authenticated (multiple approaches)
  const checkAuth = async () => {
    if (loginInProgress) {
      console.log('⏸️ Login in progress, skipping auto-redirect');
      return false;
    }

    // ONLY check Firebase, not localStorage
    try {
      console.log('🔍 Checking Firebase auth state...');
      const user = await waitForAuthReady(4000);
      if (user && user.email) {
        console.log(`✅ Authenticated as ${user.email}, redirecting to dashboard`);
        location.replace('/dashboard.html');
        return true;
      } else {
        console.log('🔓 No authenticated user — showing login UI');
      }
    } catch (error) {
      console.log('No Firebase user, proceeding with login form');
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
    loginInProgress = true;
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
    } finally { loginInProgress = false; }
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
        const signedInUser = authManager.getCurrentUser();
        if (signedInUser && authManager.isEmailPasswordUser(signedInUser) && signedInUser.emailVerified === false) {
          window.location.href = 'verify-email.html';
          return;
        }
        const plan = selectedPlan || 'free';
        await handlePostAuthRedirect(plan);
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
        const newUser = authManager.getCurrentUser();
        if (newUser && authManager.isEmailPasswordUser(newUser) && newUser.emailVerified === false) {
          window.location.href = 'verify-email.html';
          return;
        }
        const plan = selectedPlan || 'free';
        await handlePostAuthRedirect(plan);
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
  
  // ===== FORGOT PASSWORD (MODAL) =====
  forgotPasswordLink?.addEventListener('click', function(e) {
    e.preventDefault();
    hideError(loginError);
    if (forgotPasswordOverlay) forgotPasswordOverlay.style.display = 'flex';
    const currentLoginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
    if (forgotPasswordEmailInput) forgotPasswordEmailInput.value = currentLoginEmail;
    if (forgotPasswordError) { forgotPasswordError.style.display = 'none'; forgotPasswordError.textContent = ''; }
    if (forgotPasswordSuccess) { forgotPasswordSuccess.style.display = 'none'; }
  });

  forgotPasswordSendBtn?.addEventListener('click', async function() {
    const email = forgotPasswordEmailInput?.value?.trim();
    if (!email || !isValidEmail(email)) {
      if (forgotPasswordError) {
        forgotPasswordError.textContent = 'Please enter a valid email address.';
        forgotPasswordError.style.display = 'block';
      }
      if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
      return;
    }
    const result = await authManager.resetPassword(email);
    if (result.success) {
      if (forgotPasswordError) { forgotPasswordError.style.display = 'none'; forgotPasswordError.textContent = ''; }
      if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'block';
    } else {
      if (forgotPasswordError) {
        forgotPasswordError.textContent = result.error || 'Something went wrong. Please try again.';
        forgotPasswordError.style.display = 'block';
      }
      if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
    }
  });

  function closeForgotOverlay() {
    if (forgotPasswordOverlay) forgotPasswordOverlay.style.display = 'none';
  }

  forgotPasswordCloseBtn?.addEventListener('click', function() { closeForgotOverlay(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && forgotPasswordOverlay && forgotPasswordOverlay.style.display === 'flex') {
      closeForgotOverlay();
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
      const finalPlanName = planNames[plan] || 'Selected Plan';
      const finalPlanPrice = planPrices[plan] || '$0/mo';
      planName.textContent = finalPlanName;
      planPrice.textContent = finalPlanPrice;
      banner.style.display = 'block';
      
      // Debug trace for plan banner rendering
      console.trace('selectedPlanBanner:', { planName: finalPlanName, planPrice: finalPlanPrice, plan });
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
  
  // ===== PASSWORD TOGGLE FUNCTIONALITY =====
  
  // Helper function to toggle password visibility
  function setupPasswordToggle(buttonId, inputId, iconId) {
    const toggleBtn = document.getElementById(buttonId);
    const passwordInput = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    
    if (!toggleBtn || !passwordInput || !icon) return;
    
    const togglePassword = () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      
      // Update icon based on visibility
      if (isPassword) {
        // Show eye-off icon (crossed out eye)
        icon.innerHTML = `
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        `;
      } else {
        // Show eye icon
        icon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        `;
      }
    };
    
    // Click handler
    toggleBtn.addEventListener('click', togglePassword);
    
    // Keyboard handler (Enter and Space)
    toggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePassword();
      }
    });
  }
  
  // Setup toggles for all password fields
  setupPasswordToggle('toggleLoginPassword', 'loginPassword', 'loginPasswordEyeIcon');
  setupPasswordToggle('toggleSignupPassword', 'signupPassword', 'signupPasswordEyeIcon');
  setupPasswordToggle('toggleConfirmPassword', 'confirmPassword', 'confirmPasswordEyeIcon');
  
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

