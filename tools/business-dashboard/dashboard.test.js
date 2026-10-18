import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { monthKey, overview, validCostInput, accessTokenIsOwner } from './worker.bundle.js';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

const audience = '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40';

function database(cost = null, campaignItems = []) {
  const db = {
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM gmail_sync_state')) return null;
          if (sql.includes('FROM users')) return { count: 38, latest_update: '2026-10-15 02:14:32' };
          if (sql.includes('FROM monthly_costs')) return cost;
          throw new Error(`Unexpected first: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM campaign_items')) return { results: campaignItems.map(item => ({ ...item })) };
          if (sql.includes('FROM gmail_threads')) return { results: [] };
          if (sql.includes('stripe_collected_payments WHERE')) return { results: [
            { cents: 1700, ts: Date.parse('2026-10-03T17:54:21Z') / 1000 },
            { cents: 2500, ts: Date.parse('2026-09-30T14:00:00Z') / 1000 },
          ] };
          if (sql.includes('stripe_payment_refunds r')) return { results: [
            { cents: 1700, ts: Date.parse('2026-10-04T12:00:00Z') / 1000 },
          ] };
          throw new Error(`Unexpected all: ${sql}`);
        },
        async run() {
          if (sql.includes('UPDATE campaign_items')) {
            const item = campaignItems.find(item => item.id === this.args[0] && item.state === 'pending' && item.impact === 'campaign');
            if (!item) return { meta: { changes: 0 } };
            item.state = 'approved';
            item.evidence = 'Owner approval recorded in dashboard. This does not send outreach or schedule a post.';
            item.updatedAt = '2026-10-17 12:00:00';
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run: ${sql}`);
        },
      };
    },
  };
  return { PRODUCTION_DB: db, DASHBOARD_DB: db };
}

test('Eastern month boundaries and current-month net collection', async () => {
  assert.equal(monthKey(new Date('2026-11-01T03:30:00Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-11-01T04:30:00Z')), '2026-11');
  const result = await overview(database(), new Date('2026-10-16T12:00:00Z'));
  assert.equal(result.incomeGoalCents, 300000);
  assert.equal(result.capturedCents, 1700);
  assert.equal(result.refundedCents, 1700);
  assert.equal(result.netCollectedCents, 0);
  assert.equal(result.estimatedAvailableCents, null);
});

test('income remains unavailable until costs are marked complete', async () => {
  const pending = await overview(database({ amount_cents: 5000, complete: 0 }), new Date('2026-10-16T12:00:00Z'));
  assert.equal(pending.estimatedAvailableCents, null);
  const complete = await overview(database({ amount_cents: 5000, complete: 1 }), new Date('2026-10-16T12:00:00Z'));
  assert.equal(complete.estimatedAvailableCents, -5000);
});

test('cost input is bound to current month and a valid whole-cent amount', () => {
  assert.equal(validCostInput({ month: '2026-09', amountCents: 1, complete: true }, '2026-10'), null);
  assert.equal(validCostInput({ month: '2026-10', amountCents: -1, complete: true }, '2026-10'), null);
  assert.deepEqual(validCostInput({ month: '2026-10', amountCents: 5000, complete: false }, '2026-10'), { month: '2026-10', amountCents: 5000, complete: false });
});

test('every endpoint fails closed without the exact owner identity', async () => {
  for (const path of ['/', '/style.css', '/app.js', '/api/overview', '/api/costs']) {
    const request = new Request(`https://dashboard.jobhackai.io${path}`, { method: path === '/api/costs' ? 'POST' : 'GET' });
    assert.equal((await worker.fetch(request, {}, {})).status, 403);
    assert.equal((await worker.fetch(request, {}, { access: { aud: audience, getIdentity: async () => ({ email: 'another@example.com' }) } })).status, 403);
  }
});

