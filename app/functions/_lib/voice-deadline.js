import { voiceProviderKeyIdentity } from './voice-provider-calls.js';

/** Internal RPC only. Scheduling must be acknowledged before provider creation.
 * Neither a secret nor a browser-controlled deadline crosses this binding. */
export async function armVoiceDeadline(env, { uid, sessionId, deadlineAt }) {
  try {
    const scheduler = env.VOICE_DEADLINES?.getByName(sessionId);
    if (!scheduler) throw Error();
    const receipt = await scheduler.arm({
      uid, sessionId, providerKeySha256: await voiceProviderKeyIdentity(env)
    });
    if (receipt?.armed !== true || receipt.sessionId !== sessionId || receipt.deadlineAt !== deadlineAt) throw Error();
  } catch {
    // Binding/RPC exceptions can include configuration. Fail before opening or
    // replacing a provider call, without exposing their diagnostic text.
    throw Error('voice_connection_deadline_unavailable');
  }
}

export async function watchVoiceConnection(env,{uid,sessionId,attemptId}) {
  try {
    const result=await env.VOICE_DEADLINES?.getByName(sessionId).watchConnection({uid,sessionId,attemptId});
    if (result?.watching!==true) throw Error();
  } catch { throw Error('voice_connection_deadline_unavailable'); }
}

export async function pulseVoiceConnection(env,{uid,sessionId,attemptId}) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof uid!=='string' || !uid || uid.length>128 || !uuid.test(sessionId || '') || !uuid.test(attemptId || '')) {
    throw Error('voice_connection_request_invalid');
  }
  try {
    const result=await env.VOICE_DEADLINES?.getByName(sessionId).pulseConnection({uid,sessionId,attemptId});
    if (typeof result?.alive!=='boolean') throw Error();
    return {connectionAlive:result?.alive===true};
  } catch { throw Error('voice_connection_deadline_unavailable'); }
}
