import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { receiveGmailSync, gmailRecords } from './src/gmail-sync.js';
import worker, { campaignRecords } from './worker.bundle.js';

const now = new Date('2026-10-17T19:00:00.000Z');
const secret = 'test-only-secret-with-at-least-32-characters';
const mailbox = 'owner@example.com';
const labelId = 'Label_test';
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      return { query, args: [], bind(...args) { this.args = args; return this; },
        async first() { return sql.prepare(query).get(...this.args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...this.args) }; },
        async run() { const result = sql.prepare(query).run(...this.args); return { meta: { changes: result.changes } }; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, sql, env: { DASHBOARD_DB: db, SYNC_SECRET: secret, MAILBOX_EMAIL: mailbox, TRACK_LABEL_ID: labelId } };
}
const row = (state = 'needs_review') => ({ threadId: 'abc123', lastMessageId: 'def456', sender: 'Prospect <person@example.com>', subject: 'Meeting request', preview: 'Can we talk?', state, lastMessageAt: '2026-10-17T18:00:00.000Z' });
const snapshot = (threads = [row()], startedAt = now.toISOString()) => ({ schemaVersion: 1, syncId: randomUUID(), mailbox, labelId, startedAt, completedAt: startedAt, threads });
function request(input, options = {}) {
  const body = options.body ?? JSON.stringify(input);
  const timestamp = options.timestamp ?? String(now.getTime() / 1000);
  const signature = options.signature ?? createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://sync.example.com/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Timestamp': timestamp, 'X-Sync-Signature': signature }, body });
}

test('real SQLite snapshot: inbound → sent → incoming, idempotence, manual dedupe and approval isolation', async () => {
  const { env, sql, db } = database();
  sql.exec("INSERT INTO campaign_items(id,channel,title,detail,review_url,state,evidence,sort_order,impact,gmail_thread_id) VALUES('manual','Email','Old reply task','','https://mail.google.com/','sent','',0,'prospect','abc123'),('campaign','Outreach','Approval','','https://chatgpt.com/','pending','',1,'campaign',NULL)");
  const first = snapshot();
  assert.equal((await receiveGmailSync(request(first), env, now)).status, 200);
  assert.equal((await receiveGmailSync(request(first), env, now)).status, 200);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM gmail_threads').get().n, 1);
  assert.equal((await campaignRecords(env, now)).items.some(item => item.id === 'manual'), false);
  assert.equal((await gmailRecords(db, now)).items[0].state, 'pending');
  sql.exec("UPDATE gmail_threads SET impact='customer'");
  const sent = snapshot([row('waiting')], '2026-10-17T19:00:01.000Z');
  assert.equal((await receiveGmailSync(request(sent), env, now)).status, 200);
  assert.equal((await gmailRecords(db, now)).items[0].state, 'waiting');
  assert.equal((await gmailRecords(db, now)).items[0].impact, 'customer');
  assert.equal((await receiveGmailSync(request(snapshot([row()], '2026-10-17T19:00:02.000Z')), env, now)).status, 200);
  assert.equal((await gmailRecords(db, now)).items[0].state, 'pending');
  assert.equal(sql.prepare("SELECT state FROM campaign_items WHERE id='campaign'").get().state, 'pending');
  const ctx = { access: { aud: '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40', getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const approval = new Request('https://dashboard.jobhackai.io/api/campaigns/gmail-abc123/approve', { method: 'POST', headers: { Origin: 'https://dashboard.jobhackai.io', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(approval, env, ctx)).status, 409);
});

test('bad authentication, invalid input, old runs and database failure preserve the last successful scan', async () => {
  const { env, sql, db } = database();
  await receiveGmailSync(request(snapshot()), env, now);
  const last = sql.prepare('SELECT * FROM gmail_sync_state').get();
  for (const bad of [request(snapshot(), { signature: '0'.repeat(64) }), request(snapshot(), { timestamp: '1000000000' }), request({ ...snapshot(), mailbox: 'wrong@example.com' }), request({ ...snapshot(), labelId: 'wrong' }), request(snapshot([{ ...row(), body: 'must not be stored' }]))]) {
    assert.ok((await receiveGmailSync(bad, env, now)).status >= 400);
  }
  assert.equal((await receiveGmailSync(request(snapshot([], '2026-10-17T18:59:00.000Z')), env, now)).status, 409);
  assert.equal((await receiveGmailSync(request(null, { body: 'x'.repeat(270000) }), env, now)).status, 413);
  assert.deepEqual(sql.prepare('SELECT * FROM gmail_sync_state').get(), last);
  assert.equal((await gmailRecords(db, new Date('2026-10-17T19:16:00.000Z'))).gmailSync.status, 'stale');
  assert.equal((await gmailRecords(db, new Date('2026-10-17T19:16:00.000Z'))).gmailSync.lastSuccessfulSyncAt, last.completed_at);
  sql.exec("CREATE TRIGGER reject_thread BEFORE INSERT ON gmail_threads BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.equal((await receiveGmailSync(request(snapshot([row()], '2026-10-17T19:00:03.000Z')), env, now)).status, 503);
  assert.deepEqual(sql.prepare('SELECT * FROM gmail_sync_state').get(), last);
});

test('complete empty scan retires unlabelled conversations; batches stay under free-tier query limits', async () => {
  const { env, db, sql } = database();
  assert.equal((await gmailRecords(db, now)).gmailSync.status, 'not_connected');
  const many = Array.from({ length: 200 }, (_, i) => ({ ...row(), threadId: (i + 1).toString(16) }));
  assert.equal((await receiveGmailSync(request(snapshot(many)), env, now)).status, 200);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM gmail_threads WHERE active=1').get().n, 200);
  assert.equal((await receiveGmailSync(request(snapshot([], '2026-10-17T19:00:01.000Z')), env, now)).status, 200);
  assert.equal((await gmailRecords(db, now)).items.length, 0);
});

test('existing database migrates without changing campaign decisions', () => {
  const sql = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  sql.exec(schema.slice(0, schema.indexOf('CREATE TABLE IF NOT EXISTS gmail_sync_state')).replace(',\n  gmail_thread_id TEXT', ''));
  sql.exec(readFileSync(new URL('./migrations/002-gmail-sync.sql', import.meta.url), 'utf8'));
  assert.equal(sql.prepare("SELECT count(*) AS n FROM pragma_table_info('campaign_items') WHERE name='gmail_thread_id'").get().n, 1);
});

function scriptContext({ drafts = false, failRead = false, responseCode = 200 } = {}) {
  const uploads = [];
  const triggers = [];
  const props = { SYNC_URL: 'https://sync.example.com/sync', SYNC_SECRET: secret, MAILBOX_EMAIL: mailbox };
  const context = vm.createContext({ console: { log() {} }, PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Gmail: { Users: { getProfile: () => ({ emailAddress: mailbox }), Labels: { list: () => ({ labels: [{ id: labelId, name: '0: JobHackAI / Track' }] }) },
      Threads: { list: (_me, options) => { assert.deepEqual(Array.from(options.labelIds), [labelId]); return { threads: [{ id: 'abc123' }] }; },
        get: (_me, _id, options) => { assert.equal(options.format, 'metadata'); if (failRead) throw new Error('Gmail unavailable'); return { id: _id, messages: [
          { id: 'aa1', internalDate: '1792256400000', labelIds: ['INBOX'], payload: { headers: [{ name: 'Subject', value: 'Hello' }] }, snippet: 'Incoming' },
          { id: 'aa2', internalDate: '1792261504000', labelIds: ['SENT'], payload: { headers: [{ name: 'From', value: mailbox }, { name: 'Subject', value: 'Hello' }] }, snippet: 'Sent reply' },
          ...(drafts ? [{ id: 'aa3', internalDate: '1792262504000', labelIds: ['DRAFT'], payload: {}, snippet: 'Draft must not count' }] : [])
        ] }; } } } },
    Utilities: { getUuid: randomUUID, Charset: { UTF_8: 'UTF-8' }, computeHmacSha256Signature: (body, key) => Array.from(createHmac('sha256', key).update(body).digest()) },
    UrlFetchApp: { fetch: (url, options) => { uploads.push({ url, ...options }); return { getResponseCode: () => responseCode }; } },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: () => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => triggers.push(n) }) }) }), deleteTrigger() {} },
  });
  vm.runInContext(readFileSync(new URL('./google-apps-script/Code.gs', import.meta.url), 'utf8'), context);
  return { context, uploads, triggers, props };
}

