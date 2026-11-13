// Private owner operations. Complimentary grants use the existing pack-credit
// fields, preserving the subscription, lifetime free interview and payment facts.
export const PILOT_CREDITS = 60;
const DAY = 86400000;
const COHORT = 'brighton-2026-11';
const CAPACITY = { participant: 10, specialist: 3 };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export function normalizeGrant(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid enrollment.', 400);
  const email = String(input.email || '').trim().toLowerCase();
  const id = String(input.id || '');
  const role = input.role;
  if (!/^[a-z0-9][a-z0-9_-]{7,79}$/.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !Object.hasOwn(CAPACITY, role)) throw fail('Provide a stable grant reference, account email and role.', 400);
  if (input.cohortId !== COHORT) throw fail('Unknown pilot cohort.', 400);
  const starts = Date.parse(input.startsAt), expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(starts) || !Number.isFinite(expires) || !/[zZ]$|[+-]\d\d:\d\d$/.test(input.startsAt) || !/[zZ]$|[+-]\d\d:\d\d$/.test(input.expiresAt)) throw fail('Use dates with an explicit timezone.', 400);
  const duration = expires - starts;
  if (duration < DAY || duration > (role === 'participant' ? 30 : 45) * DAY || (role === 'participant' && duration !== 30 * DAY)) throw fail('Participants receive 30 days. Specialist access may include preparation and up to 45 days total.', 400);
  if (expires <= now.getTime()) throw fail('The access expiry must be in the future.', 400);
  return { id, cohortId: COHORT, email, role, startsAt: new Date(starts).toISOString(), expiresAt: new Date(expires).toISOString(), credits: PILOT_CREDITS };
}

async function revision(value) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
}

async function account(db, email) {
  const result = await db.prepare(`SELECT id, auth_id, email, plan, subscription_status, current_period_end,
    stripe_customer_id, stripe_subscription_id, voice_sessions_remaining, pack_expires_at,
    free_session_used, has_ever_paid FROM users WHERE lower(email)=? LIMIT 2`).bind(email).all();
  if (result.results.length !== 1) throw fail(result.results.length ? 'More than one account matches. Resolve account identity before enrollment.' : 'Account not found. Ask this person to create and sign into their own free account first.');
  return result.results[0];
}

function sameGrant(saved, grant, user) {
  return saved.id === grant.id && saved.user_id === user.id && saved.cohort_id === grant.cohortId && saved.role === grant.role && saved.starts_at === grant.startsAt && saved.expires_at === grant.expiresAt && saved.credits === grant.credits;
}

export async function preparePilotGrant(db, input, now = new Date()) {
  const grant = normalizeGrant(input, now);
  const user = await account(db, grant.email);
  const existing = await db.prepare('SELECT * FROM pilot_credit_grants WHERE id=? OR user_id=?').bind(grant.id, user.id).all();
  if (existing.results.length) {
    if (existing.results.length !== 1 || !sameGrant(existing.results[0], grant, user)) throw fail('This account or grant reference is already enrolled with different details. No credits were added.');
    return { grant, user, existing: existing.results[0], revision: null };
  }
  if (user.has_ever_paid || user.stripe_subscription_id || user.subscription_status || (user.plan && user.plan !== 'free') || Number(user.voice_sessions_remaining) !== 0 || user.pack_expires_at) throw fail('This account has billing history, a subscription or existing credit state. Reconcile it separately; this flow will not overwrite or duplicate access.');
  if (!user.auth_id) throw fail('The account has no authentication identity.');
  const deleting = await db.prepare('SELECT 1 AS present FROM account_deletion_admissions WHERE auth_id=? LIMIT 1').bind(user.auth_id).first();
  if (deleting) throw fail('Account deletion is in progress or recorded. Enrollment is unavailable.');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM pilot_credit_grants WHERE cohort_id=? AND role=?').bind(grant.cohortId, grant.role).first();
  if (count.n >= CAPACITY[grant.role]) throw fail('This pilot role is already at capacity.');
  return { grant, user, existing: null, revision: await revision({ grant, user }) };
}

function preview(result, now) {
  const { grant, user, existing } = result;
  return { grant, account: { email: user.email, freeSessionAvailable: !user.free_session_used, creditsBefore: Number(user.voice_sessions_remaining) },
    alreadyApplied: !!existing, expectedRevision: result.revision,
    canApplyNow: Date.parse(grant.startsAt) <= now.getTime(),
    note: 'Adds 60 complimentary interview credits using existing access controls. Any unused lifetime free interview remains separate. No payment card, subscription, payment history or automatic renewal is created. Credits become available immediately when applied.' };
}

