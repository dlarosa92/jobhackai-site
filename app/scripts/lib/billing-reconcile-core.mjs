// Pure logic for the one-time billing reconciliation (no I/O, no wrangler,
// no fetch) so every decision the operator relies on is unit-testable in
// bare Node: classification, allowlist drift comparison, SQL generation,
// and rollback SQL. The CLI shell (../billing-reconcile.mjs) supplies row
// data from D1 and verification state from live Stripe.
//
// Classifications (per the hotfix plan):
//   LEGIT               — live subscription (active/trialing) + live customer
//                         stamped with this row's auth_id → backfill from Stripe
//   INVALID_TEST        — Stripe 404 carrying the "similar object exists in
//                         test mode" hint → affirmatively test data → clear
//   NOT_FOUND_LIVE      — Stripe 404 without the hint → clear, flag for review
//   CUSTOMER_ONLY_KEEP  — no subscription id; live customer owned by this
//                         row, and the row claims no paid entitlement
//   CUSTOMER_ONLY_PAID_CLAIM — no subscription id; owned live customer; the
//                         row claims paid access AND the customer's live
//                         Stripe subscription list was checked and is
//                         VERIFIED EMPTY of entitled statuses → repair:
//                         plan to free, status/periods cleared, customer id
//                         RETAINED
//   CUSTOMER_ONLY_UNLINKED_SUB — no subscription id in D1, owned customer,
//                         paid claim, and the customer HAS a live
//                         entitled-status subscription (or the list could
//                         not be verified). A missing D1 link is not proof
//                         of no subscription — this is likely a paying
//                         customer whose webhook write failed. Deliberately
//                         in NEITHER the legit nor the repair set: apply can
//                         never free it, and the drift comparison rejects
//                         hand-adding it. Operator resolves by relinking the
//                         subscription id, then re-runs preflight.
//   CUSTOMER_ONLY_CLEAR — no subscription id; customer test/missing/foreign
//   MIXED               — live owned customer but invalid subscription id →
//                         keep customer id, clear subscription fields
//   AMBIGUOUS           — deleted customer, uid mismatch, or unresolvable
//                         duplicate → identifiers cleared, ownership never
//                         guessed, flagged for operator review
//   FREE_CLEAN          — nothing to do (free row without stripe ids)

export const BILLING_FIELDS = [
  'plan',
  'subscription_status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'current_period_start',
  'current_period_end',
  'trial_ends_at',
  'cancel_at',
  'scheduled_plan',
  'scheduled_at',
  'has_ever_paid',
  'plan_updated_at'
];

const PAID_PLANS = new Set(['essential', 'pro', 'premium']);
// Mirrors the app's dunning policy (webhook + billing-ownership): these
// statuses still represent, or may recover into, paid entitlement.
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

// ── Value safety (the generated SQL is executed via `wrangler d1 execute
// --file`, which has no bind parameters — every interpolated value must be
// validated and/or quoted) ────────────────────────────────────────────────

export function assertSafeStripeId(id, kind) {
  const patterns = { customer: /^cus_[A-Za-z0-9]+$/, subscription: /^sub_[A-Za-z0-9]+$/ };
  if (!patterns[kind]) throw new Error(`unknown stripe id kind: ${kind}`);
  if (typeof id !== 'string' || !patterns[kind].test(id)) {
    throw new Error(`unsafe or malformed ${kind} id refused for SQL generation`);
  }
  return id;
}

export function assertSafeRowId(id) {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`unsafe users.id refused: ${id}`);
  return id;
}

export function assertSafeRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(runId)) {
    throw new Error('run id must be 4-64 chars of [A-Za-z0-9_-]');
  }
  return runId;
}

// Single-quote escape for SQL string literals; null/undefined → NULL.
export function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number refused for SQL generation');
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function subLast4(subscriptionId) {
  return subscriptionId ? String(subscriptionId).slice(-4) : null;
}

// ── Classification ───────────────────────────────────────────────────────

