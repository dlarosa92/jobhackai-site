/**
 * LinkedIn OAuth Callback Handler (Cloudflare Pages Function)
 * Validates OAuth state, exchanges code for LinkedIn access token,
 * and returns HTML popup that calls Firebase REST API client-side
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
    // Trim API key to remove any leading/trailing whitespace or BOM characters
    const firebaseApiKey = (env.FIREBASE_WEB_API_KEY || '').trim();

    if (!linkedinClientId || !linkedinClientSecret) {
      console.error('[LINKEDIN-CALLBACK] LinkedIn credentials not configured');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    if (!firebaseApiKey) {
      console.error('[LINKEDIN-CALLBACK] FIREBASE_WEB_API_KEY not configured or empty after trimming');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Build redirect URI (the current callback URL)
    const redirectUri = `${url.protocol}//${url.host}${url.pathname}`;

    // Step 1: Exchange authorization code for LinkedIn access token
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
    const idToken = tokenData.id_token || null;

    // OIDC provider requires id_token (we request 'openid' scope)
    if (!idToken) {
      console.error('[LINKEDIN-CALLBACK] No id_token in OIDC response:', tokenData);
      return new Response('Invalid response from LinkedIn. Please try again.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(origin, env), 'Set-Cookie': expireCookie }
      });
    }

    // Build postBody for Firebase signInWithIdp (OIDC provider requires id_token)
    const postBody = `id_token=${encodeURIComponent(idToken)}&providerId=oidc.linkedin.com`;
    // Store LinkedIn OIDC id_token for SDK sign-in (needed for signInWithCredential)
    const linkedinOidcIdToken = idToken;

    // Step 2: Return HTML popup that calls Firebase REST API client-side
    // Server does NOT call Firebase - client is the authority
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
          
          <script>
            (async function() {
              try {
                const postBody = ${JSON.stringify(postBody)};
                const firebaseApiKey = ${JSON.stringify(firebaseApiKey)};
                const frontendOrigin = ${JSON.stringify(frontendOrigin)};
                const redirectUri = ${JSON.stringify(redirectUri)};
                const linkedinOidcIdToken = ${JSON.stringify(linkedinOidcIdToken)};
                
                // Client calls Firebase REST API signInWithIdp (client is authority)
                // postBody uses id_token (OIDC) if available, otherwise access_token (legacy)
                // IMPORTANT: requestUri MUST match the OAuth redirect URI (callback URL)
                const response = await fetch(
                  \`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=\${encodeURIComponent(firebaseApiKey)}\`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      postBody: postBody,
                      requestUri: redirectUri,
                      returnSecureToken: true
                    })
                  }
                );

                if (!response.ok) {
                  const errorText = await response.text();
                  console.error('Firebase REST API error:', response.status, errorText);
                  throw new Error('Firebase authentication failed');
                }

                const authData = await response.json();
                
                if (!authData.idToken) {
                  throw new Error('No idToken in Firebase response');
                }

                // Validate localId is present and valid
                if (!authData.localId || typeof authData.localId !== 'string' || authData.localId.trim() === '') {
                  throw new Error('Invalid user ID in Firebase response');
                }

                // Validate refreshToken is present
                if (!authData.refreshToken) {
                  throw new Error('No refreshToken in Firebase response');
                }

                // Validate email is present (required for session restoration)
                if (!authData.email || typeof authData.email !== 'string' || authData.email.trim() === '') {
                  throw new Error('Email is required for authentication');
                }

                // Send success message to parent window with tokens
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'linkedin-auth-success',
                    user: {
                      uid: authData.localId,
                      email: authData.email || ''
                    },
                    idToken: authData.idToken,
                    refreshToken: authData.refreshToken,
                    expiresIn: authData.expiresIn || '3600',
                    linkedinOidcIdToken: linkedinOidcIdToken
                  }, frontendOrigin);
                  window.close();
                } else {
                  // Not a popup (same-window fallback) - store tokens before redirecting
                  try {
                    const expiresIn = parseInt(authData.expiresIn || '3600', 10);
                    const expiryTime = Date.now() + (expiresIn * 1000) - (60 * 1000); // Subtract 1 minute buffer
                    sessionStorage.setItem('firebase_id_token', authData.idToken);
                    sessionStorage.setItem('firebase_refresh_token', authData.refreshToken);
                    sessionStorage.setItem('firebase_token_expiry', expiryTime.toString());
                    // Store LinkedIn OIDC id_token for SDK sign-in restoration
                    if (linkedinOidcIdToken) {
                      sessionStorage.setItem('linkedin_oidc_id_token', linkedinOidcIdToken);
                    }
                    // Set flag to trigger user initialization on page load
                    sessionStorage.setItem('linkedin_pending_init', '1');
                  } catch (e) {
                    console.error('Failed to store tokens in same-window flow:', e);
                    throw new Error('Failed to store authentication tokens');
                  }
                  // Redirect to dashboard
                  window.location.href = frontendOrigin + '/dashboard.html';
                }
              } catch (error) {
                console.error('Authentication error:', error);
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
                const frontendOrigin = ${JSON.stringify(frontendOrigin)};
                document.querySelector('.container').innerHTML = 
                  '<h2 style="color: red;">Authentication Failed</h2>' +
                  '<p>' + safeErrorMessage + '</p>' +
                  '<p><a href="' + frontendOrigin + '/login.html">Return to Login</a></p>';
              }
            })();
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
