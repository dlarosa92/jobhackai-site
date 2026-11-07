import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { targets, releaseTarget, migrations, planMigrations, verifyBindings } from './voice-release-preflight.mjs';

test('release rejects PRs, arbitrary refs, repository drift and invalid revisions', () => {
  const args = { event: 'push', ref: 'refs/heads/dev0', sha: 'a'.repeat(40), repository: 'dlarosa92/jobhackai-site' };
  assert.equal(releaseTarget(args).env, 'dev');
  for (const override of [{ event: 'pull_request' }, { ref: 'refs/heads/feature' }, { ref: 'refs/tags/main' }, { sha: 'main' }, { repository: 'other/repo' }]) {
    assert.throws(() => releaseTarget({ ...args, ...override }));
  }
  assert.equal(releaseTarget({ ...args, ref: 'refs/heads/develop' }).env, 'qa');
  assert.equal(releaseTarget({ ...args, ref: 'refs/heads/main' }).env, 'prod');
});

test('exact migrations preserve existing content and holds, then become a no-op', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); CREATE TABLE voice_interview_controls(session_id TEXT PRIMARY KEY, auth_id TEXT, created_at TEXT); CREATE TABLE voice_provider_calls(id TEXT PRIMARY KEY,state TEXT); INSERT INTO users VALUES(1,'fixture@example.test'); INSERT INTO voice_interview_controls VALUES('s','u','2026-11-01'); INSERT INTO voice_provider_calls VALUES('held','uncertain');");
  const inspect = () => ({ users: db.prepare('PRAGMA table_info(users)').all().map(r => r.name), voice_interview_controls: db.prepare('PRAGMA table_info(voice_interview_controls)').all().map(r => r.name), indexes: db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name) });
  assert.equal(planMigrations(inspect()).length, 2);
  for (const m of migrations) db.exec(readFileSync(new URL(`../app/db/migrations/${m.file}`, import.meta.url), 'utf8'));
  assert.deepEqual(planMigrations(inspect()), []);
  assert.equal(db.prepare('SELECT email FROM users').get().email, 'fixture@example.test');
  assert.equal(db.prepare('SELECT state FROM voice_provider_calls').get().state, 'uncertain');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_interview_controls').get().n, 1);
  assert.throws(() => db.exec("UPDATE voice_interview_controls SET audio_check_mode='invalid'"));
  db.close();
});

test('partial migrations and missing indexes stop for review', () => {
  const schema = { users: ['id','voice_grace_session_id'], voice_interview_controls: ['session_id'], indexes: [] };
  assert.throws(() => planMigrations(schema), /Partial/);
  assert.throws(() => planMigrations({ ...schema, users: ['id'], voice_interview_controls: ['session_id',...migrations[1].columns] }), /index/);
  assert.throws(() => planMigrations({ ...schema, users: [] }), /base table/);
});

test('environment drift, disabled scheduler and absent secret fail closed', () => {
  const target = targets.develop;
  const bindings = [{ name:'DB', type:'d1', id:target.database }, { name:'ENVIRONMENT',text:'qa' }, { name:'VOICE_DEADLINES',namespace_id:target.namespace,class_name:'VoiceDeadline' }, { name:'VOICE_DEADLINES_ENABLED',text:'true' }, { name:'OPENAI_API_KEY',type:'secret_text' }];
  assert.doesNotThrow(() => verifyBindings({ bindings },target));
  for (let index=0;index<bindings.length;index++) assert.throws(() => verifyBindings({ bindings:bindings.filter((_,i)=>i!==index) },target));
  assert.throws(() => verifyBindings({ bindings },targets.main));
  assert.doesNotThrow(() => verifyBindings({ bindings: [{ ...bindings[0],database_id:target.database },...bindings.slice(1)] },target));
  assert.throws(() => verifyBindings({ bindings: [{ ...bindings[0],database_id:targets.main.database },...bindings.slice(1)] },target));
});


