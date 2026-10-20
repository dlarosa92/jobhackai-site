const MAX_BYTES = 256 * 1024;
const MAX_THREADS = 200;
const encoder = new TextEncoder();

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function boundedBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const isoDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const textField = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

function validSnapshot(input, env, now) {
  if (input?.schemaVersion !== 1 || input.mailbox !== env.MAILBOX_EMAIL || input.labelId !== env.TRACK_LABEL_ID) return false;
  if (!/^[a-f0-9-]{36}$/i.test(input.syncId || '') || !isoDate(input.startedAt) || !isoDate(input.completedAt)) return false;
  if (input.startedAt > input.completedAt || Date.parse(input.completedAt) > now + 300000 || now - Date.parse(input.completedAt) > 600000) return false;
  if (!Array.isArray(input.threads) || input.threads.length > MAX_THREADS) return false;
  const ids = new Set();
  for (const row of input.threads) {
    if (!/^[a-f0-9]{1,64}$/.test(row.threadId || '') || !/^[a-f0-9]{1,64}$/.test(row.lastMessageId || '') || ids.has(row.threadId)) return false;
    ids.add(row.threadId);
    if (!textField(row.sender, 320) || !textField(row.subject, 300) || !textField(row.preview, 320)) return false;
    if (!['needs_review', 'waiting'].includes(row.state) || !isoDate(row.lastMessageAt) || Date.parse(row.lastMessageAt) > Date.parse(input.completedAt) + 300000) return false;
    if (Object.keys(row).some(key => !['threadId', 'lastMessageId', 'sender', 'subject', 'preview', 'state', 'lastMessageAt'].includes(key))) return false;
  }
  return Object.keys(input).every(key => ['schemaVersion', 'syncId', 'mailbox', 'labelId', 'startedAt', 'completedAt', 'threads'].includes(key));
}

async function applySnapshot(db, input, now) {
  const statements = [db.prepare(`INSERT INTO gmail_sync_state (id, sync_id, mailbox, label_id, started_at, completed_at, received_at, thread_count)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    sync_id=excluded.sync_id, mailbox=excluded.mailbox, label_id=excluded.label_id, started_at=excluded.started_at,
    completed_at=excluded.completed_at, received_at=excluded.received_at, thread_count=excluded.thread_count
    WHERE excluded.started_at > gmail_sync_state.started_at`).bind(input.syncId, input.mailbox, input.labelId, input.startedAt, input.completedAt, now.toISOString(), input.threads.length)];
  for (let offset = 0; offset < input.threads.length; offset += 10) {
    const chunk = input.threads.slice(offset, offset + 10);
    const slots = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, 1, ?)').join(',');
    statements.push(db.prepare(`INSERT INTO gmail_threads (thread_id, last_message_id, sender, subject, preview, state, last_message_at, active, seen_sync_id)
      SELECT column1, column2, column3, column4, column5, column6, column7, column8, column9 FROM (VALUES ${slots})
      WHERE EXISTS (SELECT 1 FROM gmail_sync_state WHERE id=1 AND sync_id=?)
      ON CONFLICT(thread_id) DO UPDATE SET last_message_id=excluded.last_message_id, sender=excluded.sender, subject=excluded.subject,
      preview=excluded.preview, state=excluded.state, last_message_at=excluded.last_message_at, active=1, seen_sync_id=excluded.seen_sync_id`)
      .bind(...chunk.flatMap(row => [row.threadId, row.lastMessageId, row.sender, row.subject, row.preview, row.state, row.lastMessageAt, input.syncId]), input.syncId));
  }
  statements.push(db.prepare(`UPDATE gmail_threads SET active=0 WHERE active=1 AND seen_sync_id<>?
    AND EXISTS (SELECT 1 FROM gmail_sync_state WHERE id=1 AND sync_id=?)`).bind(input.syncId, input.syncId));
  await db.batch(statements);
  const current = await db.prepare('SELECT sync_id FROM gmail_sync_state WHERE id=1').first();
  return current?.sync_id === input.syncId;
}

