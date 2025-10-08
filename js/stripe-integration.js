/**
 * Stripe Integration for JobHackAI - WIX Compatible
 * This file provides Stripe Elements integration for payment processing
 * Includes demo mode for testing without real Stripe keys
 */

class JobHackAIStripe {
  constructor() {
    this.stripe = null;
    this.elements = null;
    this.cardElement = null;
    // Auto-detect demo vs real mode:
    // - Use REAL mode on dev.jobhackai.io to exercise the new API endpoints
    // - Allow overriding via window.__forceStripeDemo = true
    this.isDemoMode = (typeof window !== 'undefined' && window.__forceStripeDemo === true)
      ? true
      : (location.hostname !== 'dev.jobhackai.io');
    this.demoStripeKey = 'pk_test_demo_key_for_wix_compatibility';
    this.productionStripeKey = 'pk_live_your_actual_stripe_key';
    
    this.init();
  }

  init() {
    // Load Stripe.js dynamically for WIX compatibility
    this.loadStripeScript();
  }

  loadStripeScript() {
    // In demo mode, don't load Stripe at all to prevent errors
    if (this.isDemoMode) {
      console.log('Demo mode: Skipping Stripe.js load to prevent errors');
      this.initializeDemoMode();
      return;
    }

    // Check if Stripe is already loaded
    if (window.Stripe) {
      this.initializeStripe();
      return;
    }

    // Load Stripe.js script with proper attributes to avoid sandbox errors
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    
    script.onload = () => {
      this.initializeStripe();
    };
    script.onerror = () => {
      console.warn('Stripe.js failed to load, using demo mode');
      this.initializeDemoMode();
    };
    document.head.appendChild(script);
  }

  initializeStripe() {
    try {
      const stripeKey = this.isDemoMode ? this.demoStripeKey : this.productionStripeKey;
      this.stripe = Stripe(stripeKey);
      this.elements = this.stripe.elements();
      this.setupElements();
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
      this.initializeDemoMode();
    }
  }

  initializeDemoMode() {
    console.log('Running in demo mode - no real payments will be processed');
    this.createDemoElements();
    
    // Set a flag to indicate demo mode is active
    window.stripeDemoMode = true;
    
    // Completely disable Stripe to prevent errors
    if (window.Stripe) {
      // Override Stripe to prevent any real API calls
      window.Stripe = function(key) {
        console.log('Stripe disabled in demo mode');
        return {
          elements: () => ({
            create: () => ({
              mount: () => console.log('Demo card element mounted'),
              unmount: () => console.log('Demo card element unmounted'),
              on: () => console.log('Demo card event listener added'),
              off: () => console.log('Demo card event listener removed'),
              clear: () => console.log('Demo card element cleared')
            })
          }),
          confirmCardPayment: () => Promise.resolve({ paymentIntent: { status: 'succeeded' } }),
          confirmPayment: () => Promise.resolve({ paymentIntent: { status: 'succeeded' } }),
          createPaymentMethod: () => Promise.resolve({ paymentMethod: { id: 'demo_pm_' + Date.now() } }),
          retrievePaymentIntent: () => Promise.resolve({ paymentIntent: { status: 'succeeded' } })
        };
      };
    }
    
    // Prevent Stripe.js from loading if not already loaded
    const stripeScript = document.querySelector('script[src*="stripe.com"]');
    if (stripeScript) {
      stripeScript.remove();
    }
  }

