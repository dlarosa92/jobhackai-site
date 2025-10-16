<!-- d0c26e4c-082e-4343-a755-3058e69b8439 2d5eb1ed-7819-4ef8-953f-089658fb50ed -->
# Stop Login Dashboard Loop - Singleton Auth Ready Pattern

## Root Cause

Firebase auth is initialized multiple times, and different scripts check `auth.currentUser` before Firebase has finished its initial auth state determination, causing race conditions where:

- Login page sees user → redirects to dashboard
- Dashboard loads before auth ready → sees no user → redirects to login
- Repeat infinitely

## Solution

1. Create single Firebase auth instance with `authReady()` promise
2. Gate ALL redirects behind `await authReady()`
3. Remove "No current user available - Retrying" loops
4. Add 2-second redirect guard to prevent ping-pong
5. Fix COOP headers for popup sign-in

## Implementation

### Phase 1: Create Singleton Firebase Client

**Create `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/firebase-client.js`:**

```javascript
// 🔧 VERSION: auth-ready-singleton-2025-10-16
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Import config from existing file
import { firebaseConfig } from './firebase-config.js';

// SINGLETON: one app instance across entire site
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Set persistence once
await setPersistence(auth, browserLocalPersistence);

// ONE-TIME promise that resolves after first auth state is known
let __authReadyPromise;
export function authReady() {
  if (__authReadyPromise) return __authReadyPromise;
  __authReadyPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
  return __authReadyPromise;
}

console.log('✅ Firebase client singleton initialized');
```

### Phase 2: Update firebase-auth.js to Use Singleton

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/firebase-auth.js`:**

- **Line 10-32**: Remove duplicate Firebase initialization, import from singleton instead:
```javascript
// Replace lines 10-32 with:
import { auth, authReady } from './firebase-client.js';
```

- Keep all other imports and the rest of the file as-is
- The existing `forceSignOut()` method is already good

### Phase 3: Update static-auth-guard.js to Wait for Auth

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/static-auth-guard.js`:**

- Wrap entire guard logic in async IIFE at top:
```javascript
import { auth, authReady } from './firebase-client.js';

(async () => {
  console.log('🔒 Static guard: waiting for authReady()');
  await authReady();
  
  const user = auth.currentUser;
  
  // Prevent redirect ping-pong
  if (!sessionStorage.getItem('justRedirected')) {
    if (!user) {
      sessionStorage.setItem('justRedirected', '1');
      setTimeout(() => sessionStorage.removeItem('justRedirected'), 2000);
      console.log('🔒 Guard: no user after authReady -> /login');
      location.replace('/login');
      return;
    }
  }
  
  // User authenticated, reveal page
  document.documentElement.classList.remove('auth-pending');
  console.log('✅ Guard: user authenticated, page revealed');
})();
```


### Phase 4: Update login-page.js to Wait for Auth

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/login-page.js`:**

- At top of `DOMContentLoaded`, add auth ready check:
```javascript
import { auth, authReady } from './firebase-client.js';

document.addEventListener('DOMContentLoaded', async function() {
  console.log('🔐 login-page: waiting for authReady()');
  await authReady();
  
  const user = auth.currentUser;
  
  // If already authenticated, redirect to dashboard
  if (user && !sessionStorage.getItem('justRedirected')) {
    sessionStorage.setItem('justRedirected', '1');
    setTimeout(() => sessionStorage.removeItem('justRedirected'), 2000);
    console.log('✅ login-page: user present after authReady -> /dashboard');
    location.replace('/dashboard');
    return;
  }
  
  // Continue with existing login UI setup...
  // (rest of existing code)
});
```


### Phase 5: Update navigation.js Plan Reconciliation

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/navigation.js`:**

- Import singleton at top:
```javascript
import { auth, authReady } from './firebase-client.js';
```

