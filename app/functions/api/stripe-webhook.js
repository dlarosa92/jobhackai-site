// Stripe webhook — hardened write path (billing integrity hotfix).
//
// Request lifecycle:
//   1. Signature verification (constant-time HMAC, 5-minute tolerance).
//   2. Mode gate: production processes ONLY live events, qa/dev ONLY test
//      events; unknown ENVIRONMENT is a config error (503). Wrong-mode
//      events are acknowledged with ZERO D1 and ZERO KV writes.
//   3. Durable idempotency claim in stripe_event_ledger (migration 022 —
//      hard pre-deploy dependency; missing ledger fails closed with 503).
//      KV is a performance aid only: the evt: marker is written only after
//      a successful commit, the processing: lock only damps races.
//   4. Handlers COMPUTE their critical writes (prepared statements) and
//      queue side effects; they perform no billing writes themselves.
//   5. One atomic db.batch() commits every critical write PLUS the ledger
//      processed-mark, so billing state and idempotency can never diverge
//      across a crash. Non-D1 effects (KV caches, GA4, email) run only
//      after the batch commits: at-most-once, never duplicated.
//   6. Critical failures (unresolved owner, ownership conflict, ambiguous
//      period, write failure) mark the ledger row 'failed' and return 5xx
//      so Stripe retries and operators can see stuck events:
//        SELECT * FROM stripe_event_ledger WHERE status='failed';
//   7. One-time payments (dev0 Interview Pack) never enter the subscription
//      plan-mapping path: checkout.session.completed with mode=payment is
//      routed to stagePackGrant, whose credit writes ride the same atomic
//      batch as the processed-mark (see stagePackGrant for how the legacy
//      stripe_event_log from voice migration 020 is reconciled).
//
//   8. The processed-mark is recipient-guarded: when a handler staged a
//      users-row write, the mark refuses (NOT NULL violation → whole batch
//      rolls back → retryable) if that row no longer exists at commit time,
//      so an event can never be marked processed with credits or a plan
//      write that landed on no row.
//   9. Environment gate (test-mode sub-environments): objects stamped
//      metadata.environment for ANOTHER environment are acknowledged with
//      zero writes — see stripe-environment.js for why and for its limits.
//  10. Fulfillment eligibility: a Checkout Session grants entitlement only
//      when the re-fetched session is status=complete AND payment_status is
//      paid (or no_payment_required, e.g. a 100% promotion code). A completed
//      session whose payment_status is still 'unpaid' (delayed payment
//      methods) is a recorded no-op; Stripe's later
//      checkout.session.async_payment_succeeded (same handler, now paid) is
//      what fulfils it, and async_payment_failed fulfils nothing. A
//      subscription-mode session fulfils only through its subscription, and
//      only while that subscription is in an entitled status.
//  11. Invoice shape: Stripe API 2025-03-31.basil and later (this account's
//      default AND the pinned endpoint versions) moved invoice.subscription
//      and invoice.subscription_details to invoice.parent.subscription_details;
//      both shapes are read.
//
// KV marker keys (evtl:/processing:) are scoped by ENVIRONMENT because dev
// and QA share one Stripe test-mode account (every test event is delivered
// to both webhooks) AND one KV namespace: an unscoped marker written by one
// environment would short-circuit the other environment's delivery and its
// D1 would silently miss the event. The ledger (per-D1) stays authoritative.

import {
  getUserPlanData,
  getDb,
  getOrCreateUserByAuthId,
  isDeletedUser,
  buildUserPlanUpdateStatement,
  buildResetFeatureDailyUsageStatement,
  buildResetUsageEventsStatement
} from '../_lib/db.js';
import { stripe, pickBestSubscription, invalidateBillingCaches } from '../_lib/billing-utils.js';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '../_lib/billing-ownership.js';
import { buildPackGrantStatements, PACK_SESSION_COUNT } from '../_lib/voice-entitlements.js';
import {
  resolveExpectedLivemode, assertStripeKeyMatchesEnvironment, redactId, normalizeEnvironmentName,
  canonicalEnvironmentName, canonicalizeEnvironmentStamp, eventEnvironmentStamp, isForeignEnvironmentStamp
} from '../_lib/stripe-environment.js';
import { resolveOwnerUid, assertNoCrossUserStripeIds, readSubscriptionPeriod, TransientStripeError } from '../_lib/stripe-identity.js';
import { claimEvent, buildMarkProcessedStatement, markEventFailed, RECIPIENT_GUARD_ERROR } from '../_lib/stripe-event-ledger.js';
import { sendEmail } from '../_lib/email.js';
import { subscriptionCancelledEmail, paymentFailedEmail } from '../_lib/email-templates.js';

// GA4 Measurement Protocol: post a server-side conversion event so that
// trial starts and paid subscriptions show up in GA4 alongside client-side
// events. Requires GA4_MEASUREMENT_ID + GA4_API_SECRET to be configured in
// the worker environment; silently no-ops otherwise so checkout never
// fails when analytics is unconfigured (e.g. preview environments).
async function sendGa4Event(env, { clientId, userId, name, params }) {
  try {
    const measurementId = env.GA4_MEASUREMENT_ID || env.NEXT_PUBLIC_GA_ID;
    const apiSecret = env.GA4_API_SECRET;
    if (!measurementId || !apiSecret || !clientId) return;
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const body = {
      client_id: clientId,
      ...(userId ? { user_id: String(userId) } : {}),
      events: [{ name, params }],
      non_personalized_ads: false
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.warn(`[WEBHOOK] GA4 MP returned ${res.status} for event ${name}`);
    }
  } catch (mpErr) {
    console.warn('[WEBHOOK] GA4 MP error (non-blocking):', mpErr?.message || mpErr);
  }
}

