// Receipts record verified results. They never execute a send or deployment.
const stages = ['dev_deployed','dev_verified','qa_deployed','qa_verified','production_deployed','production_verified'];
const terminal = ['production_verified','published','sent'];
const reject = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
export async function saveReceipt(db,input,now) {
  const {eventId,id,candidate,stage,evidenceUrl,summary,occurredAt,expectedVersion}=input;
  if(!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(eventId||'') || typeof candidate!=='string' || !candidate.trim() || candidate.length>300 || ![...stages,'published','sent'].includes(stage))reject('Invalid receipt identity or stage.');
  if(typeof summary!=='string'||!summary.trim()||summary.length>4000)reject('A verified result summary is required.');
  try { if(new URL(evidenceUrl).protocol!=='https:')throw Error(); } catch { reject('An HTTPS execution evidence URL is required.'); }
  if(!Number.isFinite(Date.parse(occurredAt))||Date.parse(occurredAt)>Date.parse(now)+300000)reject('Invalid execution time.');
  const event={event_id:eventId,item_id:id,candidate,stage,evidence_url:evidenceUrl,summary,occurred_at:new Date(occurredAt).toISOString()};
  const prior=await db.prepare('SELECT * FROM work_receipts WHERE event_id=?').bind(eventId).first();
  if(prior){if(Object.entries(event).every(([k,v])=>prior[k]===v))return {saved:true,replayed:true,receipt:prior};reject('Receipt ID already used.',409);}
  const row=await db.prepare('SELECT * FROM work_items WHERE id=?').bind(id).first();
  if(!row||!Number.isSafeInteger(expectedVersion)||row.version!==expectedVersion)reject('Item changed. Reload before recording the result.',409);
  if(['gmail','outreach','directory'].includes(row.source))reject('Use the existing native execution feed for this source.');
  if(stages.includes(stage)!==(row.source==='github'))reject('Deployment receipts require a GitHub work item; publication and send receipts require a non-GitHub source.');
  const receipts=(await db.prepare('SELECT * FROM work_receipts WHERE item_id=?').bind(id).all()).results;
  if(receipts.some(r=>r.candidate!==candidate||terminal.includes(r.stage)||r.stage===stage))reject('This work item already tracks another candidate or completed stage. Use a new item for new work.',409);
  const predecessor=stages[stages.indexOf(stage)-1];
  if(predecessor&&!receipts.some(r=>r.stage===predecessor&&r.occurred_at<=event.occurred_at))reject('Verify this candidate in development, then QA, then production. Stages cannot be skipped.',409);
  const result=await db.batch([
    db.prepare('UPDATE work_items SET version=version+1,updated_at=?,mutation_id=? WHERE id=? AND version=?').bind(now,eventId,id,expectedVersion),
    db.prepare(`INSERT INTO work_receipts(event_id,item_id,candidate,stage,evidence_url,summary,occurred_at,recorded_at)
      SELECT ?,id,?,?,?,?,?,? FROM work_items WHERE id=? AND version=? AND mutation_id=?`).bind(eventId,candidate,stage,evidenceUrl,summary,event.occurred_at,now,id,expectedVersion+1,eventId),
  ]);
  if(result[0].meta.changes!==1)reject('Item changed.',409);
  return {saved:true,receipt:event};
}
export function applyReceipts(item,receipts) {
  item.receipts=receipts;
  if(!receipts.length)return item;
  const latest=receipts.at(-1);
  item.candidate=latest.candidate;
  item.detail=latest.summary;
  item.reviewUrl=latest.evidence_url;
  item.checkedAt=latest.occurred_at;
  item.nextAction=({dev_deployed:'Development deployment verified. Complete acceptance testing before QA promotion.',qa_deployed:'QA deployment verified. Complete QA acceptance before production promotion.',production_deployed:'Production deployment verified. Complete production checks before closing this release.',dev_verified:'Development checks passed. Complete QA acceptance for this same candidate.',qa_verified:'QA checks passed. Promote this accepted candidate through the production checks.',production_verified:'Production checks passed. No release action remains.',published:'Publication verified. No publishing action remains.',sent:'Delivery verified. No sending action remains.'})[latest.stage];
  item.canApprove=false;
  if(terminal.includes(latest.stage)){
    item.state=item.nativeState=latest.stage==='production_verified'?'closed':latest.stage;
    item.preparation='complete';item.blocker='';item.staleSource=false;item.handoff=null;
  }else {item.state='hold';item.nativeState='draft';item.preparation='in_progress';}
  return item;
}