// stripeState per row (built by the CLI from live-mode GETs):
//   subscription: null | { found:false, testModeHint:boolean }
//               | { found:true, status, customerId, priceId,
//                   currentPeriodStartIso, currentPeriodEndIso, trialEndIso,
//                   cancelAtIso }
//   customer:     null | { found:false, testModeHint:boolean }
//               | { found:true, deleted:boolean, firebaseUid:string|null }
//   customerSubscriptions: (sub-less rows with a found customer only)
//                 { statuses: string[] } — statuses of the customer's LIVE
//                 subscriptions, listed by the CLI. Absent/invalid ⇒ the
//                 paid claim cannot be verified ⇒ never auto-freed.
export function classifyRow(row, stripeState) {
  const hasSub = Boolean(row.stripe_subscription_id);
  const hasCus = Boolean(row.stripe_customer_id);
  const paidClaim = hasSub || hasCus || PAID_PLANS.has(row.plan) || row.plan === 'trial' || Boolean(row.subscription_status);

  if (!paidClaim) return { class: 'FREE_CLEAN' };

  const sub = stripeState?.subscription ?? null;
  const cus = stripeState?.customer ?? null;
  const customerOwned = Boolean(cus?.found && !cus.deleted && cus.firebaseUid === row.auth_id);
  const customerForeign = Boolean(cus?.found && !cus.deleted && cus.firebaseUid && cus.firebaseUid !== row.auth_id);

  if (hasSub) {
    if (sub?.found) {
      const liveStatus = ['active', 'trialing', 'past_due'].includes(sub.status);
      if (liveStatus && customerOwned && sub.customerId === row.stripe_customer_id) {
        return { class: 'LEGIT' };
      }
      if (customerForeign || (sub.customerId && hasCus && sub.customerId !== row.stripe_customer_id)) {
        return { class: 'AMBIGUOUS', reason: 'ownership_mismatch' };
      }
      if (!liveStatus) {
        // Subscription exists but ended — customer disposition decides.
        return customerOwned
          ? { class: 'MIXED', reason: 'subscription_ended' }
          : { class: 'AMBIGUOUS', reason: 'ended_subscription_unowned_customer' };
      }
      return { class: 'AMBIGUOUS', reason: 'unverifiable_ownership' };
    }
    if (sub && sub.found === false) {
      if (sub.testModeHint) {
        return customerOwned ? { class: 'MIXED', reason: 'test_subscription_on_owned_customer' } : { class: 'INVALID_TEST' };
      }
      return customerOwned ? { class: 'MIXED', reason: 'missing_subscription_on_owned_customer' } : { class: 'NOT_FOUND_LIVE' };
    }
    return { class: 'AMBIGUOUS', reason: 'subscription_unverified' };
  }

  // No subscription id on the row.
  if (hasCus) {
    if (customerOwned) {
      // An owned customer justifies keeping the CUSTOMER ID — it never
      // justifies keeping a paid plan that no subscription backs.
      const entitlementClaim = PAID_PLANS.has(row.plan) || row.plan === 'trial'
        || ENTITLED_STATUSES.has(String(row.subscription_status || ''));
      if (!entitlementClaim) return { class: 'CUSTOMER_ONLY_KEEP' };

      // A missing D1 subscription id is NOT proof that no subscription
      // exists — the incident involved webhook write failures, so a paying
      // customer's link may simply never have been persisted. Free the row
      // only when the customer's live subscription list was checked and is
      // verified empty of entitled statuses; otherwise hold it for operator
      // resolution (relink), never auto-downgrade.
      const subs = stripeState?.customerSubscriptions;
      if (!subs || !Array.isArray(subs.statuses)) {
        return { class: 'CUSTOMER_ONLY_UNLINKED_SUB', reason: 'subscriptions_unverified' };
      }
      const liveEntitled = subs.statuses.filter((s) => ENTITLED_STATUSES.has(s)).length;
      if (liveEntitled > 0) {
        return { class: 'CUSTOMER_ONLY_UNLINKED_SUB', reason: 'live_subscription_not_linked' };
      }
      return { class: 'CUSTOMER_ONLY_PAID_CLAIM', reason: 'paid_claim_without_subscription' };
    }
    if (cus && cus.found === false) {
      return { class: 'CUSTOMER_ONLY_CLEAR', reason: cus.testModeHint ? 'test_customer' : 'customer_not_found_live' };
    }
    if (cus?.deleted) return { class: 'AMBIGUOUS', reason: 'deleted_customer' };
    if (customerForeign) return { class: 'CUSTOMER_ONLY_CLEAR', reason: 'foreign_uid_customer' };
    return { class: 'AMBIGUOUS', reason: 'customer_unverified' };
  }

  // Paid-looking plan/status with no Stripe ids at all.
  return { class: 'AMBIGUOUS', reason: 'paid_claim_without_stripe_ids' };
}

export function duplicateGroups(rows) {
  const byField = (field) => {
    const groups = new Map();
    for (const row of rows) {
      const v = row[field];
      if (!v) continue;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(row.id);
    }
    return [...groups.entries()].filter(([, ids]) => ids.length > 1)
      .map(([value, ids]) => ({ field, valueLast4: String(value).slice(-4), rowIds: ids.sort((a, b) => a - b) }));
  };
  return [...byField('stripe_customer_id'), ...byField('stripe_subscription_id')];
}

