// No HTTP trigger, production binding, payload logging or generated browser IDs.
// D1 is the durable outbox. A timeout after collection is uncertain, not retryable.
const DAY = 86400000;
const MAX_AGE = 72 * 3600; // Measurement Protocol timestamp limit, seconds.
const LEASE = 120000;
type Row = {
  event_key: string; event_name: 'purchase' | 'refund'; event_at: number;
  charge_id: string; refund_id: string | null; checkout_session_id: string;
  attempts: number; state: string; amount_captured: number; currency: string;
  captured_minor: number | null; value_minor: number | null; tax_minor: number | null;
  item_id: string | null; refund_amount: number | null; refund_status: string | null;
  ga_client_id: string | null; ga_session_id: string | null;
  first_touch_json: string | null; last_touch_json: string | null;
};
type Payload = {client_id: string; timestamp_micros: number; events: {name: string; params: Record<string, unknown>}[]};
type State = 'pending' | 'accepted_unverified' | 'rejected' | 'uncertain' | 'expired' | 'ineligible';
type Requester = (url: string, init: RequestInit) => Promise<Response>;

const consent = `EXISTS (SELECT 1 FROM cookie_consents c WHERE c.user_id=a.user_id AND
  CASE WHEN json_valid(c.consent_json) THEN json_extract(c.consent_json,'$.version')=1 AND json_type(c.consent_json,'$.analytics')='true' ELSE 0 END)
  AND NOT EXISTS (SELECT 1 FROM cookie_consents c WHERE c.client_id=a.client_id AND
  CASE WHEN json_valid(c.consent_json) THEN COALESCE(json_extract(c.consent_json,'$.version')=1 AND json_type(c.consent_json,'$.analytics')='true',0)=0 ELSE 1 END)`;

export async function retain(db: D1Database, now: number) {
  // Expired consent context and its joins/outbox are erased; financial rows stay.
  await db.batch([
    db.prepare('DELETE FROM checkout_attributions WHERE expires_at<=?').bind(now),
    ...['first_touch_json','last_touch_json'].map(field => db.prepare(`UPDATE checkout_attributions SET ${field}=NULL
      WHERE ${field} IS NOT NULL AND CASE WHEN json_valid(${field}) THEN
      COALESCE(json_type(${field},'$.at')='integer' AND json_extract(${field},'$.at')>=?,0)=0 ELSE 1 END`).bind(now-90*DAY))
  ]);
}

