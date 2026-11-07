// Early-end grace: a candidate who ends a free or pack session within the
// first 2 minutes gets the credit back, once per account.
// Run: node --test app/functions/_lib/__tests__/voice-early-end-grace.test.mjs
//
// Real SQLite with the real voice migrations, including the unapplied 033.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { restoreEarlyEndCredit, EARLY_END_GRACE_SECONDS } from '../voice-entitlements.js';

const migration = name => readFileSync(new URL('../../../db/migrations/' + name, import.meta.url), 'utf8');

function setup(t, { migrated = true } = {}) {
  const db = sqliteD1();
  t.after(() => db.close());
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT, plan TEXT, updated_at TEXT); INSERT INTO users(id,auth_id) VALUES (1,'owner'),(2,'other');");
  for (const name of ['020_add_voice_entitlements.sql', '021_add_voice_end_reason.sql']) db.exec(migration(name));
  if (migrated) db.exec(migration('033_voice_early_end_grace.sql'));
  const env = { DB: db };
  return {
    db, env,
    // A completed session that lasted `seconds` by the server's clock.
    session(id, { user = 1, mode = 'free', reason = 'user_ended', seconds = 90, status = 'completed' } = {}) {
      db.exec(`INSERT INTO voice_sessions(id,user_id,status,entitlement_mode,end_reason,started_at,ended_at)
        VALUES ('${id}',${user},'${status}','${mode}','${reason}',datetime('now','-${seconds} seconds'),datetime('now'))`);
    },
    user: async (id = 1) => db.prepare('SELECT * FROM users WHERE id=?').bind(id).first(),
    restore: (sessionId, userRowId = 1) => restoreEarlyEndCredit(env, { userRowId, sessionId })
  };
}

test('the grace window is 2 minutes of interview plus time to connect', () => {
  assert.equal(EARLY_END_GRACE_SECONDS, 150);
});

test('a free session ended early gives the free interview back and records the grace', async t => {
  const h = setup(t);
  await h.db.prepare('UPDATE users SET free_session_used=1 WHERE id=1').run();
  h.session('s1', { seconds: 90 });
  assert.equal(await h.restore('s1'), true);
  const user = await h.user();
  assert.equal(user.free_session_used, 0);
  assert.equal(user.voice_grace_session_id, 's1');
  assert.ok(user.voice_grace_used_at);
});

test('the grace applies once per account', async t => {
  const h = setup(t);
  await h.db.prepare('UPDATE users SET free_session_used=1 WHERE id=1').run();
  h.session('s1', { seconds: 60 });
  assert.equal(await h.restore('s1'), true);
  // The restored free interview is used again and also ended early.
  await h.db.prepare('UPDATE users SET free_session_used=1 WHERE id=1').run();
  h.session('s2', { seconds: 30 });
  assert.equal(await h.restore('s2'), false);
  const user = await h.user();
  assert.equal(user.free_session_used, 1, 'the second early end keeps its credit');
  assert.equal(user.voice_grace_session_id, 's1');
});

test('repeating the restore for the same session is idempotent', async t => {
  const h = setup(t);
  await h.db.prepare("UPDATE users SET voice_sessions_remaining=2 WHERE id=1").run();
  h.session('p1', { mode: 'pack', seconds: 100 });
  assert.equal(await h.restore('p1'), true);
  assert.equal(await h.restore('p1'), true, 'a retried completion still reports the restore');
  assert.equal((await h.user()).voice_sessions_remaining, 3, 'the pack credit comes back exactly once');
});

for (const [label, options] of [
  ['past the grace window', { seconds: EARLY_END_GRACE_SECONDS + 30 }],
  ['ended by the time limit', { reason: 'time_up' }],
  ['completed naturally', { reason: 'completed' }],
  ['lost connection', { reason: 'connection_lost' }],
  ['ended by the interviewer', { reason: 'ended_by_interviewer' }],
  ['not completed yet', { status: 'active' }]
]) {
  test(`no grace for a session ${label}`, async t => {
    const h = setup(t);
    await h.db.prepare('UPDATE users SET free_session_used=1 WHERE id=1').run();
    h.session('s1', options);
    assert.equal(await h.restore('s1'), false);
    const user = await h.user();
    assert.equal(user.free_session_used, 1);
    assert.equal(user.voice_grace_session_id, null, 'the grace stays available');
  });
}

test('a subscription session never uses the grace', async t => {
  const h = setup(t);
  h.session('sub1', { mode: 'subscription', seconds: 40 });
  assert.equal(await h.restore('sub1'), false);
  assert.equal((await h.user()).voice_grace_session_id, null);
});

test("another account's session cannot claim this account's grace", async t => {
  const h = setup(t);
  await h.db.prepare('UPDATE users SET free_session_used=1').run();
  h.session('theirs', { user: 2, seconds: 30 });
  assert.equal(await h.restore('theirs', 1), false);
  assert.equal((await h.user(1)).voice_grace_session_id, null);
  assert.equal((await h.user(2)).free_session_used, 1);
});

test('before migration 033 every session keeps its credit and nothing throws', async t => {
  const h = setup(t, { migrated: false });
  await h.db.prepare('UPDATE users SET free_session_used=1 WHERE id=1').run();
  h.session('s1', { seconds: 30 });
  assert.equal(await h.restore('s1'), false);
  assert.equal((await h.user()).free_session_used, 1);
});

for (const [seconds,expected] of [[150,true],[151,false]]) {
  test('the exact server cutoff is inclusive at '+seconds+' seconds',async t=>{
    const h=setup(t);
    h.db.exec("UPDATE users SET free_session_used=1 WHERE id=1");
    h.session('boundary');
    // This start second produces 150.000031s with julianday floating math.
    await h.db.prepare("UPDATE voice_sessions SET started_at='2026-10-24 12:00:03',ended_at=datetime('2026-10-24 12:00:03',?) WHERE id='boundary'")
      .bind('+'+seconds+' seconds').run();
    assert.equal(await h.restore('boundary'),expected);
  });
}
