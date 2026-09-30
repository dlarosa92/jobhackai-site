import {inspectionSql,inspectReport,planReconciliation} from '../../../app/scripts/lib/account-operation-reconcile-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitAccountOperation,settleAccountOperation,beginDeletionAdmission,assertDeletionQuiescent} from '../../../app/functions/_lib/account-deletion-admission.js';
import { sqliteD1 } from '../../../app/functions/_lib/__tests__/sqlite-d1-helper.mjs';
import {pathToFileURL} from 'node:url';
const {runCleanup}=await import(process.env.JOBHACKAI_RETENTION_BUNDLE ? pathToFileURL(process.env.JOBHACKAI_RETENTION_BUNDLE) : new URL('../src/index.js',import.meta.url));
import { getVoiceEntitlement } from '../../../app/functions/_lib/voice-entitlements.js';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '../../../app/functions/_lib/billing-ownership.js';
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,plan TEXT,subscription_status TEXT,current_period_end TEXT,voice_sessions_remaining INTEGER,pack_expires_at TEXT,auth_id TEXT UNIQUE);
    INSERT INTO users VALUES(1,'free',NULL,NULL,0,NULL,'owner1'),(2,'monthly','active','2099-01-01',0,NULL,'owner2'),(3,'free',NULL,NULL,0,NULL,'owner3');
    CREATE TABLE linkedin_runs(id TEXT, is_pinned INTEGER,created_at INTEGER);
    INSERT INTO linkedin_runs VALUES('old',0,0),('pinned',1,0),('recent',0,9999999999999);
    CREATE TABLE resume_sessions(id TEXT,raw_text_location TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO resume_sessions VALUES('old','raw-old',datetime('now','-100 days'),datetime('now','-100 days')),
      ('reused','raw-reused',datetime('now','-100 days'),datetime('now','-2 days')),
      ('feedback','raw-feedback',datetime('now','-100 days'),datetime('now','-100 days'));
    CREATE TABLE feedback_sessions(id TEXT,resume_session_id TEXT,created_at TEXT);
    INSERT INTO feedback_sessions VALUES('old','old',datetime('now','-100 days')),('recent','feedback',datetime('now','-2 days'));
    CREATE TABLE interview_question_sets(id TEXT,created_at TEXT);
    INSERT INTO interview_question_sets VALUES('old',datetime('now','-100 days')),('recent',datetime('now','-2 days'));
    CREATE TABLE mock_interview_sessions(id TEXT,created_at TEXT);
    INSERT INTO mock_interview_sessions VALUES('old',datetime('now','-100 days'));
    CREATE TABLE cover_letter_history(id TEXT,created_at INTEGER);
    INSERT INTO cover_letter_history VALUES('old',0),('recent',9999999999999);
    CREATE TABLE usage_events(id TEXT,created_at TEXT);
    INSERT INTO usage_events VALUES('old',datetime('now','-100 days'));
    CREATE TABLE voice_sessions(id TEXT,user_id INTEGER,status TEXT,started_at TEXT,transcript_json TEXT,scorecard_json TEXT,updated_at TEXT,role TEXT,seniority TEXT,jd_excerpt TEXT);
    INSERT INTO voice_sessions VALUES
      ('free-old',1,'completed',datetime('now','-110 days'),'transcript','score',NULL,'Synthetic role','Senior','Synthetic confidential job context'),
      ('free-last',1,'completed',datetime('now','-100 days'),'transcript','score',NULL,'Synthetic role','Senior','Synthetic confidential job context'),
      ('free-incomplete',1,'active',datetime('now','-95 days'),'transcript',NULL,NULL,'Synthetic role','Senior','Synthetic confidential job context'),
      ('paid-old',2,'completed',datetime('now','-100 days'),'transcript','score',NULL,'Synthetic role','Senior','Synthetic confidential job context'),
      ('recent',3,'completed',datetime('now','-2 days'),'transcript','score',NULL,'Synthetic role','Senior','Synthetic confidential job context');
  `);
  db.exec('ALTER TABLE users ADD COLUMN voice_followup_email_sent_at TEXT; ALTER TABLE users ADD COLUMN deletion_warning_sent_at TEXT;');
  for(const name of ['024_collected_payments','025_checkout_attribution','026_payment_campaign_links','027_analytics_delivery','028_account_deletion_recovery'])
    db.exec(readFileSync(new URL('../../../app/db/migrations/'+name+'.sql',import.meta.url),'utf8'));
  db.exec("CREATE TABLE deleted_auth_ids(auth_id TEXT PRIMARY KEY);");
  for(const table of ['linkedin_runs','cover_letter_history']) db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT; UPDATE ${table} SET user_id='owner1';`);
  for(const table of ['resume_sessions','interview_question_sets','mock_interview_sessions','usage_events']) db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER; UPDATE ${table} SET user_id=1;`);
  const kv=[];const env={JOBHACKAI_DB:db,JOBHACKAI_KV:{delete:async key=>kv.push(key)}};
  const snapshot=async()=>{
    const out={};for(const name of ['users','linkedin_runs','resume_sessions','feedback_sessions','interview_question_sets','mock_interview_sessions','cover_letter_history','usage_events','voice_sessions'])
      out[name]=(await db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()).results;
    return out;
  };
  return {db,env,kv,snapshot};
}
test('default and invalid modes audit exact predicates without a D1 or KV mutation',async t=>{
  const f=setup(t);const before=await f.snapshot();
  const readsOnly={prepare(sql){assert.match(sql.trim(),/^(SELECT|PRAGMA)\b/);return f.db.prepare(sql);}};
  for(const mode of [undefined,'audit','DELETE','unexpected']) {
    const result=await runCleanup({...f.env,JOBHACKAI_DB:readsOnly,RETENTION_MODE:mode});
    assert.equal(result.mode,'audit');assert.equal(result.resume_sessions,1);assert.equal(result.resume_kv_sessions,1);
    assert.equal(result.kv_keys_would_delete,2);assert.equal(result.linkedin_runs,1);
    assert.equal(result.voice_sessions_stripped,1);assert.equal(result.voice_sessions,3);
  }
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual(f.kv,[]);
});
test('explicit deletion removes expired content but preserves pinned, reused and recent records',async t=>{
  const f=setup(t);const result=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(result.mode,'delete');assert.deepEqual(f.kv,['raw-old','resume:old']);
  const after=await f.snapshot();assert.deepEqual(after.resume_sessions.map(r=>r.id),['feedback','reused']);
  assert.deepEqual(after.linkedin_runs.map(r=>r.id),['pinned','recent']);
  assert.deepEqual(after.voice_sessions.map(r=>r.id),['free-last','recent']);
  assert.equal(after.voice_sessions[0].transcript_json,null);assert.equal(after.voice_sessions[0].scorecard_json,null);
  for(const key of ['role','seniority','jd_excerpt']) assert.equal(after.voice_sessions[0][key],null);
  assert.equal(after.voice_sessions[1].transcript_json,'transcript');
  assert.equal(after.voice_sessions[1].jd_excerpt,'Synthetic confidential job context');
  const again=await runCleanup({...f.env,RETENTION_MODE:'delete'});assert.equal(again.voice_sessions,0);assert.equal(again.voice_sessions_stripped,0);
});
test('KV failure retains resume references for retry rather than orphaning payloads',async t=>{
  const f=setup(t);await assert.rejects(runCleanup({...f.env,RETENTION_MODE:'delete',JOBHACKAI_KV:{delete:async()=>{throw Error('fixture failure');}}}),/references retained/);
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM resume_sessions').first('n'),3);
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM feedback_sessions').first('n'),2);
});
test('missing bindings or voice schema fail before deleting anything',async t=>{
  const f=setup(t);const before=await f.snapshot();
  await assert.rejects(runCleanup({...f.env,RETENTION_MODE:'delete',JOBHACKAI_KV:undefined}),/KV binding/);
  await assert.rejects(runCleanup({...f.env,JOBHACKAI_DB:undefined}),/database binding/);
  assert.deepEqual(await f.snapshot(),before);
  f.db.exec('DROP TABLE voice_sessions');
  await assert.rejects(runCleanup({...f.env,RETENTION_MODE:'delete'}),/Voice retention schema/);
  assert.deepEqual(f.kv,[]);assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM linkedin_runs').first('n'),3);
});
test('database failure rejects the cleanup rather than logging a successful completion',async t=>{
  const f=setup(t);f.db.exec('DROP TABLE linkedin_runs');
  await assert.rejects(runCleanup(f.env),/database operation failed/);assert.deepEqual(f.kv,[]);
});

test('previously stripped reports still lose surviving role and job context in audit and deletion',async t=>{
  const f=setup(t);
  f.db.exec("UPDATE voice_sessions SET transcript_json=NULL,scorecard_json=NULL WHERE id='free-last'");
  const before=await f.snapshot();
  assert.equal((await runCleanup(f.env)).voice_sessions_stripped,1);
  assert.deepEqual(await f.snapshot(),before);
  await runCleanup({...f.env,RETENTION_MODE:'delete'});
  const row=await f.db.prepare("SELECT * FROM voice_sessions WHERE id='free-last'").first();
  for(const key of ['transcript_json','scorecard_json','role','seniority','jd_excerpt']) assert.equal(row[key],null);
  assert.equal(row.status,'completed');
});

test('retention exception agrees with actual entitlement status, grace, null and pack rules',async t=>{
  const f=setup(t);
  f.db.exec("ALTER TABLE users ADD COLUMN free_session_used INTEGER DEFAULT 1; ALTER TABLE users ADD COLUMN has_ever_paid INTEGER DEFAULT 1;");
  const future=new Date(Date.now()+86400000).toISOString();
  const grace=new Date(Date.now()-86400000).toISOString();
  const expired=new Date(Date.now()-5*86400000).toISOString();
  const cases=[
    ...ENTITLED_SUBSCRIPTION_STATUSES.map(status=>['monthly',status,grace,0,null]),
    ['monthly','unpaid',expired,0,null],
    ['monthly',null,future,0,null],
    ['monthly','active','invalid',0,null],
    ['monthly','active','',0,null],
    ['free',null,null,1,future],
    ['free',null,null,1,expired],
    ['free',null,null,1,''],
    ['free',null,null,null,null]
  ];
  const expected=[];
  for(let i=0;i<cases.length;i++){
    const id=10+i,auth='fixture-'+id;
    await f.db.prepare('INSERT INTO users(id,auth_id,plan,subscription_status,current_period_end,voice_sessions_remaining,pack_expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,auth,...cases[i]).run();
    await f.db.prepare("INSERT INTO voice_sessions(id,user_id,status,started_at,transcript_json) VALUES(?,?,'completed',datetime('now','-100 days'),'private')").bind(auth,id).run();
    const access=await getVoiceEntitlement(f.env,auth);
    if(access.mode!=='subscription'&&access.mode!=='pack')expected.push(auth);
  }
  const audit=await runCleanup(f.env);
  assert.equal(audit.voice_sessions_stripped,1+expected.length);
  await runCleanup({...f.env,RETENTION_MODE:'delete'});
  const remaining=(await f.db.prepare("SELECT id,transcript_json FROM voice_sessions WHERE user_id>=10 ORDER BY user_id").all()).results;
  assert.deepEqual(remaining.map(row=>row.id),expected);
  assert.ok(remaining.every(row=>row.transcript_json===null));
});

test('maintenance protects payload cleanup from new writes and deletion while allowing another account to work',async t=>{
  const f=setup(t);let entered,release;
  const started=new Promise(r=>{entered=r;}),pause=new Promise(r=>{release=r;});
  const running=runCleanup({...f.env,RETENTION_MODE:'delete',JOBHACKAI_KV:{delete:async key=>{entered();await pause;f.kv.push(key);}}});
  await started;
  await assert.rejects(admitAccountOperation(f.env,'owner1'),/account_operation_busy/);
  const other=await admitAccountOperation(f.env,'owner2');await settleAccountOperation(f.env,other,'finished');
  await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner1'});
  await assert.rejects(assertDeletionQuiescent(f.env,'owner1'),/operations_pending/);
  release();await running;
  await assertDeletionQuiescent(f.env,'owner1');
  assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM resume_sessions WHERE id='old'").first('n'),0);
});

test('earlier operations, deletion intents and tombstones exclude the full account from retention',async t=>{
  for(const kind of ['operation','intent','tombstone']) {
    const f=setup(t);
    if(kind==='operation')await admitAccountOperation(f.env,'owner1');
    else if(kind==='intent')await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner1'});
    else f.db.exec("INSERT INTO deleted_auth_ids VALUES('owner1')");
    const result=await runCleanup({...f.env,RETENTION_MODE:'delete'});
    assert.equal(result.accounts,2);assert.deepEqual(f.kv,[]);
    assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM resume_sessions').first('n'),3);
    assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM linkedin_runs').first('n'),3);
    assert.equal(await f.db.prepare("SELECT transcript_json FROM voice_sessions WHERE id='free-last'").first('transcript_json'),'transcript');
    assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM voice_sessions WHERE id='paid-old'").first('n'),0);
  }
});

test('deletion between candidate selection and maintenance admission prevents all account cleanup',async t=>{
  const f=setup(t),prepare=f.db.prepare;let inserted=false;
  f.db.prepare=sql=>{
    const stmt=prepare(sql);
    if(sql.startsWith('INSERT INTO account_operation_claims')) {
      const run=stmt.run;
      stmt.run=async function(){if(!inserted){inserted=true;await beginDeletionAdmission(f.env,{origin:'user_request',uid:'owner1'});}return run.call(this);};
    }
    return stmt;
  };
  const result=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(result.accounts_skipped,1);assert.deepEqual(f.kv,[]);
  assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM resume_sessions').first('n'),3);
});

test('partial storage failure retains references, unfinished maintenance and the old cursor',async t=>{
  const f=setup(t);
  f.db.exec("INSERT INTO account_maintenance_cursors(name,last_user_id,revision) VALUES('retention',0,4)");
  let calls=0;
  await assert.rejects(runCleanup({...f.env,RETENTION_MODE:'delete',JOBHACKAI_KV:{delete:async()=>{if(++calls===2)throw Error('fixture failure');}}}),/references retained/);
  assert.equal(await f.db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='owner1'").first('state'),'uncertain');
  assert.deepEqual(await f.db.prepare('SELECT last_user_id,revision FROM account_maintenance_cursors').first(),{last_user_id:0,revision:4});
  assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM resume_sessions').first('n'),3);
  await assert.rejects(admitAccountOperation(f.env,'owner1'),/account_operation_busy/);
});

test('resume payload batches never delete references belonging to unprocessed rows',async t=>{
  const f=setup(t);
  for(let i=0;i<12;i++)await f.db.prepare("INSERT INTO resume_sessions(id,raw_text_location,user_id,created_at,updated_at) VALUES(?,?,1,datetime('now','-100 days'),datetime('now','-100 days'))").bind('extra'+i,'raw-extra'+i).run();
  const first=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(first.resume_sessions,10);assert.equal(first.resume_kv_sessions,10);assert.equal(first.resume_accounts_with_more_payloads,1);
  const remaining=(await f.db.prepare("SELECT raw_text_location FROM resume_sessions WHERE id NOT IN ('feedback','reused')").all()).results;
  assert.equal(remaining.length,3);assert.ok(remaining.every(row=>!f.kv.includes(row.raw_text_location)));
  const second=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(second.resume_sessions,3);assert.equal(second.resume_accounts_with_more_payloads,0);
});

test('bounded account pages advance a durable cursor, wrap, and expose a read-only audit cursor',async t=>{
  const f=setup(t);
  for(let id=4;id<=26;id++)await f.db.prepare('INSERT INTO users(id,auth_id,plan) VALUES(?,?,?)').bind(id,'owner'+id,'free').run();
  const first=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(first.accounts,25);assert.equal(first.next_user_id,25);
  assert.equal(await f.db.prepare('SELECT last_user_id FROM account_maintenance_cursors').first('last_user_id'),25);
  const audit=await runCleanup(f.env,{afterUserId:25});assert.equal(audit.accounts,1);assert.equal(audit.next_user_id,0);
  assert.equal(await f.db.prepare('SELECT last_user_id FROM account_maintenance_cursors').first('last_user_id'),25);
  const second=await runCleanup({...f.env,RETENTION_MODE:'delete'});
  assert.equal(second.accounts,1);assert.equal(second.next_user_id,0);
  await assert.rejects(runCleanup({...f.env,RETENTION_MODE:'delete'},{afterUserId:5}),/audit cursor invalid/);
});

test('a slower overlapping pass cannot overwrite a newer cursor revision',async t=>{
  const f=setup(t);f.db.exec("INSERT INTO account_maintenance_cursors VALUES('retention',0,1,datetime('now'))");
  let updated=false;
  const result=await runCleanup({...f.env,RETENTION_MODE:'delete',JOBHACKAI_KV:{delete:async()=>{
    if(!updated){updated=true;f.db.exec("UPDATE account_maintenance_cursors SET last_user_id=2,revision=2");}
  }}});
  assert.equal(result.cursor_advanced,false);
  assert.deepEqual(await f.db.prepare('SELECT last_user_id,revision FROM account_maintenance_cursors').first(),{last_user_id:2,revision:2});
});

test('real repository schemas preserve FK integrity and distinguish numeric owner IDs from Firebase UIDs',async t=>{
  const db=sqliteD1();t.after(()=>db.close());
  const sql=name=>readFileSync(new URL('../../../app/db/'+name,import.meta.url),'utf8');
  db.exec(sql('schema.sql'));db.exec(sql('migrations/006_linkedin_runs.sql'));db.exec(sql('migrations/028_account_deletion_recovery.sql'));
  const cover=readFileSync(new URL('../../../app/functions/api/cover-letter/generate.js',import.meta.url),'utf8');
  db.exec(cover.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
  db.exec(`INSERT INTO users(id,auth_id) VALUES(1,'owner1'),(2,'owner2');
    INSERT INTO resume_sessions(id,user_id,raw_text_location,created_at,updated_at) VALUES(1,1,'raw1',datetime('now','-100 days'),datetime('now','-100 days')),(2,2,'raw2',datetime('now','-100 days'),datetime('now','-100 days'));
    INSERT INTO feedback_sessions(resume_session_id,feedback_json,created_at) VALUES(1,'{}',datetime('now','-100 days')),(2,'{}',datetime('now','-100 days'));
    INSERT INTO linkedin_runs(id,user_id,created_at,updated_at,role,input_hash,request_id,input_json) VALUES('one','owner1',0,0,'r','h','req1','{}'),('two','owner2',0,0,'r','h','req2','{}');
    INSERT INTO cover_letter_history(id,user_id,created_at,updated_at,title,role,seniority,tone,job_description,cover_letter_text,input_hash) VALUES('one','owner1',0,0,'t','r','s','t','j','c','h'),('two','owner2',0,0,'t','r','s','t','j','c','h');`);
  const kv=[],env={JOBHACKAI_DB:db,JOBHACKAI_KV:{delete:async key=>kv.push(key)},RETENTION_MODE:'delete'};
  db.exec("INSERT INTO linkedin_runs(id,user_id,created_at,updated_at,role,input_hash,request_id,input_json) VALUES('unmapped','absent-owner',0,0,'r','h','req3','{}')");
  await beginDeletionAdmission(env,{origin:'user_request',uid:'owner2'});
  const result=await runCleanup(env);
  assert.equal(result.accounts,1);assert.deepEqual(kv,['raw1','resume:1']);
  assert.equal(result.unmapped_uid_rows,1);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM linkedin_runs').first('n'),2);
  for(const table of ['resume_sessions','feedback_sessions','cover_letter_history'])
    assert.equal(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first('n'),1);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('a reconciled stopped retention pass can retry partial KV cleanup through the actual worker',async t=>{
  const f=setup(t);f.env.RETENTION_MODE='delete';f.env.JOBHACKAI_KV.delete=async()=>{throw Error('fixture_partial_storage');};
  await assert.rejects(runCleanup(f.env));
  const claim=await f.db.prepare("SELECT * FROM account_operation_claims WHERE state='uncertain'").first();assert.equal(claim.purpose,'retention');
  const row=await f.db.prepare(inspectionSql(claim.id)).first(),now=Date.now(),report=inspectReport('qa',row,now);
  report.disposition='retry_storage';
  report.evidence={operatorRef:'fixture-operator',invocation:{status:'completed',executionToken:claim.id,observedAt:new Date(now).toISOString(),reference:'fixture/returned-invocation'},
    providers:{status:'storage_only',pendingRequests:false,observedAt:new Date(now).toISOString(),reference:'fixture/intercepted-provider'}};
  await f.db.prepare(planReconciliation(report,row,'qa',now).sql).run();

  f.env.JOBHACKAI_KV.delete=async key=>f.kv.push(key);await runCleanup(f.env);
  assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM resume_sessions WHERE id='old'").first('n'),0);
  assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM voice_sessions WHERE id='free-last'").first('n'),1);
  assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM account_operation_claims WHERE state<>'finished'").first('n'),0);
});
