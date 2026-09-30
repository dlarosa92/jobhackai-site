// Count only a provider-confirmed account creation, never a returning login.
// The shared wrapper owns consent and strips unapproved tracking entirely.
const recordedUsers = new Set();
export async function recordVerifiedSignup(user, isNewUser, method) {
  if (isNewUser !== true || !user?.uid || !['google', 'linkedin'].includes(method)) return false;
  const analytics = window.JHA;
  if (!analytics?.trackEventSafe || recordedUsers.has(user.uid)) return false;
  try {
    recordedUsers.add(user.uid);
    analytics.gtagSafe?.('set', { user_id: user.uid });
    analytics.trackEventSafe('sign_up', { method, transport_type: 'beacon' });
    await analytics.cookieConsent?.flushAnalyticsBeforeNavigate?.();
    return true;
  } catch (_) { return false; } // Measurement cannot block authentication.
}

// The callback records this one-use receipt only after Firebase confirms a new
// LinkedIn account. A restored login alone is never evidence of account creation.
export async function recordLinkedInRedirectSignup(user) {
  if (!user?.uid) return false;
  try {
    const key = 'jha_linkedin_signup_receipt';
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return false;
    window.sessionStorage.removeItem(key);
    const receipt = JSON.parse(raw);
    if (receipt.uid !== user.uid || receipt.isNewUser !== true || !Number.isSafeInteger(receipt.at)
      || receipt.at > Date.now() || Date.now() - receipt.at > 15 * 60 * 1000) return false;
    return await recordVerifiedSignup(user, true, 'linkedin');
  } catch (_) { return false; }
}
