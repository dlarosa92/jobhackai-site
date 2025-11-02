<!-- 758f874f-b74e-4691-bf27-4bd753c2773a e8940199-8621-4b7b-b360-0d924353b706 -->
# Fix Authentication Verification and State Management Issues

## Overview

This plan addresses critical security and UX bugs: unverified email/password users accessing protected areas via navigation, stale localStorage after logout/account deletion, broken forgot password click handler, and copy display inconsistencies.

## Core Issues Identified

### 1. Email Verification Enforcement Gaps

- ✅ Good: Login/signup flows check verification in `login-page.js`
- ✅ Good: `verify-email.js` reloads user state before routing
- ❌ Bad: No global guard on `dashboard.html` or other gated pages
- ❌ Bad: Navigation renders "Dashboard" link before verification check
- ❌ Bad: Stripe checkout can start without verification check

### 2. Stale State After Logout

- ✅ Good: `signOut()` clears some keys
- ❌ Bad: Doesn't clear: `selected-plan`, `selected-plan-ts`, `selected-plan-context`, `user-db`, `user-db-backup`, `creditsByUid:*`, `subscription-active`, `trial-activated`, `plan-amount`
- This causes new accounts with same email to inherit old plan data

### 3. Forgot Password Handler

- ❌ Bad: Direct element listener bound in DOMContentLoaded before form toggle
- When user lands on signup mode, `#forgotPasswordLink` isn't in DOM yet, so listener never attaches
- After switching to login mode, the link exists but has no handler

### 4. Copy Toggle

- ✅ Good: `showSignupForm()` and `showLoginForm()` exist
- ✅ Good: HTML has `#loginLinks` and `#signupLinks` elements
- Need to verify these are properly hidden/shown

## Implementation Steps

### Step 1: Add `requireVerifiedUser()` Guard Function

**File:** `app/out/js/firebase-auth.js`

Add new exported function before the exports at bottom:

```javascript
/**
 * Global verification guard for protected pages
 * Redirects unverified email/password users to verify-email.html
 * @returns {Promise<User|null>} Verified user or null if redirected
 */
async function requireVerifiedUser() {
  // Wait for auth state to settle
  await authManager.waitForAuthReady(4000);

  const user = authManager.getCurrentUser();
  if (!user) {
    console.log('🚫 requireVerifiedUser: No user, redirecting to login');
    window.location.replace('login.html');
    return null;
  }

  // Social auth users (Google, etc.) bypass verification check
  if (!authManager.isEmailPasswordUser(user)) {
    console.log('✅ requireVerifiedUser: Social auth user, allowing access');
    return user;
  }

  // Force-refresh emailVerified state from Firebase
  try {
    await user.reload();
  } catch (e) {
    console.warn('requireVerifiedUser: reload failed', e);
  }

  // Re-read after reload
  const fresh = authManager.getCurrentUser();
  if (!fresh || !fresh.emailVerified) {
    console.log('🚫 requireVerifiedUser: Email not verified, redirecting');
    window.location.replace('verify-email.html');
    return null;
  }

  console.log('✅ requireVerifiedUser: User verified, allowing access');
  return fresh;
}
```

Update exports:

```javascript
export default authManager;
export { auth, UserDatabase, requireVerifiedUser };
```

### Step 2: Add Verification Guard to Dashboard

**File:** `app/out/dashboard.html`

Find the script section near bottom (after navigation.js loads) and add at the very start:

```html
<script type="module">
  import { requireVerifiedUser } from './js/firebase-auth.js';
  
  // Guard: only verified users can access dashboard
  (async () => {
    const user = await requireVerifiedUser();
    if (!user) return; // Already redirected
    
    console.log('✅ Dashboard: User verified, continuing initialization');
  })();
</script>
```

### Step 3: Add Verification Guard Before Stripe Checkout

**File:** `app/out/js/login-page.js`

In `handlePostAuthRedirect()` function, add verification check before Stripe call:

```javascript
async function handlePostAuthRedirect(plan) {
  if (planRequiresPayment(plan)) {
    try {
      // SECURITY: Ensure user is verified before starting paid checkout
      const user = authManager.getCurrentUser();
      if (user && authManager.isEmailPasswordUser(user)) {
        await user.reload();
        const fresh = authManager.getCurrentUser();
        if (!fresh.emailVerified) {
          console.log('🚫 Checkout blocked: user not verified');
          // CRITICAL: Keep selected-plan in localStorage so after verification
          // they can immediately continue to checkout without re-selecting
          // Do NOT clear selected-plan, selected-plan-ts, or selected-plan-context here
          window.location.replace('verify-email.html');
          return;
        }
      }
      
      const idToken = await authManager.getCurrentUser()?.getIdToken?.(true);
      // ... rest of Stripe checkout logic
```

