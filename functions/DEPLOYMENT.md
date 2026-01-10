# LinkedIn Authentication Deployment Guide

## Prerequisites

1. Firebase CLI installed and logged in
2. Node.js 18+ installed
3. LinkedIn Developer App created with Client ID and Secret

## Step 1: Set Up Secrets

Before deploying, you need to set the LinkedIn credentials as Firebase Functions secrets:

```bash
# Set LinkedIn Client ID
echo -n "86v58h3j3qetn0" | firebase functions:secrets:set LINKEDIN_CLIENT_ID

# Set LinkedIn Client Secret
echo -n "YOUR_CLIENT_SECRET" | firebase functions:secrets:set LINKEDIN_CLIENT_SECRET

# Verify secrets are set
firebase functions:secrets:access LINKEDIN_CLIENT_ID
```

**⚠️ IMPORTANT**: Replace `YOUR_CLIENT_SECRET` with your actual LinkedIn Client Secret. Never commit secrets to git!

## Step 2: Install Dependencies

```bash
cd functions
npm install
```

## Step 3: Deploy the Function

```bash
# From the root directory
firebase deploy --only functions:linkedinAuth
```

This will deploy the function to: `https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth`

## Step 4: Update LinkedIn Redirect URLs

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
2. Select your app (jobhackai-auth)
3. Go to Auth → OAuth 2.0 settings
4. Add the function URL as an authorized redirect URL:
   - `https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth`

## Step 5: Update Frontend Function URL (if needed)

The frontend code in `js/login-page.js` uses the function URL. After deployment, verify the URL matches:

```javascript
// Current URL in code:
functionUrl = 'https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth';
```

If your function is deployed to a different region or has a different name, update this URL.

## Step 6: Test

1. Go to your login page
2. Click "Continue with LinkedIn"
3. Complete LinkedIn authorization
4. Verify you're signed in and redirected to dashboard

## Troubleshooting

### Function returns 500 error
- Check Firebase Functions logs: `firebase functions:log`
- Verify secrets are set: `firebase functions:secrets:access LINKEDIN_CLIENT_ID`

### CORS errors
- The function already includes CORS headers
- Verify the origin is allowed in your frontend code

### Popup blocked
- Check browser popup settings
- Ensure user allows popups for your domain

### Redirect URL mismatch
- Verify the redirect URL in LinkedIn matches exactly (including protocol and path)
- Check for trailing slashes

## Security Notes

1. **Never commit secrets** - They're stored in Firebase, not in git
2. **Rotate secrets if exposed** - If a secret is ever committed or shared, rotate it immediately
3. **Use HTTPS only** - All redirect URLs must use HTTPS
4. **Validate state parameter** - The code includes state validation for CSRF protection

## Environment Variables

The function uses these secrets (set via Firebase CLI):
- `LINKEDIN_CLIENT_ID` - Your LinkedIn app Client ID
- `LINKEDIN_CLIENT_SECRET` - Your LinkedIn app Client Secret

Optionally, you can set:
- `FRONTEND_ORIGIN` - Default redirect origin (defaults to https://app.jobhackai.io)