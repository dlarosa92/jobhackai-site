import { getDb } from './db.js';

// Internal primitives only. Callers must verify identity before admission and
// cover the FULL operation, including awaited writes and queued background work.
// A crashed/uncertain operation never expires into an assumed billing success.
function database(env) {
  const db = getDb(env);
  if (!db) throw new Error('deletion_database_unavailable');
  return db;
}
function identity(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new Error('deletion_identity_invalid');
}
export async function admitAccountOperation(env, uid, kind = 'account', { webhookEventId = null, analyticsEventKey = null, purpose } = {}) {
  identity(uid);
  if (!['billing', 'account', 'maintenance'].includes(kind)) throw new Error('deletion_operation_invalid');
  if (webhookEventId !== null && (kind !== 'billing' || typeof webhookEventId !== 'string' ||
      !/^evt_[a-zA-Z0-9_]{1,196}$/.test(webhookEventId))) throw new Error('deletion_webhook_event_invalid');
  if (analyticsEventKey !== null && (kind !== 'account' || typeof analyticsEventKey !== 'string' ||
      !/^(purchase:ch_|refund:re_)[a-zA-Z0-9_]{1,196}$/.test(analyticsEventKey))) throw new Error('deletion_analytics_event_invalid');
  purpose ??= webhookEventId?'webhook':analyticsEventKey?'analytics':kind==='maintenance'?'maintenance':'api';
  const validPurpose=({api:['account','billing'],webhook:['billing'],analytics:['account'],followup:['account'],
    retention:['maintenance'],inactivity:['maintenance'],maintenance:['maintenance']})[purpose];
  if(!Array.isArray(validPurpose) || !validPurpose.includes(kind) ||
      (purpose==='webhook')!==(webhookEventId!==null) || (purpose==='analytics')!==(analyticsEventKey!==null))throw Error('deletion_operation_purpose_invalid');
  const db = database(env), id = crypto.randomUUID();
  // This check and admission are ONE statement, serialized with deletion's
  // intent insert. An unlocked SELECT followed by INSERT would race deletion.
  const result = await db.prepare(`INSERT INTO account_operation_claims(id,auth_id,kind,webhook_event_id,analytics_event_key,purpose)
    SELECT ?,?,?,?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM account_deletion_admissions WHERE auth_id = ?
    ) AND (? IS NULL OR NOT EXISTS (
      SELECT 1 FROM account_operation_claims WHERE analytics_event_key=? AND state!='finished'
    )) AND NOT EXISTS (
      SELECT 1 FROM account_operation_claims WHERE auth_id=? AND state!='finished'
        AND (kind='maintenance' OR ?='maintenance')
    ) AND NOT EXISTS (SELECT 1 FROM account_operation_reconciliations r WHERE
      (? IS NOT NULL AND r.analytics_event_key=?) OR (r.auth_id=? AND r.purpose=? AND
        (?='followup' OR (?='inactivity' AND r.disposition='suppress_delivery'))))`)
    .bind(id,uid,kind,webhookEventId,analyticsEventKey,purpose,uid,analyticsEventKey,analyticsEventKey,uid,kind,
      analyticsEventKey,analyticsEventKey,uid,purpose,purpose,purpose).run();
  if (result.meta?.changes !== 1) {
    // Diagnostic only: this read grants no permission. The atomic INSERT is
    // the admission decision; neither a stale lease nor another UID bypasses it.
    const deleting = await db.prepare('SELECT 1 FROM account_deletion_admissions WHERE auth_id=?').bind(uid).first();
    if (deleting) throw new Error('account_deletion_pending');
    const suppressed=await db.prepare(`SELECT 1 FROM account_operation_reconciliations r WHERE
      (? IS NOT NULL AND analytics_event_key=?) OR (auth_id=? AND purpose=? AND
        (?='followup' OR (?='inactivity' AND disposition='suppress_delivery')))`)
      .bind(analyticsEventKey,analyticsEventKey,uid,purpose,purpose,purpose).first();
    if(suppressed)throw Error(analyticsEventKey?'analytics_delivery_suppressed':'account_operation_suppressed');
    const unresolved = analyticsEventKey && await db.prepare("SELECT 1 FROM account_operation_claims WHERE analytics_event_key=? AND state!='finished'").bind(analyticsEventKey).first();
    throw new Error(unresolved ? 'analytics_delivery_unresolved' : 'account_operation_busy');
  }
  console.log('[account-operation] started',{operation:id,kind,purpose});
  return { id, uid, kind, purpose };
}
export async function settleAccountOperation(env, claim, outcome) {
  identity(claim?.uid);
  if (!['finished', 'uncertain'].includes(outcome)) throw new Error('deletion_operation_outcome_invalid');
  const db = database(env);
  await db.prepare(`UPDATE account_operation_claims SET state=?, updated_at=datetime('now')
    WHERE id=? AND auth_id=? AND state='active'`).bind(outcome,claim.id,claim.uid).run();
  const row=await db.prepare('SELECT state FROM account_operation_claims WHERE id=? AND auth_id=?').bind(claim.id,claim.uid).first();
  if (row?.state !== outcome) throw new Error('deletion_operation_conflict');
}
export async function beginDeletionAdmission(env, { uid, email = null, origin }) {
  identity(uid);
  if (!['user_request','inactivity'].includes(origin)) throw new Error('deletion_origin_invalid');
  if (email != null && (typeof email !== 'string' || email.length > 320)) throw new Error('deletion_email_invalid');
  const db = database(env);
  // Only a verified user request may upgrade an inactivity intent. A retry
  // from an automated worker cannot downgrade or invent cancellation consent.
  await db.prepare(`INSERT INTO account_deletion_admissions(id,auth_id,email,origin)
    VALUES(?,?,?,?) ON CONFLICT(auth_id) DO UPDATE SET origin='user_request',updated_at=datetime('now')
    WHERE excluded.origin='user_request' AND account_deletion_admissions.origin='inactivity'
      AND account_deletion_admissions.state='requested'`).bind(crypto.randomUUID(),uid,email,origin).run();
  const admission=await db.prepare('SELECT * FROM account_deletion_admissions WHERE auth_id=?').bind(uid).first();
  if (!admission) throw new Error('deletion_admission_unavailable');
  return admission;
}
export async function assertDeletionQuiescent(env, uid) {
  identity(uid);
  const db = database(env);
  const row=await db.prepare(`SELECT id, (
    SELECT COUNT(*) FROM account_operation_claims WHERE auth_id=? AND state != 'finished'
  ) AS pending FROM account_deletion_admissions WHERE auth_id=?`).bind(uid,uid).first();
  if (!row) throw new Error('deletion_admission_required');
  if (row.pending !== 0) throw new Error('deletion_operations_pending');
  return row.id;
}
