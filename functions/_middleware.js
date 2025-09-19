export async function onRequest({ next, env }) {
  // Only run this logic in QA
  if (env.ENVIRONMENT !== 'qa') return next();

  const res = await next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  // Clone headers, then override
  const h = new Headers(res.headers);
  h.set("x-qa-mw", "hit");
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "no-referrer");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

  // non-cacheable in QA
  h.set("cache-control", "no-store, no-cache, must-revalidate");
  h.set("pragma", "no-cache");
  h.set("expires", "0");

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
