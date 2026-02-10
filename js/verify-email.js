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
  const IS_PROD_APP_HOST = (window.location.hostname || '').toLowerCase() === 'app.jobhackai.io';
  const RESEND_COOLDOWN_KEY = 'jh_verify_email_resend_cooldown_until';
  const PROD_INITIAL_RESEND_COOLDOWN_MS = 30 * 1000;
  const PROD_RESEND_COOLDOWN_MS = 60 * 1000;
  const PROD_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
  const defaultResendLabel = ((resendBtn?.textContent || 'Resend link').trim() || 'Resend link');
  const ROUTE_LOCK_KEY = 'jh_email_verification_route_lock';
  const ROUTE_LOCK_TTL_MS = 2 * 60 * 1000;
  let routingInProgress = false;
  let resendCooldownTimer = null;

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#DC2626' : '#6B7280';
  }

  function setResendButton(disabled, label = defaultResendLabel) {
    if (!resendBtn) return;
    resendBtn.disabled = !!disabled;
    resendBtn.textContent = label;
    resendBtn.style.opacity = disabled ? '0.75' : '1';
    resendBtn.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }

  function getStoredResendCooldownUntil() {
    try {
      const raw = localStorage.getItem(RESEND_COOLDOWN_KEY);
      if (!raw) return 0;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  function storeResendCooldownUntil(untilMs) {
    try {
      localStorage.setItem(RESEND_COOLDOWN_KEY, String(untilMs));
    } catch (_) {}
  }

  function clearStoredResendCooldown() {
    try {
      localStorage.removeItem(RESEND_COOLDOWN_KEY);
    } catch (_) {}
  }

  function applyResendCooldown(untilMs) {
    if (!resendBtn) return;

    if (resendCooldownTimer) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
    }

    if (!IS_PROD_APP_HOST) {
      clearStoredResendCooldown();
      setResendButton(false);
      return;
    }

    const cooldownUntil = Number.isFinite(Number(untilMs)) ? Number(untilMs) : 0;
    if (!cooldownUntil || cooldownUntil <= Date.now()) {
      clearStoredResendCooldown();
      setResendButton(false);
      return;
    }

    storeResendCooldownUntil(cooldownUntil);

    const updateCountdown = () => {
      const secondsRemaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (secondsRemaining <= 0) {
        clearStoredResendCooldown();
        setResendButton(false);
        if (resendCooldownTimer) {
          clearInterval(resendCooldownTimer);
          resendCooldownTimer = null;
        }
        return;
      }
      setResendButton(true, `Resend link in ${secondsRemaining}s`);
    };

    updateCountdown();
    resendCooldownTimer = setInterval(updateCountdown, 1000);
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
        const routed = await routeAfterVerification();
        if (!routed) {
          routingInProgress = false;
        }
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
      if (e?.data?.type === 'email-verified-handoff') {
        handleVerifiedSignal('broadcast-handoff');
      }
      if (e?.data?.type === 'verification-route-started') {
        setStatus('Verification in progress in another tab. You can close this tab.', false);
      }
    };
  } catch (_) {}

  // Listen for direct postMessage handoff from auth/action tab
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    if (e?.data?.type === 'email-verified-handoff') {
      handleVerifiedSignal('postMessage');
    }
  });

  // Handle already-verified signal on initial load
  if (localStorage.getItem('emailJustVerified')) {
    handleVerifiedSignal('initial');
  }

  if (IS_PROD_APP_HOST) {
    const existingCooldown = getStoredResendCooldownUntil();
    if (existingCooldown > Date.now()) {
      applyResendCooldown(existingCooldown);
    } else {
      applyResendCooldown(Date.now() + PROD_INITIAL_RESEND_COOLDOWN_MS);
    }

    if (!statusEl?.textContent?.trim()) {
      setStatus('Check spam/promotions first. You can resend after the timer.', false);
    }
  } else {
    setResendButton(false);
  }

  window.addEventListener('beforeunload', () => {
    if (resendCooldownTimer) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
    }
  });

  resendBtn?.addEventListener('click', async () => {
    if (!resendBtn) return;

    if (IS_PROD_APP_HOST) {
      const cooldownUntil = getStoredResendCooldownUntil();
      if (cooldownUntil > Date.now()) {
        applyResendCooldown(cooldownUntil);
        setStatus('Please wait before requesting another verification email.', true);
        return;
      }
    }

    setResendButton(true, 'Sending...');

    const res = await authManager.sendVerificationEmail();
    if (res.success) {
      setStatus('Verification email sent. Check your inbox (and spam).');
      if (IS_PROD_APP_HOST) {
        applyResendCooldown(Date.now() + PROD_RESEND_COOLDOWN_MS);
      } else {
        setResendButton(false);
      }
    } else {
      const errorText = (res.error || '').toLowerCase();
      const isRateLimited = errorText.includes('too many') || errorText.includes('try again later');

      if (IS_PROD_APP_HOST && isRateLimited) {
        applyResendCooldown(Date.now() + PROD_RATE_LIMIT_COOLDOWN_MS);
        setStatus('Too many resend attempts. Please wait a few minutes and check spam before trying again.', true);
        return;
      }

      setResendButton(false);
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
      return false;
    }
    broadcastRouteStart();

    // First check billing status to see if user already has an active subscription or trial
    try {
      const idToken = await authManager.getCurrentUser()?.getIdToken?.(true);
        if (idToken) {
          const billingRes = await fetch('/api/billing-status?force=1', {
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
              return true;
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
          body: JSON.stringify({ plan, startTrial: plan === 'trial', forceNew: plan === 'trial' })
        });
        const data = await res.json();
        if (data && data.ok && data.url) { window.location.href = data.url; return true; }
      } catch (err) {
        console.error('Checkout error from verify-email flow:', err);
      }
      window.location.href = 'pricing-a.html';
      return true;
    } else {
      try {
        sessionStorage.removeItem('selectedPlan');
        localStorage.removeItem('selectedPlan');
      } catch (_) {}
      window.location.href = 'dashboard.html';
      return true;
    }
  }
});
