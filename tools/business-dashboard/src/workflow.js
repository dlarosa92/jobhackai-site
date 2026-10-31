// Receipts and deadlines are separate from source freshness and external release authority.
const policies = {preparation:'prepare', reconciliation:'reconcile', coordination:'coordinate'};
const reconciliationSources = ['marblism','campaign','gmail','directory','github'];
const openStates = ['pending','claimed','blocked'];
const parse = value => value ? JSON.parse(value) : null;
function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
function text(value,max=4000) { if(typeof value!=='string'||!value.trim()||value.length>max)fail('A bounded, nonempty explanation is required.');return value; }
function key(value) { if(typeof value!=='string'||!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(value))fail('Invalid reference.');return value; }
function future(value,now) { const time=Date.parse(value);if(!Number.isFinite(time)||time<=Date.parse(now)||time>Date.parse(now)+7*86400000)fail('A next checkpoint within seven days is required.');return new Date(time).toISOString(); }
function evidence(input) {
  if(!Array.isArray(input)||!input.length||input.length>30)fail('Independent source evidence is required.');
  return input.map(e=>{let valid=false;try{valid=new URL(e.url).protocol==='https:';}catch{}if(!valid)fail('Use an HTTPS evidence URL.');return {url:e.url,fact:text(e.fact)};});
}
async function readBody(request) {
  const reader=request.body?.getReader();if(!reader)fail('Missing JSON.');
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>196608){await reader.cancel();fail('Request too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid JSON.');}
}
const actor = identity => identity.id || (identity.role==='owner'?'owner':'unknown');
function canRun(identity,workflow) { return Object.hasOwn(policies,workflow)&&(identity.role==='owner'||identity.capabilities?.includes(policies[workflow])); }
function preparationWork(board) {
  return board.items.filter(i=>i.workId&&['up_next','in_progress','ready','blocked'].includes(i.preparation)&&
    !(i.preparation==='blocked'&&i.blocker?.trim())&&
    i.boardLane!=='ready'&&!i.handoff&&!i.unfinishedDependencies?.length&&
    !['sent','published','closed','scheduled'].includes(i.nativeState)&&!['approve','decline'].includes(i.decision?.action));
}
function preparationQueue(board) {
  const items=preparationWork(board);
  return {eligibleCount:items.length,items:items.slice(0,20).map(i=>({id:i.id,title:i.title,department:i.department,nextAction:i.nextAction})),
    awaitingOwner:board.items.filter(i=>i.boardLane==='ready'&&!['gmail','directory'].includes(i.source)).map(i=>i.id)};
}
async function baseline(db) {
  const [items,sources,handoffs,runs]=await Promise.all([
    db.prepare('SELECT id,version,document,snapshot_revision,checked_at,native_state FROM work_items').all(),
    db.prepare('SELECT source,version,checked_at FROM source_health').all(),
    db.prepare("SELECT decision_id,version,status FROM work_handoffs WHERE status IN ('pending','claimed','blocked')").all(),
    db.prepare('SELECT id FROM coordination_runs ORDER BY created_at DESC LIMIT 20').all(),
  ]);
  return {items:items.results,sources:sources.results,handoffs:handoffs.results,coordination:runs.results.map(r=>r.id)};
}
function periodFor(workflow,now) {
  if(workflow==='reconciliation')return `${now.slice(0,14)}${Number(now.slice(14,16))<30?'00':'30'}`;
  return workflow==='coordination'?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)):now.slice(0,13);
}
async function start(db,input,identity,now) {
  if(!canRun(identity,input.workflow))fail('Workflow capability required.',403);
  const workflow=input.workflow,period=periodFor(workflow,now);
  let old=await db.prepare('SELECT id,actor,status,lease_until FROM workflow_runs WHERE workflow=? AND period=?').bind(workflow,period).first();
  // Preserve an hourly receipt created before the cadence change in its actual half-hour slot.
  if(!old&&workflow==='reconciliation')old=await db.prepare(`SELECT id,actor,status,lease_until FROM workflow_runs
    WHERE workflow=? AND period=? AND started_at>=? AND started_at<?`)
    .bind(workflow,now.slice(0,13),`${period}:00.000Z`,new Date(Date.parse(`${period}:00.000Z`)+30*60000).toISOString()).first();
  if(old){if(old.actor!==actor(identity))fail('This period is owned by another executor.',409);return {...old,reused:true};}
  const id=crypto.randomUUID(),lease=new Date(Date.parse(now)+60*60000).toISOString(),before=await baseline(db);
  // Check and insert atomically: a slow previous check must not overlap the next slot.
  const result=await db.prepare(`INSERT INTO workflow_runs(id,workflow,period,actor,started_at,lease_until,baseline)
    SELECT ?,?,?,?,?,?,? WHERE ?<>'reconciliation' OR NOT EXISTS(
      SELECT 1 FROM workflow_runs WHERE workflow='reconciliation' AND status='running' AND lease_until>?
    ) ON CONFLICT DO NOTHING`)
    .bind(id,workflow,period,actor(identity),now,lease,JSON.stringify(before),workflow,now).run();
  if(!result.meta?.changes)fail('Another run already owns this period or reconciliation is still running. Read workflow status and wait for the next scheduled check.',409);
  return {id,workflow,period,status:'running',startedAt:now,leaseUntil:lease};
}
async function activeRun(db,id,identity,now) {
  const run=await db.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(key(id)).first();
  if(!run||run.actor!==actor(identity)||!canRun(identity,run.workflow))fail('Run is not owned by this executor.',403);
  if(run.status!=='running'||run.lease_until<=now)fail('Run finished or expired. Start the next scheduled period.',409);
  return run;
}
export async function verifyRunWrite(db,input,identity,now) {
  return input.runId ? activeRun(db,input.runId,identity,now) : null;
}
export async function recordRunWrite(db,run,kind,reference,version,result,now) {
  if(!run)return;
  const saved=await db.prepare(`INSERT INTO workflow_run_writes(run_id,kind,reference,version,result,recorded_at)
    SELECT id,?,?,?,?,? FROM workflow_runs WHERE id=? AND status='running' AND lease_until>? ON CONFLICT DO NOTHING`)
    .bind(kind,reference,version,JSON.stringify(result),now,run.id,now).run();
  if(!saved.meta?.changes)fail('The write completed but its run receipt changed. Reload workflow status.',409);
}
function sourceCoverage(writes) {
  // Use the latest observation from this run. A later failed check supersedes an earlier success.
  const observations = new Map(writes.filter(w=>w.kind==='source').map(w=>[w.reference,w.result]));
  const verified = reconciliationSources.filter(source=>observations.get(source)?.checked===true&&observations.get(source)?.status==='current');
  const missing = reconciliationSources.filter(source=>!observations.get(source)?.attempted);
  const unsuccessful = reconciliationSources.filter(source=>!verified.includes(source)&&!missing.includes(source));
  return {required:reconciliationSources,verified,missing,unsuccessful,complete:verified.length===reconciliationSources.length};
}
function completeReconciliation(result) {
  return reconciliationSources.every(source=>result?.coverage?.verified?.includes(source));
}
async function finish(db,input,identity,now,loadBoard) {
  const run=await activeRun(db,input.id,identity,now);
  if(!['advanced','checked','blocked','failed'].includes(input.outcome))fail('Invalid run outcome.');
  const result={summary:text(input.summary),evidence:input.outcome==='failed'?[]:evidence(input.evidence)};
  if(input.outcome==='blocked'){result.blocker=text(input.blocker);result.nextCheckAt=future(input.nextCheckAt,now);}
  const writes=(await db.prepare('SELECT kind,reference,result FROM workflow_run_writes WHERE run_id=? ORDER BY recorded_at,version').bind(run.id).all()).results.map(w=>({...w,result:parse(w.result)}));
  const refs=(kind,predicate)=>[...new Set(writes.filter(w=>w.kind===kind&&predicate(w.result)).map(w=>w.reference))];
  result.advancedItems=refs('item',r=>r.advanced);
  const latestSources = [...new Map(writes.filter(w=>w.kind==='source').map(w=>[w.reference,w])).values()];
  result.checkedSources=latestSources.filter(w=>w.result.checked&&w.result.status==='current').map(w=>w.reference);
  if(run.workflow==='reconciliation')result.coverage=sourceCoverage(writes);
  result.checkedItems=refs('item',r=>r.checked);
  result.coordination=refs('coordination',r=>r.cadence==='daily'&&r.period===run.period);
  result.completedHandoffs=(await db.prepare("SELECT decision_id FROM work_handoffs WHERE claimed_by=? AND status='completed' AND updated_at>=?").bind(run.id,run.started_at).all()).results.map(h=>h.decision_id);
  const handoffs=(await db.prepare("SELECT h.* FROM work_handoffs h JOIN work_items w ON w.id=h.item_id WHERE h.status IN ('pending','claimed','blocked') AND w.native_state NOT IN ('sent','published','closed','scheduled')").all()).results;
  if(input.outcome==='advanced'&&!result.advancedItems.length&&!result.completedHandoffs.length)fail('No saved work changed. A run cannot claim advancement without an artifact.');
  if(run.workflow!=='coordination'&&['advanced','checked'].includes(input.outcome)&&!result.checkedSources.length&&!result.checkedItems.length)fail('Record fresh source or item checks owned by this run before reporting success.');
  if(run.workflow==='reconciliation'&&['advanced','checked'].includes(input.outcome)&&!result.coverage.complete)fail(`Reconciliation source coverage is incomplete. Missing: ${result.coverage.missing.join(', ')||'none'}. Unsuccessful: ${result.coverage.unsuccessful.join(', ')||'none'}. Record fresh source-health observations owned by this run or finish blocked/failed with the actual obstacle.`);
  if(run.workflow==='preparation'&&['checked','blocked'].includes(input.outcome)){
    if(!loadBoard)fail('Preparation completion requires the canonical dependency projection.',500);
    const runnable=preparationWork(await loadBoard());
    if(runnable.length)fail(`Eligible preparation remains: ${runnable.slice(0,5).map(i=>i.id).join(', ')}. Advance independent work or record its specific verified blocker on that item. Finished packets awaiting owner review do not block other preparation.`);
    if(handoffs.some(h=>h.status!=='blocked'||h.next_check_at<=now))fail('A decision handoff still needs follow-up. Resolve it or record its specific blocker and checkpoint before closing this run.');
  }
  if(run.workflow==='coordination'&&['advanced','checked'].includes(input.outcome)&&!result.coordination.length)fail('Record the department assessment before completing coordination.');
  const saved=await db.prepare("UPDATE workflow_runs SET status=?,finished_at=?,result=? WHERE id=? AND status='running' AND lease_until>?")
    .bind(input.outcome,now,JSON.stringify(result),run.id,now).run();
  if(!saved.meta?.changes)fail('Run changed.',409);
  return {saved:true,id:run.id,status:input.outcome,...result};
}
async function handoff(db,input,identity,now) {
  const run=await activeRun(db,input.runId,identity,now);
  if(run.workflow!=='preparation')fail('The preparation owner handles decision follow-up.',403);
  const row=await db.prepare('SELECT * FROM work_handoffs WHERE decision_id=?').bind(key(input.decisionId)).first();
  if(!row||row.version!==input.expectedVersion||!openStates.includes(row.status))fail('Handoff changed. Reload it.',409);
  if(input.action==='claim'){
    if(row.status==='claimed'&&row.lease_until>now&&row.claimed_by!==run.id)fail('Another run holds this handoff.',409);
    const saved=await db.prepare("UPDATE work_handoffs SET status='claimed',version=version+1,claimed_by=?,lease_until=?,updated_at=? WHERE decision_id=? AND version=?")
      .bind(run.id,run.lease_until,now,row.decision_id,row.version).run();
    if(!saved.meta?.changes)fail('Handoff changed.',409);
  } else {
    if(row.claimed_by!==run.id||row.lease_until<=now||row.status!=='claimed')fail('Claim this handoff before resolving it.',409);
    const result={summary:text(input.summary),evidence:evidence(input.evidence)};
    let next=null,status,itemVersion=null;
    if(input.action==='block'){status='blocked';result.blocker=text(input.blocker);next=future(input.nextCheckAt,now);}
    else if(input.action==='complete'){
      const item=await db.prepare('SELECT * FROM work_items WHERE id=?').bind(row.item_id).first();
      itemVersion=item.version;
      const snapshot=await db.prepare('SELECT payload FROM work_snapshots WHERE item_id=? AND revision=?').bind(item.id,item.snapshot_revision).first();
      const doc=parse(item.document),health=await db.prepare('SELECT * FROM source_health WHERE source=?').bind(item.source).first();
      if(!snapshot||!item.checked_at||Date.parse(now)-Date.parse(item.checked_at)>86400000||doc.preparation!=='ready'||doc.blocker||!health||health.status!=='current'||Date.parse(now)-Date.parse(health.last_success_at)>health.max_age_minutes*60000)fail('A complete current review packet is required to finish this handoff.');
      if(row.action==='changes'&&item.snapshot_revision===row.revision)fail('Requested changes require a revised saved packet.');
      if(!['revised','verified_for_release'].includes(input.resolution))fail('Name the preparation outcome.');
      if(input.resolution==='revised'&&item.snapshot_revision===row.revision)fail('No revised packet was saved.');
      if(input.resolution==='verified_for_release'&&(row.action!=='approve'||item.snapshot_revision!==row.revision))fail('Only the unchanged approved revision can proceed to separate release checks.');
      result.resolution=input.resolution;result.snapshotRevision=item.snapshot_revision;status='completed';
    } else fail('Invalid handoff operation.');
    const saved=await db.prepare(`UPDATE work_handoffs SET status=?,version=version+1,result=?,next_check_at=?,lease_until=NULL,updated_at=?
      WHERE decision_id=? AND version=? AND claimed_by=? AND (? IS NULL OR EXISTS(SELECT 1 FROM work_items WHERE id=work_handoffs.item_id AND version=?))`)
      .bind(status,JSON.stringify(result),next,now,row.decision_id,row.version,run.id,itemVersion,itemVersion).run();
    if(!saved.meta?.changes)fail('Handoff changed.',409);
  }
  return db.prepare('SELECT * FROM work_handoffs WHERE decision_id=?').bind(row.decision_id).first();
}
export function handoffNextAction(h) {
  if(h.status==='blocked')return `${h.department}: ${parse(h.result)?.blocker||'Resolve the recorded blocker'}. Check again ${h.next_check_at}.`;
  if(h.action==='changes')return `${h.department}: revise the saved packet from the owner's feedback: ${h.note}`;
  return h.note?`${h.department}: resolve the approval note, verify the final packet and preserve the exact decision: ${h.note}`:`${h.department}: verify release prerequisites for the approved revision. Release still requires its separate authorization.`;
}
export async function workflowStatus(db,now=new Date()) {
  const stamp=now.toISOString();
  const [specs,runs,handoffs,alerts,health]=await Promise.all([
    db.prepare('SELECT * FROM workflow_policies ORDER BY id').all(),
    db.prepare('SELECT * FROM workflow_runs WHERE id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY workflow ORDER BY started_at DESC) AS n FROM workflow_runs) WHERE n<=8) ORDER BY started_at DESC').all(),
    db.prepare("SELECT h.*,w.document FROM work_handoffs h JOIN work_items w ON w.id=h.item_id WHERE h.status IN ('pending','claimed','blocked') AND w.native_state NOT IN ('sent','published','closed','scheduled') ORDER BY h.due_at").all(),
    db.prepare('SELECT * FROM workflow_alerts WHERE resolved_at IS NULL ORDER BY first_seen_at').all(),
    db.prepare('SELECT source,status,checked_at FROM source_health').all(),
  ]);
  const workflows=specs.results.map(spec=>{
    const run=runs.results.find(r=>r.workflow===spec.id),result=parse(run?.result);
    const lastFinished=runs.results.find(r=>r.workflow===spec.id&&['advanced','checked'].includes(r.status)&&(spec.id!=='reconciliation'||completeReconciliation(parse(r.result))));
    // Keep immutable run history, but a subsequent audit failure supersedes its health claim.
    const disputedSources=spec.id==='reconciliation'&&run?health.results.filter(h=>reconciliationSources.includes(h.source)&&h.status!=='current'&&h.checked_at>=run.started_at).map(h=>h.source):[];
    let status='waiting';
    if(run?.status==='running')status=run.lease_until>stamp?'running':'stalled';
    else if(run?.status==='failed')status='failed';
    else if(run?.status==='blocked')status=result?.nextCheckAt>stamp?'blocked':'overdue';
    else if(spec.id==='reconciliation'&&run&&(!completeReconciliation(result)||disputedSources.length))status='incomplete';
    else if(now.getTime()-Date.parse(lastFinished?.finished_at||spec.created_at)>spec.max_age_minutes*60000)status='missing';
    else if(lastFinished)status='current';
    return {...spec,status,disputedSources,requiredSources:spec.id==='reconciliation'?reconciliationSources:[],lastRun:run?{id:run.id,status:run.status,startedAt:run.started_at,finishedAt:run.finished_at,result}:null,lastSuccessAt:lastFinished?.finished_at||null};
  });
  const jobs=handoffs.results.map(h=>{const {document,...rest}=h;return {...rest,title:parse(document).title,nextAction:handoffNextAction(h),overdue:(h.status==='blocked'?h.next_check_at:h.due_at)<=stamp};});
  // Derive immediately on reads as well as persisting on cron; a late cron cannot make stale work green.
  const active=[...workflows.filter(w=>['missing','stalled','failed','blocked','overdue','incomplete'].includes(w.status)).map(w=>({id:`workflow-${w.id}`,detail:`${w.label}: ${w.status}. ${w.disputedSources.length?`Later source checks invalidate the saved success: ${w.disputedSources.join(', ')}.`:w.status==='incomplete'?'The saved run did not verify all required sources.':w.lastRun?.result?.blocker||w.lastRun?.result?.summary||'No completed run receipt within the expected interval.'}`})),
    ...jobs.filter(h=>h.overdue).map(h=>({id:`handoff-${h.decision_id}`,detail:`${h.title}: ${h.department} follow-up is overdue. ${h.nextAction}`}))];
  return {checkedAt:stamp,workflows,handoffs:jobs,alerts:active.map(a=>({...a,firstSeenAt:alerts.results.find(old=>old.id===a.id)?.first_seen_at||stamp}))};
}
export async function checkWorkflowDeadlines(env,now=new Date()) {
  const db=env.DASHBOARD_DB,status=await workflowStatus(db,now),stamp=now.toISOString();
  // No external messages or mutations: the independent monitor only updates dashboard alerts.
  const statements=status.alerts.map(a=>db.prepare(`INSERT INTO workflow_alerts(id,detail,first_seen_at,last_seen_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET detail=excluded.detail,last_seen_at=excluded.last_seen_at,
      first_seen_at=CASE WHEN workflow_alerts.resolved_at IS NULL THEN workflow_alerts.first_seen_at ELSE excluded.first_seen_at END,resolved_at=NULL`)
    .bind(a.id,a.detail,stamp,stamp));
  const ids=status.alerts.map(a=>a.id);
  statements.push(db.prepare(`UPDATE workflow_alerts SET resolved_at=? WHERE resolved_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`).bind(stamp,JSON.stringify(ids)));
  await db.batch(statements);
  console.log(JSON.stringify({event:'workflow_deadlines_checked',checkedAt:stamp,alerts:ids}));
  return status;
}
export async function workflowApi(request,env,identity,now=new Date(),loadBoard) {
  try {
    const path=new URL(request.url).pathname,db=env.DASHBOARD_DB;
    if(request.method==='GET'&&path==='/api/workflow'){
      const status=await workflowStatus(db,now);
      if(loadBoard)status.preparationQueue=preparationQueue(await loadBoard());
      return Response.json(status,{headers:{'Cache-Control':'no-store'}});
    }
    if(request.method!=='POST')fail('Method not allowed.',405);
    const input=await readBody(request),stamp=now.toISOString();let result;
    if(!input||typeof input!=='object'||Array.isArray(input))fail('A JSON object is required.');
    if(path==='/api/workflow/start')result=await start(db,input,identity,stamp);
    else if(path==='/api/workflow/finish')result=await finish(db,input,identity,stamp,loadBoard);
    else if(path==='/api/workflow/handoff')result=await handoff(db,input,identity,stamp);
    else fail('Not found.',404);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error.status)return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});throw error;}
}