test('the owner can load the page and read a source-labelled overview', async () => {
  const ctx = { access: { aud: '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40', getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const page = await worker.fetch(new Request('https://dashboard.jobhackai.io/'), database(), ctx);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Monthly income goal/);
  const api = await worker.fetch(new Request('https://dashboard.jobhackai.io/api/overview'), database(), ctx);
  assert.equal(api.status, 200);
  const payload = await api.json();
  assert.equal(payload.incomeGoalCents, 300000);
  assert.equal(payload.d1UserRecords, 38);
  assert.match(payload.basis, /not independently verified/);
});

test('the phone reload gets the new campaign script rather than a cached old script', async () => {
  const ctx = { access: { aud: audience, getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const page = await worker.fetch(new Request('https://dashboard.jobhackai.io/'), database(), ctx);
  assert.match(await page.text(), /app\.js\?v=2026-10-17-gmail-sync/);
  const script = await worker.fetch(new Request('https://dashboard.jobhackai.io/app.js?v=2026-10-17-gmail-sync'), database(), ctx);
  assert.equal(script.headers.get('Cache-Control'), 'no-store');
  assert.match(await script.text(), /api\/campaigns/);
});

test('an identity from a different Access application cannot authorize the request', async () => {
  const ctx = { access: { aud: 'wrong-application', getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const page = await worker.fetch(new Request('https://dashboard.jobhackai.io/'), database(), ctx);
  assert.equal(page.status, 403);
});

test('JWT verification enforces signature, issuer, audience, expiry and owner email', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
  const makeToken = (email, aud = audience, expiry = '1h') => new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://jobhack.cloudflareaccess.com')
    .setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  assert.equal(await accessTokenIsOwner(await makeToken('sebastian.larosa@jobhackai.io'), keys), true);
  assert.equal(await accessTokenIsOwner(await makeToken('another@example.com'), keys), false);
  assert.equal(await accessTokenIsOwner(await makeToken('sebastian.larosa@jobhackai.io', 'wrong-app'), keys), false);
  assert.equal(await accessTokenIsOwner(await makeToken('sebastian.larosa@jobhackai.io', audience, '0s'), keys), false);
  const valid = await makeToken('sebastian.larosa@jobhackai.io');
  const [header, payload] = valid.split('.');
  assert.equal(await accessTokenIsOwner(`${header}.${payload}.forged-signature`, keys), false);
});

test('cost updates reject a foreign origin', async () => {
  const request = new Request('https://dashboard.jobhackai.io/api/costs', {
    method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: '2026-10', amountCents: 1, complete: true }),
  });
  const ctx = { access: { aud: audience, getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  assert.equal((await worker.fetch(request, {}, ctx)).status, 403);
});

test('campaign refresh reflects a saved approval and does not imply sending', async () => {
  const ctx = { access: { aud: audience, getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const env = database(null, [{ id: 'new-outreach-proposals', channel: 'Stan · Outreach', title: 'New proposals', detail: 'Review first', reviewUrl: 'https://chatgpt.com/space/page_example', state: 'pending', impact: 'campaign', evidence: 'Awaiting review', updatedAt: '2026-10-17 11:00:00', sortOrder: 1 }]);
  const list = () => worker.fetch(new Request('https://dashboard.jobhackai.io/api/campaigns'), env, ctx);
  assert.equal((await (await list()).json()).items[0].state, 'pending');
  const approval = new Request('https://dashboard.jobhackai.io/api/campaigns/new-outreach-proposals/approve', {
    method: 'POST', headers: { Origin: 'https://dashboard.jobhackai.io', 'Content-Type': 'application/json' }, body: '{}',
  });
  const response = await worker.fetch(approval, env, ctx);
  assert.equal(response.status, 200);
  const after = (await (await list()).json()).items[0];
  assert.equal(after.state, 'approved');
  assert.match(after.evidence, /does not send outreach/);
  assert.equal((await worker.fetch(approval, env, ctx)).status, 409);
});

test('campaign approval rejects foreign origins and non-owner requests', async () => {
  const path = 'https://dashboard.jobhackai.io/api/campaigns/new-outreach-proposals/approve';
  const env = database();
  const owner = { access: { aud: audience, getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const foreign = new Request(path, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(foreign, env, owner)).status, 403);
  const valid = new Request(path, { method: 'POST', headers: { Origin: 'https://dashboard.jobhackai.io', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(valid, env, {})).status, 403);
});

test('an inbound prospect cannot be treated as a campaign approval', async () => {
  const env = database(null, [{ id: 'inbound-prospect', channel: 'Inbound · Prospect', title: 'Reply to prospect', detail: 'Asked for a meeting', reviewUrl: 'https://mail.google.com/mail/u/0/#all/thread', state: 'pending', impact: 'prospect', nextAction: 'Reply with times next week.', evidence: 'Verified in Gmail', updatedAt: '2026-10-17 11:00:00', sortOrder: 0 }]);
  const ctx = { access: { aud: audience, getIdentity: async () => ({ email: 'sebastian.larosa@jobhackai.io' }) } };
  const list = await worker.fetch(new Request('https://dashboard.jobhackai.io/api/campaigns'), env, ctx);
  const item = (await list.json()).items[0];
  assert.equal(item.impact, 'prospect');
  assert.equal(item.nextAction, 'Reply with times next week.');
  const approval = new Request('https://dashboard.jobhackai.io/api/campaigns/inbound-prospect/approve', { method: 'POST', headers: { Origin: 'https://dashboard.jobhackai.io', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(approval, env, ctx)).status, 409);
});
