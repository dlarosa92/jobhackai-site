#!/usr/bin/env node
// Local operator tool; never imported by an HTTP route or scheduled worker.
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTarget,inspectionSql,receiptSql,inspectReport,planReconciliation } from './lib/deletion-execution-reconcile-core.mjs';

export function parseArgs(argv) {
  const result={apply:false};
  for(const arg of argv) {
    if(arg==='--apply') {if(result.apply)throw Error('reconciliation_duplicate_argument');result.apply=true;continue;}
    const match=/^--(env|job|report|review|receipt)=(.+)$/.exec(arg);
    if(!match || Object.hasOwn(result,match[1]))throw Error('reconciliation_argument_invalid');
    result[match[1]]=match[2];
  }
  assertTarget(result.env);
  if(!result.job || !result.report || (result.apply && !result.review))throw Error('reconciliation_arguments_required');
  if(result.receipt && (result.apply || result.review))throw Error('reconciliation_argument_invalid');
  if(result.apply && result.env==='prod')throw Error('production_reconciliation_held');
  inspectionSql(result.job);
  return result;
}
export function d1Query(environment,sql,{execute=execFileSync}={}) {
  const databaseId=assertTarget(environment),dir=mkdtempSync(join(tmpdir(),'jobhackai-reconcile-'));
  try {
    const config=join(dir,'wrangler.jsonc');
    writeFileSync(config,JSON.stringify({name:'jobhackai-reconciliation-local',account_id:'fabf4409ef32f8c64354a1a099bef2a2',
      d1_databases:[{binding:'RECOVERY_DB',database_name:'reconciliation-target',database_id:databaseId}]}),{mode:0o600});
    // --file uses remote bulk import and returns import statistics, not SELECT
    // rows. Execute one statement through the query path instead; argv is an
    // array (no shell interpolation), and contains no credentials/content.
    const output=execute('npx',['--yes','wrangler@4.135.0','d1','execute','RECOVERY_DB','--remote','--json','--config',config,'--command',sql],
      {encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024,timeout:60000});
    const parsed=JSON.parse(output);
    if(!Array.isArray(parsed) || parsed.length!==1 || parsed[0].success!==true || !Array.isArray(parsed[0].results))throw Error();
    return parsed[0].results;
  } catch {throw Error('reconciliation_database_request_failed');}
  finally {rmSync(dir,{recursive:true,force:true});}
}
export async function run(args,{query=d1Query,now=Date.now}={}) {
  // Reserve a private output path before any possible remote write. Never
  // overwrite the review evidence or an earlier report.
  const fdPath=resolve(args.report);
  writeFileSync(fdPath,'',{mode:0o600,flag:'wx'});
  try {
    if(args.receipt) {
      const receipts=await query(args.env,receiptSql(args.receipt,args.job));
      writeFileSync(fdPath,JSON.stringify({mode:'receipt',environment:args.env,receipts},null,2)+'\n');
      return {mode:'receipt',found:receipts.length===1,report:fdPath};
    }
    const rows=await query(args.env,inspectionSql(args.job));
    if(rows.length!==1)throw Error('reconciliation_job_missing');
    const current=rows[0];
    if(!args.review) {
      writeFileSync(fdPath,JSON.stringify(inspectReport(args.env,current,now()),null,2)+'\n');
      return {mode:'inspection',jobId:args.job,report:fdPath};
    }
    const review=JSON.parse(readFileSync(args.review,'utf8'));
    if(review?.snapshot?.id!==args.job)throw Error('reconciliation_target_mismatch');
    const plan=planReconciliation(review,current,args.env,now());
    if(!args.apply) {
      writeFileSync(fdPath,JSON.stringify({mode:'plan',...plan},null,2)+'\n');
      return {mode:'plan',jobId:args.job,report:fdPath};
    }
    if(args.env==='prod')throw Error('production_reconciliation_held');
    // Save the exact candidate command before dispatch, including if its
    // response is lost. Never re-dispatch automatically after an error.
    writeFileSync(fdPath,JSON.stringify({mode:'apply_pending',...plan},null,2)+'\n');
    await query(args.env,plan.sql);
    const receipts=await query(args.env,receiptSql(plan.id,plan.jobId));
    if(receipts.length!==1 || receipts[0].job_id!==plan.jobId || receipts[0].evidence_sha256!==plan.evidenceHash)throw Error('reconciliation_receipt_unconfirmed');
    writeFileSync(fdPath,JSON.stringify({mode:'applied',id:plan.id,jobId:plan.jobId,phase:plan.phase,evidenceHash:plan.evidenceHash},null,2)+'\n');
    return {mode:'applied',id:plan.id,jobId:args.job,report:fdPath};
  } catch(error) {
    // An apply_pending report is preserved for read-only receipt lookup.
    throw error;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await run(parseArgs(process.argv.slice(2)))));}
  catch(error) {console.error(/^reconciliation_|^production_reconciliation_held$/.test(error.message)?error.message:'reconciliation_failed');process.exitCode=1;}
}
