# OpenAI Functions Analysis for ROI Optimization

## File Location
`app/functions/_lib/openai-client.js`

---

## Function 1: `generateATSFeedback`

### Complete Source Code

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
```

### Current Configuration

| Parameter | Value | Source |
|-----------|-------|--------|
| **Model** | `gpt-4o-mini` | `env.OPENAI_MODEL_FEEDBACK` or default |
| **Max Tokens** | `800` | Hardcoded |
| **Temperature** | `0.2` | Hardcoded |
| **Resume Text Limit** | `4000 chars` | `resumeText.substring(0, 4000)` |
| **Structured Output** | ✅ Yes | JSON schema defined |
| **System Prompt** | ~50 tokens | Concise expert prompt |
| **User Prompt** | Variable | Includes resume (4000 chars) + job title + scores |

### Dependencies

- **Imports**: Uses `callOpenAI` from same file
- **Input Processing**: Truncates resume to 4000 characters
- **Output Format**: Structured JSON schema with `atsRubric` and `roleSpecificFeedback` arrays

---

## Function 2: `generateResumeRewrite`

### Complete Source Code

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
```

### Current Configuration

| Parameter | Value | Source |
|-----------|-------|--------|
| **Model** | `gpt-4o` | `env.OPENAI_MODEL_REWRITE` or default |
| **Max Tokens** | `2000` | Hardcoded |
| **Temperature** | `0.2` | Hardcoded |
| **Resume Text Limit (full)** | `6000 chars` | `resumeText.substring(0, 6000)` |
| **Resume Text Limit (section)** | `Unlimited` | Full `resumeText` if section specified |
| **Structured Output** | ❌ No | No JSON schema - returns free-form text |
| **System Prompt** | ~30 tokens | Brief expert prompt |
| **User Prompt** | Variable | Includes full resume (6000 chars) or section + job title |

### Dependencies

- **Imports**: Uses `callOpenAI` from same file
- **Input Processing**: 
  - Full rewrite: Truncates to 6000 characters
  - Section rewrite: Uses full resume text (no truncation)
- **Output Format**: Free-form text (no structured output)

---

## Supporting Function: `callOpenAI`

### Key Implementation Details

```javascript
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
  // ... implementation ...
  
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
  
  // ... retry logic, caching, error handling ...
}
```

### Features

- ✅ Retry logic with exponential backoff (3 attempts)
- ✅ Rate limit handling (429 errors)
- ✅ KV-based caching (24-hour TTL)
- ✅ Usage tracking and cost estimation
- ✅ Structured outputs support (JSON schema)
- ⚠️ Prompt caching not fully implemented (KV fallback only)

---

## Cost Analysis (Current Configuration)

### `generateATSFeedback`
- **Model**: `gpt-4o-mini`
- **Input**: ~4,000 chars resume + ~200 chars prompt ≈ **~1,050 tokens**
- **Output**: Max 800 tokens
- **Estimated Cost**: ~$0.0008 per call
- **Frequency**: High (Trial/Essential/Pro users)

### `generateResumeRewrite`
- **Model**: `gpt-4o` (premium)
- **Input**: ~6,000 chars resume + ~100 chars prompt ≈ **~1,550 tokens**
- **Output**: Max 2,000 tokens
- **Estimated Cost**: ~$0.024 per call
- **Frequency**: Low (Pro/Premium only)

---

## Optimization Opportunities Identified

1. **Token Minimization**
   - Resume truncation could be smarter (extract relevant sections)
   - System prompts could be more concise
   - Remove redundant information from user prompts

2. **Structured Outputs**
   - `generateResumeRewrite` lacks structured output (inconsistent return types)
   - Could enforce JSON schema for better parsing

3. **Model Routing**
   - `generateATSFeedback` uses `gpt-4o-mini` ✅ (cost-effective)
   - `generateResumeRewrite` uses `gpt-4o` ✅ (quality-focused)
   - Consider fallback logic if premium model fails

4. **Error Handling**
   - Basic retry logic exists
   - Could add fallback to cheaper model on failure
   - Better error messages for different failure modes

5. **Caching**
   - KV-based caching implemented
   - Could leverage OpenAI's native prompt caching (>1024 tokens)
   - Cache key strategy could be improved

6. **Input Processing**
   - Hard character limits (4000, 6000) may cut important content
   - Could use token counting instead of character counting
   - Section extraction for rewrites could be smarter

---

## Next Steps for Arbor (AI Teammate)

1. Optimize prompts for token efficiency
2. Add structured outputs to `generateResumeRewrite`
3. Implement smarter input truncation (token-based, not char-based)
4. Add fallback model logic
5. Improve error handling and retry strategies
6. Enhance caching strategy
7. Ensure consistent return types across endpoints

