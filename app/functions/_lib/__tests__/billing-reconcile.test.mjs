// Reconciliation core (app/scripts/lib/billing-reconcile-core.mjs):
// classification, duplicate detection, allowlist drift aborts, apply-SQL
// generation (audit-first, no DELETEs, strict value validation), rollback
// SQL, and zero-write preflight semantics.
import assert from 'node:assert';
import {
  classifyRow,
  classifyAll,
  duplicateGroups,
  compareToAllowlist,
  buildApplySql,
  buildRollbackSql,
  assertSafeStripeId,
  assertSafeRunId,
  sqlValue,
  kvKeysForUid
} from '../../../scripts/lib/billing-reconcile-core.mjs';

const row = (over = {}) => ({
  id: 1, auth_id: 'uid_A', plan: 'essential', subscription_status: 'active',
  stripe_customer_id: 'cus_A1234', stripe_subscription_id: 'sub_A1234',
  current_period_start: null, current_period_end: null, trial_ends_at: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 1, plan_updated_at: '2026-01-01T00:00:00.000Z', ...over
});

// ── classifyRow matrix ──
assert.strictEqual(classifyRow(row({ plan: 'free', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null, has_ever_paid: 0 }), {}).class, 'FREE_CLEAN');

// LEGIT: live active sub + owned customer + matching linkage.
assert.strictEqual(classifyRow(row(), {
  subscription: { found: true, status: 'active', customerId: 'cus_A1234' },
  customer: { found: true, deleted: false, firebaseUid: 'uid_A' }
}).class, 'LEGIT');

// INVALID_TEST: live 404 with the test-mode hint, unowned customer.
assert.strictEqual(classifyRow(row(), {
  subscription: { found: false, testModeHint: true },
  customer: { found: false, testModeHint: true }
}).class, 'INVALID_TEST');

// NOT_FOUND_LIVE: live 404 without the hint.
assert.strictEqual(classifyRow(row(), {
  subscription: { found: false, testModeHint: false },
  customer: { found: false, testModeHint: false }
}).class, 'NOT_FOUND_LIVE');

// MIXED: owned live customer, invalid subscription.
assert.strictEqual(classifyRow(row(), {
  subscription: { found: false, testModeHint: true },
  customer: { found: true, deleted: false, firebaseUid: 'uid_A' }
}).class, 'MIXED');

// AMBIGUOUS: subscription's customer differs from the row's, or foreign uid.
assert.strictEqual(classifyRow(row(), {
  subscription: { found: true, status: 'active', customerId: 'cus_OTHER' },
  customer: { found: true, deleted: false, firebaseUid: 'uid_A' }
}).class, 'AMBIGUOUS');
assert.strictEqual(classifyRow(row(), {
  subscription: { found: true, status: 'active', customerId: 'cus_A1234' },
  customer: { found: true, deleted: false, firebaseUid: 'uid_OTHER' }
}).class, 'AMBIGUOUS');

// CUSTOMER_ONLY split.
assert.strictEqual(classifyRow(row({ stripe_subscription_id: null }), {
  customer: { found: true, deleted: false, firebaseUid: 'uid_A' }
}).class, 'CUSTOMER_ONLY_KEEP');
assert.strictEqual(classifyRow(row({ stripe_subscription_id: null }), {
  customer: { found: false, testModeHint: true }
}).class, 'CUSTOMER_ONLY_CLEAR');
assert.strictEqual(classifyRow(row({ stripe_subscription_id: null }), {
  customer: { found: true, deleted: false, firebaseUid: 'uid_OTHER' }
}).class, 'CUSTOMER_ONLY_CLEAR');
assert.strictEqual(classifyRow(row({ stripe_subscription_id: null }), {
  customer: { found: true, deleted: true, firebaseUid: null }
}).class, 'AMBIGUOUS');

// Paid claim without any Stripe ids.
assert.strictEqual(classifyRow(row({ stripe_subscription_id: null, stripe_customer_id: null }), {}).class, 'AMBIGUOUS');

// ── duplicates + classifyAll ──
{
  const rows = [
    row(),
    row({ id: 2, auth_id: 'uid_B', stripe_customer_id: 'cus_A1234', stripe_subscription_id: 'sub_B999' }),
    row({ id: 3, auth_id: 'uid_C', stripe_customer_id: 'cus_C1', stripe_subscription_id: 'sub_B999' })
  ];
  const dups = duplicateGroups(rows);
  assert.strictEqual(dups.length, 2, 'one customer-id group + one subscription-id group');
  assert.ok(dups.every((d) => d.rowIds.length === 2));
  assert.ok(!JSON.stringify(dups).includes('cus_A1234'), 'duplicate report carries last-4 only');

  const classification = classifyAll(rows, {
    1: { subscription: { found: true, status: 'active', customerId: 'cus_A1234' }, customer: { found: true, deleted: false, firebaseUid: 'uid_A' } },
    2: { subscription: { found: false, testModeHint: true }, customer: { found: false, testModeHint: true } },
    3: { subscription: { found: false, testModeHint: true }, customer: { found: false, testModeHint: true } }
  });
  assert.strictEqual(classification.counts.LEGIT, 1);
  assert.strictEqual(classification.counts.INVALID_TEST, 2);
  assert.deepStrictEqual(classification.repairRowIds, [2, 3]);
  assert.strictEqual(classification.readyForUniqueIndex, false);
}

