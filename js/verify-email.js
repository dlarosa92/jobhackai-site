import authManager from './firebase-auth.js';

document.addEventListener('DOMContentLoaded', async () => {
  await authManager.waitForAuthReady(4000);

  const user = authManager.getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  // Social (non-password) users skip verification
  if (!authManager.isEmailPasswordUser(user)) {
    await routeAfterVerification();
    return;
  }

  const emailEl = document.getElementById('verifyEmailText');
  if (emailEl) emailEl.textContent = user.email || '';

  const resendBtn = document.getElementById('resendVerifyBtn');
  const alreadyVerifiedLink = document.getElementById('alreadyVerifiedLink');
  const statusEl = document.getElementById('verifyStatus');

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#DC2626' : '#6B7280';
  }

  resendBtn?.addEventListener('click', async () => {
    const res = await authManager.sendVerificationEmail();
    if (res.success) {
      setStatus('Verification email sent. Check your inbox (and spam).');
    } else {
      setStatus(res.error || 'Could not send verification email.', true);
    }
  });

  alreadyVerifiedLink?.addEventListener('click', async (e) => {
    e.preventDefault();
    const current = authManager.getCurrentUser();
    if (current && current.reload) { await current.reload(); }
    const refreshed = authManager.getCurrentUser();
    if (refreshed && refreshed.emailVerified) {
      await routeAfterVerification();
    } else {
      setStatus('Still not verified. Please click the link in your email.', true);
    }
  });

  async function routeAfterVerification() {
    // First check billing status to see if user already has an active subscription or trial
    try {
      const idToken = await authManager.getCurrentUser()?.getIdToken?.(true);
        if (idToken) {
          const billingRes = await fetch('/api/billing-status', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
          });

          if (billingRes.ok) {
            const billingData = await billingRes.json();
            if (billingData.ok && (billingData.status === 'trialing' || billingData.status === 'active')) {
              // User already has active subscription/trial - clear selectedPlan and go to dashboard
              console.log('✅ [VERIFY-EMAIL] User already has active subscription/trial, redirecting to dashboard');
              try {
                sessionStorage.removeItem('selectedPlan');
                localStorage.removeItem('selectedPlan');
              } catch (_) {}

              // Close opener window if opened from email link
              if (window.opener && !window.opener.closed) {
                try {
                  window.opener.close();
                } catch (closeErr) {
                  console.warn('⚠️ [VERIFY-EMAIL] Failed to close opener window:', closeErr);
                }
                window.opener = null;
              }

              window.location.replace('dashboard.html');
              return;
            }
          }
        }
    } catch (err) {
      console.warn('⚠️ [VERIFY-EMAIL] Billing status check failed, continuing with plan selection:', err);
      // Continue with existing flow on error
    }
    
    // No active subscription found, proceed with plan-based routing
    const urlParams = new URLSearchParams(window.location.search);
    const planParam = urlParams.get('plan');
    let storedSelection = null;
    try {
      // Fix: Check sessionStorage first (primary source, set fresh on pricing page),
      // then fall back to localStorage (may contain stale values from previous sessions)
      const sessionStored = sessionStorage.getItem('selectedPlan');
      if (sessionStored) {
        storedSelection = JSON.parse(sessionStored).planId;
      } else {
        const localStored = localStorage.getItem('selectedPlan');
        storedSelection = localStored ? JSON.parse(localStored).planId : null;
      }
    } catch (e) {}
    const plan = planParam || storedSelection || 'free';

    function planRequiresPayment(p) { return ['essential', 'pro', 'premium', 'trial'].includes(p); }

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
      } catch (err) {
        console.error('Checkout error from verify-email flow:', err);
      }
      window.location.href = 'pricing-a.html';
    } else {
      try {
        sessionStorage.removeItem('selectedPlan');
        localStorage.removeItem('selectedPlan');
      } catch (_) {}
      window.location.href = 'dashboard.html';
    }
  }
});






