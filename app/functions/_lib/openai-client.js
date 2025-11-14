// OpenAI API client utility
// Handles rate limiting, structured outputs, prompt caching, and cost tracking

/**
 * Approximate token-aware truncation.
 * Simple heuristic: ~4 characters ≈ 1 token.
 * This is cheap and Cloudflare-compatible (no external libs).
 */
function truncateToApproxTokens(text, maxTokensApprox) {
  if (!text || !maxTokensApprox || maxTokensApprox <= 0) return '';
  const approxChars = maxTokensApprox * 4; // very rough but good enough for cost control
  if (text.length <= approxChars) return text;
  return text.slice(0, approxChars);
}

/**
 * Call OpenAI API with structured outputs and optional fallback model.
 * @param {Object} options - API options
 * @param {string} options.model - Primary model (gpt-4o-mini, gpt-4o, etc.)
 * @param {string} [options.fallbackModel] - Optional fallback model on non-rate-limit failures
 * @param {Array} options.messages - Chat messages
 * @param {Object} options.responseFormat - Structured output schema (optional)
 * @param {number} options.maxTokens - Maximum tokens to generate
 * @param {number} options.temperature - Temperature (0-2)
 * @param {string} options.systemPrompt - System prompt (for caching)
 * @param {string} options.userId - User ID for logging
 * @param {string} options.feature - Feature name for logging
 * @returns {Promise<Object>} API response
 */
export async function callOpenAI({
  model = 'gpt-4o-mini',
  fallbackModel = null,
  messages = [],
  responseFormat = null,
  maxTokens = 800,
  temperature = 0.2,
  systemPrompt = null,
  userId = null,
  feature = 'unknown'
}, env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured. Please set it in Cloudflare Pages secrets.');
  }

  const apiKey = env.OPENAI_API_KEY;
  const apiUrl = 'https://api.openai.com/v1/chat/completions';

  // Build request body
  const buildRequestBody = (activeModel) => {
    const body = {
      model: activeModel,
      messages,
      max_tokens: maxTokens,
      temperature
    };

    // Add structured outputs if provided
    if (responseFormat) {
      body.response_format = {
        type: 'json_schema',
        json_schema: responseFormat
      };
    }

    return body;
  };

  // KV-based prompt+input cache (our own cache layer, not OpenAI native)
  let cachedResponse = null;
  let cacheKey = null;
  if (systemPrompt && env.JOBHACKAI_KV) {
    cacheKey = `openai_cache:${hashString(systemPrompt + JSON.stringify(messages))}`;
    cachedResponse = await env.JOBHACKAI_KV.get(cacheKey);
    if (cachedResponse) {
      const cached = JSON.parse(cachedResponse);
      console.log(`[OPENAI] Cache hit for ${feature}`, { userId, model: cached.model });
      return cached;
    }
  }

  let lastError = null;
  const maxRetries = 3;
  let activeModel = model;
  let usedFallback = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildRequestBody(activeModel))
      });

      if (response.status === 429) {
        // Rate limit - exponential backoff
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        const waitTime = Math.min(retryAfter * 1000, 60000 * Math.pow(2, attempt));

        if (attempt < maxRetries - 1) {
          console.log(`[OPENAI] Rate limited, retrying after ${waitTime}ms`, { feature, attempt, model: activeModel });
          await sleep(waitTime);
          continue;
        } else {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.error?.message || `OpenAI API error: ${response.status}`;

        // Non-429 error: if we have a fallback model and haven't used it yet, switch and retry
        if (!usedFallback && fallbackModel && activeModel !== fallbackModel && attempt < maxRetries - 1) {
          console.warn(`[OPENAI] Error with model ${activeModel}, falling back to ${fallbackModel}`, {
            feature,
            userId,
            status: response.status,
            message
          });
          activeModel = fallbackModel;
          usedFallback = true;
          continue;
        }

        throw new Error(message);
      }

      const data = await response.json();

      const usage = data.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || 0;
      const cachedTokens = usage.cached_tokens || 0;

      console.log(`[OPENAI] Usage for ${feature}`, {
        userId,
        model: data.model || activeModel,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        estimatedCost: estimateCost(data.model || activeModel, promptTokens, completionTokens, cachedTokens)
      });

      const result = {
        content: data.choices?.[0]?.message?.content || '',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          cachedTokens
        },
        model: data.model || activeModel,
        finishReason: data.choices?.[0]?.finish_reason
      };

      // Cache final response (only if we didn't hit cache earlier)
      if (cacheKey && env.JOBHACKAI_KV && !cachedResponse) {
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify(result), {
          expirationTtl: 86400 // 24 hours
        });
      }

      return result;

    } catch (error) {
      lastError = error;
      console.error('[OPENAI] callOpenAI error', {
        feature,
        userId,
        model: activeModel,
        attempt,
        message: error.message
      });

      // Check if this is a rate limit error
      const isRateLimit = String(error.message || '').includes('Rate limit');

      // For rate limit errors, retry with exponential backoff
      if (isRateLimit && attempt < maxRetries - 1) {
        continue;
      }

      // For non-rate-limit errors (network failures, timeouts, etc.):
      // Try fallback model if available and not already used
      if (!isRateLimit && !usedFallback && fallbackModel && activeModel !== fallbackModel && attempt < maxRetries - 1) {
        console.warn(`[OPENAI] Network/API error with model ${activeModel}, falling back to ${fallbackModel}`, {
          feature,
          userId,
          attempt,
          error: error.message
        });
        activeModel = fallbackModel;
        usedFallback = true;
        continue; // Retry with fallback model
      }

      // After switching to fallback (or if no fallback), allow retries for transient errors
      // This handles cases where the fallback model fails due to transient issues (network, 500s, etc.)
      if (!isRateLimit && attempt < maxRetries - 1) {
        console.log(`[OPENAI] Retrying after transient error (attempt ${attempt + 1}/${maxRetries})`, {
          feature,
          userId,
          model: activeModel,
          error: error.message
        });
        continue; // Retry with same model (fallback if already switched)
      }

      // If we've exhausted all retries, stop
      break;
    }
  }

  throw lastError || new Error('OpenAI API call failed');
}

