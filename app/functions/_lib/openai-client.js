// OpenAI API client utility
// Handles rate limiting, structured outputs, prompt caching, and cost tracking
import { normalizeRoleToFamily } from './role-normalizer.js';
import { loadRoleTemplate } from './role-template-loader.js';
import { ROLE_SKILL_TEMPLATES } from './role-skills.js'; // Fallback only

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
 * Detect and log output truncation before JSON parsing.
 * Returns { truncated: boolean, rawContent: string, diagnostics: object }
 */
function detectTruncation(result, feature) {
  const diagnostics = {
    feature,
    finishReason: result.finishReason,
    contentLength: result.content?.length || 0,
    model: result.model,
    completionTokens: result.usage?.completionTokens || 0
  };

  const truncated = result.finishReason === 'length';

  if (truncated) {
    // Check if JSON is likely incomplete (common truncation patterns)
    const content = result.content || '';
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;
    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/]/g) || []).length;

    diagnostics.braceMismatch = openBraces - closeBraces;
    diagnostics.bracketMismatch = openBrackets - closeBrackets;
    diagnostics.likelyIncompleteJson = openBraces !== closeBraces || openBrackets !== closeBrackets;

    console.warn(`[OPENAI][TRUNCATION] Output truncated for ${feature}`, diagnostics);
  }

  return { truncated, rawContent: result.content, diagnostics };
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
 * @param {number} options.maxRetries - Maximum retry attempts (default 3)
 * @param {number} options.maxBackoffMs - Maximum backoff time in ms (default 60000)
 * @param {number} [options.timeoutMs] - Optional timeout in milliseconds
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
  feature = 'unknown',
  maxRetries = 3,
  maxBackoffMs = 60000,
  timeoutMs = null  // Optional timeout in milliseconds
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
  // Include all parameters that affect the response to prevent cache collisions
  let cachedResponse = null;
  let cacheKey = null;
  if (systemPrompt && env.JOBHACKAI_KV) {
    const cacheData = {
      systemPrompt,
      messages,
      model,
      maxTokens,
      temperature,
      responseFormat: responseFormat ? JSON.stringify(responseFormat) : null
    };
    const cacheHash = await hashString(JSON.stringify(cacheData));
    cacheKey = `openai_cache:${cacheHash}`;
    cachedResponse = await env.JOBHACKAI_KV.get(cacheKey);
    if (cachedResponse) {
      const cached = JSON.parse(cachedResponse);
      
      // Don't return truncated cached responses - they're invalid and will cause parse failures
      // This prevents wasting tokens on retry loops (saves ~7,272 tokens per bad request)
      if (cached.finishReason === 'length') {
        console.warn(`[OPENAI] Skipping truncated cached response for ${feature}`, { 
          userId, 
          model: cached.model,
          finishReason: cached.finishReason
        });
        cachedResponse = null; // Force fresh generation
      } else {
        console.log(`[OPENAI] Cache hit for ${feature}`, { userId, model: cached.model });
        return cached;
      }
    }
  }

  // A2: Clamp maxRetries to at least 1 (critical bug fix)
  maxRetries = Math.max(1, maxRetries);
  
  let lastError = null;
  const retryLimit = maxRetries;
  let activeModel = model;
  let usedFallback = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // A1: Add AbortController for timeout support
    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    
    try {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildRequestBody(activeModel)),
          signal: controller?.signal
        });
        
        // Clear timeout on success
        if (timeoutId) clearTimeout(timeoutId);

        if (response.status === 429) {
          // Rate limit - respect Retry-After header, with exponential backoff as minimum
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
          const retryAfterMs = retryAfter * 1000;
          // Exponential backoff: 1s, 2s, 4s, etc. (capped at maxBackoffMs)
          const exponentialBackoffMs = Math.min(1000 * Math.pow(2, attempt), maxBackoffMs);
          // Use the larger of Retry-After or exponential backoff, but cap at maxBackoffMs
          const waitTime = Math.min(Math.max(retryAfterMs, exponentialBackoffMs), maxBackoffMs);

          if (attempt < retryLimit - 1) {
            console.log(`[OPENAI] Rate limited, retrying after ${waitTime}ms`, { feature, attempt, model: activeModel, retryAfter, exponentialBackoff: exponentialBackoffMs });
            await sleep(waitTime);
            continue;
          } else {
            const rateLimitError = new Error(`HTTP 429: Rate limit exceeded. Please try again later.`);
            rateLimitError.status = 429;
            rateLimitError.code = 429;
            throw rateLimitError;
          }
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message = errorData.error?.message || `OpenAI API error: ${response.status}`;
          const fullMessage = `HTTP ${response.status}: ${message}`;

          // Non-429 error: if we have a fallback model and haven't used it yet, switch and retry
          if (!usedFallback && fallbackModel && activeModel !== fallbackModel && attempt < retryLimit - 1) {
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

          const httpError = new Error(fullMessage);
          httpError.status = response.status;
          httpError.code = response.status;
          throw httpError;
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
        // Don't cache truncated responses - they're invalid and will cause retries to fail
        if (cacheKey && env.JOBHACKAI_KV && !cachedResponse) {
          if (result.finishReason === 'length') {
            console.warn('[OPENAI] Skipping cache for truncated response', { feature, model: result.model });
          } else {
            await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify(result), {
              expirationTtl: 86400 // 24 hours
            });
          }
        }

        return result;
      } catch (fetchError) {
        // Check if timeout occurred
        if (fetchError.name === 'AbortError' || (controller && controller.signal.aborted)) {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw fetchError;
      } finally {
        // A1: Always clear timeout in finally to prevent leaks
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error;
      console.error('[OPENAI] callOpenAI error', {
        feature,
        userId,
        model: activeModel,
        attempt,
        message: error.message,
        isTimeout: error.message?.includes('timeout')
      });

      // Check if this is a rate limit error
      const isRateLimit = String(error.message || '').includes('Rate limit');

      // For rate limit errors, retry with exponential backoff (same logic as 429 handler)
      if (isRateLimit && attempt < retryLimit - 1) {
        // Use exponential backoff: 1s, 2s, 4s delays (capped at maxBackoffMs)
        const waitTime = Math.min(1000 * Math.pow(2, attempt), maxBackoffMs);
        console.log(`[OPENAI] Rate limited (from exception), retrying after ${waitTime}ms`, { feature, attempt, model: activeModel });
        await sleep(waitTime);
        continue;
      }

      // For non-rate-limit errors (network failures, timeouts, etc.):
      // Try fallback model if available and not already used
      if (!isRateLimit && !usedFallback && fallbackModel && activeModel !== fallbackModel && attempt < retryLimit - 1) {
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
      if (!isRateLimit && attempt < retryLimit - 1) {
        console.log(`[OPENAI] Retrying after transient error (attempt ${attempt + 1}/${maxRetries})`, {
          feature,
          userId,
          model: activeModel,
          error: error.message
        });
        continue; // Retry with same model (fallback if already switched)
      }

      // If we've exhausted retries, throw the last error
      throw lastError || new Error('OpenAI API call failed after retries');
    }
  }

  // Should never reach here, but TypeScript/flow safety
  throw lastError || new Error('OpenAI API call failed');
}

