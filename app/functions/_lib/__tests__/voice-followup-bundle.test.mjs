import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const bundle = process.env.JOBHACKAI_FOLLOWUP_BUNDLE;
assert.ok(bundle, 'Build the follow-up Worker and set JOBHACKAI_FOLLOWUP_BUNDLE');
const worker = (await import(pathToFileURL(bundle))).default;

test('compiled hourly Worker suppresses deleted users and keeps an admitted send active until receipt', async t => {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users(id,auth_id,email,plan,free_session_used) VALUES
    (1,'eligible','eligible@example.test','free',1),(2,'deleting','deleting@example.test','free',1);
    INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,ended_at) VALUES
    ('one',1,'completed','free',datetime('now','-49 hours')),('two',2,'completed','free',datetime('now','-49 hours'));
    INSERT INTO account_deletion_admissions(id,auth_id) VALUES('intent','deleting');`);
  const env = { JOBHACKAI_DB: db, RESEND_API_KEY: 'fixture-only', ENVIRONMENT: 'qa', FRONTEND_URL: 'https://qa.jobhackai.io', VOICE_INTERVIEW_ENABLED: 'true' };
  const originalFetch = globalThis.fetch; let calls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); calls++;
    assert.deepEqual(JSON.parse(options.body).to, ['eligible@example.test']);
    assert.equal(await db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='eligible'").first('state'), 'active');
    return Response.json({ id: 'fixture-receipt' });
  };
  await worker.scheduled({}, env, {});
  await worker.scheduled({}, env, {});
  assert.equal(calls, 1);
  assert.equal(await db.prepare("SELECT state FROM account_operation_claims WHERE auth_id='eligible'").first('state'), 'finished');
  assert.equal(await db.prepare("SELECT voice_followup_email_sent_at FROM users WHERE auth_id='deleting'").first('voice_followup_email_sent_at'), null);
});
