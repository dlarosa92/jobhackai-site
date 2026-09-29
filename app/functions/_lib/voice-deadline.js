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