/** Subscription list price in dollars (Stripe `unit_amount` is cents); null if missing. */
function subscriptionPriceAmountDollars(subscription) {
  const cents = subscription?.items?.data?.[0]?.price?.unit_amount;
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

// Returns null for unrecognized plans so callers can detect a missing price
// (e.g. a new paid plan added to isPaidPlan but not mapped here) instead of
// silently sending value: 0 to GA4 and distorting revenue reports.
function hardcodedPlanAmountDollars(plan) {
  if (plan === 'weekly') return 17;
  if (plan === 'monthly') return 34;
  if (plan === 'pack') return 39;
  if (plan === 'essential') return 29;
  if (plan === 'pro') return 59;
  if (plan === 'premium') return 99;
  return null;
}

// Handler outcomes:
//   { kind: 'ok' }                 — critical writes staged in ctx; commit them.
//   { kind: 'noop', note }         — deliberate no-op; commit just the processed-mark.
//   { kind: 'transient', reason }  — retryable failure; ledger 'failed' + 503.
//   { kind: 'critical', reason }   — identity/ownership/period failure; ledger 'failed' + 500.
const ok = () => ({ kind: 'ok' });
const noop = (note) => ({ kind: 'noop', note });
const transient = (reason) => ({ kind: 'transient', reason });
const critical = (reason) => ({ kind: 'critical', reason });

export async function onRequest(context) {
  const { request, env } = context;
  const origin = env.FRONTEND_URL || 'https://dev.jobhackai.io';
  const respHeaders = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: respHeaders });

  // Read raw body for signature verification
  const raw = await request.text();
  const valid = await verifyStripeWebhook(env, request, raw);
  if (!valid) return new Response('Invalid signature', { status: 401, headers: respHeaders });

  const event = JSON.parse(raw);
  if (!event?.id || typeof event.id !== 'string') {
    return new Response('malformed event', { status: 400, headers: respHeaders });
  }

  // ── Mode gate (ZERO-WRITE: nothing below has touched D1 or KV yet) ──
  // A valid signature only proves the sender holds OUR webhook secret; it says
  // nothing about live vs test mode. Production may only process live events,
  // QA/dev may only process test events. A validly signed event from the wrong
  // mode is acknowledged (200) so Stripe does not retry it forever, but it
  // must never populate production storage — no ledger row, no KV markers.
  const modeResolution = resolveExpectedLivemode(env);
  if (modeResolution.configError) {
    console.error('[WEBHOOK] ENVIRONMENT unset or unrecognized; refusing event (fail closed)');
    return new Response('configuration error', { status: 503, headers: respHeaders });
  }
  const keyCheck = assertStripeKeyMatchesEnvironment(env);
  if (!keyCheck.ok) {
    console.error(`[WEBHOOK] stripe key/environment mismatch: ${keyCheck.reason}`);
    return new Response('configuration error', { status: 503, headers: respHeaders });
  }
  if (event.livemode !== modeResolution.expected) {
    console.warn(`[WEBHOOK] mode_mismatch type=${event.type} livemode=${event.livemode} expected=${modeResolution.expected} evt=${redactId(event.id)} — ignored with zero writes`);
    return new Response('[ignored-wrong-mode]', { status: 200, headers: respHeaders });
  }

  // ── Environment gate (ZERO-WRITE). Dev and QA share one Stripe test-mode
  // account, so both receive every test event. Objects this environment did
  // not create — stamped metadata.environment for another environment — are
  // acknowledged so Stripe stops retrying, and touch neither D1 nor KV.
  // Un-stamped objects are processed as before. Defence in depth only: the
  // OTHER environment's webhook decides for itself (see stripe-environment.js).
  const environmentStamp = eventEnvironmentStamp(event);
  if (isForeignEnvironmentStamp(env, environmentStamp)) {
    console.warn(`[WEBHOOK] environment_mismatch type=${event.type} stamp=${environmentStamp} expected=${canonicalEnvironmentName(env)} evt=${redactId(event.id)} — ignored with zero writes`);
    return new Response('[ignored-other-environment]', { status: 200, headers: respHeaders });
  }

  // ── KV fast-path (performance aid, read-only). The evtl: marker is
  // written only after a durable commit, so a hit can only assert what the
  // ledger already records. A miss falls through to the authoritative claim.
  // Deliberately NOT the legacy `evt:` key: the previous webhook wrote that
  // marker BEFORE processing, so trusting it during the 24h rollout window
  // would silently drop retries of events the old code marked but never
  // durably processed. Legacy keys age out on their own TTL.
  const kvScope = normalizeEnvironmentName(env);
  const seenKey = `evtl:${kvScope}:${event.id}`;
  try {
    const seen = await env.JOBHACKAI_KV?.get(seenKey);
    if (seen) return new Response('[ok]', { status: 200, headers: respHeaders });
  } catch (_) { /* KV unavailable: ledger decides */ }

  // ── Processing lock, read side (performance aid: damps racing instances
  // cheaply). Never authoritative for success — a locked event answers 503
  // so Stripe retries, and the ledger claim below serializes true ownership.
  const lockKey = `processing:${kvScope}:${event.id}`;
  try {
    const alreadyProcessing = await env.JOBHACKAI_KV?.get(lockKey);
    if (alreadyProcessing) {
      console.log(`⏸️ [WEBHOOK] ${redactId(event.id)} is being processed elsewhere; asking Stripe to retry`);
      return new Response('in flight', { status: 503, headers: respHeaders });
    }
  } catch (_) { /* ignore lock failures */ }
  const releaseLock = async () => {
    try { await env.JOBHACKAI_KV?.delete(lockKey); } catch (_) { /* no-op */ }
  };

  // ── Durable idempotency claim (AUTHORITATIVE). Fail closed when the
  // ledger is unavailable: migration 022 must precede this code. Nothing —
  // D1 or KV — has been written when the claim is refused.
  const claim = await claimEvent(env, event);
  if (claim.outcome === 'unavailable') {
    return new Response('event ledger unavailable', { status: 503, headers: respHeaders });
  }
  if (claim.outcome === 'already_processed') {
    try { await env.JOBHACKAI_KV?.put(seenKey, '1', { expirationTtl: 86400 }); } catch (_) { /* no-op */ }
    return new Response('[ok]', { status: 200, headers: respHeaders });
  }
  if (claim.outcome === 'in_flight') {
    return new Response('in flight', { status: 503, headers: respHeaders });
  }

  // Lock write side: taken only once the claim is ours, so refused/failed
  // claims leave KV untouched.
  try { await env.JOBHACKAI_KV?.put(lockKey, '1', { expirationTtl: 60 }); } catch (_) { /* no-op */ }

  // ── Route the event. Handlers stage critical writes into ctx and queue
  // side effects; nothing is written until the atomic commit below.
  const ctx = {
    statements: [],          // critical D1 writes — committed with the processed-mark
    requiredUserRows: new Set(), // auth_ids whose row must exist at commit (recipient guard)
    postCommit: [],          // awaited after commit (KV cache invalidation)
    fireAndForget: []        // context.waitUntil after commit (GA4, email)
  };

  let outcome;
  try {
    outcome = await routeEvent(context, env, event, ctx);
  } catch (err) {
    if (err instanceof TransientStripeError) {
      outcome = transient('transient_stripe_failure');
    } else {
      console.error(`❌ [WEBHOOK] handler exception for ${event.type} evt=${redactId(event.id)}:`, err?.message || err);
      outcome = transient('handler_exception');
    }
  }

  if (outcome.kind === 'transient' || outcome.kind === 'critical') {
    console.error(`❌ [WEBHOOK] ${outcome.kind} failure (${outcome.reason}) type=${event.type} evt=${redactId(event.id)}`);
    await markEventFailed(env, event.id, outcome.reason);
    await releaseLock();
    const status = outcome.kind === 'transient' ? 503 : 500;
    return new Response(`event failed: ${outcome.reason}`, { status, headers: respHeaders });
  }

  if (outcome.kind === 'noop' && outcome.note) {
    console.log(`⏭️ [WEBHOOK] no-op (${outcome.note}) type=${event.type} evt=${redactId(event.id)}`);
  }

  // ── Atomic commit: every critical write + the processed-mark, together.
  const db = getDb(env);
  const batch = [...ctx.statements, buildMarkProcessedStatement(db, event.id, { requireUserRows: [...ctx.requiredUserRows] })];
  try {
    await db.batch(batch);
  } catch (err) {
    const msg = String(err?.message || '');
    const isUnique = msg.includes('UNIQUE constraint failed');
    // A UNIQUE refusal on stripe_event_log means another writer got there
    // between our pre-check and the commit: the pre-ledger webhook granting
    // this event, or a DISTINCT event fulfilling the same Checkout Session
    // concurrently. The batch rolled back, nothing was written, and the
    // retry's pre-check records this event as a no-op. Retryable (503) — it
    // is not an ownership conflict.
    const isLegacyLog = isUnique && msg.includes('stripe_event_log');
    // Recipient guard: a staged users-row write found no row at commit time
    // (deleted between ensureUserRow and the batch). Nothing landed; the
    // retry re-creates the row (or meets the tombstone and no-ops).
    const isRecipientMissing = msg.includes(RECIPIENT_GUARD_ERROR);
    const reason = isRecipientMissing ? 'recipient_row_missing'
      : isLegacyLog ? 'event_log_conflict'
        : (isUnique ? 'unique_index_conflict' : 'batch_write_failed');
    console.error(`❌ [WEBHOOK] atomic commit failed (${reason}) evt=${redactId(event.id)}: ${msg.slice(0, 200)}`);
    await markEventFailed(env, event.id, reason);
    await releaseLock();
    // Unique-index refusals (023) are ownership conflicts: operator-visible,
    // retried by Stripe, resolved by the reconciliation script.
    return new Response(`event failed: ${reason}`, { status: (isUnique && !isLegacyLog && !isRecipientMissing) ? 500 : 503, headers: respHeaders });
  }

  // Post-commit effects: at-most-once by construction (a retry after commit
  // returns 200 at the ledger before reaching any handler). A crash here can
  // lose one of these, never duplicate it — KV repopulates on read; a lost
  // GA4/email event is the accepted, logged trade-off.
  for (const run of ctx.postCommit) {
    try { await run(); } catch (e) { console.warn('[WEBHOOK] post-commit cache step failed (non-blocking):', e?.message || e); }
  }
  for (const run of ctx.fireAndForget) {
    try { context.waitUntil(run()); } catch (e) { console.warn('[WEBHOOK] post-commit telemetry step failed (non-blocking):', e?.message || e); }
  }
  try { await env.JOBHACKAI_KV?.put(seenKey, '1', { expirationTtl: 86400 }); } catch (_) { /* no-op */ }
  await releaseLock();

  return new Response('[ok]', { status: 200, headers: respHeaders });
}

