// Dates describe reviewed content, never the day a generator happened to run.
export function editorialDates(record, label, today = new Date().toISOString().slice(0, 10)) {
  const dates = {};
  for (const field of ['datePublished', 'dateModified']) {
    if (record[field] === undefined) continue;
    const value = record[field];
    const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`) : new Date(NaN);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today) {
      throw new Error(`${label}: ${field} must be a real YYYY-MM-DD date, not in the future`);
    }
    dates[field] = value;
  }
  if (dates.datePublished && dates.dateModified && dates.dateModified < dates.datePublished) {
    throw new Error(`${label}: dateModified precedes datePublished`);
  }
  return dates;
}
