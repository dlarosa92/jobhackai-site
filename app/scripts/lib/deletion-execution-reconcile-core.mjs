import { createHash, randomUUID } from 'node:crypto';

export const TARGETS = Object.freeze({
  dev:'c5c0eee5-a223-4ea2-974e-f4aee5a28bab',
  qa:'80d87a73-6615-4823-b7a4-19a8821b4f87',
  prod:'f9b709fd-56c3-4a0b-8141-4542327c9d4d'
});
const fields=['id','auth_id','phase','execution_token','execution_started_at','attempts','updated_at','origin','admission_state','pending_operations'];
export const ref = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9:/._-]{0,199}$/.test(value);
export function literal(value) {
  if(typeof value!=='string' || value.includes('\0'))throw Error('reconciliation_value_invalid');
  return "'"+value.replace(/'/g,"''")+"'";
}
export function assertTarget(environment) {
  if(!Object.hasOwn(TARGETS,environment))throw Error('reconciliation_environment_required');
  return TARGETS[environment];
}
export function inspectionSql(jobId) {
  if(!ref(jobId))throw Error('reconciliation_job_invalid');
  return `SELECT j.id,j.auth_id,j.phase,j.execution_token,j.execution_started_at,j.attempts,j.updated_at,
    a.origin,a.state AS admission_state,
    (SELECT COUNT(*) FROM account_operation_claims c WHERE c.auth_id=j.auth_id AND c.state<>'finished') AS pending_operations
    FROM account_deletion_jobs j LEFT JOIN account_deletion_admissions a ON a.id=j.id AND a.auth_id=j.auth_id
    WHERE j.id=${literal(jobId)}`;
}
export function receiptSql(id,jobId) {
  if(!ref(id) || !ref(jobId))throw Error('reconciliation_reference_invalid');
  return `SELECT id,job_id,phase,evidence_sha256,created_at FROM deletion_execution_reconciliations
    WHERE id=${literal(id)} AND job_id=${literal(jobId)}`;
}
export function inspectReport(environment,job,now=Date.now()) {
  const databaseId=assertTarget(environment);
  if(!job)throw Error('reconciliation_job_missing');
  return {version:1,environment,databaseId,inspectedAt:new Date(now).toISOString(),
    snapshot:Object.fromEntries(fields.map(field=>[field,job[field]])),
    // An inventory is deliberately not executable evidence.
    evidence:null};
}
function timestamp(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return NaN;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z')?parsed:NaN;
}
export function validateReviewEvidence(evidence,{executionId,startedAt,providerStates=['settled'],now=Date.now()}) {
  const terminalAt=timestamp(evidence?.invocation?.observedAt),providerAt=timestamp(evidence?.providers?.observedAt);
  const startText=String(startedAt).replace(' ','T');
  const started=timestamp(startText.endsWith('Z')?startText:startText+'Z');
  if(!ref(evidence?.operatorRef) || !ref(evidence?.invocation?.reference) || !ref(evidence?.providers?.reference) ||
      !['completed','terminated'].includes(evidence?.invocation?.status) ||
      evidence?.invocation?.executionToken!==executionId || evidence?.providers?.pendingRequests!==false ||
      !Number.isFinite(started) || !Number.isFinite(terminalAt) || !Number.isFinite(providerAt) ||
      terminalAt<started || providerAt<terminalAt || providerAt>now || now-providerAt>30*60*1000 ||
      !providerStates.includes(evidence.providers.status)) {
    throw Error('reconciliation_review_evidence_required');
  }
}
export function planReconciliation(report,current,environment,now=Date.now()) {
  const databaseId=assertTarget(environment);
  if(report?.version!==1 || report.environment!==environment || report.databaseId!==databaseId)throw Error('reconciliation_target_mismatch');
  const job=report.snapshot;
  if(!job || !current || fields.some(field=>job[field]!==current[field]))throw Error('reconciliation_snapshot_changed');
  if(!['prepared','billing_verified','identity_removed'].includes(job.phase) || !ref(job.id) ||
      !ref(job.execution_token) || !job.execution_started_at || job.admission_state!=='requested' ||
      !['user_request','inactivity'].includes(job.origin) || job.pending_operations!==0)throw Error('reconciliation_job_not_releasable');
  const evidence=report.evidence;
  validateReviewEvidence(evidence,{executionId:job.execution_token,startedAt:job.execution_started_at,
    providerStates:job.phase==='identity_removed'?['settled','storage_only']:['settled'],now});
  // This validates an operator's reviewed evidence, not the truth of a checkbox.
  // The runbook requires authoritative invocation and provider observations.
  const evidenceHash=createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const id=randomUUID();
  // An atomic guard inside the INSERT repeats the snapshot check, not merely
  // the preceding SELECT. The trigger updates exactly one job or rolls back.
  const conditions=fields.filter(field=>!['origin','admission_state','pending_operations'].includes(field)).map(field=>{
    const value=job[field];
    if(value===null)return `${field} IS NULL`;
    if(typeof value==='number') {
      if(!Number.isSafeInteger(value))throw Error('reconciliation_value_invalid');
      return `${field} IS ${value}`;
    }
    return `${field} IS ${literal(value)}`;
  }).join(' AND ');
  const sql=`INSERT INTO deletion_execution_reconciliations
    (id,job_id,execution_token,phase,job_updated_at,admission_origin,evidence_sha256,operator_ref,invocation_ref,provider_ref)
    VALUES (${literal(id)},(SELECT id FROM account_deletion_jobs WHERE ${conditions}),
      ${literal(job.execution_token)},${literal(job.phase)},${literal(job.updated_at)},${literal(job.origin)},
      ${literal(evidenceHash)},${literal(evidence.operatorRef)},${literal(evidence.invocation.reference)},${literal(evidence.providers.reference)});`;
  return {id,environment,databaseId,jobId:job.id,phase:job.phase,evidenceHash,sql};
}