async function routeEvent(context, env, event, ctx) {
  switch (event.type) {
    case 'checkout.session.completed': return handleCheckoutCompleted(env, event, ctx);
    // Delayed payment methods: the session completed earlier with
    // payment_status 'unpaid' (a recorded no-op); this event carries the
    // settled payment and is the fulfilment event — same handler, same
    // eligibility rules, its own ledger row.
    case 'checkout.session.async_payment_succeeded': return handleCheckoutCompleted(env, event, ctx);
    // Nothing was granted on completion, so nothing is revoked here.
    case 'checkout.session.async_payment_failed': return noop('async_payment_failed');
    case 'customer.subscription.created': return handleSubscriptionCreated(env, event, ctx);
    case 'customer.subscription.updated': return handleSubscriptionUpdated(env, event, ctx);
    case 'customer.subscription.deleted': return handleSubscriptionDeleted(env, event, ctx);
    case 'invoice.payment_failed': return handleInvoicePaymentFailed(env, event, ctx);
    default: return noop(`unhandled_event_type:${event.type}`);
  }
}

// ── Shared staging helpers ──────────────────────────────────────────────

// Stage the users-row plan write with the same timestamp-ordering protection
// updateUserPlan callers rely on: an event older than the row's
// plan_updated_at is skipped (planApplied=false) so out-of-order webhooks
// never overwrite newer state, and callers gate side effects (GA4, resets)
// on planApplied so stale replays can't double-count.
//
// `preloadedPlanData` lets callers that already read the row (trial
// conversion detection) share one read; pass `undefined` to let this helper
// read. Reads happen here, pre-batch; the returned staging is write-only.
async function stagePlanUpdate(env, ctx, uid, planData, eventTimestampSeconds, preloadedPlanData) {
  if (!uid) return { planApplied: false };

  if (eventTimestampSeconds !== undefined && Number.isFinite(eventTimestampSeconds)) {
    const currentPlanData = preloadedPlanData !== undefined
      ? preloadedPlanData
      : await getUserPlanData(env, uid);
    if (currentPlanData?.planUpdatedAt) {
      const storedTimestamp = Math.floor(new Date(currentPlanData.planUpdatedAt).getTime() / 1000);
      const eventTimestamp = Math.floor(Number(eventTimestampSeconds));
      if (eventTimestamp < storedTimestamp) {
        console.log(`⏭️ [WEBHOOK] Skipping out-of-order event: event.created=${eventTimestamp} < stored=${storedTimestamp} for uid=${redactId(uid)}`);
        return { planApplied: false };
      }
    }
    planData = { ...planData, planEventTimestamp: new Date(eventTimestampSeconds * 1000).toISOString() };
  }

  const stmt = buildUserPlanUpdateStatement(getDb(env), uid, planData);
  if (stmt) {
    ctx.statements.push(stmt);
    ctx.requiredUserRows.add(uid); // the mark refuses if this row is gone at commit
  }

  // Cache invalidation belongs after the commit (KV is never authoritative).
  ctx.postCommit.push(async () => {
    if (!env.JOBHACKAI_KV) return;
    await env.JOBHACKAI_KV.delete(kvPlanKey(uid));
    await env.JOBHACKAI_KV.delete(`trialUsedByUid:${uid}`);
    await env.JOBHACKAI_KV.delete(`trialEndByUid:${uid}`);
    await env.JOBHACKAI_KV.delete(`billingStatus:${uid}`);
    // Delete all monthly feedbackUsage keys for this UID (12 months back + safety)
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      await env.JOBHACKAI_KV.delete(`feedbackUsage:${uid}:${monthKey}`);
    }
    await env.JOBHACKAI_KV.delete(`atsUsage:${uid}:lifetime`);
  });

  return { planApplied: true };
}

// Handlers that never create rows (deletion, dunning) treat a missing users
// row as a deliberate no-op: nothing to downgrade or flag in THIS
// environment (e.g. a customer whose account lives only in another
// environment). Explicit, so the recipient guard never fails them.
async function userRowExists(env, uid) {
  const db = getDb(env);
  if (!db || !uid) return false;
  const row = await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(uid).first();
  return Boolean(row);
}

// Ensure the user row exists for first-time subscribers (get-or-create is
// idempotent, so it is safe to run before the atomic batch). Tombstoned
// users are a deliberate no-op: the account was intentionally deleted.
async function ensureUserRow(env, uid, email, eventLabel) {
  const db = getDb(env);
  const existingUser = db ? await db.prepare('SELECT id FROM users WHERE auth_id = ?').bind(uid).first() : null;
  if (existingUser) return { ok: true };

  const d1Tombstone = await isDeletedUser(env, uid);
  const kvTombstone = await env.JOBHACKAI_KV?.get(`deleted:${uid}`);
  if (d1Tombstone || kvTombstone) {
    console.log(`⏭️ [WEBHOOK] Skipping ${eventLabel}: user ${redactId(uid)} was deleted (tombstone found)`);
    return { outcome: noop('tombstoned_user') };
  }
  try {
    await getOrCreateUserByAuthId(env, uid, email, { updateActivity: false });
    console.log(`✅ [WEBHOOK] Ensured user row exists for subscriber: ${redactId(uid)}`);
    return { ok: true };
  } catch (createErr) {
    console.error(`❌ [WEBHOOK] Failed to create user row for ${redactId(uid)}:`, createErr?.message || createErr);
    return { outcome: transient('user_row_create_failed') };
  }
}