async function receiveGmailSync(request, env, now = new Date()) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/sync') return reply({ error: 'Not found' }, 404);
  if (!env.SYNC_SECRET || env.SYNC_SECRET.length < 32 || !env.MAILBOX_EMAIL || !env.TRACK_LABEL_ID) return reply({ error: 'Sync is not configured' }, 503);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'JSON required' }, 415);
  const timestamp = request.headers.get('x-sync-timestamp') || '';
  const signature = request.headers.get('x-sync-signature') || '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return reply({ error: 'Unauthorized' }, 401);
  try {
    const body = await boundedBody(request);
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SYNC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/../g), byte => parseInt(byte, 16));
    if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${body}`))) return reply({ error: 'Unauthorized' }, 401);
    let input;
    try { input = JSON.parse(body); } catch { return reply({ error: 'Invalid snapshot' }, 400); }
    if (!validSnapshot(input, env, now.getTime())) return reply({ error: 'Invalid snapshot' }, 400);
    if (!await applySnapshot(env.DASHBOARD_DB, input, now)) return reply({ error: 'A newer snapshot already exists' }, 409);
    return reply({ ok: true, synced: input.threads.length });
  } catch (error) {
    if (error.message === 'too_large') return reply({ error: 'Snapshot too large' }, 413);
    console.error(JSON.stringify({ event: 'gmail_sync_failed', name: error.name || 'Error' }));
    return reply({ error: 'Sync unavailable; previous records preserved' }, 503);
  }
}

async function gmailRecords(db, now = new Date()) {
  const [sync, rows] = await Promise.all([
    db.prepare('SELECT mailbox, completed_at, received_at, thread_count FROM gmail_sync_state WHERE id=1').first(),
    db.prepare('SELECT thread_id, sender, subject, preview, state, last_message_at, impact FROM gmail_threads WHERE active=1 ORDER BY last_message_at DESC, thread_id').all(),
  ]);
  const items = rows.results.map(row => ({
    id: `gmail-${row.thread_id}`, source: 'gmail', channel: 'Gmail · tracked conversation', impact: row.impact,
    title: row.subject || '(No subject)', detail: `${row.sender}: ${row.preview}`,
    state: row.state === 'waiting' ? 'waiting' : 'pending', updatedAt: row.last_message_at,
    evidence: `Latest ${row.state === 'waiting' ? 'sent' : 'received'} message: ${row.last_message_at}`,
    nextAction: row.state === 'waiting' ? 'Waiting for their reply.' : 'Review the latest email and reply if needed.',
    reviewUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(sync?.mailbox || '')}#all/${row.thread_id}`,
  }));
  return { items, gmailSync: {
    status: !sync ? 'not_connected' : now.getTime() - Date.parse(sync.completed_at) > 15 * 60000 ? 'stale' : 'current',
    lastSuccessfulSyncAt: sync?.completed_at ?? null, trackedCount: sync?.thread_count ?? 0,
  } };
}

async function signedJson(request, env, now = new Date()) {
  if (!env.SYNC_SECRET || env.SYNC_SECRET.length < 32 || !env.MAILBOX_EMAIL) throw new Error('Relay not configured');
  const timestamp=request.headers.get('x-sync-timestamp')||'';
  const signature=request.headers.get('x-sync-signature')||'';
  if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json'||!/^\d{10}$/.test(timestamp)||Math.abs(now.getTime()/1000-Number(timestamp))>300||!/^[a-f0-9]{64}$/.test(signature))throw new Error('Unauthorized');
  const body=await boundedBody(request);
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.SYNC_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),byte=>parseInt(byte,16));
  if(!await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(`${timestamp}.${body}`)))throw new Error('Unauthorized');
  return JSON.parse(body);
}

export { receiveGmailSync, gmailRecords, signedJson };
