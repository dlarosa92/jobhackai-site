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
    // Disable demo mode entirely – always defer to server-driven Stripe Checkout
    this.isDemoMode = false;
    this.productionStripeKey = null;
    
    this.init();
  }

  init() {
    // Load Stripe.js dynamically for WIX compatibility
    this.loadStripeScript();
  }

  loadStripeScript() { /* no-op; we use server-driven Checkout */ }

  initializeStripe() { /* no-op */ }

  initializeDemoMode() { /* no-op */ }

  setupElements() { /* no-op; no Elements UI */ }

  createDemoElements() { /* no-op */ }

  setupEventListeners() { /* no-op */ }

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
  async openCheckout(plan, amount, startTrial = false) {

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
      const idToken = await window.FirebaseAuthManager?.getCurrentUser?.()?.getIdToken?.();
      const response = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          plan: plan,
          startTrial: !!startTrial
        }),
      });

      const { ok, url, error } = await response.json();
      if (!ok || !url) throw new Error(error || 'Failed to create checkout session');
      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      alert('Unable to start checkout. Please try again.');
    }
  }

  // Method to handle subscription management
  async manageSubscription() {

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
      const idToken = await window.FirebaseAuthManager?.getCurrentUser?.()?.getIdToken?.();
      const response = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({})
      });

      const { ok, url, error } = await response.json();
      if (!ok || !url) throw new Error(error || 'Failed to create billing portal session');
      window.location.href = url;
    } catch (error) {
      console.error('Failed to create portal session:', error);
    }
  }

  // Demo UI removed
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