// ── Interview Pack grant (one-time payment; dev0 voice repositioning) ──
//
// Credits are critical writes: they ride the SAME atomic batch as the ledger
// processed-mark, so a crash can neither grant twice nor consume the event
// without granting. Two idempotency records cooperate:
//   * stripe_event_ledger (migration 022) — the authoritative claim for
//     EVERY event; a processed event never reaches this function again.
//   * stripe_event_log (voice migration 020) — the pack-grant history the
//     pre-ledger webhook wrote. It is preserved, still written for every
//     grant, and consulted FIRST so an event the old code already granted is
//     never granted again when Stripe replays it into the new code.
//   * stripe_event_log also holds a per-SESSION fulfilment marker (event_id
//     = the Checkout Session id): one purchase may be announced by several
//     DISTINCT events — a checkout.session.completed created while the
//     payment was still pending but delivered/retried after it settled, plus
//     checkout.session.async_payment_succeeded — and per-event idempotency
//     alone would credit the same session twice. The marker is a plain
//     INSERT inside the batch, so a second event for a fulfilled session
//     (even one racing the first) fails atomically and the retry records it
//     as a no-op; the pre-check below is the graceful path, the INSERT is
//     the guard.
async function stagePackGrant(env, event, ctx, { uid, customerEmail, sessionId, sess, priceId }) {
  const rowCheck = await ensureUserRow(env, uid, customerEmail, 'pack grant');
  if (rowCheck.outcome) return rowCheck.outcome;

  const db = getDb(env);
  let seen;
  try {
    const res = await db.prepare('SELECT event_id, type FROM stripe_event_log WHERE event_id IN (?1, ?2)').bind(event.id, sessionId || '').all();
    seen = res?.results || [];
  } catch (e) {
    // Unreadable log: granting blind could double-credit an event the old
    // webhook already processed or a session another event already
    // fulfilled. Retry instead of guessing.
    console.error('[WEBHOOK] stripe_event_log read failed:', e?.message || e);
    return transient('legacy_event_log_read_failed');
  }
  if (seen.some((r) => r.event_id === event.id)) {
    console.log(`⏭️ [WEBHOOK] pack already granted for evt=${redactId(event.id)} (pre-ledger webhook); recording as processed`);
    return noop('pack_already_granted_legacy_log');
  }
  if (sessionId && seen.some((r) => r.event_id === sessionId)) {
    console.log(`⏭️ [WEBHOOK] pack session ${redactId(sessionId)} already fulfilled by an earlier event; ${event.type} evt=${redactId(event.id)} is a no-op`);
    return noop('pack_session_already_fulfilled');
  }

  const statements = buildPackGrantStatements(db, { uid, eventId: event.id, sessionId });
  if (statements.length === 0) return transient('pack_grant_unstageable');
  ctx.statements.push(...statements);
  ctx.requiredUserRows.add(uid); // no recipient row at commit → whole batch rolls back, retryable
  console.log(`✍️ STAGING PACK GRANT: +${PACK_SESSION_COUNT} sessions for uid=${redactId(uid)}`);

  // Cache invalidation and telemetry run only after the commit.
  ctx.postCommit.push(() => invalidateBillingCaches(env, uid));
  let packAmount = hardcodedPlanAmountDollars('pack');
  if (sess?.amount_total != null && Number.isFinite(Number(sess.amount_total))) {
    packAmount = Number(sess.amount_total) / 100;
  }
  ctx.fireAndForget.push(() => sendGa4Event(env, {
    clientId: `server.${uid}`,
    userId: uid,
    name: 'purchase',
    params: {
      transaction_id: sessionId,
      currency: (sess?.currency || 'usd').toUpperCase(),
      value: packAmount,
      plan: 'pack',
      items: [{ item_id: priceId || 'pack', item_name: 'pack', price: packAmount, quantity: 1 }]
    }
  }));
  return ok();
}

