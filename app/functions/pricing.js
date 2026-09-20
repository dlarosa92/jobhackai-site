/**
 * Cloudflare Pages Function serving /pricing.
 * Mirrors the /pricing-a pattern: Pages Functions run BEFORE _redirects, so
 * this serves pricing.html directly and avoids redirect-loop interactions
 * with the catch-all rules in public/_redirects.
 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/pricing' || url.pathname === '/pricing/') {
    try {
      const targetUrl = new URL('/pricing.html' + url.search + url.hash, url.origin);
      const assetRequest = new Request(targetUrl.toString(), {
        method: 'GET',
        headers: new Headers({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        })
      });
      const response = await next(assetRequest);
      const headers = new Headers(response.headers);
      if (response.status >= 200 && response.status < 300) {
        headers.set('Content-Type', 'text/html; charset=utf-8');
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.error('Error serving pricing.html:', error);
      return new Response('Internal server error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }

  return next();
}
