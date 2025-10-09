// Lightweight Firebase ID token verification using jose (JWKS)
// Requires env.FIREBASE_PROJECT_ID to be set

import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export function getBearer(req) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return (m && m[1]) || null;
}

export async function verifyFirebaseIdToken(token, projectId) {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId
  });
  
  // HARDENED: Strict claims validation
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('invalid issuer');
  }
  if (payload.aud !== projectId) {
    throw new Error('invalid audience');
  }
  
  const uid = payload.user_id || payload.sub;
  if (!uid) throw new Error('missing uid');
  return { uid, payload };
}