// ── Handlers ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(env, event, ctx) {
  console.log('🎯 WEBHOOK: checkout.session.completed received');
  const sessionId = event.data?.object?.id;
  const sessionMetadata = event.data?.object?.metadata || {};
  const originalPlan = sessionMetadata.plan;

  // Expand line items to reliably get price id
  let sess;
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items.data.price`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    if (!r.ok) {
      console.error(`[WEBHOOK] checkout session fetch returned ${r.status} for ${redactId(sessionId)}`);
      return transient('session_fetch_failed');
    }
    sess = await r.json();
  } catch (e) {
    console.error('[WEBHOOK] checkout session fetch error:', e?.message || e);
    return transient('session_fetch_failed');
  }

  // ── Fulfilment eligibility (the re-fetched session is authoritative) ──
  // Only a COMPLETE session with a settled payment establishes entitlement.
  // A synthetic or forged "completed" event for a session Stripe still shows
  // as open/expired cannot grant anything; a completed session awaiting a
  // delayed payment method is fulfilled by async_payment_succeeded instead.
  const sessionStatus = sess?.status ?? event.data?.object?.status ?? null;
  const paymentStatus = sess?.payment_status ?? event.data?.object?.payment_status ?? null;
  if (sessionStatus !== 'complete') {
    console.error(`[WEBHOOK] checkout session ${redactId(sessionId)} is not complete (status=${sessionStatus}); refusing fulfilment`);
    return critical('session_not_complete');
  }
  const paymentSettled = paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
  if (!paymentSettled && paymentStatus !== 'unpaid') {
    console.error(`[WEBHOOK] checkout session ${redactId(sessionId)} has an unverifiable payment_status (${paymentStatus}); refusing fulfilment`);
    return critical('payment_status_unverified');
  }

  const priceId = sess?.line_items?.data?.[0]?.price?.id || '';
  const customerId = sess?.customer || event.data?.object?.customer || null;
  // Ownership sources: the signed payload's session metadata (stamped at
  // checkout) first; the re-fetched session's metadata is the same Stripe
  // object and only fills gaps (dev0 kept this fallback for one-time packs,
  // which have no follow-up event to heal from).
  const sessionForOwner = {
    ...(event.data?.object || {}),
    metadata: { ...(sess?.metadata || {}), ...(event.data?.object?.metadata || {}) }
  };
  const owner = await resolveOwnerUid(env, { session: sessionForOwner, customerId });
  if (owner.conflict) return critical('owner_conflict');
  const { uid, email: customerEmail } = owner;
  if (!uid) return critical('unresolved_owner');

  // ── One-time payments (Interview Pack) never take the subscription path ──
  // The signed event payload already carries `mode`; the session re-fetch is
  // only needed for line_items, so a degraded expansion body can never hide
  // that this was a one-time charge. Every mode=payment session is handled
  // here or fails closed — it is never plan-mapped.
  const sessionMode = sess?.mode || event.data?.object?.mode || null;
  const isOneTimePayment = sessionMode === 'payment';
  const isPackPurchase = isOneTimePayment && (priceId === env.STRIPE_PRICE_PACK || originalPlan === 'pack');
  if (isOneTimePayment) {
    if (!isPackPurchase) {
      // Unrecognized one-time product: nothing to grant, and no follow-up
      // event will heal a one-time charge. Critical (500 + ledger 'failed')
      // so Stripe retries and the misconfiguration is operator-visible.
      console.error(`❌ [WEBHOOK] Unrecognized one-time payment (plan=${originalPlan}, session=${redactId(sessionId)})`);
      return critical('unrecognized_one_time_payment');
    }
    if (!paymentSettled) {
      // Delayed payment method: completed but not yet paid. Grant nothing;
      // checkout.session.async_payment_succeeded fulfils it.
      console.log(`⏳ [WEBHOOK] pack session ${redactId(sessionId)} completed with payment_status=unpaid; awaiting async_payment_succeeded`);
      return noop('pack_payment_pending');
    }
    return stagePackGrant(env, event, ctx, { uid, customerEmail, sessionId, sess, priceId });
  }
  // Fail closed: a pack purchase must never reach the subscription mapping
  // below (it would write plan='essential', which the voice layer treats as
  // unlimited, for a one-time charge). metadata.plan=pack with no resolvable
  // mode means the mode signal was lost everywhere → critical, Stripe retries.
  if (originalPlan === 'pack') {
    console.error(`❌ [WEBHOOK] Pack purchase without a resolvable session mode (session=${redactId(sessionId)})`);
    return critical('pack_mode_unresolved');
  }

  // Determine effective plan based on original plan and subscription status
  let effectivePlan = 'free';
  if (originalPlan === 'trial') {
    effectivePlan = 'trial'; // Show as trial immediately
    // Trial usage is tracked in D1 (source of truth); no authoritative KV flags.
    console.log(`✅ TRIAL STARTED (tracked in D1): ${redactId(uid)}`);
  } else {
    effectivePlan = priceToPlan(env, priceId);
  }
  console.log(`📝 CHECKOUT DATA: originalPlan=${originalPlan}, effectivePlan=${effectivePlan}, customerId=${redactId(customerId)}, uid=${redactId(uid)}`);

  const rowCheck = await ensureUserRow(env, uid, customerEmail, 'checkout plan update');
  if (rowCheck.outcome) return rowCheck.outcome;

  // Get subscription details if available. A session that references a
  // subscription we cannot read is retryable — writing null periods for a
  // real subscription would silently degrade billing data.
  const subscriptionId = sess?.subscription || null;
  let subscription = null;
  if (subscriptionId) {
    try {
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      if (!subRes.ok) {
        console.error(`[WEBHOOK] subscription fetch returned ${subRes.status} for ${redactId(subscriptionId)}`);
        return transient('subscription_fetch_failed');
      }
      subscription = await subRes.json();
    } catch (e) {
      console.error('[WEBHOOK] subscription fetch error:', e?.message || e);
      return transient('subscription_fetch_failed');
    }
  }

  // A subscription-mode session fulfils only through its subscription: no
  // subscription means nothing to verify, and a subscription that is not in
  // an entitled status (incomplete, incomplete_expired, canceled — e.g. a
  // delayed payment still pending) must not establish a paid plan; the
  // customer.subscription.updated event that moves it to active will.
  if (!subscriptionId) {
    console.error(`[WEBHOOK] subscription-mode session ${redactId(sessionId)} carries no subscription; refusing fulfilment`);
    return critical('subscription_missing_on_session');
  }
  if (!ENTITLED_SUBSCRIPTION_STATUSES.includes(subscription?.status)) {
    console.log(`⏳ [WEBHOOK] session ${redactId(sessionId)} subscription is ${subscription?.status}; not entitled yet — no plan write`);
    return noop(`subscription_not_entitled:${subscription?.status}`);
  }
  // The retrieved subscription is authoritative if Checkout's line-item
  // expansion is absent. Metadata alone never supplies a paid entitlement.
  if (originalPlan !== 'trial') {
    const mappedItems = (subscription.items?.data || [])
      .map((item) => priceToPlan(env, item?.price?.id)).filter(Boolean);
    if (mappedItems.length !== 1) return critical('subscription_price_unrecognized_or_ambiguous');
    effectivePlan = mappedItems[0];
  }
  if (!paymentSettled) {
    // Entitled subscription but the session's payment is still pending: the
    // subscription object is the source of truth for access and it is
    // entitled, so proceed — Stripe keeps the two consistent.
    console.log(`[WEBHOOK] session ${redactId(sessionId)} payment_status=unpaid while subscription is ${subscription.status}; proceeding on the subscription's status`);
  }

  // Determine trial end date. Prefer subscription.trial_end if available.
  let trialEndsAtISO = subscription?.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;

  // If this was a trial and trial_end is missing, set a conservative fallback
  // so the user is marked as having used a trial and cannot re-use it.
  // The checkout session uses a 3-day trial (see checkout flow).
  if (effectivePlan === 'trial' && !trialEndsAtISO) {
    const FALLBACK_TRIAL_DAYS = 3;
    trialEndsAtISO = new Date(Date.now() + FALLBACK_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    console.warn(`[WEBHOOK] subscription.trial_end missing for uid=${redactId(uid)}; using fallback trialEndsAt=${trialEndsAtISO}`);
  }

  const guard = await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId });
  if (!guard.ok) return critical('cross_user_id_conflict');

  const period = readSubscriptionPeriod(subscription, { priceToPlan: (pid) => priceToPlan(env, pid) });
  if (period.error) return critical(`period_${period.error}`);

  console.log(`✍️ STAGING D1 WRITE: users.plan = ${effectivePlan} for uid=${redactId(uid)}`);
  const { planApplied } = await stagePlanUpdate(env, ctx, uid, {
    plan: effectivePlan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: subscription?.status || 'active',
    trialEndsAt: trialEndsAtISO,
    currentPeriodStart: period.currentPeriodStart,
    currentPeriodEnd: period.currentPeriodEnd,
    hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
  }, event.created);
  console.log(`✅ D1 WRITE ${planApplied ? 'STAGED' : 'SKIPPED (out-of-order)'}: ${redactId(uid)} → ${effectivePlan}`);

  // GA4 conversion: trial_start for $0 trials, purchase for paid plans.
  // Runs post-commit and only when the plan write actually applied, so a
  // stale or replayed webhook never inflates GA4 counts.
  if (planApplied) {
    let sessionAmount = null;
    if (sess?.amount_total != null) {
      const total = Number(sess.amount_total);
      if (Number.isFinite(total)) sessionAmount = total / 100;
    }
    const planAmount =
      sessionAmount ??
      subscriptionPriceAmountDollars(subscription) ??
      hardcodedPlanAmountDollars(effectivePlan);
    if (effectivePlan === 'trial') {
      ctx.fireAndForget.push(() => sendGa4Event(env, {
        clientId: `server.${uid}`,
        userId: uid,
        name: 'trial_start',
        params: {
          plan: 'trial',
          source: 'stripe_checkout',
          session_id: sessionId
        }
      }));
    } else if (isPaidPlan(effectivePlan)) {
      if (planAmount == null) {
        console.warn(`[WEBHOOK] purchase event skipped: could not determine planAmount for plan=${effectivePlan} session=${redactId(sessionId)}`);
      } else {
        ctx.fireAndForget.push(() => sendGa4Event(env, {
          clientId: `server.${uid}`,
          userId: uid,
          name: 'purchase',
          params: {
            transaction_id: sessionId,
            currency: (sess?.currency || 'usd').toUpperCase(),
            value: planAmount,
            plan: effectivePlan,
            items: [{
              item_id: priceId || effectivePlan,
              item_name: effectivePlan,
              price: planAmount,
              quantity: 1
            }]
          }
        }));
      }
    }
  }
  return ok();
}