/**
 * Generate ATS feedback (Tier 1 core feedback only, no role tips)
 * PHASE 1: Enforces brevity constraints to prevent truncation
 * PHASE 2: skipRoleTips=true excludes role-specific feedback from schema
 * 
 * @param {string} resumeText - Full resume text
 * @param {Object} ruleBasedScores - Rule-based ATS scores
 * @param {string|null} jobTitle - Target job title/role (optional, for context only in Tier 1)
 * @param {Object} env - Environment variables
 * @param {Object} options - Options
 * @param {boolean} options.skipRoleTips - If true, exclude role-specific feedback from schema (PHASE 2)
 * @param {boolean} options.shortMode - If true, use extreme brevity constraints (PHASE 1)
 * @param {number} [options.timeoutMs] - Timeout in milliseconds (PHASE 1)
 * @returns {Promise<Object>} OpenAI response with atsRubric and atsIssues only
 */
export async function generateATSFeedback(resumeText, ruleBasedScores, jobTitle, env, options = {}) {
  const baseModel = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';
  const skipRoleTips = options.skipRoleTips === true;
  const shortMode = options.shortMode === true;

  // Check if we have a role - but skip if skipRoleTips is true
  const hasRole = !skipRoleTips && jobTitle && jobTitle.trim().length > 0;

  // Log token optimization when no role provided (for monitoring cost savings)
  if (!hasRole && !skipRoleTips) {
    console.log('[OPENAI][ats_feedback] No role provided - skipping role-specific feedback generation (~2000 tokens saved)');
  }
  if (skipRoleTips) {
    console.log('[OPENAI][ats_feedback] skipRoleTips=true - Tier 1 core feedback only');
  }

  // A4: Token caps: add dedicated Tier 1 env var
  // Tier 1 (skipRoleTips): use OPENAI_MAX_TOKENS_ATS_TIER1 (default 800)
  // Non-tier1 / role tips / legacy: use OPENAI_MAX_TOKENS_ATS (default 3500)
  const envMaxTokensTier1 = Number(env.OPENAI_MAX_TOKENS_ATS_TIER1) > 0 ? Number(env.OPENAI_MAX_TOKENS_ATS_TIER1) : 800;
  const envMaxTokens = Number(env.OPENAI_MAX_TOKENS_ATS) > 0 ? Number(env.OPENAI_MAX_TOKENS_ATS) : 3500;
  
  // Determine default based on skipRoleTips and hasRole
  let defaultMaxOutputTokens;
  if (skipRoleTips) {
    defaultMaxOutputTokens = envMaxTokensTier1; // Tier 1 uses dedicated env var
  } else if (hasRole) {
    defaultMaxOutputTokens = envMaxTokens; // Full feedback with role tips
  } else {
    defaultMaxOutputTokens = 1500; // No role, no tips
  }
  
  const maxOutputTokens = options.maxOutputTokensOverride || defaultMaxOutputTokens;

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_SCORING))
    ? Number(env.OPENAI_TEMPERATURE_SCORING)
    : 0.2;

  // Approximate input limit: keep input around same scale as output for cost control
  const maxInputTokens = maxOutputTokens * 2; // resume + scores; still cheap with mini
  const truncatedResume = truncateToApproxTokens(resumeText || '', maxInputTokens);

  const targetRoleUsed = hasRole ? jobTitle.trim() : 'general';

  // Only process role templates and expectations if we have a role AND not skipping
  let roleContext = '';
  if (hasRole && !skipRoleTips) {
    // Derive role expectations from canonical templates to ground tips in current standards
    const roleFamily = normalizeRoleToFamily(targetRoleUsed);
    const roleTemplate = await loadRoleTemplate(env, roleFamily);
    const mustHave = Array.isArray(roleTemplate.must_have) ? roleTemplate.must_have.slice(0, 8) : [];
    const niceToHave = Array.isArray(roleTemplate.nice_to_have) ? roleTemplate.nice_to_have.slice(0, 8) : [];
    const tools = Array.isArray(roleTemplate.tools) ? roleTemplate.tools.slice(0, 6) : [];

    const roleExpectations = [
      mustHave.length ? `Must-have: ${mustHave.join(', ')}` : null,
      niceToHave.length ? `Nice-to-have: ${niceToHave.join(', ')}` : null,
      tools.length ? `Common tools: ${tools.join(', ')}` : null
    ].filter(Boolean).join(' | ') || 'Follow general professional standards for the stated role.';

    roleContext = `The candidate is targeting: ${targetRoleUsed}. Base all role-specific advice on current expectations for this role: ${roleExpectations}`;
  }

  // Lean system prompt: instructions only, no repetition of schema constraints
  // Conditionally include role-specific instructions only when we have a role
  // PHASE 1: Enforce brevity constraints to prevent truncation
  const brevityInstructions = shortMode 
    ? `EXTREME BREVITY MODE: Each rubric category feedback MAX 1 sentence (~150 chars). Max 3 issues ranked by impact. Max 3 fixes ranked by impact. Each suggestion/bullet MAX 12 words. No long prose.`
    : `BREVITY REQUIRED: Each rubric category feedback MAX 2 sentences (~240-300 chars). Max 5 issues ranked by impact (highest first). Max 5 fixes/recommendations ranked by impact (highest first). Each suggestion/bullet MAX 18 words. No long prose blocks. Prefer dense, actionable phrasing.`;

  const systemPrompt = `You are an ATS resume expert. Analyze the provided resume and generate precise, actionable feedback.

CORE RULES:
- Use EXACT scores from RULE-BASED SCORES. Do NOT generate or modify scores.
- Generate feedback for exactly 5 categories: Keyword Match, ATS Formatting, Structure & Organization, Tone & Clarity, Grammar & Spelling.
${brevityInstructions}

RESUME-AWARE CONSTRAINT (CRITICAL):
- Only reference features that ACTUALLY EXIST in this resume.
- Do NOT suggest "add LinkedIn URL" unless the resume already has a Links/URLs section.
- Do NOT suggest "add portfolio" unless one is mentioned or implied.
- Do NOT suggest generic improvements that don't apply to the actual content.
- If a section is already strong, say so—don't invent problems.
- Base every diagnosis and tip on SPECIFIC text from the resume.

${hasRole && !skipRoleTips ? `ROLE-SPECIFIC FEEDBACK (REQUIRED):
Provide role-specific feedback for up to 5 sections. If a section lacks enough evidence, include what you can, note what is missing, and give next steps.
Evaluate these sections for role fit: Header & Contact, Professional Summary, Experience, Skills, Education.
For each section you can support: fitLevel (big_impact|tunable|strong), diagnosis (one sentence, specific to THIS resume), exactly 3 tips (grounded in actual content), rewritePreview (improve what exists, never fabricate).
If resume content is too thin to complete a section, explicitly say what to add (projects, tools, metrics) rather than inventing content.