### Step 4: Harden Navigation to Check Verification

**File:** `app/out/js/navigation.js`

Find the `setAuthState(isAuthenticated, plan)` function (around line 400-600) and add verification check before rendering authenticated nav:

```javascript
async setAuthState(isAuthenticated, plan) {
  console.log(`setAuthState called: auth=${isAuthenticated}, plan=${plan}`);
  
  this.state.isAuthenticated = isAuthenticated;
  this.state.plan = plan || 'visitor';
  
  if (isAuthenticated) {
    // CRITICAL: Check if email/password user is verified before showing authenticated nav
    try {
      const user = window.FirebaseAuthManager?.currentUser;
      if (user && window.FirebaseAuthManager?.isEmailPasswordUser?.(user)) {
        await user.reload?.();
        const fresh = window.FirebaseAuthManager?.getCurrentUser?.();
        if (fresh && !fresh.emailVerified) {
          console.log('🚫 Nav: User not verified, limiting nav options');
          // Show limited nav: point "Dashboard" to verify-email instead
          this.state.needsVerification = true;
        } else {
          this.state.needsVerification = false;
        }
      }
    } catch (e) {
      console.warn('Nav verification check failed:', e);
    }
  }
  
  this.updateNavigation();
}
```

Then in `updateNavigation()` where dashboard link is rendered, wrap with verification check:

```javascript
// In authenticated nav rendering section:
if (this.state.needsVerification) {
  // Point to verify-email instead of dashboard
  navLinks.push({
    text: 'Verify Email',
    href: 'verify-email.html',
    highlight: true
  });
} else {
  // Normal dashboard link
  navLinks.push({
    text: 'Dashboard',
    href: 'dashboard.html'
  });
}
```

### Step 5: Comprehensive Logout Cleanup

**File:** `app/out/js/firebase-auth.js`

Replace the `signOut()` method in `AuthManager` class:

```javascript
async signOut() {
  try {
    await signOut(auth);
    
    // CRITICAL: Clear ALL user state to prevent stale data on re-signup
    const keysToClear = [
      'auth-user',
      'user-plan',
      'dev-plan',
      'user-email',
      'user-authenticated',
      'selected-plan',
      'selected-plan-ts',
      'selected-plan-context',
      'subscription-active',
      'trial-activated',
      'plan-amount',
      'user-db',
      'user-db-backup',
      'email-verified'
    ];

    keysToClear.forEach(k => localStorage.removeItem(k));

    // Clear credit balances keyed by uid
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('creditsByUid:') || k.startsWith('resend-verification:') || k.startsWith('forgot-throttle:'))) {
        localStorage.removeItem(k);
      }
    }

    // Remove Firebase SDK cached user keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('firebase:authUser:')) {
        localStorage.removeItem(key);
      }
    }

    // Sync navigation
    if (window.JobHackAINavigation?.setAuthState) {
      window.JobHackAINavigation.setAuthState(false, 'visitor');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: this.getErrorMessage(error) };
  }
}
```

### Step 6: Fix Forgot Password Click Handler with Event Delegation

**File:** `app/out/js/login-page.js`

Remove the direct listener (around line 3220):

```javascript
// DELETE THIS:
forgotPasswordLink?.addEventListener('click', function(e) {
  ...
});
```

Replace with delegated handler at the end of DOMContentLoaded (before closing brace):

```javascript
// Event delegation for forgot password (works even after form toggle)
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('#forgotPasswordLink');
  if (!trigger) return;

  e.preventDefault();
  hideError(loginError);

  if (forgotPasswordOverlay) forgotPasswordOverlay.style.display = 'flex';

  const currentLoginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
  if (forgotPasswordEmailInput) forgotPasswordEmailInput.value = currentLoginEmail;

  if (forgotPasswordError) {
    forgotPasswordError.style.display = 'none';
    forgotPasswordError.textContent = '';
  }
  if (forgotPasswordSuccess) {
    forgotPasswordSuccess.style.display = 'none';
  }
});
```

### Step 7: Verify Copy Toggle IDs Match

**File:** `app/out/login.html`

Verify these elements exist with correct IDs:

- Line ~349: `<div class="auth-links" id="loginLinks">`
- Line ~367: `<div class="auth-links" id="signupLinks" style="display:none;">`

These should be mutually exclusive. The JS already handles toggling correctly.

### Step 8: Enhance Logout UI to Force Hard Redirect

