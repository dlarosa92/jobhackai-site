/**
 * LinkedIn OAuth Callback Handler (Cloudflare Pages Function)
 * Handles the OAuth callback from LinkedIn, proxies to Firebase Function
 * to create custom token, then returns HTML that signs user in
 */

function corsHeaders(origin, env) {
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:8787',
    'http://localhost:8788'
  ];
  
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  // Only allow GET requests (LinkedIn OAuth redirect)
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { 
      status: 405,
      headers: corsHeaders(origin, env)
    });
  }

  try {
    const { code, state, error, error_description } = Object.fromEntries(url.searchParams);

    // Handle LinkedIn OAuth errors
    if (error) {
      console.error('[LINKEDIN-CALLBACK] LinkedIn OAuth error:', error, error_description);
      
      // SECURITY: Escape HTML to prevent XSS
      const escapeHtml = (text) => {
        if (!text) return '';
        const map = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
      };
      
      const safeError = escapeHtml(error_description || error);
      const frontendUrl = env.FRONTEND_URL || 'https://dev.jobhackai.io';
      
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Error</title>
            <meta http-equiv="refresh" content="3;url=${frontendUrl}/login.html">
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Authentication Failed</h2>
            <p>${safeError}</p>
            <p>Redirecting to login page...</p>
          </body>
        </html>
      `, {
        status: 400,
        headers: { 'Content-Type': 'text/html', ...corsHeaders(origin, env) }
      });
    }

    // Validate authorization code
    if (!code) {
      return new Response('Missing authorization code', {
        status: 400,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env) }
      });
    }

    // Get LinkedIn credentials from environment
    const linkedinClientId = env.LINKEDIN_CLIENT_ID;
    const linkedinClientSecret = env.LINKEDIN_CLIENT_SECRET;
    const frontendOrigin = env.LINKEDIN_FRONTEND_URL || env.FRONTEND_URL || 'https://dev.jobhackai.io';

    if (!linkedinClientId || !linkedinClientSecret) {
      console.error('[LINKEDIN-CALLBACK] LinkedIn credentials not configured');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env) }
      });
    }

    // Build redirect URI (the current callback URL - what LinkedIn redirected to)
    const redirectUri = `${url.protocol}//${url.host}${url.pathname}`;

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
        client_id: linkedinClientId,
        client_secret: linkedinClientSecret,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[LINKEDIN-CALLBACK] LinkedIn token exchange failed:', tokenResponse.status, errorText);
      return new Response('Failed to exchange authorization code. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env) }
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('[LINKEDIN-CALLBACK] No access token in response:', tokenData);
      return new Response('Invalid response from LinkedIn. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env) }
      });
    }

    // Step 2: Fetch user's basic profile from LinkedIn
    const profileResponse = await fetch('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error('[LINKEDIN-CALLBACK] LinkedIn profile fetch failed:', profileResponse.status, errorText);
      return new Response('Failed to fetch profile. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env) }
      });
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
      console.warn('[LINKEDIN-CALLBACK] Failed to fetch email, continuing without it');
    }

    // Step 4: Create Firebase custom token
    // Use LinkedIn ID as the UID prefix to ensure uniqueness
    const linkedinId = profile.id;
    const firebaseUid = `linkedin:${linkedinId}`;

    // Extract name from profile
    const firstName = profile.localizedFirstName || '';
    const lastName = profile.localizedLastName || '';
    const displayName = `${firstName} ${lastName}`.trim() || email || 'LinkedIn User';

    // Create custom token via Firebase Function helper endpoint
    // We'll call a new endpoint that accepts profile data
    // For now, call the existing Firebase Function which we'll modify to accept this
    // OR we can create the token using service account
    
    // Simplest: Call Firebase Function's token creation via a helper endpoint
    // But since that doesn't exist, let's create the token using Firebase REST API
    
    // Actually, the simplest approach for MVP: Call the Firebase Function
    // but we need it to accept our redirect URI. Let's modify approach:
    // We'll create a token creation endpoint OR use the existing one differently
    
    // For now: Return HTML that fetches token from a backend endpoint
    // OR directly create token here using service account
    
    const customToken = await createFirebaseCustomToken(
      firebaseUid,
      { provider: 'linkedin', linkedinId, email, displayName },
      env
    );

    // Step 5: Return HTML page that signs in with Firebase and redirects
    // This page will run in the popup window and close itself after sign-in
    const firebaseConfig = {
      apiKey: env.FIREBASE_WEB_API_KEY || "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
      authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "jobhackai-90558.firebaseapp.com",
      projectId: env.FIREBASE_PROJECT_ID || "jobhackai-90558",
      storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "jobhackai-90558.firebasestorage.app",
      messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "40538124818",
      appId: env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:40538124818:web:cd61fc1d120ec79d4ddecb"
    };

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
            const firebaseConfig = ${JSON.stringify(firebaseConfig)};
            firebase.initializeApp(firebaseConfig);
            
            const customToken = ${JSON.stringify(customToken)};
            const frontendOrigin = ${JSON.stringify(frontendOrigin)};
            const receivedState = ${JSON.stringify(state || '')};
            
            // CSRF Protection: Validate state parameter
            function getCookie(name) {
              const cookies = document.cookie.split(';');
              for (const cookie of cookies) {
                const [cookieName, cookieValue] = cookie.trim().split('=');
                if (cookieName === name) {
                  return decodeURIComponent(cookieValue);
                }
              }
              return null;
            }
            
            const storedState = getCookie('linkedin_oauth_state');
            if (!receivedState || !storedState || receivedState !== storedState) {
              console.error('CSRF validation failed: state mismatch');
              document.querySelector('.container').innerHTML = 
                '<h2 style="color: red;">Security Error</h2>' +
                '<p>Invalid authentication state. Please try again.</p>' +
                '<p><a href="' + frontendOrigin + '/login.html">Return to Login</a></p>';
              // Clean up stored state cookie
              document.cookie = 'linkedin_oauth_state=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
              throw new Error('CSRF validation failed');
            }
            
            // Clear stored state cookie after validation
            document.cookie = 'linkedin_oauth_state=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
            
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

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        ...corsHeaders(origin, env)
      }
    });

  } catch (error) {
    console.error('[LINKEDIN-CALLBACK] Error:', error);
    const frontendOrigin = env.LINKEDIN_FRONTEND_URL || env.FRONTEND_URL || 'https://dev.jobhackai.io';
    
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Server Error</title>
          <meta http-equiv="refresh" content="3;url=${frontendOrigin}/login.html">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>An error occurred</h2>
          <p>Please try again later.</p>
          <p>Redirecting to login page...</p>
        </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html', ...corsHeaders(origin, env) }
    });
  }
}

