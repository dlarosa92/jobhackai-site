# ROI OPTIMIZATION INPUT

**File:** `app/functions/_lib/openai-client.js`  
**Branch:** `feature/roi-openai-optimization`  
**Purpose:** Cost optimization, token minimization, model routing, structured outputs, and reliability improvements

---

## File Imports

```javascript
// No external imports - standalone module
// Uses Cloudflare Workers APIs: fetch, env.JOBHACKAI_KV
```

---

## Environment Variable Dependencies

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `OPENAI_API_KEY` | None (required) | All functions | OpenAI API authentication |
| `OPENAI_MODEL_FEEDBACK` | `'gpt-4o-mini'` | `generateATSFeedback` | Model selection for feedback |
| `OPENAI_MODEL_REWRITE` | `'gpt-4o'` | `generateResumeRewrite` | Model selection for rewrites |
| `OPENAI_MAX_TOKENS_ATS` | `800` | Not currently used | Max tokens for ATS scoring |
| `OPENAI_MAX_TOKENS_REWRITE` | `2000` | Not currently used | Max tokens for rewrites |
| `OPENAI_TEMPERATURE_SCORING` | `0.2` | Not currently used | Temperature for scoring |
| `OPENAI_TEMPERATURE_REWRITE` | `0.2` | Not currently used | Temperature for rewrites |

**Note:** Environment variables for max tokens and temperature are defined but not used - hardcoded values are used instead.

---

## Function 1: `callOpenAI` (lines 17-153)

### Full Function Code

```javascript
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
  // OPTIMIZATION: Structured outputs reduce parsing errors and retries
  if (responseFormat) {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: responseFormat
    };
  }
  
  // Add prompt caching if system prompt provided (for cacheable prompts >1024 tokens)
  // OPTIMIZATION OPPORTUNITY: OpenAI native prompt caching (>1024 tokens) could save 50%+ on input costs
  // Note: This requires OpenAI API support for prompt caching
  // For now, we'll implement basic caching via KV
  
  // Check cache first (if system prompt provided)
  // OPTIMIZATION: Cache key includes full messages - could be more granular
  // OPTIMIZATION: Cache hit returns full response - could return just content for smaller KV storage
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
  // OPTIMIZATION: Could add model fallback (e.g., gpt-4o → gpt-4o-mini on failure)
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
        // OPTIMIZATION: Could check TPM/RPM limits and batch requests
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
        // OPTIMIZATION: Could implement fallback to cheaper model on certain errors
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
      // OPTIMIZATION: Could track usage per user/plan for cost allocation
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
      // OPTIMIZATION: Cache expiration could be feature-specific (shorter for rewrites, longer for feedback)
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
      // OPTIMIZATION: Could retry with fallback model on certain errors
      if (attempt < maxRetries - 1 && error.message.includes('Rate limit')) {
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error('OpenAI API call failed');
}
```

### Dependencies
- **Imports:** None (standalone)
- **Helper Functions:** `hashString()`, `sleep()`, `estimateCost()`
- **Environment:** `env.OPENAI_API_KEY`, `env.JOBHACKAI_KV`

### Optimization Opportunities
1. **Token Reduction:** Cache key includes full messages - could hash more efficiently
2. **Structured Output:** Already supported but not always used
3. **Model Fallback:** No fallback logic - could fallback to cheaper model on failure
4. **Caching:** KV-based only - could leverage OpenAI native prompt caching
5. **Error Handling:** Could implement model fallback on specific errors

---

## Function 2: `generateATSFeedback` (lines 186-253)

### Full Function Code

```javascript
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
  
  // OPTIMIZATION: System prompt could be more concise (currently ~50 tokens)
  // OPTIMIZATION: Could extract to constant for better caching
  const systemPrompt = `You are an ATS resume expert. Generate precise, actionable feedback based on rule-based scores.
