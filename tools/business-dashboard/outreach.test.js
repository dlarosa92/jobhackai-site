import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { normalizePacket, messageRevision, routingCheck, historyIssues, fiveBusinessDaysElapsed, digest } from './src/outreach-policy.js';
import { allowed } from './src/access.js';
import { registerMessage, recordHistory, ownerOutreach, relayOutreach, outreachRecords, recordDeliveryEvent } from './src/outreach.js';
import ingest from './src/gmail-ingest.js';
import worker from './worker.bundle.js';

const now=Date.parse('2026-10-19T19:00:00Z');
const mailbox='sebastian.larosa@jobhackai.io';
const secret='test-only-secret-at-least-32-characters';
const packet=(id='lead-a')=>({id,lane:'coach',phase:'intro',message:{recipient:'contact@example.com',subject:'A relevant introduction',text:'Hello,\nA complete reviewed message.\nSebastian'},evidence:{sourceUrl:'https://example.com/contact',checkedAt:new Date(now).toISOString(),checkedBy:'Codex',publishedEmail:'contact@example.com',fit:'current',fitFact:'Current coaching service, reviewed on its own site.'}});
const clean=()=>({complete:true,scope:'all-folders-all-history',checkedAt:new Date(now).toISOString(),sent:[],received:[],drafts:[],failures:[]});
const goodDns=async url=>{const type=new URL(url).searchParams.get('type');return Response.json({Status:0,Answer:type==='MX'?[{type:15,data:'10 mx.example.net.'}]:type==='A'?[{type:1,data:'192.0.2.1'}]:[]});};
function database(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  let queries=0;
  const db={prepare(query){queries++;return {query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}};}};},async batch(stmts){sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,db,env:{DASHBOARD_DB:db,MAILBOX_EMAIL:mailbox,SYNC_SECRET:secret,OUTREACH_SENDER_ENABLED:'true'},queries:()=>queries};
}
const ownerRequest=(path,input)=>new Request('https://dashboard.jobhackai.io/api/outreach/'+path,{method:'POST',headers:{Origin:'https://dashboard.jobhackai.io','Content-Type':'application/json'},body:JSON.stringify(input)});
async function prepared(context,id='lead-a',history=clean()){
  const identity=await registerMessage(context.db,packet(id),now);
  await recordHistory(context.env,{...identity,history},now,goodDns);
  return identity;
}
async function approved(context,id='lead-a'){
  const identity=await prepared(context,id);
  assert.equal((await ownerOutreach(ownerRequest('approve',identity),context.env,now)).status,200);
  await relayOutreach(context.env,{action:'poll',mailbox,canSend:true},now);
  return identity;
}
async function queued(context){const identity=await approved(context);assert.equal((await ownerOutreach(ownerRequest('send',identity),context.env,now)).status,200);return identity;}

for(const [name,mx,hosts,expected] of [
 ['nonexistent domain',{Status:3},null,'nxdomain'],
 ['null MX',{Status:0,Answer:[{type:15,data:'0 .'}]},null,'null_mx'],
 ['no MX',{Status:0},null,'no_mx_review'],
 ['MX with nonexistent target',{Status:0,Answer:[{type:15,data:'10 dead.example.net.'}]},{Status:3},'mx_target_unresolved'],
 ['AAAA only',{Status:0,Answer:[{type:15,data:'10 ipv6.example.net.'}]},{Status:0,Answer:[{type:28,data:'2001:db8::1'}]},'routing_present_mailbox_unknown'],
 ['temporary DNS failure',{Status:2},null,'dns_unavailable'],
 ['truncated DNS',{Status:0,TC:true},null,'dns_unavailable'],
])test('routing rejects or holds '+name,async()=>{
 const result=await routingCheck('example.com',{now:new Date(now),fetcher:async u=>Response.json(new URL(u).searchParams.get('type')==='MX'?mx:hosts)});
 assert.equal(result.status,expected);assert.equal(result.mailboxVerified,false);assert.equal(result.inboxVerified,false);
});
test('routing bounds untrusted DNS responses',async()=>{assert.equal((await routingCheck('example.com',{fetcher:async()=>new Response('x'.repeat(33000))})).status,'dns_unavailable');});
test('routing uses a Workers-compatible request without following resolver redirects',async()=>{
 const checked=[];
 const workersFetch=async(url,init)=>{
  // Workers only implements follow/manual; Node accepts error and hid this bug.
  if(!['follow','manual'].includes(init.redirect))throw new TypeError('Unsupported redirect mode');
  const request=new Request(url,init);checked.push(request);
  if(request.redirect!=='manual')return new Response(null,{status:302,headers:{Location:'https://elsewhere.example/dns'}});
  return goodDns(url);
 };
 assert.equal((await routingCheck('example.com',{fetcher:workersFetch})).status,'routing_present_mailbox_unknown');
 assert.equal(checked.length,3);
 assert.ok(checked.every(request=>request.redirect==='manual'&&new URL(request.url).origin==='https://cloudflare-dns.com'));
 let requests=0;
 assert.equal((await routingCheck('example.com',{fetcher:async()=>{requests++;return new Response(null,{status:302,headers:{Location:'https://elsewhere.example/dns'}});}})).status,'dns_unavailable');
 assert.equal(requests,1);
});

