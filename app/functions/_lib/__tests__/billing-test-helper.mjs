// Shared test infrastructure for the billing/webhook suites (bare Node,
// node:assert — no framework, matching the repo's existing tests).
//
// Provides:
//   createFakeD1(seed)   — in-memory D1 covering exactly the SQL the billing
//                          code issues, with TRANSACTIONAL batch() (snapshot
//                          + rollback on error), write counting, injectable
//                          failures, and optional unique-index enforcement.
//   createFakeKV()       — Map-backed KV with put/delete tracking.
//   signStripeEvent()    — real HMAC-SHA256 stripe-signature headers.
//   stubStripeFetch()    — route-based fetch stub for api.stripe.com (and
//                          GA4), restoring the real fetch on demand.
//   makeEnv()/makeContext()/postWebhook() — one-call webhook invocation.

import { createHmac, webcrypto } from 'node:crypto';

// Workers provide WebCrypto globally; Node 18 needs the polyfill.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

// ── Fake D1 ──────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

export function createFakeD1(seed = {}) {
  const tables = {
    users: (seed.users || []).map((u, i) => ({ id: u.id ?? i + 1, ...u })),
    deleted_auth_ids: seed.deleted_auth_ids || [],
    feature_daily_usage: seed.feature_daily_usage || [],
    usage_events: seed.usage_events || [],
    stripe_event_ledger: seed.stripe_event_ledger || []
  };
  if (seed.ledgerTableMissing) delete tables.stripe_event_ledger;

  const state = {
    tables,
    writes: 0,               // count of mutating statement executions
    executedSql: [],         // every executed statement (for assertions)
    batches: [],             // arrays of sql executed per batch() call
    failOnSqlIncludes: null, // substring → next matching statement throws
    failError: null,
    enforceUniqueStripeIds: Boolean(seed.enforceUniqueStripeIds)
  };

  const snapshot = () => JSON.parse(JSON.stringify(state.tables));
  const restore = (snap) => { state.tables = snap; };

  function maybeInjectFailure(sql) {
    if (state.failOnSqlIncludes && sql.includes(state.failOnSqlIncludes)) {
      const err = state.failError || new Error(`injected failure for: ${state.failOnSqlIncludes}`);
      state.failOnSqlIncludes = null;
      state.failError = null;
      throw err;
    }
  }

  function requireLedger() {
    if (!state.tables.stripe_event_ledger) {
      throw new Error('no such table: stripe_event_ledger');
    }
    return state.tables.stripe_event_ledger;
  }

  function assertUniqueStripeIds(targetRow, updates) {
    if (!state.enforceUniqueStripeIds) return;
    for (const col of ['stripe_customer_id', 'stripe_subscription_id']) {
      if (updates[col] === undefined || updates[col] === null) continue;
      const clash = state.tables.users.find((u) => u.id !== targetRow.id && u[col] === updates[col]);
      if (clash) throw new Error(`UNIQUE constraint failed: users.${col}`);
    }
  }

  // Parses "SET a = ?, b = datetime('now'), c = NULL" against binds already
  // consumed for earlier placeholders; returns [updates, bindsConsumed].
  function parseSetList(setSql, binds, bindOffset) {
    const updates = {};
    let consumed = bindOffset;
    for (const part of setSql.split(/,(?![^()]*\))/)) {
      const m = part.trim().match(/^(\w+)\s*=\s*(.+)$/s);
      if (!m) throw new Error(`FakeD1: cannot parse SET fragment: ${part}`);
      const [, col, rhs] = m;
      const rhsTrim = rhs.trim();
      if (rhsTrim === '?') updates[col] = binds[consumed++];
      else if (/^\?\d+$/.test(rhsTrim)) updates[col] = binds[Number(rhsTrim.slice(1)) - 1];
      else if (rhsTrim === "datetime('now')") updates[col] = nowIso();
      else if (rhsTrim.toUpperCase() === 'NULL') updates[col] = null;
      else if (/^'([^']*)'$/.test(rhsTrim)) updates[col] = rhsTrim.slice(1, -1);
      else if (rhsTrim === 'attempt_count + 1') updates[col] = { __increment: 'attempt_count' };
      else throw new Error(`FakeD1: unsupported SET rhs: ${rhsTrim}`);
    }
    return [updates, consumed];
  }

  function execute(sql, binds) {
    maybeInjectFailure(sql);
    state.executedSql.push(sql);
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── stripe_event_ledger: atomic claim ──
    if (s.startsWith('INSERT INTO stripe_event_ledger') && s.includes('ON CONFLICT(event_id) DO UPDATE')) {
      const ledger = requireLedger();
      const [eventId, eventType, livemode] = binds;
      const existing = ledger.find((r) => r.event_id === eventId);
      if (!existing) {
        state.writes++;
        ledger.push({
          event_id: eventId, event_type: eventType, livemode,
          status: 'processing', attempt_count: 1,
          received_at: nowIso(), claimed_at: nowIso(), processed_at: null, last_error: null
        });
        return { first: { status: 'processing' }, results: [{ status: 'processing' }] };
      }
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const claimable = existing.status === 'failed'
        || (existing.status === 'processing' && existing.claimed_at <= staleBefore);
      if (claimable) {
        state.writes++;
        existing.status = 'processing';
        existing.attempt_count += 1;
        existing.claimed_at = nowIso();
        existing.last_error = null;
        return { first: { status: 'processing' }, results: [{ status: 'processing' }] };
      }
      return { first: null, results: [] };
    }

    if (s.startsWith('SELECT status FROM stripe_event_ledger WHERE event_id =')) {
      const ledger = requireLedger();
      const row = ledger.find((r) => r.event_id === binds[0]);
      return { first: row ? { status: row.status } : null, results: row ? [{ status: row.status }] : [] };
    }

    if (s.startsWith('UPDATE stripe_event_ledger SET')) {
      const ledger = requireLedger();
      state.writes++;
      if (s.includes("status = 'processed'")) {
        const row = ledger.find((r) => r.event_id === binds[0]);
        if (row) { row.status = 'processed'; row.processed_at = nowIso(); row.last_error = null; }
        return { first: null, results: [] };
      }
      if (s.includes("status = 'failed'")) {
        const row = ledger.find((r) => r.event_id === binds[0]);
        if (row && row.status !== 'processed') { row.status = 'failed'; row.last_error = binds[1]; }
        return { first: null, results: [] };
      }
      throw new Error(`FakeD1: unsupported ledger update: ${s}`);
    }

    // ── users reads ──
    if (/^SELECT id FROM users WHERE \(\(stripe_customer_id IS NOT NULL/.test(s)) {
      const [cus, sub, uid] = binds;
      const row = state.tables.users.find((u) =>
        ((u.stripe_customer_id != null && u.stripe_customer_id === cus)
          || (u.stripe_subscription_id != null && u.stripe_subscription_id === sub))
        && u.auth_id !== uid);
      return { first: row ? { id: row.id } : null, results: row ? [{ id: row.id }] : [] };
    }
    if (s === 'SELECT id FROM users WHERE auth_id = ?') {
      const row = state.tables.users.find((u) => u.auth_id === binds[0]);
      return { first: row ? { id: row.id } : null, results: row ? [{ id: row.id }] : [] };
    }
    if (s.startsWith('SELECT id, auth_id, email, plan, created_at, updated_at FROM users WHERE auth_id')) {
      const row = state.tables.users.find((u) => u.auth_id === binds[0]);
      return { first: row ? { ...row } : null, results: row ? [{ ...row }] : [] };
    }
    if (s.startsWith('SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at, current_period_end, cancel_at, scheduled_plan, scheduled_at, plan_updated_at FROM users WHERE auth_id')) {
      const row = state.tables.users.find((u) => u.auth_id === binds[0]);
      return { first: row ? { ...row } : null, results: row ? [{ ...row }] : [] };
    }
    if (s === 'SELECT email FROM users WHERE auth_id = ?' || s === 'SELECT email, plan FROM users WHERE auth_id = ?') {
      const row = state.tables.users.find((u) => u.auth_id === binds[0]);
      return { first: row ? { email: row.email, plan: row.plan } : null, results: row ? [{ email: row.email, plan: row.plan }] : [] };
    }
    if (s === 'SELECT current_period_start FROM users LIMIT 1') {
      const row = state.tables.users[0];
      return { first: row ? { current_period_start: row.current_period_start ?? null } : null, results: [] };
    }
    if (s === 'SELECT has_ever_paid FROM users WHERE auth_id = ?') {
      const row = state.tables.users.find((u) => u.auth_id === binds[0]);
      return { first: row ? { has_ever_paid: row.has_ever_paid ?? 0 } : null, results: [] };
    }

    // ── deleted_auth_ids ──
    if (s.startsWith('SELECT 1 FROM deleted_auth_ids WHERE auth_id')) {
      const row = state.tables.deleted_auth_ids.find((d) => d.auth_id === binds[0]);
      return { first: row ? { 1: 1 } : null, results: [] };
    }
    if (s.startsWith('SELECT 1 FROM deleted_auth_ids WHERE email')) {
      const row = state.tables.deleted_auth_ids.find((d) => d.email === binds[0]);
      return { first: row ? { 1: 1 } : null, results: [] };
    }

    // ── users insert (getOrCreateUserByAuthId) ──
    if (s.startsWith('INSERT INTO users (auth_id, email')) {
      state.writes++;
      const row = {
        id: state.tables.users.reduce((m, u) => Math.max(m, u.id), 0) + 1,
        auth_id: binds[0], email: binds[1] ?? null, plan: 'free',
        created_at: nowIso(), updated_at: nowIso()
      };
      state.tables.users.push(row);
      return { first: { ...row }, results: [{ ...row }] };
    }

    // ── users dynamic update ──
    const userUpdate = s.match(/^UPDATE users SET (.+) WHERE (auth_id|id) = \?$/);
    if (userUpdate) {
      state.writes++;
      const [updates, consumed] = parseSetList(userUpdate[1], binds, 0);
      const keyVal = binds[consumed];
      const keyCol = userUpdate[2];
      const row = state.tables.users.find((u) => u[keyCol] === keyVal);
      if (row) {
        assertUniqueStripeIds(row, updates);
        for (const [col, v] of Object.entries(updates)) {
          row[col] = (v && typeof v === 'object' && v.__increment) ? (row[v.__increment] || 0) + 1 : v;
        }
      }
      return { first: null, results: [], changes: row ? 1 : 0 };
    }

    // ── usage resets (subquery form, batch-safe) ──
    const usageDelete = s.match(/^DELETE FROM (feature_daily_usage|usage_events) WHERE user_id = \(SELECT id FROM users WHERE auth_id = \?1\) AND feature = \?2$/);
    if (usageDelete) {
      state.writes++;
      const table = usageDelete[1];
      const user = state.tables.users.find((u) => u.auth_id === binds[0]);
      const before = state.tables[table].length;
      state.tables[table] = state.tables[table].filter((r) => !(user && r.user_id === user.id && r.feature === binds[1]));
      return { first: null, results: [], changes: before - state.tables[table].length };
    }

    // ── legacy usage resets (direct user_id form, non-webhook paths) ──
    const legacyUsageDelete = s.match(/^DELETE FROM (feature_daily_usage|usage_events) WHERE user_id = \? AND feature = \?$/);
    if (legacyUsageDelete) {
      state.writes++;
      const table = legacyUsageDelete[1];
      const before = state.tables[table].length;
      state.tables[table] = state.tables[table].filter((r) => !(r.user_id === binds[0] && r.feature === binds[1]));
      return { first: null, results: [], changes: before - state.tables[table].length };
    }

    throw new Error(`FakeD1: unsupported SQL: ${s}`);
  }

  function prepare(sql) {
    const make = (binds) => ({
      sql,
      binds,
      async first() { const r = execute(sql, binds); return r.first ?? null; },
      async all() { const r = execute(sql, binds); return { results: r.results ?? [] }; },
      async run() { const r = execute(sql, binds); return { success: true, meta: { changes: r.changes ?? 0 } }; },
      __execute() { return execute(sql, binds); }
    });
    const stmt = make([]);
    stmt.bind = (...binds) => make(binds);
    return stmt;
  }

  return {
    prepare,
    // Transactional batch: all-or-nothing, like D1.
    async batch(statements) {
      const snap = snapshot();
      const executed = [];
      try {
        const results = [];
        for (const stmt of statements) {
          executed.push(stmt.sql);
          const r = stmt.__execute();
          results.push({ success: true, meta: { changes: r.changes ?? 0 } });
        }
        state.batches.push(executed);
        return results;
      } catch (err) {
        restore(snap);
        state.batches.push({ rolledBack: executed, error: String(err?.message || err) });
        throw err;
      }
    },
    __state: state,
    failNext(substring, error) { state.failOnSqlIncludes = substring; state.failError = error || null; },
    usersByAuthId(uid) { return state.tables.users.find((u) => u.auth_id === uid) || null; },
    ledgerRow(eventId) { return (state.tables.stripe_event_ledger || []).find((r) => r.event_id === eventId) || null; }
  };
}

// ── Fake KV ──────────────────────────────────────────────────────────────

export function createFakeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  const puts = [];
  const deletes = [];
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value, _opts) { puts.push(key); map.set(key, value); },
    async delete(key) { deletes.push(key); map.delete(key); },
    __map: map,
    __puts: puts,
    __deletes: deletes,
    get writeCount() { return puts.length + deletes.length; }
  };
}

