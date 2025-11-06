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
    // Only include body for methods that support it (POST, PUT, PATCH, DELETE)
    // GET and HEAD requests cannot have a body according to Fetch API spec
    const requestInit = {
      method: request.method,
      headers: request.headers
    };
    
    // Only add body for methods that support it
    const methodsWithBody = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (methodsWithBody.includes(request.method.toUpperCase())) {
      requestInit.body = request.body;
    }
    
    const htmlRequest = new Request(targetUrl.toString(), requestInit);
    
    // Use next() to fetch the actual pricing-a.html file
    // This bypasses the _redirects file and gets the static file directly
    const response = await next(htmlRequest);
    
    // Preserve the original response status (e.g., 200, 404, 500)
    // Only override Content-Type for successful responses (2xx) to ensure HTML is served correctly
    // For error responses (4xx, 5xx), preserve the original Content-Type from the error page
    const headers = new Headers(response.headers);
    
    // For successful responses, ensure Content-Type is text/html
    // For error responses, preserve the original Content-Type (might be text/html for error pages)
    if (response.status >= 200 && response.status < 300) {
      headers.set('Content-Type', 'text/html; charset=utf-8');
    }
    
    // Return the response with the original status code preserved
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  }
  
  // For all other requests, pass through
  return next();
}