test('current exact published evidence, resolved conflicts and safe headers are required',()=>{
 for(const mutate of [p=>p.message.recipient='one@example.com,two@example.com',p=>p.message.subject+='\r\nBcc: other@example.net',p=>p.message.cc='other@example.net',p=>p.evidence.mailtoEmail='other@example.com',p=>p.evidence.checkedAt='2026-01-01T00:00:00Z',p=>p.evidence.fit='unknown',p=>p.message.html='<img src="https://tracking.example.net/x">',p=>p.lane='unqualified']){const p=packet();mutate(p);assert.throws(()=>normalizePacket(p,now));}
 assert.equal(normalizePacket(packet(),now).businessKey,'example.com');
});
test('five complete business days are evaluated by Eastern calendar date across DST',()=>{
 assert.equal(fiveBusinessDaysElapsed('2026-10-09T16:00:00Z',Date.parse('2026-10-16T23:00:00Z')),false);
 assert.equal(fiveBusinessDaysElapsed('2026-10-09T16:00:00Z',now),true);
 assert.equal(fiveBusinessDaysElapsed('2026-10-30T16:00:00Z',Date.parse('2026-11-09T15:00:00Z')),true);
 const p=normalizePacket(packet(),now);assert.deepEqual(historyIssues(p,clean(),now),[]);
 for(const h of [null,{...clean(),complete:false},{...clean(),checkedAt:'2026-10-18T19:00:00Z'},{...clean(),received:[{messageId:'a1'}]},{...clean(),drafts:[{messageId:'a2'}]}])assert.ok(historyIssues(p,h,now).length);
});
test('approval binds exact copy, source refresh retains it, changed copy loses it',async()=>{
 const c=database(),identity=await approved(c);
 let p=packet();p.evidence.fitFact='Refreshed current service evidence.';
 assert.equal((await registerMessage(c.db,p,now)).revision,identity.revision);
 assert.equal(c.sql.prepare('SELECT approved_revision FROM outreach_messages').get().approved_revision,identity.revision);
 p.message.text+='\nChanged offer.';const changed=await registerMessage(c.db,p,now);
 assert.notEqual(changed.revision,identity.revision);
 assert.equal(c.sql.prepare('SELECT approved_revision FROM outreach_messages').get().approved_revision,null);
 assert.equal((await ownerOutreach(ownerRequest('approve',identity),c.env,now)).status,409);
 assert.equal((await ownerOutreach(ownerRequest('approve',changed),c.env,now)).status,409);
 assert.equal(c.sql.prepare('SELECT count(*) n FROM outreach_versions').get().n,2);
});

