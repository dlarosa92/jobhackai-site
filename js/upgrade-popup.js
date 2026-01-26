// Upgrade popup logic shared across dashboard variants
(function () {
  const POPUP_SHOWN_KEY = 'upgrade-popup-shown';
  const MAX_SHOW_ATTEMPTS = 3;
  const FADE_OUT_MS = 300;

  function setLocalSeen() {
    try {
      localStorage.setItem(POPUP_SHOWN_KEY, 'true');
    } catch (e) {
      console.warn('[UPGRADE-BANNER] Could not save popup state to localStorage:', e);
    }
  }

  function hasLocalSeen() {
    try {
      return localStorage.getItem(POPUP_SHOWN_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  async function getIdTokenWithRetry({ attempt = 1, maxAttempts = 3 } = {}) {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const user = window.FirebaseAuthManager?.getCurrentUser?.();
    if (user && typeof user.getIdToken === 'function') {
      return user.getIdToken();
    }
    if (attempt < maxAttempts) {
      await wait(300);
      return getIdTokenWithRetry({ attempt: attempt + 1, maxAttempts });
    }
    return null;
  }

  async function checkUpgradePopupSeenServerSide({ attempt = 1, maxAttempts = 3 } = {}) {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    try {
      const idToken = await getIdTokenWithRetry();
      if (!idToken) {
        console.warn('[UPGRADE-BANNER] No Firebase token available for server-side check after retries');
        return 'unknown';
      }

      const response = await fetch('/api/user-preferences?preference=upgradePopupSeen', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        return data.value === true ? 'seen' : 'not_seen';
      }

      if (response.status >= 500 || response.status === 429) {
        if (attempt < maxAttempts) {
          await wait(300 * attempt);
          return checkUpgradePopupSeenServerSide({ attempt: attempt + 1, maxAttempts });
        }
      }

      console.warn('[UPGRADE-BANNER] Unexpected server response for upgradePopupSeen:', response.status);
      return 'unknown';
    } catch (error) {
      if (attempt < maxAttempts) {
        await wait(300 * attempt);
        return checkUpgradePopupSeenServerSide({ attempt: attempt + 1, maxAttempts });
      }
      console.warn('[UPGRADE-BANNER] Failed to check server-side popup status:', error);
      return 'unknown';
    }
  }

  async function markUpgradePopupSeenServerSide() {
    try {
      const idToken = await getIdTokenWithRetry();
      if (!idToken) {
        console.warn('[UPGRADE-BANNER] No Firebase token available for server-side update');
        return false;
      }

      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          preference: 'upgradePopupSeen',
          value: true
        })
      });

      if (response.ok) {
        console.log('[UPGRADE-BANNER] Successfully marked upgrade popup as seen on server');
        return true;
      }
      console.warn('[UPGRADE-BANNER] Failed to mark upgrade popup as seen on server:', response.status);
      return false;
    } catch (error) {
      console.warn('[UPGRADE-BANNER] Failed to update server-side popup status:', error);
      return false;
    }
  }

  function getPlanName(plan) {
    return plan === 'trial' ? '3-day trial'
      : plan === 'essential' ? 'Essential plan'
      : plan === 'pro' ? 'Pro plan'
      : plan === 'premium' ? 'Premium plan'
      : 'plan';
  }

  function getContentText(plan) {
    if (plan === 'trial') {
      return 'You now have 3 resume feedback assessments (inclusive of ATS scans) and unlimited interview questions. Some features remain locked until you upgrade to a paid plan.';
    }
    return 'You now have access to all features included in your plan. Upload resumes for ATS scoring, get detailed feedback, and generate unlimited interview questions.';
  }

  function buildPopup({ userName, messageText, contentText, onComplete }) {
    const popupHTML = `
      <div class="upgrade-popup-overlay" id="upgrade-popup-overlay">
        <div class="upgrade-popup-modal">
          <button class="close-btn" id="upgrade-popup-close" aria-label="Close">×</button>
          <h2>Hi, ${userName || 'User'}</h2>
          <div class="popup-message">
            ${messageText}
          </div>
          <div class="popup-content">
            <p>${contentText}</p>
          </div>
          <button class="popup-ok-btn" id="upgrade-popup-ok">OK</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
    const overlay = document.getElementById('upgrade-popup-overlay');
    const closeBtn = document.getElementById('upgrade-popup-close');
    const okBtn = document.getElementById('upgrade-popup-ok');

    const escapeKeyHandler = function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('show')) {
        closePopup();
      }
    };

    async function closePopup() {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', escapeKeyHandler);

      // Set localStorage immediately so we don't lose it on navigation
      setLocalSeen();

      // Best-effort server sync (non-blocking)
      markUpgradePopupSeenServerSide().then((success) => {
        if (!success) {
          console.warn('[UPGRADE-BANNER] Failed to save popup state to server, localStorage saved as fallback');
        }
      });

      setTimeout(() => {
        overlay.remove();
        if (onComplete) onComplete();
      }, FADE_OUT_MS);
    }

    // Show popup with fade-in animation
    setTimeout(() => {
      overlay.classList.add('show');
    }, 100);

    closeBtn.addEventListener('click', closePopup);
    okBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closePopup();
      }
    });

    document.addEventListener('keydown', escapeKeyHandler);
  }

  async function showUpgradePopup({ user, wasFreeAccount, hadResumeUpload, attempt = 1, onComplete = null, _queued = false } = {}) {
    if (!user || !user.plan) {
      if (onComplete) onComplete();
      return;
    }

    // Use shared popup queue if available to avoid overlaps
    if (!_queued && window.JobHackAIPopupQueue?.enqueue) {
      window.JobHackAIPopupQueue.enqueue((done) => {
        showUpgradePopup({
          user,
          wasFreeAccount,
          hadResumeUpload,
          attempt,
          onComplete: () => {
            if (onComplete) onComplete();
            done();
          },
          _queued: true
        });
      });
      return;
    }

    const hasUpgradedPlan = user.plan === 'trial' || user.plan === 'essential' || user.plan === 'pro' || user.plan === 'premium';
    if (!hasUpgradedPlan) {
      if (onComplete) onComplete();
      return;
    }

    if (!wasFreeAccount) {
      if (onComplete) onComplete();
      return;
    }

    const serverStatus = await checkUpgradePopupSeenServerSide();
    if (serverStatus === 'seen') {
      setLocalSeen();
      if (onComplete) onComplete();
      return;
    }

    if (serverStatus === 'unknown') {
      if (hasLocalSeen()) {
        markUpgradePopupSeenServerSide().catch((err) =>
          console.warn('[UPGRADE-BANNER] Background sync to server failed:', err)
        );
        if (onComplete) onComplete();
        return;
      }
      if (attempt < MAX_SHOW_ATTEMPTS) {
        console.warn('[UPGRADE-BANNER] Deferring popup due to unknown server state; retrying soon');
        setTimeout(() => {
          showUpgradePopup({ user, wasFreeAccount, hadResumeUpload, attempt: attempt + 1, onComplete, _queued: true });
        }, 700 * attempt);
        return;
      }
      console.warn('[UPGRADE-BANNER] Aborting popup after repeated unknown server status');
      if (onComplete) onComplete();
      return;
    }

    if (hasLocalSeen()) {
      markUpgradePopupSeenServerSide().catch((err) =>
        console.warn('[UPGRADE-BANNER] Background sync to server failed:', err)
      );
      if (onComplete) onComplete();
      return;
    }

    const planName = getPlanName(user.plan);
    const messageText = hadResumeUpload
      ? `Your previous ATS resume score from your free account is still available. Welcome to your ${planName}!`
      : `Welcome to your ${planName}!`;
    const contentText = getContentText(user.plan);

    console.log(`✅ [UPGRADE-BANNER] Showing banner - user upgraded from free to ${user.plan}${hadResumeUpload ? ' and uploaded resume' : ' (no resume uploaded)'}`);
    buildPopup({
      userName: user.name,
      messageText,
      contentText,
      onComplete
    });
  }

  window.JobHackAIUpgradePopup = {
    showUpgradePopup
  };
})();