test('actual CLI checks the current target and backup before any remote mutation', () => {
  for (const scenario of ['success','stale','partial','binding','backup','post-stale','wrong-account','missing-token']) {
    const dir = mkdtempSync(join(tmpdir(),'voice-release-test-'));
    try {
      for (const name of ['scripts','workers/voice-deadlines','app/db/migrations']) mkdirSync(join(dir,name),{recursive:true});
      copyFileSync(new URL('./voice-release-preflight.mjs',import.meta.url),join(dir,'scripts/voice-release-preflight.mjs'));
      copyFileSync(new URL('../workers/voice-deadlines/wrangler.jsonc',import.meta.url),join(dir,'workers/voice-deadlines/wrangler.jsonc'));
      for (const m of migrations) copyFileSync(new URL(`../app/db/migrations/${m.file}`,import.meta.url),join(dir,'app/db/migrations',m.file));
      writeFileSync(join(dir,'mock.mjs'), `
        import { appendFileSync,readFileSync } from 'node:fs';
        let applied=0, heads=0;
        const scenario=process.env.RELEASE_CASE;
        globalThis.fetch=async (url,options={})=>{
          const body=options.body?JSON.parse(options.body):null;
          let result;
          if(url.startsWith('https://api.github.com/')) {
            heads++;
            return Response.json({object:{sha:scenario==='stale'||(scenario==='post-stale'&&heads>1)?'b'.repeat(40):'a'.repeat(40)}});
          }
          if(url.endsWith('/settings')) result={bindings:[
            {name:'DB',type:'d1',id:scenario==='binding'?'wrong':'80d87a73-6615-4823-b7a4-19a8821b4f87'},
            {name:'ENVIRONMENT',text:'qa'},
            {name:'VOICE_DEADLINES',class_name:'VoiceDeadline',namespace_id:'0af6247a41cb45deaab5337d813d93e7'},
            {name:'VOICE_DEADLINES_ENABLED',text:'true'},
            {name:'OPENAI_API_KEY',type:'secret_text'}
          ]};
          else if(url.endsWith('/bookmark')) {
            appendFileSync(process.env.CALL_LOG,'bookmark\\n');
            result=scenario==='backup'?{}:{bookmark:'fixture-bookmark'};
          } else if(body?.sql.startsWith('SELECT')) result=[
            {success:true,results:['id',...(applied>=1?['voice_grace_session_id','voice_grace_used_at']:scenario==='partial'?['voice_grace_session_id']:[])].map(name=>({name}))},
            {success:true,results:['session_id',...(applied>=2?['audio_check_deadline_at','audio_ready_at','audio_check_mode']:[])].map(name=>({name}))},
            {success:true,results:applied>=2?[{name:'idx_voice_audio_check_rate'}]:[]}
          ];
          else if(body?.sql.includes('ALTER TABLE')) {
            const receipt=JSON.parse(readFileSync(process.env.RECEIPT,'utf8'));
            if(receipt.recoveryBookmark!=='fixture-bookmark') throw Error('No persisted backup before mutation');
            applied++;appendFileSync(process.env.CALL_LOG,'mutation\\n');result=[{success:true,results:[]}];
          } else throw Error('Unexpected request');
          return Response.json({success:true,result});
        };
      `);
      const log=join(dir,'calls.log');writeFileSync(log,'');
      const result=spawnSync(process.execPath,['--import',join(dir,'mock.mjs'),join(dir,'scripts/voice-release-preflight.mjs'),'--apply-schema'],{
        encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/develop',GITHUB_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'dlarosa92/jobhackai-site',GITHUB_TOKEN:'fixture',CLOUDFLARE_API_TOKEN:scenario==='missing-token'?'':'fixture',CLOUDFLARE_ACCOUNT_ID:scenario==='wrong-account'?'other':'fabf4409ef32f8c64354a1a099bef2a2',RELEASE_CASE:scenario,CALL_LOG:log,RECEIPT:join(dir,'voice-release-receipt.json')}
      });
      const calls=readFileSync(log,'utf8');
      if(scenario==='success') {
        assert.equal(result.status,0,result.stderr);
        assert.equal((calls.match(/mutation/g)||[]).length,2);
        assert.ok(calls.indexOf('bookmark')<calls.indexOf('mutation'));
      } else {
        assert.notEqual(result.status,0,scenario);
        assert.equal(calls.includes('mutation'),false,scenario);
      }
    } finally {rmSync(dir,{recursive:true,force:true});}
  }
});
