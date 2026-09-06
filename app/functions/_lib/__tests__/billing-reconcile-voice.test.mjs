// Reconciliation classifier + apply/rollback SQL against the dev0 voice
// plans. The critical property: a valid Interview Pack purchase is NEVER
// classified as stale billing residue and never repaired into a subscription
// plan — pack credits live in voice columns that the reconciliation cannot
// touch, and the 'pack' label survives any repair of a stale subscription
// claim on the same row. weekly/monthly behave exactly like the legacy tiers.
// Run: node app/functions/_lib/__tests__/billing-reconcile-voice.test.mjs
import assert from 'node:assert';
import {
  classifyRow, classifyAll, compareToAllowlist, buildApplySql, buildRollbackSql, BILLING_FIELDS
} from '../../../scripts/lib/billing-reconcile-core.mjs';

const row = (over = {}) => ({
  id: 1, auth_id: 'uid_A', plan: 'monthly', subscription_status: 'active',
  stripe_customer_id: 'cus_A1234', stripe_subscription_id: 'sub_A1234',
  current_period_start: null, current_period_end: null, trial_ends_at: null,
  cancel_at: null, scheduled_plan: null, scheduled_at: null,
  has_ever_paid: 1, plan_updated_at: '2026-01-01T00:00:00.000Z', ...over
});
const owned = (uid = 'uid_A') => ({ found: true, deleted: false, firebaseUid: uid });

// ── Voice columns are never billing fields ──
for (const col of ['voice_sessions_remaining', 'free_session_used', 'pack_expires_at', 'voice_followup_email_sent_at']) {
  assert.ok(!BILLING_FIELDS.includes(col), `${col} must never be written by the reconciliation`);
}

// ── weekly / monthly classify like the legacy tiers ──
for (const plan of ['weekly', 'monthly']) {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
    assert.strictEqual(classifyRow(row({ plan }), {
      subscription: { found: true, status, customerId: 'cus_A1234' }, customer: owned()
    }).class, 'LEGIT', `${plan}/${status} is LEGIT`);
  }
  // Ended subscription on an owned customer → MIXED (subscription claim cleared).
  assert.strictEqual(classifyRow(row({ plan }), {
    subscription: { found: true, status: 'canceled', customerId: 'cus_A1234' }, customer: owned()
  }).class, 'MIXED');
  // A subscription-plan label with no Stripe ids at all is residue.
  assert.strictEqual(classifyRow(row({ plan, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null }), {}).class, 'AMBIGUOUS');
  // Owned customer, no subscription id, verified-empty live list → repair (paid claim without a subscription).
  assert.strictEqual(classifyRow(row({ plan, stripe_subscription_id: null }), {
    customer: owned(), customerSubscriptions: { statuses: [] }
  }).class, 'CUSTOMER_ONLY_PAID_CLAIM');
  // Owned customer with a live but unlinked subscription → held, never freed.
  assert.strictEqual(classifyRow(row({ plan, stripe_subscription_id: null }), {
    customer: owned(), customerSubscriptions: { statuses: ['active'] }
  }).class, 'CUSTOMER_ONLY_UNLINKED_SUB');
}

// ── pack rows make no subscription claim ──
const packRow = (over = {}) => row({ plan: 'pack', subscription_status: null, stripe_subscription_id: null, has_ever_paid: 1, ...over });
// Owned customer, no subscription, verified-empty subscription list: KEEP, not a paid claim.
assert.strictEqual(classifyRow(packRow(), { customer: owned(), customerSubscriptions: { statuses: [] } }).class, 'CUSTOMER_ONLY_KEEP');
// Same without any subscription verification at all: still KEEP (nothing to verify).
assert.strictEqual(classifyRow(packRow(), { customer: owned() }).class, 'CUSTOMER_ONLY_KEEP');
// Pack buyer with no Stripe ids on the row: nothing to do.
assert.strictEqual(classifyRow(packRow({ stripe_customer_id: null }), {}).class, 'FREE_CLEAN');
// A pack row whose customer belongs to someone else still clears the foreign id.
assert.strictEqual(classifyRow(packRow(), { customer: owned('uid_OTHER') }).class, 'CUSTOMER_ONLY_CLEAR');