export async function enqueue(db: D1Database, environment: string, now: number) {
  const earliest=Math.floor(now/1000)-MAX_AGE;
  await db.batch([
    db.prepare(`INSERT INTO analytics_delivery(event_key,charge_id,checkout_session_id,event_name,event_at,created_at,updated_at)
      SELECT 'purchase:'||p.charge_id,p.charge_id,a.checkout_session_id,'purchase',p.charge_created_at,?1,?1
      FROM stripe_collected_payments p JOIN stripe_payment_attributions l ON l.charge_id=p.charge_id
      JOIN checkout_attributions a ON a.checkout_session_id=l.checkout_session_id
      WHERE p.environment=?2 AND a.environment=?2 AND p.livemode=0 AND p.charge_created_at>=?3
        AND a.expires_at>?1 AND ${consent}
      ON CONFLICT(event_key) DO NOTHING`).bind(now,environment,earliest),
    db.prepare(`INSERT INTO analytics_delivery(event_key,charge_id,checkout_session_id,refund_id,event_name,event_at,created_at,updated_at)
      SELECT 'refund:'||r.refund_id,p.charge_id,a.checkout_session_id,r.refund_id,'refund',r.refund_created_at,?1,?1
      FROM stripe_payment_refunds r JOIN stripe_collected_payments p ON p.charge_id=r.charge_id
      JOIN stripe_payment_attributions l ON l.charge_id=p.charge_id
      JOIN checkout_attributions a ON a.checkout_session_id=l.checkout_session_id
      WHERE p.environment=?2 AND a.environment=?2 AND p.livemode=0 AND r.status='succeeded'
        AND r.refund_created_at>=?3 AND a.expires_at>?1 AND ${consent}
      ON CONFLICT(event_key) DO NOTHING`).bind(now,environment,earliest),
    // A partial capture can become a fully allocated payment after the first
    // scan. This row has never reached collection; restore only this safe case.
    db.prepare(`UPDATE analytics_delivery SET state='pending',last_reason='financial_breakdown_ready',next_attempt_at=?1,updated_at=?1
      WHERE state='ineligible' AND last_reason='financial_breakdown_missing' AND EXISTS (
        SELECT 1 FROM stripe_collected_payments p JOIN stripe_payment_analytics_values m ON m.charge_id=p.charge_id
        WHERE p.charge_id=analytics_delivery.charge_id AND p.environment=?2 AND p.livemode=0
          AND p.currency='usd' AND m.currency=p.currency AND m.captured_minor=p.amount_captured
          AND m.value_minor>=0 AND m.tax_minor>=0 AND m.value_minor+m.tax_minor=p.amount_captured
          AND m.item_id IN ('jobhackai_subscription','jobhackai_one_time'))`).bind(now,environment),
    db.prepare(`UPDATE analytics_delivery SET state='pending',lease_until=NULL,last_reason='validation_lease_expired',updated_at=?
      WHERE state='validating' AND lease_until<=?`).bind(now,now),
    db.prepare(`UPDATE analytics_delivery SET state='uncertain',lease_until=NULL,last_reason='collection_lease_expired',updated_at=?
      WHERE state='sending' AND lease_until<=?`).bind(now,now),
    db.prepare(`UPDATE analytics_delivery SET state='uncertain',last_reason='refund_reversed_after_delivery',updated_at=?
      WHERE state='accepted_unverified' AND event_name='refund' AND EXISTS
        (SELECT 1 FROM stripe_payment_refunds r WHERE r.refund_id=analytics_delivery.refund_id AND r.status IN ('failed','canceled'))`).bind(now),
    db.prepare(`UPDATE analytics_delivery SET state='expired',last_reason='event_too_old',updated_at=?
      WHERE state='pending' AND event_at<?`).bind(now,earliest)
  ]);
}

async function eligible(db: D1Database, key: string, env: Env, now: number) {
  return db.prepare(`SELECT d.*,p.amount_captured,p.currency,m.captured_minor,m.value_minor,m.tax_minor,m.item_id,
      r.amount refund_amount,r.status refund_status,a.ga_client_id,a.ga_session_id,a.first_touch_json,a.last_touch_json
    FROM analytics_delivery d JOIN stripe_collected_payments p ON p.charge_id=d.charge_id
    JOIN stripe_payment_attributions l ON l.charge_id=p.charge_id AND l.checkout_session_id=d.checkout_session_id
    JOIN checkout_attributions a ON a.checkout_session_id=d.checkout_session_id
    LEFT JOIN stripe_payment_analytics_values m ON m.charge_id=p.charge_id
    LEFT JOIN stripe_payment_refunds r ON r.refund_id=d.refund_id AND r.charge_id=d.charge_id
    WHERE d.event_key=?1 AND p.environment=?2 AND a.environment=?2 AND p.livemode=0
      AND a.expires_at>?3 AND ${consent}`).bind(key,env.ENVIRONMENT,now).first<Row>();
}

function touchParams(json: string | null, prefix: string, now: number) {
  const params: Record<string,string>={};
  try {
    const t=JSON.parse(json||'null');
    if (!t || !Number.isSafeInteger(t.at) || t.at<now-90*DAY || t.at>now) return params;
    for (const field of ['source','medium','campaign','asset','id']) {
      if (typeof t[field]==='string' && /^[a-z0-9_.-]{1,100}$/i.test(t[field])) params[`jha_${prefix}_${field}`]=t[field];
    }
  } catch { /* Malformed marketing context is omitted. */ }
  return params;
}

