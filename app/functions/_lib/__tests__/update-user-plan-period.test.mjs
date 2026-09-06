// updateUserPlan + buildUserPlanUpdateStatement: current_period_start
// handling, pre-migration column probe, UNIQUE-violation marker, and the
// paid-tier read path (getUserPlanData).
import assert from 'node:assert';
import { updateUserPlan, getUserPlanData, buildUserPlanUpdateStatement } from '../db.js';
import { createFakeD1, createFakeKV } from './billing-test-helper.mjs';

const baseUser = () => ({
  id: 1, auth_id: 'uid_A', email: 'a@example.com', plan: 'free',
  stripe_customer_id: null, stripe_subscription_id: null,
  subscription_status: null, trial_ends_at: null,
  current_period_start: null, current_period_end: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 0, plan_updated_at: '2026-01-01T00:00:00.000Z'
});

// 1. Both period columns are written; paid plan auto-marks has_ever_paid.
{
  const db = createFakeD1({ users: [baseUser()] });
  const env = { DB: db, JOBHACKAI_KV: createFakeKV() };
  const ok = await updateUserPlan(env, 'uid_A', {
    plan: 'essential',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    subscriptionStatus: 'active',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z'
  });
  assert.strictEqual(ok, true);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'essential');
  assert.strictEqual(row.current_period_start, '2026-08-01T00:00:00.000Z');
  assert.strictEqual(row.current_period_end, '2026-09-01T00:00:00.000Z');
  assert.strictEqual(row.has_ever_paid, 1);
}

// 2. null clears the period columns; undefined leaves them untouched.
{
  const db = createFakeD1({ users: [{ ...baseUser(), current_period_start: 'X', current_period_end: 'Y' }] });
  const env = { DB: db };
  await updateUserPlan(env, 'uid_A', { plan: 'free', currentPeriodStart: null, currentPeriodEnd: null });
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.current_period_start, null);
  assert.strictEqual(row.current_period_end, null);

  await updateUserPlan(env, 'uid_A', { subscriptionStatus: 'canceled' });
  assert.strictEqual(db.usersByAuthId('uid_A').current_period_start, null, 'undefined must not touch the column');
}

// 3. Pre-migration compatibility: when the probe reports no such column,
//    the write proceeds without current_period_start instead of failing.
{
  const db = createFakeD1({ users: [baseUser()] });
  const env = { DB: db };
  db.failNext('SELECT current_period_start FROM users LIMIT 1', new Error('no such column: current_period_start'));
  const ok = await updateUserPlan(env, 'uid_A', { plan: 'pro', currentPeriodStart: '2026-08-01T00:00:00.000Z' });
  assert.strictEqual(ok, true);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'pro');
  assert.strictEqual(row.current_period_start, null, 'column skipped when migration 022 has not run');
}

// 4. UNIQUE violation (migration 023 indexes) → false + distinct marker.
{
  const db = createFakeD1({
    users: [
      { ...baseUser() },
      { ...baseUser(), id: 2, auth_id: 'uid_B', stripe_subscription_id: 'sub_taken' }
    ],
    enforceUniqueStripeIds: true
  });
  const env = { DB: db };
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const ok = await updateUserPlan(env, 'uid_A', { plan: 'pro', stripeSubscriptionId: 'sub_taken' });
  console.error = realError;
  assert.strictEqual(ok, false, 'write must be refused by the unique index');
  assert.ok(errors.some((e) => e.includes('unique-conflict') && e.includes('stripe_subscription_id')),
    `distinct unique-conflict marker expected, got: ${errors.join(' | ')}`);
  assert.strictEqual(db.usersByAuthId('uid_A').stripe_subscription_id, null, 'row unchanged');
}

// 5. Missing user row → false, no write (never auto-creates).
{
  const db = createFakeD1({ users: [] });
  const ok = await updateUserPlan({ DB: db }, 'uid_missing', { plan: 'pro' });
  assert.strictEqual(ok, false);
  assert.strictEqual(db.__state.writes, 0);
}

// 6. buildUserPlanUpdateStatement mirrors the same semantics for batches.
{
  const db = createFakeD1({ users: [baseUser()] });
  const stmt = buildUserPlanUpdateStatement(db, 'uid_A', {
    plan: 'premium',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: null,
    planEventTimestamp: '2026-08-15T12:00:00.000Z'
  });
  assert.ok(stmt, 'statement expected');
  await db.batch([stmt]);
  const row = db.usersByAuthId('uid_A');
  assert.strictEqual(row.plan, 'premium');
  assert.strictEqual(row.current_period_start, '2026-08-01T00:00:00.000Z');
  assert.strictEqual(row.current_period_end, null);
  assert.strictEqual(row.plan_updated_at, '2026-08-15T12:00:00.000Z');
  assert.strictEqual(row.has_ever_paid, 1, 'paid plan auto-marks');

  assert.strictEqual(buildUserPlanUpdateStatement(db, 'uid_A', {}), null, 'nothing to write → null');
  assert.strictEqual(buildUserPlanUpdateStatement(null, 'uid_A', { plan: 'pro' }), null);
}

// 7. Read path: a paid subscriber reads back their paid tier (test #18).
{
  const db = createFakeD1({ users: [{
    ...baseUser(), plan: 'pro', subscription_status: 'active',
    stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
    current_period_end: '2026-09-01T00:00:00.000Z'
  }] });
  const data = await getUserPlanData({ DB: db }, 'uid_A');
  assert.strictEqual(data.plan, 'pro');
  assert.strictEqual(data.subscriptionStatus, 'active');
  assert.strictEqual(data.stripeSubscriptionId, 'sub_1');
}

// 8. Read path: a repaired row (free, no ids) never reports a paid plan (test #17).
{
  const db = createFakeD1({ users: [baseUser()] });
  const data = await getUserPlanData({ DB: db }, 'uid_A');
  assert.strictEqual(data.plan, 'free');
  assert.strictEqual(data.stripeSubscriptionId, null);
}

console.log('update-user-plan-period.test.mjs: all assertions passed');