// ── Stripe event signing (real HMAC, same scheme the webhook verifies) ──

export function signStripeEvent(secret, payload, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${raw}`).digest('hex');
  return { raw, header: `t=${timestampSeconds},v1=${mac}` };
}

// ── fetch stub ───────────────────────────────────────────────────────────
// routes: [{ match: (url, init) => boolean | string prefix, reply: (url, init) => ({status, json}) | object }]

export function stubStripeFetch(routes = []) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const route of routes) {
      const hit = typeof route.match === 'string' ? u.includes(route.match) : route.match(u, init);
      if (hit) {
        const reply = typeof route.reply === 'function' ? await route.reply(u, init) : route.reply;
        const status = reply.status ?? 200;
        const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? '');
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    // Default: swallow GA4/unknown telemetry quietly, fail Stripe loudly.
    if (u.includes('google-analytics.com')) return new Response('{}', { status: 200 });
    throw new Error(`stubStripeFetch: unstubbed fetch to ${u}`);
  };
  return {
    calls,
    restore() { globalThis.fetch = realFetch; }
  };
}

// ── Env / context / webhook invocation ──────────────────────────────────

export const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_suite';

export function makeEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'prod',
    STRIPE_SECRET_KEY: 'sk_live_fake_suite_key',
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    STRIPE_PRICE_ESSENTIAL_MONTHLY: 'price_essential_test',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
    STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
    FRONTEND_URL: 'https://app.jobhackai.io',
    ...overrides
  };
}

export function makeContext(env, request) {
  const waited = [];
  return {
    context: {
      request,
      env,
      waitUntil(p) { waited.push(Promise.resolve(p).catch(() => {})); }
    },
    waited,
    async settle() { await Promise.all(waited); }
  };
}

export async function postWebhook(onRequest, env, event, { secret = TEST_WEBHOOK_SECRET, timestamp } = {}) {
  const { raw, header } = signStripeEvent(secret, event, timestamp);
  const request = new Request('https://app.jobhackai.io/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': header, 'Content-Type': 'application/json' },
    body: raw
  });
  const { context, settle } = makeContext(env, request);
  const response = await onRequest(context);
  await settle();
  return response;
}

// ── Common fixtures ──────────────────────────────────────────────────────

let eventCounter = 0;
export function makeEvent(type, object, { livemode = true, id, created } = {}) {
  eventCounter += 1;
  return {
    id: id || `evt_test_${String(eventCounter).padStart(5, '0')}`,
    type,
    livemode,
    created: created ?? Math.floor(Date.now() / 1000),
    data: { object }
  };
}

export function makeSubscription({
  id = 'sub_testsub001',
  customer = 'cus_testcus001',
  status = 'active',
  priceId = 'price_essential_test',
  metadata = {},
  itemPeriodStart,
  itemPeriodEnd,
  rootPeriodStart,
  rootPeriodEnd,
  items,
  trialEnd = null,
  extra = {}
} = {}) {
  const sub = {
    id, customer, status, metadata,
    trial_end: trialEnd,
    cancel_at_period_end: false,
    currency: 'usd',
    items: {
      data: items ?? [{
        price: { id: priceId, unit_amount: 2900 },
        quantity: 1,
        ...(itemPeriodStart !== undefined ? { current_period_start: itemPeriodStart } : {}),
        ...(itemPeriodEnd !== undefined ? { current_period_end: itemPeriodEnd } : {})
      }]
    },
    ...extra
  };
  if (rootPeriodStart !== undefined) sub.current_period_start = rootPeriodStart;
  if (rootPeriodEnd !== undefined) sub.current_period_end = rootPeriodEnd;
  return sub;
}

export async function assertRejectsOrFalse(fn) {
  try { return Boolean(await fn()) === false; } catch { return true; }
}
