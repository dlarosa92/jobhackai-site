# Prompt: Fix Critical Security Vulnerabilities for Production

## Context
I've completed a comprehensive QA security audit of the dev0 → develop deployment on qa.jobhackai.io. The application is functional but has **3 CRITICAL security vulnerabilities** that must be fixed before production deployment.

## Your Task
Implement security fixes for all **CRITICAL** and **HIGH** priority vulnerabilities identified in the audit. The complete audit report is in `QA_SECURITY_AUDIT_REPORT.md`.

---

## 🔴 CRITICAL FIXES (DO THESE FIRST)

### Fix 1: Eliminate XSS Vulnerabilities

**Problem:** Multiple instances of `innerHTML` assignments with potentially user-controlled data.

**Affected Files:**
- `app/public/dashboard.html` (lines 761-856)
- `js/navigation.js` (lines 687-689)
- `js/self-healing.js` (lines 24-27, 41-43)
- `js/login-page.js` (password toggle icons)

**Solution:**
Replace all unsafe `innerHTML` assignments with safe alternatives:

1. **For static SVG content** (login-page.js, auth-action.js):
   ```javascript
   // REPLACE THIS:
   icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>`;
   
   // WITH THIS:
   icon.textContent = ''; // Clear first
   const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
   path.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
   icon.appendChild(path);
   ```

2. **For dynamic feature HTML** (dashboard.html):
   ```javascript
   // INSTEAD OF:
   featuresHtml += `<div class="feature-title">${feature.title}</div>`;
   
   // USE TEXT CONTENT OR ESCAPE:
   const title = escapeHtml(feature.title); // Add helper function
   featuresHtml += `<div class="feature-title">${title}</div>`;
   
   // OR better yet, use DOM methods:
   const titleDiv = document.createElement('div');
   titleDiv.className = 'feature-title';
   titleDiv.textContent = feature.title;
   ```

3. **Add HTML escaping helper:**
   ```javascript
   function escapeHtml(text) {
     const div = document.createElement('div');
     div.textContent = text;
     return div.innerHTML;
   }
   ```

4. **For error messages** (self-healing.js, navigation.js):
   ```javascript
   // REPLACE:
   msgDiv.innerHTML = errors.map(e => ...).join('');
   
   // WITH:
   msgDiv.textContent = ''; // Clear
   errors.forEach(error => {
     const div = document.createElement('div');
     div.textContent = error;
     msgDiv.appendChild(div);
   });
   ```

**Verification:** Search codebase for all `innerHTML` usage and verify each is safe or replaced.

---

### Fix 2: Add Content Security Policy

**File:** `app/public/_headers`

**Add this at the TOP of the file (before other rules):**

```
# Content Security Policy - Must be first
/*
  Content-Security-Policy: default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.stripe.com https://checkout.stripe.com https://www.googleapis.com; frame-src 'self' https://checkout.stripe.com https://js.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=*
```

**Important Notes:**
- CSP must be added FIRST (before other /* rules)
- `unsafe-inline` is required for inline scripts/styles (gradually remove this later)
- `js.stripe.com` is needed for Stripe.js
- Test thoroughly after adding CSP

**Verification:** After deployment, check headers with:
```bash
curl -I https://dev.jobhackai.io/ | grep -i "content-security-policy"
```

---

### Fix 3: Implement Rate Limiting

**File:** `app/functions/_middleware.js` (create if doesn't exist, or update existing)

**Add rate limiting middleware:**

```javascript
export async function onRequest(context) {
  const { request, env, next } = context;
  
  // Rate limiting for API endpoints
  if (request.url.includes('/api/')) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const endpoint = new URL(request.url).pathname;
    const key = `rate_limit:${ip}:${endpoint}`;
    
    const count = await env.JOBHACKAI_KV.get(key);
    const limit = endpoint.includes('stripe-checkout') || endpoint.includes('billing-portal') ? 20 : 100;
    
    if (count && parseInt(count) >= limit) {
      console.log(`⚠️ Rate limit exceeded: ${ip} on ${endpoint}`);
      return new Response(
        JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }),
        { 
          status: 429,
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60'
          } 
        }
      );
    }
    
    // Increment counter
    await env.JOBHACKAI_KV.put(key, String(parseInt(count || '0') + 1), { 
      expirationTtl: 60 // 1 minute window
    });
  }
  
  // Continue with request
  return next();
}
```

**Configuration:**
- 100 requests/minute for most endpoints
- 20 requests/minute for Stripe checkout/billing (more restrictive)

**Verification:** Test with rapid API calls and verify 429 responses after limit.

---

## 🟠 HIGH PRIORITY FIXES

### Fix 4: Add Input Validation

**Files:** `js/login-page.js`, all API endpoints

**Add client-side validation:**

```javascript
// Add to login-page.js
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return password.length >= 8 && 
         /[A-Z]/.test(password) && 
         /[a-z]/.test(password) && 
         /[0-9]/.test(password);
}

// Use before API calls:
const email = document.getElementById('loginEmail').value.trim();
if (!isValidEmail(email)) {
  showError(loginError, 'Please enter a valid email address.');
  return;
}
```

**Add server-side validation in all API endpoints:**

```javascript
// Example for stripe-checkout.js
if (!plan || !['trial', 'essential', 'pro', 'premium'].includes(plan)) {
  return json({ ok: false, error: 'Invalid plan' }, 400, origin, env);
}

// Validate email format
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return json({ ok: false, error: 'Invalid email format' }, 400, origin, env);
}
```

---

### Fix 5: Email Verification Enforcement

**Problem:** `static-auth-guard.js` checks localStorage presence, not actual verification status.

**File:** `js/static-auth-guard.js`

**Improve verification check:**

```javascript
async function checkEmailVerification() {
  try {
    const auth = firebase.auth();
    const user = auth.currentUser;
    
    if (user && !user.emailVerified) {
      // Force redirect to email verification
      location.replace('/verify-email.html');
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Use before allowing access to protected pages
const isVerified = await checkEmailVerification();
if (!isVerified) {
  location.replace('/verify-email.html');
  return;
}
```

---

### Fix 6: Session Management

**Add session timeout and token refresh:**

**File:** `js/firebase-auth.js` (or create new session manager)

```javascript
// Add session timeout
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let sessionTimer;

function resetSessionTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    console.log('⏱️ Session expired due to inactivity');
    authManager.signOut();
    location.replace('/login.html?expired=1');
  }, SESSION_TIMEOUT);
}

// Reset timer on any user activity
document.addEventListener('click', resetSessionTimer);
document.addEventListener('keypress', resetSessionTimer);

// Initial timer
resetSessionTimer();
```

---

## 🔍 Testing Requirements

After implementing fixes:

1. **Build and deploy to dev environment**
2. **Run all automated tests:**
   ```bash
   cd app && ./scripts/verify-deployment.sh dev
   ```

3. **Manual browser testing:**
   - Test login/signup flows
   - Verify CSP doesn't break any functionality
   - Test rate limiting with rapid requests
   - Verify XSS fixes with malicious input

4. **Security re-audit:**
   - Re-scan for `innerHTML` usage
   - Verify CSP headers present
   - Test rate limiting thresholds
   - Check for console CSP violations

---

## 📋 Checklist

**Before Production:**
- [ ] All `innerHTML` usage reviewed and replaced
- [ ] CSP headers added and tested
- [ ] Rate limiting implemented and tested
- [ ] Input validation added to all forms/APIs
- [ ] Email verification enforced
- [ ] Session timeout added
- [ ] All automated tests passing
- [ ] Manual browser testing complete
- [ ] No CSP violations in console
- [ ] Security re-audit passed

---

## 📊 Expected Results

After fixes:
- **No XSS vulnerabilities** in security scan
- **CSP headers present** in all responses
- **Rate limiting active** on all API endpoints
- **Input validation** catches invalid data
- **Email verification enforced** on protected pages
- **Session management** handles timeouts
- **Security grade improved** from C+ to A-

---

## 🎯 Priority Order

1. **Day 1:** Fix XSS vulnerabilities (highest risk)
2. **Day 1:** Add CSP headers (quick win)
3. **Day 2:** Implement rate limiting
4. **Day 2:** Add input validation
5. **Day 3:** Fix email verification
6. **Day 3:** Add session management
7. **Day 4:** Comprehensive testing
8. **Day 5:** Re-audit and deploy

---

## 📞 Questions?

Refer to the full audit report in `QA_SECURITY_AUDIT_REPORT.md` for detailed explanations, code examples, and security rationale for each issue.

---

**Status:** Ready to implement  
**Estimated Time:** 3-5 days  
**Priority:** CRITICAL before production deployment
