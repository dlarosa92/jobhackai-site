import {createHash,randomUUID} from 'node:crypto';
import {assertTarget,literal,ref,validateReviewEvidence} from './deletion-execution-reconcile-core.mjs';

const CALL_ID=/^rtc_[A-Za-z0-9_-]{1,240}$/;
const value=v=>v===null?'NULL':typeof v==='number' && Number.isSafeInteger(v)?String(v):literal(v);
const controlFields=['control_owner','current_attempt_id','deadline_at','reserved_at','legacy_unverified','closed_at','control_created','control_updated'];
const callFields=['id','auth_id','session_id','state','provider_call_id','provider_key_sha256','execution_token','created_at','updated_at','last_error_code','provider_closed_at',...controlFields];
const legacyFields=['id','auth_id','session_id','created_at',...controlFields,'pending_calls'];

function core(kind) {
  const isCall=kind==='voice_call',fields=isCall?callFields:legacyFields;
  const inspectionSql=id=>{
    if(!ref(id))throw Error('reconciliation_voice_target_invalid');
    return isCall?`SELECT p.id,p.auth_id,p.session_id,p.state,p.provider_call_id,p.provider_key_sha256,
      p.execution_token,p.created_at,p.updated_at,p.last_error_code,p.closed_at AS provider_closed_at,c.auth_id AS control_owner,c.current_attempt_id,c.deadline_at,
      c.reserved_at,c.legacy_unverified,c.closed_at,c.created_at AS control_created,c.updated_at AS control_updated
      FROM voice_provider_calls p LEFT JOIN voice_interview_controls c ON c.session_id=p.session_id
      WHERE p.id=${literal(id)}`:
      `SELECT c.session_id AS id,c.auth_id,c.session_id,c.created_at,c.auth_id AS control_owner,c.current_attempt_id,
        c.deadline_at,c.reserved_at,c.legacy_unverified,c.closed_at,c.created_at AS control_created,c.updated_at AS control_updated,
        (SELECT COUNT(*) FROM voice_provider_calls p WHERE p.session_id=c.session_id AND p.state<>'closed') AS pending_calls
        FROM voice_interview_controls c WHERE c.session_id=${literal(id)}`;
  };
  const receiptSql=(id,targetId)=>{
    if(!ref(id)||!ref(targetId))throw Error('reconciliation_reference_invalid');
    return `SELECT id,target_id,session_id,resolution,evidence_sha256,created_at FROM voice_closure_reconciliations
      WHERE id=${literal(id)} AND target_kind=${literal(kind)} AND target_id=${literal(targetId)}`;
  };
  const inspectReport=(environment,row,now=Date.now())=>{
    if(!row)throw Error('reconciliation_voice_missing');
    return {version:1,targetType:kind,environment,databaseId:assertTarget(environment),
      inspectedAt:new Date(now).toISOString(),snapshot:Object.fromEntries(fields.map(f=>[f,row[f]])),resolution:null,evidence:null};
  };
  const planReconciliation=(report,current,environment,now=Date.now())=>{
    const databaseId=assertTarget(environment),row=report?.snapshot,resolution=report?.resolution;
    if(report?.version!==1 || report.targetType!==kind || report.environment!==environment || report.databaseId!==databaseId)throw Error('reconciliation_target_mismatch');
    if(!row || !current || fields.some(f=>row[f]!==current[f]))throw Error('reconciliation_snapshot_changed');
    if(!ref(row.id) || !ref(row.session_id) || !row.auth_id || row.control_owner!==row.auth_id)throw Error('reconciliation_voice_not_releasable');
    const evidence=report.evidence,provider=evidence?.providers;
    let resolvedId=null;
    if(isCall) {
      if(!['creating','active','closing','uncertain'].includes(row.state) || row.current_attempt_id!==row.id ||
        (row.execution_token!==null && !ref(row.execution_token)) ||
        !/^[a-f0-9]{64}$/.test(row.provider_key_sha256 || '') ||
        !['closed','not_created'].includes(resolution))throw Error('reconciliation_voice_not_releasable');
      if(provider?.attemptId!==row.id || provider?.providerKeySha256!==row.provider_key_sha256 || provider?.scope!=='one_create_attempt')throw Error('reconciliation_voice_provider_evidence_required');
      if(resolution==='not_created') {
        if(row.provider_call_id!==null || provider.providerCallId!==null || !ref(row.execution_token) ||
          !['creating','uncertain'].includes(row.state))throw Error('reconciliation_voice_provider_evidence_required');
      } else {
        resolvedId=provider.providerCallId;
        if(!CALL_ID.test(resolvedId || '') || (row.provider_call_id!==null && row.provider_call_id!==resolvedId))throw Error('reconciliation_voice_provider_evidence_required');
      }
    } else if(resolution!=='legacy_drained' || row.legacy_unverified!==1 || !row.closed_at || row.pending_calls!==0 ||
      provider?.scope!=='environment_legacy_calls' || provider?.issuersDisabled!==true ||
      provider?.credentialsDrained!==true || provider?.allInvocationsTerminal!==true) {
      throw Error('reconciliation_voice_legacy_evidence_required');
    }
    if(provider?.environment!==environment || !ref(provider?.projectRef))throw Error('reconciliation_voice_provider_evidence_required');
    validateReviewEvidence(evidence,{executionId:isCall?(row.execution_token || row.id):row.id,
      startedAt:isCall?row.updated_at:row.control_updated,providerStates:[resolution],now});
    const evidenceHash=createHash('sha256').update(JSON.stringify(report)).digest('hex'),id=randomUUID();
    // Every inspected field is rechecked inside the INSERT. Its trigger and
    // audit receipt commit together; drift, replay and conflicts roll back.
    const conditions=fields.map(f=>`${f} IS ${value(row[f])}`).join(' AND ');
    const sql=`INSERT INTO voice_closure_reconciliations
      (id,target_kind,target_id,auth_id,session_id,state_before,execution_before,provider_call_before,
        provider_key_sha256,resolved_provider_call_id,resolution,evidence_sha256,operator_ref,invocation_ref,provider_ref)
      VALUES (${literal(id)},${literal(kind)},(SELECT id FROM (${inspectionSql(row.id)}) WHERE ${conditions}),
        ${literal(row.auth_id)},${literal(row.session_id)},${value(isCall?row.state:null)},${value(isCall?row.execution_token:null)},
        ${value(isCall?row.provider_call_id:null)},${value(isCall?row.provider_key_sha256:null)},${value(resolvedId)},${literal(resolution)},
        ${literal(evidenceHash)},${literal(evidence.operatorRef)},${literal(evidence.invocation.reference)},${literal(provider.reference)});`;
    return {id,environment,databaseId,targetId:row.id,sessionId:row.session_id,disposition:resolution,evidenceHash,sql};
  };
  return {inspectionSql,receiptSql,inspectReport,planReconciliation};
}
export const calls=core('voice_call');
export const legacy=core('voice_legacy');
