export { normalizeVoiceUsage, responseTokenTotals } from '../../../js/voice-usage.js';

// Only the returned report response is observable here. Timeouts and discarded
// retries can incur additional costs, so this is not a total-cost calculation.
export function scorecardUsageEvidence(model, usage, fromCache = false) {
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : null;
  return {
    source: fromCache ? 'application_cache' : 'server_response', coverage: 'returned_response_only',
    providerTotalVerified: false,
    model: typeof model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(model) ? model : null,
    promptTokens: count(usage?.promptTokens), completionTokens: count(usage?.completionTokens),
    cachedTokens: count(usage?.cachedTokens), totalTokens: count(usage?.totalTokens)
  };
}
