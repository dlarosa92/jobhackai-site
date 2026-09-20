import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from '../../../app/functions/_lib/__tests__/sqlite-d1-helper.mjs';
import { runCleanup } from '../src/index.js';
function setup(t) {
  const db=sqliteD1();t.after(()=>db.close());
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,plan TEXT,subscription_status TEXT,current_period_end TEXT,voice_sessions_remaining INTEGER,pack_expires_at TEXT);
    INSERT INTO users VALUES(1,'free',NULL,NULL,0,NULL),(2,'monthly','active','2099-01-01',0,NULL),(3,'free',NULL,NULL,0,NULL);
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
    CREATE TABLE voice_sessions(id TEXT,user_id INTEGER,status TEXT,started_at TEXT,transcript_json TEXT,scorecard_json TEXT,updated_at TEXT);
    INSERT INTO voice_sessions VALUES
      ('free-old',1,'completed',datetime('now','-110 days'),'transcript','score',NULL),
      ('free-last',1,'completed',datetime('now','-100 days'),'transcript','score',NULL),
      ('free-incomplete',1,'active',datetime('now','-95 days'),'transcript',NULL,NULL),
      ('paid-old',2,'completed',datetime('now','-100 days'),'transcript','score',NULL),
      ('recent',3,'completed',datetime('now','-2 days'),'transcript','score',NULL);
  `);
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
  assert.equal(after.voice_sessions[1].transcript_json,'transcript');
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
