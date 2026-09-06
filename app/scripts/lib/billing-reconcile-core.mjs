// Pure logic for the one-time billing reconciliation (no I/O, no wrangler,
// no fetch) so every decision the operator relies on is unit-testable in
// bare Node: classification, allowlist drift comparison, SQL generation,
// rollback SQL, the credential-mode guard and the rollback-ordering guard.
// The CLI shell (../billing-reconcile.mjs) supplies row data from D1 and
// verification state from live Stripe. The only import is the app's pure
// Stripe-environment module, so key-mode rules have exactly one definition.

import { keyMode, resolveExpectedLivemode } from '../../functions/_lib/stripe-environment.js';
//
// Classifications (per the hotfix plan):
//   LEGIT               — live entitled subscription (active/trialing/past_due/unpaid) + live customer
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
//
// dev0 voice plans: 'weekly' and 'monthly' are subscription-backed paid
// plans and classify exactly like the legacy tiers. 'pack' (Interview Pack)
// is a ONE-TIME purchase whose entitlement lives in voice credit columns
// (voice_sessions_remaining / pack_expires_at), never in a subscription: a
// pack row makes no subscription claim, so it is CUSTOMER_ONLY_KEEP /
// FREE_CLEAN on its own, and when a pack row does need a repair (stale
// subscription id, foreign customer) the repair clears only the
// subscription claim and keeps plan='pack'. Credits are never touched:
// none of the voice columns are BILLING_FIELDS.

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

// Subscription-backed paid plans (legacy tiers + dev0 voice subscriptions).
// 'pack' is deliberately ABSENT: listing it would turn every pack buyer with
// a Stripe customer into a CUSTOMER_ONLY_PAID_CLAIM and free them — a valid
// pack purchase is never billing residue.
const PAID_PLANS = new Set(['weekly', 'monthly', 'essential', 'pro', 'premium']);
const PACK_PLAN = 'pack';
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
      const liveStatus = ENTITLED_STATUSES.has(sub.status);
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

// ── Credential mode guard (runs BEFORE any network access) ───────────────
// prod requires a LIVE key (sk_live_/rk_live_); qa and dev require a TEST key
// (sk_test_/rk_test_). A missing or mismatched key is refused up front so a
// preflight/apply can never verify one environment's rows against the other
// Stripe mode. Messages never include the key.
export function assertCredentialModeForEnv(envName, key) {
  const { expected, configError } = resolveExpectedLivemode({ ENVIRONMENT: envName });
  if (configError) throw new Error(`unknown --env "${envName}" (expected prod|qa|dev)`);
  const want = expected ? 'live' : 'test';
  if (!key || typeof key !== 'string') {
    throw new Error(`STRIPE_SECRET_KEY is required for --env=${envName}: a ${want}-mode secret or restricted key (sk_${want}_… / rk_${want}_…). Nothing was contacted.`);
  }
  const mode = keyMode({ STRIPE_SECRET_KEY: key });
  if (mode !== want) {
    throw new Error(`STRIPE_SECRET_KEY is not a ${want}-mode key: --env=${envName} requires sk_${want}_… or rk_${want}_… (got a ${mode || 'non-Stripe/unknown'} key). Refusing before any network access.`);
  }
  return { mode };
}

// ── Stripe account pin ───────────────────────────────────────────────────
// Rows reference objects that exist in exactly one Stripe account (or
// sandbox). Verifying them with a key for a DIFFERENT account makes every
// valid object look missing (404), and "missing" is what the repair set is
// built from. The operator therefore names the expected account and the CLI
// compares it with GET /v1/account before any row is inspected; the report
// and the allowlist carry the account so an allowlist can never be applied
// under another one.
export function assertSafeStripeAccountId(id) {
  if (typeof id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(id)) {
    throw new Error('--stripe-account must be the Stripe account id these rows belong to (acct_…)');
  }
  return id;
}

export function assertStripeAccountMatches(expected, actual) {
  assertSafeStripeAccountId(expected);
  if (typeof actual !== 'string' || !actual) {
    throw new Error('could not read the Stripe account identity (GET /v1/account); refusing to inspect any row');
  }
  if (actual !== expected) {
    throw new Error(`STRIPE_SECRET_KEY belongs to Stripe account ${actual} but --stripe-account expects ${expected}: verifying these rows against another account or sandbox would classify every valid object as missing — refusing before any row is inspected`);
  }
  return actual;
}

// Cross-account/mode smell: when (almost) every verified object is missing,
// the key almost certainly belongs to a different account, sandbox or mode
// than the rows. A 404 is never on its own authorization to downgrade.
export function notFoundSignal(stripeStateByRowId, { minChecked = 5, threshold = 0.8 } = {}) {
  let checked = 0;
  let notFound = 0;
  for (const state of Object.values(stripeStateByRowId || {})) {
    for (const obj of [state?.subscription, state?.customer]) {
      if (obj && typeof obj.found === 'boolean') {
        checked += 1;
        if (!obj.found) notFound += 1;
      }
    }
  }
  const ratio = checked > 0 ? notFound / checked : 0;
  return { checked, notFound, ratio: Number(ratio.toFixed(3)), massNotFound: checked >= minChecked && ratio >= threshold };
}