const formatted=()=>({...packet(),message:{...packet().message,html:'<p>Hello, a complete reviewed message.</p>'},formatRequest:{reason:'This specific recipient requested a formatted comparison.'}});
test('plain-text defaults preserve old approval hashes and reject unrequested formatting',async()=>{
 const p=normalizePacket(packet(),now);
 assert.equal(await messageRevision(p),await digest({lane:p.lane,phase:p.phase,businessKey:p.businessKey,message:p.message}));
 for(const alter of [p=>delete p.formatRequest,p=>p.formatRequest={reason:'Because',approved:true},p=>p.message.text='<div>Raw HTML in the text body</div>']){
  const p=formatted();alter(p);assert.throws(()=>normalizePacket(p,now),/plain.text|exception|HTML/i);
 }
 assert.equal(normalizePacket(formatted(),now).formatRequest.reason,formatted().formatRequest.reason);
 const linked=formatted();linked.message.html='<p><a href="https://example.com/practice?a=1&amp;b=2">Practice</a></p>';
 assert.throws(()=>normalizePacket(linked,now),/complete destination/);
 linked.message.text+='\nhttps://example.com/practice?a=1&b=2';assert.doesNotThrow(()=>normalizePacket(linked,now));
});
test('HTML needs an owner-only format decision before separate copy approval and release',async()=>{
 const c=database(),identity=await registerMessage(c.db,formatted(),now);
 await recordHistory(c.env,{...identity,history:clean()},now,goodDns);
 assert.equal((await ownerOutreach(ownerRequest('approve',identity),c.env,now)).status,409);
 assert.match((await outreachRecords(c.db,now)).items[0].issues.join(' '),/format approval/);
 assert.equal(allowed({role:'machine',capabilities:['read','prepare','reconcile','coordinate','contribute']},'POST','/api/outreach/format-approve'),false);
 assert.equal((await ownerOutreach(ownerRequest('format-approve',identity),c.env,now)).status,200);
 assert.equal(c.sql.prepare('SELECT approved_revision FROM outreach_messages').get().approved_revision,null);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
 assert.equal((await outreachRecords(c.db,now)).items[0].formatApproved,true);
 assert.equal((await ownerOutreach(ownerRequest('approve',identity),c.env,now)).status,200);
 await relayOutreach(c.env,{action:'poll',mailbox,canSend:true},now);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,200);
 const claim=await (await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).json();
 assert.deepEqual(claim.formatApproval,identity);
});
test('a changed HTML reason cannot inherit the earlier format decision',async()=>{
 const c=database(),p=formatted(),identity=await registerMessage(c.db,p,now);
 assert.equal((await ownerOutreach(ownerRequest('format-approve',identity),c.env,now)).status,200);
 p.formatRequest.reason='A different business reason needs a fresh owner decision.';
 const changed=await registerMessage(c.db,p,now);assert.notEqual(changed.revision,identity.revision);
 await recordHistory(c.env,{...changed,history:clean()},now,goodDns);
 assert.equal((await outreachRecords(c.db,now)).items[0].formatApproved,false);
 assert.equal((await ownerOutreach(ownerRequest('format-approve',identity),c.env,now)).status,409);
 assert.equal((await ownerOutreach(ownerRequest('approve',changed),c.env,now)).status,409);
 assert.equal(c.sql.prepare("SELECT count(*) n FROM outreach_events WHERE kind='owner_format_approved'").get().n,1);
});
test('legacy HTML with an old copy approval is held at queue and at claim without reserving a send',async()=>{
 const c=database(),identity=await approved(c),p=normalizePacket(packet(),now);
 p.message.html='<p>Previously prepared formatting without an exception.</p>';
 c.sql.prepare('UPDATE outreach_messages SET packet=?').run(JSON.stringify(p));
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
 c.sql.prepare("UPDATE outreach_messages SET state='queued'").run();
 assert.equal((await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).status,409);
 assert.equal(c.sql.prepare('SELECT attempt_id FROM outreach_messages').get().attempt_id,null);
 c.sql.prepare("UPDATE outreach_messages SET state='sent',sent_message_id='a1',sent_thread_id='b1'").run();
 assert.equal((await outreachRecords(c.db,now)).items[0].state,'sent');
});
test('bounce suppression survives disappearance from Gmail, even with later clean DNS/history',async()=>{
 const c=database(),identity=await prepared(c,'lead-a',{...clean(),failures:[{messageId:'fa11',kind:'hard_bounce'}]});
 await recordHistory(c.env,{...identity,history:clean()},now,goodDns);
 assert.equal((await ownerOutreach(ownerRequest('approve',identity),c.env,now)).status,409);
 assert.equal(c.sql.prepare('SELECT evidence_id FROM outreach_blocks').get().evidence_id,'fa11');
});
test('owner identity, same origin, exact revision and current checks protect every release',async()=>{
 const c=database(),identity=await prepared(c);
 assert.equal((await worker.fetch(ownerRequest('approve',identity),c.env,{})).status,403);
 assert.equal((await ownerOutreach(new Request('https://dashboard.jobhackai.io/api/outreach/approve',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(identity)}),c.env,now)).status,403);
 assert.equal((await ownerOutreach(ownerRequest('approve',identity),c.env,now+300001)).status,409);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
});
test('server and Google relay must both be explicitly enabled; old approval is never a send',async()=>{
 const c=database(),identity=await approved(c);c.env.OUTREACH_SENDER_ENABLED='false';
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
 c.env.OUTREACH_SENDER_ENABLED='true';await relayOutreach(c.env,{action:'poll',mailbox,canSend:false},now);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
});
test('one atomic reservation wins concurrent claims, immutable packet cannot be replaced',async()=>{
 const c=database(),identity=await queued(c);
 const attempts=await Promise.all([1,2].map(()=>relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)));
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
 const claim=await attempts.find(r=>r.status===200).json();assert.equal(claim.packet.message.text,packet().message.text);
 await assert.rejects(()=>registerMessage(c.db,packet(),now),/cannot be replaced/);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
});
test('failure or lost receipt never retries; native reconciliation can close an uncertain attempt',async()=>{
 const c=database(),identity=await queued(c);
 const claim=await (await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).json();
 await relayOutreach(c.env,{action:'receipt',mailbox,...identity,attemptId:claim.attemptId,outcome:'uncertain'},now);
 assert.equal((await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).status,409);
 const work=await (await relayOutreach(c.env,{action:'poll',mailbox,canSend:true},now)).json();assert.equal(work.reconcile.length,1);assert.equal(work.messages.length,0);
 await relayOutreach(c.env,{action:'receipt',mailbox,...identity,attemptId:claim.attemptId,outcome:'sent',messageId:'a123',threadId:'b123'},now);
 assert.equal((await outreachRecords(c.db,now)).items[0].state,'sent');
 await recordDeliveryEvent(c.db,{recipient:packet().message.recipient,messageId:'c123',reason:'received_reply_review'},now);
 const card=(await outreachRecords(c.db,now)).items[0];assert.equal(card.impact,'prospect');assert.match(card.nextAction,/individually/);
});
test('duplicate businesses and shared recipient aliases cannot race into two sends',async()=>{
 const c=database(),first=await approved(c);
 const p=packet('lead-b');p.evidence.sourceUrl='https://alias.example.net/contact';
 const second=await registerMessage(c.db,p,now);await recordHistory(c.env,{...second,history:clean()},now,goodDns);
 assert.equal((await ownerOutreach(ownerRequest('approve',second),c.env,now)).status,200);
 const results=await Promise.all([first,second].map(identity=>ownerOutreach(ownerRequest('send',identity),c.env,now)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('even stale Gmail evidence cannot authorize a second follow-up in the same thread',async()=>{
 const c=database(),p=packet('follow-a');p.phase='followup';Object.assign(p.message,{threadId:'b123',inReplyTo:'<original@example.net>'});
 const history={...clean(),sent:[{messageId:'a123',threadId:'b123',rfcMessageId:'<original@example.net>',sentAt:'2026-10-09T16:00:00Z'}]};
 for(const id of ['follow-a','follow-b']){p.id=id;const x=await registerMessage(c.db,p,now);await recordHistory(c.env,{...x,history},now,goodDns);assert.equal((await ownerOutreach(ownerRequest('approve',x),c.env,now)).status,200);}
 await relayOutreach(c.env,{action:'poll',mailbox,canSend:true},now);
 const a={id:'follow-a',revision:await messageRevision(normalizePacket(p,now))};
 assert.equal((await ownerOutreach(ownerRequest('send',a),c.env,now)).status,200);
 const claim=await (await relayOutreach(c.env,{action:'claim',mailbox,...a},now,goodDns)).json();
 await relayOutreach(c.env,{action:'receipt',mailbox,...a,attemptId:claim.attemptId,outcome:'sent',messageId:'a456',threadId:'b123'},now);
 assert.equal((await ownerOutreach(ownerRequest('send',{...a,id:'follow-b'}),c.env,now)).status,409);
});
test('large action board uses bounded SQL queries',async()=>{
 const c=database();for(let i=0;i<60;i++)await registerMessage(c.db,packet('lead-'+i),now);
 const before=c.queries();assert.equal((await outreachRecords(c.db,now)).items.length,60);assert.ok(c.queries()-before<=6);
});
test('signed relay rejects unauthenticated, oversized and wrong-mailbox requests',async()=>{
 const c=database();
 const request=(input,signature)=>{const body=JSON.stringify(input),timestamp=String(Math.floor(Date.now()/1000));return new Request('https://sync.example.net/outreach',{method:'POST',headers:{'Content-Type':'application/json','X-Sync-Timestamp':timestamp,'X-Sync-Signature':signature||createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex')},body});};
 assert.equal((await ingest.fetch(request({action:'poll',mailbox},'0'.repeat(64)),c.env)).status,401);
 assert.equal((await ingest.fetch(request({action:'poll',mailbox:'wrong@example.net'}),c.env)).status,400);
 assert.equal((await ingest.fetch(request({action:'poll',mailbox,padding:'x'.repeat(270000)}),c.env)).status,413);
 assert.equal((await ingest.fetch(request({action:'poll',mailbox}),c.env)).status,200);
});
test('migration preserves existing approvals and native receipts',()=>{
 const sql=new DatabaseSync(':memory:');const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');sql.exec(schema.slice(0,schema.indexOf('CREATE TABLE IF NOT EXISTS outreach_messages')));
 sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order) VALUES('existing','Email','Existing','','https://example.com','approved','Native receipt retained',0)");
 const migration=readFileSync(new URL('./migrations/003-outreach-gate.sql',import.meta.url),'utf8');sql.exec(migration);sql.exec(migration);
 assert.equal(sql.prepare("SELECT state FROM campaign_items WHERE id='existing'").get().state,'approved');
});

function googleContext(){
 const props={},queries=[],uploads=[],sends=[];
 const context=vm.createContext({Date,console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>{props[k]=v;},deleteProperty:k=>{delete props[k];}})},Gmail:{Users:{Messages:{list:(_me,options)=>{queries.push(options);return {messages:[]};},get:()=>{throw Error('unconfigured native read');},send:m=>{sends.push(m);throw Error('network timeout');}},getProfile:()=>({emailAddress:mailbox})}},Utilities:{Charset:{UTF_8:'UTF-8'},base64Encode:v=>Buffer.from(v).toString('base64'),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),base64DecodeWebSafe:v=>{if(v.length%4!==0||!/^[A-Za-z0-9_-]*={0,2}$/.test(v))throw Error('Could not decode string');return Buffer.from(v,'base64url');},newBlob:v=>({getDataAsString:()=>Buffer.from(v).toString('utf8')}),computeHmacSha256Signature:(body,key)=>Array.from(createHmac('sha256',key).update(body).digest())},UrlFetchApp:{fetch:(url,options)=>{uploads.push({url,...options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({messages:[],reconcile:[],sendingEnabled:false})};}}});
 vm.runInContext(readFileSync(new URL('./google-apps-script/Outreach.gs',import.meta.url),'utf8'),context);
 return {context,props,queries,uploads,sends};
}
test('the Google sender refuses HTML without a matching owner format permit from the server',()=>{
 const p=normalizePacket(formatted(),now),identity={id:p.id,revision:'a'.repeat(64)},attemptId='00000000-0000-4000-a000-000000000000';
 for(const permit of [null,{id:'other',revision:identity.revision},{...identity,revision:'b'.repeat(64)},identity]){
  const c=googleContext();Object.assign(c.props,{OUTREACH_CHECKS_ENABLED:'true',OUTREACH_SEND_ENABLED:'true',MAILBOX_EMAIL:mailbox});
  c.context.outreachHistory=()=>clean();c.context.outreachDeliveryScan=()=>{};
  c.context.outreachRequest=input=>input.action==='claim'?{packet:p,attemptId,expiresAt:new Date(Date.now()+30000).toISOString(),formatApproval:permit}:input.action==='check'?{issues:[]}:{};
  assert.throws(()=>c.context.syncOutreach({messages:[{...identity,packet:p,queued:true}],reconcile:[],sendingEnabled:true}));
  assert.equal(c.sends.length,permit===identity?1:0);
 }
 const c=googleContext();assert.throws(()=>c.context.outreachMime(p.message,attemptId,mailbox),/format decision/);
 const raw=Buffer.from(c.context.outreachMime(p.message,attemptId,mailbox,true),'base64url').toString();assert.match(raw,/multipart\/alternative/);
 const plain=Buffer.from(c.context.outreachMime(normalizePacket(packet(),now).message,attemptId,mailbox),'base64url').toString();
 assert.match(plain,/Content-Type: text\/plain/);assert.doesNotMatch(plain,/text\/html|multipart\/alternative/);
});
test('Google sender is off by default and normal manifest retains read-only access',()=>{
 const c=googleContext();c.context.syncOutreach();assert.equal(c.uploads.length,0);assert.equal(c.sends.length,0);
 assert.ok(!readFileSync(new URL('./google-apps-script/appsscript.json',import.meta.url),'utf8').includes('gmail.send'));
});
test('Gmail history scans Spam and Trash and catches delivery reports outside original thread',()=>{
 const c=googleContext();c.context.Gmail.Users.Messages.list=(_me,options)=>{assert.equal(options.includeSpamTrash,true);assert.match(options.q,/in:anywhere/);return {messages:[{id:'fa11'}]};};
 c.context.Gmail.Users.Messages.get=()=>({id:'fa11',threadId:'fa12',labelIds:['SPAM'],payload:{headers:[{name:'From',value:'mailer-daemon@example.net'},{name:'Subject',value:'Delivery Status Notification'}],body:{data:Buffer.from('Status: 5.1.1\nFinal-Recipient: rfc822; contact@example.com').toString('base64url')}}});
 const h=c.context.outreachHistory(normalizePacket(packet(),now));assert.equal(h.complete,true);assert.equal(h.failures[0].kind,'hard_bounce');assert.equal(h.failures[0].messageId,'fa11');
 assert.equal(c.context.outreachFailureKind('550 5.1.1 forwarding failed'),'delivery_failure_review');
});
test('Gmail history never clears an oversized or partial scan',()=>{
 const c=googleContext();c.context.Gmail.Users.Messages.list=()=>({messages:Array.from({length:201},(_,i)=>({id:String(i)}))});assert.throws(()=>c.context.outreachHistory(normalizePacket(packet(),now)),/bounded check/);
});
test('only the exact native Sent envelope and copy count as a verified send',()=>{
 const c=googleContext(),p=normalizePacket(packet(),now).message,id='00000000-0000-4000-a000-000000000000';
 const native={id:'a123',threadId:'b123',labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'From',value:mailbox},{name:'To',value:p.recipient},{name:'Subject',value:p.subject},{name:'Message-ID',value:'<outreach.'+id+'@jobhackai.io>'}],body:{data:Buffer.from(p.text).toString('base64url')}}};
 assert.equal(c.context.outreachVerifiedSent(native,p,id,mailbox),true);
 native.payload.body.data=Buffer.from('Changed body').toString('base64url');assert.equal(c.context.outreachVerifiedSent(native,p,id,mailbox),false);
 const raw=Buffer.from(c.context.outreachMime(p,id,mailbox),'base64url').toString();assert.match(raw,/To: contact@example.com\r\n/);assert.ok(!/\r\n(?:Cc|Bcc):/.test(raw));
});

test('a changed DNS route or a bounce appearing after approval blocks the reserved send',async()=>{
 const c=database(),identity=await queued(c);
 const failed=async()=>Response.json({Status:3});
 assert.equal((await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,failed)).status,409);
 assert.equal(c.sql.prepare('SELECT state FROM outreach_messages').get().state,'queued');
 await recordDeliveryEvent(c.db,{recipient:packet().message.recipient,messageId:'bad1',reason:'delivery_failure_review'},now);
 assert.equal((await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).status,409);
});
test('owner can cancel only an unclaimed queue item; an attempted message cannot be cancelled or retried',async()=>{
 const c=database(),identity=await queued(c);
 assert.equal((await ownerOutreach(ownerRequest('cancel',identity),c.env,now)).status,200);
 assert.equal(c.sql.prepare('SELECT approved_revision FROM outreach_messages').get().approved_revision,null);
 assert.equal((await ownerOutreach(ownerRequest('send',identity),c.env,now)).status,409);
});
test('old generic email approvals are held and cannot bypass exact email review',async()=>{
 const c=database();c.sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order) VALUES('legacy','Stan · Outreach','Old batch','','https://example.com','pending','Old approval',0)");
 const ctx={access:{aud:'884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40',getIdentity:async()=>({email:mailbox})}};
 const item=(await (await worker.fetch(new Request('https://dashboard.jobhackai.io/api/campaigns'),c.env,ctx)).json()).items[0];
 assert.equal(item.state,'hold');assert.equal(item.requiresOutreachManifest,true);
 const request=new Request('https://dashboard.jobhackai.io/api/campaigns/legacy/approve',{method:'POST',headers:{Origin:'https://dashboard.jobhackai.io','Content-Type':'application/json'},body:JSON.stringify({revision:item.reviewRevision})});
 assert.equal((await worker.fetch(request,c.env,ctx)).status,409);
 assert.equal(c.sql.prepare('SELECT state FROM campaign_items').get().state,'pending');
});
test('Google send timeout is one attempt, followed only by read-only reconciliation',()=>{
 const c=googleContext(),p=normalizePacket(packet(),now),identity={id:p.id,revision:'a'.repeat(64)},attemptId='00000000-0000-4000-a000-000000000000';
 c.props.OUTREACH_CHECKS_ENABLED='true';c.props.OUTREACH_SEND_ENABLED='true';c.props.MAILBOX_EMAIL=mailbox;
 let uncertain=false,claims=0;
 c.context.outreachDeliveryScan=()=>{};c.context.outreachHistory=()=>clean();
 c.context.outreachRequest=input=>{
  if(input.action==='poll')return {messages:uncertain?[]:[{...identity,packet:p,queued:true}],reconcile:uncertain?[{...identity,attempt_id:attemptId,packet:p,recipient:p.message.recipient}]:[],sendingEnabled:true};
  if(input.action==='check')return {issues:[]};
  if(input.action==='claim'){claims++;return {attemptId,packet:p,expiresAt:new Date(Date.now()+30000).toISOString()};}
  if(input.action==='receipt'){assert.equal(input.outcome,'uncertain');uncertain=true;return {};}
  throw Error('Unexpected request');
 };
 assert.throws(()=>c.context.syncOutreach(),/Automatic retry is disabled/);
 c.context.syncOutreach();assert.equal(c.sends.length,1);assert.equal(claims,1);
});


