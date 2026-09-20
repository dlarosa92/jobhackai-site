import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { getOrCreateUserByAuthId } from '../db.js';
import { admitAccountOperation, beginDeletionAdmission, assertDeletionQuiescent, settleAccountOperation } from '../account-deletion-admission.js';

function setup(t, { legacy = false } = {}) {
  const db = sqliteD1(); t.after(() => db.close());
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, auth_id TEXT UNIQUE NOT NULL, email TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    ${legacy ? '' : ", plan TEXT DEFAULT 'free', last_login_at TEXT, deletion_warning_sent_at TEXT"}
  ); CREATE TABLE deleted_auth_ids(auth_id TEXT PRIMARY KEY, email TEXT, deleted_at TEXT);`);
  db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql', import.meta.url), 'utf8'));
  return { db, env: { JOBHACKAI_DB: db } };
}

// Pause AFTER the real missing-row read, before the actual INSERT executes.
// This reproduces the dangerous interleaving instead of only testing a
// deletion marker that already existed before the request began.
function afterAbsentRead(f, action) {
  let ran = false;
  const original = f.db.prepare.bind(f.db);
  f.env.JOBHACKAI_DB = { ...f.db, prepare(sql) {
    const statement = original(sql);
    if (!sql.startsWith('SELECT id, auth_id, email')) return statement;
    return { ...statement, bind(...args) {
      const bound = statement.bind(...args);
      return { ...bound, async first() {
        const row = await bound.first();
        if (!row && !ran) { ran = true; await action(); }
        return row;
      } };
    } };
  } };
  return () => assert.equal(ran, true, 'fixture reached the actual read/insert gap');
}

test('deletion intent between missing-row read and insert prevents account recreation', async t => {
  const f = setup(t);
  const checked = afterAbsentRead(f, () => beginDeletionAdmission(f.env, { uid: 'owner' }));
  await assert.rejects(getOrCreateUserByAuthId(f.env, 'owner', 'owner@example.test'), /account_creation_blocked_by_deletion/);
  checked();
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
  assert.ok(await assertDeletionQuiescent(f.env, 'owner'));
});

test('legacy tombstone arriving in the same gap also blocks recreation without a new intent', async t => {
  const f = setup(t);
  const checked = afterAbsentRead(f, () => f.db.prepare('INSERT INTO deleted_auth_ids(auth_id) VALUES(?)').bind('owner').run());
  await assert.rejects(getOrCreateUserByAuthId(f.env, 'owner'), /account_creation_blocked_by_deletion/);
  checked();
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
});

test('completed deletion receipt blocks recreation even after a tombstone has been removed', async t => {
  const f = setup(t);
  await beginDeletionAdmission(f.env, { uid: 'owner' });
  f.db.exec("UPDATE account_deletion_admissions SET state='complete',email=NULL");
  await assert.rejects(getOrCreateUserByAuthId(f.env, 'owner'), /account_creation_blocked_by_deletion/);
  const other = await getOrCreateUserByAuthId(f.env, 'other', 'other@example.test');
  assert.equal(other.auth_id, 'other');
});

test('creation admitted first succeeds but its active operation still holds deletion', async t => {
  const f = setup(t);
  const claim = await admitAccountOperation(f.env, 'owner');
  const user = await getOrCreateUserByAuthId(f.env, 'owner', 'owner@example.test');
  assert.equal(user.auth_id, 'owner');
  await beginDeletionAdmission(f.env, { uid: 'owner' });
  await assert.rejects(assertDeletionQuiescent(f.env, 'owner'), /operations_pending/);
  await settleAccountOperation(f.env, claim, 'finished');
  assert.ok(await assertDeletionQuiescent(f.env, 'owner'));
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 1);
});

test('missing guard tables fail closed without creating a user', async t => {
  for (const table of ['account_deletion_admissions', 'deleted_auth_ids']) {
    const f = setup(t); f.db.exec(`DROP TABLE ${table}`);
    await assert.rejects(getOrCreateUserByAuthId(f.env, 'owner'), /no such table/);
    assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
  }
});

test('legacy users schema fallback preserves both atomic guards', async t => {
  const f = setup(t, { legacy: true });
  await beginDeletionAdmission(f.env, { uid: 'pending' });
  f.db.exec("INSERT INTO deleted_auth_ids(auth_id) VALUES('deleted')");
  for (const uid of ['pending', 'deleted']) {
    await assert.rejects(getOrCreateUserByAuthId(f.env, uid), /account_creation_blocked_by_deletion/);
  }
  const user = await getOrCreateUserByAuthId(f.env, 'other');
  assert.equal(user.auth_id, 'other'); assert.equal(user.plan, 'free');
});