export async function applyPilotGrant(db, input, owner, now = new Date()) {
  const result = await preparePilotGrant(db, input, now);
  if (result.existing) return { ...preview(result, now), applied: true, duplicate: true };
  if (input.confirmAccountOwner !== true) throw fail('Confirm that this is the intended person’s own account.', 400);
  if (input.expectedRevision !== result.revision) throw fail('Account or enrollment details changed. Preview again before applying.');
  const { grant: g, user: u } = result;
  if (Date.parse(g.startsAt) > now.getTime()) throw fail('This pilot has not started. Preview now and apply on the agreed start date; this flow does not schedule future activation.');
  // Every eligibility condition is repeated inside the transaction. The unique
  // grant/account constraints prevent simultaneous requests from double granting.
  // The second statement can only see a grant inserted by this successful batch.
  const statements = [
    db.prepare(`INSERT INTO pilot_credit_grants(id,cohort_id,user_id,role,credits,starts_at,expires_at,free_session_available,created_at,created_by)
      SELECT ?,?,id,?,60,?,?,CASE WHEN free_session_used=0 THEN 1 ELSE 0 END,?,?
      FROM users WHERE id=? AND auth_id=? AND lower(email)=?
        AND COALESCE(has_ever_paid,0)=0 AND stripe_subscription_id IS NULL AND subscription_status IS NULL
        AND (plan IS NULL OR plan IN ('','free'))
        AND voice_sessions_remaining=0 AND pack_expires_at IS NULL AND free_session_used=?
        AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=users.auth_id)
        AND (SELECT COUNT(*) FROM pilot_credit_grants WHERE cohort_id=? AND role=?) < ?`)
      .bind(g.id, g.cohortId, g.role, g.startsAt, g.expiresAt, now.toISOString(), owner,
        u.id, u.auth_id, g.email, u.free_session_used, g.cohortId, g.role, CAPACITY[g.role]),
    db.prepare(`UPDATE users SET voice_sessions_remaining=voice_sessions_remaining+60, pack_expires_at=?, updated_at=?
      WHERE changes()=1 AND id=? AND EXISTS(SELECT 1 FROM pilot_credit_grants WHERE id=? AND user_id=users.id)`)
      .bind(g.expiresAt, now.toISOString(), u.id, g.id)
  ];
  try {
    const results = await db.batch(statements);
    if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) throw fail('Account eligibility changed. Preview again; no enrollment was applied.');
  } catch (error) {
    // A duplicate race commits only the winning transaction. Never retry its
    // credit UPDATE independently, including after an ambiguous response.
    const saved = await db.prepare('SELECT * FROM pilot_credit_grants WHERE id=?').bind(g.id).first();
    if (saved && sameGrant(saved, g, u)) return { ...preview({ ...result, existing: saved }, now), applied: true, duplicate: true };
    throw error;
  }
  return { ...preview(result, now), applied: true, duplicate: false };
}

export async function pilotReport(db, now = new Date()) {
  const data = await db.prepare(`SELECT g.*,u.email,u.auth_id,u.voice_sessions_remaining,u.pack_expires_at,
    u.free_session_used,u.has_ever_paid,u.subscription_status,u.stripe_subscription_id,
    (SELECT COUNT(*) FROM voice_sessions s WHERE s.user_id=g.user_id AND julianday(s.started_at)>=julianday(g.created_at) AND julianday(s.started_at)<julianday(g.expires_at)) AS retained_starts,
    (SELECT COUNT(*) FROM voice_sessions s WHERE s.user_id=g.user_id AND s.status='completed' AND julianday(s.started_at)>=julianday(g.created_at) AND julianday(s.started_at)<julianday(g.expires_at)) AS retained_completions,
    (SELECT MAX(started_at) FROM voice_sessions s WHERE s.user_id=g.user_id AND julianday(s.started_at)>=julianday(g.created_at)) AS last_activity
    FROM pilot_credit_grants g JOIN users u ON u.id=g.user_id WHERE g.cohort_id=? ORDER BY g.role,u.email`).bind(COHORT).all();
  const items = data.results.map(row => {
    const balance = Number(row.voice_sessions_remaining);
    const changed = !!row.has_ever_paid || !!row.subscription_status || !!row.stripe_subscription_id || row.pack_expires_at !== row.expires_at || balance < 0 || balance > row.credits;
    const expired = Date.parse(row.expires_at) <= now.getTime();
    return { id: row.id, email: row.email, role: row.role, granted: row.credits, startsAt: row.starts_at, expiresAt: row.expires_at,
      status: changed ? 'review_access' : expired ? 'expired' : balance === 0 ? 'credits_used' : 'active',
      remaining: changed ? null : expired ? 0 : balance, unusedCredits: changed ? null : balance,
      usedCredits: changed ? null : row.credits - balance, freeSessionAvailable: !row.free_session_used,
      retainedStarts: row.retained_starts, retainedCompletions: row.retained_completions, lastActivity: row.last_activity };
  });
  return { checkedAt: now.toISOString(), cohortId: COHORT, capacity: CAPACITY, items,
    note: 'Credits used is the net change in the granted balance, including restored credits. Starts and completions count retained session records since enrollment; deleted history is not counted. External account changes require review. An unused lifetime free interview is separate from the 60 granted credits.' };
}

export async function pilotApi(request, env, identity, now = new Date()) {
  if (identity?.role !== 'owner') return json({ error: 'Forbidden' }, 403);
  if (env.PILOT_ADMIN_ENABLED !== 'true') return json({ error: 'Pilot enrollment is not enabled.' }, 404);
  try {
    if (request.method === 'GET') return json(await pilotReport(env.PRODUCTION_DB, now));
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
    const reader = request.body?.getReader();
    if (!reader) throw fail('Missing enrollment.', 400);
    let size = 0, text = ''; const decoder = new TextDecoder();
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); throw fail('Enrollment request too large.', 413); } text += decoder.decode(value, { stream: true }); }
    let input;
    try { input = JSON.parse(text + decoder.decode()); } catch { throw fail('Invalid JSON.', 400); }
    if (input.dryRun !== false) return json(preview(await preparePilotGrant(env.PRODUCTION_DB, input, now), now));
    return json(await applyPilotGrant(env.PRODUCTION_DB, input, identity.id, now));
  } catch (error) {
    return json({ error: error.status ? error.message : 'Pilot records are unavailable. Check migration and database access before retrying.' }, error.status || 503);
  }
}
