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
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Error</title>
            <meta http-equiv="refresh" content="3;url=${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/login.html">
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Authentication Failed</h2>
            <p>${error_description || error}</p>
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

    // Step 4: Get Firebase custom token from Firebase Function
    // We proxy to the existing Firebase Function which handles custom token creation
    const firebaseFunctionUrl = 'https://us-central1-jobhackai-90558.cloudfunctions.net/linkedinAuth';
    
    // Forward the request to Firebase Function
    // The Firebase Function will handle custom token creation and return HTML
    const firebaseResponse = await fetch(
      `${firebaseFunctionUrl}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Cloudflare-Pages-Proxy'
        }
    });

    if (!firebaseResponse.ok) {
      const errorText = await firebaseResponse.text();
      console.error('[LINKEDIN-CALLBACK] Firebase Function call failed:', firebaseResponse.status, errorText);
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

    // Return the HTML from Firebase Function (which includes the custom token)
    const html = await firebaseResponse.text();
    
    // Update the frontend origin in the HTML if needed
    const updatedHtml = html.replace(
      /const frontendOrigin = [^;]+;/g,
      `const frontendOrigin = ${JSON.stringify(frontendOrigin)};`
    );

    return new Response(updatedHtml, {
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
