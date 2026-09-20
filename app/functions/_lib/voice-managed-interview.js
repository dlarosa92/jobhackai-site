import { getDb } from './db.js';
import { getVoiceEntitlement, reserveVoiceSession } from './voice-entitlements.js';
import { interviewerInstructions, buildResumeContext } from './voice-interviewer.js';
import { createManagedVoiceCall, closeManagedVoiceCall } from './voice-provider-calls.js';
import { armVoiceDeadline } from './voice-deadline.js';

export const MANAGED_INTERVIEW_MINUTES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateOwner(uid, sessionId) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || !UUID.test(sessionId || '')) {
    throw Error('voice_connection_request_invalid');
  }
}
function control(db, uid, sessionId) {
  return db.prepare(`SELECT *,julianday(deadline_at)>julianday('now') AS in_window
    FROM voice_interview_controls WHERE session_id=? AND auth_id=?`).bind(sessionId,uid).first();
}
async function stillOpen(db, uid, sessionId, attemptId) {
  return db.prepare(`SELECT 1 FROM voice_interview_controls c
    JOIN voice_provider_calls p ON p.id=c.current_attempt_id AND p.auth_id=c.auth_id AND p.session_id=c.session_id
    WHERE c.session_id=? AND c.auth_id=? AND c.closed_at IS NULL
      AND julianday(c.deadline_at)>julianday('now') AND p.id=? AND p.state='active'
      AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=c.auth_id)
      AND EXISTS(SELECT 1 FROM voice_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.id=c.session_id AND u.auth_id=c.auth_id AND s.status IN ('created','active'))`)
    .bind(sessionId,uid,attemptId).first();
}

/** Server-only lifecycle used by the authenticated SDP route. uid must come from
 * verified authentication. Never return this answer until this function has
 * committed the interview reservation and rechecked the saved close intent. */
export async function openManagedInterview(env,{uid,sessionId,sdp,role,seniority,jd,firstName='',transcript,interviewStarted=false,replacesAttemptId=null}) {
  validateOwner(uid,sessionId);
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || new TextEncoder().encode(sdp).length>65536) {
    throw Error('voice_connection_request_invalid');
  }
  const db=getDb(env);
  if (!db) throw Error('voice_connection_storage_unavailable');
  // Verified closure receipts outlive account/history erasure. They also
  // prevent a reused client-supplied UUID from racing alarm cleanup.
  if (await db.prepare('SELECT 1 FROM voice_closure_reconciliations WHERE session_id=? LIMIT 1').bind(sessionId).first()) {
    throw Error('voice_connection_ended');
  }
  const user=await db.prepare('SELECT id FROM users WHERE auth_id=?').bind(uid).first();
  if (!user) throw Error('voice_connection_owner_missing');
  const existing=await db.prepare('SELECT * FROM voice_sessions WHERE id=?').bind(sessionId).first();
  if (existing && existing.user_id!==user.id) throw Error('voice_connection_not_found');
  if (existing && !['created','active'].includes(existing.status)) throw Error('voice_connection_ended');
  let saved=await control(db,uid,sessionId);
  // Legacy direct-to-provider credentials may still have active calls. They
  // cannot be silently adopted as if the new ledger had observed their end.
  if (existing && !saved) throw Error('voice_connection_legacy_session');
  if (!existing && saved?.reserved_at) throw Error('voice_connection_history_removed');
  if (saved?.closed_at) throw Error('voice_connection_ended');
  if (saved && !saved.in_window) throw Error('voice_connection_expired');

  let entitlement=null;
  if (!existing) {
    role=String(role || '').trim().slice(0,120);
    seniority=String(seniority || '').trim().slice(0,60);
    jd=String(jd || '').trim().slice(0,2000);
    if (!role) throw Error('voice_connection_role_required');
    entitlement=await getVoiceEntitlement(env,uid,{managed:true});
    if (!entitlement.canStart) throw Error('voice_connection_'+(entitlement.reason || 'paywall'));
    if (!saved) {
      await db.prepare(`INSERT INTO voice_interview_controls(session_id,auth_id,deadline_at)
        SELECT ?,?,datetime('now','+20 minutes') WHERE EXISTS(SELECT 1 FROM users WHERE auth_id=?)
          AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=?)
        ON CONFLICT(session_id) DO NOTHING`).bind(sessionId,uid,uid,uid).run();
      saved=await control(db,uid,sessionId);
      if (!saved) throw Error('voice_connection_not_admitted');
      if (saved.closed_at) throw Error('voice_connection_ended');
    }
  }

  // A successful provider call must never depend on a browser timer alone.
  // Reconnect reaffirms the original alarm; it cannot buy another 20 minutes.
  await armVoiceDeadline(env,{uid,sessionId,deadlineAt:saved.deadline_at});

  const previous=saved.current_attempt_id && await db.prepare(
    'SELECT id,state FROM voice_provider_calls WHERE id=? AND session_id=? AND auth_id=?'
  ).bind(saved.current_attempt_id,sessionId,uid).first();
  if (saved.current_attempt_id && !previous) throw Error('voice_connection_pending');
  if (previous && previous.state!=='closed') {
    if (previous.state!=='active') throw Error('voice_connection_pending');
    // A stale reconnect must not close the replacement another request made.
    if (replacesAttemptId!==previous.id) {
      const error=Error('voice_connection_conflict');
      error.currentAttemptId=previous.id; // application ID, never provider ID
      throw error;
    }
    await closeManagedVoiceCall(env,{uid,attemptId:previous.id});
  }

  const tail=Array.isArray(transcript) ? transcript.filter(t=>t && typeof t.text==='string' &&
    ['user','assistant'].includes(t.speaker)).slice(-20).map(t=>({speaker:t.speaker,text:t.text.slice(0,500)})) : [];
  const model=env.OPENAI_MODEL_VOICE || 'gpt-realtime-mini';
  let call;
  try {
    call=await createManagedVoiceCall(env,{uid,sessionId,sdp,guarded:true,expectedAttemptId:saved.current_attempt_id,
      instructions:interviewerInstructions({
        role:existing?.role || role,seniority:existing?.seniority || seniority,jd:existing?.jd_excerpt || jd,
        firstName,maxMinutes:MANAGED_INTERVIEW_MINUTES,
        resumeContext:existing ? buildResumeContext(tail) : null,
        interviewStarted:!!existing && interviewStarted===true
      })});
    if (!existing) {
      const reserved=await reserveVoiceSession(env,{sessionId,userRowId:user.id,role,
        seniority:seniority || null,jd:jd || null,mode:entitlement.mode,model,managedAttemptId:call.attemptId});
      if (!reserved.inserted) throw Error('voice_connection_reservation_unavailable');
    }
    if (!await stillOpen(db,uid,sessionId,call.attemptId)) throw Error('voice_connection_ended');
    return {sessionId,attemptId:call.attemptId,sdp:call.sdp,model,resumed:!!existing,
      mode:existing?.entitlement_mode || entitlement?.mode,maxMinutes:MANAGED_INTERVIEW_MINUTES,
      deadlineAt:saved.deadline_at,
      sessionsRemaining:entitlement?.mode==='pack' ? Math.max(0,entitlement.sessionsRemaining-1) : null};
  } catch (error) {
    // A lost reservation receipt may have committed the credit. Preserve the
    // same session ID for recovery; never refund or create a second interview.
    if (call) await closeManagedVoiceCall(env,{uid,attemptId:call.attemptId}).catch(()=>{});
    // No provider diagnostic, SDP or credential is allowed into the response.
    const code=/^voice_(?:connection|call)_[a-z_]+$/.test(error?.message || '')
      ? error.message : 'voice_connection_unconfirmed';
    throw Error(code);
  }
}

