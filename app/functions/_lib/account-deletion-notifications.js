import { getDb } from './db.js';
import { deletionWorkerSettings } from './deletion-worker-settings.js';

const SEND_BATCH=5,RETENTION_BATCH=100;
const rejected=new Set([400,401,403,404,405,406,413,415,422]);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scopeSql='(? IS NULL OR j.auth_id=?)';

// Independent outbox: a failed notification never reopens account erasure or
// recreates content. No account-operation claim is admitted for a deleted UID.
export async function deliverDeletionNotifications(env) {
  const {mode,environment,scope}=deletionWorkerSettings(env),db=getDb(env);
  if(!db || typeof db.batch!=='function')throw new Error('deletion_notifications_database_unavailable');
  const result={mode,eligible:0,accepted:0,rejected:0,uncertain:0,failed:0,skipped:0,
    addresses_redacted:0,receipts_purged:0,expired_addresses_remaining:0};
  const expired=`n.email IS NOT NULL AND (julianday(n.expires_at)<=julianday('now') OR julianday(n.expires_at) IS NULL)`;
  const oldReceipt=`n.email IS NULL AND n.state IN ('sent','expired') AND julianday(n.created_at)<julianday('now','-90 days')`;
  if(mode==='execute') {
    // Redaction never grants a retry or takes over an execution. An already
    // in-flight call may record its result without restoring the address.
    const redacted=await db.prepare(`UPDATE account_deletion_notifications SET email=NULL,state='expired',
      next_attempt_at=NULL,last_error_code='notification_retention_expired' WHERE job_id IN (
        SELECT n.job_id FROM account_deletion_notifications n JOIN account_deletion_jobs j ON j.id=n.job_id
        WHERE ${scopeSql} AND ${expired} ORDER BY n.expires_at,n.job_id LIMIT ?)`)
      .bind(scope,scope,RETENTION_BATCH).run();
    result.addresses_redacted=redacted.meta?.changes||0;
    const purged=await db.prepare(`DELETE FROM account_deletion_notifications WHERE job_id IN (
      SELECT n.job_id FROM account_deletion_notifications n JOIN account_deletion_jobs j ON j.id=n.job_id
      WHERE ${scopeSql} AND ${oldReceipt} ORDER BY n.created_at,n.job_id LIMIT ?)`)
      .bind(scope,scope,RETENTION_BATCH).run();
    result.receipts_purged=purged.meta?.changes||0;
  }
  result.expired_addresses_remaining=await db.prepare(`SELECT COUNT(*) AS n FROM account_deletion_notifications n
    JOIN account_deletion_jobs j ON j.id=n.job_id WHERE ${scopeSql} AND ${expired}`).bind(scope,scope).first('n');
  const candidates=await db.prepare(`SELECT n.job_id FROM account_deletion_notifications n
    JOIN account_deletion_jobs j ON j.id=n.job_id
    WHERE ${scopeSql} AND j.phase='complete' AND n.state='pending' AND n.attempts<3
      AND n.execution_token IS NULL AND n.email IS NOT NULL
      AND julianday(n.expires_at)>julianday('now') AND julianday(n.next_attempt_at)<=julianday('now')
      AND EXISTS(SELECT 1 FROM account_deletion_admissions a WHERE a.id=j.id AND a.auth_id=j.auth_id AND a.state='complete')
    ORDER BY julianday(n.created_at),n.job_id LIMIT ?`).bind(scope,scope,SEND_BATCH).all();
  result.eligible=candidates.results.length;
  if(mode==='audit' || !result.eligible)return result;
  const frontend={dev:'https://dev.jobhackai.io',qa:'https://qa.jobhackai.io',prod:'https://app.jobhackai.io'}[environment];
  if(!env.RESEND_API_KEY || env.FRONTEND_URL!==frontend) {result.failed++;return result;}
  for(const candidate of candidates.results) {
    const token=crypto.randomUUID();
    // Selection grants nothing. This one statement owns dispatch and rechecks
    // completion, scope, deadline and attempt count against concurrent workers.
    const notice=await db.prepare(`UPDATE account_deletion_notifications SET state='sending',execution_token=?,
      execution_started_at=datetime('now'),attempts=attempts+1,last_error_code=NULL
      WHERE job_id=? AND state='pending' AND execution_token IS NULL AND attempts<3 AND email IS NOT NULL
        AND julianday(expires_at)>julianday('now') AND julianday(next_attempt_at)<=julianday('now')
        AND EXISTS(SELECT 1 FROM account_deletion_jobs j JOIN account_deletion_admissions a ON a.id=j.id AND a.auth_id=j.auth_id
          WHERE j.id=account_deletion_notifications.job_id AND j.phase='complete' AND a.state='complete' AND ${scopeSql}) RETURNING *`)
      .bind(token,candidate.job_id,scope,scope).first();
    if(!notice){result.skipped++;continue;}
    let outcome='uncertain',providerId=null;
    if(notice.template_version!=='account-deletion-v1' || typeof notice.email!=='string' || notice.email.length>320 ||
        /[\s<>]/.test(notice.email) || !notice.email.includes('@')) {
      await db.prepare(`UPDATE account_deletion_notifications SET state='needs_review',last_error_code='notification_input_invalid',
        next_attempt_at=NULL WHERE job_id=? AND execution_token=? AND state='sending'`).bind(notice.job_id,token).run();
      result.failed++;continue;
    }
    // Retain this version's renderer for pending rows if future copy changes.
    const body={from:'JobHackAI <noreply@jobhackai.io>',to:[notice.email],
      subject:(environment==='prod'?'':`[${environment.toUpperCase()}] `)+'Your JobHackAI account deletion is complete',
      html:`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#1F2937">
        <h2>Your account deletion is complete</h2>
        <p>Your JobHackAI account and saved tool content have been deleted. Required billing and security records are retained.</p>
        <p>Deletion reference: ${escape(notice.job_id)}</p>
        <p>If you have questions, contact privacy@jobhackai.io with this reference.</p>
        <p><a href="${frontend}/privacy">Privacy policy</a></p><p>JobHackAI</p></div>`};
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json',
          'Idempotency-Key':`account-deletion/${notice.job_id}`},body:JSON.stringify(body)});
      if(!response.ok) {outcome=rejected.has(response.status)?'rejected':'uncertain';await response.body?.cancel();}
      else {const receipt=await response.json();if(typeof receipt?.id==='string' && receipt.id && receipt.id.length<=256){providerId=receipt.id;outcome='accepted';}}
    } catch (_) { /* A timeout cannot be treated as a definite rejection. */ }
    try {
      let saved;
      if(outcome==='accepted') {
        saved=await db.prepare(`UPDATE account_deletion_notifications SET state='sent',email=NULL,provider_id=?,
          sent_at=datetime('now'),execution_token=NULL,execution_started_at=NULL,next_attempt_at=NULL,last_error_code=NULL
          WHERE job_id=? AND execution_token=? AND state IN ('sending','expired')`).bind(providerId,notice.job_id,token).run();
      } else {
        const next=outcome==='rejected' && notice.attempts<3?'pending':'needs_review';
        const delay=notice.attempts===1?'+1 hour':'+4 hours';
        saved=await db.prepare(`UPDATE account_deletion_notifications SET
          state=CASE WHEN state='expired' THEN 'expired' ELSE ? END,
          next_attempt_at=CASE WHEN state<>'expired' AND ?='pending' THEN datetime('now',?) ELSE NULL END,
          execution_token=CASE WHEN ?='rejected' THEN NULL ELSE execution_token END,
          execution_started_at=CASE WHEN ?='rejected' THEN NULL ELSE execution_started_at END,
          last_error_code=? WHERE job_id=? AND execution_token=? AND state IN ('sending','expired')`)
          .bind(next,next,delay,outcome,outcome,outcome==='rejected'?'provider_rejected':'provider_unconfirmed',notice.job_id,token).run();
      }
      if(saved.meta?.changes!==1)throw new Error('notification_receipt_unconfirmed');
      result[outcome]++;
      if(outcome==='rejected' && notice.attempts>=3)result.failed++;
    } catch (_) {
      // Leave the existing sending/expired state and token. A persistence
      // failure after acceptance never becomes permission to dispatch again.
      result.failed++;
    }
  }
  return result;
}
