/**
 * Login Page Logic with Firebase Authentication
 * Integrates with firebase-auth.js for secure authentication
 */

// Version stamp for deployment verification
console.log('🔧 login-page.js VERSION: redirect-fix-v2 - ' + new Date().toISOString());

import authManager from './firebase-auth.js';
import { waitForAuthReady } from './firebase-auth.js';

// Helper function to check if plan requires payment (only for NEW signups, not existing subscribers)
function planRequiresPayment(plan) {
  // Only redirect to checkout if the user just selected a plan from pricing page
  // Check if there's a fresh plan selection (within last 5 minutes)
  try {
    const stored = sessionStorage.getItem('selectedPlan');
    if (stored) {
      const data = JSON.parse(stored);
      const timestamp = data.timestamp || 0;
      const isFreshSelection = Date.now() - timestamp < 5 * 60 * 1000; // 5 minutes
      if (isFreshSelection && ['essential', 'pro', 'premium', 'trial'].includes(plan)) {
        return true;
      }
    }
  } catch (e) {
    console.warn('Error checking plan selection:', e);
  }
  // If no fresh selection, don't require payment (user already has subscription or is free)
  return false;
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
    sessionStorage.removeItem('selectedPlan');
    window.location.href = 'dashboard.html';
  }
}

// Safe fallback initialization when main init fails
function safeFallbackInit() {
  console.error('[AUTH INIT ERROR] Main initialization failed, using fallback');
  
  try {
    // Force login form visible
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const loginLinks = document.getElementById('loginLinks');
    const signupLinks = document.getElementById('signupLinks');
    const authTitle = document.getElementById('auth-title');
    const banner = document.getElementById('selectedPlanBanner');
    
    if (loginForm) loginForm.style.display = 'flex';
    if (signupForm) signupForm.style.display = 'none';
    if (loginLinks) loginLinks.style.display = 'block';
    if (signupLinks) signupLinks.style.display = 'none';
    if (authTitle) authTitle.style.display = 'none';
    if (banner) banner.style.display = 'none';
    
    // Minimal password toggle handlers (shows error on click)
    ['toggleLoginPassword', 'toggleSignupPassword', 'toggleConfirmPassword'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = () => {
          alert('Service unavailable. Please refresh the page.');
        };
      }
    });
    
    console.log('[FALLBACK] Basic UI wired successfully');
  } catch (fallbackErr) {
    console.error('[FALLBACK ERROR]', fallbackErr);
  }
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async function() {
  try {
    console.log('🧭 login-page.js v2 starting');
    console.log('[AUTH INIT START]');

    // Prevent bounce if coming from logout - keep flag during auth check, clear after
    const hasLogoutIntent = sessionStorage.getItem('logout-intent') === '1';
    if (hasLogoutIntent) {
      console.log('🚫 Logout intent detected — staying on login');
      // Keep logout-intent flag during auth check to prevent redirects
      // Will be cleared after auth check completes
    }

    // Check for password reset success flag (don't remove yet, need to use it later)
    const resetPasswordSuccess = sessionStorage.getItem('resetPasswordSuccess');

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
    
    // === PLAN DETECTION (IMMEDIATE - BEFORE AUTH CHECK) ===
  // Show banner immediately without waiting for auth to improve UX
  const urlParams = new URLSearchParams(window.location.search);
  const planParam = urlParams.get('plan');
  
  // Check sessionStorage for plan (pricing page stores it here as JSON)
  let storedPlanData = null;
  try {
    const stored = sessionStorage.getItem('selectedPlan');
    if (stored) {
      storedPlanData = JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to parse selectedPlan from sessionStorage:', e);
  }
  
  // Priority: URL param > sessionStorage planId
  let selectedPlan = planParam || storedPlanData?.planId || null;
  
  console.log('🔍 Plan Detection Debug (sessionStorage):', { 
    planParam, 
    storedPlanData, 
    selectedPlan 
  });
  
  // Handle password reset success banner
  if (resetPasswordSuccess === '1') {
    console.log('✅ Password reset success detected — showing success banner');
    showPasswordResetSuccessBanner();
    sessionStorage.removeItem('resetPasswordSuccess'); // Clear flag after displaying
    setTimeout(() => hideSelectedPlanBanner(), 5000); // Hide after 5 seconds
    selectedPlan = null; // Don't show plan banner if password reset banner is showing
  }
  
  // Show banner IMMEDIATELY if plan is detected (before auth check)
  if (selectedPlan && selectedPlan !== 'create-account') {
    // Store selected plan in sessionStorage to match pricing page
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
    sessionStorage.setItem('selectedPlan', JSON.stringify({
      planId: selectedPlan,
      planName: planNames[selectedPlan] || 'Selected Plan',
      price: planPrices[selectedPlan] || '$0/mo',
      source: 'login-page',
      timestamp: Date.now()
    }));
    
    // Show banner IMMEDIATELY with fade-in effect
    showSelectedPlanBanner(selectedPlan);
    
    // Auto-switch to signup form for new users with plan
    if (!localStorage.getItem('user-email')) {
      showSignupForm(selectedPlan, true); // Pass flag to skip banner (already shown)
    } else {
      // Existing user who somehow landed here - show login
      showLoginForm();
    }
  } else {
    // No explicit plan selected: hide banner and show Login by default
    hideSelectedPlanBanner();
    showLoginForm();
  }
  
  // Clean up if no plan
  if (!selectedPlan) {
    sessionStorage.removeItem('selectedPlan');
  }
  
  // === AUTH CHECK (RUN IN PARALLEL, DON'T BLOCK BANNER) ===
  const checkAuth = async () => {
    if (loginInProgress) {
      console.log('⏸️ Login in progress, skipping auto-redirect');
      return false;
    }

    // Check for logout-intent flag - if logout is in progress, don't redirect
    const logoutIntent = sessionStorage.getItem('logout-intent');
    if (logoutIntent === '1') {
      console.log('🚫 Logout in progress, skipping auth check and redirect');
      return false;
    }

    // ONLY check Firebase, not localStorage
    try {
      console.log('🔍 Checking Firebase auth state...');
      const user = await waitForAuthReady(4000);
      if (user && user.email) {
        // Double-check logout intent before redirecting
        const logoutIntentCheck = sessionStorage.getItem('logout-intent');
        if (logoutIntentCheck === '1') {
          console.log('🚫 Logout in progress, preventing redirect to dashboard');
          return false;
        }
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
  
  // Run auth check in parallel (don't await before showing banner)
  const isAuthenticated = await checkAuth();
  
  // Clear logout-intent flag after auth check completes (if it was set)
  if (hasLogoutIntent) {
    sessionStorage.removeItem('logout-intent');
    console.log('✅ Cleared logout-intent flag after auth check');
  }
  
  if (isAuthenticated) return;
  
  // Listen for auth state changes in case user gets authenticated after page load
  const unsubscribe = authManager.onAuthStateChange((user) => {
    if (user) {
      // Check for logout-intent flag - if logout is in progress, don't redirect
      const logoutIntent = sessionStorage.getItem('logout-intent');
      if (logoutIntent === '1') {
        console.log('🚫 Logout in progress, ignoring auth state change and preventing redirect');
        return;
      }
      
      let storedPlan = null;
      try {
        const stored = sessionStorage.getItem('selectedPlan');
        storedPlan = stored ? JSON.parse(stored).planId : null;
      } catch (e) {}
      const plan = selectedPlan || storedPlan;
      if (plan && planRequiresPayment(plan)) {
        console.log('✅ Auth changed but paid plan selected, skipping auto-redirect');
        return;
      }
      console.log('✅ Auth state changed: User authenticated, redirecting to dashboard');
      document.body.style.opacity = '0.7';
      document.body.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        // Final check before redirect
        const finalLogoutIntent = sessionStorage.getItem('logout-intent');
        if (finalLogoutIntent === '1') {
          console.log('🚫 Logout in progress, canceling redirect to dashboard');
          return;
        }
        window.location.href = 'dashboard.html';
      }, 200);
      // Guard against non-function unsubscribe (prevents TypeError and loops)
      if (typeof unsubscribe === 'function') unsubscribe();
    }
  });
  
  // ===== FORM TOGGLING =====
  showSignUpLink?.addEventListener('click', function(e) {
    e.preventDefault();
    // Preserve plan selection when manually switching to signup
    let currentPlan = null;
    try {
      const stored = sessionStorage.getItem('selectedPlan');
      currentPlan = stored ? JSON.parse(stored).planId : null;
    } catch (e) {}
    showSignupForm(currentPlan);
  });
  
  showLoginLink?.addEventListener('click', function(e) {
    e.preventDefault();
    // Clear plan selection when manually switching to login
    sessionStorage.removeItem('selectedPlan');
    try { localStorage.removeItem('selectedPlan'); } catch (_) {}
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
    
    // Fallback redirect timeout - ensures user always gets redirected even if something fails
    let redirected = false;
    const fallbackRedirectTimeout = setTimeout(() => {
      if (!redirected && authManager.getCurrentUser()) {
        console.log('⚠️ Fallback redirect triggered - redirecting to dashboard');
        sessionStorage.removeItem('selectedPlan');
        window.location.href = 'dashboard.html';
      }
    }, 8000); // 8 second timeout
    
    try {
      const result = await authManager.signInWithGoogle();
      
      if (result.success) {
        redirected = true;
        clearTimeout(fallbackRedirectTimeout);
        
        // Route based on selected plan (only if freshly selected from pricing page)
        let storedPlan = null;
        let isFreshSelection = false;
        try {
          const stored = sessionStorage.getItem('selectedPlan');
          if (stored) {
            const data = JSON.parse(stored);
            storedPlan = data.planId;
            const timestamp = data.timestamp || 0;
            isFreshSelection = Date.now() - timestamp < 5 * 60 * 1000; // 5 minutes
          }
        } catch (e) {}
        
        // Only use the plan if it was freshly selected
        const plan = isFreshSelection ? (selectedPlan || storedPlan || 'free') : 'free';
        
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
          // Existing user or free plan -> take user to dashboard
          sessionStorage.removeItem('selectedPlan');
          console.log('🚀 Redirecting to dashboard (existing user or free plan)');
          window.location.href = 'dashboard.html';
        }
      } else if (result.error) {
        clearTimeout(fallbackRedirectTimeout);
        // Show error (but not if user just closed popup)
        showError(loginError, result.error);
        this.textContent = originalText;
        this.disabled = false;
      } else {
        clearTimeout(fallbackRedirectTimeout);
        // Silent failure (user closed popup)
        this.textContent = originalText;
        this.disabled = false;
      }
    } catch (error) {
      clearTimeout(fallbackRedirectTimeout);
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
  // Scroll lock management for modal
  let savedScrollPosition = 0;
  
  function lockBodyScroll() {
    savedScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollPosition}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }
  
  function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollPosition);
  }

  let isModalOpening = false;
  let isSendingResetLink = false;

  forgotPasswordLink?.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent multiple rapid clicks
    if (isModalOpening || (forgotPasswordOverlay && forgotPasswordOverlay.style.display === 'flex')) {
      return;
    }
    
    isModalOpening = true;
    hideError(loginError);
    
    // Lock scroll before opening modal to prevent scroll jump
    lockBodyScroll();
    
    // Clear previous state
    const currentLoginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
    if (forgotPasswordEmailInput) forgotPasswordEmailInput.value = currentLoginEmail;
    if (forgotPasswordError) { forgotPasswordError.style.display = 'none'; forgotPasswordError.textContent = ''; }
    if (forgotPasswordSuccess) { forgotPasswordSuccess.style.display = 'none'; }
    
    // Show modal with smooth transition
    if (forgotPasswordOverlay) {
      forgotPasswordOverlay.style.opacity = '0';
      forgotPasswordOverlay.style.display = 'flex';
      
      // Use requestAnimationFrame for smooth appearance
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (forgotPasswordOverlay) {
            forgotPasswordOverlay.style.transition = 'opacity 0.2s ease-in-out';
            forgotPasswordOverlay.style.opacity = '1';
            
            // Focus on email input after animation
            setTimeout(() => {
              if (forgotPasswordEmailInput) {
                forgotPasswordEmailInput.focus();
              }
              isModalOpening = false;
            }, 50);
          }
        });
      });
    }
  });

  forgotPasswordSendBtn?.addEventListener('click', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent multiple clicks
    if (isSendingResetLink) {
      return;
    }
    
    const email = forgotPasswordEmailInput?.value?.trim();
    if (!email || !isValidEmail(email)) {
      if (forgotPasswordError) {
        forgotPasswordError.textContent = 'Please enter a valid email address.';
        forgotPasswordError.style.display = 'block';
      }
      if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
      return;
    }
    
    // Show loading state
    isSendingResetLink = true;
    const originalText = this.textContent;
    this.textContent = 'Sending...';
    this.disabled = true;
    this.style.cursor = 'not-allowed';
    this.style.opacity = '0.7';
    
    // Clear previous messages
    if (forgotPasswordError) { forgotPasswordError.style.display = 'none'; forgotPasswordError.textContent = ''; }
    if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
    
    try {
      const result = await authManager.resetPassword(email);
      if (result.success) {
        if (forgotPasswordError) { forgotPasswordError.style.display = 'none'; forgotPasswordError.textContent = ''; }
        if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'block';
        // Clear email input after success
        if (forgotPasswordEmailInput) forgotPasswordEmailInput.value = '';
      } else {
        if (forgotPasswordError) {
          forgotPasswordError.textContent = result.error || 'Something went wrong. Please try again.';
          forgotPasswordError.style.display = 'block';
        }
        if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
      }
    } catch (error) {
      console.error('Password reset error:', error);
      if (forgotPasswordError) {
        forgotPasswordError.textContent = 'An unexpected error occurred. Please try again.';
        forgotPasswordError.style.display = 'block';
      }
      if (forgotPasswordSuccess) forgotPasswordSuccess.style.display = 'none';
    } finally {
      // Restore button state
      isSendingResetLink = false;
      this.textContent = originalText;
      this.disabled = false;
      this.style.cursor = 'pointer';
      this.style.opacity = '1';
    }
  });

  // Allow Enter key to submit password reset form
  forgotPasswordEmailInput?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !isSendingResetLink) {
      e.preventDefault();
      forgotPasswordSendBtn?.click();
    }
  });

  function closeForgotOverlay() {
    if (forgotPasswordOverlay && forgotPasswordOverlay.style.display === 'flex') {
      // Smooth fade-out
      forgotPasswordOverlay.style.opacity = '0';
      setTimeout(() => {
        if (forgotPasswordOverlay) {
          forgotPasswordOverlay.style.display = 'none';
          unlockBodyScroll();
        }
      }, 200);
    }
  }

  forgotPasswordCloseBtn?.addEventListener('click', function(e) {
    e.preventDefault();
    closeForgotOverlay();
  });
  
  // Close modal when clicking backdrop
  forgotPasswordOverlay?.addEventListener('click', function(e) {
    if (e.target === forgotPasswordOverlay) {
      closeForgotOverlay();
    }
  });
  
  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && forgotPasswordOverlay && forgotPasswordOverlay.style.display === 'flex') {
      closeForgotOverlay();
    }
  });
  
  // Focus trap: prevent tabbing outside modal
  forgotPasswordOverlay?.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    
    const focusableElements = forgotPasswordOverlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    
    if (e.shiftKey && e.target === firstFocusable) {
      // Shift+Tab from first element: wrap to last
      e.preventDefault();
      lastFocusable?.focus();
    } else if (!e.shiftKey && e.target === lastFocusable) {
      // Tab from last element: wrap to first
      e.preventDefault();
      firstFocusable?.focus();
    }
  });
  
  // ===== HELPER FUNCTIONS =====
  
  function showSignupForm(planOverride = null, skipBanner = false) {
    loginForm.style.display = 'none';
    loginLinks.style.display = 'none';
    signupForm.style.display = 'flex';
    signupLinks.style.display = 'block';
    hideError(loginError);
    hideError(signupError);
    
    // Make auth title visible for signup (it may be hidden from login form)
    authTitle.style.display = 'block';
    
    // Show banner only when plan is explicitly selected and equals 'trial' or paid
    let plan = planOverride;
    if (!plan) {
      try {
        const stored = sessionStorage.getItem('selectedPlan');
        plan = stored ? JSON.parse(stored).planId : null;
      } catch (e) {}
    }
    
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
      authTitle: authTitle.textContent,
      skipBanner
    });
    
    if (plan && planNames[plan]) {
      if (plan === 'free') {
        authTitle.textContent = 'Create your free account';
        // Only show banner if not already shown (skipBanner flag)
        if (!skipBanner) {
          showSelectedPlanBanner(plan);
        }
        console.log('✅ Showing free account form' + (skipBanner ? ' (banner already shown)' : ' with banner'));
      } else {
        authTitle.textContent = `Sign up for ${planNames[plan]}`;
        // Only show banner if not already shown (skipBanner flag)
        if (!skipBanner) {
          showSelectedPlanBanner(plan);
        }
        console.log('✅ Showing plan form' + (skipBanner ? ' (banner already shown)' : ' with banner') + ' for:', plan);
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
    authTitle.style.display = 'none';
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
      
      // Remove 'show' class first to ensure clean state
      banner.classList.remove('show');
      
      // Set display to block
      banner.style.display = 'block';
      
      // Force reflow to ensure display change is processed
      void banner.offsetHeight;
      
      // Add 'show' class on next frame for smooth fade-in animation
      requestAnimationFrame(() => {
        banner.classList.add('show');
        console.log('✅ Showing plan banner for:', plan, 'with fade-in effect');
      });
      
      // Debug trace for plan banner rendering
      console.trace('selectedPlanBanner:', { planName: finalPlanName, planPrice: finalPlanPrice, plan });
    }
  }

  function hideSelectedPlanBanner() {
    const banner = document.getElementById('selectedPlanBanner');
    if (banner) {
      banner.classList.remove('show');
      banner.style.display = 'none';
      // Also clear any text to avoid confusion in screen readers
      const planName = document.getElementById('selectedPlanName');
      const planPrice = document.getElementById('selectedPlanPrice');
      if (planName) planName.textContent = '';
      if (planPrice) planPrice.textContent = '';
    }
  }

  function showPasswordResetSuccessBanner() {
    const banner = document.getElementById('selectedPlanBanner');
    const planName = document.getElementById('selectedPlanName');
    const planPrice = document.getElementById('selectedPlanPrice');
    
    if (banner && planName && planPrice) {
      planName.textContent = '✓ Password Reset Successful';
      planPrice.textContent = 'Your password has been updated. Please sign in.';
      banner.style.display = 'block';
      banner.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
      console.log('✅ Showing password reset success banner');
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
  
  console.log('[AUTH INIT COMPLETE] All initialization successful');
  } catch (err) {
    console.error('[AUTH INIT ERROR]', err);
    safeFallbackInit();
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

// Clear plan selection if user navigates away from login page without authenticating
window.addEventListener('beforeunload', () => {
  try {
    const user = authManager.getCurrentUser();
    if (!user) {
      sessionStorage.removeItem('selectedPlan');
      localStorage.removeItem('selectedPlan');
    }
  } catch (_) {}
});

