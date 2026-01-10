/**
 * Firebase Cloud Functions for JobHackAI
 * LinkedIn OAuth Authentication Handler
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Initialize Firebase Admin (uses default credentials from Firebase project)
admin.initializeApp();

// Define secrets (these will be set via firebase functions:secrets:set)
const linkedinClientId = defineSecret('LINKEDIN_CLIENT_ID');
const linkedinClientSecret = defineSecret('LINKEDIN_CLIENT_SECRET');

// Firebase client config for the callback page
const FIREBASE_CLIENT_CONFIG = {
  apiKey: "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
  authDomain: "jobhackai-90558.firebaseapp.com",
  projectId: "jobhackai-90558",
  storageBucket: "jobhackai-90558.firebasestorage.app",
  messagingSenderId: "40538124818",
  appId: "1:40538124818:web:cd61fc1d120ec79d4ddecb",
  measurementId: "G-X48E90B00S"
};

/**
 * LinkedIn OAuth Callback Handler
 * Handles the OAuth callback from LinkedIn, exchanges code for token,
 * fetches user profile, creates Firebase custom token, and signs user in
 */
exports.linkedinAuth = onRequest(
  {
    secrets: [linkedinClientId, linkedinClientSecret],
    cors: true,
  },
  async (req, res) => {
  // Handle CORS for preflight
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  // Only allow GET requests (LinkedIn OAuth redirect)
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { code, state, error, error_description } = req.query;

    // Handle LinkedIn OAuth errors
    if (error) {
      console.error('LinkedIn OAuth error:', error, error_description);
      return res.status(400).send(`
        <html>
          <head><title>Authentication Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Authentication Failed</h2>
            <p>${error_description || error}</p>
            <p><a href="/login.html">Return to Login</a></p>
          </body>
        </html>
      `);
    }

    // Validate authorization code
    if (!code) {
      return res.status(400).send('Missing authorization code');
    }

    // Note: State validation happens client-side in the callback HTML
    // The state parameter is passed back from LinkedIn and will be validated
    // against sessionStorage in the browser before Firebase sign-in

    // Get LinkedIn credentials from secrets
    const clientId = linkedinClientId.value();
    const clientSecret = linkedinClientSecret.value();
    const frontendOrigin = process.env.FRONTEND_ORIGIN || 'https://app.jobhackai.io';
    
    if (!clientId || !clientSecret) {
      console.error('LinkedIn credentials not configured');
      return res.status(500).send('Server configuration error. Please contact support.');
    }
    
    // Build redirect URI (the current function URL)
    const redirectUri = `https://${req.headers.host}${req.path}`;

    // Step 1: Exchange authorization code for access token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('LinkedIn token exchange failed:', tokenResponse.status, errorText);
      return res.status(500).send('Failed to exchange authorization code. Please try again.');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('No access token in response:', tokenData);
      return res.status(500).send('Invalid response from LinkedIn. Please try again.');
    }

    // Step 2: Fetch user's basic profile from LinkedIn
    const profileResponse = await fetch('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error('LinkedIn profile fetch failed:', profileResponse.status, errorText);
      return res.status(500).send('Failed to fetch profile. Please try again.');
    }

    const profile = await profileResponse.json();

    // Step 3: Fetch user's email address
    const emailResponse = await fetch(
      'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    let email = '';
    if (emailResponse.ok) {
      const emailData = await emailResponse.json();
      email = emailData?.elements?.[0]?.['handle~']?.emailAddress || '';
    } else {
      console.warn('Failed to fetch email, continuing without it');
    }

    // Step 4: Create or get Firebase user with custom token
    // Use LinkedIn ID as the UID prefix to ensure uniqueness
    const linkedinId = profile.id;
    const firebaseUid = `linkedin:${linkedinId}`;

    // Extract name from profile
    const firstName = profile.localizedFirstName || '';
    const lastName = profile.localizedLastName || '';
    const displayName = `${firstName} ${lastName}`.trim() || email || 'LinkedIn User';

    // Create custom claims for the Firebase token
    const customClaims = {
      provider: 'linkedin',
      linkedinId: linkedinId,
      email: email,
      displayName: displayName,
    };

    // Create Firebase custom token
    const customToken = await admin.auth().createCustomToken(firebaseUid, customClaims);

    // Step 5: Return HTML page that signs in with Firebase and redirects
    // This page will run in the popup window and close itself after sign-in
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Signing you in...</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .spinner {
              border: 4px solid #f3f3f3;
              border-top: 4px solid #0077B5;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="spinner"></div>
            <h2>Signing you in...</h2>
            <p>Please wait while we complete authentication.</p>
          </div>
          
          <script src="https://www.gstatic.com/firebasejs/12.1.0/firebase-app-compat.js"></script>
          <script src="https://www.gstatic.com/firebasejs/12.1.0/firebase-auth-compat.js"></script>
          <script>
            // Initialize Firebase with client config
            const firebaseConfig = ${JSON.stringify(FIREBASE_CLIENT_CONFIG)};
            firebase.initializeApp(firebaseConfig);
            
            const customToken = ${JSON.stringify(customToken)};
            const frontendOrigin = ${JSON.stringify(frontendOrigin)};
            const receivedState = ${JSON.stringify(state || '')};
            
            // CSRF Protection: Validate state parameter
            const storedState = sessionStorage.getItem('linkedin_oauth_state');
            if (!receivedState || !storedState || receivedState !== storedState) {
              console.error('CSRF validation failed: state mismatch');
              document.querySelector('.container').innerHTML = 
                '<h2 style="color: red;">Security Error</h2>' +
                '<p>Invalid authentication state. Please try again.</p>' +
                '<p><a href="' + frontendOrigin + '/login.html">Return to Login</a></p>';
              // Clean up stored state
              sessionStorage.removeItem('linkedin_oauth_state');
              throw new Error('CSRF validation failed');
            }
            
            // Clear stored state after validation
            sessionStorage.removeItem('linkedin_oauth_state');
            
            // Sign in with custom token
            firebase.auth().signInWithCustomToken(customToken)
              .then((userCredential) => {
                console.log('✅ Successfully signed in with Firebase:', userCredential.user.uid);
                
                // Close popup if opened as popup, otherwise redirect
                if (window.opener) {
                  // Send success message to parent window
                  window.opener.postMessage({
                    type: 'linkedin-auth-success',
                    user: {
                      uid: userCredential.user.uid,
                      email: userCredential.user.email
                    }
                  }, frontendOrigin);
                  window.close();
                } else {
                  // Not a popup - redirect to dashboard
                  window.location.href = frontendOrigin + '/dashboard.html';
                }
              })
              .catch((error) => {
                console.error('❌ Firebase sign-in error:', error);
                document.querySelector('.container').innerHTML = 
                  '<h2 style="color: red;">Authentication Failed</h2>' +
                  '<p>' + error.message + '</p>' +
                  '<p><a href="' + frontendOrigin + '/login.html">Return to Login</a></p>';
              });
          </script>
        </body>
      </html>
    `;

    res.set('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('LinkedIn auth error:', error);
    res.status(500).send(`
      <html>
        <head><title>Server Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>An error occurred</h2>
          <p>Please try again later.</p>
          <p><a href="/login.html">Return to Login</a></p>
        </body>
      </html>
    `);
  }
  }
);