test('Apps Script MIME decoding pads Gmail data and rejects malformed evidence',()=>{
 const c=googleContext();
 for(const value of ['a','ab','abc','✓ unicode','Status: 5.1.1'])assert.equal(c.context.outreachBody({body:{data:Buffer.from(value).toString('base64url')}}),value);
 assert.throws(()=>c.context.outreachBody({body:{data:'x'}}),/Invalid Gmail MIME encoding/);
});


test('Advanced Gmail byte arrays are decoded directly, including signed Unicode bytes',()=>{
 const c=googleContext(),value='Gmail ✓ signed bytes';
 const bytes=Array.from(Buffer.from(value)).map(v=>v>127?v-256:v);
 assert.equal(c.context.outreachBody({body:{data:bytes}}),value);
 assert.throws(()=>c.context.outreachBody({body:{data:[999]}}),/Invalid Gmail MIME bytes/);
});

test('signed poll includes every verified outbound thread and legacy sent receipt without label dependence',async()=>{
 const c=database(),identity=await queued(c);
 const claim=await(await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).json();
 await relayOutreach(c.env,{action:'receipt',mailbox,...identity,attemptId:claim.attemptId,outcome:'sent',messageId:'aa1',threadId:'bb1'},now);
 c.sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order,gmail_thread_id) VALUES('legacy','Email','Sent','','https://mail.google.com','sent','Native receipt',0,'cc1'),('draft','Email','Draft','','https://mail.google.com','pending','',1,'dd1')");
 const poll=await(await relayOutreach(c.env,{action:'poll',mailbox,canSend:false},now)).json();
 assert.deepEqual(poll.trackedThreadIds.sort(),['bb1','cc1']);
});

