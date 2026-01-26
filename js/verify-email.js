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
  const ROUTE_LOCK_KEY = 'jh_email_verification_route_lock';
  const ROUTE_LOCK_TTL_MS = 2 * 60 * 1000;
  let routingInProgress = false;

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#DC2626' : '#6B7280';
  }

  function acquireRouteLock(origin) {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(ROUTE_LOCK_KEY);
      if (raw) {
        const existing = JSON.parse(raw);
        if (existing?.ts && now - existing.ts < ROUTE_LOCK_TTL_MS) {
          return false;
        }
      }
      localStorage.setItem(ROUTE_LOCK_KEY, JSON.stringify({ ts: now, origin }));
      return true;
    } catch (_) {
      // If storage fails, allow routing rather than blocking
      return true;
    }
  }

  function broadcastRouteStart() {
    try {
      const ch = new BroadcastChannel('auth');
      ch.postMessage({ type: 'verification-route-started' });
      ch.close();
    } catch (_) {}
  }

  function clearVerificationSignal() {
    try {
      localStorage.removeItem('emailJustVerified');
    } catch (_) {}
  }

  async function handleVerifiedSignal(source = 'storage') {
    if (routingInProgress) return;
    routingInProgress = true;
    setStatus('Verified — redirecting...', false);
    try {
      const current = authManager.getCurrentUser();
      if (current && current.reload) {
        await current.reload();
      }
      const refreshed = authManager.getCurrentUser();
      if (refreshed && refreshed.emailVerified) {
        clearVerificationSignal();
        await routeAfterVerification();
        return;
      }
      routingInProgress = false;
      setStatus('Verification detected, syncing status... Please wait a moment and try again.', true);
    } catch (err) {
      routingInProgress = false;
      console.warn('[VERIFY-EMAIL] Failed to handle verification signal:', err);
    }
  }

  // Listen for verification from email link tab
  window.addEventListener('storage', (e) => {
    if (e.key === 'emailJustVerified' && e.newValue) {
      handleVerifiedSignal('storage');
    }
  });

  try {
    const ch = new BroadcastChannel('auth');
    ch.onmessage = (e) => {
      if (e?.data?.type === 'email-verified') {
        handleVerifiedSignal('broadcast');
      }
      if (e?.data?.type === 'verification-route-started') {
        setStatus('Verification in progress in another tab. You can close this tab.', false);
      }
    };
  } catch (_) {}

  // Handle already-verified signal on initial load
  if (localStorage.getItem('emailJustVerified')) {
    handleVerifiedSignal('initial');
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
    if (!acquireRouteLock('verify-email')) {
      setStatus('Verification in progress in another tab. You can close this tab.', false);
      return;
    }
    broadcastRouteStart();

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



