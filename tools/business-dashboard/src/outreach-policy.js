// Pure policy plus public DNS only. Neither this module nor preflight sends mail.
const encoder = new TextEncoder();
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HEADER_CONTROL = /[\r\n\u0000]/;
export const CHECK_TTL = 5 * 60 * 1000;
export const SOURCE_TTL = 7 * 86400000;
export const OWNER = 'sebastian.larosa@jobhackai.io';

export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !EMAIL.test(value)) return null;
  return value.toLowerCase();
}
export function fresh(value, now, ttl = CHECK_TTL) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now && now - time <= ttl;
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function publicUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(u.hostname) && !u.hostname.endsWith('.localhost');
  } catch { return false; }
}
export function normalizePacket(input, now = Date.now()) {
  if (!input || !/^[a-z0-9-]{1,64}$/.test(input.id || '')) throw new Error('A stable message ID is required.');
  const m = input.message;
  const e = input.evidence;
  if (!m || !e || !['coach', 'kit-distributor', 'local-provider', 'community-publisher'].includes(input.lane) || !['intro', 'followup'].includes(input.phase)) throw new Error('Choose the lead lane and introduction/follow-up phase.');
  const recipient = normalizeEmail(m.recipient);
  if (!recipient || typeof m.subject !== 'string' || !m.subject.trim() || m.subject.length > 300 || HEADER_CONTROL.test(m.subject)) throw new Error('One exact recipient and a valid subject are required.');
  if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 30000 || /\u0000/.test(m.text)) throw new Error('Complete review copy is required.');
  const html = m.html || '';
  if (typeof html !== 'string' || html.length > 40000 || /\u0000|<(?:script|style|link|iframe|object|embed|form|input|svg|math|meta|base|img|video|audio)\b|\son\w+\s*=/i.test(html)) throw new Error('Email HTML must contain only the reviewed copy, formatting and links.');
  if (Object.keys(m).some(key => !['recipient', 'subject', 'text', 'html', 'threadId', 'inReplyTo', 'references'].includes(key))) throw new Error('Extra recipients, headers and attachments are not supported.');
  const threadId = m.threadId || '';
  const inReplyTo = m.inReplyTo || '';
  const references = m.references || '';
  if ((threadId && !/^[a-f0-9]{1,64}$/.test(threadId)) || [inReplyTo, references].some(v => typeof v !== 'string' || v.length > 3000 || HEADER_CONTROL.test(v))) throw new Error('Invalid original-thread headers.');
  if (input.phase === 'followup' && (!threadId || !/^<[^<>\s]+>$/.test(inReplyTo))) throw new Error('A follow-up requires the verified original thread and Message-ID.');
  if (input.phase === 'intro' && (threadId || inReplyTo || references)) throw new Error('An introduction cannot inherit an earlier conversation.');
  if (!publicUrl(e.sourceUrl) || !fresh(e.checkedAt, now, SOURCE_TTL) || normalizeEmail(e.publishedEmail) !== recipient || (e.mailtoEmail && normalizeEmail(e.mailtoEmail) !== recipient)) throw new Error('Current first-party email evidence and matching mailto are required.');
  if (e.fit !== 'current' || typeof e.fitFact !== 'string' || !e.fitFact.trim() || e.fitFact.length > 2000 || !['Codex', OWNER].includes(e.checkedBy)) throw new Error('A reviewed current business-fit fact is required.');
  if (input.lane === 'local-provider' && (!publicUrl(e.profileUrl) || new URL(e.profileUrl).hostname !== 'jobhackai.io' || !new URL(e.profileUrl).pathname.startsWith('/directory/'))) throw new Error('A Local provider needs its real published profile URL.');
  const businessKey = new URL(e.sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
  const message = { recipient, subject: m.subject, text: m.text.replace(/\r\n/g, '\n'), html: html.replace(/\r\n/g, '\n'), threadId, inReplyTo, references };
  return { id: input.id, lane: input.lane, phase: input.phase, businessKey, message,
    evidence: { sourceUrl: e.sourceUrl, checkedAt: e.checkedAt, checkedBy: e.checkedBy, publishedEmail: recipient, mailtoEmail: e.mailtoEmail || '', fit: 'current', fitFact: e.fitFact, profileUrl: e.profileUrl || '' } };
}
export function messageRevision(packet) {
  return digest({ lane: packet.lane, phase: packet.phase, businessKey: packet.businessKey, message: packet.message });
}
export function fiveBusinessDaysElapsed(sentAt, now) {
  const start = Date.parse(sentAt);
  if (!Number.isFinite(start) || start > now) return false;
  // Conservative full weekdays, using Eastern calendar dates across DST.
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const [y, m, d] = day(start).split('-').map(Number);
  let cursor = Date.UTC(y, m - 1, d, 12), count = 0;
  while (count < 5) { cursor += 86400000; if (![0, 6].includes(new Date(cursor).getUTCDay())) count++; }
  // Start the following calendar day; never treat a partial fifth day as complete.
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(now));
  return !['Sat', 'Sun'].includes(weekday) && day(now) > new Date(cursor).toISOString().slice(0, 10);
}
export function historyIssues(packet, history, now = Date.now()) {
  if (!history || history.complete !== true || !fresh(history.checkedAt, now) || history.scope !== 'all-folders-all-history') return ['Gmail history check is missing, incomplete or stale.'];
  const issues = [];
  if (!Array.isArray(history.sent) || !Array.isArray(history.received) || !Array.isArray(history.drafts) || !Array.isArray(history.failures)) return ['Invalid Gmail history evidence.'];
  if (history.drafts.length) issues.push('Another Gmail draft already targets this recipient.');
  if (history.received.length) issues.push('A received message requires individual conversation review; cold follow-ups stop.');
  if (history.failures.length) issues.push('Delivery failure or suppression evidence requires review.');
  if (packet.phase === 'intro' && history.sent.length) issues.push('This business or recipient has already been contacted.');
  if (packet.phase === 'followup') {
    if (history.sent.length !== 1) issues.push('Exactly one verified original send is required; no repeated follow-up.');
    else {
      const original = history.sent[0];
      if (original.threadId !== packet.message.threadId || original.rfcMessageId !== packet.message.inReplyTo || !fiveBusinessDaysElapsed(original.sentAt, now)) issues.push('Original thread, Message-ID or five-business-day wait is not verified.');
    }
  }
  return issues;
}