**File:** `app/out/js/universal-logout.js` (or wherever logout is triggered)

After calling `authManager.signOut()`, add:

```javascript
const result = await authManager.signOut();
if (result.success) {
  sessionStorage.setItem('logout-intent', '1');
  window.location.href = 'login.html'; // Hard navigation clears all state
}
```

### Step 9: Firebase Console Configuration Checklist

Add comment block to `app/out/js/auth-action.js` top:

```javascript
/**
 * FIREBASE CONSOLE CONFIGURATION REQUIRED:
 * 
 * 1. Go to Firebase Console > Authentication > Templates
 * 2. For "Email address verification" template:
 *    - Click "Edit template"
 *    - In "Action URL" section, set: https://dev.jobhackai.io/auth/action
 *    - Save changes
 * 3. For "Password reset" template:
 *    - Click "Edit template"  
 *    - In "Action URL" section, set: https://dev.jobhackai.io/auth/action
 *    - Save changes
 * 
 * This ensures verification and reset emails land on our branded first-party handler
 * instead of the default firebaseapp.com UI.
 */
```

### Step 10: Deploy to dev.jobhackai.io

After all code changes are applied:

```bash
cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site

# Ensure on dev0 branch
git checkout dev0
git status

# Stage modified files
git add app/out/js/firebase-auth.js
git add app/out/js/login-page.js  
git add app/out/js/navigation.js
git add app/out/js/auth-action.js
git add app/out/dashboard.html
git add app/out/login.html

# Commit changes
git commit -m "Fix: Add verification guards, comprehensive logout cleanup, delegated forgot password handler"

# Push to dev0
git push origin dev0

# Deploy /app directory to dev.jobhackai.io
cd app
npx wrangler pages deploy . --project-name=jobhackai --branch=dev0 --commit-dirty=true
```

## Acceptance Criteria

After deployment, verify on `https://dev.jobhackai.io`:

1. **Verification Enforcement:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Sign up with email/password → should land on verify-email.html
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Try navigating to /dashboard.html directly → should redirect to verify-email.html
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Click Dashboard in nav while unverified → should go to verify-email.html
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Try starting Stripe checkout while unverified → should redirect to verify-email.html

2. **Logout Cleanup:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Sign in, then logout → localStorage should be cleared of all user keys
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Sign up with same email after logout → should NOT inherit previous plan/credits
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Create account in Firebase Console, delete it, recreate with same email → fresh state

3. **Forgot Password:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Land on signup form → click "Already have account? Login" → click "Forgot password" → modal should open
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Refresh on login form → click "Forgot password" → modal should open
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Both scenarios should work without needing refresh

4. **Copy Display:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - On login form → should show "Don't have an account? Sign up"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - On signup form → should show "Already have an account? Back to Login"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Never show both at same time

5. **Navigation:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Logged out → see marketing nav (no Dashboard)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Logged in but unverified → nav shows "Verify Email" link instead of "Dashboard"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Logged in and verified → nav shows "Dashboard" link

## Files Modified

- `app/out/js/firebase-auth.js` - Add requireVerifiedUser(), harden signOut()
- `app/out/js/login-page.js` - Add verification check before Stripe, delegated forgot password
- `app/out/js/navigation.js` - Add verification check in setAuthState() and updateNavigation()
- `app/out/js/auth-action.js` - Add Firebase Console config checklist comment
- `app/out/dashboard.html` - Add requireVerifiedUser() guard at page load
- `app/out/login.html` - Verify loginLinks/signupLinks IDs

## Firebase Console Manual Step

After deployment, configure in Firebase Console:

- Authentication > Templates > "Email address verification" → Action URL: `https://dev.jobhackai.io/auth/action`
- Authentication > Templates > "Password reset" → Action URL: `https://dev.jobhackai.io/auth/action`

### To-dos

- [ ] Add requireVerifiedUser() function to firebase-auth.js and export it
- [ ] Add requireVerifiedUser() guard to dashboard.html page load
- [ ] Add verification check before Stripe checkout in login-page.js handlePostAuthRedirect()
- [ ] Update navigation.js setAuthState() to check verification and render appropriate nav links
- [ ] Replace signOut() method in firebase-auth.js to clear all user state including plan, credits, and db keys
- [ ] Replace direct element listener with delegated click handler for forgot password link in login-page.js
- [ ] Verify loginLinks and signupLinks IDs exist in login.html and are properly toggled
- [ ] Add Firebase Console configuration checklist comment to auth-action.js
- [ ] Commit changes and deploy /app directory from dev0 branch to dev.jobhackai.io