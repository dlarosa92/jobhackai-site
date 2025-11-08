// OpenAI API client utility
// Handles rate limiting, structured outputs, prompt caching, and cost tracking

/**
 * Call OpenAI API with structured outputs
 * @param {Object} options - API options
 * @param {string} options.model - Model to use (gpt-4o-mini, gpt-4o, etc.)
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

  // TODO: [OPENAI INTEGRATION POINT] - Implement OpenAI API call
  // This is a placeholder - actual implementation needed
  
  const apiKey = env.OPENAI_API_KEY;
  const apiUrl = 'https://api.openai.com/v1/chat/completions';
  
  // Build request body
  const requestBody = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature
  };
  
  // Add structured outputs if provided
  if (responseFormat) {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: responseFormat
    };
  }
  
  // Add prompt caching if system prompt provided (for cacheable prompts >1024 tokens)
  // Note: This requires OpenAI API support for prompt caching
  // For now, we'll implement basic caching via KV
  
  // Check cache first (if system prompt provided)
  let cachedResponse = null;
  if (systemPrompt && env.JOBHACKAI_KV) {
    const cacheKey = `openai_cache:${hashString(systemPrompt + JSON.stringify(messages))}`;
    cachedResponse = await env.JOBHACKAI_KV.get(cacheKey);
    if (cachedResponse) {
      const cached = JSON.parse(cachedResponse);
      console.log(`[OPENAI] Cache hit for ${feature}`, { userId, model });
      return cached;
    }
  }
  
  // Make API call with retry logic
  let lastError = null;
  const maxRetries = 3;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (response.status === 429) {
        // Rate limit - exponential backoff
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        const waitTime = Math.min(retryAfter * 1000, 60000 * Math.pow(2, attempt));
        
        if (attempt < maxRetries - 1) {
          console.log(`[OPENAI] Rate limited, retrying after ${waitTime}ms`, { feature, attempt });
          await sleep(waitTime);
          continue;
        } else {
          throw new Error(`Rate limit exceeded. Please try again later.`);
        }
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract usage info
      const usage = data.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || 0;
      const cachedTokens = usage.cached_tokens || 0;
      
      // Log usage
      console.log(`[OPENAI] Usage for ${feature}`, {
        userId,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        estimatedCost: estimateCost(model, promptTokens, completionTokens, cachedTokens)
      });
      
      // Cache response if system prompt provided
      if (systemPrompt && env.JOBHACKAI_KV && !cachedResponse) {
        const cacheKey = `openai_cache:${hashString(systemPrompt + JSON.stringify(messages))}`;
        await env.JOBHACKAI_KV.put(cacheKey, JSON.stringify(data), {
          expirationTtl: 86400 // 24 hours
        });
      }
      
      return {
        content: data.choices[0]?.message?.content || '',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          cachedTokens
        },
        model: data.model,
        finishReason: data.choices[0]?.finish_reason
      };
      
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1 && error.message.includes('Rate limit')) {
        continue;
      }
      throw error;
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
  // TODO: [OPENAI INTEGRATION POINT] - Implement moderation API
  // const response = await fetch('https://api.openai.com/v1/moderations', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${apiKey}`,
  //     'Content-Type': 'application/json'
  //   },
  //   body: JSON.stringify({ input: text })
  // });
  // const data = await response.json();
  // return data.results[0]?.flagged || false;
  
  // For now, return false (no moderation)
  return false;
}

/**
 * Generate ATS feedback using AI
 * @param {string} resumeText - Resume text
 * @param {Object} ruleBasedScores - Scores from rule-based engine
 * @param {string} jobTitle - Target job title
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} AI-generated feedback
 */
export async function generateATSFeedback(resumeText, ruleBasedScores, jobTitle, env) {
  // TODO: [OPENAI INTEGRATION POINT] - Implement feedback generation
  // This should use structured outputs to ensure consistent format
  
  const systemPrompt = `You are an ATS resume expert. Generate precise, actionable feedback based on rule-based scores.
Keep feedback concise (120-180 words per section). Show 2 bullet rewrites using action verbs and metrics.`;
  
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: `Resume text: ${resumeText.substring(0, 4000)}\n\nJob Title: ${jobTitle}\n\nRule-based scores: ${JSON.stringify(ruleBasedScores)}\n\nGenerate feedback for each category.`
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
              score: { type: 'number' },
              max: { type: 'number' },
              feedback: { type: 'string' },
              suggestions: {
                type: 'array',
                items: { type: 'string' }
              }
            }
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
            }
          }
        }
      }
    }
  };
  
  return await callOpenAI({
    model: env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini',
    messages,
    responseFormat,
    maxTokens: 800,
    temperature: 0.2,
    systemPrompt,
    feature: 'ats_feedback'
  }, env);
}

/**
 * Generate resume rewrite using AI
 * @param {string} resumeText - Original resume text
 * @param {string} section - Section to rewrite (optional)
 * @param {string} jobTitle - Target job title
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} Rewritten resume
 */
export async function generateResumeRewrite(resumeText, section, jobTitle, env) {
  // TODO: [OPENAI INTEGRATION POINT] - Implement rewrite generation
  // Use gpt-4o for higher quality
  
  const systemPrompt = `You are an expert resume writer. Regenerate resume content to meet ATS best practices.
Preserve facts, use 1-2 lines per bullet, quantify outcomes, no fluff.`;
  
  const userPrompt = section
    ? `Rewrite the ${section} section of this resume for a ${jobTitle} role:\n\n${resumeText}`
    : `Rewrite this resume for a ${jobTitle} role:\n\n${resumeText.substring(0, 6000)}`;
  
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
  
  return await callOpenAI({
    model: env.OPENAI_MODEL_REWRITE || 'gpt-4o',
    messages,
    maxTokens: 2000,
    temperature: 0.2,
    systemPrompt,
    feature: 'resume_rewrite'
  }, env);
}

/**
 * Estimate cost based on tokens
 */
function estimateCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  // Pricing as of 2024 (approximate)
  const pricing = {
    'gpt-4o-mini': {
      input: 0.15 / 1000000, // $0.15 per 1M tokens
      output: 0.60 / 1000000  // $0.60 per 1M tokens
    },
    'gpt-4o': {
      input: 2.50 / 1000000, // $2.50 per 1M tokens
      output: 10.00 / 1000000 // $10.00 per 1M tokens
    }
  };
  
  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  
  // Cached tokens are free (or heavily discounted)
  const effectivePromptTokens = Math.max(0, promptTokens - cachedTokens);
  
  const cost = (effectivePromptTokens * modelPricing.input) + (completionTokens * modelPricing.output);
  
  return cost;
}

/**
 * Hash string for caching
 */
function hashString(str) {
  // Simple hash function (for Cloudflare Workers)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

