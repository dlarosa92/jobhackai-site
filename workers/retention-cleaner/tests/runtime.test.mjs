import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI supplies the same pinned tooling used to compile the Worker. No Cloudflare
// config, credentials, existing databases or remote bindings enter this test.
const bundle = process.env.JOBHACKAI_RETENTION_BUNDLE;
const runtime = process.env.JOBHACKAI_MINIFLARE_MODULE;
assert.ok(bundle && runtime, 'Set JOBHACKAI_RETENTION_BUNDLE and JOBHACKAI_MINIFLARE_MODULE; see the retention README.');
const require = createRequire(import.meta.url);
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require(resolve(runtime));
const root = fileURLToPath(new URL('../../../', import.meta.url));

async function execute(db, sql) {
  // SQLite handles trigger bodies and quoted semicolons in repository schemas.
  const statements = JSON.parse(execFileSync('python3', ['-c', `import sys,sqlite3,json
text=sys.stdin.read(); parts=[]; current=''
for char in text:
 current+=char
 if char==';' and sqlite3.complete_statement(current):
  parts.append(current.strip()); current=''
if current.strip(): parts.append(current.strip())
print(json.dumps(parts))`], { input: sql, encoding: 'utf8' }));
  for (const statement of statements) await db.prepare(statement).run();
}

