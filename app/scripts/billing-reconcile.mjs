#!/usr/bin/env node
// One-time billing reconciliation — LOCAL OPERATOR TOOL (never deployed).
//
//   node app/scripts/billing-reconcile.mjs [--preflight] --env=prod|qa|dev   (default mode; read-only)
//   node app/scripts/billing-reconcile.mjs --verify --env=...                (duplicate scan = migration-023 gate)
//   node app/scripts/billing-reconcile.mjs --apply --allowlist=<file> --run-id=<id> --env=...
//   node app/scripts/billing-reconcile.mjs --rollback --run-id=<id> --env=...
//
// Requirements:
//   * wrangler authenticated locally (see app/scripts/API_TOKEN_SETUP.md)
//   * STRIPE_SECRET_KEY in the shell env for preflight/apply verification
//     (read-only GETs; the key is never printed and never written to disk;
//     repairs against --env=prod refuse to run unless the key is live-mode)
//   * price→plan mapping via STRIPE_PRICE_{ESSENTIAL,PRO,PREMIUM}_MONTHLY
//     (or PRICE_* variants) so LEGIT rows backfill without guessing
//   * KV namespace id via JOBHACKAI_KV_NAMESPACE_ID for cache invalidation
//
// Guarantees:
//   * preflight/verify perform ZERO writes (SELECTs + Stripe GETs only)
//   * apply re-runs preflight and ABORTS on any drift from the allowlist
//   * every touched row gets a before/after audit record in
//     billing_repair_audit, in the SAME transactional batch as its UPDATE
//     (one `wrangler d1 execute --file` invocation)
//   * no DELETE statements exist anywhere in this tool
//   * rollback restores the audit's before-images by run id

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyAll,
  compareToAllowlist,
  buildApplySql,
  buildRollbackSql,
  duplicateGroups,
  kvKeysForUid,
  assertSafeRunId,
  assertSafeStripeId,
  subLast4
} from './lib/billing-reconcile-core.mjs';

const DB_BY_ENV = {
  prod: 'jobhackai-prod-db',
  qa: 'jobhackai-qa-db',
  dev: 'jobhackai-dev-db'
};

const ROW_QUERY = `SELECT id, auth_id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, trial_ends_at, cancel_at, scheduled_plan, scheduled_at, has_ever_paid, plan_updated_at FROM users WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL OR subscription_status IS NOT NULL OR plan != 'free'`;

function parseArgs(argv) {
  const args = { mode: 'preflight' };
  for (const a of argv.slice(2)) {
    if (a === '--preflight') args.mode = 'preflight';
    else if (a === '--verify') args.mode = 'verify';
    else if (a === '--apply') args.mode = 'apply';
    else if (a === '--rollback') args.mode = 'rollback';
    else if (a.startsWith('--env=')) args.env = a.slice(6);
    else if (a.startsWith('--allowlist=')) args.allowlist = a.slice(12);
    else if (a.startsWith('--run-id=')) args.runId = a.slice(9);
    else if (a.startsWith('--report=')) args.report = a.slice(9);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.env || !DB_BY_ENV[args.env]) {
    throw new Error(`--env=prod|qa|dev is required (explicit target, no default)`);
  }
  return args;
}

function wranglerD1Json(db, sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', `--command=${sql}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024
  });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? [];
}

function wranglerD1File(db, filePath) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', `--file=${filePath}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit']
  });
}

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required in the shell env for Stripe verification');
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function testModeHint(body) {
  return String(body?.error?.message || '').toLowerCase().includes('exists in test mode');
}

function priceToPlanFromEnv(priceId) {
  const env = process.env;
  const essential = env.STRIPE_PRICE_ESSENTIAL_MONTHLY || env.PRICE_ESSENTIAL_MONTHLY || env.STRIPE_PRICE_ESSENTIAL || env.PRICE_ESSENTIAL;
  const pro = env.STRIPE_PRICE_PRO_MONTHLY || env.PRICE_PRO_MONTHLY || env.STRIPE_PRICE_PRO || env.PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.PRICE_PREMIUM_MONTHLY || env.STRIPE_PRICE_PREMIUM || env.PRICE_PREMIUM;
  if (priceId && priceId === essential) return 'essential';
  if (priceId && priceId === pro) return 'pro';
  if (priceId && priceId === premium) return 'premium';
  return null;
}

const toIso = (epoch) => (Number.isFinite(Number(epoch)) && Number(epoch) > 0 ? new Date(Number(epoch) * 1000).toISOString() : null);