// ── allowlist drift ──
{
  const rows = [
    row(),
    row({ id: 2, auth_id: 'uid_B', stripe_customer_id: 'cus_B1', stripe_subscription_id: 'sub_B1' })
  ];
  const classification = classifyAll(rows, {
    1: { subscription: { found: true, status: 'active', customerId: 'cus_A1234' }, customer: { found: true, deleted: false, firebaseUid: 'uid_A' } },
    2: { subscription: { found: false, testModeHint: true }, customer: { found: false, testModeHint: true } }
  });
  const goodAllowlist = {
    legit: [{ id: 1, auth_id: 'uid_A', sub_last4: '1234' }],
    repair: [{ id: 2, auth_id: 'uid_B' }],
    expected: { legit: 1, repair: 1 }
  };
  assert.strictEqual(compareToAllowlist(classification, goodAllowlist).ok, true);

  // Count drift.
  assert.strictEqual(compareToAllowlist(classification, { ...goodAllowlist, expected: { legit: 2, repair: 1 } }).ok, false);
  // Membership drift (different row id).
  assert.strictEqual(compareToAllowlist(classification, { ...goodAllowlist, repair: [{ id: 99, auth_id: 'uid_X' }] }).ok, false);
  // Identity drift (same id, different auth_id).
  assert.strictEqual(compareToAllowlist(classification, { ...goodAllowlist, legit: [{ id: 1, auth_id: 'uid_HACK', sub_last4: '1234' }] }).ok, false);
  // Repair-listed row that now classifies LEGIT → refuse.
  const flipped = compareToAllowlist(classification, {
    legit: [{ id: 1, auth_id: 'uid_A', sub_last4: '1234' }],
    repair: [{ id: 1, auth_id: 'uid_A' }, { id: 2, auth_id: 'uid_B' }],
    expected: {}
  });
  assert.strictEqual(flipped.ok, false);
  assert.ok(flipped.mismatches.some((m) => m.includes('refusing to downgrade')));
}

// ── buildApplySql ──
{
  const rows = [
    row({ trial_ends_at: '2026-05-01T00:00:00.000Z' }),
    row({ id: 2, auth_id: 'uid_B', plan: 'pro', stripe_customer_id: 'cus_B1', stripe_subscription_id: 'sub_B1', has_ever_paid: 1, trial_ends_at: '2026-04-01T00:00:00.000Z' })
  ];
  const classification = classifyAll(rows, {
    1: { subscription: { found: true, status: 'active', customerId: 'cus_A1234' }, customer: { found: true, deleted: false, firebaseUid: 'uid_A' } },
    2: { subscription: { found: false, testModeHint: true }, customer: { found: false, testModeHint: true } }
  });
  const allowlist = {
    legit: [{ id: 1, auth_id: 'uid_A', sub_last4: '1234' }],
    repair: [{ id: 2, auth_id: 'uid_B', reset_has_ever_paid: true }],
    expected: { legit: 1, repair: 1 }
  };
  const backfill = { 1: {
    plan: 'essential', subscription_status: 'active',
    stripe_customer_id: 'cus_A1234', stripe_subscription_id: 'sub_A1234',
    current_period_start: '2026-08-01T00:00:00.000Z', current_period_end: '2026-09-01T00:00:00.000Z',
    trial_ends_at: null, cancel_at: null
  } };
  const sql = buildApplySql('run_test_1', rows, classification, allowlist, backfill, '2026-08-17T00:00:00.000Z');

  assert.ok(!/\bDELETE\b/i.test(sql), 'apply SQL contains no DELETE statements, by construction');
  const stmts = sql.split('\n');
  assert.strictEqual(stmts.length, 4, 'audit INSERT + UPDATE per touched row');
  assert.ok(stmts[0].startsWith('INSERT INTO billing_repair_audit'), 'audit precedes its update');
  assert.ok(stmts[1].startsWith('UPDATE users SET'), 'update follows audit');
  assert.ok(stmts[1].includes("current_period_start = '2026-08-01T00:00:00.000Z'"), 'legit backfill writes periods');
  assert.ok(stmts[3].includes("plan = 'free'"), 'repair row goes free');
  assert.ok(stmts[3].includes('has_ever_paid = 0'), 'reset_has_ever_paid honored');
  assert.ok(stmts[3].includes("trial_ends_at = '2026-04-01T00:00:00.000Z'"), 'trial date preserved by default');
  assert.ok(stmts[0].includes('old_values_json'), 'before-image recorded');

  // clear_trial flag clears it.
  const sqlClear = buildApplySql('run_test_2', rows, classification,
    { ...allowlist, repair: [{ id: 2, auth_id: 'uid_B', clear_trial: true }] }, backfill, '2026-08-17T00:00:00.000Z');
  assert.ok(sqlClear.split('\n')[3].includes('trial_ends_at = NULL'));

  // A legit row that would end non-paid aborts.
  assert.throws(() => buildApplySql('run_test_3', rows, classification, allowlist,
    { 1: { ...backfill[1], plan: 'free' } }, '2026-08-17T00:00:00.000Z'),
  /non-paid/);

  // Drift aborts before any SQL is produced.
  assert.throws(() => buildApplySql('run_test_4', rows, classification,
    { ...allowlist, expected: { legit: 2, repair: 1 } }, backfill, '2026-08-17T00:00:00.000Z'),
  /allowlist drift/);

  // Malformed Stripe ids are refused at generation time.
  assert.throws(() => buildApplySql('run_test_5', rows, classification, allowlist,
    { 1: { ...backfill[1], stripe_customer_id: "cus_x'; DROP TABLE users;--" } }, '2026-08-17T00:00:00.000Z'),
  /unsafe or malformed/);
}