async function handleSubscriptionCreated(env, event, ctx) {
  console.log(`🎯 WEBHOOK: ${event.type} received`);
  const sub = event.data.object;
  const status = sub.status;
  if (!ENTITLED_SUBSCRIPTION_STATUSES.includes(status)) {
    return noop(`subscription_not_entitled:${status}`);
  }
  const metadata = sub.metadata || {};
  const originalPlan = metadata.original_plan;
  const items = sub.items?.data || [];
  const pId = items[0]?.price?.id || '';
  const plan = priceToPlan(env, pId);
  const customerId = sub.customer || null;

  const owner = await resolveOwnerUid(env, { subscription: sub, customerId });
  if (owner.conflict) return critical('owner_conflict');
  const { uid, email: customerEmail } = owner;
  if (!uid) return critical('unresolved_owner');

  let effectivePlan = 'free';
  if (status === 'trialing' && originalPlan === 'trial') {
    effectivePlan = 'trial'; // User is in trial period
  } else if (status === 'active' || status === 'trialing') {
    // Extract plan from price ID (auto-converts trial to essential)
    if (!plan) return critical('subscription_price_unrecognized');
    effectivePlan = plan;
  } else if (status === 'past_due' || status === 'unpaid') {
    // Dunning keeps paid access: invoice.payment_failed writes status only,
    // and sync-stripe-plan explicitly preserves the plan for past_due/unpaid
    // ("still has access"). Downgrading here made entitlement flap between
    // the webhook and sync while Stripe retried the charge.
    if (!plan) return critical('subscription_price_unrecognized');
    effectivePlan = plan;
  }

  const trialEndsAtISO = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

  const rowCheck = await ensureUserRow(env, uid, customerEmail, 'subscription.created plan update');
  if (rowCheck.outcome) return rowCheck.outcome;

  console.log(`📝 SUBSCRIPTION DATA: status=${status}, basePlan=${plan}, effectivePlan=${effectivePlan}, uid=${redactId(uid)}`);

  const guard = await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customerId, stripeSubscriptionId: sub.id });
  if (!guard.ok) return critical('cross_user_id_conflict');

  const period = readSubscriptionPeriod(sub, { priceToPlan: (pid) => priceToPlan(env, pid) });
  if (period.error) return critical(`period_${period.error}`);

  console.log(`✍️ STAGING D1 WRITE: users.plan = ${effectivePlan} for uid=${redactId(uid)}`);
  const { planApplied } = await stagePlanUpdate(env, ctx, uid, {
    plan: effectivePlan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: status,
    trialEndsAt: trialEndsAtISO,
    currentPeriodStart: period.currentPeriodStart,
    currentPeriodEnd: period.currentPeriodEnd,
    hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
  }, event.created);
  console.log(`✅ D1 WRITE ${planApplied ? 'STAGED' : 'SKIPPED (out-of-order)'}: ${redactId(uid)} → ${effectivePlan}${trialEndsAtISO ? ` (trial ends: ${trialEndsAtISO})` : ''}`);
  return ok();
}