// ── Rollback ordering guard ──────────────────────────────────────────────
// Restoring before-images that carry Stripe ids while migration 023's unique
// indexes exist fails on the first collision. The batch is atomic (nothing
// lands), but the operator must follow the ordering: (1) roll code back if it
// depends on unique ids, (2) DROP the 023 unique indexes and restore the
// ordinary index, (3) run the data rollback, (4) keep 022. This computes the
// post-rollback duplicate groups so the CLI can refuse early with that
// instruction. currentRows must include every row that holds a Stripe id AND
// every row the rollback touches (touched rows may hold NULLs now).
export function findRollbackIdCollisions(auditRows, currentRows) {
  const restoredById = new Map();
  for (const a of (auditRows || []).filter((r) => r.mode === 'apply')) {
    const old = JSON.parse(a.old_values_json);
    restoredById.set(a.user_row_id, {
      stripe_customer_id: old.stripe_customer_id ?? null,
      stripe_subscription_id: old.stripe_subscription_id ?? null
    });
  }
  const collisions = [];
  for (const field of ['stripe_customer_id', 'stripe_subscription_id']) {
    const holders = new Map();
    for (const row of currentRows || []) {
      const restored = restoredById.get(row.id);
      const value = restored ? restored[field] : row[field];
      if (!value) continue;
      if (!holders.has(value)) holders.set(value, new Set());
      holders.get(value).add(row.id);
    }
    for (const [value, ids] of holders) {
      if (ids.size > 1) collisions.push({ field, valueLast4: String(value).slice(-4), rowIds: [...ids].sort((a, b) => a - b) });
    }
  }
  return collisions;
}

export const ROLLBACK_ORDER_INSTRUCTIONS = [
  '1) roll the CODE back first if the deployed build depends on unique Stripe ids',
  "2) drop migration 023's unique indexes and restore the ordinary index:",
  '   DROP INDEX IF EXISTS idx_users_stripe_customer_id_unique;',
  '   DROP INDEX IF EXISTS idx_users_stripe_subscription_id_unique;',
  '   CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);',
  '3) re-run this --rollback (the data restore)',
  '4) keep migration 022 while any hotfix code is deployed (the webhook fails closed without the ledger)'
];

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

function rowBeforeImagePredicate(row) {
  return [`id = ${assertSafeRowId(row.id)}`, `auth_id IS ${sqlValue(row.auth_id)}`,
    ...BILLING_FIELDS.map((f) => `${f} IS ${sqlValue(row[f] ?? null)}`)].join(' AND ');
}

function auditInsert(runId, mode, row, newValues, { reserveRunId = false } = {}) {
  const oldValues = {};
  for (const f of BILLING_FIELDS) oldValues[f] = row[f] ?? null;
  // Run-id reservation, atomic with the batch: on the FIRST audit row of an
  // apply, new_values_json (NOT NULL) is nulled out if any audit row already
  // exists for this run id, so the whole transactional batch fails instead of
  // interleaving two applies under one id. The CLI's pre-check gives a clear
  // error early but cannot exclude a concurrent invocation on its own.
  const newJson = sqlValue(JSON.stringify(newValues));
  const refusalConditions = [];
  if (reserveRunId) refusalConditions.push(`EXISTS (SELECT 1 FROM billing_repair_audit WHERE run_id = ${sqlValue(runId)})`);
  // Executed inside the same transaction as the update. A deleted row,
  // changed owner, or newer billing write aborts every audit/update in this
  // run instead of silently overwriting a post-preflight subscription.
  if (mode === 'apply') refusalConditions.push(`NOT EXISTS (SELECT 1 FROM users WHERE ${rowBeforeImagePredicate(row)})`);
  const newValuesExpr = refusalConditions.length
    ? `CASE WHEN ${refusalConditions.join(' OR ')} THEN NULL ELSE ${newJson} END`
    : newJson;
  return `INSERT INTO billing_repair_audit (run_id, mode, user_row_id, auth_id, stripe_customer_id, stripe_subscription_id, old_values_json, new_values_json) VALUES (${sqlValue(runId)}, ${sqlValue(mode)}, ${assertSafeRowId(row.id)}, ${sqlValue(row.auth_id)}, ${sqlValue(row.stripe_customer_id)}, ${sqlValue(row.stripe_subscription_id)}, ${sqlValue(JSON.stringify(oldValues))}, ${newValuesExpr});`;
}

function updateStatement(rowId, newValues, beforeImage = null) {
  const sets = BILLING_FIELDS.map((f) => `${f} = ${sqlValue(newValues[f])}`).join(', ');
  return `UPDATE users SET ${sets}, updated_at = datetime('now') WHERE ${beforeImage ? rowBeforeImagePredicate(beforeImage) : `id = ${assertSafeRowId(rowId)}`};`;
}

/**
 * Build the full apply batch: for every touched row, an audit INSERT
 * (before+after images) followed by the UPDATE. Executed by the CLI as ONE
 * `wrangler d1 execute --file` invocation (transactional batch). Contains
 * no DELETE statements by construction. The first audit INSERT doubles as
 * an atomic run-id reservation (see auditInsert).
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
    statements.push(auditInsert(runId, 'apply', row, newValues, { reserveRunId: statements.length === 0 }));
    statements.push(updateStatement(row.id, newValues, row));
  }

  for (const entry of allowlist.repair || []) {
    const row = rowById.get(entry.id);
    if (!row) throw new Error(`repair row ${entry.id} not present in row data`);
    if (row.auth_id !== entry.auth_id) throw new Error(`repair row ${entry.id} auth_id drifted — refusing`);
    const keepCustomer = (classification.classes.MIXED || []).some((r) => r.id === entry.id)
      || (classification.classes.CUSTOMER_ONLY_PAID_CLAIM || []).some((r) => r.id === entry.id)
      || (classification.classes.CUSTOMER_ONLY_KEEP || []).some((r) => r.id === entry.id);
    const newValues = {
      // The pack label is credit-backed, not subscription-backed: a repair
      // clears the subscription claim and leaves a pack buyer on 'pack'.
      plan: row.plan === PACK_PLAN ? PACK_PLAN : 'free',
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
    statements.push(auditInsert(runId, 'apply', row, newValues, { reserveRunId: statements.length === 0 }));
    statements.push(updateStatement(row.id, newValues, row));
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
