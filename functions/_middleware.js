export async function onRequest({ next }) {
  const res = await next();
  const ct = res.headers.get("content-type") || "";

  // Only touch HTML responses
  if (ct.includes("text/html")) {
    // Debug marker so we can verify middleware execution
    res.headers.set("x-qa-mw", "hit");

    // Robots + baseline security
    res.headers.set("x-robots-tag", "noindex, nofollow");
    res.headers.set("x-content-type-options", "nosniff");
    res.headers.set("x-frame-options", "DENY");
    res.headers.set("referrer-policy", "no-referrer");
    res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

    // Make QA HTML strictly non-cacheable
    res.headers.set("cache-control", "no-store, no-cache, must-revalidate");
    res.headers.set("pragma", "no-cache");
    res.headers.set("expires", "0");
  }

  return res;
}