test('tracked snapshots merge verified outbound IDs without labels and deduplicate existing threads',()=>{
 const {context,uploads,props}=scriptContext();props.OUTREACH_CHECKS_ENABLED='true';
 const work={trackedThreadIds:['abc123','def999']};context.outreachPollWork=()=>work;
 let passed;context.syncOutreach=received=>{passed=received;};
 context.syncTrackedMail();const payload=JSON.parse(uploads[0].payload);
 assert.deepEqual(payload.threads.map(t=>t.threadId).sort(),['abc123','def999']);assert.equal(passed,work);
 assert.ok(payload.threads.every(t=>t.state==='waiting'));
});
test('malformed or oversized outbound tracking feed preserves the previous successful snapshot',()=>{
 for(const trackedThreadIds of [undefined,['not-a-native-id'],Array.from({length:201},(_,i)=>(1000+i).toString(16))]){
  const {context,uploads,props}=scriptContext();props.OUTREACH_CHECKS_ENABLED='true';context.outreachPollWork=()=>({trackedThreadIds});
  assert.throws(()=>context.syncTrackedMail(),/tracking feed|200 tracked/);assert.equal(uploads.length,0);
 }
});

test('Apps Script uses the exact label, ignores drafts, signs its metadata and installs a five-minute trigger', async () => {
  const { context, uploads, triggers } = scriptContext({ drafts: true });
  context.installGmailSync();
  assert.deepEqual(triggers, [5]);
  const payload = JSON.parse(uploads[0].payload);
  assert.equal(payload.threads[0].state, 'waiting');
  assert.equal(payload.threads[0].preview, 'Sent reply');
  assert.equal(uploads[0].followRedirects, false);
  assert.equal(uploads[0].headers['X-Sync-Signature'], createHmac('sha256', secret).update(`${uploads[0].headers['X-Sync-Timestamp']}.${uploads[0].payload}`).digest('hex'));
  const { env } = database();
  const result = await receiveGmailSync(new Request(uploads[0].url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...uploads[0].headers }, body: uploads[0].payload }), env);
  assert.equal(result.status, 200);
});

test('Apps Script never uploads a partial Gmail scan or installs a trigger after rejected setup', () => {
  const failed = scriptContext({ failRead: true });
  assert.throws(() => failed.context.installGmailSync(), /Gmail unavailable/);
  assert.equal(failed.uploads.length, 0);
  assert.equal(failed.triggers.length, 0);
  const rejected = scriptContext({ responseCode: 503 });
  assert.throws(() => rejected.context.installGmailSync(), /503/);
  assert.equal(rejected.triggers.length, 0);
});