async function handleSubscriptionUpdated(env, event, ctx) {
  console.log('🎯 WEBHOOK: customer.subscription.updated received');
  const sub = event.data.object;
  // An unfinished second checkout must not replace an existing paid
  // subscription or erase pack entitlements. A later active event can grant.
  if (['incomplete', 'incomplete_expired'].includes(sub.status)) {
    return noop(`subscription_not_entitled:${sub.status}`);
  }
  const customerId = sub.customer || null;

  const owner = await resolveOwnerUid(env, { subscription: sub, customerId });
  if (owner.conflict) return critical('owner_conflict');
  const { uid, email: customerEmail } = owner;
  if (!uid) return critical('unresolved_owner');

  const rowCheck = await ensureUserRow(env, uid, customerEmail, 'subscription.updated plan update');
  if (rowCheck.outcome) return rowCheck.outcome;

  // Handle scheduled cancellation
  let cancelAt = null;
  if (sub.cancel_at_period_end === true && sub.cancel_at) {
    cancelAt = new Date(sub.cancel_at * 1000).toISOString();
    console.log(`✅ CANCELLATION SCHEDULED: ${redactId(uid)} → ${cancelAt}`);
  }

  // Handle scheduled plan changes (downgrades). Schedule data feeds a
  // critical write (scheduled_plan/scheduled_at); an unreadable schedule is
  // retryable, not guessable.
  let scheduledPlan = null;
  let scheduledAt = null;
  if (sub.schedule) {
    try {
      const schedRes = await fetch(`https://api.stripe.com/v1/subscription_schedules/${sub.schedule}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      if (!schedRes.ok) {
        console.error(`[WEBHOOK] schedule fetch returned ${schedRes.status} for ${redactId(sub.schedule)}`);
        return transient('schedule_fetch_failed');
      }
      const schedData = await schedRes.json();
      if (schedData && schedData.phases && schedData.phases.length > 1) {
        const nextPhase = schedData.phases[1];
        const nextPriceId = nextPhase.items[0]?.price;
        scheduledPlan = priceToPlan(env, nextPriceId);
        scheduledAt = nextPhase.start_date ? new Date(nextPhase.start_date * 1000).toISOString() : null;
        if (scheduledPlan && scheduledAt) {
          console.log(`✅ PLAN CHANGE SCHEDULED: ${redactId(uid)} → ${scheduledPlan} at ${scheduledAt}`);
        }
      }
    } catch (e) {
      console.error('[WEBHOOK] schedule fetch error:', e?.message || e);
      return transient('schedule_fetch_failed');
    }
  }

  // Determine effective plan status
  const status = sub.status;
  const metadata = sub.metadata || {};
  const originalPlan = metadata.original_plan;
  const items = sub.items?.data || [];
  const pId = items[0]?.price?.id || '';
  const plan = priceToPlan(env, pId);

  // One read serves both trial-conversion detection and the ordering guard.
  // If D1 cannot be read, retry: proceeding would either lose the conversion
  // side effects forever or skip the ordering protection.
  let existingPlanData;
  try {
    existingPlanData = await getUserPlanData(env, uid);
  } catch (e) {
    console.error('[WEBHOOK] could not read current plan data:', e?.message || e);
    return transient('d1_read_failed');
  }
  const previousPlan = existingPlanData?.plan || null;

  let effectivePlan = 'free';
  if (status === 'trialing' && originalPlan === 'trial') {
    effectivePlan = 'trial';
  } else if (status === 'active' || status === 'trialing') {
    if (!plan) return critical('subscription_price_unrecognized');
    effectivePlan = plan;
  } else if (status === 'past_due' || status === 'unpaid') {
    // Dunning keeps paid access — see handleSubscriptionCreated. The status
    // itself is still written as past_due/unpaid below.
    if (!plan) return critical('subscription_price_unrecognized');
    effectivePlan = plan;
  }

  const trialEndsAtISO = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
  const isTrialConversion = previousPlan === 'trial' && effectivePlan !== 'trial' && status === 'active';

  console.log(`🔄 TRIAL CONVERSION CHECK:`, {
    eventType: event.type,
    currentStatus: status,
    previousPlan,
    originalPlan,
    mappedPlan: plan,
    effectivePlan,
    trialEndsAt: trialEndsAtISO,
    subscriptionId: redactId(sub.id),
    isTrialConversion
  });
  if (isTrialConversion) {
    console.log(`🎉 TRIAL CONVERTED: ${redactId(uid)} → ${effectivePlan} (trial expired, subscription now active)`);
  }

  const guard = await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customerId, stripeSubscriptionId: sub.id });
  if (!guard.ok) return critical('cross_user_id_conflict');

  const period = readSubscriptionPeriod(sub, { priceToPlan: (pid) => priceToPlan(env, pid) });
  if (period.error) return critical(`period_${period.error}`);

  console.log(`✍️ STAGING D1 UPDATE: users.plan = ${effectivePlan} for uid=${redactId(uid)}`);
  const { planApplied } = await stagePlanUpdate(env, ctx, uid, {
    plan: effectivePlan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: status,
    trialEndsAt: trialEndsAtISO,
    currentPeriodStart: period.currentPeriodStart,
    currentPeriodEnd: period.currentPeriodEnd,
    cancelAt: cancelAt || null, // null clears the field (undefined is skipped)
    scheduledPlan: scheduledPlan || null, // null clears the field
    scheduledAt: scheduledAt || null, // null clears the field
    hasEverPaid: isPaidPlan(effectivePlan) ? 1 : undefined
  }, event.created, existingPlanData);
  console.log(`✅ D1 UPDATE ${planApplied ? 'STAGED' : 'SKIPPED (out-of-order)'}: ${redactId(uid)} → ${effectivePlan}${trialEndsAtISO ? ` (trial ends: ${trialEndsAtISO})` : ''}`);

  if (planApplied && isTrialConversion) {
    // Usage resets are critical writes: they ride the SAME atomic batch as
    // the plan change and the ledger processed-mark, so a crash can never
    // apply the plan without the resets (or vice versa) — and a replayed
    // event re-reads previousPlan (now paid), so they can never run twice.
    if (['essential', 'pro', 'premium'].includes(effectivePlan)) {
      console.log('[WEBHOOK] Staging usage resets for trial conversion', {
        uid: redactId(uid),
        fromPlan: previousPlan,
        toPlan: effectivePlan
      });
      const db = getDb(env);
      const resetInterview = buildResetFeatureDailyUsageStatement(db, uid, 'interview_questions');
      const resetFeedback = buildResetUsageEventsStatement(db, uid, 'resume_feedback');
      if (resetInterview) ctx.statements.push(resetInterview);
      if (resetFeedback) ctx.statements.push(resetFeedback);
    }

    // GA4 conversion: trial → paid is a real `purchase`. Post-commit and
    // gated on planApplied, so stale/replayed webhooks never double-count.
    if (isPaidPlan(effectivePlan)) {
      const convertedPlanAmount =
        subscriptionPriceAmountDollars(sub) ?? hardcodedPlanAmountDollars(effectivePlan);
      if (convertedPlanAmount == null) {
        console.warn(`[WEBHOOK] trial-conversion purchase event skipped: could not determine planAmount for plan=${effectivePlan} subId=${redactId(sub?.id)}`);
      } else {
        ctx.fireAndForget.push(() => sendGa4Event(env, {
          clientId: `server.${uid}`,
          userId: uid,
          name: 'purchase',
          params: {
            transaction_id: `${sub.id}.trial_converted`,
            currency: (sub?.currency || 'usd').toUpperCase(),
            value: convertedPlanAmount,
            plan: effectivePlan,
            converted_from: 'trial',
            items: [{
              item_id: pId || effectivePlan,
              item_name: effectivePlan,
              price: convertedPlanAmount,
              quantity: 1
            }]
          }
        }));
      }
    }
  }
  return ok();
}

async function handleSubscriptionDeleted(env, event, ctx) {
  console.log('🎯 WEBHOOK: customer.subscription.deleted received');
  const deletedSub = event.data?.object || {};
  const customerId = deletedSub.customer || null;

  const owner = await resolveOwnerUid(env, { subscription: deletedSub, customerId });
  if (owner.conflict) return critical('owner_conflict');
  const uid = owner.uid;
  if (!uid) return critical('unresolved_owner');
  if (!(await userRowExists(env, uid))) {
    console.log(`⏭️ [WEBHOOK] subscription.deleted for uid=${redactId(uid)} with no users row here; nothing to downgrade`);
    return noop('user_row_missing');
  }

  console.log(`📝 DELETION DATA: customerId=${redactId(customerId)}, uid=${redactId(uid)}`);
  const deletedItems = deletedSub?.items?.data || [];
  const deletedPriceId = deletedItems[0]?.price?.id || '';
  const deletedPlan = priceToPlan(env, deletedPriceId);

  // If the customer still has another active subscription, keep the user on
  // that plan instead of downgrading to free. An unreadable subscription
  // list is retryable — guessing "no active subs" here would wrongly
  // downgrade a paying user.
  if (customerId) {
    let subsData;
    try {
      const subsRes = await stripe(env, `/subscriptions?customer=${customerId}&status=all&limit=25`);
      if (!subsRes.ok) {
        console.error(`[WEBHOOK] subscription list returned ${subsRes.status} on deletion`);
        return transient('subscription_list_failed');
      }
      subsData = await subsRes.json();
    } catch (subErr) {
      console.error('[WEBHOOK] subscription list error on deletion:', subErr?.message || subErr);
      return transient('subscription_list_failed');
    }

    const activeSubs = (subsData.data || []).filter((s) =>
      s && ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
    );
    if (activeSubs.length > 0) {
      const { bestSub, currentPlan } = pickBestSubscription(activeSubs, env);
      const trialEndsAtISO = bestSub.trial_end ? new Date(bestSub.trial_end * 1000).toISOString() : null;
      const period = readSubscriptionPeriod(bestSub, { priceToPlan: (pid) => priceToPlan(env, pid) });
      if (period.error) return critical(`period_${period.error}`);
      const cancelAt = (bestSub.cancel_at_period_end && bestSub.cancel_at)
        ? new Date(bestSub.cancel_at * 1000).toISOString()
        : null;

      const guard = await assertNoCrossUserStripeIds(env, { uid, stripeCustomerId: customerId, stripeSubscriptionId: bestSub.id });
      if (!guard.ok) return critical('cross_user_id_conflict');

      console.log(`✍️ [WEBHOOK] Remaining active subscription found, keeping plan ${currentPlan} for uid=${redactId(uid)}`);
      await stagePlanUpdate(env, ctx, uid, {
        plan: currentPlan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: bestSub.id,
        subscriptionStatus: bestSub.status,
        trialEndsAt: trialEndsAtISO,
        currentPeriodStart: period.currentPeriodStart,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAt,
        scheduledPlan: null,
        scheduledAt: null,
        hasEverPaid: isPaidPlan(currentPlan) ? 1 : undefined
      }, event.created);
      return ok();
    }
  }

  console.log(`✍️ STAGING D1 WRITE: users.plan = free for uid=${redactId(uid)}`);
  await stagePlanUpdate(env, ctx, uid, {
    plan: 'free',
    stripeSubscriptionId: null,
    subscriptionStatus: 'canceled',
    currentPeriodStart: null, // Subscription ended: clear the billing period
    currentPeriodEnd: null,
    cancelAt: null, // Clear cancellation date
    scheduledPlan: null, // Clear scheduled plan
    scheduledAt: null, // Clear scheduled date
    hasEverPaid: isPaidPlan(deletedPlan) ? 1 : undefined
  }, event.created);

  // Resume-data cleanup is cache-only: post-commit.
  ctx.postCommit.push(async () => {
    await env.JOBHACKAI_KV?.delete(`user:${uid}:lastResume`);
    await env.JOBHACKAI_KV?.delete(`usage:${uid}`);
  });

  // Subscription cancelled email (post-commit, fire-and-forget). The user
  // row read happens now (pre-batch reads are fine); the period end here is
  // display-only, so a period error degrades to "no date" instead of
  // failing the event — the critical write above already clears the period.
  try {
    const db = getDb(env);
    const userRow = db ? await db.prepare('SELECT email FROM users WHERE auth_id = ?').bind(uid).first() : null;
    if (userRow?.email) {
      const userName = userRow.email.split('@')[0];
      const periodEnd = readSubscriptionPeriod(deletedSub, { priceToPlan: (pid) => priceToPlan(env, pid) }).currentPeriodEnd;
      const { subject, html } = subscriptionCancelledEmail(userName, deletedPlan, periodEnd);
      ctx.fireAndForget.push(() => sendEmail(env, { to: userRow.email, subject, html }).catch((e) => {
        console.warn('[WEBHOOK] Failed to send cancellation email (non-blocking):', e.message);
      }));
    }
  } catch (emailErr) {
    console.warn('[WEBHOOK] Error preparing cancellation email (non-blocking):', emailErr.message);
  }
  return ok();
}

async function handleInvoicePaymentFailed(env, event, ctx) {
  console.log('🎯 WEBHOOK: invoice.payment_failed received');
  const invoice = event.data?.object || {};
  const customerId = invoice.customer || null;
  const subscriptionId = invoiceSubscriptionId(invoice);

  // Only handle subscription invoices — one-time invoices (e.g. metered
  // charges) have no subscription and should not affect subscription status.
  if (!subscriptionId) {
    console.log(`⏭️ [WEBHOOK] invoice.payment_failed: skipping non-subscription invoice ${redactId(invoice.id)}`);
    return noop('non_subscription_invoice');
  }

  // Fetch the subscription FIRST: its status gates the write below, and its
  // metadata.firebaseUid is the strongest ownership source (all new
  // subscriptions are stamped at checkout) — resolving from the customer
  // alone failed invoices whose customer lacks metadata. Stripe fires
  // invoice.payment_failed on every retry attempt while the subscription may
  // still be 'active'; fetch failures are retryable — defaulting to past_due
  // would write a guessed status.
  let subData;
  try {
    const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    if (subRes.status === 404) {
      // Subscription no longer exists in this mode: terminal state is owned
      // by customer.subscription.deleted, not this handler.
      console.log(`⏭️ [WEBHOOK] invoice.payment_failed: subscription ${redactId(subscriptionId)} not found; deletion event owns terminal state`);
      return noop('subscription_not_found');
    }
    if (!subRes.ok) {
      console.error(`[WEBHOOK] subscription status fetch returned ${subRes.status}`);
      return transient('subscription_fetch_failed');
    }
    subData = await subRes.json();
  } catch (fetchErr) {
    console.error('[WEBHOOK] subscription status fetch error:', fetchErr?.message || fetchErr);
    return transient('subscription_fetch_failed');
  }
  const subStatus = subData.status || 'past_due';
  // The invoice payload may lack the subscription metadata snapshot; the
  // fetched subscription is authoritative for the environment stamp.
  if (isForeignEnvironmentStamp(env, canonicalizeEnvironmentStamp(subData?.metadata?.environment))) {
    console.log(`⏭️ [WEBHOOK] invoice.payment_failed for a subscription stamped ${canonicalizeEnvironmentStamp(subData?.metadata?.environment)}; not this environment's`);
    return noop('other_environment_subscription');
  }

  const owner = await resolveOwnerUid(env, { subscription: subData, customerId });
  if (owner.conflict) return critical('owner_conflict');
  const uid = owner.uid;
  if (!uid) return critical('unresolved_owner');

  // Skip deleted users — other handlers check this too
  const d1Tombstone = await isDeletedUser(env, uid);
  const kvTombstone = await env.JOBHACKAI_KV?.get(`deleted:${uid}`);
  if (d1Tombstone || kvTombstone) {
    console.log(`⏭️ [WEBHOOK] Skipping invoice.payment_failed: user ${redactId(uid)} was deleted (tombstone found)`);
    return noop('tombstoned_user');
  }
  if (!(await userRowExists(env, uid))) {
    console.log(`⏭️ [WEBHOOK] invoice.payment_failed for uid=${redactId(uid)} with no users row here; nothing to flag`);
    return noop('user_row_missing');
  }

  // Skip if subscription is still active (retries pending) or in a terminal
  // state handled by other webhook events (e.g. customer.subscription.deleted).
  const terminalStatuses = new Set(['active', 'canceled', 'incomplete_expired']);
  if (terminalStatuses.has(subStatus)) {
    console.log(`⏭️ [WEBHOOK] invoice.payment_failed: subscription ${redactId(subscriptionId)} is ${subStatus}, skipping D1 update`);
    return noop(`subscription_status_${subStatus}`);
  }

  await stagePlanUpdate(env, ctx, uid, { subscriptionStatus: subStatus }, event.created);
  console.log(`⚠️ [WEBHOOK] Staged subscription status ${subStatus} for uid=${redactId(uid)} (invoice ${redactId(invoice.id)})`);

  // Payment failure email (post-commit, fire-and-forget)
  try {
    const db = getDb(env);
    const userRow = db ? await db.prepare('SELECT email, plan FROM users WHERE auth_id = ?').bind(uid).first() : null;
    if (userRow?.email) {
      const userName = userRow.email.split('@')[0];
      const planName = userRow.plan || 'current';
      const { subject, html } = paymentFailedEmail(userName, planName, env.FRONTEND_URL);
      ctx.fireAndForget.push(() => sendEmail(env, { to: userRow.email, subject, html }).catch((e) => {
        console.warn('[WEBHOOK] Failed to send payment failure email (non-blocking):', e.message);
      }));
    }
  } catch (emailErr) {
    console.warn('[WEBHOOK] Error preparing payment failure email (non-blocking):', emailErr.message);
  }
  return ok();
}

// Invoice → subscription id across Stripe API versions: pre-basil exposes
// invoice.subscription; 2025-03-31.basil and later expose
// invoice.parent.subscription_details.subscription (id or expanded object).
function invoiceSubscriptionId(invoice) {
  const legacy = invoice?.subscription;
  const basil = invoice?.parent?.subscription_details?.subscription;
  const raw = legacy ?? basil ?? null;
  if (!raw) return null;
  return typeof raw === 'object' ? (raw.id || null) : String(raw);
}

// ── Verification & plan mapping ─────────────────────────────────────────

async function verifyStripeWebhook(env, req, rawBody) {
  const sig = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=', 2)));
  if (!parts.t || !parts.v1) return false;
  const payload = `${parts.t}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2,'0')).join('');
  if (expected.length !== parts.v1.length) return false;
  let diff = 0; for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  const age = Math.abs(Date.now()/1000 - Number(parts.t));
  return diff === 0 && age <= 300;
}

const kvPlanKey = (uid) => `planByUid:${uid}`;
function priceToPlan(env, priceId) {
  if (!priceId) return null;
  // New voice plans (repositioning)
  if (priceId === env.STRIPE_PRICE_WEEKLY) return 'weekly';
  if (priceId === env.STRIPE_PRICE_MONTHLY) return 'monthly';
  // Normalize legacy env price IDs across naming variants
  const essential = env.STRIPE_PRICE_ESSENTIAL_MONTHLY || env.PRICE_ESSENTIAL_MONTHLY || env.STRIPE_PRICE_ESSENTIAL || env.PRICE_ESSENTIAL;
  const pro = env.STRIPE_PRICE_PRO_MONTHLY || env.PRICE_PRO_MONTHLY || env.STRIPE_PRICE_PRO || env.PRICE_PRO;
  const premium = env.STRIPE_PRICE_PREMIUM_MONTHLY || env.PRICE_PREMIUM_MONTHLY || env.STRIPE_PRICE_PREMIUM || env.PRICE_PREMIUM;
  // Use if-statements to avoid undefined key collisions in map object
  if (priceId === essential) return 'essential';
  if (priceId === pro) return 'pro';
  if (priceId === premium) return 'premium';
  // Unknown subscription price IDs fall through to the callers' 'essential'
  // fallback, which the voice entitlement layer grandfathers as unlimited.
  return null;
}

function isPaidPlan(plan) {
  return ['weekly', 'monthly', 'essential', 'pro', 'premium'].includes(plan);
}
