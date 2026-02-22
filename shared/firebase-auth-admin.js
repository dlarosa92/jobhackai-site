// Shared Firebase Auth Admin API deletion function
// Used by both app/functions/api/user/delete.js and workers/inactive-account-cleaner/src/index.js
// This module exists to avoid code duplication of critical destructive operations.

// Delete a Firebase Auth user via the Admin REST API using a service account.
export async function deleteFirebaseAuthUserAdmin(saJson, uid) {
  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch (e) {
    return { ok: false, error: `Invalid service account JSON: ${e.message}` };
  }

  const projectId = sa.project_id;
  if (!projectId) {
    return { ok: false, error: 'Service account JSON missing project_id' };
  }

  // Build a JWT to exchange for a Google OAuth2 access token
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  let accessToken;
  try {
    const pemBody = sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');
    const keyBuffer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', keyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );

    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', cryptoKey,
      new TextEncoder().encode(signingInput)
    );
    const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const jwt = `${signingInput}.${b64sig}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      return { ok: false, error: `OAuth2 token exchange failed (${tokenRes.status}): ${errText}` };
    }
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
  } catch (e) {
    return { ok: false, error: `Service account auth failed: ${e.message}` };
  }

  // Delete the Firebase Auth user using the Admin API (project-scoped endpoint)
  try {
    const deleteRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ localId: uid, targetProjectId: projectId })
      }
    );
    if (!deleteRes.ok) {
      const errText = await deleteRes.text().catch(() => '');
      if (errText.includes('USER_NOT_FOUND')) {
        return { ok: true, alreadyDeleted: true };
      }
      return { ok: false, error: `Firebase Auth delete failed (${deleteRes.status}): ${errText}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Firebase Auth delete request failed: ${e.message}` };
  }
}
