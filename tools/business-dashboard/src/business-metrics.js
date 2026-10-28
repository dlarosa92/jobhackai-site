// Read-only, bounded history. No GA events are treated as customers or cash.
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const easternDay = date => dayFormat.format(date);
const shift = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

export function metricPeriods(now = new Date(), days = 7) {
  const end = shift(easternDay(now), -1);
  const start = shift(end, 1 - days);
  return { days, start, end, previousStart: shift(start, -days), previousEnd: shift(start, -1), timezone: 'America/New_York' };
}

export function seriesFromRows(rows, period) {
  const values = new Map();
  for (const row of rows) {
    const date = new Date(typeof row.ts === 'number' ? row.ts * 1000 : row.ts);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(row.value)) throw new Error('Invalid metric row');
    const day = easternDay(date);
    values.set(day, (values.get(day) || 0) + row.value);
  }
  const series = Array.from({ length: period.days }, (_, i) => ({ date: shift(period.start, i), value: values.get(shift(period.start, i)) || 0 }));
  const previous = Array.from({ length: period.days }, (_, i) => values.get(shift(period.previousStart, i)) || 0).reduce((a, b) => a + b, 0);
  const value = series.reduce((a, b) => a + b.value, 0);
  return { value, previous, change: value - previous, series };
}

export async function businessMetrics(db, now = new Date()) {
  // One extra day covers Eastern offsets and DST at the oldest boundary.
  const since = Math.floor(now.getTime() / 1000) - 58 * 86400;
  const read = (sql) => db.prepare(sql).bind(since).all().then(result => result.results);
  const results = await Promise.allSettled([
    read("SELECT (charge_created_at / 3600) * 3600 AS ts, SUM(amount_captured) AS value FROM stripe_collected_payments WHERE environment='prod' AND livemode=1 AND currency='usd' AND charge_created_at>=CAST(? AS INTEGER) GROUP BY ts"),
    read("SELECT (r.refund_created_at / 3600) * 3600 AS ts, -SUM(r.amount) AS value FROM stripe_payment_refunds r JOIN stripe_collected_payments p ON p.charge_id=r.charge_id WHERE r.status='succeeded' AND r.currency='usd' AND p.environment='prod' AND p.livemode=1 AND p.currency='usd' AND r.refund_created_at>=CAST(? AS INTEGER) GROUP BY ts"),
    read("SELECT strftime('%Y-%m-%dT%H:00:00Z',created_at) AS ts, COUNT(*) AS value FROM users WHERE unixepoch(created_at)>=CAST(? AS INTEGER) GROUP BY ts"),
    read("SELECT ts, SUM(value) AS value FROM (SELECT strftime('%Y-%m-%dT%H:00:00Z',created_at) AS ts, COUNT(*) AS value FROM mock_interview_sessions WHERE unixepoch(created_at)>=CAST(?1 AS INTEGER) GROUP BY ts UNION ALL SELECT strftime('%Y-%m-%dT%H:00:00Z',ended_at) AS ts, COUNT(*) AS value FROM voice_sessions WHERE status='completed' AND ended_at IS NOT NULL AND unixepoch(ended_at)>=CAST(?1 AS INTEGER) GROUP BY ts) GROUP BY ts"),
  ]);
  const get = i => results[i].status === 'fulfilled' ? results[i].value : null;
  const rows = { money: get(0) && get(1) ? [...get(0), ...get(1)] : null, accounts: get(2), interviews: get(3) };
  const definitions = {
    customers: { label: 'Paying customers', source: 'Stripe', definition: 'People with a current paid plan or paid interview access. Free, staff and test accounts must be removed.', note: 'Current paid access has not been checked against Stripe. No count or trend is claimed.' },
    money: { label: 'Money collected', source: 'Stripe records in Cloudflare', definition: 'Live USD payments minus successful refunds dated in this period. Before fees, costs, taxes and disputes.', note: 'Saved payment records; not yet checked against current Stripe totals. Live test purchases may be included.' },
    accounts: { label: 'New accounts', source: 'Cloudflare account records', definition: 'Account records created in this period. Deleted records are no longer counted.', note: 'Staff and test accounts have not been removed. This is a record count, not verified growth.' },
    interviews: { label: 'Interviews finished', source: 'Cloudflare interview records', definition: 'Saved scored text interviews plus voice sessions marked completed, by finish date. One person may finish more than one.', note: 'Staff and test sessions have not been removed. Deleted history is not counted.' },
  };
  return { checkedAt: now.toISOString(), periods: Object.fromEntries([7, 28].map(days => {
    const period = metricPeriods(now, days);
    const metrics = Object.entries(definitions).map(([id, definition]) => {
      let measurement = null;
      try { if (rows[id]) measurement = seriesFromRows(rows[id], period); } catch { /* Keep unknown distinct from zero. */ }
      return { id, ...definition, status: measurement ? 'provisional' : 'unavailable', value: null, previous: null, change: null, series: [], ...measurement,
        ...(id !== 'customers' && !measurement ? { note: 'The source could not be read. This is not a zero. Try refreshing or check the source.' } : {}) };
    });
    return [days, { ...period, metrics }];
  })) };
}
