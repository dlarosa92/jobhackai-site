import { createRemoteJWKSet, jwtVerify } from 'jose';
import { gmailRecords } from './gmail-sync.js';
import { outreachRecords, ownerOutreach, isLegacyEmail } from './outreach.js';
import { digest } from './outreach-policy.js';
import { requestIdentity, allowed } from './access.js';
import { workApi, workRecords, cacheNativeSources } from './work-items.js';
import { workflowApi, checkWorkflowDeadlines } from './workflow.js';
import { analyticsApi, analyticsReport } from './analytics.js';
import { directoryRecords, duplicateDirectoryRecord, applyResolutions, resolveNotification } from './notifications.js';

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
    userGoal: 250,
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
  const [result, gmail, outreach, directory] = await Promise.all([
    env.DASHBOARD_DB.prepare("SELECT id, channel, title, detail, review_url AS reviewUrl, state, evidence, updated_at AS updatedAt, sort_order AS sortOrder, impact, next_action AS nextAction FROM campaign_items WHERE gmail_thread_id IS NULL OR NOT EXISTS (SELECT 1 FROM gmail_threads WHERE thread_id=campaign_items.gmail_thread_id) ORDER BY CASE impact WHEN 'customer' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END, sort_order, id").all(),
    gmailRecords(env.DASHBOARD_DB, now),
    outreachRecords(env.DASHBOARD_DB, now.getTime()),
    directoryRecords(env, now),
  ]);
  const rank = { customer: 0, prospect: 1, campaign: 2 };
  const manual = await Promise.all(result.results.map(async item => {
    const reviewRevision = await campaignRevision(item);
    if(isLegacyEmail(item) && ['pending','approved'].includes(item.state)) return {...item, reviewRevision, state:'hold',
      evidence:'This legacy email card has no bound recipient/message or current software checks. Its previous approval is retained as history, not send permission.',
      nextAction:'Reconcile native sends, then prepare exact unsent messages through the outreach gate.', requiresOutreachManifest:true};
    return {...item,reviewRevision};
  }));
  const trackedThreads = new Set(gmail.items.map(item => item.id.slice('gmail-'.length)));
  const outbound = outreach.items.filter(item => item.deliveryState !== 'sent' || !trackedThreads.has(item.sentThreadId) || item.issues.some(issue => !issue.startsWith('received_reply_review')));
  const ids = new Set(directory.items.map(item => item.id));
  const notifications = await applyResolutions(env.DASHBOARD_DB, [...directory.items, ...gmail.items]);
  const items = [...notifications.filter(item => item.source !== 'gmail' || !duplicateDirectoryRecord(item, ids)),
    ...manual.filter(item => !duplicateDirectoryRecord(item, ids)), ...outbound]
    .sort((a, b) => rank[a.impact] - rank[b.impact]);
  return {
    asOf: now.toISOString(),
    latestChange: items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ''),
    items,
    gmailSync: gmail.gmailSync,
    directorySource: directory.directorySource,
    outreachSendingEnabled: env.OUTREACH_SENDER_ENABLED === 'true',
  };
}

function campaignRevision(item) {
  return digest({id:item.id,channel:item.channel,title:item.title,detail:item.detail,reviewUrl:item.reviewUrl,nextAction:item.nextAction||''});
}

function validCostInput(input, expectedMonth) {
  if (!input || input.month !== expectedMonth) return null;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 100_000_000) return null;
  if (typeof input.complete !== 'boolean') return null;
  return input;
}

export default {
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(checkWorkflowDeadlines(env,new Date(controller.scheduledTime)));
  },
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const identity=await requestIdentity(request,env,ctx);
      if (!allowed(identity,request.method,url.pathname)) return json({error:'Forbidden'},403);
      if(request.method!=='GET' && (request.headers.get('content-type')?.split(';')[0]!=='application/json' || (identity.role==='owner' && request.headers.get('origin')!==url.origin)))return json({error:'Invalid request origin or type'},403);
      if(request.method==='GET'&&url.pathname==='/api/session')return json({role:identity.role,capabilities:identity.capabilities||[]});
      if(request.method==='GET'&&url.pathname==='/api/operating-guide')return json({version:'2026-10-25',text:GUIDE});
      if(url.pathname==='/api/workflow'||url.pathname.startsWith('/api/workflow/'))return workflowApi(request,env,identity,new Date(),async()=>workRecords(env.DASHBOARD_DB,await campaignRecords(env)));
      if(url.pathname==='/api/analytics')return analyticsApi(request,env);
      if(request.method==='POST'&&url.pathname==='/api/work-items/capture-native')return json(await cacheNativeSources(env.DASHBOARD_DB,await campaignRecords(env)));
      if(url.pathname==='/api/work-items'||url.pathname.startsWith('/api/work-items/'))return workApi(request,env,identity,async()=>{
        const [base,analytics]=await Promise.all([campaignRecords(env),analyticsReport(env.DASHBOARD_DB)]);
        return workRecords(env.DASHBOARD_DB,{...base,analytics});
      });
      if(identity.role==='machine'&&url.pathname==='/api/outreach/prepare'){
        const headers=new Headers(request.headers);headers.set('origin',url.origin);
        return ownerOutreach(new Request(request,{headers}),env);
      }
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(PAGE, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
      if (request.method === 'GET' && url.pathname === '/style.css') return asset(CSS, 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/app.js') return asset(APP, 'application/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/api/overview') return json(await overview(env));
      if (request.method === 'GET' && url.pathname === '/api/campaigns') return json(await campaignRecords(env));
      const resolution = /^\/api\/notifications\/(handle|reopen)$/.exec(url.pathname);
      if (request.method === 'POST' && resolution) {
        if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
        // Read at most 1 KiB even when the client omits or lies about Content-Length.
        const reader = request.body?.getReader();
        if (!reader) return json({ error: 'Missing notification revision' }, 400);
        let size = 0, text = ''; const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 1024) { await reader.cancel(); return json({ error: 'Request too large' }, 413); }
          text += decoder.decode(value, { stream: true });
        }
        let input;
        try { input = JSON.parse(text + decoder.decode()); } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (!await resolveNotification(env, input, resolution[1])) return json({ error: 'This notification changed or is unavailable. Refresh before marking it handled or reopening it.' }, 409);
        return json(await campaignRecords(env));
      }
      if (url.pathname.startsWith('/api/outreach')) return ownerOutreach(request,env);
      const approval = /^\/api\/campaigns\/([a-z0-9-]{1,64})\/approve$/.exec(url.pathname);
      if (request.method === 'POST' && approval) {
        if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
        return json({error:'Open the complete draft in the review panel. Legacy summary approvals are retired; saved approval history is retained.'},409);
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

export { monthKey, sameMonth, overview, campaignRecords, campaignRevision, validCostInput, accessTokenIsOwner };
