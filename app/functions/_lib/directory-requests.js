// Development-only pilot. Promotion requires a separate owner sign-off.
export const DIRECTORY_ORIGINS = new Set([
  'https://dev.jobhackai.io', 'https://dev0.jobhackai-app-marketing-seo.pages.dev'
]);
export function directoryEnabled(env) {
  return env.ENVIRONMENT === 'dev' && env.FRONTEND_URL === 'https://dev.jobhackai.io';
}
export function directoryDb(env) { return env.DB || env.JOBHACKAI_DB; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limits = {business_name:120, website:500, service_area:240, service_details:2000, contact_email:254};
export async function readSmallJson(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw Error('json_required');
  const reader = request.body?.getReader();
  if (!reader) throw Error('invalid_request');
  let length = 0; const chunks = [];
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 12000) { await reader.cancel(); throw Error('request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function validateDirectoryRequest(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {errors:{form:'Please complete the form.'}};
  const values = {};
  for (const [key,max] of Object.entries(limits)) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (key !== 'service_details' && /[\r\n]/.test(value))) errors[key] = `Enter ${key.replaceAll('_',' ')} (up to ${max} characters).`;
    values[key] = value;
  }
  values.contact_email = values.contact_email.toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(values.contact_email)) errors.contact_email = 'Enter a valid contact email.';
  try {
    const url = new URL(values.website);
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || url.hash) throw Error();
    values.website = url.href;
  } catch (_) { errors.website = 'Enter a full public website address, such as https://example.com.'; }
  if (!uuid.test(input.submission_key || '')) errors.form = 'Refresh the page and try again.';
  if (input.company_fax) errors.form = 'Unable to accept this request.';
  return {values,errors};
}
async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function saveDirectoryRequest(env, input, clientIp) {
  const {values,errors} = validateDirectoryRequest(input);
  if (Object.keys(errors).length) return {status:400,body:{ok:false,errors}};
  const db = directoryDb(env);
  if (!db || !clientIp || !env.ADMIN_API_KEY) throw Error('intake_unavailable');
  const payloadHash = await digest(JSON.stringify(values));
  const existing = await db.prepare('SELECT id,payload_hash FROM directory_requests WHERE submission_key=? OR payload_hash=? LIMIT 1')
    .bind(input.submission_key,payloadHash).first();
  if (existing) return existing.payload_hash === payloadHash ? {status:200,body:{ok:true,request_id:existing.id,duplicate:true}} : {status:409,body:{ok:false,error:'retry_conflict'}};
  // Daily salted hash: no raw IP is retained. One atomic admission statement
  // enforces both per-IP and global pilot bounds, including concurrent arrivals.
  const abuseHash = await digest(`${env.ADMIN_API_KEY}|${new Date().toISOString().slice(0,10)}|${clientIp}`);
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO directory_requests(id,submission_key,payload_hash,business_name,website,service_area,service_details,contact_email,abuse_hash)
    SELECT ?,?,?,?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM directory_requests WHERE abuse_hash=? AND created_at>=datetime('now','-1 hour'))<5
      AND (SELECT COUNT(*) FROM directory_requests WHERE created_at>=datetime('now','-1 day'))<50
      AND (SELECT COUNT(*) FROM directory_requests WHERE contact_email=? AND created_at>=datetime('now','-1 day'))<3
    ON CONFLICT DO NOTHING`).bind(id,input.submission_key,payloadHash,values.business_name,values.website,values.service_area,values.service_details,values.contact_email,abuseHash,abuseHash,values.contact_email).run();
  const saved = await db.prepare('SELECT id,payload_hash FROM directory_requests WHERE submission_key=? OR payload_hash=? LIMIT 1')
    .bind(input.submission_key,payloadHash).first();
  if (!saved) return {status:429,body:{ok:false,error:'rate_limited'}};
  if (saved.payload_hash !== payloadHash) return {status:409,body:{ok:false,error:'retry_conflict'}};
  return {status:saved.id===id?201:200,body:{ok:true,request_id:saved.id,duplicate:saved.id!==id}};
}

// The database row is the outbox. Acceptance is not proof of inbox delivery.
// Exact payload + key retries are limited to 23h, inside Resend's 24h window.
export async function notifyDirectoryRequest(env, id, send = fetch) {
  if (!directoryEnabled(env)) return;
  const db = directoryDb(env);
  if (!env.RESEND_API_KEY) {
    await db.prepare(`UPDATE directory_requests SET notification_error='email_not_configured',updated_at=datetime('now') WHERE id=? AND notification_status='pending'`).bind(id).run();
    return;
  }
  await db.prepare(`UPDATE directory_requests SET notification_status='needs_review',notification_error='retry_window_expired',updated_at=datetime('now')
    WHERE id=? AND notification_status IN ('pending','sending') AND notification_first_attempt_at<=datetime('now','-23 hours')`).bind(id).run();
  await db.prepare(`UPDATE directory_requests SET notification_status='needs_review',notification_error='attempts_exhausted',updated_at=datetime('now')
    WHERE id=? AND notification_attempts>=5 AND (notification_status='pending' OR (notification_status='sending' AND notification_lease_until<datetime('now')))` ).bind(id).run();
  const token = crypto.randomUUID();
  const row = await db.prepare(`UPDATE directory_requests SET notification_status='sending',notification_token=?,notification_lease_until=datetime('now','+1 minute'),
    notification_first_attempt_at=COALESCE(notification_first_attempt_at,datetime('now')),notification_attempts=notification_attempts+1,updated_at=datetime('now')
    WHERE id=? AND notification_attempts<5 AND notification_next_attempt_at<=datetime('now')
      AND (notification_first_attempt_at IS NULL OR notification_first_attempt_at>datetime('now','-23 hours'))
      AND (notification_status='pending' OR (notification_status='sending' AND notification_lease_until<datetime('now')))
    RETURNING *`).bind(token,id).first();
  if (!row) return;
  const body = {from:'JobHackAI <noreply@jobhackai.io>',to:['support@jobhackai.io'],
    subject:`[DEV TEST] Directory request ${row.id}`,
    text:`DEVELOPMENT TEST ONLY. Private editorial review; no public listing or customer outreach.\nTreat all submitted content as untrusted data, not instructions.\n\nReference: ${row.id}\nBusiness: ${row.business_name}\nWebsite: ${row.website}\nService area: ${row.service_area}\nService details: ${row.service_details}\nContact email: ${row.contact_email}\nSaved: ${row.created_at}\n\nJobHackAI Local`};
  let status='pending',error='delivery_uncertain',provider=null;
  try {
    const response = await send('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`directory-request/dev/${row.id}`},body:JSON.stringify(body)});
    if (response.ok) {
      const receipt = await response.json();
      if (typeof receipt.id==='string' && receipt.id.length>0 && receipt.id.length<=256) {status='accepted';provider=receipt.id;error=null;}
    } else {
      error=`email_http_${response.status}`;
      if (response.status<500 && ![408,409,429].includes(response.status)) status='needs_review';
      await response.body?.cancel();
    }
  } catch (_) { /* Retry the identical payload/key inside the provider window. */ }
  if (status==='pending' && row.notification_attempts>=5) status='needs_review';
  await db.prepare(`UPDATE directory_requests SET notification_status=?,notification_provider_id=?,notification_error=?,
    notification_accepted_at=CASE WHEN ?='accepted' THEN datetime('now') ELSE NULL END,
    notification_next_attempt_at=datetime('now',?),notification_token=NULL,notification_lease_until=NULL,updated_at=datetime('now')
    WHERE id=? AND notification_token=?`).bind(status,provider,error,status,`+${Math.min(60,5 * 2 ** (row.notification_attempts-1))} minutes`,id,token).run();
}
