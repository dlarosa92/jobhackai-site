import { getDb } from './db.js';
import { beginDeletionAdmission, assertDeletionQuiescent } from './account-deletion-admission.js';
import { prepareDeletionRecovery, advanceDeletionRecovery, finishDeletionRecovery, withdrawInactiveDeletion } from './account-deletion-recovery.js';
import { cancelBillingBeforeDeletion, assertInactiveBillingClear } from './account-deletion-billing.js';
import { inactiveAccountEligibility } from './account-inactivity-policy.js';
import { assertStripeKeyMatchesEnvironment } from './stripe-environment.js';
import { createFirebaseDeletionClient } from '../../../shared/firebase-deletion-client.js';

const messages = {
  waiting_for_operations: 'Your deletion request is saved and is waiting for earlier account activity to finish. Sign-in has not been removed.',
  execution_in_progress: 'Your deletion request is saved. Another cleanup attempt needs to finish or be reviewed before it can continue.',
  billing_unconfirmed: 'Your deletion request is saved, but billing is not yet confirmed settled. Sign-in has not been removed. Some subscriptions may already be canceled and open checkouts may have expired.',
  identity_unconfirmed: 'Your deletion request is saved. Sign-in removal is not yet confirmed, and stored content has not been erased.',
  cleanup_pending: 'Sign-in access has been removed. Your deletion request is saved, but stored-content cleanup is not yet complete.',
  inactivity_billing_unconfirmed: 'Automatic inactivity cleanup is waiting for billing verification. It has not canceled subscriptions or expired checkouts.',
  inactivity_review_required: 'Automatic inactivity cleanup requires review before it can continue.',
  recovery_unavailable: 'Your deletion request is saved, but cleanup is not yet complete.'
};
const complete = job => ({ ok:true,status:'complete',reference:job.id,identityRemoved:true,message:'Your account and saved tool content have been deleted. Required billing and security records are retained.' });
const knownIdentityState = job => job?.phase==='identity_removed'?true:job?.phase==='billing_verified'?null:false;
const pending = (reference,code,identityRemoved=false) => ({ok:true,status:'pending',reference,identityRemoved,code,
  message:messages[code]+' Contact privacy@jobhackai.io with this reference if you need help.'});

