export async function onRequest({ next }) {
  const res = await next();
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    res.headers.set("x-robots-tag", "noindex, nofollow");
    res.headers.set("x-content-type-options", "nosniff");
    res.headers.set("x-frame-options", "DENY");
    res.headers.set("referrer-policy", "no-referrer");
    if (!res.headers.has("cache-control")) {
      res.headers.set("cache-control", "no-store");
    }
    res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  }
  return res;
}