// Same explicit single-item rule as the app (readSubscriptionPeriod): root
// fields, else exactly one (plan-mapped) item; ambiguity aborts — the
// reconciliation never writes a guessed date.
function periodFromSubscription(sub) {
  const rootStart = toIso(sub.current_period_start);
  const rootEnd = toIso(sub.current_period_end);
  if (rootStart || rootEnd) return { start: rootStart, end: rootEnd };
  const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
  let candidates = items;
  if (candidates.length > 1) {
    const mapped = candidates.filter((i) => priceToPlanFromEnv(i?.price?.id));
    if (mapped.length === 1) candidates = mapped;
  }
  if (candidates.length !== 1) throw new Error(`subscription ${subLast4(sub.id)}: ambiguous or missing period item — refusing to guess`);
  return { start: toIso(candidates[0]?.current_period_start), end: toIso(candidates[0]?.current_period_end) };
}

async function verifyRowAgainstStripe(row) {
  const state = { subscription: null, customer: null, raw: {} };
  if (row.stripe_subscription_id) {
    assertSafeStripeId(row.stripe_subscription_id, 'subscription');
    const { status, body } = await stripeGet(`/subscriptions/${row.stripe_subscription_id}`);
    if (status === 200) {
      state.subscription = {
        found: true,
        status: body.status,
        customerId: body.customer,
        priceId: body.items?.data?.[0]?.price?.id || null
      };
      state.raw.subscription = body;
    } else if (status === 404) {
      state.subscription = { found: false, testModeHint: testModeHint(body) };
    } else {
      throw new Error(`stripe subscription lookup failed (${status}) for row ${row.id} — aborting (transient?)`);
    }
  }
  if (row.stripe_customer_id) {
    assertSafeStripeId(row.stripe_customer_id, 'customer');
    const { status, body } = await stripeGet(`/customers/${row.stripe_customer_id}`);
    if (status === 200) {
      state.customer = { found: true, deleted: body.deleted === true, firebaseUid: body.metadata?.firebaseUid || null };
      state.raw.customer = body;
    } else if (status === 404) {
      state.customer = { found: false, testModeHint: testModeHint(body) };
    } else {
      throw new Error(`stripe customer lookup failed (${status}) for row ${row.id} — aborting (transient?)`);
    }

    // Sub-less rows: a missing D1 subscription id is not proof that no
    // subscription exists. List the customer's LIVE subscriptions so the
    // classifier can distinguish a false paid claim (verified empty →
    // repair to free) from an unlinked real subscription (→ operator
    // resolution, never auto-freed).
    if (!row.stripe_subscription_id && state.customer.found && !state.customer.deleted) {
      const list = await stripeGet(`/subscriptions?customer=${row.stripe_customer_id}&status=all&limit=25`);
      if (list.status !== 200) {
        throw new Error(`stripe subscription list failed (${list.status}) for row ${row.id} — aborting (transient?)`);
      }
      state.customerSubscriptions = { statuses: (list.body?.data || []).map((s) => s?.status).filter(Boolean) };
    }
  }
  return state;
}

async function runPreflight(db) {
  const rows = wranglerD1Json(db, ROW_QUERY);
  const stripeStateByRowId = {};
  for (const row of rows) {
    stripeStateByRowId[row.id] = await verifyRowAgainstStripe(row);
  }
  const classification = classifyAll(rows, stripeStateByRowId);
  return { rows, stripeStateByRowId, classification };
}

function buildLegitBackfill(classification, stripeStateByRowId, rows) {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const backfill = {};
  for (const entry of classification.classes.LEGIT || []) {
    const state = stripeStateByRowId[entry.id];
    const sub = state.raw.subscription;
    const row = rowById.get(entry.id);
    const plan = priceToPlanFromEnv(sub.items?.data?.[0]?.price?.id);
    if (!plan) throw new Error(`legit row ${entry.id}: subscription price does not map to a known plan (set STRIPE_PRICE_* env vars) — refusing to guess`);
    const period = periodFromSubscription(sub);
    backfill[entry.id] = {
      plan,
      subscription_status: sub.status,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      current_period_start: period.start,
      current_period_end: period.end,
      trial_ends_at: toIso(sub.trial_end),
      cancel_at: (sub.cancel_at_period_end && sub.cancel_at) ? toIso(sub.cancel_at) : null
    };
  }
  return backfill;
}

