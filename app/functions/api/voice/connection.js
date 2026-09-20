import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { getOrCreateUserByAuthId, getDb } from '../../_lib/db.js';
import { voiceFeatureEnabled } from '../../_lib/voice-entitlements.js';
import { voiceFirstName } from '../../_lib/voice-interviewer.js';
import { openManagedInterview, closeManagedInterview } from '../../_lib/voice-managed-interview.js';
import { queueAccountWork } from '../../_lib/account-operation-scope.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';

async function connectionBody(request) {
  const reader=request.body?.getReader();
  if (!reader) throw Error('invalid_json');
  const decoder=new TextDecoder(),parts=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>100000) {
        await reader.cancel().catch(()=>{});
        throw Error('body_too_large');
      }
      parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } finally { reader.releaseLock(); }
}

// The browser cutover must remove the old client-secret issuer before this
// becomes the live transport. This route exchanges signalling only, not audio.
export async function onRequest(context) {
  const { request, env }=context;
  const origin=request.headers.get('Origin') || '', requestId=generateRequestId();
  const fail=(message,status,extra={})=>errorResponse(message,status,origin,env,requestId,extra);
  const ok=(body,status=200)=>successResponse(body,status,origin,env,requestId);
  if (request.method==='OPTIONS') return ok({});
  if (request.method!=='POST') return fail('Method not allowed',405);
  if (!voiceFeatureEnabled(env) || env.VOICE_MANAGED_CALLS_ENABLED!=='true') return fail('Not found',404);
  const token=getBearer(request);
  if (!token) return fail('Unauthorized',401);
  let verified;
  try { verified=await verifyFirebaseIdToken(token,env.FIREBASE_PROJECT_ID); }
  catch { return fail('Unauthorized',401); }
  let body;
  try {
    body=await connectionBody(request);
    if (!body || typeof body!=='object' || Array.isArray(body)) throw Error();
  } catch (error) {
    return error?.message==='body_too_large' ? fail('Connection request is too large',413) : fail('Invalid connection request',400);
  }
  if (!['open','close'].includes(body.action)) return fail('Invalid connection action',400);
  if (body.action==='open' && !env.OPENAI_API_KEY) return fail('Voice interviews are temporarily unavailable.',503);

  // Register before starting provider work. A disconnected HTTP client must
  // not leave provider creation outside the account-operation lifetime.
  return queueAccountWork(context,async()=>{
    try {
      const uid=verified.uid;
      const user=await getOrCreateUserByAuthId(env,uid,verified.payload?.email || null,
        {updateActivity:body.action==='open'});
      if (!user?.id) return fail('Account unavailable',503);
      if (body.action==='close') {
        const result=await closeManagedInterview(env,{uid,sessionId:body.sessionId});
        const reserved=await getDb(env).prepare('SELECT id FROM voice_sessions WHERE id=? AND user_id=?')
          .bind(body.sessionId,user.id).first();
        return ok({sessionId:body.sessionId,connectionClosed:result.closed,sessionReserved:!!reserved},result.closed?200:202);
      }
      const result=await openManagedInterview(env,{uid,sessionId:body.sessionId,sdp:body.sdp,
        role:body.role,seniority:body.seniority,jd:body.jd,
        firstName:voiceFirstName(verified.payload?.name),transcript:body.transcript,
        interviewStarted:body.interviewStarted,replacesAttemptId:body.replacesAttemptId});
      return ok(result);
    } catch (error) {
      const code=error?.message || '';
      if (code==='voice_connection_conflict') {
        // Authenticated owner may explicitly replace this application attempt
        // after a lost answer. Do not expose or accept a provider call ID.
        return ok({success:false,error:'This interview already has a connection.',
          reason:code,currentAttemptId:error.currentAttemptId},409);
      }
      if (['voice_connection_request_invalid','voice_connection_role_required'].includes(code)) return fail('Invalid connection request',400,{reason:code});
      if (['voice_connection_not_found','voice_connection_owner_missing'].includes(code)) return fail('Session not found',404);
      // This prerequisite fails before provider creation/replacement. A known
      // setup conflict must not leave a crashed-provider account claim behind.
      if (code==='voice_connection_deadline_unavailable') return fail('Voice interviews are temporarily unavailable. Please try again later.',409,{reason:code});
      if (['voice_connection_paywall','voice_connection_limit_reached'].includes(code)) return fail('No interview sessions are available.',403,{reason:code,upgradeRequired:code==='voice_connection_paywall'});
      if (['voice_connection_ended','voice_connection_expired','voice_connection_pending','voice_connection_legacy_session','voice_connection_history_removed',
        'voice_connection_not_admitted','voice_call_not_admitted','voice_call_close_unconfirmed',
        'voice_call_provider_changed','voice_call_create_rejected','voice_connection_reservation_unavailable'].includes(code)) {
        return fail('The interview connection is not ready. Please retry or refresh the page.',409,{reason:code});
      }
      // No thrown SQL/provider diagnostics, SDP or authentication data is logged.
      return fail('Could not establish the interview connection.',502,{reason:'voice_connection_unconfirmed'});
    }
  });
}
