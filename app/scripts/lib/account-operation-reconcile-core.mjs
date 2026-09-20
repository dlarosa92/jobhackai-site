import {createHash,randomUUID} from 'node:crypto';
import {assertTarget,literal,ref,validateReviewEvidence} from './deletion-execution-reconcile-core.mjs';

const fields=['id','auth_id','kind','purpose','state','created_at','updated_at','webhook_event_id','analytics_event_key',
  'user_id','followup_marker','warning_id','warning_state','warning_operation','warning_receipt','warning_sent_at','warning_user_time',
  'analytics_state','analytics_updated_at'];
export function inspectionSql(id) {
  if(!ref(id))throw Error('reconciliation_operation_invalid');
  return `SELECT c.id,c.auth_id,c.kind,c.purpose,c.state,c.created_at,c.updated_at,c.webhook_event_id,c.analytics_event_key,
    u.id AS user_id,u.voice_followup_email_sent_at AS followup_marker,
    w.id AS warning_id,w.state AS warning_state,w.operation_id AS warning_operation,w.provider_id AS warning_receipt,
    w.sent_at AS warning_sent_at,u.deletion_warning_sent_at AS warning_user_time,
    d.state AS analytics_state,d.updated_at AS analytics_updated_at
    FROM account_operation_claims c LEFT JOIN users u ON u.auth_id=c.auth_id
    LEFT JOIN account_inactivity_warnings w ON w.auth_id=c.auth_id AND c.purpose='inactivity'
    LEFT JOIN analytics_delivery d ON d.event_key=c.analytics_event_key AND c.purpose='analytics'
    WHERE c.id=${literal(id)}`;
}
export function receiptSql(id,operationId) {
  if(!ref(id)||!ref(operationId))throw Error('reconciliation_reference_invalid');
  return `SELECT id,operation_id,disposition,evidence_sha256,created_at FROM account_operation_reconciliations
    WHERE id=${literal(id)} AND operation_id=${literal(operationId)}`;
}
export function inspectReport(environment,row,now=Date.now()) {
  if(!row)throw Error('reconciliation_operation_missing');
  return {version:1,targetType:'account_operation',environment,databaseId:assertTarget(environment),
    inspectedAt:new Date(now).toISOString(),snapshot:Object.fromEntries(fields.map(field=>[field,row[field]])),
    disposition:null,evidence:null};
}
export function planReconciliation(report,current,environment,now=Date.now()) {
  const databaseId=assertTarget(environment),row=report?.snapshot,disposition=report?.disposition;
  if(report?.version!==1 || report.targetType!=='account_operation' || report.environment!==environment || report.databaseId!==databaseId)throw Error('reconciliation_target_mismatch');
  if(!row || !current || fields.some(field=>row[field]!==current[field]))throw Error('reconciliation_snapshot_changed');
  const kinds={api:['account','billing'],webhook:['billing'],analytics:['account'],followup:['account'],retention:['maintenance'],inactivity:['maintenance'],maintenance:['maintenance']};
  if(!['active','uncertain'].includes(row.state) || !ref(row.id) || !Array.isArray(kinds[row.purpose]) || !kinds[row.purpose].includes(row.kind) ||
    (row.purpose==='analytics')!==(row.analytics_event_key!==null) || (row.purpose==='webhook')!==(row.webhook_event_id!==null))throw Error('reconciliation_operation_not_releasable');
  if(!['verified','retry_storage','suppress_delivery'].includes(disposition) ||
      (disposition==='retry_storage' && row.purpose!=='retention') ||
      (disposition==='suppress_delivery' && !['analytics','followup','inactivity'].includes(row.purpose)))throw Error('reconciliation_disposition_invalid');
  if(disposition==='verified') {
    // Do not manufacture delivery proof or turn a pending send into a retry.
    if((row.purpose==='analytics' && !['accepted_unverified','rejected','expired','ineligible'].includes(row.analytics_state)) ||
       (row.purpose==='followup' && (!row.followup_marker || report.evidence?.providers?.deliveryOutcome!=='accepted')) ||
       (row.purpose==='inactivity' && (row.warning_state!=='sent' || row.warning_operation!==row.id || !row.warning_receipt ||
         !row.warning_sent_at || row.warning_user_time!==row.warning_sent_at)))throw Error('reconciliation_delivery_not_verified');
  }
  const providerStates=disposition==='retry_storage'?['storage_only','settled']:
    disposition==='suppress_delivery'?['settled','settled_unknown']:['settled'];
  validateReviewEvidence(report.evidence,{executionId:row.id,startedAt:row.created_at,providerStates,now});
  const evidenceHash=createHash('sha256').update(JSON.stringify(report)).digest('hex'),id=randomUUID();
  const value=v=>v===null?'NULL':typeof v==='number' && Number.isSafeInteger(v)?String(v):literal(v);
  // Re-read every operational/receipt field inside the one guarded INSERT.
  const currentSql=inspectionSql(row.id);
  const conditions=fields.map(field=>`${field} IS ${value(row[field])}`).join(' AND ');
  const sql=`INSERT INTO account_operation_reconciliations
    (id,operation_id,auth_id,kind,purpose,state_before,updated_before,analytics_event_key,disposition,evidence_sha256,operator_ref,invocation_ref,provider_ref)
    VALUES (${literal(id)},(SELECT id FROM (${currentSql}) WHERE ${conditions}),${literal(row.auth_id)},${literal(row.kind)},
      ${literal(row.purpose)},${literal(row.state)},${literal(row.updated_at)},${value(row.analytics_event_key)},${literal(disposition)},
      ${literal(evidenceHash)},${literal(report.evidence.operatorRef)},${literal(report.evidence.invocation.reference)},${literal(report.evidence.providers.reference)});`;
  return {id,environment,databaseId,operationId:row.id,disposition,evidenceHash,sql};
}