// ── buildRollbackSql restores before-images ──
{
  const auditRows = [{
    id: 10, run_id: 'run_test_1', mode: 'apply', user_row_id: 2, auth_id: 'uid_B',
    stripe_customer_id: 'cus_B1', stripe_subscription_id: 'sub_B1',
    old_values_json: JSON.stringify({
      plan: 'pro', subscription_status: 'active', stripe_customer_id: 'cus_B1',
      stripe_subscription_id: 'sub_B1', current_period_start: null, current_period_end: null,
      trial_ends_at: '2026-04-01T00:00:00.000Z', cancel_at: null, scheduled_plan: null,
      scheduled_at: null, has_ever_paid: 1, plan_updated_at: '2026-01-01T00:00:00.000Z'
    }),
    new_values_json: JSON.stringify({ plan: 'free', stripe_customer_id: null })
  }];
  const sql = buildRollbackSql('run_test_1', auditRows, '2026-08-18T00:00:00.000Z');
  assert.ok(!/\bDELETE\b/i.test(sql));
  const stmts = sql.split('\n');
  assert.ok(stmts[0].includes("'rollback'"), 'mirror audit row recorded');
  assert.ok(stmts[1].includes("plan = 'pro'"), 'before-image restored');
  assert.ok(stmts[1].includes("stripe_subscription_id = 'sub_B1'"));
  assert.ok(stmts[1].includes("plan_updated_at = '2026-08-18T00:00:00.000Z'"), 'rollback stamps plan_updated_at so stale webhooks skip');
  assert.throws(() => buildRollbackSql('run_none', [], 'x'), /no apply audit rows/);
}

// ── zero-write preflight semantics: classification emits no SQL at all ──
{
  const rows = [row()];
  const classification = classifyAll(rows, { 1: { subscription: { found: true, status: 'active', customerId: 'cus_A1234' }, customer: { found: true, deleted: false, firebaseUid: 'uid_A' } } });
  const asJson = JSON.stringify(classification);
  assert.ok(!asJson.includes('UPDATE'), 'preflight output contains no write statements');
  assert.ok(!asJson.includes('INSERT'));
  // An empty allowlist can never sneak through apply.
  assert.throws(() => buildApplySql('run_empty', rows, classification, { legit: [], repair: [], expected: {} }, {}, 'x'),
  /drift|zero statements/);
}

// ── validators & helpers ──
assert.throws(() => assertSafeStripeId('cus_ok; DROP', 'customer'));
assert.throws(() => assertSafeStripeId('sub_', 'subscription'));
assert.strictEqual(assertSafeStripeId('cus_Abc123', 'customer'), 'cus_Abc123');
assert.throws(() => assertSafeRunId('x'));
assert.throws(() => assertSafeRunId('bad run id!'));
assert.strictEqual(sqlValue("O'Brien"), "'O''Brien'");
assert.strictEqual(sqlValue(null), 'NULL');
assert.strictEqual(sqlValue(5), '5');
assert.deepStrictEqual(kvKeysForUid('u1'), ['cusByUid:u1', 'planByUid:u1', 'billingStatus:u1', 'trialUsedByUid:u1', 'trialEndByUid:u1']);

console.log('billing-reconcile.test.mjs: all assertions passed');