  setupElements() {
    if (!this.elements) {
      this.initializeDemoMode();
      return;
    }

    // Create card element with custom styling
    this.cardElement = this.elements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#424770',
          '::placeholder': {
            color: '#aab7c4',
          },
          ':-webkit-autofill': {
            color: '#fce883',
          },
        },
        invalid: {
          color: '#9e2146',
        },
      },
    });

    // Mount the card element
    const cardContainer = document.getElementById('stripeElement');
    if (cardContainer) {
      this.cardElement.mount('#stripeElement');
      this.setupEventListeners();
    }
  }

  createDemoElements() {
    // Create simple demo card input for testing
    const cardContainer = document.getElementById('stripeElement');
    if (cardContainer) {
      cardContainer.innerHTML = `
        <div class="demo-card-input">
          <input type="text" placeholder="1234 5678 9012 3456" class="demo-card-number" maxlength="19" aria-label="Card number" value="4242 4242 4242 4242">
          <div class="demo-card-row">
            <input type="text" placeholder="MM/YY" class="demo-card-expiry" maxlength="5" aria-label="Expiry date" value="02/29">
            <input type="text" placeholder="CVC" class="demo-card-cvc" maxlength="4" aria-label="CVC" value="123">
          </div>
        </div>
      `;

      // Add demo styling
      const style = document.createElement('style');
      style.textContent = `
        .demo-card-input input {
          width: 100%;
          padding: 12px;
          border: 1px solid #e1e5e9;
          border-radius: 6px;
          font-size: 16px;
          margin-bottom: 8px;
        }
        .demo-card-row {
          display: flex;
          gap: 8px;
        }
        .demo-card-row input {
          flex: 1;
        }
        .demo-card-number {
          background: linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%);
        }
        .demo-card-expiry, .demo-card-cvc {
          background: linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%);
        }
      `;
      document.head.appendChild(style);

      this.setupDemoEventListeners();
    }
  }

  setupEventListeners() {
    if (!this.cardElement) return;

    // Handle real-time validation
    this.cardElement.on('change', (event) => {
      this.handleCardChange(event);
    });

    // Handle form submission for both add-card and checkout pages
    const cardForm = document.getElementById('cardForm');
    const checkoutForm = document.getElementById('checkoutForm');
    
    if (cardForm) {
      cardForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleFormSubmission();
      });
    }
    
    if (checkoutForm) {
      checkoutForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleFormSubmission();
      });
    }
  }

  setupDemoEventListeners() {
    const cardNumber = document.querySelector('.demo-card-number');
    const cardExpiry = document.querySelector('.demo-card-expiry');
    const cardCvc = document.querySelector('.demo-card-cvc');
    const submitBtn = document.getElementById('cardSubmitBtn');
    const errorDiv = document.getElementById('cardError');

    if (cardNumber) {
      cardNumber.addEventListener('input', (e) => {
        // Format card number with spaces
        let value = e.target.value.replace(/\s/g, '');
        value = value.replace(/(\d{4})/g, '$1 ').trim();
        e.target.value = value;
        this.validateDemoCard();
      });
    }

    if (cardExpiry) {
      cardExpiry.addEventListener('input', (e) => {
        // Format expiry date
        let value = e.target.value.replace(/\D/g, '');
        if (value.length >= 2) {
          value = value.substring(0, 2) + '/' + value.substring(2, 4);
        }
        e.target.value = value;
        this.validateDemoCard();
      });
    }

    if (cardCvc) {
      cardCvc.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
        this.validateDemoCard();
      });
    }

    // Form submission
    const form = document.getElementById('cardForm');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.handleDemoFormSubmission();
      });
    }
  }

  validateDemoCard() {
    const cardNumber = document.querySelector('.demo-card-number');
    const cardExpiry = document.querySelector('.demo-card-expiry');
    const cardCvc = document.querySelector('.demo-card-cvc');
    const submitBtn = document.getElementById('cardSubmitBtn') || document.getElementById('checkoutSubmitBtn');
    const errorDiv = document.getElementById('cardError') || document.getElementById('checkoutError');

    if (!cardNumber || !cardExpiry || !cardCvc || !submitBtn) return;

    let errorMsg = '';
    const numberValue = cardNumber.value.replace(/\s/g, '');
    const expiryValue = cardExpiry.value;
    const cvcValue = cardCvc.value;

    if (numberValue.length < 13) {
      errorMsg = 'Card number is too short.';
    } else if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(expiryValue)) {
      errorMsg = 'Invalid expiry date. Use MM/YY.';
    } else if (cvcValue.length < 3) {
      errorMsg = 'CVC is too short.';
    }

    if (errorMsg) {
      submitBtn.disabled = true;
      submitBtn.style.background = '#BDBDBD';
      errorDiv.textContent = errorMsg;
      errorDiv.setAttribute('aria-live', 'polite');
      errorDiv.style.display = 'block';
    } else {
      submitBtn.disabled = false;
      submitBtn.style.background = '#00E676';
      errorDiv.textContent = '';
      errorDiv.style.display = 'none';
    }
  }

  handleCardChange(event) {
    const submitBtn = document.getElementById('cardSubmitBtn');
    const errorDiv = document.getElementById('cardError');

    if (event.error) {
      errorDiv.textContent = event.error.message;
      errorDiv.style.display = 'block';
      submitBtn.disabled = true;
    } else {
      errorDiv.style.display = 'none';
      submitBtn.disabled = false;
    }
  }

  async handleFormSubmission() {
    const cardForm = document.getElementById('cardForm');
    const checkoutForm = document.getElementById('checkoutForm');
    const isCheckout = checkoutForm && document.activeElement.closest('#checkoutForm');
    
    const submitBtn = isCheckout ? document.getElementById('checkoutSubmitBtn') : document.getElementById('cardSubmitBtn');
    const errorDiv = isCheckout ? document.getElementById('checkoutError') : document.getElementById('cardError');

    submitBtn.disabled = true;
    submitBtn.textContent = isCheckout ? 'Processing...' : 'Processing...';
    errorDiv.style.display = 'none';

    try {
      if (this.isDemoMode) {
        // Demo mode - simulate processing
        await this.simulatePaymentProcessing();
      } else {
        // Real Stripe processing
        const result = await this.stripe.confirmCardPayment(this.getClientSecret(), {
          payment_method: {
            card: this.cardElement,
          },
        });

        if (result.error) {
          throw new Error(result.error.message);
        }

        await this.handleSuccessfulPayment(result.paymentIntent);
      }
    } catch (error) {
      this.handlePaymentError(error.message, isCheckout);
    } finally {
      submitBtn.disabled = false;
      const selectedPlan = localStorage.getItem('selected-plan');
      if (isCheckout && selectedPlan && selectedPlan !== 'trial') {
        submitBtn.textContent = `Subscribe to ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}`;
      } else {
        submitBtn.textContent = 'Start Free Trial';
      }
    }
  }

  async handleDemoFormSubmission() {
    const cardForm = document.getElementById('cardForm');
    const checkoutForm = document.getElementById('checkoutForm');
    const isCheckout = checkoutForm && document.activeElement.closest('#checkoutForm');
    
    const submitBtn = isCheckout ? document.getElementById('checkoutSubmitBtn') : document.getElementById('cardSubmitBtn');
    const errorDiv = isCheckout ? document.getElementById('checkoutError') : document.getElementById('cardError');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    errorDiv.style.display = 'none';

    try {
      await this.simulatePaymentProcessing();
    } catch (error) {
      this.handlePaymentError(error.message, isCheckout);
    } finally {
      submitBtn.disabled = false;
      const selectedPlan = localStorage.getItem('selected-plan');
      if (isCheckout && selectedPlan && selectedPlan !== 'trial') {
        submitBtn.textContent = `Subscribe to ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}`;
      } else {
        submitBtn.textContent = 'Start Free Trial';
      }
    }
  }

  async simulatePaymentProcessing() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulate 90% success rate for demo
        if (Math.random() > 0.1) {
          resolve();
        } else {
          reject(new Error('Payment failed. Please try again.'));
        }
      }, 1500);
    });
  }

  async handleSuccessfulPayment(paymentIntent) {
    // Get selected plan info
    const selectedPlan = localStorage.getItem('selected-plan');
    const planAmount = localStorage.getItem('plan-amount');
    
    // Store user plan and payment info
    if (selectedPlan && selectedPlan !== 'trial') {
      localStorage.setItem('user-plan', selectedPlan);
      localStorage.setItem('dev-plan', selectedPlan);
      localStorage.setItem('subscription-active', 'true');
      localStorage.setItem('plan-amount', planAmount);
    } else {
      localStorage.setItem('user-plan', 'trial');
      localStorage.setItem('dev-plan', 'trial');
      localStorage.setItem('trial-activated', 'true');
    }
    
    localStorage.setItem('payment-intent-id', paymentIntent?.id || 'demo-payment-id');

    // Save payment method for future use (demo mode)
    if (this.isDemoMode) {
      this.savePaymentMethodToLocalStorage();
    }

    // TODO: In production, send trial expiry reminder email here
    // This would typically be handled by your backend or Zapier integration
    if (selectedPlan === 'trial' || !selectedPlan) {
      console.log('TODO: Send trial expiry reminder email to user');
      // Example Zapier webhook call:
      // fetch('https://hooks.zapier.com/hooks/catch/your-webhook-url', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     email: 'user@example.com',
      //     trial_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      //     reminder_type: 'trial_expiry'
      //   })
      // });
    }

    // Show success message
    this.showSuccessMessage(selectedPlan);

    // Redirect to dashboard
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 2000);
  }

  // Save payment method to localStorage (demo mode)
  savePaymentMethodToLocalStorage() {
    try {
      // Get existing saved cards
      const savedCards = JSON.parse(localStorage.getItem('saved-cards') || '[]');
      
      // Create demo card data (in production, this would come from Stripe)
      const demoCard = {
        id: 'pm_demo_' + Date.now(),
        brand: 'Visa',
        last4: '4242',
        expiry: '12/25',
        isDefault: savedCards.length === 0 // First card becomes default
      };
      
      // Add to saved cards if not already present
      const cardExists = savedCards.some(card => card.last4 === demoCard.last4);
      if (!cardExists) {
        savedCards.push(demoCard);
        localStorage.setItem('saved-cards', JSON.stringify(savedCards));
        console.log('Payment method saved for future use (demo mode)');
      }
    } catch (error) {
      console.error('Failed to save payment method:', error);
    }
  }

  // Get saved payment methods (demo mode)
  getSavedPaymentMethods() {
    try {
      return JSON.parse(localStorage.getItem('saved-cards') || '[]');
    } catch (error) {
      console.error('Failed to get saved payment methods:', error);
      return [];
    }
  }

  // Remove saved payment method (demo mode)
  removeSavedPaymentMethod(paymentMethodId) {
    try {
      const savedCards = JSON.parse(localStorage.getItem('saved-cards') || '[]');
      const updatedCards = savedCards.filter(card => card.id !== paymentMethodId);
      localStorage.setItem('saved-cards', JSON.stringify(updatedCards));
      console.log('Payment method removed (demo mode)');
      return true;
    } catch (error) {
      console.error('Failed to remove payment method:', error);
      return false;
    }
  }

  handlePaymentError(errorMessage, isCheckout = false) {
    const errorDiv = isCheckout ? document.getElementById('checkoutError') : document.getElementById('cardError');
    errorDiv.textContent = errorMessage;
    errorDiv.style.display = 'block';
  }

  showSuccessMessage(plan = 'trial') {
    const container = document.querySelector('.card-container') || document.querySelector('.checkout-container');
    if (container) {
      const isSubscription = plan && plan !== 'trial';
      const planName = isSubscription ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free Trial';
      
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
          <div style="color: #00E676; font-size: 3rem; margin-bottom: 1rem;">✓</div>
          <h2 style="color: #232B36; margin-bottom: 1rem;">Payment Successful!</h2>
          <p style="color: #4B5563;">Your ${planName} has been activated. Redirecting to dashboard...</p>
        </div>
      `;
    }
  }

  getClientSecret() {
    // In a real implementation, this would come from your backend
    // For demo purposes, return a placeholder
    return 'pi_demo_secret_key';
  }

  // Method to create payment intent (would call your backend)
  async createPaymentIntent(amount, currency = 'usd') {
    if (this.isDemoMode) {
      return { client_secret: 'pi_demo_secret_key' };
    }

    // Real implementation would call your backend API
    const response = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount,
        currency: currency,
      }),
    });

    return response.json();
  }

  // Method to open Stripe Checkout for subscriptions
  async openCheckout(plan, amount) {
    if (this.isDemoMode) {
      // Demo mode - redirect to checkout page with plan info
      localStorage.setItem('selected-plan', plan);
      localStorage.setItem('plan-amount', amount);
      
      if (plan === 'trial') {
        window.location.href = 'add-card.html';
      } else {
        window.location.href = 'checkout.html';
      }
      return;
    }

    if (!this.stripe) {
      console.error('Stripe not initialized');
      return;
    }

    try {
      // Resolve auth user for backend mapping
      const authUser = (function getAuthUser(){
        try {
          const u = window.FirebaseAuthManager?.getCurrentUser?.();
          if (u && u.uid && u.email) return { uid: u.uid, email: u.email };
        } catch(_){}
        try {
          const ls = JSON.parse(localStorage.getItem('auth-user') || '{}');
          if (ls && ls.uid && ls.email) return { uid: ls.uid, email: ls.email };
        } catch(_){}
        return null;
      })();

      if (!authUser) {
        console.error('Missing authenticated user for checkout');
        alert('Please log in to start your subscription.');
        window.location.href = 'login.html';
        return;
      }

      // Create checkout session (Cloudflare Pages Function)
      const response = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: plan,
          firebaseUid: authUser.uid,
          email: authUser.email
        }),
      });

      const { ok, url, error } = await response.json();
      if (!ok || !url) throw new Error(error || 'Failed to create checkout session');
      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      // Fallback to checkout page
      window.location.href = 'checkout.html';
    }
  }

  // Method to handle subscription management
  async manageSubscription() {
    if (this.isDemoMode) {
      // Demo mode - show subscription management UI
      this.showDemoSubscriptionManagement();
      return;
    }

    if (!this.stripe) {
      console.error('Stripe not initialized');
      return;
    }

    try {
      // Resolve current user
      let uid = null;
      try { uid = window.FirebaseAuthManager?.getCurrentUser?.()?.uid || null; } catch(_){}
      if (!uid) {
        try { uid = JSON.parse(localStorage.getItem('auth-user') || '{}').uid || null; } catch(_){}
      }
      if (!uid) {
        alert('Please log in to manage your subscription.');
        window.location.href = 'login.html';
        return;
      }

      // Create customer portal session (Cloudflare Pages Function)
      const response = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ firebaseUid: uid }),
      });

      const { ok, url, error } = await response.json();
      if (!ok || !url) throw new Error(error || 'Failed to create billing portal session');
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create portal session:', error);
    }
  }

  // Demo subscription management UI
  showDemoSubscriptionManagement() {
    const container = document.querySelector('.card-container') || document.body;
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 400px; width: 90%;">
        <h3 style="margin-bottom: 1rem; color: #232B36;">Subscription Management</h3>
        <p style="color: #4B5563; margin-bottom: 1.5rem;">This is a demo of subscription management. In production, this would redirect to Stripe's customer portal.</p>
        <div style="display: flex; gap: 1rem;">
          <button onclick="this.closest('.subscription-modal').remove()" style="padding: 0.5rem 1rem; border: 1px solid #E5E7EB; background: white; border-radius: 6px; cursor: pointer;">Close</button>
          <button onclick="window.location.href='account-setting.html'" style="padding: 0.5rem 1rem; background: #00E676; color: white; border: none; border-radius: 6px; cursor: pointer;">Account Settings</button>
        </div>
      </div>
    `;

    modal.classList.add('subscription-modal');
    container.appendChild(modal);
  }
}

// Initialize Stripe when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize on pages with payment forms
  if (document.getElementById('stripeElement')) {
    window.jobHackAIStripe = new JobHackAIStripe();
  }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JobHackAIStripe;
} 