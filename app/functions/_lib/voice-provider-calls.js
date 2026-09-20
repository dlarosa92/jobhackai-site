import { getDb } from './db.js';
import { realtimeSessionConfig } from './voice-interviewer.js';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CALL_ID = /^rtc_[A-Za-z0-9_-]{1,240}$/;
const DEFINITE_REJECTION = new Set([400,401,403,404,405,406,413,415,422]);
const MAX_SDP_BYTES = 65536;

function owner(uid, sessionId) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 ||
      typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw Error('voice_call_owner_invalid');
  }
}
function database(env) {
  const db = getDb(env);
  if (!db) throw Error('voice_call_storage_unavailable');
  return db;
}
function validSdp(value) {
  return typeof value === 'string' && value.startsWith('v=0') &&
    new TextEncoder().encode(value).length <= MAX_SDP_BYTES;
}
async function keyIdentity(env) {
  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) {
    throw Error('voice_call_configuration_unavailable');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.OPENAI_API_KEY));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('');
}
function providerCallId(location) {
  if (typeof location !== 'string' || !location) return null;
  try {
    const url = new URL(location, CALLS_URL);
    if (url.origin !== 'https://api.openai.com' || url.username || url.password || url.search || url.hash) return null;
    const id = url.pathname.slice('/v1/realtime/calls/'.length);
    return url.pathname === '/v1/realtime/calls/' + id && CALL_ID.test(id) ? id : null;
  } catch { return null; }
}

/** Internal signalling only. The caller authenticates uid, checks entitlement
 * and reserves its interview before releasing the returned SDP to the client.
 * No API credential, SDP, instructions or transcript is stored in this ledger.
 * This helper never trusts a provider call ID supplied by the browser. */
export async function createManagedVoiceCall(env, { uid, sessionId, sdp, instructions }) {
  owner(uid,sessionId);
  if (!validSdp(sdp) || typeof instructions !== 'string' || !instructions.trim()) throw Error('voice_call_request_invalid');
  const db = database(env), keySha = await keyIdentity(env);
  const id = crypto.randomUUID(), execution = crypto.randomUUID();
  // Atomic with deletion admission, competing attempts and owner changes.
  // The row survives a removed history/user row; no FK cascade hides a call.
  const row = await db.prepare(`INSERT INTO voice_provider_calls
    (id,auth_id,session_id,state,provider_key_sha256,execution_token)
    SELECT ?,?,?,'creating',?,? WHERE EXISTS(SELECT 1 FROM users WHERE auth_id=?)
      AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=?)
      AND NOT EXISTS(SELECT 1 FROM voice_provider_calls WHERE session_id=? AND state<>'closed')
      AND NOT EXISTS(SELECT 1 FROM voice_provider_calls WHERE session_id=? AND auth_id<>?)
      AND NOT EXISTS(SELECT 1 FROM account_operation_claims WHERE auth_id=? AND kind='maintenance' AND state<>'finished')
      AND NOT EXISTS(SELECT 1 FROM voice_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=? AND u.auth_id<>?) RETURNING *`)
    .bind(id,uid,sessionId,keySha,execution,uid,uid,sessionId,sessionId,uid,uid,sessionId,uid).first();
  if (!row) throw Error('voice_call_not_admitted');
  console.log('[voice-call] creating',{attempt:id,execution});
  let active = false;
  try {
    const form = new FormData();
    form.set('sdp',sdp);
    form.set('session',JSON.stringify(realtimeSessionConfig({
      model:env.OPENAI_MODEL_VOICE || 'gpt-realtime-mini', instructions,
      voice:env.VOICE_INTERVIEW_VOICE || 'marin'
    })));
    const response = await fetch(CALLS_URL,{
      method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'X-Client-Request-Id':id},
      body:form,redirect:'error',signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const definite = DEFINITE_REJECTION.has(response.status);
      await db.prepare(`UPDATE voice_provider_calls SET state=?,last_error_code=?,
        execution_token=CASE WHEN ? THEN NULL ELSE execution_token END,updated_at=datetime('now'),
        closed_at=CASE WHEN ? THEN datetime('now') ELSE NULL END
        WHERE id=? AND execution_token=? AND state='creating'`)
        .bind(definite?'closed':'uncertain',definite?'create_rejected':'create_unconfirmed',definite?1:0,definite?1:0,id,execution).run();
      throw Error(definite?'voice_call_create_rejected':'voice_call_create_unconfirmed');
    }
    const callId = providerCallId(response.headers.get('Location'));
    if (!callId) throw Error('voice_call_reference_unconfirmed');
    // Persist the authoritative provider ID before the SDP leaves the server.
    const saved = await db.prepare(`UPDATE voice_provider_calls SET state='active',provider_call_id=?,
      execution_token=NULL,updated_at=datetime('now') WHERE id=? AND execution_token=? AND state='creating'
      RETURNING id`).bind(callId,id,execution).first();
    if (!saved) throw Error('voice_call_record_unconfirmed');
    active = true;
    const answer = await response.text();
    if (!validSdp(answer)) throw Error('voice_call_answer_invalid');
    return { attemptId:id, sdp:answer };
  } catch (error) {
    if (active) {
      // A malformed/lost answer is never handed to the browser. Terminate only
      // this durably owned call, not a client-provided or guessed call ID.
      await closeManagedVoiceCall(env,{uid,attemptId:id}).catch(()=>{});
    } else {
      // A crash or unknown create result remains visible for reconciliation.
      // No automatic lease expiry guesses that a provider call did not exist.
      await db.prepare(`UPDATE voice_provider_calls SET state='uncertain',last_error_code='create_unconfirmed',
        updated_at=datetime('now') WHERE id=? AND execution_token=? AND state='creating'`)
        .bind(id,execution).run().catch(()=>{});
    }
    // Provider bodies and exception text can contain private connection data.
    throw Error(error?.message === 'voice_call_create_rejected' ? error.message : 'voice_call_create_unconfirmed');
  }
}

