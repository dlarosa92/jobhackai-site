// Usage evidence, never billing authority. Missing fields stay null, not zero.
// Only numeric usage fields cross this boundary; no transcripts or secrets.
export const MAX_USAGE_EVENTS = 512;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : null;
function fields(source, names) {
  return Object.fromEntries(names.map(name => [name, count(source?.[name])]));
}
export function normalizeUsage(source) {
  if (!source || typeof source !== 'object') return null;
  const result = fields(source, ['input_tokens', 'output_tokens', 'total_tokens']);
  result.type = source.type === 'duration' ? 'duration' : 'tokens';
  result.seconds = typeof source.seconds === 'number' && Number.isFinite(source.seconds) && source.seconds >= 0 && source.seconds <= 3600 ? source.seconds : null;
  result.input_token_details = fields(source.input_token_details, ['text_tokens', 'audio_tokens', 'image_tokens', 'cached_tokens']);
  result.input_token_details.cached_tokens_details = fields(source.input_token_details?.cached_tokens_details, ['text_tokens', 'audio_tokens', 'image_tokens']);
  result.output_token_details = fields(source.output_token_details, ['text_tokens', 'audio_tokens']);
  return result;
}
export function createVoiceUsage() {
  const events = new Map();
  let dropped = 0;
  function add(kind, id, usage) {
    if (!['response', 'transcription'].includes(kind) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) { dropped++; return; }
    const key = kind + ':' + id;
    if (events.has(key)) return;
    if (events.size >= MAX_USAGE_EVENTS) { dropped++; return; }
    events.set(key, { kind, id, usage: normalizeUsage(usage) });
  }
  function snapshot() {
    return { version: 1, source: 'client_reported', coverage: 'observed_events_only', dropped, events: [...events.values()] };
  }
  return { add, snapshot };
}
// Revalidate even a payload from our own client. Unknown properties are dropped.
export function normalizeVoiceUsage(payload) {
  const collector = createVoiceUsage();
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events.slice(0, MAX_USAGE_EVENTS)) collector.add(event?.kind, event?.id, event?.usage);
  const result = collector.snapshot();
  result.dropped += Math.max(0, events.length - MAX_USAGE_EVENTS) + (count(payload?.dropped) || 0);
  result.available = payload?.version === 1 && Array.isArray(payload?.events);
  return result;
}
export function responseTokenTotals(evidence) {
  const responses = evidence.events.filter(event => event.kind === 'response');
  const total = field => !responses.length || responses.some(event => event.usage?.[field] == null)
    ? null : responses.reduce((sum, event) => sum + event.usage[field], 0);
  return { input: total('input_tokens'), output: total('output_tokens') };
}
if (typeof window !== 'undefined') window.createVoiceUsage = createVoiceUsage;