test('Gmail-replaced Message-ID still requires the exact provider receipt and complete approved copy',()=>{
 const c=googleContext(),p=normalizePacket(packet(),now).message,attempt='00000000-0000-4000-a000-000000000000',accepted={id:'a1',threadId:'b1'};
 const native={...accepted,labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'From',value:mailbox},{name:'To',value:p.recipient},{name:'Subject',value:p.subject},{name:'Message-ID',value:'<gmail-generated@mail.gmail.com>'}],body:{data:Buffer.from(p.text).toString('base64url')}}};
 assert.equal(c.context.outreachVerifiedSent(native,p,attempt,mailbox),false);
 assert.equal(c.context.outreachVerifiedSent(native,p,attempt,mailbox,accepted),true);
 for(const alter of [m=>m.id='a2',m=>m.threadId='b2',m=>m.labelIds=[],m=>m.payload.headers.push({name:'Cc',value:'other@example.com'}),m=>m.payload.headers.find(h=>h.name==='Subject').value+='changed',m=>m.payload.body.data=Buffer.from('changed').toString('base64url')]){
  const changed=structuredClone(native);alter(changed);assert.equal(c.context.outreachVerifiedSent(changed,p,attempt,mailbox,accepted),false);
 }
});

for(const failAt of ['native read','receipt upload'])test('provider IDs survive a lost '+failAt+' and reconcile without resending',()=>{
 const c=googleContext(),p=normalizePacket(packet(),now),identity={id:p.id,revision:'a'.repeat(64)},attemptId='00000000-0000-4000-a000-000000000000';
 Object.assign(c.props,{OUTREACH_CHECKS_ENABLED:'true',OUTREACH_SEND_ENABLED:'true',MAILBOX_EMAIL:mailbox});
 let reserved=false,fail=true,verified=0;
 const native={id:'a1',threadId:'b1',labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'From',value:mailbox},{name:'To',value:p.message.recipient},{name:'Subject',value:p.message.subject},{name:'Message-ID',value:'<gmail-generated@mail.gmail.com>'}],body:{data:Buffer.from(p.message.text).toString('base64url')}}};
 c.context.Gmail.Users.Messages.send=m=>{c.sends.push(m);return {id:native.id,threadId:native.threadId};};
 c.context.Gmail.Users.Messages.get=()=>{if(fail&&failAt==='native read')throw Error('read timeout');return native;};
 c.context.outreachDeliveryScan=()=>{};c.context.outreachHistory=()=>clean();
 c.context.outreachRequest=input=>{
  if(input.action==='poll')return {messages:reserved?[]:[{...identity,packet:p,queued:true}],reconcile:reserved?[{...identity,attempt_id:attemptId,packet:p}]:[],sendingEnabled:true};
  if(input.action==='check')return {issues:[]};
  if(input.action==='claim'){reserved=true;return {attemptId,packet:p,expiresAt:new Date(Date.now()+30000).toISOString()};}
  if(input.action==='receipt'){if(input.outcome==='sent'){if(fail&&failAt==='receipt upload')throw Error('upload timeout');verified++;}return {};}
  throw Error('Unexpected action');
 };
 assert.throws(()=>c.context.syncOutreach());assert.equal(c.sends.length,1);
 assert.deepEqual(JSON.parse(c.props['OUTREACH_RECEIPT_'+attemptId]),{id:'a1',threadId:'b1'});
 fail=false;c.context.syncOutreach();assert.equal(verified,1);assert.equal(c.sends.length,1);assert.equal(c.props['OUTREACH_RECEIPT_'+attemptId],undefined);
});

