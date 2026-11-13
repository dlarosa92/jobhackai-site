// Shared operator-secret check for /api/admin/* and other operator-only routes.
//
// The key travels in X-Admin-Key, never in Authorization: api/_middleware.js
// treats every Bearer token as a Firebase ID token and answers 401 before the
// handler runs, so a Bearer admin key can never reach an admin endpoint.
//
// Both values are hashed before comparison so the comparison is constant time
// and reveals neither the length nor a matching prefix of the configured key.
// A missing ADMIN_API_KEY fails closed.

const MAX_KEY_LENGTH = 1024;

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function hasValidAdminKey(request, env) {
  const expected = env?.ADMIN_API_KEY;
  const given = request?.headers?.get('X-Admin-Key') || '';
  if (!expected || typeof expected !== 'string' || !given || given.length > MAX_KEY_LENGTH) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
