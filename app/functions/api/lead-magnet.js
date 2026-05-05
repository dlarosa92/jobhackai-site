// Lead-magnet email capture endpoint.
// Records an email address (D1 if available, KV fallback), then sends the
// requested asset via Resend. Intentionally does not require auth — this is
// a top-of-funnel capture for visitors who aren't ready to sign up yet.

import { sendEmail } from '../_lib/email.js';
import { getDb } from '../_lib/db.js';

const ALLOWED_ASSETS = new Set(['ats-checklist']);

function corsHeaders(origin, env) {
  const fallbackOrigins = [
    'https://jobhackai.io',
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  const configured = (env && env.FRONTEND_URL) ? env.FRONTEND_URL : null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || fallbackOrigins[0]);
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin, env) });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checklistHtml() {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1F2937;">
      <h1 style="font-size:1.5rem;margin-bottom:0.75rem;">The 12-Point ATS Resume Checklist</h1>
      <p>Here are the same checks our AI runs on every resume — score yours against this list before your next application.</p>
      <ol style="line-height:1.6;">
        <li>One-column layout (no tables, text boxes, or columns)</li>
        <li>Standard section headings: Experience, Education, Skills, Summary</li>
        <li>Job title in the top third matches the role you're applying to</li>
        <li>Hard skills from the job description appear verbatim at least once</li>
        <li>Quantified results in 60%+ of bullets (numbers, %, $, ×)</li>
        <li>Action verbs lead every bullet (no "Responsible for…")</li>
        <li>Reverse-chronological order with consistent date formatting</li>
        <li>Contact info: city + state, phone, email, LinkedIn URL — no headshot</li>
        <li>File saved as PDF unless the application asks for DOCX</li>
        <li>Filename is "Firstname-Lastname-Resume.pdf"</li>
        <li>No graphics, icons, or color blocks behind text</li>
        <li>Length: 1 page if &lt;10 yrs experience, 2 pages otherwise</li>
      </ol>
      <p style="margin-top:1.5rem;">Want JobHackAI to score and rewrite your resume against any job description? <a href="https://jobhackai.io/pricing-a.html" style="color:#0077B5;">Start your free 3-day trial</a> — no credit card required.</p>
      <p style="font-size:0.8rem;color:#6B7280;margin-top:2rem;">Sent because you requested the checklist on jobhackai.io. Reply to this email if you didn't.</p>
    </div>
  `;
}

// Module-level cache: workers reuse isolates across requests, so caching the
// "table exists" decision keeps the hot path to a single INSERT instead of
// a CREATE TABLE + INSERT (D1 DDL goes through the replication path and
// roughly doubles the per-request op count).
let _leadsTableEnsured = false;

async function ensureLeadsTable(db) {
  if (_leadsTableEnsured) return true;
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS leads (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         email TEXT NOT NULL,
         asset TEXT NOT NULL,
         source TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ).run();
    _leadsTableEnsured = true;
    return true;
  } catch (e) {
    console.warn('[LEAD-MAGNET] Failed to ensure leads table:', e?.message || e);
    return false;
  }
}

async function recordLead(env, { email, asset, source }) {
  // Best-effort persistence. D1 first; KV fallback. Schema is intentionally
  // minimal — we just need to know who asked for what.
  try {
    const db = getDb(env);
    if (db) {
      try {
        await db.prepare(
          `INSERT INTO leads (email, asset, source) VALUES (?, ?, ?)`
        ).bind(email, asset, source || null).run();
        return;
      } catch (insertErr) {
        // First-run case (or table dropped): create it once per isolate
        // and retry. Subsequent requests skip the DDL entirely.
        const ensured = await ensureLeadsTable(db);
        if (ensured) {
          await db.prepare(
            `INSERT INTO leads (email, asset, source) VALUES (?, ?, ?)`
          ).bind(email, asset, source || null).run();
          return;
        }
        throw insertErr;
      }
    }
  } catch (e) {
    console.warn('[LEAD-MAGNET] D1 insert failed, falling back to KV:', e?.message || e);
  }
  try {
    if (env.JOBHACKAI_KV) {
      const key = `lead:${asset}:${Date.now()}:${email}`;
      await env.JOBHACKAI_KV.put(key, JSON.stringify({ email, asset, source, ts: new Date().toISOString() }), {
        expirationTtl: 60 * 60 * 24 * 365 // 1 year
      });
    }
  } catch (e) {
    console.warn('[LEAD-MAGNET] KV fallback failed (non-blocking):', e?.message || e);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, origin, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'Invalid JSON' }, 400, origin, env);
  }

  const email = (payload?.email || '').toString().trim().toLowerCase();
  const asset = (payload?.asset || 'ats-checklist').toString();
  const source = (payload?.source || 'unknown').toString().slice(0, 64);

  if (!isValidEmail(email)) {
    return json({ ok: false, error: 'Invalid email' }, 400, origin, env);
  }
  if (!ALLOWED_ASSETS.has(asset)) {
    return json({ ok: false, error: 'Unknown asset' }, 400, origin, env);
  }

  await recordLead(env, { email, asset, source });

  if (asset === 'ats-checklist') {
    const result = await sendEmail(env, {
      to: email,
      subject: 'Your 12-Point ATS Resume Checklist',
      html: checklistHtml()
    });
    if (!result.ok) {
      // Email failed — still 200 so we don't surface the user's address to a
      // probe; we logged the lead and ops can resend manually if needed.
      console.warn('[LEAD-MAGNET] Resend failed for', email, result.error);
    }
  }

  return json({ ok: true }, 200, origin, env);
}