test('workflow labels follow the latest non-draft message and preserve all unrelated labels',()=>{
 const c=googleContext(),changes=[];
 const labels=[{id:'track',name:'0: JobHackAI / Track'},{id:'respond',name:'1: To respond'},{id:'waiting',name:'6: Awaiting reply'}];
 c.context.Gmail.Users.Threads={modify:(body,me,id)=>changes.push({body:JSON.parse(JSON.stringify(body)),me,id})};
 const thread={id:'aa1',messages:[{id:'a1',internalDate:'1',labelIds:['INBOX','respond','UNREAD']},{id:'a2',internalDate:'2',labelIds:['SENT']},{id:'a3',internalDate:'9',labelIds:['DRAFT']}]};
 c.context.outreachLabelThread(thread,labels);assert.equal(changes.length,0);
 c.props.OUTREACH_LABELS_ENABLED='true';c.context.outreachLabelThread(thread,labels);
 assert.deepEqual(changes[0],{body:{addLabelIds:['track','waiting'],removeLabelIds:['respond']},me:'me',id:'aa1'});
 thread.messages.push({id:'a4',internalDate:'3',labelIds:['INBOX','UNREAD']});c.context.outreachLabelThread(thread,labels);
 assert.deepEqual(changes[1].body,{addLabelIds:['track','respond'],removeLabelIds:['waiting']});
 c.context.Gmail.Users.Threads.modify=()=>{throw Error('authorization missing');};
 assert.doesNotThrow(()=>c.context.outreachLabelThread(thread,labels));
 assert.ok(!readFileSync(new URL('./google-apps-script/appsscript.sender.json',import.meta.url),'utf8').includes('gmail.modify'));
});


