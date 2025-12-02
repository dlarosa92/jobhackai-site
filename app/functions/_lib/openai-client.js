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
  maxBackoffMs = 60000
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
    cacheKey = `openai_cache:${hashString(JSON.stringify(cacheData))}`;
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

  let lastError = null;
  const retryLimit = maxRetries;
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
        const waitTime = Math.min(retryAfter * 1000, maxBackoffMs * Math.pow(2, attempt));

        if (attempt < retryLimit - 1) {
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
    : 2000; // Increased from 800 to handle full role-specific feedback structure

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_SCORING))
    ? Number(env.OPENAI_TEMPERATURE_SCORING)
    : 0.2;

  // Approximate input limit: keep input around same scale as output for cost control
  const maxInputTokens = maxOutputTokens * 2; // resume + scores; still cheap with mini
  const truncatedResume = truncateToApproxTokens(resumeText || '', maxInputTokens);

  const targetRoleUsed = jobTitle && jobTitle.trim().length > 0 ? jobTitle.trim() : 'general';
  const roleContext = targetRoleUsed !== 'general' 
    ? `The candidate is targeting: ${targetRoleUsed}. Tailor all role-specific feedback to this role.`
    : 'No specific target role provided. Provide general tech/knowledge worker improvement guidance.';

  // Lean system prompt: instructions only, no repetition of schema constraints
  const systemPrompt = `You are an ATS resume expert. Analyze the provided resume and generate precise, actionable feedback.

CORE RULES:
- Use EXACT scores from RULE-BASED SCORES. Do NOT generate or modify scores.
- Generate feedback for exactly 5 categories: Keyword Match, ATS Formatting, Structure & Organization, Tone & Clarity, Grammar & Spelling.
- Keep feedback concise: 2-3 sentence explanation + up to 2 bullet suggestions per category.

RESUME-AWARE CONSTRAINT (CRITICAL):
- Only reference features that ACTUALLY EXIST in this resume.
- Do NOT suggest "add LinkedIn URL" unless the resume already has a Links/URLs section.
- Do NOT suggest "add portfolio" unless one is mentioned or implied.
- Do NOT suggest generic improvements that don't apply to the actual content.
- If a section is already strong, say so—don't invent problems.
- Base every diagnosis and tip on SPECIFIC text from the resume.

ROLE-SPECIFIC FEEDBACK:
Evaluate 5 sections for role fit: Header & Contact, Professional Summary, Experience, Skills, Education.
For each: fitLevel (big_impact|tunable|strong), diagnosis (one sentence, specific to THIS resume), 3 tips (grounded in actual content), rewritePreview (improve what exists, never fabricate).

${roleContext}

ATS ISSUES: Identify structured problems with id, severity (low|medium|high), and details array.`;

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
              score: { 
                type: 'number',
                description: 'Must match the exact score from RULE-BASED SCORES. Do NOT generate or modify this value.'
              },
              max: { 
                type: 'number',
                description: 'Must match the exact max value from RULE-BASED SCORES. Do NOT generate or modify this value.'
              },
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
          type: 'object',
          properties: {
            targetRoleUsed: { 
              type: 'string',
              description: 'The exact target role string used, or "general" if no role provided'
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
              minItems: 5,
              maxItems: 5
            }
          },
          required: ['targetRoleUsed', 'sections']
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
          }
        }
      },
      required: ['atsRubric', 'roleSpecificFeedback', 'atsIssues']
    }
  };

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
      maxRetries: 1,  // Only 2 attempts total (initial + 1 retry) for user-facing calls
      maxBackoffMs: 1500  // Cap backoff at 1.5s to avoid hanging users
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
              description: '3-6 bullet strings describing role-tailoring improvements'
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