export function payload(row: Row, now: number, debug: boolean): Payload | string {
  if (!Number.isSafeInteger(row.event_at) || row.event_at<Math.floor(now/1000)-MAX_AGE || row.event_at>Math.floor(now/1000)) return 'event_timestamp_invalid';
  if (!/^\d{1,20}\.\d{1,20}$/.test(row.ga_client_id||'')) return 'browser_client_id_missing';
  if (row.currency!=='usd') return 'currency_not_supported';
  if (row.captured_minor!==row.amount_captured || !Number.isSafeInteger(row.value_minor) || !Number.isSafeInteger(row.tax_minor)
      || row.value_minor!<0 || row.tax_minor!<0 || (row.value_minor! + row.tax_minor!) !== row.amount_captured
      || !['jobhackai_subscription','jobhackai_one_time'].includes(row.item_id||'')) return 'financial_breakdown_missing';
  let value=row.value_minor!, tax=row.tax_minor!;
  if (row.event_name==='refund') {
    if (row.refund_status!=='succeeded' || !Number.isSafeInteger(row.refund_amount) || row.refund_amount!<=0 || row.refund_amount!>row.amount_captured) return 'refund_not_succeeded';
    if (tax>0 && row.refund_amount!==row.amount_captured) return 'partial_refund_tax_allocation_unknown';
    if (tax===0) value=row.refund_amount!;
  }
  const params: Record<string,unknown>={
    transaction_id: row.charge_id, currency: 'USD', value: value/100, tax: tax/100,
    // Custom dimensions identify the stored checkout campaign; no claim that
    // Google will assign a later renewal to the old browser session/channel.
    ...touchParams(row.first_touch_json,'first',now),...touchParams(row.last_touch_json,'last',now)
  };
  if (row.event_name==='purchase') params.items=[{item_id:row.item_id,
    item_name:row.item_id==='jobhackai_subscription'?'JobHackAI subscription':'JobHackAI one-time purchase',quantity:1,price:value/100}];
  // Refund items are optional. Do not invent item quantities for partial money refunds.
  if (row.refund_id) params.jha_refund_id=row.refund_id;
  const session=Number(row.ga_session_id);
  if (row.event_name==='purchase' && /^\d{1,12}$/.test(row.ga_session_id||'') && Number.isSafeInteger(session)
    && session<=row.event_at && now/1000-session<24*3600) params.session_id=session;
  if (debug) params.debug_mode=true;
  return {client_id:row.ga_client_id!,timestamp_micros:row.event_at*1000000,events:[{name:row.event_name,params}]};
}

async function finish(db: D1Database,key: string,lease: number,state: State,reason: string,now: number,status: number|null=null) {
  await db.prepare(`UPDATE analytics_delivery SET state=?,last_reason=?,http_status=?,updated_at=?,lease_until=NULL,
    next_attempt_at=?,accepted_at=CASE WHEN ?='accepted_unverified' THEN ? ELSE accepted_at END
    WHERE event_key=? AND lease_until=? AND state IN ('validating','sending')`)
    .bind(state,reason,status,now,now+5*60000,state,now,key,lease).run();
}

async function validateResponse(response: Response): Promise<boolean> {
  if (!response.ok || !response.body) return false;
  // Bound the diagnostics response; never log Google's echoed payload/errors.
  const reader=response.body.getReader(); let size=0; const chunks: Uint8Array[]=[];
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength; if(size>65536) return false; chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const body=JSON.parse(new TextDecoder().decode(bytes)); return Array.isArray(body.validationMessages) && body.validationMessages.length===0;}
  catch {return false;}
}