test('verified outreach receipt yields one conversation card while delivery holds remain visible',async()=>{
 const c=database(),identity=await queued(c);
 const claim=await(await relayOutreach(c.env,{action:'claim',mailbox,...identity},now,goodDns)).json();
 await relayOutreach(c.env,{action:'receipt',mailbox,...identity,attemptId:claim.attemptId,outcome:'sent',messageId:'aa1',threadId:'bb1'},now);
 c.sql.exec("INSERT INTO gmail_threads(thread_id,last_message_id,sender,subject,preview,state,last_message_at,seen_sync_id) VALUES('bb1','aa1','Owner','Introduction','Sent','waiting','2026-10-19T19:00:00.000Z','test')");
 const ctx={access:{aud:'884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40',getIdentity:async()=>({email:mailbox})}};
 const read=async()=> (await(await worker.fetch(new Request('https://dashboard.jobhackai.io/api/campaigns'),c.env,ctx)).json()).items;
 let items=await read();assert.ok(items.some(i=>i.id==='gmail-bb1'));assert.ok(!items.some(i=>i.id==='outreach-'+identity.id));
 await recordDeliveryEvent(c.db,{recipient:packet().message.recipient,messageId:'bad1',reason:'hard_bounce'},now);
 items=await read();assert.equal(items.find(i=>i.id==='outreach-'+identity.id).state,'hold');
});
test('owner feedback withdraws approval and the exact revision stays held after re-preparation',async()=>{
 const c=database(),p=packet('feedback-test');const x=await registerMessage(c.db,p,now);
 await recordHistory(c.env,{...x,history:clean()},now,goodDns);
 assert.equal((await ownerOutreach(ownerRequest('approve',x),c.env,now)).status,200);
 assert.equal((await ownerOutreach(ownerRequest('feedback',{...x,action:'changes',note:'Revise the business-fit sentence.'}),c.env,now)).status,200);
 assert.equal((await ownerOutreach(ownerRequest('approve',x),c.env,now)).status,409);
 await registerMessage(c.db,p,now);await recordHistory(c.env,{...x,history:clean()},now,goodDns);
 assert.equal((await ownerOutreach(ownerRequest('approve',x),c.env,now)).status,409);
 assert.equal((await outreachRecords(c.db,now)).items[0].feedback.action,'changes');
});
