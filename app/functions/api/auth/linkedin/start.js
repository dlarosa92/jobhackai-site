/**
 * LinkedIn OAuth Start Handler (Cloudflare Pages Function)
 * Generates OAuth state server-side, signs it with HMAC, stores in cookie,
 * and redirects to LinkedIn authorization endpoint
 */

/**
 * Sign a value using HMAC-SHA256
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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    // Validate required secrets
    const stateSecret = env.LINKEDIN_STATE_SECRET;
    const clientId = env.LINKEDIN_CLIENT_ID;

    if (!stateSecret || !clientId) {
      console.error('[LINKEDIN-START] Missing required configuration');
      return new Response('Server configuration error. Please contact support.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Generate state: UUID + timestamp for uniqueness and expiration tracking
    const stateValue = crypto.randomUUID() + ':' + Math.floor(Date.now() / 1000);

    // Sign state with HMAC-SHA256
    const signature = await hmacSign(stateSecret, stateValue);

    // Store state|signature in HttpOnly, Secure, SameSite=Lax cookie (10 min expiry)
    const cookieValue = `${stateValue}|${signature}`;
    const isSecure = url.protocol === 'https:';
    const secureFlag = isSecure ? 'Secure; ' : '';
    const cookie = `linkedin_oauth_state=${cookieValue}; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=600; Path=/`;

    // Build redirect URI (the callback URL on this domain)
    const redirectUri = `${url.protocol}//${url.host}/api/auth/linkedin/callback`;

    // Build LinkedIn authorization URL
    const linkedinAuthUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    linkedinAuthUrl.searchParams.set('response_type', 'code');
    linkedinAuthUrl.searchParams.set('client_id', clientId);
    linkedinAuthUrl.searchParams.set('redirect_uri', redirectUri);
    linkedinAuthUrl.searchParams.set('state', stateValue);
    // Requested scopes (legacy): keep original r_liteprofile and r_emailaddress
    linkedinAuthUrl.searchParams.set('scope', 'r_liteprofile r_emailaddress');

    // Redirect to LinkedIn with state cookie set
    return new Response(null, {
      status: 302,
      headers: {
        'Location': linkedinAuthUrl.toString(),
        'Set-Cookie': cookie,
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    console.error('[LINKEDIN-START] Error:', error);
    return new Response('Server error. Please try again.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