/**
 * Call OpenAI Moderation API
 * @param {string} text - Text to moderate
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<boolean>} True if flagged
 */
export async function moderateContent(text, apiKey) {
  // NOTE: still a stub by design. Wire this when you're ready to pay moderation costs.
  // For now, always "not flagged".
  return false;
}

/**
 * Generate ATS feedback using AI (JSON schema structured output).
 * High-frequency, low-cost endpoint → gpt-4o-mini, tightly capped tokens.
 */
export async function generateATSFeedback(resumeText, ruleBasedScores, jobTitle, env) {
  const baseModel = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';

  // Respect env-driven config with sensible defaults
  const maxOutputTokens = Number(env.OPENAI_MAX_TOKENS_ATS) > 0
    ? Number(env.OPENAI_MAX_TOKENS_ATS)
    : 800;

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_SCORING))
    ? Number(env.OPENAI_TEMPERATURE_SCORING)
    : 0.2;

  // Approximate input limit: keep input around same scale as output for cost control
  const maxInputTokens = maxOutputTokens * 2; // resume + scores; still cheap with mini
  const truncatedResume = truncateToApproxTokens(resumeText || '', maxInputTokens);

  const systemPrompt = `You are an ATS resume expert. Generate precise, actionable feedback based on the provided rule-based scores.
IMPORTANT: Use the exact scores provided in RULE-BASED SCORES. Do NOT generate or modify scores. Your role is to provide feedback and suggestions only.
Keep feedback concise. For each category, provide:
- A short explanation (2–3 sentences) that explains why the score is what it is
- Up to 2 bullet suggestions, using action verbs and metrics where possible.`;

  // We only send the minimal part of ruleBasedScores the model actually needs
  const safeRuleScores = {
    overallScore: ruleBasedScores?.overallScore,
    keywordScore: ruleBasedScores?.keywordScore,
    formattingScore: ruleBasedScores?.formattingScore,
    structureScore: ruleBasedScores?.structureScore,
    toneScore: ruleBasedScores?.toneScore,
    grammarScore: ruleBasedScores?.grammarScore
  };

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content:
        `You are evaluating a resume for ATS readiness.\n\n` +
        `JOB TITLE: ${jobTitle || 'Not specified'}\n\n` +
        `RULE-BASED SCORES (use these exact scores - do not modify):\n${JSON.stringify(safeRuleScores, null, 2)}\n\n` +
        `RESUME TEXT:\n${truncatedResume}\n\n` +
        `Return structured feedback for each category. Use the exact scores from RULE-BASED SCORES above. Provide feedback and suggestions only - do not generate new scores.`
    }
  ];

  const responseFormat = {
    name: 'ats_feedback',
    schema: {
      type: 'object',
      properties: {
        atsRubric: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              score: { type: 'number', description: 'Must match the rule-based score for this category' },
              max: { type: 'number', description: 'Maximum score for this category' },
              feedback: { type: 'string' },
              suggestions: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['category', 'score', 'max', 'feedback']
          }
        },
        roleSpecificFeedback: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              section: { type: 'string' },
              score: { type: 'string' },
              feedback: { type: 'string' },
              examples: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['section', 'feedback']
          }
        }
      },
      required: ['atsRubric']
    }
  };

  return await callOpenAI(
    {
      model: baseModel,
      // we *could* set a fallbackModel here (e.g. another mini variant), but for now
      // we keep it single-model to avoid multiple paid calls for a cheap endpoint.
      messages,
      responseFormat,
      maxTokens: maxOutputTokens,
      temperature,
      systemPrompt,
      feature: 'ats_feedback'
    },
    env
  );
}

