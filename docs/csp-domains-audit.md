# CSP Domains Audit - Complete Reference

This document lists every domain required in the Content Security Policy (CSP) and where it's used in the codebase.

**Last Updated:** 2025-11-02  
**Purpose:** Prevent authentication breakage by documenting all required domains

---

## Script Sources (`script-src`)

### Required Domains

1. **`https://www.gstatic.com`**
   - **Usage:** Firebase SDK imports
   - **Files:**
     - `js/firebase-auth.js` - Line 31: `import ... from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"`
     - `js/firebase-auth.js` - Line 33: `import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"`
     - `js/firebase-config.js` - Line 6: Firebase app initialization
     - `js/auth-action.js` - Line 6, 12: Firebase auth imports
     - `js/firestore-profiles.js` - Line 6, 15: Firestore imports
   - **Critical:** YES - Without this, Firebase SDK won't load

2. **`https://apis.google.com`**
   - **Usage:** Google Sign-In JavaScript SDK
   - **Files:**
     - Used implicitly by Firebase Auth when calling `signInWithPopup` with GoogleAuthProvider
   - **Critical:** YES - Required for Google OAuth popup

3. **`https://js.stripe.com`**
   - **Usage:** Stripe.js for payment processing
   - **Files:**
     - Referenced in CSP policy
   - **Critical:** YES - Required for Stripe checkout

4. **`'self'`**
   - **Usage:** Local scripts from your domain
   - **Critical:** YES

5. **`'unsafe-inline'`**
   - **Usage:** Inline scripts (required for some legacy code)
   - **Note:** Consider removing in future for better security
   - **Critical:** YES (temporarily)

---

## Connection Sources (`connect-src`)

### Required Domains

1. **`https://identitytoolkit.googleapis.com`**
   - **Usage:** Firebase Authentication API
   - **Files:**
     - `app/functions/api/auth.ts` - Line 18: Token verification endpoint
     - Firebase SDK makes calls here for authentication
   - **Critical:** YES - Required for all Firebase auth operations

2. **`https://securetoken.googleapis.com`**
   - **Usage:** Firebase token refresh endpoint
   - **Files:**
     - Used by Firebase SDK automatically for token refresh
   - **Critical:** YES - Required to keep users logged in

3. **`https://www.googleapis.com`**
   - **Usage:** General Google APIs, including JWKS endpoint
   - **Files:**
     - `app/functions/_lib/firebase-auth.js` - Line 7: JWKS endpoint for JWT verification
     - `functions/_lib/firebase-auth.js` - Line 7: Same JWKS endpoint
   - **Critical:** YES - Required for JWT verification in Workers

4. **`https://firebase.googleapis.com`** ⚠️ **PREVIOUSLY MISSING**
   - **Usage:** Firebase SDK API calls
   - **Files:**
     - Used by Firebase SDK for various operations
   - **Critical:** YES - This was missing and broke auth

5. **`https://firebaseinstallations.googleapis.com`** ⚠️ **PREVIOUSLY MISSING**
   - **Usage:** Firebase Installation service
   - **Files:**
     - Used by Firebase SDK to track app installations
   - **Critical:** YES - This was missing and broke auth

6. **`https://www.gstatic.com`** ⚠️ **PREVIOUSLY MISSING FROM connect-src**
   - **Usage:** Additional Firebase SDK network calls
   - **Files:**
     - Used by Firebase SDK for configuration and initialization
   - **Critical:** YES - May be needed for Firebase SDK initialization

7. **`https://api.stripe.com`**
   - **Usage:** Stripe API endpoints
   - **Files:**
     - Used for checkout session creation, webhooks
   - **Critical:** YES - Required for payment processing

8. **`https://checkout.stripe.com`**
   - **Usage:** Stripe checkout redirect URLs
   - **Files:**
     - Used after creating checkout sessions
   - **Critical:** YES - Required for Stripe checkout

9. **`'self'`**
   - **Usage:** API calls to your own domain
   - **Critical:** YES