function printReport(classification, reportPath) {
  const report = {
    generated_for: 'billing-reconcile',
    counts: classification.counts,
    classes: classification.classes,
    duplicates: classification.duplicates,
    repairRowIds: classification.repairRowIds,
    readyForUniqueIndex: classification.readyForUniqueIndex
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (reportPath) {
    writeFileSync(reportPath, text);
    console.log(`\nreport written to ${reportPath}`);
  }
}

function invalidateKvForUids(uids) {
  const namespaceId = process.env.JOBHACKAI_KV_NAMESPACE_ID;
  if (!namespaceId) {
    console.warn('JOBHACKAI_KV_NAMESPACE_ID not set — skipping KV invalidation. Run it manually for each touched uid (cusByUid/planByUid/billingStatus/trialUsedByUid/trialEndByUid).');
    return;
  }
  for (const uid of uids) {
    for (const key of kvKeysForUid(uid)) {
      try {
        execFileSync('npx', ['wrangler', 'kv', 'key', 'delete', key, `--namespace-id=${namespaceId}`, '--remote'], {
          encoding: 'utf8',
          stdio: ['ignore', 'ignore', 'inherit']
        });
      } catch (e) {
        console.warn(`KV delete failed for ${key} (non-fatal — cache expires on its own): ${e?.message || e}`);
      }
    }
  }
}

function requireLiveKeyForProd(envName) {
  if (envName !== 'prod') return;
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  if (!key.startsWith('sk_live_') && !key.startsWith('rk_live_')) {
    throw new Error('refusing to run against prod without a live-mode STRIPE_SECRET_KEY (verification would be meaningless)');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const db = DB_BY_ENV[args.env];
  console.log(`billing-reconcile: mode=${args.mode} env=${args.env} db=${db}`);

  if (args.mode === 'verify') {
    const rows = wranglerD1Json(db, ROW_QUERY);
    const dups = duplicateGroups(rows);
    console.log(JSON.stringify({ duplicates: dups, readyForUniqueIndex: dups.length === 0 }, null, 2));
    process.exitCode = dups.length === 0 ? 0 : 2;
    return;
  }

  if (args.mode === 'preflight') {
    requireLiveKeyForProd(args.env);
    const { classification } = await runPreflight(db);
    printReport(classification, args.report);
    return;
  }

  if (args.mode === 'apply') {
    requireLiveKeyForProd(args.env);
    if (!args.allowlist) throw new Error('--apply requires --allowlist=<file> (the operator-approved preflight sets)');
    assertSafeRunId(args.runId || '');
    const allowlist = JSON.parse(readFileSync(args.allowlist, 'utf8'));

    // Recheck Stripe immediately before writing; abort on any drift.
    const { rows, stripeStateByRowId, classification } = await runPreflight(db);
    const drift = compareToAllowlist(classification, allowlist);
    if (!drift.ok) {
      console.error('ABORTING — classification drifted from the approved allowlist:');
      for (const m of drift.mismatches) console.error(`  * ${m}`);
      process.exitCode = 3;
      return;
    }

    const legitBackfill = buildLegitBackfill(classification, stripeStateByRowId, rows);
    const sql = buildApplySql(args.runId, rows, classification, allowlist, legitBackfill, new Date().toISOString());
    const dir = mkdtempSync(join(tmpdir(), 'billing-reconcile-'));
    const sqlPath = join(dir, `apply-${args.runId}.sql`);
    writeFileSync(sqlPath, sql);
    console.log(`apply batch written to ${sqlPath} (${sql.split('\n').length} statements); executing as ONE transactional batch...`);
    wranglerD1File(db, sqlPath);
    console.log('apply committed.');

    const touchedUids = [...(allowlist.legit || []), ...(allowlist.repair || [])].map((r) => r.auth_id);
    invalidateKvForUids(touchedUids);
    console.log(`done. verify with: SELECT COUNT(*) FROM billing_repair_audit WHERE run_id='${args.runId}';`);
    return;
  }

  if (args.mode === 'rollback') {
    assertSafeRunId(args.runId || '');
    const auditRows = wranglerD1Json(db, `SELECT * FROM billing_repair_audit WHERE run_id = '${args.runId}' AND mode = 'apply' ORDER BY id`);
    const sql = buildRollbackSql(args.runId, auditRows, new Date().toISOString());
    const dir = mkdtempSync(join(tmpdir(), 'billing-reconcile-'));
    const sqlPath = join(dir, `rollback-${args.runId}.sql`);
    writeFileSync(sqlPath, sql);
    console.log(`rollback batch written to ${sqlPath}; executing as ONE transactional batch...`);
    wranglerD1File(db, sqlPath);
    console.log('rollback committed.');
    invalidateKvForUids(auditRows.map((a) => a.auth_id));
    return;
  }
}

main().catch((err) => {
  console.error(`billing-reconcile failed: ${err?.message || err}`);
  process.exitCode = 1;
});
