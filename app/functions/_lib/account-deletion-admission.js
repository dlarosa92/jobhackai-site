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
export async function admitAccountOperation(env, uid, kind = 'account') {
  identity(uid);
  if (!['billing', 'account'].includes(kind)) throw new Error('deletion_operation_invalid');
  const db = database(env), id = crypto.randomUUID();
  // This check and admission are ONE statement, serialized with deletion's
  // intent insert. An unlocked SELECT followed by INSERT would race deletion.
  const result = await db.prepare(`INSERT INTO account_operation_claims(id,auth_id,kind)
    SELECT ?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM account_deletion_admissions WHERE auth_id = ?
    )`).bind(id,uid,kind,uid).run();
  if (result.meta?.changes !== 1) throw new Error('account_deletion_pending');
  return { id, uid, kind };
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
export async function beginDeletionAdmission(env, { uid, email = null }) {
  identity(uid);
  if (email != null && (typeof email !== 'string' || email.length > 320)) throw new Error('deletion_email_invalid');
  const db = database(env);
  await db.prepare(`INSERT INTO account_deletion_admissions(id,auth_id,email)
    VALUES(?,?,?) ON CONFLICT(auth_id) DO NOTHING`).bind(crypto.randomUUID(),uid,email).run();
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
