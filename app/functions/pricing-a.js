/**
 * Cloudflare Pages Function to handle /pricing-a redirect loop fix
 * This function intercepts requests to /pricing-a and rewrites them to /pricing-a.html
 * This works around Cloudflare's _redirects file not being applied correctly
 * 
 * Cloudflare Pages Functions run BEFORE _redirects, so this intercepts the request
 * and serves pricing-a.html directly, preventing the redirect loop.
 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  
  // Only handle /pricing-a requests (without .html extension)
  if (url.pathname === '/pricing-a' || url.pathname === '/pricing-a/') {
    // Build the target URL with .html extension, preserving query params and hash
    const targetPath = '/pricing-a.html';
    const targetUrl = new URL(targetPath + url.search + url.hash, url.origin);
    
    // Create a new request for the HTML file
    const htmlRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    // Use next() to fetch the actual pricing-a.html file
    // This bypasses the _redirects file and gets the static file directly
    const response = await next(htmlRequest);
    
    // Return the response with 200 status (not a redirect)
    // This ensures the browser receives the HTML content directly
    return new Response(response.body, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...Object.fromEntries(response.headers.entries())
      }
    });
  }
  
  // For all other requests, pass through
  return next();
}