/**
 * Create Firebase custom token using Firebase Function helper endpoint
 * The helper endpoint accepts profile data and returns a custom token
 * SECURED: Requires API key authentication
 */
async function createFirebaseCustomToken(uid, customClaims, env) {
  // Get API key from environment (must be set in Cloudflare Pages secrets)
  const apiKey = env.LINKEDIN_TOKEN_API_KEY;
  if (!apiKey) {
    console.error('[LINKEDIN-CALLBACK] LINKEDIN_TOKEN_API_KEY not configured');
    throw new Error('Server configuration error. Please contact support.');
  }

  // Call Firebase Function helper endpoint that creates custom tokens
  const firebaseFunctionHelperUrl = 'https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinCreateToken';
  
  try {
    const tokenResponse = await fetch(firebaseFunctionHelperUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ 
        uid, 
        customClaims,
        projectId: env.FIREBASE_PROJECT_ID || 'jobhackai-90558'
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[LINKEDIN-CALLBACK] Helper endpoint failed:', tokenResponse.status, errorText);
      
      // Don't expose internal errors to client
      if (tokenResponse.status === 401) {
        throw new Error('Authentication failed. Please try again.');
      }
      throw new Error(`Token creation failed: ${tokenResponse.status}`);
    }

    const data = await tokenResponse.json();
    if (!data.customToken) {
      throw new Error('No custom token in response');
    }

    return data.customToken;
    
  } catch (error) {
    console.error('[LINKEDIN-CALLBACK] Failed to create custom token:', error);
    throw new Error('Failed to create authentication token. Please try again.');
  }
}