${roleContext}

` : ''}ATS ISSUES: Identify structured problems with id, severity (low|medium|high), and details array. Limit to top 5 by impact.`;

  // We only send the minimal part of ruleBasedScores the model actually needs
  // NOTE: Do NOT include overallScore - it should not be in the atsRubric response
  const safeRuleScores = {
    keywordScore: ruleBasedScores?.keywordScore,
    formattingScore: ruleBasedScores?.formattingScore,
    structureScore: ruleBasedScores?.structureScore,
    toneScore: ruleBasedScores?.toneScore,
    grammarScore: ruleBasedScores?.grammarScore
  };

  // Lean user prompt: data only, no repeated instructions
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content:
        `TARGET ROLE: ${targetRoleUsed}\n\n` +
        `RULE-BASED SCORES: ${JSON.stringify(safeRuleScores)}\n\n` +
        `RESUME TEXT:\n${truncatedResume}`
    }
  ];

  // Build schema properties - conditionally include roleSpecificFeedback based on hasRole
  const schemaProperties = {
    atsRubric: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          score: { 
            type: 'number',
            description: 'Must match the exact score from RULE-BASED SCORES. Do NOT generate or modify this value.'
          },
          max: { 
            type: 'number',
            description: 'Must match the exact max value from RULE-BASED SCORES. Do NOT generate or modify this value.'
          },
          feedback: { 
            type: 'string',
            description: shortMode ? 'MAX 1 sentence (~150 chars). Dense, actionable.' : 'MAX 2 sentences (~240-300 chars). Dense, actionable.'
          },
          suggestions: {
            type: 'array',
            items: { 
              type: 'string',
              description: shortMode ? 'MAX 12 words per suggestion' : 'MAX 18 words per suggestion'
            },
            maxItems: shortMode ? 2 : 3
          }
        },
        required: ['category', 'score', 'max', 'feedback']
      }
    },
    atsIssues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Stable identifier like "missing_keywords", "formatting_tables"'
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high']
          },
          details: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific items, e.g., missing keywords list'
          }
        },
        required: ['id', 'severity', 'details']
      },
      maxItems: shortMode ? 3 : 5,
      description: 'Top issues ranked by impact (highest first)'
    }
  };

  // Build required fields array - conditionally include roleSpecificFeedback
  const requiredFields = ['atsRubric', 'atsIssues'];

  // Only include roleSpecificFeedback in schema if we have a role AND not skipping
  // PHASE 2: skipRoleTips must fully remove roleSpecificFeedback from schema
  if (hasRole && !skipRoleTips) {
    schemaProperties.roleSpecificFeedback = {
      type: 'object',
      properties: {
        targetRoleUsed: { 
          type: 'string',
          description: 'The exact target role string used'
        },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              section: {
                type: 'string',
                enum: ['Header & Contact', 'Professional Summary', 'Experience', 'Skills', 'Education']
              },
              fitLevel: {
                type: 'string',
                enum: ['big_impact', 'tunable', 'strong']
              },
              diagnosis: {
                type: 'string',
                description: 'One-sentence summary of main issue/opportunity'
              },
              tips: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
                description: 'Exactly 3 actionable suggestions'
              },
              rewritePreview: {
                type: 'string',
                description: '1-2 sentence improved version without fabricating content'
              }
            },
            required: ['section', 'fitLevel', 'diagnosis', 'tips', 'rewritePreview']
          },
          minItems: 1,
          maxItems: 5
        }
      },
      required: ['targetRoleUsed', 'sections']
    };
    requiredFields.push('roleSpecificFeedback');
  }

  const responseFormat = {
    name: 'ats_feedback',
    schema: {
      type: 'object',
      properties: schemaProperties,
      required: requiredFields
    }
  };

  // PHASE 1: Prevent double-retry - set maxRetries to 0 for Tier 1
  // resume-feedback.js owns retries (exactly 2 attempts: normal + shortMode)
  const result = await callOpenAI(
    {
      model: baseModel,
      // we *could* set a fallbackModel here (e.g. another mini variant), but for now
      // we keep it single-model to avoid multiple paid calls for a cheap endpoint.
      messages,
      responseFormat,
      maxTokens: maxOutputTokens,
      temperature,
      systemPrompt,
      feature: 'ats_feedback',
      maxRetries: 0,  // PHASE 1: resume-feedback.js owns retries, prevent double-retry
      maxBackoffMs: 1500,  // Cap backoff at 1.5s to avoid hanging users
      timeoutMs: options.timeoutMs || null  // PHASE 1: Add timeout support (10-12s for Tier 1)
    },
    env
  );

  // Log truncation before caller attempts to parse
  const truncationInfo = detectTruncation(result, 'ats_feedback');
  if (truncationInfo.truncated) {
    console.error('[OPENAI][ats_feedback] Response truncated - JSON parse will likely fail', {
      ...truncationInfo.diagnostics,
      recommendation: 'Consider increasing OPENAI_MAX_TOKENS_ATS'
    });
  }

  return result;
}