Keep feedback concise (120-180 words per section). Show 2 bullet rewrites using action verbs and metrics.`;
  
  // OPTIMIZATION: Resume truncation uses character count (4000) instead of token count
  // OPTIMIZATION: Could extract relevant sections instead of truncating from start
  // OPTIMIZATION: JSON.stringify(ruleBasedScores) adds overhead - could send only needed fields
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
  
  // JSON Schema for Structured Output
  // OPTIMIZATION: Schema is verbose - could use more concise field names
  // OPTIMIZATION: 'suggestions' and 'examples' arrays might be redundant
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
  
  // OPTIMIZATION: maxTokens (800) is hardcoded - should use env.OPENAI_MAX_TOKENS_ATS
  // OPTIMIZATION: temperature (0.2) is hardcoded - should use env.OPENAI_TEMPERATURE_SCORING
  // OPTIMIZATION: Model selection doesn't have fallback - could fallback to gpt-4o-mini if gpt-4o fails
  return await callOpenAI({
    model: env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini',
    messages,
    responseFormat,
    maxTokens: 800, // OPTIMIZATION: Should use env.OPENAI_MAX_TOKENS_ATS || 800
    temperature: 0.2, // OPTIMIZATION: Should use parseFloat(env.OPENAI_TEMPERATURE_SCORING) || 0.2
    systemPrompt,
    feature: 'ats_feedback'
  }, env);
}
```

### Environment Variable Dependencies
- `OPENAI_MODEL_FEEDBACK` (default: `'gpt-4o-mini'`)
- `OPENAI_MAX_TOKENS_ATS` (defined but not used - hardcoded `800`)
- `OPENAI_TEMPERATURE_SCORING` (defined but not used - hardcoded `0.2`)

### JSON Schema

```json
{
  "name": "ats_feedback",
  "schema": {
    "type": "object",
    "properties": {
      "atsRubric": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": { "type": "string" },
            "score": { "type": "number" },
            "max": { "type": "number" },
            "feedback": { "type": "string" },
            "suggestions": {
              "type": "array",
              "items": { "type": "string" }
            }
          }
        }
      },
      "roleSpecificFeedback": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "section": { "type": "string" },
            "score": { "type": "string" },
            "feedback": { "type": "string" },
            "examples": {
              "type": "array",
              "items": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

### Prompt Templates

**System Prompt:**
```
You are an ATS resume expert. Generate precise, actionable feedback based on rule-based scores.
Keep feedback concise (120-180 words per section). Show 2 bullet rewrites using action verbs and metrics.
```

**User Prompt Template:**
```
Resume text: {resumeText.substring(0, 4000)}

Job Title: {jobTitle}

Rule-based scores: {JSON.stringify(ruleBasedScores)}

Generate feedback for each category.
```

### Optimization Opportunities
1. **Token Reduction:**
   - Resume truncation: Use token count instead of character count (4000 chars ≈ 1000 tokens)
   - Extract relevant sections instead of truncating from start
   - Send only needed fields from `ruleBasedScores` instead of full JSON
   - More concise system prompt

2. **Structured Output:** ✅ Already implemented

3. **Model Routing:** 
   - No fallback logic
   - Could fallback to `gpt-4o-mini` if primary model fails

4. **Caching:**
   - System prompt is cacheable
   - Could cache by resume hash + job title combination

5. **Environment Variables:** Hardcoded values instead of using env vars

---

## Function 3: `generateResumeRewrite` (lines 263-293)

### Full Function Code

```javascript
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
  
  // OPTIMIZATION: System prompt is concise (~30 tokens) ✅
  // OPTIMIZATION: Could extract to constant for better caching
  const systemPrompt = `You are an expert resume writer. Regenerate resume content to meet ATS best practices.
Preserve facts, use 1-2 lines per bullet, quantify outcomes, no fluff.`;
  
  // OPTIMIZATION: Section rewrite uses full resumeText (no truncation) - could be very large
  // OPTIMIZATION: Full rewrite truncates to 6000 chars - should use token count
  // OPTIMIZATION: Could extract just the section instead of sending full resume
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
  
  // OPTIMIZATION: No structured output - returns free-form text
  // OPTIMIZATION: Should add JSON schema for consistent return format: { original: string, rewritten: string, changes: array }
  // OPTIMIZATION: maxTokens (2000) is hardcoded - should use env.OPENAI_MAX_TOKENS_REWRITE
  // OPTIMIZATION: temperature (0.2) is hardcoded - should use env.OPENAI_TEMPERATURE_REWRITE
  // OPTIMIZATION: No fallback model - if gpt-4o fails, could fallback to gpt-4o-mini
  return await callOpenAI({
    model: env.OPENAI_MODEL_REWRITE || 'gpt-4o',
    messages,
    maxTokens: 2000, // OPTIMIZATION: Should use env.OPENAI_MAX_TOKENS_REWRITE || 2000
    temperature: 0.2, // OPTIMIZATION: Should use parseFloat(env.OPENAI_TEMPERATURE_REWRITE) || 0.2
    systemPrompt,
    feature: 'resume_rewrite'
  }, env);
}
```

### Environment Variable Dependencies
- `OPENAI_MODEL_REWRITE` (default: `'gpt-4o'`)
- `OPENAI_MAX_TOKENS_REWRITE` (defined but not used - hardcoded `2000`)
- `OPENAI_TEMPERATURE_REWRITE` (defined but not used - hardcoded `0.2`)

### JSON Schema
**❌ None - Returns free-form text**

**Recommended Schema:**
```json
{
  "name": "resume_rewrite",
  "schema": {
    "type": "object",
    "properties": {
      "original": { "type": "string" },
      "rewritten": { "type": "string" },
      "changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": { "type": "string" },
            "description": { "type": "string" }
          }
        }
      }
    },
    "required": ["original", "rewritten"]
  }
}
```

### Prompt Templates

**System Prompt:**
```
You are an expert resume writer. Regenerate resume content to meet ATS best practices.
Preserve facts, use 1-2 lines per bullet, quantify outcomes, no fluff.
```

**User Prompt Template (Section Rewrite):**
```
Rewrite the {section} section of this resume for a {jobTitle} role:

{resumeText}
```

**User Prompt Template (Full Rewrite):**
```
Rewrite this resume for a {jobTitle} role:

{resumeText.substring(0, 6000)}
```

### Optimization Opportunities
1. **Token Reduction:**
   - Section rewrite: Extract only the section instead of sending full resume
   - Full rewrite: Use token count instead of character count (6000 chars ≈ 1500 tokens)
   - Could limit to specific sections (Experience, Summary, Skills) instead of full resume

2. **Structured Output:** ❌ Missing - should add JSON schema

3. **Model Routing:**
   - Uses `gpt-4o` (premium) - appropriate for quality
   - No fallback logic - could fallback to `gpt-4o-mini` on failure

4. **Caching:**
   - System prompt is cacheable
   - Could cache by resume hash + job title + section

5. **Environment Variables:** Hardcoded values instead of using env vars

---

## Helper Functions

### `estimateCost` (lines 298-319)

```javascript
/**
 * Estimate cost based on tokens
 */
function estimateCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  // Pricing as of 2024 (approximate)
  // OPTIMIZATION: Pricing could be updated to latest rates
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
```

### `hashString` (lines 324-333)

```javascript
/**
 * Hash string for caching
 */
function hashString(str) {
  // Simple hash function (for Cloudflare Workers)
  // OPTIMIZATION: Could use crypto.subtle.digest for better collision resistance
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
```

### `sleep` (lines 338-340)

```javascript
/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Summary of Optimization Priorities

### High Priority (Cost Impact)
1. **Token Reduction:**
   - Replace character-based truncation with token-based limits
   - Extract relevant sections instead of truncating from start
   - Send only needed fields from `ruleBasedScores`

2. **Structured Outputs:**
   - Add JSON schema to `generateResumeRewrite` for consistent parsing

3. **Environment Variables:**
   - Use env vars for maxTokens and temperature instead of hardcoded values

### Medium Priority (Reliability)
4. **Model Fallback:**
   - Implement fallback to cheaper model on failure
   - Fallback: `gpt-4o` → `gpt-4o-mini`

5. **Caching:**
   - Leverage OpenAI native prompt caching (>1024 tokens)
   - Improve cache key strategy

### Low Priority (Code Quality)
6. **Error Handling:**
   - Better error messages for different failure modes
   - Retry with fallback model on specific errors

7. **Code Organization:**
   - Extract prompts to constants for better caching
   - Use crypto.subtle.digest for better hash function

---

## Current Cost Estimates

### `generateATSFeedback`
- **Model:** `gpt-4o-mini`
- **Input:** ~1,050 tokens (4000 chars resume + prompt)
- **Output:** Max 800 tokens
- **Cost per call:** ~$0.0008
- **Frequency:** High (Trial/Essential/Pro users)

### `generateResumeRewrite`
- **Model:** `gpt-4o` (premium)
- **Input:** ~1,550 tokens (6000 chars resume + prompt) or unlimited (section)
- **Output:** Max 2,000 tokens
- **Cost per call:** ~$0.024
- **Frequency:** Low (Pro/Premium only)

---

**END OF ROI OPTIMIZATION INPUT**

