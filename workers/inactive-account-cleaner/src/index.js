import { isDevCutoverPaused } from '../../../app/functions/_lib/dev-cutover.js';
import { deletionWorkerSettings } from '../../../app/functions/_lib/deletion-worker-settings.js';
import { deliverDeletionNotifications } from '../../../app/functions/_lib/account-deletion-notifications.js';
import { admitAccountOperation, settleAccountOperation, beginDeletionAdmission } from '../../../app/functions/_lib/account-deletion-admission.js';
import { assertInactiveBillingClear } from '../../../app/functions/_lib/account-deletion-billing.js';
import { inactiveAccountEligibility, inactivityWarningEligibility, hasCurrentInactivityWarning } from '../../../app/functions/_lib/account-inactivity-policy.js';
import { sendInactivityWarning } from '../../../app/functions/_lib/account-inactivity-warning.js';
import { processAccountDeletion } from '../../../app/functions/_lib/account-deletion-process.js';
import { createFirebaseDeletionClient } from '../../../shared/firebase-deletion-client.js';

const BATCH_SIZE=5;
export default {
  async scheduled(event,env,ctx) {
    if(isDevCutoverPaused(env))return;
    ctx.waitUntil(runInactiveAccountCleanup(env).then(result=>{
      if(result.failed || result.uncertain)throw new Error('inactivity_batch_requires_review');
    }));
  },
  fetch() { return new Response('Not found',{status:404}); }
};