/** Close only an owned, provider-confirmed call. 404/timeout is not a hangup
 * receipt; an uncertain result keeps the durable hold for explicit review. */
export async function closeManagedVoiceCall(env,{uid,attemptId}) {
  if (typeof uid !== 'string' || !uid || uid.length>128 || typeof attemptId !== 'string' || !attemptId) throw Error('voice_call_owner_invalid');
  const db=database(env);
  const before=await db.prepare('SELECT * FROM voice_provider_calls WHERE id=? AND auth_id=?').bind(attemptId,uid).first();
  if (!before) throw Error('voice_call_not_found');
  if (before.state==='closed') return {closed:true,alreadyClosed:true};
  if (before.state!=='active' || !CALL_ID.test(before.provider_call_id || '')) throw Error('voice_call_close_unconfirmed');
  if (await keyIdentity(env)!==before.provider_key_sha256) throw Error('voice_call_provider_changed');
  const execution=crypto.randomUUID();
  const claimed=await db.prepare(`UPDATE voice_provider_calls SET state='closing',execution_token=?,
    updated_at=datetime('now') WHERE id=? AND auth_id=? AND state='active' AND provider_call_id=?
    AND provider_key_sha256=? RETURNING id`)
    .bind(execution,attemptId,uid,before.provider_call_id,before.provider_key_sha256).first();
  if (!claimed) throw Error('voice_call_close_unconfirmed');
  console.log('[voice-call] closing',{attempt:attemptId,execution});
  try {
    const response=await fetch(CALLS_URL+'/'+encodeURIComponent(before.provider_call_id)+'/hangup',{
      method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'X-Client-Request-Id':execution},
      redirect:'error',signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw Error('voice_call_close_unconfirmed');
    const saved=await db.prepare(`UPDATE voice_provider_calls SET state='closed',execution_token=NULL,
      closed_at=datetime('now'),updated_at=datetime('now'),last_error_code=NULL
      WHERE id=? AND auth_id=? AND state='closing' AND execution_token=? RETURNING id`)
      .bind(attemptId,uid,execution).first();
    if (!saved) throw Error('voice_call_close_unconfirmed');
    return {closed:true,alreadyClosed:false};
  } catch {
    await db.prepare(`UPDATE voice_provider_calls SET state='uncertain',last_error_code='close_unconfirmed',
      updated_at=datetime('now') WHERE id=? AND auth_id=? AND execution_token=? AND state='closing'`)
      .bind(attemptId,uid,execution).run().catch(()=>{});
    throw Error('voice_call_close_unconfirmed');
  }
}

/** A bounded deletion attempt terminates at most one call. Unknown/creating
 * calls remain pending; it never spins or silently assumes they stopped. */
export async function closeOneVoiceCallForDeletion(env,uid) {
  const db=database(env);
  const intent=await db.prepare('SELECT id FROM account_deletion_admissions WHERE auth_id=?').bind(uid).first();
  if (!intent) throw Error('deletion_admission_required');
  const pending=await db.prepare("SELECT 1 FROM account_operation_claims WHERE auth_id=? AND state<>'finished'").bind(uid).first();
  if (pending) throw Error('deletion_operations_pending');
  const call=await db.prepare("SELECT id FROM voice_provider_calls WHERE auth_id=? AND state='active' ORDER BY created_at,id LIMIT 1").bind(uid).first();
  if (call) await closeManagedVoiceCall(env,{uid,attemptId:call.id});
  const remaining=await db.prepare("SELECT 1 FROM voice_provider_calls WHERE auth_id=? AND state<>'closed' LIMIT 1").bind(uid).first();
  return {closed:!remaining};
}
