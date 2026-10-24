import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { workApi, workRecords } from './src/work-items.js';
import { accessIdentity, allowed, ACCESS_AUD, ACCESS_ISSUER } from './src/access.js';

const owner={role:'owner'};
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(query){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}};},query};},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>({meta:{changes:sql.prepare(s.query).run(...s.args).changes}}));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DASHBOARD_DB:db};const board=()=>workRecords(db,{items:[],asOf:new Date().toISOString()});
 const call=async(action,input,identity=owner,loadBoard=board)=>{const response=await workApi(new Request(`https://dashboard.jobhackai.io/api/work-items/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),env,identity,loadBoard);return {status:response.status,body:await response.json()};};
 return {sql,db,env,board,call};
}
const doc=(overrides={})=>({title:'Source-backed product improvement',department:'product',product:'core',preparation:'ready',channel:'Product',contributors:['marketing'],expectedValue:'Reliable measurement of software signups',effort:'Small',dependencies:[],nextAction:'Review the exact change',completionCriteria:'Verified signup source and deployed behavior',reason:'Measurement supports the 250-user goal',impact:'growth',sourceRefs:[{id:'issue-1',url:'https://github.com/example/repo/issues/1'}],...overrides});
const snapshot=(overrides={})=>({complete:true,conflict:false,sourceRevision:'native-v1',checkedAt:new Date().toISOString(),verifiedBy:'Independent source check',text:'The complete draft with exact link.',html:'',destination:'JobHackAI company Facebook',subject:'',timing:'After owner release',media:[],links:['https://jobhackai.io/?utm_source=facebook&utm_medium=organic_social&utm_campaign=test&utm_content=one'],evidence:[{id:'native-v1',url:'https://example.com/draft/1',fact:'Complete saved copy verified'}],...overrides});
async function ready(c,id='one',overrides={}){
 assert.equal((await c.call('prepare',{id,source:'github',sourceId:id,expectedVersion:0,document:doc(overrides)})).status,200);
 const snap=snapshot();assert.equal((await c.call('reconcile',{id,expectedVersion:1,sourceRevision:snap.sourceRevision,checkedAt:snap.checkedAt,nativeState:'draft',snapshot:snap})).status,200);
 const old=c.sql.prepare("SELECT version FROM source_health WHERE source='github'").get();
 assert.equal((await c.call('source-health',{source:'github',expectedVersion:old?.version||0,status:'current',checkedAt:snap.checkedAt,evidenceUrl:'https://github.com/example/repo',detail:'Verified current source',maxAgeMinutes:120})).status,200);
 return (await c.board()).items.find(i=>i.id===id);
}
test('additive migration is repeatable and preserves native decisions and suppressions',()=>{
 const c=fixture();c.sql.exec("INSERT INTO outreach_blocks VALUES('x@example.com','hard_bounce','native-id','2026-10-19')");
 const migration=readFileSync(new URL('./migrations/005-work-items.sql',import.meta.url),'utf8');c.sql.exec(migration);c.sql.exec(migration);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM outreach_blocks').get().n,1);
});
test('approval binds full copy, destination and media; later content needs a new decision and retains history',async()=>{
 const c=fixture();let item=await ready(c);assert.equal(item.canApprove,true);
 assert.equal((await c.call('feedback',{id:'one',expectedVersion:item.version,revision:item.snapshotRevision,requestId:'decision-1',action:'approve',note:''})).status,200);
 item=(await c.board()).items[0];assert.equal(item.state,'approved');assert.equal(item.nativeState,'draft');
 const next=snapshot({sourceRevision:'native-v2',destination:'Another company account',media:[{url:'https://example.com/image.png',digest:'sha256-123',alt:'Actual artwork'}]});
 assert.equal((await c.call('reconcile',{id:'one',expectedVersion:item.version,sourceRevision:next.sourceRevision,checkedAt:next.checkedAt,nativeState:'draft',snapshot:next})).status,200);
 const changed=(await c.board()).items[0];assert.notEqual(changed.snapshotRevision,item.snapshotRevision);assert.equal(changed.decision,null);assert.equal(changed.canApprove,true);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM work_decisions').get().n,1);
 assert.equal((await c.call('feedback',{id:'one',expectedVersion:item.version,revision:item.snapshotRevision,requestId:'decision-old',action:'approve',note:''})).status,409);
});
test('incomplete snapshots, stale sources and dependencies cannot become approvals',async()=>{
 const c=fixture();let item=await ready(c,'dependency',{preparation:'in_progress'});
 let dependent=await ready(c,'dependent',{dependencies:['dependency']});assert.equal(dependent.canApprove,false);
 assert.equal((await c.call('feedback',{id:dependent.id,expectedVersion:dependent.version,revision:dependent.snapshotRevision,requestId:'blocked-decision',action:'approve',note:''})).status,409);
 const snap=snapshot({complete:false});assert.equal((await c.call('reconcile',{id:item.id,expectedVersion:item.version,sourceRevision:snap.sourceRevision,checkedAt:snap.checkedAt,nativeState:'draft',snapshot:snap})).status,400);
 const health=c.sql.prepare("SELECT * FROM source_health WHERE source='github'").get();
 assert.equal((await c.call('source-health',{source:'github',expectedVersion:health.version,status:'unavailable',checkedAt:new Date().toISOString(),evidenceUrl:'https://github.com/example/repo',detail:'Connector unavailable',maxAgeMinutes:120})).status,200);
 const board=await c.board();assert.equal(board.sources[0].last_success_at,health.last_success_at);assert.ok(board.items[0].snapshot);assert.equal(board.items.some(i=>i.canApprove),false);
});
test('unique native identity and concurrent writes prevent duplicate cards and overwrite',async()=>{
 const c=fixture();const item=await ready(c);
 assert.equal((await c.call('prepare',{id:'duplicate',source:'github',sourceId:'one',expectedVersion:0,document:doc()})).status,409);
 const results=await Promise.all(['a','b'].map(title=>c.call('prepare',{id:'one',source:'github',sourceId:'one',expectedVersion:item.version,document:doc({title})})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await c.board()).items.length,1);
});
test('dependency order and database cycle protection survive racing department changes',async()=>{
 const c=fixture();await ready(c,'parent');await ready(c,'child',{dependencies:['parent']});
 c.sql.exec("UPDATE work_items SET priority=1 WHERE id='child'");assert.deepEqual((await c.board()).items.map(i=>i.id),['parent','child']);
 const row=c.sql.prepare("SELECT document FROM work_items WHERE id='parent'").get();const changed={...JSON.parse(row.document),dependencies:['child']};
 assert.throws(()=>c.sql.prepare("UPDATE work_items SET document=? WHERE id='parent'").run(JSON.stringify(changed)),/Dependency cycle/);
});
test('department contributions are independent, versioned and coordination requires all owners',async()=>{
 const c=fixture();await ready(c);
 for(const department of ['marketing','sales','product'])assert.equal((await c.call('contribute',{id:'one',department,expectedVersion:0,recommendation:'Source-backed next step',evidence:['https://example.com/evidence'],nextAction:'Prepare exact review'})).status,200);
 assert.equal((await c.board()).items[0].contributions.length,3);
 const coordination={id:'daily-1',cadence:'daily',period:'2026-10-24',assessments:[],worked:'',failed:'',adjustments:'Prioritize product dependency',evidence:['https://example.com/evidence']};
 assert.equal((await c.call('coordination',coordination)).status,400);
 coordination.assessments=['marketing','sales','product'].map(department=>({department,summary:'Inherited current work and assessed changes.'}));
 assert.equal((await c.call('coordination',coordination)).status,200);assert.equal((await c.call('coordination',coordination)).status,200);assert.equal(c.sql.prepare('SELECT count(*) n FROM coordination_runs').get().n,1);
});
test('verified machine JWT has only explicit capabilities; no owner actions or raw-header trust',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);const keys=createLocalJWKSet({keys:[{...jwk,kid:'test',alg:'RS256'}]});
 const sign=(claims,aud=ACCESS_AUD,expiry='1h')=>new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(ACCESS_ISSUER).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
 const env={DASHBOARD_MACHINE_IDENTITIES:JSON.stringify({'client.access':['read','prepare','reconcile','contribute','coordinate']})};
 const identity=await accessIdentity(await sign({common_name:'client.access'}),env,keys);assert.equal(identity.role,'machine');
 for(const path of ['/api/work-items/feedback','/api/outreach/approve','/api/outreach/send','/api/costs','/api/notifications/handle','/api/access'])assert.equal(allowed(identity,'POST',path),false);
 for(const path of ['/api/work-items/prepare','/api/work-items/reconcile','/api/work-items/rank','/api/outreach/prepare'])assert.equal(allowed(identity,'POST',path),true);
 assert.equal(allowed(identity,'GET','/api/overview'),false);assert.equal(allowed(identity,'GET','/api/work-items'),true);
 assert.equal(await accessIdentity(await sign({common_name:'foreign.access'}),env,keys),null);
 assert.equal(await accessIdentity(await sign({common_name:'client.access'},'wrong-app'),env,keys),null);
 assert.equal(await accessIdentity(await sign({common_name:'client.access'},ACCESS_AUD,'0s'),env,keys),null);
 assert.equal(await accessIdentity('forged',env,keys),null);
 const c=fixture();const item=await ready(c);assert.equal((await c.call('feedback',{id:item.id},identity)).status,403);
});
test('publication stays publication after an earlier approval',async()=>{
 const c=fixture();let item=await ready(c);
 await c.call('feedback',{id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'approved-before-publish',action:'approve',note:''});
 item=(await c.board()).items[0];const snap=snapshot();
 await c.call('reconcile',{id:item.id,expectedVersion:item.version,sourceRevision:snap.sourceRevision,checkedAt:snap.checkedAt,nativeState:'published',snapshot:snap});
 item=(await c.board()).items[0];assert.equal(item.state,'published');assert.equal(item.boardLane,'completed');assert.equal(item.decision.action,'approve');
});
test('retrying a recorded decision is idempotent even after versions and freshness change',async()=>{
 const c=fixture();const item=await ready(c);
 const input={id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'lost-response',action:'approve',note:''};
 assert.equal((await c.call('feedback',input)).status,200);
 c.sql.exec("UPDATE source_health SET status='unavailable'");
 assert.deepEqual(await c.call('feedback',input),{status:200,body:{saved:true}});
 assert.equal(c.sql.prepare('SELECT count(*) n FROM work_decisions').get().n,1);
 assert.equal((await c.call('feedback',{...input,action:'decline'})).status,409);
});
test('linked campaign drafts support exact approval while native execution remains authoritative',async()=>{
 const c=fixture();c.sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order) VALUES('post','Facebook','Post','Copy','https://example.com/post','pending','Native draft',1)");
 await c.call('prepare',{id:'work-post',source:'campaign',sourceId:'post',expectedVersion:0,document:doc()});
 const snap=snapshot();await c.call('reconcile',{id:'work-post',expectedVersion:1,sourceRevision:snap.sourceRevision,checkedAt:snap.checkedAt,nativeState:'draft',snapshot:snap});
 await c.call('source-health',{source:'campaign',expectedVersion:0,status:'current',checkedAt:snap.checkedAt,evidenceUrl:'https://example.com/post',detail:'Verified source draft',maxAgeMinutes:120});
 const board=state=>workRecords(c.db,{items:[{id:'post',source:'campaign',state,channel:'Facebook'}]});
 let item=(await board('pending')).items[0];assert.equal(item.canApprove,true);
 assert.equal((await c.call('feedback',{id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'linked-approval',action:'approve',note:''})).status,200);
 item=(await board('pending')).items[0];assert.equal(item.state,'approved');assert.equal(item.canApprove,false);assert.equal(item.boardLane,'in_progress');
 for(const state of ['scheduled','published','sent']){item=(await board(state)).items[0];assert.equal(item.state,state);assert.equal(item.nativeState,state);assert.equal(item.canApprove,false);}
});
test('directory source failure retains the last verified cache and exposes a blocker',async()=>{
 const c=fixture();const {cacheNativeSources}=await import('./src/work-items.js');
 const base={items:[{id:'directory-example',source:'directory',title:'Verified source request',state:'pending',channel:'Directory',impact:'prospect'}],directorySource:{status:'current',checkedAt:new Date().toISOString()}};
 await cacheNativeSources(c.db,base);
 const board=await workRecords(c.db,{items:[],directorySource:{status:'unavailable'}});
 assert.equal(board.items[0].title,'Verified source request');assert.equal(board.items[0].boardLane,'blocked');assert.ok(board.directorySource.lastSuccessfulCheckAt);
 assert.equal((await cacheNativeSources(c.db,{items:[],directorySource:{status:'unavailable'}})).saved,false);
});
test('approval uses authoritative handled dependencies and rejects already-published linked drafts',async()=>{
 const c=fixture();c.sql.exec("INSERT INTO gmail_threads(thread_id,last_message_id,sender,subject,preview,state,last_message_at,seen_sync_id) VALUES('native-thread','message-1','sender','subject','preview','needs_review','2026-10-24','sync-1')");
 await c.call('prepare',{id:'reviewed-conversation',source:'gmail',sourceId:'native-thread',expectedVersion:0,document:doc({preparation:'in_progress'})});
 const item=await ready(c,'dependent-reply',{dependencies:['reviewed-conversation']});
 const loadBoard=()=>workRecords(c.db,{items:[{id:'gmail-native-thread',source:'gmail',state:'handled',channel:'Email'}]});
 assert.equal((await loadBoard()).items.find(i=>i.id===item.id).canApprove,true);
 assert.equal((await c.call('feedback',{id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'native-dependency-approval',action:'approve',note:''},owner,loadBoard)).status,200);
 c.sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order) VALUES('published-post','Facebook','Post','Copy','https://example.com/post','published','Receipt',1)");
 await c.call('prepare',{id:'published-work',source:'campaign',sourceId:'published-post',expectedVersion:0,document:doc()});
 const snap=snapshot();await c.call('reconcile',{id:'published-work',expectedVersion:1,sourceRevision:snap.sourceRevision,checkedAt:snap.checkedAt,nativeState:'draft',snapshot:snap});
 await c.call('source-health',{source:'campaign',expectedVersion:0,status:'current',checkedAt:snap.checkedAt,evidenceUrl:'https://example.com/post',detail:'Native evidence',maxAgeMinutes:120});
 const publishedBoard=()=>workRecords(c.db,{items:[{id:'published-post',source:'campaign',state:'published',channel:'Facebook'}]});
 const published=(await publishedBoard()).items.find(i=>i.id==='published-work');
 assert.equal((await c.call('feedback',{id:published.id,expectedVersion:published.version,revision:published.snapshotRevision,requestId:'stale-publication-approval',action:'approve',note:''},owner,publishedBoard)).status,409);
});
test('metadata-only reconciliation preserves same-revision packet and approval but invalidates changed source content',async()=>{
 const c=fixture();let item=await ready(c);
 await c.call('feedback',{id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,requestId:'metadata-approval',action:'approve',note:''});
 item=(await c.board()).items[0];const revision=item.snapshotRevision;
 assert.equal((await c.call('reconcile',{id:item.id,expectedVersion:item.version,sourceRevision:'native-v1',checkedAt:new Date().toISOString(),nativeState:'published'})).status,200);
 item=(await c.board()).items[0];assert.equal(item.snapshotRevision,revision);assert.ok(item.snapshot);assert.equal(item.decision.action,'approve');assert.equal(item.boardLane,'completed');
 assert.equal((await c.call('reconcile',{id:item.id,expectedVersion:item.version,sourceRevision:'native-v2',checkedAt:new Date().toISOString(),nativeState:'draft'})).status,200);
 item=(await c.board()).items[0];assert.equal(item.snapshot,null);assert.equal(item.decision,null);assert.equal(item.canApprove,false);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM work_snapshots').get().n,1);assert.equal(c.sql.prepare('SELECT count(*) n FROM work_decisions').get().n,1);
});
test('completed internal preparation satisfies dependencies without fabricating publication',async()=>{
 const c=fixture();
 await c.call('prepare',{id:'internal',source:'operations',sourceId:'internal',expectedVersion:0,document:doc({preparation:'complete'})});
 const child=await ready(c,'dependent',{dependencies:['internal']});
 const board=await c.board(),internal=board.items.find(i=>i.id==='internal');
 assert.equal(internal.boardLane,'completed');assert.equal(internal.nativeState,'unknown');assert.equal(child.canApprove,true);
 assert.equal((await c.call('feedback',{id:child.id,expectedVersion:child.version,revision:child.snapshotRevision,requestId:'internal-complete-approval',action:'approve',note:''})).status,200);
 await c.call('prepare',{id:'content',source:'marblism',sourceId:'content',expectedVersion:0,document:doc({preparation:'complete'})});
 assert.notEqual((await c.board()).items.find(i=>i.id==='content').boardLane,'completed');
});
test('internal completion cannot bypass prerequisite chains or explicit blockers',async()=>{
 const c=fixture();
 await c.call('prepare',{id:'root',source:'operations',sourceId:'root',expectedVersion:0,document:doc({preparation:'in_progress'})});
 await c.call('prepare',{id:'middle',source:'operations',sourceId:'middle',expectedVersion:0,document:doc({preparation:'complete',dependencies:['root']})});
 let child=await ready(c,'grandchild',{dependencies:['middle']});
 assert.equal(child.canApprove,false);assert.equal((await c.board()).items.find(i=>i.id==='middle').boardLane,'blocked');
 await c.call('prepare',{id:'root',source:'operations',sourceId:'root',expectedVersion:1,document:doc({preparation:'complete',blocker:'Acceptance evidence missing'})});
 assert.equal((await c.board()).items.find(i=>i.id==='grandchild').canApprove,false);
 await c.call('prepare',{id:'root',source:'operations',sourceId:'root',expectedVersion:2,document:doc({preparation:'complete'})});
 const board=await c.board();assert.equal(board.items.find(i=>i.id==='middle').boardLane,'completed');assert.equal(board.items.find(i=>i.id==='grandchild').canApprove,true);
});
test('unavailable, incomplete and stale internal source health holds dependent approvals',async()=>{
 const c=fixture();
 await c.call('prepare',{id:'internal',source:'operations',sourceId:'internal',expectedVersion:0,document:doc({preparation:'complete'})});
 await ready(c,'dependent',{dependencies:['internal']});
 let version=0;
 for(const status of ['unavailable','incomplete','current']){
  const checkedAt=new Date().toISOString();
  await c.call('source-health',{source:'operations',expectedVersion:version++,status,checkedAt,evidenceUrl:'https://example.com/operations',detail:'Native status check',maxAgeMinutes:5});
  if(status==='current')c.sql.exec("UPDATE source_health SET last_success_at='2020-01-01T00:00:00Z' WHERE source='operations'");
  const board=await c.board();assert.equal(board.items.find(i=>i.id==='internal').boardLane,'blocked');assert.equal(board.items.find(i=>i.id==='dependent').canApprove,false);
 }
 await c.call('source-health',{source:'operations',expectedVersion:version,status:'current',checkedAt:new Date().toISOString(),evidenceUrl:'https://example.com/operations',detail:'Recovered native check',maxAgeMinutes:5});
 assert.equal((await c.board()).items.find(i=>i.id==='dependent').canApprove,true);
});
