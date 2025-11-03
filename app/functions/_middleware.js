export async function onRequest(context) {
  const { request, env, next } = context;
  
  // Rate limiting for API endpoints (all environments)
  if (request.url.includes('/api/')) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const url = new URL(request.url);
    const endpoint = url.pathname;
    const key = `rate_limit:${ip}:${endpoint}`;
    
    // Get current count with proper NaN handling
    const count = await env.JOBHACKAI_KV?.get(key);
    const currentCount = count ? (parseInt(count, 10) || 0) : 0;
    
    // Different limits for different endpoints (use exact path matching to avoid false positives)
    let limit = 100; // Default: 100 requests per minute
    if (endpoint === '/api/stripe-checkout' || endpoint === '/api/billing-portal') {
      limit = 20; // Stripe endpoints: 20 requests per minute
    } else if (endpoint === '/api/auth' || endpoint.startsWith('/api/auth/')) {
      limit = 30; // Auth endpoints: 30 requests per minute
    }
    
    if (currentCount >= limit) {
      console.log(`⚠️ Rate limit exceeded: ${ip} on ${endpoint} (${currentCount}/${limit})`);
      return new Response(
        JSON.stringify({ 
          error: 'rate_limit_exceeded', 
          message: 'Too many requests. Please try again in a minute.',
          retry_after: 60 
        }),
        { 
          status: 429,
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'Cache-Control': 'no-store'
          } 
        }
      );
    }
    
    // Increment counter
    await env.JOBHACKAI_KV?.put(key, String(currentCount + 1), { 
      expirationTtl: 60 // 1 minute window
    });
  }
  
  // Continue with request
  const res = await next();
  
  // QA-specific headers (keep existing functionality)
  if (env.ENVIRONMENT === 'qa') {
    const h = new Headers(res.headers);
    h.set('x-qa-mw', 'hit');
    h.set('x-robots-tag', 'noindex, nofollow');
    h.set('x-content-type-options', 'nosniff');
    h.set('x-frame-options', 'DENY');
    h.set('referrer-policy', 'no-referrer');
    h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    h.set('cache-control', 'no-store, no-cache, must-revalidate');
    h.set('pragma', 'no-cache');
    h.set('expires', '0');

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
  
  return res;
}