export async function deliver(env: Env, options: {now?:()=>number; request?:Requester}={}) {
  const clock=options.now||Date.now, request=options.request||fetch;
  // Production is deliberately unsupported until its held release is reviewed.
  if (!['dev','qa'].includes(env.ENVIRONMENT)) throw new Error('analytics_environment_not_supported');
  const db=env.DB; await retain(db,clock());
  if (env.DELIVERY_ENABLED!=='true') return {enabled:false,processed:0};
  if (env.ENVIRONMENT!=='qa' || env.GA4_MEASUREMENT_ID!=='G-VH888WWY3M' || !env.GA4_API_SECRET) throw new Error('analytics_destination_not_ready');
  await enqueue(db,env.ENVIRONMENT,clock());
  const pending=await db.prepare(`SELECT event_key FROM analytics_delivery WHERE state='pending' AND next_attempt_at<=?
    ORDER BY CASE WHEN event_name='purchase' THEN 0 ELSE 1 END,event_at LIMIT 5`).bind(clock()).all<{event_key:string}>();
  let processed=0;
  for(const {event_key:key} of pending.results) {
    const now=clock(), lease=now+LEASE;
    const claimed=await db.prepare(`UPDATE analytics_delivery SET state='validating',lease_until=?,attempts=attempts+1,updated_at=?
      WHERE event_key=? AND state='pending' AND next_attempt_at<=?`).bind(lease,now,key,now).run();
    if(!claimed.meta.changes) continue;
    processed++;
    const row=await eligible(db,key,env,clock());
    if(!row){await finish(db,key,lease,'ineligible','consent_or_payment_ineligible',clock());continue;}
    if(row.attempts>12){await finish(db,key,lease,'rejected','attempt_limit',clock());continue;}
    if(row.event_name==='refund') {
      const purchase=await db.prepare(`SELECT state FROM analytics_delivery WHERE event_key=?`).bind('purchase:'+row.charge_id).first<{state:string}>();
      if(purchase?.state!=='accepted_unverified'){await finish(db,key,lease,'pending','purchase_not_accepted',clock());continue;}
    }
    const data=payload(row,clock(),env.DEBUG_EVENTS==='true');
    if(typeof data==='string'){await finish(db,key,lease,'ineligible',data,clock());continue;}
    const query=new URLSearchParams({measurement_id:env.GA4_MEASUREMENT_ID,api_secret:env.GA4_API_SECRET});
    try {
      const checked=await request('https://www.google-analytics.com/debug/mp/collect?'+query,
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,validation_behavior:'ENFORCE_RECOMMENDATIONS'}),signal:AbortSignal.timeout(8000)});
      if(!await validateResponse(checked)){await finish(db,key,lease,'pending','validation_not_confirmed',clock(),checked.status);continue;}
    } catch {await finish(db,key,lease,'pending','validation_network_failure',clock());continue;}
    // Consent, money, refunds and context may have changed during validation.
    const fresh=await eligible(db,key,env,clock());
    const freshData=fresh?payload(fresh,clock(),env.DEBUG_EVENTS==='true'):null;
    if(!freshData || typeof freshData==='string' || JSON.stringify(freshData)!==JSON.stringify(data)) {
      await finish(db,key,lease,'ineligible','context_changed_during_validation',clock());continue;
    }
    const sending=await db.prepare(`UPDATE analytics_delivery SET state='sending',updated_at=?
      WHERE event_key=? AND state='validating' AND lease_until=? AND lease_until>?`).bind(clock(),key,lease,clock()).run();
    if(!sending.meta.changes) continue;
    try {
      const sent=await request('https://www.google-analytics.com/mp/collect?'+query,
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(8000)});
      await sent.body?.cancel();
      await finish(db,key,lease,sent.ok?'accepted_unverified':sent.status>=400&&sent.status<500?'rejected':'uncertain',
        sent.ok?'http_accepted_receipt_unverified':'collection_http_error',clock(),sent.status);
    } catch {await finish(db,key,lease,'uncertain','collection_network_outcome_unknown',clock());}
  }
  const states=await db.prepare('SELECT state,COUNT(*) count FROM analytics_delivery GROUP BY state').all<{state:string;count:number}>();
  return {enabled:true,processed,states:states.results};
}

export default {
  fetch(){return new Response('Not found',{status:404});},
  scheduled(_controller,env,ctx){
    ctx.waitUntil(deliver(env).then(result=>console.log(JSON.stringify({event:'analytics_delivery_run',...result})))
      .catch(()=>{console.error(JSON.stringify({event:'analytics_delivery_run_failed'}));throw new Error('analytics_delivery_run_failed');}));
  }
} satisfies ExportedHandler<Env>;