/**
 * Generate resume rewrite using AI.
 * Uses gpt-4o for higher quality and structured output so UI can rely on shape.
 * This is a premium feature, so we accept a higher per-call cost but still cap it.
 */
export async function generateResumeRewrite(resumeText, section, jobTitle, env) {
  const baseModel = env.OPENAI_MODEL_REWRITE || 'gpt-4o';
  const fallbackModel = 'gpt-4o-mini'; // cheaper fallback if 4o has issues

  const maxOutputTokens = Number(env.OPENAI_MAX_TOKENS_REWRITE) > 0
    ? Number(env.OPENAI_MAX_TOKENS_REWRITE)
    : 2000;

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_REWRITE))
    ? Number(env.OPENAI_TEMPERATURE_REWRITE)
    : 0.2;

  // For rewrites, we allow more input but still bound it.
  const maxInputTokens = maxOutputTokens * 2; // generous, but still controlled
  const truncatedResume = truncateToApproxTokens(resumeText || '', maxInputTokens);

  const safeJobTitle = jobTitle || 'Professional role';

  const systemPrompt = `You are an expert resume writer. Regenerate resume content to meet ATS best practices.
Preserve all factual information. Use concise, results-oriented bullets (1–2 lines each). 
Quantify outcomes when possible. Do not invent experience.`;

  const userPrompt = section
    ? `Rewrite ONLY the "${section}" section of this resume for a ${safeJobTitle} role.\n\n` +
      `Return:\n- "original": the original text you received\n- "rewritten": your improved version\n- "changes": a short list of what you improved.\n\n` +
      `RESUME TEXT (may include other sections, but focus only on ${section}):\n${truncatedResume}`
    : `Rewrite this resume for a ${safeJobTitle} role.\n\n` +
      `Return:\n- "original": the original text you received\n- "rewritten": your improved version\n- "changes": a short list of what you improved.\n\n` +
      `RESUME TEXT:\n${truncatedResume}`;

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: userPrompt
    }
  ];

  const responseFormat = {
    name: 'resume_rewrite',
    schema: {
      type: 'object',
      properties: {
        original: { type: 'string' },
        rewritten: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              description: { type: 'string' }
            },
            required: ['description']
          }
        }
      },
      required: ['original', 'rewritten']
    }
  };

  return await callOpenAI(
    {
      model: baseModel,
      fallbackModel, // if 4o fails for non-rate reasons, we can still give them a rewrite with mini
      messages,
      responseFormat,
      maxTokens: maxOutputTokens,
      temperature,
      systemPrompt,
      feature: 'resume_rewrite'
    },
    env
  );
}

/**
 * Estimate cost based on tokens.
 * NOTE: Keep this in sync with OpenAI pricing when you revise plans.
 */
function estimateCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  const pricing = {
    'gpt-4o-mini': {
      input: 0.15 / 1_000_000,  // $0.15 per 1M input tokens
      output: 0.60 / 1_000_000  // $0.60 per 1M output tokens
    },
    'gpt-4o': {
      input: 2.50 / 1_000_000,  // $2.50 per 1M input tokens
      output: 10.00 / 1_000_000 // $10.00 per 1M output tokens
    }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];

  // Cached tokens are effectively free or heavily discounted; treat them as free here.
  const effectivePromptTokens = Math.max(0, promptTokens - cachedTokens);

  const cost =
    effectivePromptTokens * modelPricing.input +
    completionTokens * modelPricing.output;

  return Number.isFinite(cost) ? cost : 0;
}

/**
 * Hash string for caching
 */
function hashString(str) {
  let hash = 0;
  if (!str) return '0';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
