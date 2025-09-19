export async function onRequest({ next }) {
  const res = await next();

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) {
    // Non-HTML responses untouched
    return res;
  }

  // Clone headers then set/override
  const h = new Headers(res.headers);
  h.set("x-qa-mw", "hit");
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "no-referrer");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

  // Make QA HTML strictly non-cacheable (CDN + browser)
  h.set("cache-control", "no-store, no-cache, must-revalidate");
  h.set("pragma", "no-cache");
  h.set("expires", "0");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}
