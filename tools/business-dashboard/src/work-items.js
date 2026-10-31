import { digest, OWNER } from './outreach-policy.js';
import { workflowStatus, verifyRunWrite, recordRunWrite } from './workflow.js';
import { saveReceipt, applyReceipts } from './work-receipts.js';

export const departments = ['marketing', 'sales', 'product'];
const idPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const sources = ['campaign', 'gmail', 'outreach', 'directory', 'meta', 'marblism', 'github', 'analytics', 'operations'];
const nativeStates = ['unknown','draft','scheduled','published','sent','received','waiting','closed','failed'];
const stamp = () => new Date().toISOString();
const parse = value => value ? JSON.parse(value) : null;
const reply = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function text(value, max = 4000, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('Missing or invalid text field.');
  return value;
}
function list(value, max = 30) { if (!Array.isArray(value) || value.length > max) fail('Invalid list.'); return value; }
function url(value) { try { if (new URL(value).protocol === 'https:') return value; } catch {} fail('An HTTPS source URL is required.'); }
function date(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now() + 300000) fail('Invalid verification time.'); return new Date(value).toISOString(); }
function expected(value) { if (!Number.isSafeInteger(value) || value < 0) fail('expectedVersion is required.'); return value; }
function key(value) { if (!idPattern.test(value || '')) fail('Invalid stable ID.'); return value; }
async function body(request) {
  const reader = request.body?.getReader(); if (!reader) fail('Missing JSON.');
  const chunks=[]; let size=0;
  while (true) { const {value,done}=await reader.read(); if(done)break; size+=value.byteLength; if(size>196608){await reader.cancel();fail('Request too large.',413);} chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid JSON.');}
}
function documentInput(input) {
  if (!departments.includes(input.department)) fail('Choose one accountable department.');
  if (!['up_next','in_progress','ready','blocked','complete'].includes(input.preparation)) fail('Invalid preparation status.');
  if (!['core','local'].includes(input.product)) fail('Core or Local is required.');
  return {
    title:text(input.title,300), department:input.department, product:input.product,
    preparation:input.preparation, channel:text(input.channel,100),
    contributors:list(input.contributors || []).map(v=>text(v,100)),
    expectedValue:text(input.expectedValue), effort:text(input.effort,300),
    dependencies:list(input.dependencies || []).map(key),
    nextAction:text(input.nextAction), completionCriteria:text(input.completionCriteria),
    reason:text(input.reason), impact:['customer','commitment','growth'].includes(input.impact)?input.impact:'growth',
    sourceRefs:list(input.sourceRefs,30).map(ref=>({id:text(ref.id,200),url:url(ref.url)})),
    blocker:text(input.blocker || '',4000,false),
  };
}
function snapshotInput(input) {
  if (!input || input.complete !== true || input.conflict !== false) fail('Complete, independently verified, conflict-free copy is required.');
  if(!Array.isArray(input.evidence)||!input.evidence.length)fail('Independent evidence is required.');
  return {
    complete:true, conflict:false, sourceRevision:text(input.sourceRevision,300),
    checkedAt:date(input.checkedAt), verifiedBy:text(input.verifiedBy,200),
    text:text(input.text,60000), html:text(input.html || '',60000,false),
    destination:text(input.destination,1000), subject:text(input.subject || '',1000,false),
    timing:text(input.timing,500),
    media:list(input.media,20).map(m=>({url:url(m.url), digest:text(m.digest,200), alt:text(m.alt,1000)})),
    links:list(input.links,30).map(url),
    evidence:list(input.evidence,30).map(e=>({id:text(e.id,200),url:url(e.url),fact:text(e.fact)})),
  };
}
// Checked time is evidence of freshness, not a new content revision.
async function snapshotRevision(snapshot) { const {checkedAt,verifiedBy,...content}=snapshot; return digest(content); }
// A new check, note, source revision or priority is not a changed deliverable.
export function deliverableContent(snapshot) {
  if(!snapshot)return null;
  return JSON.stringify(Object.fromEntries(['text','html','destination','subject','timing','media','links'].map(key=>[key,snapshot[key]??null])));
}
async function get(db,id) { return db.prepare('SELECT * FROM work_items WHERE id=?').bind(id).first(); }
async function updateItem(db,input,now) {
  const id=key(input.id), version=expected(input.expectedVersion), source=input.source;
  if(!sources.includes(source))fail('Unknown source.');
  const sourceId=text(input.sourceId,200), doc=documentInput(input.document);
  const previous=await get(db,id);
  if(previous){
    // Preparing new notes must not erase the release/source evidence already saved.
    const refs=new Map(parse(previous.document).sourceRefs.map(ref=>[ref.url,ref]));
    for(const ref of doc.sourceRefs)refs.set(ref.url,ref);
    doc.sourceRefs=[...refs.values()];
  }
  if(!doc.sourceRefs.length)fail('At least one stable source reference is required.');
  if(['campaign','gmail','outreach','directory'].includes(source)){
    const tables={campaign:['campaign_items','id'],gmail:['gmail_threads','thread_id'],outreach:['outreach_messages','id']};
    if(tables[source]){const [table,column]=tables[source];if(!await db.prepare(`SELECT ${column} FROM ${table} WHERE ${column}=?`).bind(sourceId).first())fail('Native source record does not exist.');}
  }
  if(doc.dependencies.includes(id))fail('An item cannot depend on itself.');
  const rows=(await db.prepare('SELECT id,document FROM work_items').all()).results;
  const graph=new Map(rows.map(r=>[r.id,parse(r.document).dependencies]));graph.set(id,doc.dependencies);
  for(const dep of doc.dependencies)if(!graph.has(dep))fail(`Unknown dependency: ${dep}`);
  const visit=(node,path=new Set())=>{if(path.has(node))fail('Dependency cycle.');for(const dep of graph.get(node)||[])visit(dep,new Set([...path,node]));};visit(id);
  let result;
  if(!version)result=await db.prepare(`INSERT INTO work_items(id,source,source_id,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(id,source,sourceId,JSON.stringify(doc),now).run();
  else result=await db.prepare(`UPDATE work_items SET document=?,version=version+1,updated_at=? WHERE id=? AND version=? AND source=? AND source_id=?`).bind(JSON.stringify(doc),now,id,version,source,sourceId).run();
  if(!(result.meta?.changes>0))fail('The item changed or this source is already represented. Reload before editing.',409);
  return get(db,id);
}
async function reconcile(db,input,now) {
  const id=key(input.id),version=expected(input.expectedVersion),row=await get(db,id);
  if(!row||row.version!==version)fail('Item changed.',409);
  // Gmail and outreach execution truth belongs to their signed native feeds.
  if(['gmail','outreach','directory'].includes(row.source))fail('Reconcile this source through its existing native feed.');
  if(!nativeStates.includes(input.nativeState))fail('Invalid native status.');
  const checkedAt=date(input.checkedAt), sourceRevision=text(input.sourceRevision,300);
  const receipt=await db.prepare('SELECT * FROM work_receipts WHERE item_id=? ORDER BY rowid DESC LIMIT 1').bind(id).first();
  if(receipt && input.candidate!==receipt.candidate)fail('This check does not identify the active candidate. Historical source checks cannot refresh the current release.',409);
  if(receipt){const state=receipt.stage==='production_verified'?'closed':['published','sent'].includes(receipt.stage)?receipt.stage:'draft';if(input.nativeState!==state)fail('Execution state belongs to verified receipts. A source check cannot complete or reopen this release.',409);}
  if(['published','sent','closed'].includes(row.native_state)&&input.nativeState!==row.native_state)fail('Completed execution cannot be reopened by reconciliation. Create a new work item for new work.',409);
  if(row.checked_at && checkedAt<row.checked_at)fail('Older evidence cannot replace newer evidence.',409);
  const snapshot=input.snapshot?snapshotInput(input.snapshot):null;
  if(snapshot && (snapshot.sourceRevision!==sourceRevision || snapshot.checkedAt!==checkedAt))fail('Snapshot and source revisions/times must match.');
  // Metadata-only checks retain the exact packet only while its source revision is unchanged.
  const revision=snapshot?await snapshotRevision(snapshot):row.source_revision===sourceRevision?row.snapshot_revision:null;
  if(row.snapshot_revision===revision && row.source_revision===sourceRevision && row.checked_at===checkedAt && row.native_state===input.nativeState)return row;
  const mutation=crypto.randomUUID();
  const statements=[db.prepare(`UPDATE work_items SET mutation_id=?,snapshot_revision=?,source_revision=?,native_state=?,checked_at=?,updated_at=?,version=version+1
    WHERE id=? AND version=?`).bind(mutation,revision,sourceRevision,input.nativeState,checkedAt,now,id,version)];
  if(snapshot)statements.push(db.prepare(`INSERT INTO work_snapshots(item_id,revision,payload,created_at)
    SELECT id,?,?,? FROM work_items WHERE id=? AND version=? AND snapshot_revision=? AND mutation_id=? ON CONFLICT DO NOTHING`)
    .bind(revision,JSON.stringify(snapshot),now,id,version+1,revision,mutation));
  const results=await db.batch(statements);if(!(results[0].meta?.changes>0))fail('Item changed.',409);
  return get(db,id);
}
async function decision(db,input,now,loadBoard) {
  const id=key(input.id),requestId=key(input.requestId),note=text(input.note || '',4000,input.action==='changes');
  const existing=await db.prepare('SELECT * FROM work_decisions WHERE id=?').bind(requestId).first();
  if(existing){if(existing.item_id===id&&existing.revision===input.revision&&existing.action===input.action&&existing.note===note)return {saved:true};fail('Request ID already used.',409);}
  const row=await get(db,id);
  if(!row || row.version!==expected(input.expectedVersion) || !row.snapshot_revision || row.snapshot_revision!==input.revision)fail('The reviewed revision changed.',409);
  if(['outreach','gmail','directory'].includes(row.source))fail('Use the original source review operation.');
  if(await db.prepare('SELECT event_id FROM work_receipts WHERE item_id=? LIMIT 1').bind(id).first())fail('Execution has started. Draft decisions remain history and cannot alter the release.',409);
  if(!['approve','changes','decline'].includes(input.action))fail('Invalid decision.');
  if(input.action==='approve') {
    // Native feeds own execution and handled status; the projection also checks freshness and dependencies.
    const reviewed=(await loadBoard()).items.find(item=>item.workId===row.id);
    if(!reviewed || reviewed.version!==row.version || !reviewed.canApprove)fail('This draft needs current source checks, completed dependencies and an undecided exact revision.',409);
  }
  const mutation=crypto.randomUUID();
  const result=await db.batch([
    db.prepare('UPDATE work_items SET version=version+1,mutation_id=?,updated_at=? WHERE id=? AND version=? AND snapshot_revision=?').bind(mutation,now,row.id,row.version,input.revision),
    db.prepare(`INSERT INTO work_decisions(id,item_id,revision,action,note,actor,created_at)
      SELECT ?,id,?,?,?,?,? FROM work_items WHERE id=? AND version=? AND snapshot_revision=? AND mutation_id=?`).bind(requestId,input.revision,input.action,note,OWNER,now,row.id,row.version+1,input.revision,mutation),
  ]);
  if(!(result[0].meta?.changes>0))fail('Item changed.',409);return {saved:true};
}
export async function cacheNativeSources(db,base) {
  if(base.directorySource?.status!=='current')return {saved:false,status:'unavailable'};
  const items=base.items.filter(i=>i.source==='directory');
  const result=await db.prepare(`INSERT INTO source_cache(source,payload,checked_at) VALUES('directory',?,?)
    ON CONFLICT(source) DO UPDATE SET payload=excluded.payload,checked_at=excluded.checked_at WHERE excluded.checked_at>=source_cache.checked_at`)
    .bind(JSON.stringify(items),base.directorySource.checkedAt).run();
  return {saved:result.meta.changes>0};
}
export async function workRecords(db, base, now=new Date()) {
  const workflow=await workflowStatus(db,now);
  if(base.directorySource?.status==='unavailable'){
    const cached=await db.prepare("SELECT * FROM source_cache WHERE source='directory'").first();
    if(cached)base={...base,items:[...base.items,...parse(cached.payload).map(i=>({...i,staleSource:true}))],directorySource:{...base.directorySource,lastSuccessfulCheckAt:cached.checked_at}};
  }
  const [rows,snapshots,decisions,health,contributions,runs,movement,receipts]=await Promise.all([
    db.prepare('SELECT * FROM work_items ORDER BY priority,id').all(),
    db.prepare('SELECT s.* FROM work_snapshots s JOIN work_items w ON w.id=s.item_id AND w.snapshot_revision=s.revision').all(),
    db.prepare('SELECT d.* FROM work_decisions d JOIN work_items w ON w.id=d.item_id AND w.snapshot_revision=d.revision ORDER BY d.created_at,d.id').all(),
    db.prepare('SELECT * FROM source_health ORDER BY source').all(),
    db.prepare('SELECT * FROM work_contributions ORDER BY item_id,department').all(),
    db.prepare('SELECT * FROM coordination_runs ORDER BY created_at DESC LIMIT 8').all(),
    db.prepare("SELECT reference, MIN(recorded_at) AS tracked_since, MAX(CASE WHEN json_extract(result,'$.advanced')=1 THEN recorded_at END) AS moved_at FROM workflow_run_writes WHERE kind='item' AND json_extract(result,'$.progressBasis')='deliverable-v1' GROUP BY reference").all(),
    db.prepare('SELECT * FROM work_receipts ORDER BY rowid').all(),
  ]);
  const freshness=health.results.map(row=>({...row,status:row.status==='current'&&now.getTime()-Date.parse(row.last_success_at)>row.max_age_minutes*60000?'stale':row.status}));
  const itemMap=new Map(base.items.map(item=>[`${item.source||'campaign'}:${item.source==='outreach'?item.outreachId:item.source==='gmail'?item.id.replace(/^gmail-/,''):item.id}`,item]));
  const work=rows.results.map(row=>{
    const doc=parse(row.document),linked=itemMap.get(`${row.source}:${row.source_id}`);
    if(linked)itemMap.delete(`${row.source}:${row.source_id}`);
    const snapshot=parse(snapshots.results.find(s=>s.item_id===row.id)?.payload);
    const decision=decisions.results.filter(d=>d.item_id===row.id).at(-1)||null;
    const sourceHealth=freshness.find(s=>s.source===row.source);
    const fresh=!!sourceHealth&&sourceHealth.status==='current'&&row.checked_at&&now.getTime()-Date.parse(row.checked_at)<=86400000;
    // Legacy campaign decisions are not native execution. Keep actual execution receipts authoritative.
    const nativeState=linked && !(row.source==='campaign'&&['pending','hold','approved'].includes(linked.state))?linked.state:row.native_state;
    const item={...linked,...doc,impact:linked?.impact||doc.impact,id:row.id,workId:row.id,source:row.source,sourceId:row.source_id,version:row.version,
      priority:row.priority,snapshot,snapshotRevision:row.snapshot_revision,decision,nativeState,
      checkedAt:row.checked_at,updatedAt:row.updated_at,sourceHealth,fresh,
      lastMovedAt:movement.results.find(m=>m.reference===row.id)?.moved_at||null,
      detail:linked?.detail||snapshot?.text||doc.reason,
      reviewUrl:linked?.reviewUrl||doc.sourceRefs[0]?.url,
      contributions:contributions.results.filter(c=>c.item_id===row.id).map(c=>({...c,document:parse(c.document)})),
      sourceItemId:linked?.id,
      state:linked?.state||({draft:'hold',unknown:'hold',received:'pending',failed:'hold'}[row.native_state]||row.native_state),
    };
    item.handoff=workflow.handoffs.find(h=>h.item_id===row.id)||null;
    if(item.handoff&&!['sent','published','closed','scheduled'].includes(nativeState))item.nextAction=item.handoff.nextAction;
    if(decision?.action==='approve' && nativeState==='draft')item.state='approved';
    return applyReceipts(item,receipts.results.filter(r=>r.item_id===row.id));
  });
  const items=[...work,...itemMap.values()].map(item=>({...item,
    department:item.department||(['gmail','outreach','directory'].includes(item.source)||/Stan|Email|Outreach/i.test(item.channel)?'sales':'marketing'),
    product:item.product||(/\blocal\b|nextdoor|move.out/i.test(`${item.title} ${item.channel}`)?'local':'core'),
    dependencies:item.dependencies||[],priority:item.priority??item.sortOrder??1000,
    reason:item.reason||item.nextAction||item.evidence||'Review the source evidence.',
  }));
  const complete=new Set(items.filter(i=>['sent','published','closed','handled'].includes(i.state)).map(i=>i.id));
  // Resolve internal completion from prerequisites outward, never from its preparation flag alone.
  let advanced=true;
  while(advanced){advanced=false;for(const item of items){
    if(!complete.has(item.id)&&completedWork({...item,unfinishedDependencies:item.dependencies.filter(id=>!complete.has(id))})){
      complete.add(item.id);advanced=true;
    }
  }}
  for(const item of items){
    item.unfinishedDependencies=item.dependencies.filter(id=>!complete.has(id));
    item.canApprove=!item.receipts?.length && !!item.workId && !item.handoff && !['outreach','gmail','directory'].includes(item.source) && !!item.snapshot && item.fresh && item.preparation==='ready' && item.nativeState==='draft' && !item.unfinishedDependencies.length && item.decision?.action!=='approve' && !['changes','decline'].includes(item.decision?.action);
    item.boardLane=boardLane(item);
  }
  const rank=item=>item.impact==='customer'?0:item.impact==='commitment'?1:item.impact==='prospect'?2:3;
  items.sort((a,b)=>rank(a)-rank(b)||a.priority-b.priority||a.id.localeCompare(b.id));
  // Topological order within the backlog; dependencies remain before their dependents.
  const ordered=[],seen=new Set(),visiting=new Set();const byId=new Map(items.map(i=>[i.id,i]));
  const visit=item=>{if(seen.has(item.id)||visiting.has(item.id))return;visiting.add(item.id);for(const id of item.dependencies)if(byId.has(id))visit(byId.get(id));visiting.delete(item.id);seen.add(item.id);ordered.push(item);};items.forEach(visit);
  return {...base,items:ordered,sources:freshness,workflow,progress:{trackedSince:movement.results.map(m=>m.tracked_since).sort()[0]||null},coordination:runs.results.map(r=>({...r,document:parse(r.document)}))};
}
function completedWork(item) {
  return ['sent','published','closed','handled'].includes(item.state) ||
    (['operations','github','analytics'].includes(item.source) && item.preparation==='complete' &&
      !item.blocker && !item.staleSource && (!item.sourceHealth || item.sourceHealth.status==='current') && !item.unfinishedDependencies?.length);
}
export function boardLane(item) {
  if(item.staleSource)return 'blocked';
  if(['sending','uncertain'].includes(item.deliveryState)||item.feedback?.action==='changes'||(item.source==='outreach'&&item.issues?.length&&item.feedback?.action!=='decline'))return 'blocked';
  if(completedWork(item)||item.decision?.action==='decline')return 'completed';
  if(item.handoff?.status==='blocked')return 'blocked';
  if(item.unfinishedDependencies?.length||item.preparation==='blocked'||item.blocker||item.state==='waiting'||['sending','uncertain'].includes(item.deliveryState))return 'blocked';
  if(item.source==='gmail'||item.source==='directory')return item.state==='pending'?'ready':'blocked';
  if(item.feedback?.action==='decline')return 'completed';
  if(item.source==='outreach')return item.deliveryState==='review'&&!item.issues?.length?'ready':'in_progress';
  if(item.canApprove)return 'ready';
  if(item.sourceHealth && item.sourceHealth.status!=='current')return 'blocked';
  if(item.preparation==='up_next')return 'up_next';
  return 'in_progress';
}
export async function workApi(request,env,identity,loadBoard) {
  const db=env.DASHBOARD_DB,path=new URL(request.url).pathname,now=stamp();
  try {
    if(request.method==='GET'){
      if(path==='/api/work-items/changes')return reply(await db.prepare('SELECT revision FROM board_revision WHERE id=1').first());
      const board=await loadBoard();
      if(path==='/api/work-items')return reply(board);
      const id=decodeURIComponent(path.slice('/api/work-items/'.length));const item=board.items.find(i=>i.id===id);
      if(!item)return reply({error:'Not found'},404);
      const history=(await db.prepare('SELECT * FROM work_decisions WHERE item_id=? ORDER BY created_at DESC').bind(item.id).all()).results;
      return reply({...item,decisionHistory:history});
    }
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    const input=await body(request);
    const run=await verifyRunWrite(db,input,identity,now);
    if(path==='/api/work-items/receipt'){
      const result=await saveReceipt(db,input,now,run);
      return reply(result);
    }
    if(path==='/api/work-items/prepare'||path==='/api/work-items/reconcile'){
      const old=run?await get(db,input.id):null;
      if(run&&(old?.version||0)!==expected(input.expectedVersion))fail('Item changed before the attributed write.',409);
      const preparing=path.endsWith('/prepare');
      const oldSnapshot=run&&!preparing&&old?.snapshot_revision?await db.prepare('SELECT payload FROM work_snapshots WHERE item_id=? AND revision=?').bind(old.id,old.snapshot_revision).first():null;
      const saved=preparing?await updateItem(db,input,now):await reconcile(db,input,now);
      if(run&&saved.version!==input.expectedVersion){
        // The trailing read may already contain another writer's newer version. Attribute only
        // the fields and version committed by this request's successful compare-and-swap.
        const draftChanged=!preparing&&!!input.snapshot&&deliverableContent(parse(oldSnapshot?.payload))!==deliverableContent(snapshotInput(input.snapshot));
        const moved=!preparing&&old.native_state!==input.nativeState&&['scheduled','published','sent','closed'].includes(input.nativeState);
        await recordRunWrite(db,run,'item',input.id,input.expectedVersion+1,{
          advanced:draftChanged||moved,
          checked:!preparing&&date(input.checkedAt)>=run.started_at&&date(input.checkedAt)!==old.checked_at,
          progressBasis:'deliverable-v1',
        },now);
      }
      return reply(saved);
    }
    if(path==='/api/work-items/feedback'){
      if(identity.role!=='owner')return reply({error:'Owner decision required'},403);
      return reply(await decision(db,input,now,loadBoard));
    }
    if(path==='/api/work-items/contribute'){
      const id=key(input.id),version=expected(input.expectedVersion),dept=input.department;
      if(!departments.includes(dept)||!await get(db,id))fail('Unknown department or item.');
      const document={recommendation:text(input.recommendation),evidence:list(input.evidence).map(url),nextAction:text(input.nextAction)};
      const result=await db.prepare(`INSERT INTO work_contributions(item_id,department,version,document,updated_at) SELECT ?,?,1,?,? WHERE ?=0
        ON CONFLICT(item_id,department) DO NOTHING`).bind(id,dept,JSON.stringify(document),now,version).run();
      if(!result.meta?.changes){const updated=await db.prepare('UPDATE work_contributions SET document=?,version=version+1,updated_at=? WHERE item_id=? AND department=? AND version=?').bind(JSON.stringify(document),now,id,dept,version).run();if(!updated.meta?.changes)fail('Contribution changed.',409);}
      return reply({saved:true});
    }
    if(path==='/api/work-items/rank'){
      if(identity.role!=='owner'&&!identity.capabilities?.includes('coordinate'))return reply({error:'Coordinator capability required'},403);
      const id=key(input.id),version=expected(input.expectedVersion);
      if(!Number.isSafeInteger(input.priority)||input.priority<0||input.priority>100000)fail('Invalid priority.');
      const result=await db.prepare('UPDATE work_items SET priority=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(input.priority,now,id,version).run();if(!result.meta?.changes)fail('Item changed.',409);return reply({saved:true});
    }
    if(path==='/api/work-items/source-health'){
      if(!sources.includes(input.source))fail('Unknown source.');const version=expected(input.expectedVersion),checkedAt=date(input.checkedAt);
      if(!['current','unavailable','incomplete'].includes(input.status)||!Number.isSafeInteger(input.maxAgeMinutes)||input.maxAgeMinutes<5||input.maxAgeMinutes>10080)fail('Invalid health status.');
      const old=await db.prepare('SELECT * FROM source_health WHERE source=?').bind(input.source).first();
      if((old?.version||0)!==version||(old&&checkedAt<old.checked_at))fail('Source status changed.',409);
      const success=input.status==='current'?checkedAt:old?.last_success_at||null;
      const args=[input.status,checkedAt,success,url(input.evidenceUrl),text(input.detail),input.maxAgeMinutes,input.requiresMac===true?1:0];
      const result=old?await db.prepare('UPDATE source_health SET status=?,checked_at=?,last_success_at=?,evidence_url=?,detail=?,max_age_minutes=?,requires_mac=?,version=version+1 WHERE source=? AND version=?').bind(...args,input.source,version).run():await db.prepare('INSERT INTO source_health(status,checked_at,last_success_at,evidence_url,detail,max_age_minutes,requires_mac,source,version) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING').bind(...args,input.source).run();
      if(!result.meta?.changes)fail('Source status changed.',409);
      const attempted=!!run&&checkedAt>=run.started_at&&checkedAt!==old?.checked_at;
      await recordRunWrite(db,run,'source',input.source,version+1,{attempted,checked:attempted&&input.status==='current',status:input.status,checkedAt,evidenceUrl:input.evidenceUrl},now);
      return reply({saved:true});
    }
    if(path==='/api/work-items/coordination'){
      if(identity.role!=='owner'&&!identity.capabilities?.includes('coordinate'))return reply({error:'Coordinator capability required'},403);
      if(run&&run.workflow!=='coordination')fail('Department assessments belong to the coordination run.',403);
      if(!['hourly','daily','weekly','lesson'].includes(input.cadence))fail('Invalid cadence.');
      const document={assessments:list(input.assessments,3),worked:text(input.worked||'',6000,false),failed:text(input.failed||'',6000,false),adjustments:text(input.adjustments),evidence:list(input.evidence).map(url)};
      if(['daily','weekly'].includes(input.cadence)&&(!departments.every(d=>document.assessments.some(a=>a.department===d&&typeof a.summary==='string'&&a.summary.trim()))||document.assessments.length!==3))fail('All three department assessments are required.');
      const id=key(input.id),period=text(input.period,100);
      const result=await db.prepare('INSERT INTO coordination_runs(id,cadence,period,document,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(id,input.cadence,period,JSON.stringify(document),now).run();
      if(!result.meta?.changes){const old=await db.prepare('SELECT document FROM coordination_runs WHERE cadence=? AND period=?').bind(input.cadence,period).first();if(old?.document!==JSON.stringify(document))fail('This coordination period already has a different record.',409);}
      else await recordRunWrite(db,run,'coordination',id,1,{cadence:input.cadence,period},now);
      return reply({saved:true});
    }
    return reply({error:'Not found'},404);
  } catch(error) { if(error.status)return reply({error:error.message},error.status);throw error; }
}
