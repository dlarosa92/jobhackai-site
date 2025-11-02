<!-- 2861eeff-6db2-4005-9543-6b874a924ebf d467d6cd-907b-4467-8b0c-a78c56498240 -->
# Fix Logout Redirect and Account Settings Regression

## Root Causes Identified

### Issue 1: Logout Not Redirecting to Login

The logout function in `js/navigation.js` lines 409-411 includes visual feedback with a 300ms delay before redirecting to `login.html`. However, the self-healing system is detecting the cleared localStorage and interfering with the redirect, causing the user to stay on the current page or navigate elsewhere.

**Previous working code** (commit d9bb924): `location.replace('index.html')` with no visual feedback delay

**Current broken code** (commit cc62097): 300ms delay + visual feedback, then `location.replace('login.html')`

### Issue 2: Account Settings Billing Section Broken

The `account-setting.html` file at lines 547 and 414 tries to access:

- `UserProfileManager.getProfile()` - **ReferenceError: UserProfileManager is not defined**
- Firebase Firestore functions - **ReferenceError: firebase is not defined**

The file imports `js/firestore-profiles.js` as an ES6 module (line 377), but the module doesn't expose `UserProfileManager` to `window`, so it's not accessible from the inline script tag (lines 378-627).

This is a regression - the code structure hasn't changed, but the window export is missing from `firestore-profiles.js`.

## Implementation Plan

### 1. Fix logout redirect in `js/navigation.js`

**File:** `js/navigation.js` lines 394-411

**Problem:** Self-healing system interferes with visual feedback + delayed redirect

**Solution:** Make redirect immediate and synchronous, remove delayed setTimeout

- Keep visual feedback for better UX
- Make redirect happen immediately after feedback setup (no async delay)
- Update redirect target from `index.html` to `login.html` (per user's original request)

**Changes:**

```javascript
// Add visual feedback
document.body.style.opacity = '0.7';
document.body.style.transition = 'opacity 0.3s ease';

// Show logout message
const logoutMsg = document.createElement('div');
logoutMsg.style.cssText = `
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.8); color: white; padding: 1rem 2rem;
  border-radius: 8px; z-index: 10000; font-weight: 600;
`;
logoutMsg.textContent = 'Logging out...';
document.body.appendChild(logoutMsg);

// Redirect immediately (visual transition will happen during page unload)
location.replace('login.html');
```

### 2. Export UserProfileManager to window in `js/firestore-profiles.js`

**File:** `js/firestore-profiles.js` line 256

**Problem:** Module exports don't automatically expose to global window scope

**Solution:** Add window export after the export statement

**Changes:**

```javascript
export default UserProfileManager;

// Expose to window for non-module scripts
window.UserProfileManager = UserProfileManager;
```

### 3. Verify account-setting.html script loading order

**File:** `account-setting.html` lines 361-377

Confirm scripts are loaded in correct order:

1. Navigation system (line 361)
2. Firebase auth (line 376 - module)
3. Firestore profiles (line 377 - module)
4. Inline script that uses them (line 378+)

No changes needed - order is correct.

## Testing Plan

### Test 1: Logout Redirect

1. Log in to the app
2. Navigate to any authenticated page (dashboard, account settings, etc.)
3. Click logout from navigation menu
4. **Expected:** See "Logging out..." message briefly, then immediately redirect to login.html
5. **Verify:** User is logged out and on login page, not stuck on previous page

### Test 2: Account Settings Billing Section

1. Log in to the app
2. Navigate to account-setting.html
3. **Expected:** 

   - Profile information loads (name, email)
   - Billing section shows subscription details
   - "Manage Subscription" button appears for paid plans
   - No console errors about UserProfileManager or firebase

4. **Verify:** No "Error loading subscription details" message

### Test 3: No Regressions

1. Test login flow still works
2. Test dashboard loads correctly
3. Test plan detection still functions
4. Verify no new console errors

## Files to Modify

1. `js/navigation.js` - Fix logout redirect (remove setTimeout, make immediate redirect to login.html)
2. `js/firestore-profiles.js` - Add window.UserProfileManager export after line 256

## Success Criteria

- Logout redirects immediately to login.html before self-healing can interfere
- Account settings page loads profile and billing information without errors
- No console errors: "UserProfileManager is not defined" or "firebase is not defined"
- All existing functionality continues to work (login, dashboard, navigation)

## Deployment Steps

1. Run linter checks on modified files
2. Test logout from multiple pages (dashboard, account-setting, pricing)
3. Test account settings billing section loads correctly
4. Commit changes with descriptive message
5. Push to dev0 branch
6. Verify deployment on dev.jobhackai.io
7. Perform smoke tests on production

### To-dos

- [ ] Remove setTimeout from logout function in js/navigation.js and make redirect immediate to login.html
- [ ] Add window.UserProfileManager export in js/firestore-profiles.js after the default export
- [ ] Test logout from authenticated pages redirects to login.html immediately
- [ ] Test account-setting.html loads profile and billing without errors
- [ ] Verify login, dashboard, and navigation still work correctly
- [ ] Commit changes and push to dev0 branch for deployment