/**
 * Generate role-specific tailoring tips only (Tier 2)
 * PHASE 2: Separate endpoint for role tips generation
 * 
 * @param {string} resumeText - Full resume text
 * @param {Object} ruleBasedScores - Rule-based ATS scores (for context)
 * @param {string} jobTitle - Target job title/role (required)
 * @param {Object} env - Environment variables
 * @param {Object} options - Options
 * @param {number} [options.timeoutMs] - Timeout in milliseconds (default 9000ms)
 * @returns {Promise<Object>} OpenAI response with roleSpecificFeedback only
 */
export async function generateRoleTips(resumeText, ruleBasedScores, jobTitle, env, options = {}) {
  const baseModel = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';
  const timeoutMs = options.timeoutMs || 9000; // PHASE 2: 8-10s timeout for Tier 2

  if (!jobTitle || jobTitle.trim().length === 0) {
    throw new Error('jobTitle is required for role tips generation');
  }

  const envMaxTokens = Number(env.OPENAI_MAX_TOKENS_ATS) > 0 ? Number(env.OPENAI_MAX_TOKENS_ATS) : 2000;
  const maxOutputTokens = options.maxOutputTokensOverride || envMaxTokens;

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_SCORING))
    ? Number(env.OPENAI_TEMPERATURE_SCORING)
    : 0.2;

  const maxInputTokens = maxOutputTokens * 2;
  const truncatedResume = truncateToApproxTokens(resumeText || '', maxInputTokens);
  const targetRoleUsed = jobTitle.trim();

  // Load role template for context
  const roleFamily = normalizeRoleToFamily(targetRoleUsed);
  const roleTemplate = await loadRoleTemplate(env, roleFamily);
  const mustHave = Array.isArray(roleTemplate.must_have) ? roleTemplate.must_have.slice(0, 8) : [];
  const niceToHave = Array.isArray(roleTemplate.nice_to_have) ? roleTemplate.nice_to_have.slice(0, 8) : [];
  const tools = Array.isArray(roleTemplate.tools) ? roleTemplate.tools.slice(0, 6) : [];

  const roleExpectations = [
    mustHave.length ? `Must-have: ${mustHave.join(', ')}` : null,
    niceToHave.length ? `Nice-to-have: ${niceToHave.join(', ')}` : null,
    tools.length ? `Common tools: ${tools.join(', ')}` : null
  ].filter(Boolean).join(' | ') || 'Follow general professional standards for the stated role.';

  const roleContext = `The candidate is targeting: ${targetRoleUsed}. Base all role-specific advice on current expectations for this role: ${roleExpectations}`;

  const systemPrompt = `You are an ATS resume expert specializing in role-specific tailoring.

CORE RULES:
- Generate role-specific feedback ONLY (no ATS rubric, no ATS issues).
- Evaluate these sections for role fit: Header & Contact, Professional Summary, Experience, Skills, Education.
- For each section you can support: fitLevel (big_impact|tunable|strong), diagnosis (one sentence, specific to THIS resume), exactly 3 tips (grounded in actual content), rewritePreview (improve what exists, never fabricate).
- If resume content is too thin to complete a section, explicitly say what to add (projects, tools, metrics) rather than inventing content.

${roleContext}

RESUME-AWARE CONSTRAINT (CRITICAL):
- Only reference features that ACTUALLY EXIST in this resume.
- Base every diagnosis and tip on SPECIFIC text from the resume.
- Do NOT suggest generic improvements that don't apply to the actual content.`;

  const safeRuleScores = {
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
        `TARGET ROLE: ${targetRoleUsed}\n\n` +
        `RULE-BASED SCORES (for context): ${JSON.stringify(safeRuleScores)}\n\n` +
        `RESUME TEXT:\n${truncatedResume}`
    }
  ];

  const schemaProperties = {
    roleSpecificFeedback: {
      type: 'object',
      properties: {
        targetRoleUsed: { 
          type: 'string',
          description: 'The exact target role string used'
        },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              section: {
                type: 'string',
                enum: ['Header & Contact', 'Professional Summary', 'Experience', 'Skills', 'Education']
              },
              fitLevel: {
                type: 'string',
                enum: ['big_impact', 'tunable', 'strong']
              },
              diagnosis: {
                type: 'string',
                description: 'One-sentence summary of main issue/opportunity'
              },
              tips: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
                description: 'Exactly 3 actionable suggestions'
              },
              rewritePreview: {
                type: 'string',
                description: '1-2 sentence improved version without fabricating content'
              }
            },
            required: ['section', 'fitLevel', 'diagnosis', 'tips', 'rewritePreview']
          },
          minItems: 1,
          maxItems: 5
        }
      },
      required: ['targetRoleUsed', 'sections']
    }
  };

  const responseFormat = {
    name: 'role_tips',
    schema: {
      type: 'object',
      properties: schemaProperties,
      required: ['roleSpecificFeedback']
    }
  };

  const result = await callOpenAI(
    {
      model: baseModel,
      messages,
      responseFormat,
      maxTokens: maxOutputTokens,
      temperature,
      systemPrompt,
      feature: 'role_tips',
      maxRetries: 2,  // PHASE 2: 2 attempts total (1 retry) for transient errors only
      maxBackoffMs: 2000,
      timeoutMs: timeoutMs
    },
    env
  );

  // Parse and extract roleSpecificFeedback
  try {
    const content = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
    return {
      roleSpecificFeedback: content.roleSpecificFeedback || null,
      usage: result.usage,
      model: result.model,
      finishReason: result.finishReason
    };
  } catch (parseError) {
    console.error('[OPENAI][role_tips] Failed to parse response', parseError);
    throw new Error('Failed to parse role tips response');
  }
}

