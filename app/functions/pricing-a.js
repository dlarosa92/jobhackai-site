/**
 * Cloudflare Pages Function for /pricing-a.
 * Repositioning: the legacy pricing page is replaced by /pricing.
 * 301 here (Functions run before _redirects, so this cannot loop with the
 * catch-all rules; /pricing is served by functions/pricing.js).
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = new URL('/pricing' + url.search, url.origin);
  return Response.redirect(target.toString(), 301);
}
