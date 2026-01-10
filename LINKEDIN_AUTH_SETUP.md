# LinkedIn Authentication Implementation Summary

## ✅ What's Been Completed

### 1. **Firebase Functions Created**
   - Created `functions/` directory with Firebase Cloud Function
   - Function handles LinkedIn OAuth callback, creates Firebase custom tokens
   - Located at: `functions/index.js`

### 2. **Frontend Code Updated**
   - Added `signInWithLinkedIn()` method to `js/firebase-auth.js`
   - Wired up LinkedIn button in `js/login-page.js`
   - Handles popup flow, plan selection, Firestore sync (same pattern as Google)

### 3. **Dependencies Installed**
   - Firebase Functions dependencies installed
   - Using Firebase Functions v2 with secrets support

### 4. **Branch Created**
   - Branch: `feature/linkedin-auth` (off `dev0`)
   - All changes committed to this branch

## 🔐 Next Steps (You Need To Do)

### Step 1: Login to Firebase CLI
```bash
firebase login
```

### Step 2: Set LinkedIn Secrets
```bash
# Set Client ID
echo -n "86v58h3j3qetn0" | firebase functions:secrets:set LINKEDIN_CLIENT_ID

# Set Client Secret (replace with your actual secret from LinkedIn Developer Console)
echo -n "YOUR_CLIENT_SECRET" | firebase functions:secrets:set LINKEDIN_CLIENT_SECRET

# Set API Key for token creation endpoint (generate a secure random key)
# Generate with: openssl rand -hex 32
echo -n "YOUR_GENERATED_API_KEY" | firebase functions:secrets:set LINKEDIN_TOKEN_API_KEY
```

**⚠️ SECURITY**: The `LINKEDIN_TOKEN_API_KEY` is a shared secret between Cloudflare Pages and Firebase Functions. It must:
- Be a strong random value (use `openssl rand -hex 32` to generate)
- Be set in both Firebase Functions secrets AND Cloudflare Pages secrets
- Match exactly in both places

**⚠️ CRITICAL SECURITY WARNING**: 
- **If a LinkedIn Client Secret was ever committed to git or shared publicly, it MUST be rotated immediately**
- Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) → Your App → Auth → Generate a new Client Secret
- **Delete the old secret** after generating the new one
- Use the NEW secret in the command above (never use an exposed secret)
- Secrets in git history remain accessible even after file removal - rotation is mandatory

### Step 3: Set Cloudflare Pages Secret
The same API key must be set in Cloudflare Pages secrets:
```bash
# Set the same API key in Cloudflare Pages (for dev environment)
wrangler pages secret put LINKEDIN_TOKEN_API_KEY --project-name=jobhackai-app-dev
# Enter the same value you used in Step 2

# For QA environment:
wrangler pages secret put LINKEDIN_TOKEN_API_KEY --project-name=jobhackai-app-qa

# For production:
wrangler pages secret put LINKEDIN_TOKEN_API_KEY --project-name=jobhackai-app-prod
```

### Step 4: Deploy the Functions
```bash
# Deploy both functions
firebase deploy --only functions:linkedinAuth,functions:linkedinCreateToken --project jobhackai-90558
```

This will deploy:
- `linkedinAuth`: `https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth`
- `linkedinCreateToken`: `https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinCreateToken`

### Step 5: Update LinkedIn Redirect URLs
1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
2. Select app: **jobhackai-auth**
3. Go to **Auth** → **OAuth 2.0 settings**
4. Add redirect URL:
   ```
   https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth
   ```

### Step 6: Test the Flow
1. Go to your login page
2. Click "Continue with LinkedIn"
3. Complete LinkedIn authorization
4. Verify you're signed in and redirected to dashboard

## 📋 Files Changed

### New Files:
- `functions/package.json` - Firebase Functions dependencies
- `functions/index.js` - LinkedIn OAuth callback handler
- `functions/.gitignore` - Ignore node_modules, secrets
- `firebase.json` - Firebase project configuration
- `.firebaserc` - Firebase project reference
- `functions/DEPLOYMENT.md` - Detailed deployment instructions

### Modified Files:
- `js/firebase-auth.js` - Added `signInWithLinkedIn()` method
- `js/login-page.js` - Wired up LinkedIn button with popup handling

## 🔒 Security Notes

1. **Secrets are NOT in git** - They're stored in Firebase Functions secrets and Cloudflare Pages secrets (safe)
2. **Rotate the exposed secret** - If a secret was ever exposed, it must be rotated immediately in LinkedIn Developer Console
3. **HTTPS only** - All redirect URLs use HTTPS
4. **CSRF protection** - State parameter is validated client-side in the callback page against a cookie (shared across windows) before Firebase sign-in
5. **API key authentication** - The `linkedinCreateToken` endpoint requires a shared API key to prevent unauthorized token creation
6. **XSS protection** - All user-provided error messages are HTML-escaped before display
7. **UID validation** - Token creation only accepts UIDs with the `linkedin:` prefix

## 🐛 Troubleshooting

### Function deployment fails
- Check Firebase CLI is logged in: `firebase login`
- Verify project ID: `firebase projects:list`

### Function returns 500
- Check logs: `firebase functions:log --only linkedinAuth`
- Verify secrets: `firebase functions:secrets:access LINKEDIN_CLIENT_ID`

### Popup blocked
- Browser popup settings
- Ensure domain allows popups

### CORS errors
- Function includes CORS headers automatically
- Check browser console for specific error

## 📝 LinkedIn Client Credentials

**Client ID**: `86v58h3j3qetn0`  
**Client Secret**: ⚠️ **ROTATE THIS** - Use new secret after rotating in LinkedIn console

## 🚀 Ready to Deploy

Once you complete steps 1-4 above, the LinkedIn authentication will be fully functional!