---

## Frame Sources (`frame-src`)

### Required Domains

1. **`https://apis.google.com`** ⚠️ **PREVIOUSLY MISSING**
   - **Usage:** Google OAuth popup/iframe
   - **Files:**
     - Used when `signInWithPopup` is called with GoogleAuthProvider
   - **Critical:** YES - Required for Google OAuth to work

2. **`https://*.firebaseapp.com`** ⚠️ **PREVIOUSLY MISSING**
   - **Usage:** Firebase auth domain redirects
   - **Config:**
     - `js/firebase-config.js` - Line 15: `authDomain: "jobhackai-90558.firebaseapp.com"`
   - **Critical:** YES - Required for OAuth redirect flows

3. **`https://checkout.stripe.com`**
   - **Usage:** Stripe checkout iframe
   - **Critical:** YES - Required for Stripe checkout

4. **`https://js.stripe.com`**
   - **Usage:** Stripe.js iframe (if used)
   - **Critical:** YES - Required for Stripe integration

5. **`'self'`**
   - **Usage:** Local iframes (if any)
   - **Critical:** YES

---

## Style Sources (`style-src`)

1. **`https://fonts.googleapis.com`**
   - **Usage:** Google Fonts CSS
   - **Files:**
     - `index.html` - Line 9: `<link href="https://fonts.googleapis.com/css2?..."`
   - **Critical:** YES - Required for fonts to load

2. **`'self'`**
   - **Usage:** Local stylesheets
   - **Critical:** YES

3. **`'unsafe-inline'`**
   - **Usage:** Inline styles
   - **Note:** Consider removing in future
   - **Critical:** YES (temporarily)

---

## Image Sources (`img-src`)

1. **`'self'`**
2. **`data:`** - For data URIs (base64 images)
3. **`https:`** - Allow all HTTPS images (needed for various CDNs)

---

## Font Sources (`font-src`)

1. **`https://fonts.gstatic.com`**
   - **Usage:** Google Fonts font files
   - **Critical:** YES - Required for custom fonts

2. **`'self'`**
   - **Usage:** Local font files
   - **Critical:** YES

---

## Other CSP Directives

1. **`default-src`**
   - Fallback for any directive not explicitly set
   - Includes: `'self'`, `https://fonts.googleapis.com`, `https://fonts.gstatic.com`

2. **`object-src 'none'`**
   - Blocks all object/embed/applet tags (security best practice)

3. **`base-uri 'self'`**
   - Restricts base tag URLs to same origin

4. **`form-action 'self'`**
   - Restricts form submissions to same origin

5. **`upgrade-insecure-requests`**
   - Automatically upgrades HTTP to HTTPS

---

## Domains That Were Missing (Caused Auth Breakage)

1. ✅ `https://firebase.googleapis.com` - Added to `connect-src`
2. ✅ `https://firebaseinstallations.googleapis.com` - Added to `connect-src`
3. ✅ `https://www.gstatic.com` - Added to `connect-src`
4. ✅ `https://apis.google.com` - Added to `frame-src`
5. ✅ `https://*.firebaseapp.com` - Added to `frame-src`

---

## Testing Checklist

After updating CSP, verify:

- [ ] Google OAuth sign-in works (popup opens and completes)
- [ ] Email/password authentication works
- [ ] Token refresh works (user stays logged in)
- [ ] No CSP violations in browser console
- [ ] Stripe checkout works
- [ ] All pages load without errors
- [ ] Firebase SDK initializes correctly
- [ ] No blocked network requests in DevTools Network tab

---

## How to Test CSP Changes

1. Open browser DevTools → Console
2. Navigate to login page
3. Attempt Google OAuth sign-in
4. Watch for CSP violations (red errors)
5. Check Network tab for blocked requests
6. Test email/password authentication
7. Verify user stays logged in (token refresh)

---

## Reference Links

- [Firebase Auth Documentation](https://firebase.google.com/docs/auth)
- [Google OAuth Requirements](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [MDN CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

