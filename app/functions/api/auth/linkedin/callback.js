/**
 * LinkedIn OAuth Callback Handler (Cloudflare Pages Function)
 * Validates OAuth state, exchanges code for token, fetches profile,
 * mints Firebase custom token in-worker, and returns HTML that signs user in
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

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const trimmed = cookie.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const name = trimmed.substring(0, eqIndex);
      const value = decodeURIComponent(trimmed.substring(eqIndex + 1));
      cookies[name] = value;
    }
  });
  return cookies;
}

/**
 * Sign a value using HMAC-SHA256 (constant-time)
 */
async function hmacSign(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value)
  );
  // Convert to base64url
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Base64url encode a buffer or string
 */
function base64UrlEncode(input) {
  let str;
  if (typeof input === 'string') {
    str = input;
  } else if (input instanceof ArrayBuffer) {
    str = String.fromCharCode(...new Uint8Array(input));
  } else if (input instanceof Uint8Array) {
    str = String.fromCharCode(...input);
  } else {
    throw new Error('Invalid input type for base64UrlEncode');
  }
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert JSON object to base64url encoded string
 */
function jsonToBase64Url(obj) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * Convert PEM private key to ArrayBuffer (PKCS#8 format)
 */
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Import RSA private key from PEM format
 */
async function importRsaPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem);
  return await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' }
    },
    false,
    ['sign']
  );
}

/**
 * Sign JWT segment using RSA private key
 */
async function signJwtSegment(privateKey, signingInput) {
  const data = new TextEncoder().encode(signingInput);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    data
  );
  return base64UrlEncode(signature);
}

/**
 * Create Firebase custom token (JWT) in-worker
 * Matches Firebase's custom token specification exactly
 */
async function createFirebaseCustomToken(env, uid, additionalClaims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const iat = now;
  const exp = now + 3600; // 1 hour max (Firebase requirement)

  const serviceAccountEmail = env.FIREBASE_SA_EMAIL;
  const privateKeyPem = env.FIREBASE_SA_PRIVATE_KEY;

  if (!serviceAccountEmail || !privateKeyPem) {
    throw new Error('Missing Firebase service account credentials');
  }

  // JWT Header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  // JWT Payload (Firebase custom token spec)
  const payload = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat,
    exp,
    uid
  };

  // Add custom claims if provided
  if (additionalClaims && Object.keys(additionalClaims).length > 0) {
    payload.claims = additionalClaims;
  }

  // Create signing input: base64url(header).base64url(payload)
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;

  // Import private key and sign
  const privateKey = await importRsaPrivateKey(privateKeyPem);
  const signature = await signJwtSegment(privateKey, signingInput);

  // Return complete JWT: header.payload.signature
  return `${signingInput}.${signature}`;
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

  // Expire state cookie (set in response if successful)
  const expireCookie = 'linkedin_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

  try {
    const { code, state: returnedState, error, error_description } = Object.fromEntries(url.searchParams);

    // Handle LinkedIn OAuth errors
    if (error) {
      console.error('[LINKEDIN-CALLBACK] LinkedIn OAuth error:', error, error_description);
      
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
        headers: { 'Content-Type': 'text/html', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Validate authorization code
    if (!code) {
      return new Response('Missing authorization code', {
        status: 400,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // STATE VALIDATION: Read and verify state cookie BEFORE any token exchange
    const cookies = parseCookies(request.headers.get('Cookie') || '');
    const cookieValue = cookies['linkedin_oauth_state'];

    if (!cookieValue) {
      console.error('[LINKEDIN-CALLBACK] Missing state cookie');
      return new Response('Missing OAuth state. Please start authentication again.', {
        status: 401,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Parse state|signature from cookie
    const parts = cookieValue.split('|');
    if (parts.length !== 2) {
      console.error('[LINKEDIN-CALLBACK] Invalid state cookie format');
      return new Response('Invalid state cookie format', {
        status: 401,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    const [storedState, storedSignature] = parts;

    // Verify HMAC signature
    const stateSecret = env.LINKEDIN_STATE_SECRET;
    if (!stateSecret) {
      console.error('[LINKEDIN-CALLBACK] LINKEDIN_STATE_SECRET not configured');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    const expectedSignature = await hmacSign(stateSecret, storedState);

    if (!safeEquals(expectedSignature, storedSignature)) {
      console.error('[LINKEDIN-CALLBACK] Invalid state signature - possible CSRF attack');
      return new Response('Invalid state signature. Please try again.', {
        status: 401,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Compare returned state with stored state
    if (!returnedState || returnedState !== storedState) {
      console.error('[LINKEDIN-CALLBACK] State mismatch - CSRF protection triggered');
      return new Response('State mismatch. Please try again.', {
        status: 401,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // State validation passed - proceed with OAuth token exchange

    // Get LinkedIn credentials from environment
    const linkedinClientId = env.LINKEDIN_CLIENT_ID;
    const linkedinClientSecret = env.LINKEDIN_CLIENT_SECRET;
    const frontendOrigin = env.LINKEDIN_FRONTEND_URL || env.FRONTEND_URL || 'https://dev.jobhackai.io';

    if (!linkedinClientId || !linkedinClientSecret) {
      console.error('[LINKEDIN-CALLBACK] LinkedIn credentials not configured');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Build redirect URI (the current callback URL)
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
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('[LINKEDIN-CALLBACK] No access token in response:', tokenData);
      return new Response('Invalid response from LinkedIn. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
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
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
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

    // Step 4: Create Firebase custom token IN-WORKER (no Firebase Function call)
    // Validate profile ID exists to prevent shared/malformed UIDs
    if (!profile.id || typeof profile.id !== 'string' || profile.id.trim() === '') {
      console.error('[LINKEDIN-CALLBACK] Invalid or missing LinkedIn profile ID:', profile);
      return new Response('Invalid profile data received from LinkedIn. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }
    
    const linkedinId = profile.id;
    const firebaseUid = `linkedin:${linkedinId}`;

    const firstName = profile.localizedFirstName || '';
    const lastName = profile.localizedLastName || '';
    const displayName = `${firstName} ${lastName}`.trim() || email || 'LinkedIn User';

    // Mint Firebase custom token directly in worker
    const customToken = await createFirebaseCustomToken(
      env,
      firebaseUid,
      {
        provider: 'linkedin',
        linkedinId,
        email,
        displayName
      }
    );

    // Step 5: Return HTML page that signs in with Firebase and redirects
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
            
            // Sign in with custom token (state already validated server-side)
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
                // HTML escape error message to prevent XSS
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
                const safeErrorMessage = escapeHtml(error.message || 'An unknown error occurred');
                document.querySelector('.container').innerHTML = 
                  '<h2 style="color: red;">Authentication Failed</h2>' +
                  '<p>' + safeErrorMessage + '</p>' +
                  '<p><a href="' + frontendOrigin + '/login.html">Return to Login</a></p>';
              });
          </script>
        </body>
      </html>
    `;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': expireCookie,
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
      headers: { 'Content-Type': 'text/html', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
    });
  }
}
