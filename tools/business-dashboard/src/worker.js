import { createRemoteJWKSet, jwtVerify } from 'jose';

const OWNER = 'sebastian.larosa@jobhackai.io';
const ACCESS_AUD = '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40';
const ACCESS_ISSUER = 'https://jobhack.cloudflareaccess.com';
const ACCESS_KEYS = createRemoteJWKSet(new URL(`${ACCESS_ISSUER}/cdn-cgi/access/certs`));
const ZONE = 'America/New_York';
const monthFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit' });

function monthKey(date) {
  const parts = monthFormatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function sameMonth(unixSeconds, key) {
  return monthKey(new Date(unixSeconds * 1000)) === key;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function asset(body, type) {
  return new Response(body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function ownerIdentity(request, ctx) {
  if (ctx.access?.aud === ACCESS_AUD) {
    const identity = await ctx.access.getIdentity();
    return identity?.email?.toLowerCase() === OWNER;
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  return accessTokenIsOwner(token);
}

async function accessTokenIsOwner(token, keys = ACCESS_KEYS) {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ACCESS_ISSUER,
      audience: ACCESS_AUD,
      algorithms: ['RS256'],
    });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === OWNER;
  } catch { return false; }
}

async function overview(env, now = new Date()) {
  const month = monthKey(now);
  const [users, charges, refunds, costs] = await Promise.all([
    env.PRODUCTION_DB.prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS latest_update FROM users').first(),
    env.PRODUCTION_DB.prepare("SELECT amount_captured AS cents, charge_created_at AS ts FROM stripe_collected_payments WHERE environment = 'prod' AND livemode = 1 AND currency = 'usd' AND charge_created_at >= ?").bind(Math.floor(now.getTime() / 1000) - 40 * 86400).all(),
    env.PRODUCTION_DB.prepare("SELECT r.amount AS cents, r.refund_created_at AS ts FROM stripe_payment_refunds r JOIN stripe_collected_payments p ON p.charge_id = r.charge_id WHERE r.status = 'succeeded' AND r.currency = 'usd' AND p.environment = 'prod' AND p.livemode = 1 AND r.refund_created_at >= ?").bind(Math.floor(now.getTime() / 1000) - 40 * 86400).all(),
    env.DASHBOARD_DB.prepare('SELECT amount_cents, complete, updated_at FROM monthly_costs WHERE month = ?').bind(month).first(),
  ]);
  const capturedCents = charges.results.filter(row => sameMonth(row.ts, month)).reduce((sum, row) => sum + row.cents, 0);
  const refundedCents = refunds.results.filter(row => sameMonth(row.ts, month)).reduce((sum, row) => sum + row.cents, 0);
  const netCollectedCents = capturedCents - refundedCents;
  const costsComplete = costs?.complete === 1;
  return {
    asOf: now.toISOString(),
    month,
    incomeGoalCents: 300000,
    d1UserRecords: users?.count ?? null,
    d1UsersLatestUpdate: users?.latest_update ?? null,
    capturedCents,
    refundedCents,
    netCollectedCents,
    costCents: costs?.amount_cents ?? null,
    costsComplete,
    costUpdatedAt: costs?.updated_at ?? null,
    estimatedAvailableCents: costsComplete ? netCollectedCents - costs.amount_cents : null,
    basis: 'Production D1 payment and refund ledger, USD; entered monthly business costs. Stripe reconciliation and complete expense coverage are not independently verified.',
  };
}

async function campaignRecords(env, now = new Date()) {
  const result = await env.DASHBOARD_DB.prepare('SELECT id, channel, title, detail, review_url AS reviewUrl, state, evidence, updated_at AS updatedAt, sort_order AS sortOrder FROM campaign_items ORDER BY sort_order, id').all();
  const items = result.results;
  return {
    asOf: now.toISOString(),
    latestChange: items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ''),
    items,
  };
}

async function approveCampaign(env, id) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return false;
  const result = await env.DASHBOARD_DB.prepare("UPDATE campaign_items SET state = 'approved', evidence = 'Owner approval recorded in dashboard. This does not send outreach or schedule a post.', updated_at = datetime('now') WHERE id = ? AND state = 'pending'").bind(id).run();
  return result.meta?.changes === 1;
}

function validCostInput(input, expectedMonth) {
  if (!input || input.month !== expectedMonth) return null;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 100_000_000) return null;
  if (typeof input.complete !== 'boolean') return null;
  return input;
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (!await ownerIdentity(request, ctx)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(PAGE, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/style.css') return asset(CSS, 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/app.js') return asset(APP, 'application/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/api/overview') return json(await overview(env));
      if (request.method === 'GET' && url.pathname === '/api/campaigns') return json(await campaignRecords(env));
      const approval = /^\/api\/campaigns\/([a-z0-9-]{1,64})\/approve$/.exec(url.pathname);
      if (request.method === 'POST' && approval) {
        if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
        if (!await approveCampaign(env, approval[1])) return json({ error: 'This item is no longer awaiting approval. Refresh to see its current status.' }, 409);
        return json(await campaignRecords(env));
      }
      if (request.method === 'POST' && url.pathname === '/api/costs') {
        if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
        const body = await request.json();
        const input = validCostInput(body, monthKey(new Date()));
        if (!input) return json({ error: 'Invalid month, amount, or completion status' }, 400);
        await env.DASHBOARD_DB.prepare('INSERT INTO monthly_costs (month, amount_cents, complete, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents, complete = excluded.complete, updated_at = excluded.updated_at')
          .bind(input.month, input.amountCents, input.complete ? 1 : 0).run();
        return json(await overview(env));
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: 'dashboard_error', name: error?.name || 'Error' }));
      return json({ error: 'Dashboard data unavailable' }, 503);
    }
  },
};

export { monthKey, sameMonth, overview, campaignRecords, approveCampaign, validCostInput, accessTokenIsOwner };
