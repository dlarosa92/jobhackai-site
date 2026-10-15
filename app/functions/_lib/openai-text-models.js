// Official model specifications verified October 14, 2026.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6-sol
// Keep this policy scoped to text scoring/generation, never Realtime.
export function textCompletionParameters(model, maxTokens, temperature) {
  if (/^gpt-6-(luna|sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    // Preserve the previous nonreasoning workloads, small output budgets,
    // and sampling settings. The provider default is medium reasoning.
    return { max_completion_tokens: maxTokens, reasoning_effort: 'none', temperature };
  }
  // Explicit legacy overrides retain their original wire format for rollout.
  return { max_tokens: maxTokens, temperature };
}

// Standard USD per million text tokens. Historical rates remain for comparisons.
export const TEXT_MODEL_PRICING = {
  'gpt-6-luna': { input: 0.10, cached: 0.01, output: 0.50 },
  'gpt-6-sol': { input: 2.00, cached: 0.20, output: 10.00 },
  'gpt-4.1-mini': { input: 0.40, cached: 0.10, output: 1.60 },
  'gpt-4.1': { input: 2.00, cached: 0.50, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.60 },
  'gpt-4o': { input: 2.50, cached: 1.25, output: 10.00 },
  'gpt-4': { input: 30.00, cached: 30.00, output: 60.00 }
};

// Token estimate only: excludes cache write premiums, long context and service
// tier/region adjustments. Unknown models or missing usage must not look free.
export function estimateTextCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  if (typeof model !== 'string' || !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) || promptTokens < 0 || completionTokens < 0) return null;
  const key = Object.keys(TEXT_MODEL_PRICING).find(k => model === k ||
    (model.startsWith(`${k}-`) && /^\d{4}-\d{2}-\d{2}$/.test(model.slice(k.length + 1))));
  if (!key) return null;
  const price = TEXT_MODEL_PRICING[key];
  const cached = Number.isFinite(cachedTokens) ? Math.max(0, Math.min(promptTokens, cachedTokens)) : 0;
  return ((promptTokens - cached) * price.input + cached * price.cached + completionTokens * price.output) / 1_000_000;
}