export function classifyAll(rows, stripeStateByRowId) {
  const classes = {};
  for (const row of rows) {
    const result = classifyRow(row, stripeStateByRowId?.[row.id]);
    if (!classes[result.class]) classes[result.class] = [];
    classes[result.class].push({ id: row.id, auth_id: row.auth_id, sub_last4: subLast4(row.stripe_subscription_id), reason: result.reason || null });
  }
  const duplicates = duplicateGroups(rows);
  // CUSTOMER_ONLY_UNLINKED_SUB is deliberately in NEITHER the legit nor the
  // repair set: apply must never free a row whose owned customer may carry a
  // live unlinked subscription. It surfaces in counts/classes for operator
  // resolution, and compareToAllowlist rejects hand-adding it to repair.
  const repairClasses = ['INVALID_TEST', 'NOT_FOUND_LIVE', 'CUSTOMER_ONLY_CLEAR', 'CUSTOMER_ONLY_PAID_CLAIM', 'MIXED', 'AMBIGUOUS'];
  return {
    classes,
    duplicates,
    counts: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])),
    repairRowIds: repairClasses.flatMap((c) => (classes[c] || []).map((r) => r.id)).sort((a, b) => a - b),
    readyForUniqueIndex: duplicates.length === 0
  };
}

// ── Allowlist drift comparison (abort conditions) ────────────────────────

function tripletKey(entry) {
  return `${entry.id}|${entry.auth_id}|${entry.sub_last4 ?? ''}`;
}

