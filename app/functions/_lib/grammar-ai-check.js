// Grammar AI verification utility
// Minimal OpenAI check for grammar/spelling errors
// Only called when rule-based grammar score is perfect (10/10)

/**
 * Hash string for cache keys
 */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify grammar with minimal OpenAI check
 * @param {string} resumeText - Resume text to check
 * @param {Object} env - Environment variables
 * @returns {Promise<boolean>} true if errors present, false otherwise
 */
export async function verifyGrammarWithAI(resumeText, env) {
  if (!env.OPENAI_API_KEY) {
    // If no API key, assume no errors (fail gracefully)
    console.warn('[GRAMMAR-AI] OPENAI_API_KEY not configured, skipping AI check');
    return false;
  }

  // Build cache key
  const cacheKeyBase = `grammar-ai:${resumeText}`;
  const cacheHash = await hashString(cacheKeyBase);
  const cacheKey = `grammarCheck:${cacheHash}`;

  // Check KV cache first
  if (env.JOBHACKAI_KV) {
    try {
      const cached = await env.JOBHACKAI_KV.get(cacheKey);
      if (cached !== null) {
        const cachedResult = JSON.parse(cached);
        console.log('[GRAMMAR-AI] Cache hit');
        return cachedResult.errors === true;
      }
    } catch (cacheError) {
      console.warn('[GRAMMAR-AI] Cache read error (non-fatal):', cacheError);
      // Continue to API call if cache fails
    }
  }

  // Truncate resume text to control costs (keep it small)
  // ~4 chars per token, so 500 tokens ≈ 2000 chars
  const maxChars = 2000;
  const truncatedText = resumeText.length > maxChars 
    ? resumeText.substring(0, maxChars) + '...'
    : resumeText;

  const model = env.OPENAI_MODEL_GRAMMAR || 'gpt-4o-mini';
  const apiUrl = 'https://api.openai.com/v1/chat/completions';

  const systemPrompt = 'You are a grammar evaluator. Answer with JSON only.';
  const userPrompt = `Does the following text contain ANY spelling or grammar errors? Respond with: {"errors": true/false}.\n\nTEXT:\n${truncatedText}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 20,
        temperature: 0.0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'grammar_check_response',
            schema: {
              type: 'object',
              properties: {
                errors: { type: 'boolean' }
              },
              required: ['errors']
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[GRAMMAR-AI] OpenAI API error:', response.status, errorData);
      // Treat API errors as no errors (fail gracefully)
      return false;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON response
    let result;
    try {
      result = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (parseError) {
      console.error('[GRAMMAR-AI] Failed to parse JSON response:', parseError);
      // If parsing fails, treat as no errors (fail gracefully)
      return false;
    }

    // Validate structure
    const errorsPresent = result?.errors === true;

    // Cache result (24 hours)
    if (env.JOBHACKAI_KV) {
      try {
        await env.JOBHACKAI_KV.put(
          cacheKey,
          JSON.stringify({ errors: errorsPresent }),
          { expirationTtl: 86400 } // 24 hours
        );
      } catch (cacheError) {
        console.warn('[GRAMMAR-AI] Cache write error (non-fatal):', cacheError);
      }
    }

    return errorsPresent;
  } catch (error) {
    console.error('[GRAMMAR-AI] Error during grammar check:', error);
    // Treat errors as no errors (fail gracefully)
    return false;
  }
}

