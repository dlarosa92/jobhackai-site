import { normalizePacket, messageRevision, routingCheck, historyIssues, fresh, normalizeEmail, OWNER } from './outreach-policy.js';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const parse = value => value ? JSON.parse(value) : null;
const iso = now => new Date(now).toISOString();
const terminal = state => ['sending', 'sent', 'uncertain'].includes(state);
export const isLegacyEmail = item => /email|outreach|\bstan\b/i.test(item.channel || '') && item.impact === 'campaign';

async function event(db, id, revision, kind, evidence, now) {
  return db.prepare('INSERT INTO outreach_events(event_id,message_id,revision,kind,evidence,recorded_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), id, revision, kind, JSON.stringify(evidence), iso(now));
}
async function row(db, id) { return db.prepare('SELECT * FROM outreach_messages WHERE id=?').bind(id).first(); }

export async function registerMessage(db, input, now = Date.now()) {
  const packet = normalizePacket(input, now);
  const revision = await messageRevision(packet);
  const previous = await row(db, packet.id);
  if (previous && previous.state !== 'review') throw new Error('A queued, attempted or sent message cannot be replaced.');
  const results = await db.batch([
    db.prepare(`INSERT INTO outreach_versions(message_id,revision,packet,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).bind(packet.id, revision, JSON.stringify(packet), iso(now)),
    db.prepare(`INSERT INTO outreach_messages(id,business_key,recipient,revision,packet,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET business_key=excluded.business_key,recipient=excluded.recipient,revision=excluded.revision,packet=excluded.packet,
      approved_revision=CASE WHEN outreach_messages.revision=excluded.revision THEN outreach_messages.approved_revision ELSE NULL END,
      approved_at=CASE WHEN outreach_messages.revision=excluded.revision THEN outreach_messages.approved_at ELSE NULL END,
      history=NULL,history_at=NULL,routing=NULL,routing_at=NULL,updated_at=excluded.updated_at
      WHERE outreach_messages.state='review'`).bind(packet.id, packet.businessKey, packet.message.recipient, revision, JSON.stringify(packet), iso(now)),
    await event(db, packet.id, revision, 'prepared', { sourceUrl: packet.evidence.sourceUrl }, now),
  ]);
  if (results[1].meta.changes !== 1) throw new Error('Message was queued during editing. Refresh before continuing.');
  return { id: packet.id, revision };
}

export async function gateIssues(db, record, now = Date.now(), snapshot = null) {
  const packet = parse(record.packet);
  const issues = historyIssues(packet, parse(record.history), now);
  if (!fresh(packet.evidence.checkedAt, now, 86400000)) issues.push('Refresh first-party contact and business-fit evidence before release.');
  const routing = parse(record.routing);
  if (!routing || !fresh(routing.checkedAt, now) || routing.status !== 'routing_present_mailbox_unknown') issues.push(`Mail routing is not cleared: ${routing?.status || 'not checked'}.`);
  const block = snapshot ? snapshot.blocks.get(record.recipient) : await db.prepare('SELECT reason,evidence_id FROM outreach_blocks WHERE recipient=?').bind(record.recipient).first();
  if (block) issues.push(`Suppressed or held: ${block.reason} (${block.evidence_id}).`);
  const originalId = parse(record.history)?.sent?.[0]?.messageId || '';
  const duplicate = snapshot ? snapshot.rows.find(other => other.id !== record.id && (other.business_key === record.business_key || other.recipient === record.recipient) && !(packet.phase === 'followup' && other.state === 'sent' && other.phase === 'intro' && other.sent_thread_id === packet.message.threadId && other.sent_message_id === originalId)) : await db.prepare(`SELECT id FROM outreach_messages WHERE id<>? AND (business_key=? OR recipient=?) AND state IN ('queued','sending','sent','uncertain')
    AND NOT (?='followup' AND state='sent' AND sent_thread_id=? AND sent_message_id=? AND json_extract(packet,'$.phase')='intro') LIMIT 1`).bind(record.id, record.business_key, record.recipient, packet.phase, packet.message.threadId, originalId).first();
  if (duplicate) issues.push(`This business already has an active or sent message (${duplicate.id}).`);
  return issues;
}

export async function outreachRecords(db, now = Date.now()) {
  const rows = (await db.prepare('SELECT * FROM outreach_messages ORDER BY updated_at DESC,id LIMIT 500').all()).results;
  const relay = await db.prepare('SELECT checked_at,can_send FROM outreach_relay_state WHERE id=1').first();
  const blocks = new Map((await db.prepare('SELECT recipient,reason,evidence_id FROM outreach_blocks').all()).results.map(block => [block.recipient, block]));
  const active = (await db.prepare("SELECT id,business_key,recipient,state,sent_thread_id,sent_message_id,json_extract(packet,'$.phase') AS phase FROM outreach_messages WHERE state IN ('queued','sending','sent','uncertain')").all()).results;
  const senderAvailable = !!relay && relay.can_send === 1 && fresh(relay.checked_at, now, 10 * 60000);
  const items = [];
  for (const record of rows) {
    const packet = parse(record.packet);
    const block = blocks.get(record.recipient);
    const issues = terminal(record.state) ? (block ? [`${block.reason} (${block.evidence_id})`] : []) : await gateIssues(db, record, now, { blocks, rows: active });
    const approved = record.approved_revision === record.revision;
    const replied = record.state === 'sent' && block?.reason === 'received_reply_review';
    const state = replied ? 'pending' : issues.length ? 'hold' : record.state === 'sent' ? 'sent' : ['sending', 'uncertain'].includes(record.state) ? 'hold' : record.state === 'queued' ? 'approved' : approved ? 'approved' : 'pending';
    items.push({ id: `outreach-${record.id}`, source: 'outreach', outreachId: record.id, channel: 'Stan · Email', impact: replied ? 'prospect' : 'campaign',
      title: packet.message.subject, detail: packet.message.recipient, reviewUrl: packet.evidence.sourceUrl,
      state, updatedAt: record.updated_at, revision: record.revision, message: packet.message, sourceEvidence: packet.evidence,
      issues, approved, deliveryState: record.state, senderAvailable, sentThreadId: record.sent_thread_id,
      evidence: block ? `${block.reason} · native evidence ${block.evidence_id}. Sent history is retained; further outreach is held.` : record.state === 'sent' ? `Sent verified · message ${record.sent_message_id}; inbox delivery is unverified.` : record.state === 'uncertain' ? 'Send result uncertain. Reconcile Gmail before any further action; automatic retry is disabled.' : record.state === 'sending' ? 'One send attempt is reserved. A missing receipt requires reconciliation; do not retry.' : issues.join(' ') || 'Source, routing and all-folder Gmail checks are current. Mailbox existence remains unverified.',
      nextAction: replied ? 'Review and answer the received message individually in Gmail.' : record.state === 'sent' ? 'Await the recipient; do not repeat this send.' : issues.length ? 'Resolve the listed hold before release.' : approved ? 'Send this exact approved email when ready.' : 'Review the complete recipient, copy and links before approving.' });
  }
  return { items, senderAvailable };
}

export async function recordHistory(env, input, now = Date.now(), fetcher = fetch) {
  const db = env.DASHBOARD_DB;
  const record = await row(db, input.id);
  if (!record || record.revision !== input.revision || !['review','queued','sent'].includes(record.state)) throw new Error('Message changed or is not awaiting checks.');
  const history = input.history;
  if (!history || !Array.isArray(history.sent) || !Array.isArray(history.received) || !Array.isArray(history.drafts) || !Array.isArray(history.failures) || [history.sent,history.received,history.drafts,history.failures].some(a=>a.length>200) || !fresh(history.checkedAt, now)) throw new Error('Invalid or stale Gmail evidence.');
  const ids = [...history.sent, ...history.received, ...history.drafts, ...history.failures];
  if (ids.some(v => !/^[a-f0-9]{1,64}$/.test(v.messageId || ''))) throw new Error('Native Gmail evidence IDs are required.');
  const routing = await routingCheck(record.recipient.split('@')[1], { fetcher, now: new Date(now) });
  const statements = [];
  const failure = history.failures[0];
  const reply = history.received[0];
  if (failure || reply) {
    const reason = failure ? (failure.kind === 'hard_bounce' ? 'hard_bounce' : 'delivery_failure_review') : 'received_reply_review';
    statements.push(db.prepare(`INSERT INTO outreach_blocks(recipient,reason,evidence_id,recorded_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).bind(record.recipient, reason, (failure || reply).messageId, iso(now)));
  }
  statements.push(db.prepare(`UPDATE outreach_messages SET history=?,history_at=?,routing=?,routing_at=?,updated_at=? WHERE id=? AND revision=? AND state IN ('review','queued','sent') AND (history_at IS NULL OR history_at<=?)`)
    .bind(JSON.stringify(history), history.checkedAt, JSON.stringify(routing), routing.checkedAt, iso(now), record.id, record.revision,history.checkedAt));
  statements.push(await event(db, record.id, record.revision, 'checked', { routing: routing.status, gmailComplete: history.complete === true, failureIds: history.failures.map(v=>v.messageId), receivedIds: history.received.map(v=>v.messageId) }, now));
  await db.batch(statements);
  return { issues: await gateIssues(db, await row(db, record.id), now), routing };
}

async function approve(db, input, now) {
  const record = await row(db, input.id);
  if (!record || record.revision !== input.revision || record.state !== 'review') return json({ error: 'The exact message changed or is no longer awaiting review.' }, 409);
  const issues = await gateIssues(db, record, now);
  if (issues.length) return json({ error: issues.join(' ') }, 409);
  const result = await db.prepare(`UPDATE outreach_messages SET approved_revision=revision,approved_at=?,updated_at=? WHERE id=? AND revision=? AND state='review'`)
    .bind(iso(now), iso(now), record.id, input.revision).run();
  if (result.meta.changes !== 1) return json({ error: 'Message changed during review.' }, 409);
  await db.batch([await event(db, record.id, record.revision, 'owner_approved', { owner: OWNER }, now)]);
  return json({ ok: true });
}

async function queue(env, input, now) {
  if (env.OUTREACH_SENDER_ENABLED !== 'true') return json({ error: 'Guarded Gmail sending is not activated. No message was sent.' }, 409);
  const relay = await env.DASHBOARD_DB.prepare('SELECT checked_at,can_send FROM outreach_relay_state WHERE id=1').first();
  if (!relay || relay.can_send !== 1 || !fresh(relay.checked_at, now, 10*60000)) return json({ error: 'The guarded Gmail sender is unavailable or stale.' }, 409);
  const record = await row(env.DASHBOARD_DB, input.id);
  if (!record || record.revision !== input.revision || record.approved_revision !== input.revision || record.state !== 'review') return json({ error: 'Exact current approval is required; repeated execution is blocked.' }, 409);
  const issues = await gateIssues(env.DASHBOARD_DB, record, now);
  if (issues.length) return json({ error: issues.join(' ') }, 409);
  const packet=parse(record.packet), originalId=parse(record.history)?.sent?.[0]?.messageId||'';
  const result = await env.DASHBOARD_DB.prepare(`UPDATE outreach_messages SET state='queued',updated_at=? WHERE id=? AND revision=? AND approved_revision=? AND state='review'
    AND NOT EXISTS(SELECT 1 FROM outreach_blocks WHERE recipient=outreach_messages.recipient)
    AND NOT EXISTS(SELECT 1 FROM outreach_messages other WHERE other.id<>outreach_messages.id AND (other.business_key=outreach_messages.business_key OR other.recipient=outreach_messages.recipient) AND other.state IN ('queued','sending','sent','uncertain')
      AND NOT (?='followup' AND other.state='sent' AND other.sent_thread_id=? AND other.sent_message_id=? AND json_extract(other.packet,'$.phase')='intro'))`)
    .bind(iso(now),record.id,input.revision,input.revision,packet.phase,packet.message.threadId,originalId).run();
  return json({ ok: result.meta.changes === 1 }, result.meta.changes === 1 ? 200 : 409);
}

export async function ownerOutreach(request, env, now = Date.now()) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/api/outreach') return json(await outreachRecords(env.DASHBOARD_DB, now));
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Invalid request origin or type' }, 403);
  if (Number(request.headers.get('content-length')) > 100000) return json({ error: 'Packet too large' }, 413);
  // Same bounded reader as the signed ingestion route (also covers chunked requests).
  const reader=request.body?.getReader(); const chunks=[]; let size=0;
  if (!reader) return json({error:'JSON required'},400);
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();return json({error:'Packet too large'},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (path === '/api/outreach/prepare') return json(await registerMessage(env.DASHBOARD_DB,input,now));
    if (!input || !/^[a-z0-9-]{1,64}$/.test(input.id || '') || !/^[a-f0-9]{64}$/.test(input.revision || '')) return json({error:'Exact message ID and revision required'},400);
    if (path === '/api/outreach/approve') return approve(env.DASHBOARD_DB,input,now);
    if (path === '/api/outreach/send') return queue(env,input,now);
    if (path === '/api/outreach/cancel') {
      const result=await env.DASHBOARD_DB.prepare("UPDATE outreach_messages SET state='review',approved_revision=NULL,approved_at=NULL,updated_at=? WHERE id=? AND revision=? AND state='queued' AND attempt_id IS NULL").bind(iso(now),input.id,input.revision).run();
      if(result.meta.changes!==1)return json({error:'This email is already reserved or changed. Reconcile Gmail; cancellation cannot undo an attempt.'},409);
      await env.DASHBOARD_DB.batch([await event(env.DASHBOARD_DB,input.id,input.revision,'owner_cancelled',{},now)]);
      return json({ok:true});
    }
    return json({error:'Not found'},404);
  } catch(error) { return json({error:error.message},400); }
}

// Only called after the separate ingestion Worker has verified the shared HMAC.
export async function relayOutreach(env, input, now = Date.now(), fetcher = fetch) {
  const db=env.DASHBOARD_DB;
  if (input.mailbox !== env.MAILBOX_EMAIL || !['poll','check','claim','receipt','delivery'].includes(input.action)) return json({error:'Invalid relay request'},400);
  if(input.action==='delivery'){await recordDeliveryEvent(db,input,now);return json({ok:true});}
  if (input.action==='poll') {
    await db.prepare(`INSERT INTO outreach_relay_state(id,checked_at,can_send) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,can_send=excluded.can_send`).bind(iso(now),input.canSend===true?1:0).run();
    const rows=(await db.prepare(`SELECT * FROM outreach_messages WHERE state IN ('review','queued','sent') ORDER BY COALESCE(history_at,''),id LIMIT 20`).all()).results;
    const unresolved=(await db.prepare(`SELECT id,revision,attempt_id,recipient,packet FROM outreach_messages WHERE state IN ('sending','uncertain') ORDER BY updated_at LIMIT 20`).all()).results;
    return json({ messages:rows.map(r=>({id:r.id,revision:r.revision,packet:parse(r.packet),queued:r.state==='queued'})), reconcile:unresolved.map(r=>({...r,packet:parse(r.packet)})), sendingEnabled:env.OUTREACH_SENDER_ENABLED==='true' });
  }
  if (!/^[a-z0-9-]{1,64}$/.test(input.id||'') || !/^[a-f0-9]{64}$/.test(input.revision||'')) return json({error:'Invalid message identity'},400);
  if (input.action==='check') return json(await recordHistory(env,input,now,fetcher));
  const record=await row(db,input.id);
  if (!record || record.revision!==input.revision) return json({error:'Message changed'},409);
  if (input.action==='claim') {
    if(env.OUTREACH_SENDER_ENABLED!=='true' || record.approved_revision!==record.revision || record.state!=='queued') return json({error:'Not authorized for sending'},409);
    // Gmail evidence was produced immediately before this request; DNS is repeated
    // here, not reused from the approval-time result.
    if (!fresh(record.history_at,now,60000)) return json({error:'Immediate Gmail check required'},409);
    const routing=await routingCheck(record.recipient.split('@')[1],{fetcher,now:new Date(now)});
    const current={...record,routing:JSON.stringify(routing)};
    const issues=await gateIssues(db,current,now);
    if(issues.length)return json({error:issues.join(' ')},409);
    const attemptId=crypto.randomUUID();
    const packet=parse(record.packet), originalId=parse(record.history)?.sent?.[0]?.messageId||'';
    const reserved=await db.prepare(`UPDATE outreach_messages SET state='sending',attempt_id=?,routing=?,routing_at=?,updated_at=? WHERE id=? AND revision=? AND approved_revision=? AND state='queued'
      AND NOT EXISTS(SELECT 1 FROM outreach_blocks WHERE recipient=outreach_messages.recipient)
      AND NOT EXISTS(SELECT 1 FROM outreach_messages other WHERE other.id<>outreach_messages.id AND (other.business_key=outreach_messages.business_key OR other.recipient=outreach_messages.recipient) AND other.state IN ('queued','sending','sent','uncertain')
        AND NOT (?='followup' AND other.state='sent' AND other.sent_thread_id=? AND other.sent_message_id=? AND json_extract(other.packet,'$.phase')='intro'))`)
      .bind(attemptId,JSON.stringify(routing),routing.checkedAt,iso(now),record.id,record.revision,record.revision,packet.phase,packet.message.threadId,originalId).run();
    if(reserved.meta.changes!==1)return json({error:'Already claimed, blocked or changed'},409);
    return json({attemptId,expiresAt:iso(now+30000),packet:parse(record.packet)});
  }
  if(!['sending','uncertain'].includes(record.state) || record.attempt_id!==input.attemptId || (record.state==='uncertain' && input.outcome!=='sent'))return json({error:'Attempt is not current; no automatic retry'},409);
  const sent=input.outcome==='sent' && /^[a-f0-9]{1,64}$/.test(input.messageId||'') && /^[a-f0-9]{1,64}$/.test(input.threadId||'');
  const state=sent?'sent':'uncertain';
  await db.batch([
    db.prepare(`UPDATE outreach_messages SET state=?,sent_message_id=?,sent_thread_id=?,updated_at=? WHERE id=? AND revision=? AND state IN ('sending','uncertain') AND attempt_id=?`)
      .bind(state,sent?input.messageId:null,sent?input.threadId:null,iso(now),record.id,record.revision,input.attemptId),
    await event(db,record.id,record.revision,state,{attemptId:input.attemptId,messageId:sent?input.messageId:null},now),
  ]);
  return json({ok:true,state});
}

export async function recordDeliveryEvent(db, input, now=Date.now()) {
  const recipient=normalizeEmail(input.recipient);
  if(!recipient || !/^[a-f0-9]{1,64}$/.test(input.messageId||'') || !['hard_bounce','delivery_failure_review','received_reply_review'].includes(input.reason)) throw new Error('Invalid native delivery evidence');
  await db.prepare(`INSERT INTO outreach_blocks(recipient,reason,evidence_id,recorded_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`).bind(recipient,input.reason,input.messageId,iso(now)).run();
}
