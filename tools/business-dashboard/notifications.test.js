import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import worker, { campaignRecords } from './worker.bundle.js';
import { directoryRecords, resolveNotification } from './src/notifications.js';
import { receiveGmailSync } from './src/gmail-sync.js';

const origin = 'https://dashboard.jobhackai.io';
const owner = { access: { aud: '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40', getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
const now = new Date('2026-10-21T14:00:00Z');
const reference = '00000000-0000-4000-8000-000000000001';
const secret = 'test-only-secret-with-at-least-32-characters';
function database(schema) {
  const sql = new DatabaseSync(':memory:'); sql.exec(schema);
  const db = { prepare(query) { return { args: [], bind(...args) { this.args=args; return this; },
    async first() { return sql.prepare(query).get(...this.args) ?? null; },
    async all() { return { results:sql.prepare(query).all(...this.args) }; },
    async run() { return { meta:{changes:sql.prepare(query).run(...this.args).changes} }; },
  }; }, async batch(statements) { sql.exec('BEGIN'); try { const result=[]; for(const s of statements)result.push(await s.run()); sql.exec('COMMIT'); return result; } catch(error) { sql.exec('ROLLBACK');throw error; } } };
  return {sql,db};
}
function fixture() {
  const dashboard = database(readFileSync(new URL('./schema.sql', import.meta.url),'utf8'));
  const source = database(`CREATE TABLE directory_requests(id TEXT PRIMARY KEY, category TEXT, business_name TEXT, website TEXT, service_area TEXT,
    service_details TEXT, contact_email TEXT, review_status TEXT DEFAULT 'pending', created_at TEXT DEFAULT '2026-10-20 19:42:47', updated_at TEXT, notification_status TEXT)`);
  source.sql.prepare('INSERT INTO directory_requests(id,category,business_name,website,service_area,service_details,contact_email) VALUES(?,?,?,?,?,?,?)')
    .run(reference,'mobile-detailing','Submitted business','https://example.com','Cincinnati','Needs water and electric','contact@example.com');
  const env={DASHBOARD_DB:dashboard.db, PRODUCTION_DB:source.db, SYNC_SECRET:secret, MAILBOX_EMAIL:'owner@example.com',TRACK_LABEL_ID:'Label_test'};
  const board=()=>campaignRecords(env,now);
  let scans=0;
  const sync=async (message='abc111',preview='Latest content',extra={})=>{
    const scanTime=new Date(now.getTime()+1000*scans++).toISOString();
    const body=JSON.stringify({schemaVersion:1,syncId:randomUUID(),mailbox:env.MAILBOX_EMAIL,labelId:env.TRACK_LABEL_ID,startedAt:scanTime,completedAt:scanTime,threads:[{threadId:'abc123',lastMessageId:message,sender:'Business <contact@example.com>',subject:'Request',preview,state:'needs_review',lastMessageAt:now.toISOString(),...extra}]});
    const timestamp=String(now.getTime()/1000);
    return receiveGmailSync(new Request('https://sync.example/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Sync-Timestamp':timestamp,'X-Sync-Signature':createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')},body}),env,now);
  };
  return {env,dashboard,source,board,sync};
}
const input=item=>({id:item.id,revision:item.notificationRevision});
const post=(action,body,headers={})=>new Request(`${origin}/api/notifications/${action}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('unlabelled directory submissions appear without a Gmail scan, including full submitted contact and details',async()=>{
  const f=fixture();const board=await f.board();
  assert.equal(board.gmailSync.status,'not_connected');assert.equal(board.directorySource.status,'current');
  assert.equal(board.items.length,1);assert.equal(board.items[0].id,`directory-${reference}`);
  assert.equal(board.items[0].state,'pending');assert.equal(board.items[0].impact,'prospect');
  assert.match(board.items[0].detail,/contact@example.com/);assert.match(board.items[0].detail,/water and electric/);
  assert.match(board.items[0].evidence,/untrusted/);
  assert.equal(f.dashboard.sql.prepare('SELECT count(*) AS n FROM gmail_threads').get().n,0);
});

test('handled messages survive repeated signed sync, unlabelling and relabelling; only a new message reopens',async()=>{
  const f=fixture();assert.equal((await f.sync()).status,200);
  const email=(await f.board()).items.find(i=>i.source==='gmail');
  assert.equal((await worker.fetch(post('handle',input(email)),f.env,owner)).status,200);
  const before=f.dashboard.sql.prepare('SELECT * FROM board_resolutions').get();
  assert.equal((await f.sync()).status,200);assert.equal((await f.board()).items.find(i=>i.source==='gmail').state,'handled');
  f.dashboard.sql.exec('UPDATE gmail_threads SET active=0');assert.equal((await f.board()).items.some(i=>i.source==='gmail'),false);
  assert.equal((await f.sync()).status,200);assert.equal((await f.board()).items.find(i=>i.source==='gmail').state,'handled');
  assert.equal((await worker.fetch(post('handle',input(email)),f.env,owner)).status,200);
  assert.deepEqual(f.dashboard.sql.prepare('SELECT * FROM board_resolutions').get(),before);
  assert.equal((await f.sync('abc222','New reply')).status,200);
  assert.equal((await f.board()).items.find(i=>i.source==='gmail').state,'pending');
  assert.equal((await worker.fetch(post('handle',input(email)),f.env,owner)).status,409);
  assert.equal((await worker.fetch(post('reopen',input(email)),f.env,owner)).status,409);
});

test('directory dismissals ignore notification retries, reopen on content or review changes, and never mutate production',async()=>{
  const f=fixture();let item=(await f.board()).items[0];
  const before=f.source.sql.prepare('SELECT * FROM directory_requests').get();
  assert.equal(await resolveNotification(f.env,input(item),'handle',now),true);
  assert.deepEqual(f.source.sql.prepare('SELECT * FROM directory_requests').get(),before);
  assert.equal((await f.board()).items[0].state,'handled');
  f.source.sql.exec("UPDATE directory_requests SET updated_at='2026-10-21 13:59:00', notification_status='accepted'");
  assert.equal((await f.board()).items[0].state,'handled');
  assert.equal(await resolveNotification(f.env,input(item),'reopen',now),true);
  assert.equal((await f.board()).items[0].state,'pending');
  assert.equal(await resolveNotification(f.env,input(item),'handle',now),true);
  f.source.sql.exec("UPDATE directory_requests SET service_details='Changed request'");
  assert.equal((await f.board()).items[0].state,'pending');
  assert.equal(await resolveNotification(f.env,input(item),'handle',now),false);
  item=(await f.board()).items[0];await resolveNotification(f.env,input(item),'handle',now);
  f.source.sql.exec("UPDATE directory_requests SET review_status='closed'");
  assert.equal((await f.board()).items[0].state,'closed');
});

test('only exact receipt and mapped manual card deduplicate; business replies and lookalike senders remain separate',async()=>{
  const f=fixture();const title=`[JobHackAI Local] Directory request ${reference}`;
  f.dashboard.sql.prepare("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order,impact) VALUES(?,'Email','Imported request','','https://mail.google.com','pending','',0,'prospect')").run(`local-request-${reference}`);
  assert.equal((await f.sync('abc111','Receipt',{subject:title,sender:'JobHackAI <noreply@jobhackai.io>'})).status,200);
  assert.equal((await f.board()).items.length,1);
  assert.equal((await f.sync('abc222','Business reply',{subject:title})).status,200);
  assert.equal((await f.board()).items.length,2);
  await f.sync('abc333','Spoofed',{subject:title,sender:'JobHackAI <noreply@jobhackai.io.attacker.example>'});
  assert.equal((await f.board()).items.length,2);
  const failure={prepare(){throw new Error('Source unavailable');}};f.env.PRODUCTION_DB=failure;
  const board=await f.board();assert.equal(board.directorySource.status,'unavailable');
  assert.equal(board.items.length,2); // Both fallback source records remain visible.
});

test('notification endpoints require owner, same origin, valid bounded JSON and exact source revision',async()=>{
  const f=fixture();const item=(await f.board()).items[0];
  for(const action of ['handle','reopen']){
    assert.equal((await worker.fetch(post(action,input(item)),f.env,{})).status,403);
    assert.equal((await worker.fetch(post(action,input(item),{Origin:'https://attacker.example'}),f.env,owner)).status,403);
    assert.equal((await worker.fetch(post(action,input(item),{'Content-Type':'text/plain'}),f.env,owner)).status,403);
    assert.equal((await worker.fetch(post(action,{...input(item),revision:'0'.repeat(64)}),f.env,owner)).status,409);
    assert.equal((await worker.fetch(post(action,{id:'nextdoor-post',revision:'0'.repeat(64)}),f.env,owner)).status,409);
    assert.equal((await worker.fetch(post(action,{padding:'x'.repeat(1100)}),f.env,owner)).status,413);
  }
  const invalid=post('handle',{});const malformed=new Request(invalid.url,{method:'POST',headers:invalid.headers,body:'{'});
  assert.equal((await worker.fetch(malformed,f.env,owner)).status,400);
  assert.equal(f.dashboard.sql.prepare('SELECT count(*) AS n FROM board_resolutions').get().n,0);
});

test('dashboard resolution failure fails closed rather than resurrecting handled cards',async()=>{
  const f=fixture();await resolveNotification(f.env,input((await f.board()).items[0]),'handle',now);
  f.dashboard.sql.exec('DROP TABLE board_resolutions');
  assert.equal((await worker.fetch(new Request(`${origin}/api/campaigns`),f.env,owner)).status,503);
});

test('additive migration is idempotent and preserves approvals and suppression evidence',async()=>{
  const f=fixture();f.dashboard.sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order) VALUES('approved','Email','Draft','','','approved','Owner decision',1); INSERT INTO outreach_blocks VALUES('blocked@example.com','bounce','native-message','2026-10-20')");
  const migration=readFileSync(new URL('./migrations/004-board-resolutions.sql',import.meta.url),'utf8');
  f.dashboard.sql.exec('DROP TABLE board_resolutions');f.dashboard.sql.exec(migration);f.dashboard.sql.exec(migration);
  await resolveNotification(f.env,input((await f.board()).items.find(i=>i.source==='directory')),'handle',now);
  assert.equal(f.dashboard.sql.prepare('SELECT state FROM campaign_items').get().state,'approved');
  assert.equal(f.dashboard.sql.prepare('SELECT reason FROM outreach_blocks').get().reason,'bounce');
});

test('directory history is bounded with an explicit truncation signal, not silently dropped',async()=>{
  const f=fixture();for(let n=0;n<201;n++)f.source.sql.prepare('INSERT INTO directory_requests(id,business_name) VALUES(?,?)').run(`fixture-${n}`,'History');
  const result=await directoryRecords(f.env,now);assert.equal(result.items.length,200);assert.equal(result.directorySource.truncated,true);
});