/** Durable End intent is allowed before start has reserved a row. This fences
 * a late provider response even if completion overtakes the initial request.
 * A creating/uncertain provider attempt remains pending, never guessed closed.
 * Persisting the transcript is the completion route's separate responsibility. */
export async function closeManagedInterview(env,{uid,sessionId}) {
  validateOwner(uid,sessionId);
  const db=getDb(env);
  if (!db) throw Error('voice_connection_storage_unavailable');
  const foreign=await db.prepare(`SELECT 1 FROM voice_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND u.auth_id<>?`).bind(sessionId,uid).first();
  if (foreign) throw Error('voice_connection_not_found');
  const saved=await db.prepare(`INSERT INTO voice_interview_controls(session_id,auth_id,deadline_at,closed_at,legacy_unverified)
    SELECT ?,?,datetime('now'),datetime('now'),EXISTS(SELECT 1 FROM voice_sessions WHERE id=?)
      WHERE EXISTS(SELECT 1 FROM users WHERE auth_id=?)
    ON CONFLICT(session_id) DO UPDATE SET closed_at=COALESCE(voice_interview_controls.closed_at,excluded.closed_at),
      updated_at=datetime('now') WHERE voice_interview_controls.auth_id=excluded.auth_id
    RETURNING session_id,legacy_unverified`).bind(sessionId,uid,sessionId,uid).first();
  if (!saved) throw Error('voice_connection_not_found');
  const active=await db.prepare(`SELECT id FROM voice_provider_calls
    WHERE session_id=? AND auth_id=? AND state='active' LIMIT 1`).bind(sessionId,uid).first();
  if (active) await closeManagedVoiceCall(env,{uid,attemptId:active.id}).catch(()=>{});
  const pending=await db.prepare(`SELECT 1 FROM voice_provider_calls
    WHERE session_id=? AND auth_id=? AND state<>'closed' LIMIT 1`).bind(sessionId,uid).first();
  return {closed:!pending && !saved.legacy_unverified};
}
