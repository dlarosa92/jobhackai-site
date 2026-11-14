// KV cache key for a rule-based ATS score.
//
// The score is computed from the whole resume, so the key must be too. It was
// previously derived from the first 2000 characters only: a resume edited
// anywhere past that point produced the same key, and for up to 24 hours the
// user was handed the score of the version they had just replaced.
//
// The key is content based on purpose (no uid): identical text scored for the
// same role always yields the same result, so sharing it is safe.

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function atsCacheKey(text, normalizedJobTitle) {
  const textHash = await sha256Hex(text ?? '');
  return `atsCache:${await sha256Hex(`${textHash}:${normalizedJobTitle}:ats`)}`;
}