/**
 * Generate resume rewrite using AI.
 * Uses gpt-4o for higher quality and structured output so UI can rely on shape.
 * This is a premium feature, so we accept a higher per-call cost but still cap it.
 * 
 * @param {string} resumeText - Original resume text
 * @param {string|null} section - Optional section to rewrite (null for full resume)
 * @param {string} jobTitle - Target job title/role
 * @param {Array|null} atsIssues - Optional ATS issues from feedback analysis
 * @param {Object|null} roleSpecificFeedback - Optional role-specific feedback with sections
 * @param {Object} env - Environment variables
 */
export async function generateResumeRewrite(resumeText, section, jobTitle, atsIssues, roleSpecificFeedback, env) {
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

  const systemPrompt = `You are a cautious, high-quality resume rewriter for JobHackAI.

CRITICAL CONSTRAINTS - YOU MUST OBEY THESE WITHOUT EXCEPTION:

1. ABSOLUTE PROHIBITIONS:
   - DO NOT invent new jobs, positions, companies, or employers
   - DO NOT change any dates (employment dates, education dates, certification dates)
   - DO NOT invent degrees, certifications, licenses, or credentials
   - DO NOT add experience that doesn't exist in the original resume
   - DO NOT change job titles unless the original resume already implies that level (never downgrade)
   - DO NOT alter company names, school names, or credential names
   - DO NOT create or add LinkedIn, GitHub, portfolio, or any other URLs/links that are not present in the original resume
   - DO NOT invent contact information, social media profiles, or website links

2. WHAT YOU CAN DO:
   - Improve wording, phrasing, and clarity
   - Reorder bullet points for better impact
   - Add metrics and quantifiable results when they are clearly implied by the original content
   - Naturally integrate missing keywords into existing descriptions (avoid keyword stuffing)
   - Improve formatting and structure
   - Highlight achievements that align with the target role
   - Keep existing URLs/links exactly as they appear in the original (if any exist)

3. VERIFICATION REQUIRED:
   - Every company name must match the original exactly
   - Every date must match the original exactly
   - Every degree and certification must match the original exactly
   - Every URL, link, or contact method must match the original exactly (or be omitted if not in original)
   - If you cannot safely improve a section without violating these rules, make minimal edits instead of fabricating content.

4. CHANGE TRACKING:
   - For changeSummary.atsFixes → list what ATS issues were fixed (3-6 bullets)
   - For changeSummary.roleFixes → list how tailored to the target role (3-6 bullets)
   - Be specific but concise

Your objectives:
1. Fix ATS issues from provided analysis (if available) - add missing keywords naturally, simplify formatting, improve tone/clarity and grammar
2. Implement Role-Specific tips from provided feedback (if available) - prioritize changes to Header & Contact, Professional Summary, Experience, and Skills
3. Ensure the rewritten resume clearly signals fitness for the target role (when provided)
4. Keep the resume to a sensible length (1-2 pages worth of text)`;

  // Build context for ATS issues and role-specific feedback
  let contextParts = [];
  if (atsIssues && Array.isArray(atsIssues) && atsIssues.length > 0) {
    contextParts.push(`ATS ISSUES TO ADDRESS:\n${JSON.stringify(atsIssues, null, 2)}`);
  }
  if (roleSpecificFeedback && roleSpecificFeedback.sections && Array.isArray(roleSpecificFeedback.sections)) {
    contextParts.push(`ROLE-SPECIFIC TAILORING GUIDANCE:\nTarget Role: ${roleSpecificFeedback.targetRoleUsed || safeJobTitle}\n${JSON.stringify(roleSpecificFeedback.sections, null, 2)}`);
  }
  const contextText = contextParts.length > 0 ? `\n\n${contextParts.join('\n\n')}\n\n` : ' ';

  const userPrompt = section
    ? `Rewrite ONLY the "${section}" section of this resume for a ${safeJobTitle} role.${contextText}Return a JSON object with:\n- "rewrittenResume": your improved version of the resume text\n- "changeSummary.atsFixes": array of 3-6 strings describing ATS fixes\n- "changeSummary.roleFixes": array of 3-6 strings describing role tailoring changes\n\n` +
      `RESUME TEXT (may include other sections, but focus only on ${section}):\n${truncatedResume}`
    : `Rewrite this resume for a ${safeJobTitle} role.${contextText}Return a JSON object with:\n- "rewrittenResume": your improved version of the full resume\n- "changeSummary.atsFixes": array of 3-6 strings describing ATS fixes\n- "changeSummary.roleFixes": array of 3-6 strings describing role tailoring changes\n\n` +
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
        rewrittenResume: {
          type: 'string',
          description: 'The full rewritten resume text'
        },
        changeSummary: {
          type: 'object',
          properties: {
            atsFixes: {
              type: 'array',
              items: { type: 'string' },
              description: '3-6 bullet strings describing ATS-related improvements'
            },
            roleFixes: {
              type: 'array',
              items: { type: 'string' },
              description: '3-6 bullet strings describing role tailoring changes'
            }
          },
          required: ['atsFixes', 'roleFixes']
        }
      },
      required: ['rewrittenResume', 'changeSummary']
    }
  };

  const result = await callOpenAI(
    {
      model: baseModel,
      fallbackModel,
      messages,
      responseFormat,
      maxTokens: maxOutputTokens,
      temperature,
      systemPrompt,
      feature: 'resume_rewrite',
      maxRetries: 2,
      maxBackoffMs: 3000
    },
    env
  );

  // Log truncation before caller attempts to parse
  const truncationInfo = detectTruncation(result, 'resume_rewrite');
  if (truncationInfo.truncated) {
    console.error('[OPENAI][resume_rewrite] Response truncated - JSON parse will likely fail', {
      ...truncationInfo.diagnostics,
      recommendation: 'Consider increasing OPENAI_MAX_TOKENS_REWRITE'
    });
  }

  return result;
}

/**
 * Simple hash function for cache keys
 */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Estimate cost in USD for OpenAI API call
 */
function estimateCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  // Pricing as of 2024 (approximate, may vary)
  const pricing = {
    'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    'gpt-4': { input: 30 / 1_000_000, output: 60 / 1_000_000 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  const inputCost = Math.max(0, promptTokens - cachedTokens) * modelPricing.input;
  const outputCost = completionTokens * modelPricing.output;
  const cost = inputCost + outputCost;
  return Number.isFinite(cost) ? cost : 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
