/**
 * Cloudflare Pages Function to handle /pricing-a redirect loop fix
 * This function intercepts requests to /pricing-a and serves pricing-a.html directly
 * 
 * Cloudflare Pages Functions run BEFORE _redirects, so this intercepts the request
 * and serves pricing-a.html directly, preventing the redirect loop.
 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  
  // Only handle /pricing-a requests (without .html extension)
  if (url.pathname === '/pricing-a' || url.pathname === '/pricing-a/') {
    try {
      // Build the target URL with .html extension, preserving query params and hash
      const targetPath = '/pricing-a.html';
      const targetUrl = new URL(targetPath + url.search + url.hash, url.origin);
      
      // Create a new request for the HTML file
      // Use GET method to fetch the static asset (ignore original method for asset fetch)
      const assetRequest = new Request(targetUrl.toString(), {
        method: 'GET',
        headers: new Headers({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        })
      });
      
      // Use next() to fetch the static asset
      // This will fetch pricing-a.html from the static assets
      const response = await next(assetRequest);
      
      // If the asset was found, return it with proper headers
      if (response.status === 200 || response.status === 304) {
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        // Preserve cache headers from the asset response
        return new Response(response.body, {
          status: response.status,
          headers: headers
        });
      }
      
      // If asset not found, return 404
      return new Response('Pricing page not found', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    } catch (error) {
      console.error('Error serving pricing-a.html:', error);
      return new Response('Internal server error', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
  
  // This should never be reached for route-specific functions,
  // but if it is, pass through to next handler
  return next();
}

