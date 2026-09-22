import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1} from './sqlite-d1-helper.mjs';
import {saveDirectoryRequest,notifyDirectoryRequest,directoryEnabled,directoryOriginAllowed} from '../directory-requests.js';
import {onRequest} from '../../api/directory-requests.js';
const input=()=>({submission_key:crypto.randomUUID(),business_name:'Synthetic Dev Detailer',website:'https://example.com',service_area:'Covington',service_details:'Development test. Mobile interior service. No business outreach.',contact_email:'owner@example.com',company_fax:''});
function setup(t) {
 const db=sqliteD1();t.after(()=>db.close());db.exec(readFileSync(new URL('../../../db/migrations/030_directory_requests.sql',import.meta.url),'utf8'));
 const env={DB:db,ENVIRONMENT:'dev',FRONTEND_URL:'https://dev.jobhackai.io',ADMIN_API_KEY:'fixture-only',RESEND_API_KEY:'fixture-only'};
 return {db,env,row:()=>db.prepare('SELECT * FROM directory_requests').first(),save:data=>saveDirectoryRequest(env,data||input(),'192.0.2.1')};
}
test('durable private record, matching retries and new-key identical payload deduplicate',async t=>{
 const f=setup(t),data=input(),a=await f.save(data);assert.equal(a.status,201);
 const row=await f.row();assert.equal(row.review_status,'pending');assert.equal(row.notification_status,'pending');assert.ok(row.created_at);assert.notEqual(row.abuse_hash,'192.0.2.1');
 for(const retry of [data,{...data,submission_key:crypto.randomUUID()}]) {const b=await f.save(retry);assert.equal(b.status,200);assert.equal(b.body.request_id,a.body.request_id);assert.equal(b.body.duplicate,true);}
 assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM directory_requests').first('n'),1);
 assert.equal((await f.save({...data,business_name:'different'})).status,409);
});
test('concurrent exact submissions save one row',async t=>{
 const f=setup(t),data=input();const results=await Promise.all(Array.from({length:5},()=>f.save(data)));
 assert.equal(new Set(results.map(r=>r.body.request_id)).size,1);assert.equal(results.filter(r=>r.status===201).length,1);
});
test('validation, honeypot, types, protocol and header injection never save',async t=>{
 const f=setup(t);
 for(const change of [{business_name:''},{business_name:[]},{website:'javascript:alert(1)'},{website:'https://user:pass@example.com'},{contact_email:'a@b.com\nBcc: evil@example.com'},{contact_email:'invalid'},{service_details:'x'.repeat(2001)},{company_fax:'bot'},{submission_key:'bad'}]) assert.equal((await f.save({...input(),...change})).status,400);
 assert.equal(await f.row(),null);
});
test('per-contact, per-IP and global bounds fail closed',async t=>{
 const f=setup(t);
 for(let n=0;n<3;n++) assert.equal((await f.save({...input(),business_name:'Test '+n})).status,201);
 assert.equal((await f.save({...input(),business_name:'Fourth'})).status,429);
 for(let n=0;n<2;n++) assert.equal((await f.save({...input(),contact_email:`other${n}@example.com`})).status,201);
 assert.equal((await f.save({...input(),contact_email:'sixth@example.com'})).status,429);
 for(let n=0;n<45;n++) await saveDirectoryRequest(f.env,{...input(),contact_email:`g${n}@example.com`},`198.51.100.${n}`);
 assert.equal((await saveDirectoryRequest(f.env,{...input(),contact_email:'over@example.com'},'203.0.113.99')).status,429);
});
test('endpoint confirms storage only; saves before scheduling notification',async t=>{
 const f=setup(t);const calls=[];t.mock.method(globalThis,'fetch',async()=>{calls.push(await f.row());return Response.json({id:'receipt'});});
 const pending=[];const response=await onRequest({env:f.env,request:new Request('https://dev.jobhackai.io/api/directory-requests',{method:'POST',headers:{Origin:'https://dev0.jobhackai-app-marketing-seo.pages.dev','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(input())}),waitUntil:p=>pending.push(p)});
 assert.equal(response.status,201);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://dev0.jobhackai-app-marketing-seo.pages.dev');assert.equal(response.headers.get('Cache-Control'),'no-store');
 await Promise.all(pending);assert.equal(calls.length,1);assert.equal(calls[0].review_status,'pending');assert.equal((await f.row()).notification_status,'accepted');assert.equal(Object.hasOwn(await response.json(),'email_delivered'),false);
});
test('foreign origins, missing storage, body limit and held environments never claim success',async t=>{
 const f=setup(t);
 const req=(origin,body=JSON.stringify(input()))=>new Request('https://dev.jobhackai.io/api/directory-requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body});
 assert.equal((await onRequest({env:f.env,request:req('https://evil.example')})).status,403);
 assert.equal((await onRequest({env:f.env,request:req('https://dev.jobhackai.io','x'.repeat(12001))})).status,400);
 for(const name of ['qa','production',undefined]) assert.equal((await onRequest({env:{...f.env,ENVIRONMENT:name},request:req('https://dev.jobhackai.io')})).status,404);
 assert.equal((await onRequest({env:{...f.env,DB:null},request:req('https://dev.jobhackai.io')})).status,503);
 assert.equal(await f.row(),null);
});
test('provider timeout preserves submission; due retry reuses exact body/key and accepts once',async t=>{
 const f=setup(t);const saved=await f.save();const calls=[];
 await notifyDirectoryRequest(f.env,saved.body.request_id,async(u,init)=>{calls.push(init);throw Error('timeout');});
 let row=await f.row();assert.equal(row.notification_status,'pending');assert.equal(row.notification_attempts,1);assert.ok(row.notification_error);assert.equal(row.review_status,'pending');
 await notifyDirectoryRequest(f.env,row.id,()=>{throw Error('backoff should prevent dispatch');});assert.equal((await f.row()).notification_attempts,1);
 f.db.exec("UPDATE directory_requests SET notification_next_attempt_at=datetime('now','-1 minute')");
 await notifyDirectoryRequest(f.env,row.id,async(u,init)=>{calls.push(init);return Response.json({id:'receipt'});});
 assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].redirect,'manual');
 const body=JSON.parse(calls[0].body);assert.deepEqual(body.to,['support@jobhackai.io']);assert.match(body.subject,/^\[DEV TEST\]/);assert.equal(body.reply_to,undefined);
 assert.equal((await f.row()).notification_status,'accepted');await notifyDirectoryRequest(f.env,row.id,()=>{throw Error('no duplicate send');});
});
test('missing email secret, rejection and exhausted/window-expired retries are observable',async t=>{
 const f=setup(t);const {body:{request_id:id}}=await f.save();
 await notifyDirectoryRequest({...f.env,RESEND_API_KEY:''},id);assert.equal((await f.row()).notification_error,'email_not_configured');assert.equal((await f.row()).notification_attempts,0);
 await notifyDirectoryRequest(f.env,id,async()=>Response.json({error:'reject'},{status:403}));assert.equal((await f.row()).notification_status,'needs_review');
 f.db.exec("UPDATE directory_requests SET notification_status='pending',notification_first_attempt_at=datetime('now','-24 hours')");
 await notifyDirectoryRequest(f.env,id,()=>{throw Error('must not resend after provider window');});assert.equal((await f.row()).notification_error,'retry_window_expired');
});
test('crash after provider acceptance can recover within key window; stale fifth attempt requires review',async t=>{
 const f=setup(t);const {body:{request_id:id}}=await f.save();
 f.db.exec("UPDATE directory_requests SET notification_status='sending',notification_attempts=1,notification_first_attempt_at=datetime('now'),notification_lease_until=datetime('now','-2 minutes')");
 await notifyDirectoryRequest(f.env,id,async()=>Response.json({id:'same-provider-receipt'}));assert.equal((await f.row()).notification_status,'accepted');
 f.db.exec("UPDATE directory_requests SET notification_status='sending',notification_attempts=5,notification_lease_until=datetime('now','-2 minutes')");
 await notifyDirectoryRequest(f.env,id,()=>{throw Error('must not retry exhausted call');});assert.equal((await f.row()).notification_status,'needs_review');
});
test('overlapping notification workers claim only one send',async t=>{
 const f=setup(t);const {body:{request_id:id}}=await f.save();let n=0;
 const send=async()=>{n++;return Response.json({id:'one'});};await Promise.all([notifyDirectoryRequest(f.env,id,send),notifyDirectoryRequest(f.env,id,send)]);assert.equal(n,1);
});

test('environment routing rejects cross-environment origins and mismatched frontend',()=>{
 const pairs=[['dev','https://dev.jobhackai.io','https://dev0.jobhackai-app-marketing-seo.pages.dev'],['qa','https://qa.jobhackai.io','https://qa-marketing.jobhackai.io'],['PROD','https://app.jobhackai.io','https://jobhackai.io']];
 for(const [ENVIRONMENT,FRONTEND_URL,origin] of pairs){
 const env={ENVIRONMENT,FRONTEND_URL};assert.equal(directoryEnabled(env),true);assert.equal(directoryOriginAllowed(env,origin),true);
 for(const other of pairs.filter(x=>x[0]!==ENVIRONMENT))assert.equal(directoryOriginAllowed(env,other[2]),false);
 assert.equal(directoryEnabled({...env,FRONTEND_URL:'https://wrong.example'}),false);
 }
});
test('QA and production notifications stay private and have separate idempotency namespaces',async t=>{
 for(const [ENVIRONMENT,FRONTEND_URL,label,key] of [['qa','https://qa.jobhackai.io','[QA TEST]','qa'],['PROD','https://app.jobhackai.io','[JobHackAI Local]','production']]){
 const f=setup(t),env={...f.env,ENVIRONMENT,FRONTEND_URL};const saved=await saveDirectoryRequest(env,input(),'192.0.2.1');
 await notifyDirectoryRequest(env,saved.body.request_id,async(url,init)=>{const body=JSON.parse(init.body);assert.ok(body.subject.startsWith(label));assert.deepEqual(body.to,['support@jobhackai.io']);assert.equal(init.headers['Idempotency-Key'],`directory-request/${key}/${saved.body.request_id}`);return Response.json({id:'receipt'});});
 assert.equal((await f.row()).notification_status,'accepted');
 }
});
