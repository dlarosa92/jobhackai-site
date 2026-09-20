// Eligibility only; callers must hold admission, obtain fresh provider evidence
// and preserve a recoverable manifest before any account deletion.
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ','T')+'Z' : value;
  if (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(normalized)) return null;
  const day = new Date(normalized.slice(0,10)+'T00:00:00Z');
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0,10)!==normalized.slice(0,10)) return null;
  return milliseconds;
}

export function inactiveAccountEligibility(user, warning, activity, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('inactivity_clock_invalid');
  if (!user || !activity) return { eligible:false,reason:'identity_unconfirmed' };
  if (typeof user.email!=='string' || !user.email.trim()) return { eligible:false,reason:'notice_unconfirmed' };
  const expiry = timestamp(user.pack_expires_at);
  const expiredPack = expiry!==null && expiry<=now;
  if (![null,'free'].includes(user.plan) && !(user.plan==='pack' && expiredPack)) return {eligible:false,reason:'paid_account'};
  if (![null,'canceled','incomplete_expired'].includes(user.subscription_status) || user.scheduled_plan ||
      !Number.isInteger(user.voice_sessions_remaining) || user.voice_sessions_remaining<0 ||
      (user.voice_sessions_remaining>0 && !expiredPack)) return {eligible:false,reason:'paid_account'};
  const cutoff = new Date(now);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-2);
  const times = [user.last_login_at,user.last_activity_at];
  const knownTimes = times.filter(value=>value!==null).map(timestamp);
  if (!knownTimes.length || knownTimes.some(value=>value===null)) return {eligible:false,reason:'activity_unconfirmed'};
  const providerTimes=[activity.lastLoginAt,activity.lastRefreshAt].filter(value=>value!==null);
  if (!providerTimes.length || providerTimes.some(value=>!Number.isSafeInteger(value)||value<0)) return {eligible:false,reason:'activity_unconfirmed'};
  if ([...knownTimes,...providerTimes].some(value=>value>cutoff.getTime())) return {eligible:false,reason:'recent_activity'};
  const sent = timestamp(warning?.sent_at), recorded = timestamp(user.deletion_warning_sent_at);
  if (warning?.auth_id!==user.auth_id || warning.email!==user.email || warning.state!=='sent' ||
      typeof warning.provider_id!=='string' || !warning.provider_id || sent===null || sent!==recorded ||
      sent>now-30*24*60*60*1000) return {eligible:false,reason:'notice_unconfirmed'};
  // Any activity after the warning invalidates it, even if a future retry is
  // more than two years later. A new warning is required for the new period.
  if ([...knownTimes,...providerTimes].some(value=>value>=sent)) return {eligible:false,reason:'notice_invalidated'};
  return {eligible:true,reason:'eligible'};
}