- Find `reconcilePlanFromKV()` function (around line 1270) and replace retry logic:
```javascript
async function reconcilePlanFromKV() {
  console.log('🔍 fetchKVPlan: waiting for authReady()');
  await authReady();
  
  const user = auth.currentUser;
  if (!user) {
    console.log('⏸️ fetchKVPlan: no user after authReady; skipping (no retries)');
    return null;
  }
  
  // Existing fetchKVPlan logic continues...
  console.log('🔍 fetchKVPlan: Fetching plan from API...');
  // ... rest of existing code
}
```

- **REMOVE** the retry loop (lines with "No current user available -> Retrying in Xms")

### Phase 6: Update firebase-auth.js Auth State Listener

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/js/firebase-auth.js`:**

- Find `onAuthStateChanged` callback (around line 150) and ensure it does NOT redirect, only syncs localStorage:
```javascript
onAuthStateChanged(auth, async (user) => {
  console.log('🔥 Firebase auth state changed:', user ? `User: ${user.email}` : 'No user');
  
  // Sync localStorage only - let guards handle redirects
  if (user) {
    localStorage.setItem('user-authenticated', 'true');
    localStorage.setItem('user-email', user.email || '');
  } else {
    localStorage.setItem('user-authenticated', 'false');
    localStorage.removeItem('user-email');
  }
  
  // DO NOT redirect here - guards handle it after authReady()
});
```


### Phase 7: Add COOP Header for Popup Sign-in

**Edit `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/app/public/_headers`:**

Add at the top (before existing rules):

```
/login
  Cross-Origin-Opener-Policy: same-origin-allow-popups

/login.html
  Cross-Origin-Opener-Policy: same-origin-allow-popups
```

This prevents Firebase popup sign-in errors while keeping security.

### Phase 8: Update HTML Script Tags

**Edit these files to load firebase-client.js FIRST:**

- `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/dashboard.html`
- `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/login.html`
- `/Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/index.html`

Change script versions to `v=20251016-5` and add firebase-client.js:

```html
<!-- Load singleton FIRST -->
<script type="module" src="js/firebase-client.js?v=20251016-5"></script>
<!-- Then load other auth modules -->
<script type="module" src="js/firebase-auth.js?v=20251016-5"></script>
<script src="js/static-auth-guard.js?v=20251016-5"></script>
<script src="js/navigation.js?v=20251016-5"></script>
<script type="module" src="js/login-page.js?v=20251016-5"></script>
```

### Phase 9: Build and Deploy

```bash
cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/app
npm run build
npm run deploy:qa
```

Verify deployment to https://dev.jobhackai.io

## Verification Checklist

**Console Logs (in order):**

1. On `/login` load: "🔐 login-page: waiting for authReady()"
2. No more "fetchKVPlan: No current user available" retries
3. On sign-in: ONE redirect from /login → /dashboard (not a loop)
4. On `/dashboard`: "🔒 Static guard: waiting for authReady()" then "✅ Guard: user authenticated"

**Manual Test:**

1. Fresh incognito window
2. Go to https://dev.jobhackai.io/login
3. Sign in with Google (popup should work without COOP errors)
4. Should redirect to /dashboard ONCE and stay there
5. Hard refresh /dashboard → should stay on /dashboard
6. Click logout → should go to /login and stay there

## Success Criteria

- ✅ No login/dashboard redirect loop
- ✅ No "No current user available - Retrying" logs
- ✅ All redirects happen ONLY after `await authReady()`
- ✅ Firebase popup sign-in works (no COOP errors)
- ✅ Logout works (stays on /login)
- ✅ Scripts cache-busted to v=20251016-5

### To-dos

- [ ] Search codebase for all logout/signOut references and report findings
- [ ] Replace forceSignOut() in firebase-auth.js with enhanced version
- [ ] Replace all raw signOut() calls with forceSignOut()
- [ ] Update logout link in components/navigation.html
- [ ] Replace logout() in navigation.js with legacy shim
- [ ] Add idempotent click interceptor to navigation.js
- [ ] Update universal-logout.js and static-auth-guard.js to use /login
- [ ] Create app/public/_headers with no-store cache policy
- [ ] Update script version params to v=20251016-4
- [ ] Run npm build and deploy:qa
- [ ] Manual verification: test logout flow and 15s check