export async function runInactiveAccountCleanup(env,{afterUserId}={}) {
  const {mode,scope}=deletionWorkerSettings(env);
  if(afterUserId!==undefined && (mode!=='audit'||!Number.isSafeInteger(afterUserId)||afterUserId<0))throw new Error('inactivity_audit_cursor_invalid');
  const db=env.JOBHACKAI_DB;
  if(!db || typeof db.batch!=='function')throw new Error('inactivity_database_unavailable');
  const cursor=await db.prepare("SELECT last_user_id,revision FROM account_maintenance_cursors WHERE name='inactivity'").first();
  const after=afterUserId ?? (scope?0:cursor?.last_user_id??0);
  const results={mode,database_candidates:0,after_user_id:after,next_user_id:0,resumed:0,completed:0,pending:0,
    withdrawn:0,warnings_accepted:0,warnings_rejected:0,uncertain:0,skipped:0,billing_unverified:0,failed:0};
  // Notices already queued by completed erasure run independently. New erasure
  // below stages its notice for a later invocation; sending cannot roll it back.
  results.notifications=await deliverDeletionNotifications(env);
  if(mode==='execute') {
    results.failed+=results.notifications.failed+(results.notifications.expired_addresses_remaining>0?1:0);
    results.uncertain+=results.notifications.uncertain;
  }
  if(mode==='execute') {
    // Resume only saved intent. Unfinished operations and crashed execution
    // tokens require explicit reconciliation; this worker never expires them.
    const pending=await db.prepare(`SELECT a.auth_id FROM account_deletion_admissions a
      LEFT JOIN account_deletion_jobs j ON j.id=a.id
      WHERE a.state='requested' AND j.execution_token IS NULL AND (? IS NULL OR a.auth_id=?)
        AND NOT EXISTS(SELECT 1 FROM account_operation_claims c WHERE c.auth_id=a.auth_id AND c.state<>'finished')
      ORDER BY a.updated_at,a.id LIMIT ?`).bind(scope,scope,BATCH_SIZE).all();
    for(const intent of pending.results) {
      try {
        const result=await processAccountDeletion(env,{uid:intent.auth_id});
        results.resumed++;recordResult(results,result);
      } catch (_) { results.failed++; }
      // Rotate a retryable pending record behind other work. This is not a
      // lease or authorization to bypass unfinished claims/provider uncertainty.
      await db.prepare("UPDATE account_deletion_admissions SET updated_at=datetime('now') WHERE auth_id=? AND state='requested'")
        .bind(intent.auth_id).run();
    }
  }
  const candidates=await db.prepare(`SELECT u.id,u.auth_id FROM users u WHERE u.id>?
    AND (? IS NULL OR u.auth_id=?) AND (u.plan IS NULL OR u.plan IN ('free','pack'))
    AND (u.last_login_at IS NOT NULL OR u.last_activity_at IS NOT NULL)
    AND (u.last_login_at IS NULL OR julianday(u.last_login_at)<=julianday('now','-23 months'))
    AND (u.last_activity_at IS NULL OR julianday(u.last_activity_at)<=julianday('now','-23 months'))
    AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions d WHERE d.auth_id=u.auth_id)
    AND NOT EXISTS(SELECT 1 FROM deleted_auth_ids d WHERE d.auth_id=u.auth_id)
    AND NOT EXISTS(SELECT 1 FROM account_operation_claims c WHERE c.auth_id=u.auth_id AND c.state<>'finished')
    ORDER BY u.id LIMIT ?`).bind(after,scope,scope,BATCH_SIZE+1).all();
  const owners=candidates.results.slice(0,BATCH_SIZE);
  results.database_candidates=owners.length;
  results.next_user_id=candidates.results.length>BATCH_SIZE?owners.at(-1).id:0;
  if(mode==='audit') {
    results.eligibility='provider_checks_not_run';
    console.log('[inactive-cleaner] audit batch',results);
    return results;
  }
  let identity;
  for(const owner of owners) {
    let claim=null,outcome='finished';
    try {
      try {claim=await admitAccountOperation(env,owner.auth_id,'maintenance',{purpose:'inactivity'});}
      catch(error) {
        if(['account_operation_busy','account_deletion_pending','account_operation_suppressed'].includes(error.message)){results.skipped++;continue;}
        throw error;
      }
      let user=await db.prepare('SELECT * FROM users WHERE id=? AND auth_id=?').bind(owner.id,owner.auth_id).first();
      if(!user){results.skipped++;continue;}
      identity ??= await createFirebaseDeletionClient(env.FIREBASE_SERVICE_ACCOUNT_JSON,env.FIREBASE_PROJECT_ID);
      let activity=await identity.activity(owner.auth_id);
      if(!inactivityWarningEligibility(user,activity).eligible){results.skipped++;continue;}
      try {await assertInactiveBillingClear(env,{uid:owner.auth_id,user,email:user.email});}
      catch(_){results.billing_unverified++;continue;}
      activity=await identity.activity(owner.auth_id);
      user=await db.prepare('SELECT * FROM users WHERE id=? AND auth_id=?').bind(owner.id,owner.auth_id).first();
      if(!inactivityWarningEligibility(user,activity).eligible){results.skipped++;continue;}
      const warning=await db.prepare('SELECT * FROM account_inactivity_warnings WHERE auth_id=?').bind(owner.auth_id).first();
      if(inactiveAccountEligibility(user,warning,activity).eligible) {
        await beginDeletionAdmission(env,{uid:owner.auth_id,email:user.email,origin:'inactivity'});
        // Intent blocks new work; release our maintenance before recovery's
        // quiescence check so deletion cannot wait on its own claim.
        await settleAccountOperation(env,claim,'finished');claim=null;
        recordResult(results,await processAccountDeletion(env,{uid:owner.auth_id}));
      } else if(!hasCurrentInactivityWarning(user,warning,activity)) {
        const delivered=await sendInactivityWarning(env,user,claim,()=>{outcome='uncertain';});
        outcome=delivered.uncertain?'uncertain':'finished';
        if(delivered.status==='accepted')results.warnings_accepted++;
        else if(delivered.status==='rejected')results.warnings_rejected++;
        else if(delivered.status==='uncertain')results.uncertain++;
        else results.skipped++;
      } else results.skipped++;
    } catch (_) { results.failed++; }
    finally {
      if(claim) await settleAccountOperation(env,claim,outcome);
    }
  }
  if(!scope && results.failed===0) {
    const changed=cursor
      ? await db.prepare("UPDATE account_maintenance_cursors SET last_user_id=?,revision=revision+1,updated_at=datetime('now') WHERE name='inactivity' AND revision=?")
        .bind(results.next_user_id,cursor.revision).run()
      : await db.prepare("INSERT INTO account_maintenance_cursors(name,last_user_id,revision) VALUES('inactivity',?,1) ON CONFLICT(name) DO NOTHING")
        .bind(results.next_user_id).run();
    results.cursor_advanced=changed.meta?.changes===1;
  }
  console.log('[inactive-cleaner] cleanup batch',results);
  return results;
}

function recordResult(results,result) {
  if(result.status==='complete')results.completed++;
  else if(result.status==='withdrawn')results.withdrawn++;
  else results.pending++;
}
