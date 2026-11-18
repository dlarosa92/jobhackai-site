// Operating clocks are separate from activation and external release authority.
export const OPERATING_VERSION = '2026-11-17';
export const FOLLOWUP_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
export function sevenFullDaysElapsed(sentAt, now) {
  const start = Date.parse(sentAt);
  return Number.isFinite(start) && Number.isFinite(now) && now - start >= FOLLOWUP_WAIT_MS;
}
export function outreachWindowOpen(now, timeZone = 'America/New_York') {
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', {timeZone, hour: 'numeric', hourCycle: 'h23'}).format(new Date(now)));
    return hour >= 9 && hour < 17;
  } catch { return false; }
}
// Counts actual elapsed time inside Mon-Fri 09:00-17:00 Eastern, including DST.
// Stops at the required threshold so old unresolved episodes stay cheap to check.
export function businessHoursElapsed(startAt, now, hours = 2) {
  let cursor = Date.parse(startAt), remaining = hours * 3600000;
  if (!Number.isFinite(cursor) || !Number.isFinite(now) || cursor > now || hours <= 0) return false;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23'});
  while (cursor < now) {
    const next = Math.min(now, (Math.floor(cursor / 3600000) + 1) * 3600000);
    const p = Object.fromEntries(parts.formatToParts(new Date(cursor)).map(p => [p.type, p.value]));
    if (!['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= 9 && Number(p.hour) < 17) remaining -= next - cursor;
    if (remaining <= 0) return true;
    cursor = next;
  }
  return false;
}
export function monthlyReportPeriod(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York',year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now).map(p => [p.type, p.value]));
  const previous = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 1));
  const dueAt = [4,5].map(offset => new Date(Date.parse(`${parts.year}-${parts.month}-01T09:00:00Z`) + offset * 3600000))
    .find(date => new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(date) === '09');
  // Remains due after day one. The coordinator checks the saved monthly identity
  // before work/delivery; this signal alone does not claim a report is outstanding.
  return {period: previous.toISOString().slice(0, 7), dueAt:dueAt.toISOString(), due:now.getTime()>=dueAt.getTime(), receiptCheckRequired:true, timeZone: 'America/New_York', identity: `monthly:${previous.toISOString().slice(0, 7)}`};
}
