import { getVoiceEntitlement, voiceFeatureEnabled } from './voice-entitlements.js';

// Paid balances remain readable during a feature pause. Availability controls
// starting an interview, not whether an account owns a pack.
export async function getVoicePlanSummary(env, uid) {
  const enabled = voiceFeatureEnabled(env);
  const managed = env.VOICE_MANAGED_CALLS_ENABLED === 'true';
  const unavailable = { enabled: false, lookupStatus: 'unavailable', canStart: false,
    mode: null, unlimited: false, freeSessionUsed: false, sessionsRemaining: 0 };
  try {
    // A paused feature needs no transport-schema readiness check to read credit
    // ownership. Active starts still enforce all managed transport prerequisites.
    const ent = await getVoiceEntitlement(env, uid, { managed: enabled && managed });
    const ready = !['not_migrated', 'db_unavailable'].includes(ent.reason);
    return {
      enabled: enabled && ready, lookupStatus: ready ? 'ready' : 'unavailable',
      transport: managed ? 'managed' : 'legacy', canStart: enabled && ready && ent.canStart,
      mode: ent.mode, reason: ent.reason, monthlyLimit: ent.monthlyLimit ?? null,
      monthlyRemaining: ent.monthlyRemaining ?? null, unlimited: ent.unlimited,
      freeSessionUsed: ent.freeSessionUsed, sessionsRemaining: ent.sessionsRemaining,
      packExpiresAt: ent.packExpiresAt ?? null
    };
  } catch {
    console.warn('[PLAN-ME] Voice entitlement lookup unavailable');
    return unavailable;
  }
}