async function dnsQuestion(name, type, fetcher) {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name); url.searchParams.set('type', type);
  // Workers rejects redirect:'error' before making a request. Manual mode keeps
  // DNS pinned to this resolver; response.ok below rejects every redirect.
  const response = await fetcher(url.href, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000), redirect: 'manual' });
  if (!response.ok) throw new Error('DNS unavailable');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 32768) { await reader.cancel(); throw new Error('DNS response too large'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (![0, 3].includes(data.Status) || data.TC || !Array.isArray(data.Answer || [])) throw new Error('DNS response incomplete');
  return data;
}
export async function routingCheck(domain, { fetcher = fetch, now = new Date() } = {}) {
  const result = { domain, checkedAt: now.toISOString(), mailboxVerified: false, inboxVerified: false, mx: [] };
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) return { ...result, status: 'invalid_domain' };
  try {
    const answer = await dnsQuestion(domain, 'MX', fetcher);
    if (answer.Status === 3) return { ...result, status: 'nxdomain' };
    const mx = (answer.Answer || []).filter(a => a.type === 15).map(a => /^(\d+)\s+(\S+)$/.exec(a.data));
    if (mx.some(a => !a) || mx.length > 10) return { ...result, status: 'dns_ambiguous' };
    result.mx = mx.map(a => ({ preference: Number(a[1]), host: a[2].toLowerCase() }));
    if (result.mx.some(a => a.host === '.')) return { ...result, status: 'null_mx' };
    if (!mx.length) return { ...result, status: 'no_mx_review' };
    const targets = await Promise.all(result.mx.map(async record => {
      const host = record.host.replace(/\.$/, '');
      if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) return { host, resolved: false };
      const answers = await Promise.allSettled(['A', 'AAAA'].map(type => dnsQuestion(host, type, fetcher)));
      return { host, resolved: answers.some(a => a.status === 'fulfilled' && a.value.Status === 0 && (a.value.Answer || []).some(r => (r.type === 1 && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(r.data)) || (r.type === 28 && /^[0-9a-f:]+$/i.test(r.data)))) };
    }));
    return { ...result, targets, status: targets.some(t => t.resolved) ? 'routing_present_mailbox_unknown' : 'mx_target_unresolved' };
  } catch { return { ...result, status: 'dns_unavailable' }; }
}