export function compareToAllowlist(classification, allowlist) {
  const mismatches = [];
  const legitNow = (classification.classes.LEGIT || []).map(tripletKey).sort();
  const legitAllowed = (allowlist.legit || []).map(tripletKey).sort();
  if (JSON.stringify(legitNow) !== JSON.stringify(legitAllowed)) {
    mismatches.push('legit set differs from allowlist (identity or count drift)');
  }
  const repairNowIds = classification.repairRowIds;
  const repairAllowedIds = (allowlist.repair || []).map((r) => r.id).sort((a, b) => a - b);
  if (JSON.stringify(repairNowIds) !== JSON.stringify(repairAllowedIds)) {
    mismatches.push('repair set differs from allowlist (identity or count drift)');
  }
  const expected = allowlist.expected || {};
  if (expected.legit !== undefined && (classification.classes.LEGIT || []).length !== expected.legit) {
    mismatches.push(`expected ${expected.legit} legit rows, classified ${(classification.classes.LEGIT || []).length}`);
  }
  if (expected.repair !== undefined && repairNowIds.length !== expected.repair) {
    mismatches.push(`expected ${expected.repair} repair rows, classified ${repairNowIds.length}`);
  }
  // An allowlisted repair row that now classifies LEGIT means a real
  // subscription appeared since approval — abort, never downgrade it.
  const legitIds = new Set((classification.classes.LEGIT || []).map((r) => r.id));
  for (const r of allowlist.repair || []) {
    if (legitIds.has(r.id)) {
      mismatches.push(`allowlisted repair row ${r.id} now classifies LEGIT — refusing to downgrade`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ── Apply SQL generation ─────────────────────────────────────────────────

function auditInsert(runId, mode, row, newValues) {
  const oldValues = {};
  for (const f of BILLING_FIELDS) oldValues[f] = row[f] ?? null;
  return `INSERT INTO billing_repair_audit (run_id, mode, user_row_id, auth_id, stripe_customer_id, stripe_subscription_id, old_values_json, new_values_json) VALUES (${sqlValue(runId)}, ${sqlValue(mode)}, ${assertSafeRowId(row.id)}, ${sqlValue(row.auth_id)}, ${sqlValue(row.stripe_customer_id)}, ${sqlValue(row.stripe_subscription_id)}, ${sqlValue(JSON.stringify(oldValues))}, ${sqlValue(JSON.stringify(newValues))});`;
}

function updateStatement(rowId, newValues) {
  const sets = BILLING_FIELDS.map((f) => `${f} = ${sqlValue(newValues[f])}`).join(', ');
  return `UPDATE users SET ${sets}, updated_at = datetime('now') WHERE id = ${assertSafeRowId(rowId)};`;
}

/**
 * Build the full apply batch: for every touched row, an audit INSERT
 * (before+after images) followed by the UPDATE. Executed by the CLI as ONE
 * `wrangler d1 execute --file` invocation (transactional batch). Contains
 * no DELETE statements by construction.
 *
 * @param {string} runId
 * @param {Array} rows - full D1 rows (billing fields present)
 * @param {object} classification - from classifyAll
 * @param {object} allowlist - { legit:[{id,auth_id,sub_last4}], repair:[{id,auth_id,reset_has_ever_paid?,clear_trial?}], expected:{} }
 * @param {object} legitBackfill - rowId → { plan, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, trial_ends_at, cancel_at }
 * @param {string} runTimestampIso - plan_updated_at for every write (makes stale in-flight webhooks skip via the ordering guard)
 */
export function buildApplySql(runId, rows, classification, allowlist, legitBackfill, runTimestampIso) {
  assertSafeRunId(runId);
  const drift = compareToAllowlist(classification, allowlist);
  if (!drift.ok) throw new Error(`allowlist drift: ${drift.mismatches.join('; ')}`);

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const statements = [];

  for (const entry of allowlist.legit || []) {
    const row = rowById.get(entry.id);
    if (!row) throw new Error(`legit row ${entry.id} not present in row data`);
    const backfill = legitBackfill?.[entry.id];
    if (!backfill) throw new Error(`no live-Stripe backfill supplied for legit row ${entry.id}`);
    if (!PAID_PLANS.has(backfill.plan) && backfill.plan !== 'trial') {
      throw new Error(`legit row ${entry.id} would end non-paid (${backfill.plan}) — refusing`);
    }
    assertSafeStripeId(backfill.stripe_customer_id, 'customer');
    assertSafeStripeId(backfill.stripe_subscription_id, 'subscription');
    const newValues = {
      plan: backfill.plan,
      subscription_status: backfill.subscription_status,
      stripe_customer_id: backfill.stripe_customer_id,
      stripe_subscription_id: backfill.stripe_subscription_id,
      current_period_start: backfill.current_period_start ?? null,
      current_period_end: backfill.current_period_end ?? null,
      trial_ends_at: backfill.trial_ends_at ?? row.trial_ends_at ?? null,
      cancel_at: backfill.cancel_at ?? null,
      scheduled_plan: row.scheduled_plan ?? null,
      scheduled_at: row.scheduled_at ?? null,
      has_ever_paid: 1,
      plan_updated_at: runTimestampIso
    };
    statements.push(auditInsert(runId, 'apply', row, newValues));
    statements.push(updateStatement(row.id, newValues));
  }

  for (const entry of allowlist.repair || []) {
    const row = rowById.get(entry.id);
    if (!row) throw new Error(`repair row ${entry.id} not present in row data`);
    if (row.auth_id !== entry.auth_id) throw new Error(`repair row ${entry.id} auth_id drifted — refusing`);
    const keepCustomer = (classification.classes.MIXED || []).some((r) => r.id === entry.id)
      || (classification.classes.CUSTOMER_ONLY_PAID_CLAIM || []).some((r) => r.id === entry.id)
      || (classification.classes.CUSTOMER_ONLY_KEEP || []).some((r) => r.id === entry.id);
    const newValues = {
      plan: 'free',
      subscription_status: null,
      stripe_customer_id: keepCustomer ? row.stripe_customer_id : null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: entry.clear_trial ? null : (row.trial_ends_at ?? null),
      cancel_at: null,
      scheduled_plan: null,
      scheduled_at: null,
      has_ever_paid: entry.reset_has_ever_paid ? 0 : (row.has_ever_paid ?? 0),
      plan_updated_at: runTimestampIso
    };
    statements.push(auditInsert(runId, 'apply', row, newValues));
    statements.push(updateStatement(row.id, newValues));
  }

  if (statements.length === 0) throw new Error('allowlist produced zero statements — nothing to apply');
  return statements.join('\n');
}

// ── Rollback SQL generation ──────────────────────────────────────────────

export function buildRollbackSql(runId, auditRows, rollbackTimestampIso) {
  assertSafeRunId(runId);
  const applies = (auditRows || []).filter((a) => a.mode === 'apply');
  if (applies.length === 0) throw new Error(`no apply audit rows found for run ${runId}`);
  const statements = [];
  for (const audit of applies) {
    const oldValues = JSON.parse(audit.old_values_json);
    const restored = {};
    for (const f of BILLING_FIELDS) restored[f] = oldValues[f] ?? null;
    // Mirror audit row: the "old" values of a rollback are the applied values.
    const appliedValues = JSON.parse(audit.new_values_json);
    statements.push(
      `INSERT INTO billing_repair_audit (run_id, mode, user_row_id, auth_id, stripe_customer_id, stripe_subscription_id, old_values_json, new_values_json) VALUES (${sqlValue(runId)}, 'rollback', ${assertSafeRowId(audit.user_row_id)}, ${sqlValue(audit.auth_id)}, ${sqlValue(appliedValues.stripe_customer_id ?? null)}, ${sqlValue(appliedValues.stripe_subscription_id ?? null)}, ${sqlValue(JSON.stringify(appliedValues))}, ${sqlValue(JSON.stringify(restored))});`
    );
    restored.plan_updated_at = rollbackTimestampIso;
    statements.push(updateStatement(audit.user_row_id, restored));
  }
  return statements.join('\n');
}

// KV keys to invalidate per touched uid (cache only; D1 is authoritative).
export function kvKeysForUid(uid) {
  return [
    `cusByUid:${uid}`,
    `planByUid:${uid}`,
    `billingStatus:${uid}`,
    `trialUsedByUid:${uid}`,
    `trialEndByUid:${uid}`
  ];
}