// Invoked only with a verified request UID, or by a future authenticated runner
// using a stored intent. Never accept an arbitrary UID from an HTTP request body.
export async function processAccountDeletion(env, {uid,email=null,requestedByUser=false}) {
  if (typeof uid!=='string' || !uid || uid.length>128) throw new Error('deletion_identity_invalid');
  if (typeof requestedByUser!=='boolean') throw new Error('deletion_request_invalid');
  const db=getDb(env);
  if (!db || typeof db.batch!=='function') throw new Error('deletion_configuration_unavailable');
  let job=await db.prepare('SELECT * FROM account_deletion_jobs WHERE auth_id=?').bind(uid).first();
  let admission=await db.prepare('SELECT * FROM account_deletion_admissions WHERE auth_id=?').bind(uid).first();
  if (!requestedByUser && !admission) throw new Error('deletion_admission_required');
  if (job?.phase==='complete') return complete(job);
  if (typeof env.JOBHACKAI_KV?.delete!=='function') throw new Error('deletion_configuration_unavailable');
  let identity;
  if (job?.phase!=='identity_removed') {
    if (!assertStripeKeyMatchesEnvironment(env).ok || typeof env.JOBHACKAI_KV?.get!=='function') throw new Error('deletion_configuration_unavailable');
    // Parse and import credentials before accepting a new intent. The client
    // pins its project to the same project used for Firebase token verification.
    identity=await createFirebaseDeletionClient(env.FIREBASE_SERVICE_ACCOUNT_JSON,env.FIREBASE_PROJECT_ID);
  }
  if (requestedByUser) admission=await beginDeletionAdmission(env,{uid,email,origin:'user_request'});
  if (!['user_request','inactivity'].includes(admission?.origin)) throw new Error('deletion_origin_invalid');
  const inactivity=admission.origin==='inactivity';
  try { await assertDeletionQuiescent(env,uid); }
  catch(error) {
    if(error.message==='deletion_operations_pending') return pending(admission.id,'waiting_for_operations',knownIdentityState(job));
    throw error;
  }
  job=await prepareDeletionRecovery(env,{uid,email});
  if(job.phase==='complete') return complete(job);
  const execution=crypto.randomUUID();
  const acquired=await db.prepare(`UPDATE account_deletion_jobs SET execution_token=?,execution_started_at=datetime('now'),
    attempts=attempts+1,updated_at=datetime('now') WHERE id=? AND execution_token IS NULL AND phase<>'complete'
    RETURNING *`).bind(execution,job.id).first();
  if(!acquired) {
    const current=await db.prepare('SELECT * FROM account_deletion_jobs WHERE id=?').bind(job.id).first();
    return current?.phase==='complete'?complete(current):pending(job.id,'execution_in_progress',knownIdentityState(current));
  }
  job=acquired;
  let stage='recovery_unavailable',identityRemoved=knownIdentityState(job),billingChecked=false;
  async function checkInactivity() {
    stage='inactivity_review_required';
    const activity=await identity.activity(uid);
    if (!activity) { identityRemoved=null;throw new Error('inactivity_identity_unconfirmed'); }
    identityRemoved=false;
    const user=await db.prepare('SELECT * FROM users WHERE auth_id=?').bind(uid).first();
    if (!user || user.id!==job.user_id) throw new Error('deletion_owner_changed');
    const warning=await db.prepare('SELECT * FROM account_inactivity_warnings WHERE auth_id=?').bind(uid).first();
    if (!inactiveAccountEligibility(user,warning,activity).eligible) {
      return withdrawInactiveDeletion(env,job.id,execution);
    }
    return null;
  }
  async function billing() {
    stage=inactivity?'inactivity_billing_unconfirmed':'billing_unconfirmed';
    await assertDeletionQuiescent(env,uid);
    const user=await db.prepare('SELECT id,auth_id,email,stripe_customer_id FROM users WHERE auth_id=?').bind(uid).first();
    if((user && user.id!==job.user_id) || (!user && job.user_id!==null)) throw new Error('deletion_owner_changed');
    try {
      await (inactivity?assertInactiveBillingClear:cancelBillingBeforeDeletion)(env,{uid,user,email:job.email});
    } catch(error) {
      // Automated cleanup never modified billing. With a fresh confirmation
      // that sign-in still exists, restore access instead of locking a paying
      // or unverifiable account behind an automatic cleanup intent.
      if(inactivity) {
        const stillExists=await identity.exists(uid);
        identityRemoved=stillExists?false:null;
        if(stillExists) return withdrawInactiveDeletion(env,job.id,execution,'inactivity_billing_unconfirmed');
      }
      throw error;
    }
    billingChecked=true;
    return null;
  }
  try {
    if(job.phase==='prepared') {
      if(inactivity) { const withdrawn=await checkInactivity();if(withdrawn)return withdrawn; }
      { const withdrawn=await billing();if(withdrawn)return withdrawn; }
      job=await advanceDeletionRecovery(env,job.id,'billing_verified');
    }
    if(job.phase==='billing_verified') {
      stage='identity_unconfirmed';identityRemoved=null;
      const exists=await identity.exists(uid);
      if(exists) {
        identityRemoved=false;
        if(inactivity) { const withdrawn=await checkInactivity();if(withdrawn)return withdrawn; }
        // On retry, recheck billing if identity removal has not happened.
        // If a previous delete already succeeded, skip provider cancellation.
        if(!billingChecked) { const withdrawn=await billing();if(withdrawn)return withdrawn; }
        // Recheck provider activity after a potentially slow Stripe scan too.
        if(inactivity) { const withdrawn=await checkInactivity();if(withdrawn)return withdrawn; }
        stage='identity_unconfirmed';identityRemoved=null;
        try { await identity.remove(uid); } catch (_) { /* lookup reconciles ambiguous deletion */ }
        if(await identity.exists(uid)) {
          identityRemoved=false;
          throw new Error('deletion_identity_still_present');
        }
      }
      identityRemoved=true;
      job=await advanceDeletionRecovery(env,job.id,'identity_removed');
    }
    if(job.phase==='identity_removed') {
      identityRemoved=true;stage='cleanup_pending';
      await finishDeletionRecovery(env,job.id);
      return complete(job);
    }
    throw new Error('deletion_phase_invalid');
  } catch (_) {
    await db.prepare(`UPDATE account_deletion_jobs SET last_error_code=?,updated_at=datetime('now')
      WHERE id=? AND execution_token=? AND phase<>'complete'`).bind(stage,job.id,execution).run().catch(()=>{});
    return pending(job.id,identityRemoved===true?'cleanup_pending':stage,identityRemoved);
  } finally {
    // No lease expiry or takeover. If execution is killed or this write fails,
    // the token remains for explicit reconciliation, not unsafe parallel work.
    await db.prepare(`UPDATE account_deletion_jobs SET execution_token=NULL,execution_started_at=NULL,
      updated_at=datetime('now') WHERE id=? AND execution_token=?`).bind(job.id,execution).run();
  }
}
