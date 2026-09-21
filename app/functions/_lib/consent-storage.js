/** Save the explicit account and current-browser decisions together. Marketing
 * is anonymous even when the app is signed in; deleting its browser receipt
 * makes a later GET return null and can resurrect a cached grant there. */
export async function saveCookieConsent(db, {userId, clientId, consent}) {
  if (!db || typeof db.batch !== 'function' || (!userId && !clientId)) return false;
  try {
    const value=typeof consent==='string'?consent:JSON.stringify(consent);
    const now=new Date().toISOString(),statements=[];
    if(userId) statements.push(db.prepare(`INSERT INTO cookie_consents
      (user_id,client_id,consent_json,created_at,updated_at) VALUES(?,NULL,?,?,?)
      ON CONFLICT(user_id) WHERE user_id IS NOT NULL DO UPDATE SET
        consent_json=excluded.consent_json,updated_at=excluded.updated_at`)
      .bind(userId,value,now,now));
    if(clientId){
      // Older rows may combine account and browser identity. Keep that account
      // decision intact; an anonymous browser write must not change it.
      statements.push(db.prepare('UPDATE cookie_consents SET client_id=NULL WHERE client_id=? AND user_id IS NOT NULL').bind(clientId));
      statements.push(db.prepare(`INSERT INTO cookie_consents
        (user_id,client_id,consent_json,created_at,updated_at) VALUES(NULL,?,?,?,?)
        ON CONFLICT(client_id) WHERE client_id IS NOT NULL DO UPDATE SET
          consent_json=excluded.consent_json,updated_at=excluded.updated_at`)
        .bind(clientId,value,now,now));
    }
    // D1 batch is transactional: partial failure cannot leave a newer account
    // withdrawal beside an older anonymous grant. The caller handles retries.
    await db.batch(statements);
    return true;
  } catch {
    console.error('[DB] Consent write failed');
    return false;
  }
}