// ── classifyAll: pack rows never enter the repair set on their own ──
{
  const rows = [
    packRow({ id: 1, auth_id: 'uid_A', stripe_customer_id: 'cus_A1234' }),
    row({ id: 2, auth_id: 'uid_B', plan: 'weekly', stripe_customer_id: 'cus_B1', stripe_subscription_id: 'sub_B1234' }),
    row({ id: 3, auth_id: 'uid_C', plan: 'monthly', stripe_customer_id: 'cus_C1', stripe_subscription_id: 'sub_C1234' })
  ];
  const classification = classifyAll(rows, {
    1: { customer: owned('uid_A'), customerSubscriptions: { statuses: [] } },
    2: { subscription: { found: true, status: 'active', customerId: 'cus_B1' }, customer: owned('uid_B') },
    3: { subscription: { found: false, testModeHint: true }, customer: { found: false, testModeHint: true } }
  });
  assert.strictEqual(classification.counts.CUSTOMER_ONLY_KEEP, 1, 'pack buyer kept');
  assert.strictEqual(classification.counts.LEGIT, 1, 'weekly subscriber legit');
  assert.strictEqual(classification.counts.INVALID_TEST, 1, 'test-mode monthly residue repaired');
  assert.deepStrictEqual(classification.repairRowIds, [3]);
  assert.strictEqual(classification.readyForUniqueIndex, true);

  // Hand-adding the pack row to the repair allowlist is drift → refused.
  const forced = compareToAllowlist(classification, {
    legit: [{ id: 2, auth_id: 'uid_B', sub_last4: '1234' }], repair: [{ id: 1, auth_id: 'uid_A' }, { id: 3, auth_id: 'uid_C' }], expected: {}
  });
  assert.strictEqual(forced.ok, false, 'a pack row cannot be forced into the repair set');

  // LEGIT backfill for a weekly subscriber is accepted (no "would end non-paid" abort).
  const allowlist = { legit: [{ id: 2, auth_id: 'uid_B', sub_last4: '1234' }], repair: [{ id: 3, auth_id: 'uid_C' }], expected: { legit: 1, repair: 1 } };
  const backfill = { 2: {
    plan: 'weekly', subscription_status: 'active', stripe_customer_id: 'cus_B1', stripe_subscription_id: 'sub_B1234',
    current_period_start: '2026-09-01T00:00:00.000Z', current_period_end: '2026-09-08T00:00:00.000Z', trial_ends_at: null, cancel_at: null
  } };
  const sql = buildApplySql('run_voice_1', rows, classification, allowlist, backfill, '2026-09-06T00:00:00.000Z');
  const stmts = sql.split('\n');
  assert.strictEqual(stmts.length, 4);
  assert.ok(stmts[1].includes("plan = 'weekly'"), 'weekly backfill written');
  assert.ok(stmts[1].includes("current_period_end = '2026-09-08T00:00:00.000Z'"), 'weekly period written');
  assert.ok(stmts[3].includes("plan = 'free'"), 'monthly test residue freed');
  assert.ok(!/voice_sessions_remaining|pack_expires_at|free_session_used/.test(sql), 'apply SQL never mentions voice columns');
  assert.ok(!/\bDELETE\b/i.test(sql));

  // A LEGIT row can never be backfilled to the pack label (a subscription is not a pack).
  assert.throws(() => buildApplySql('run_voice_2', rows, classification, allowlist, { 2: { ...backfill[2], plan: 'pack' } }, 'x'), /non-paid/);
}

// ── Repairing a pack buyer's STALE subscription claim keeps plan='pack' ──
{
  // Pack buyer whose row still carries a dead legacy subscription id.
  const stale = packRow({ id: 7, auth_id: 'uid_P', stripe_customer_id: 'cus_P1234', stripe_subscription_id: 'sub_dead1', subscription_status: 'canceled', trial_ends_at: '2026-03-01T00:00:00.000Z' });
  const classification = classifyAll([stale], {
    7: { subscription: { found: false, testModeHint: false }, customer: owned('uid_P') }
  });
  assert.strictEqual(classification.counts.MIXED, 1);
  const sql = buildApplySql('run_voice_3', [stale], classification, { legit: [], repair: [{ id: 7, auth_id: 'uid_P' }], expected: { repair: 1 } }, {}, '2026-09-06T00:00:00.000Z');
  const update = sql.split('\n')[1];
  assert.ok(update.includes("plan = 'pack'"), 'pack label survives the repair');
  assert.ok(update.includes('stripe_subscription_id = NULL'), 'stale subscription claim cleared');
  assert.ok(update.includes('subscription_status = NULL'));
  assert.ok(update.includes("stripe_customer_id = 'cus_P1234'"), 'owned customer id retained');
  assert.ok(update.includes('has_ever_paid = 1'), 'has_ever_paid preserved');
  assert.ok(update.includes("trial_ends_at = '2026-03-01T00:00:00.000Z'"), 'trial field preserved');

  // Rollback restores the before-image (including the stale claim) verbatim.
  const auditRow = {
    id: 1, run_id: 'run_voice_3', mode: 'apply', user_row_id: 7, auth_id: 'uid_P',
    stripe_customer_id: 'cus_P1234', stripe_subscription_id: 'sub_dead1',
    old_values_json: JSON.stringify(Object.fromEntries(BILLING_FIELDS.map((f) => [f, stale[f] ?? null]))),
    new_values_json: JSON.stringify({ plan: 'pack', stripe_subscription_id: null })
  };
  const rb = buildRollbackSql('run_voice_3', [auditRow], '2026-09-07T00:00:00.000Z').split('\n')[1];
  assert.ok(rb.includes("plan = 'pack'"));
  assert.ok(rb.includes("stripe_subscription_id = 'sub_dead1'"), 'rollback restores the before-image exactly');
}

// ── A pack buyer whose customer is foreign/test-mode: customer cleared, label kept ──
{
  const r = packRow({ id: 9, auth_id: 'uid_Q', stripe_customer_id: 'cus_Q1234' });
  const classification = classifyAll([r], { 9: { customer: { found: false, testModeHint: true } } });
  assert.strictEqual(classification.counts.CUSTOMER_ONLY_CLEAR, 1);
  const update = buildApplySql('run_voice_4', [r], classification, { legit: [], repair: [{ id: 9, auth_id: 'uid_Q' }], expected: {} }, {}, 'x').split('\n')[1];
  assert.ok(update.includes("plan = 'pack'"));
  assert.ok(update.includes('stripe_customer_id = NULL'));
}

console.log('billing-reconcile-voice.test.mjs: all assertions passed');