test('scheduled workerd cleanup preserves audit, owner holds and retained exceptions across actual D1/KV', { timeout: 60_000 }, async () => {
  const persist = mkdtempSync(join(tmpdir(), 'jobhackai-retention-runtime-'));
  const options = mode => convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve(bundle),
    // The build may live outside the checkout, including in the CI temp folder.
    modulesRoot: dirname(resolve(bundle)),
    compatibilityDate: '2024-12-11',
    host: '127.0.0.1',
    cf: false,
    log: new Log(LogLevel.ERROR),
    d1Databases: { JOBHACKAI_DB: 'synthetic-retention-db' },
    kvNamespaces: { JOBHACKAI_KV: 'synthetic-retention-kv' },
    resourcePersistencePath: persist,
    bindings: { ENVIRONMENT: 'qa', RETENTION_MODE: mode }
  });
  let mf;
  try {
    mf = new Miniflare(options('audit'));
    let db = await mf.getD1Database('JOBHACKAI_DB');
    for (const name of ['schema.sql', 'migrations/006_linkedin_runs.sql', 'migrations/009_role_templates.sql', 'migrations/028_account_deletion_recovery.sql']) {
      await execute(db, readFileSync(join(root, 'app/db', name), 'utf8'));
    }
    const cover = readFileSync(join(root, 'app/functions/api/cover-letter/generate.js'), 'utf8');
    await execute(db, cover.match(/`(CREATE TABLE IF NOT EXISTS cover_letter_history[\s\S]+?)`/)[1]);
    await execute(db, `
      INSERT INTO users(id,auth_id,plan,subscription_status,current_period_end) VALUES
        (1,'synthetic-free','free',NULL,NULL),
        (2,'synthetic-paid','monthly','active','2099-01-01'),
        (3,'synthetic-recent','free',NULL,NULL),
        (4,'synthetic-held','free',NULL,NULL);
      INSERT INTO account_operation_claims(id,auth_id,kind,purpose,state,updated_at)
        VALUES('synthetic-hold','synthetic-held','account','api','uncertain',datetime('now','-100 days'));
      INSERT INTO resume_sessions(id,user_id,raw_text_location,created_at,updated_at) VALUES
        (1,1,'synthetic-raw',datetime('now','-100 days'),datetime('now','-100 days')),
        (2,3,'synthetic-reused',datetime('now','-100 days'),datetime('now','-2 days'));
      INSERT INTO first_resume_snapshots(user_id,resume_session_id,snapshot_json,created_at) VALUES
        (1,999,'old snapshot',datetime('now','-100 days')),
        (3,998,'recent snapshot',datetime('now','-2 days'));
      INSERT INTO role_usage_log(user_id,role_label,role_family,created_at) VALUES
        ('synthetic-free','old role','software',datetime('now','-100 days')),
        ('synthetic-recent','recent role','software',datetime('now','-2 days')),
        ('synthetic-held','held role','software',datetime('now','-100 days'));
      INSERT INTO linkedin_runs(id,user_id,created_at,updated_at,role,input_hash,request_id,input_json,is_pinned)
        VALUES('pinned','synthetic-free',0,0,'role','hash','req','{}',1);
      INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,role,seniority,jd_excerpt,transcript_json,scorecard_json,started_at) VALUES
        ('free-old',1,'completed','free','old role','Senior','private context','private transcript','private feedback',datetime('now','-110 days')),
        ('free-last',1,'completed','free','old role','Senior','private context','private transcript','private feedback',datetime('now','-100 days')),
        ('paid-old',2,'completed','subscription','old role','Senior','private context','private transcript','private feedback',datetime('now','-100 days')),
        ('recent',3,'completed','free','recent role','Senior','recent context','recent transcript','recent feedback',datetime('now','-2 days')),
        ('held',4,'completed','free','held role','Senior','held context','held transcript','held feedback',datetime('now','-100 days'));
    `);
    let kv = await mf.getKVNamespace('JOBHACKAI_KV');
    const payloads = { 'synthetic-raw': 'old resume', 'resume:1': 'old cache', 'synthetic-reused': 'reused resume', 'resume:2': 'reused cache' };
    for (const [key, value] of Object.entries(payloads)) await kv.put(key, value);
    const snapshot = async () => {
      const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
      const rows = {};
      for (const { name } of tables) rows[name] = (await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
      return rows;
    };
    const before = await snapshot();
    assert.equal((await (await mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
    assert.deepEqual(await snapshot(), before, 'audit must not mutate content, claims or cursors');
    for (const [key, value] of Object.entries(payloads)) assert.equal(await kv.get(key), value);

    await mf.dispose();
    mf = new Miniflare(options('delete'));
    db = await mf.getD1Database('JOBHACKAI_DB');
    kv = await mf.getKVNamespace('JOBHACKAI_KV');
    assert.equal((await (await mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
    assert.deepEqual((await db.prepare('SELECT id FROM voice_sessions ORDER BY id').all()).results.map(row => row.id), ['free-last', 'held', 'recent']);
    const expired = await db.prepare("SELECT role,seniority,jd_excerpt,transcript_json,scorecard_json FROM voice_sessions WHERE id='free-last'").first();
    assert.ok(Object.values(expired).every(value => value === null));
    assert.equal(await db.prepare("SELECT transcript_json FROM voice_sessions WHERE id='recent'").first('transcript_json'), 'recent transcript');
    assert.equal(await db.prepare("SELECT transcript_json FROM voice_sessions WHERE id='held'").first('transcript_json'), 'held transcript');
    assert.equal(await db.prepare("SELECT state FROM account_operation_claims WHERE id='synthetic-hold'").first('state'), 'uncertain');
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM first_resume_snapshots').first('n'), 1);
    assert.deepEqual((await db.prepare('SELECT role_label FROM role_usage_log ORDER BY id').all()).results.map(row => row.role_label), ['recent role', 'held role']);
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM linkedin_runs').first('n'), 1);
    assert.deepEqual((await db.prepare('SELECT id FROM resume_sessions').all()).results, [{ id: 2 }]);
    for (const key of ['synthetic-raw', 'resume:1']) assert.equal(await kv.get(key), null);
    for (const key of ['synthetic-reused', 'resume:2']) assert.equal(await kv.get(key), payloads[key]);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);

    const after = await snapshot();
    assert.equal((await (await mf.getWorker()).scheduled({ cron: '0 * * * *' })).outcome, 'ok');
    const repeated = await snapshot();
    for (const table of ['voice_sessions', 'resume_sessions', 'first_resume_snapshots', 'role_usage_log', 'linkedin_runs']) {
      assert.deepEqual(repeated[table], after[table], `rerun must preserve ${table}`);
    }
  } finally {
    await mf?.dispose();
    rmSync(persist, { recursive: true, force: true });
  }
});
