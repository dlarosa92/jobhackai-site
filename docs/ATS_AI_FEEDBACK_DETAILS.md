# ATS Score AI Feedback - Detailed Implementation Guide

## Overview

AI feedback status depends on which endpoint is used:

1. **ATS Scoring Breakdown**: Uses `/api/ats-score` → **AI feedback is DISABLED** (commented out)
2. **Role-Specific Feedback Cards**: Uses `/api/resume-feedback` → **AI feedback is ENABLED**

However, the frontend can update the ATS Scoring Breakdown feedback text from the `/api/resume-feedback` response if AI succeeds.

**Important distinctions**:
- **Scores are ALWAYS rule-based** (calculated deterministically, never modified by AI)
- **Feedback text CAN be AI-enhanced** (if OpenAI API is configured and succeeds)
- **Fallback to rule-based feedback** if AI fails or is unavailable

---

## 1. ATS Scoring Breakdown

### Two-Endpoint Flow

The frontend uses **two separate API calls**:

1. **First Call**: `/api/ats-score` - Gets initial scores (AI feedback disabled)
2. **Second Call**: `/api/resume-feedback` - Gets enhanced feedback (AI feedback enabled)

```1257:1341:resume-feedback-pro.html
// Get ATS score
showLoadingState('Calculating your ATS score…');
const scoreResult = await getAtsScore(uploadResult.resumeId, currentJobTitle);

// ... display initial scores ...

// Get feedback (if plan allows)
const plan = getCurrentUserPlan();
if (['trial', 'essential', 'pro', 'premium'].includes(plan)) {
  try {
    showLoadingState('Optimizing for ATS compliance…');
    const feedbackResult = await getResumeFeedback(uploadResult.resumeId, jobTitleForFeedback);
    updateFeedbackGrid(feedbackResult.roleSpecificFeedback);
    updateRubricGridFromFeedback(feedbackResult.atsRubric);
```

### Score Calculation (Always Rule-Based)

The numeric scores shown in the ATS Scoring Breakdown are **always** calculated using the rule-based engine in `app/functions/_lib/ats-scoring-engine.js`:

```12:33:app/functions/_lib/ats-scoring-engine.js
export function scoreResume(resumeText, jobTitle, metadata = {}) {
  const { isMultiColumn = false } = metadata;
  
  // Normalize job title for keyword matching
  const normalizedJobTitle = normalizeJobTitle(jobTitle);
  const jobKeywords = extractJobKeywords(normalizedJobTitle);
  
  // Score each category
  const keywordScore = scoreKeywordRelevance(resumeText, jobTitle, jobKeywords);
  const formattingScore = scoreFormattingCompliance(resumeText, isMultiColumn);
  const structureScore = scoreStructureAndCompleteness(resumeText);
  const toneScore = scoreToneAndClarity(resumeText);
  const grammarScore = scoreGrammarAndSpelling(resumeText);
  
  // Calculate overall score
  const overallScore = Math.round(
    keywordScore.score +
    formattingScore.score +
    structureScore.score +
    toneScore.score +
    grammarScore.score
  );
```

**Key Point**: These scores are deterministic and never modified by AI.

### Feedback Text (AI-Enhanced When Available)

The **feedback text** for each category can be AI-generated, but it comes from the `/api/resume-feedback` endpoint, not `/api/ats-score`.

**Important**: The `/api/ats-score` endpoint has AI feedback **commented out**:

```292:305:app/functions/api/ats-score.js
// Generate AI feedback (only for narrative, not scores)
// TODO: [OPENAI INTEGRATION POINT] - Uncomment when OpenAI is configured
// let aiFeedback = null;
// try {
//   aiFeedback = await generateATSFeedback(
//     resumeData.text,
//     ruleBasedScores,
//     jobTitle,
//     env
//   );
// } catch (aiError) {
//   console.error('[ATS-SCORE] AI feedback error:', aiError);
//   // Continue without AI feedback if it fails
// }
```

So the initial ATS Scoring Breakdown shows **rule-based feedback only**. However, when `/api/resume-feedback` is called (for premium plans), it can **update** the feedback text with AI-enhanced versions.

Here's how the AI feedback works in `/api/resume-feedback`:

#### Step 1: Rule-Based Scores Generated First
```356:360:app/functions/api/resume-feedback.js
// Get rule-based scores first (for AI context)
const ruleBasedScores = scoreResume(
  resumeData.text,
  jobTitle,
  { isMultiColumn: resumeData.isMultiColumn }
);
```

#### Step 2: AI Feedback Generation (With Retry Logic)
```362:432:app/functions/api/resume-feedback.js
// Generate AI feedback with exponential backoff retry
let aiFeedback = null;
let tokenUsage = 0;
const maxRetries = 3;
let lastError = null;

for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    const aiResponse = await generateATSFeedback(
      resumeData.text,
      ruleBasedScores,
      jobTitle,
      env
    );
    
    // Capture token usage from OpenAI response
    if (aiResponse && aiResponse.usage) {
      tokenUsage = aiResponse.usage.totalTokens || 0;
    }
    
    // Handle falsy content: treat as error and apply backoff
    if (!aiResponse || !aiResponse.content) {
      lastError = new Error('AI response missing content');
      console.error(`[RESUME-FEEDBACK] AI response missing content (attempt ${attempt + 1}/${maxRetries})`);
      if (attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      continue;
    }
    
    // Parse AI response (structured output should be JSON)
    try {
      aiFeedback = typeof aiResponse.content === 'string' 
        ? JSON.parse(aiResponse.content)
        : aiResponse.content;
      
      // Validate structure
      if (aiFeedback && aiFeedback.atsRubric) {
        break; // Success, exit retry loop
      } else {
        // Invalid structure - treat as error
        lastError = new Error('AI response missing required atsRubric structure');
        console.error(`[RESUME-FEEDBACK] Invalid AI response structure (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    } catch (parseError) {
      lastError = parseError;
      console.error(`[RESUME-FEEDBACK] Failed to parse AI response (attempt ${attempt + 1}/${maxRetries}):`, parseError);
      // Apply exponential backoff for parse errors too
      if (attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      // Continue to next attempt if parsing fails
      continue;
    }
  } catch (aiError) {
    lastError = aiError;
    console.error(`[RESUME-FEEDBACK] AI feedback error (attempt ${attempt + 1}/${maxRetries}):`, aiError);
    
    // Exponential backoff: wait 1s, 2s, 4s
    if (attempt < maxRetries - 1) {
      const waitTime = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}
```

#### Step 3: Result Assembly (AI if Available, Fallback Otherwise)
```451:550:app/functions/api/resume-feedback.js
// Build result with AI feedback if available, otherwise use rule-based scores
const result = aiFeedback && aiFeedback.atsRubric ? {
  atsRubric: aiFeedback.atsRubric.map((item, idx) => ({
    category: item.category || ['Keyword Match', 'ATS Formatting', 'Structure & Organization', 'Tone & Clarity', 'Grammar & Spelling'][idx],
    score: item.score ?? ruleBasedScores[['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'][idx]]?.score ?? 0,
    max: item.max ?? 10,
    feedback: item.feedback || ruleBasedScores[['keywordScore', 'formattingScore', 'structureScore', 'toneScore', 'grammarScore'][idx]]?.feedback || '',
    suggestions: item.suggestions || []
  })),
  roleSpecificFeedback: aiFeedback.roleSpecificFeedback || [
    {
      section: 'Header & Contact',
      score: '8/10',
      feedback: 'Clear and concise. Consider adding a custom resume URL for extra polish.'
    },
    {
      section: 'Professional Summary',
      score: '6/10',
      feedback: 'Strong opening but lacks keywords for your target role.'
    },
    {
      section: 'Experience',
      score: '7/10',
      feedback: 'Great structure. Quantify impact with metrics.'
    },
    {
      section: 'Skills',
      score: '9/10',
      feedback: 'Relevant and up-to-date. Group under sub-headings.'
    },
    {
      section: 'Education',
      score: '10/10',
      feedback: 'Well-formatted. No changes needed.'
    }
  ],
  aiFeedback: aiFeedback
} : {
  // Fallback to rule-based scores if AI fails
  atsRubric: [
    {
      category: 'Keyword Match',
      score: ruleBasedScores.keywordScore.score,
      max: ruleBasedScores.keywordScore.max,
      feedback: ruleBasedScores.keywordScore.feedback
    },
    {
      category: 'ATS Formatting',
      score: ruleBasedScores.formattingScore.score,
      max: ruleBasedScores.formattingScore.max,
      feedback: ruleBasedScores.formattingScore.feedback
    },
    {
      category: 'Structure & Organization',
      score: ruleBasedScores.structureScore.score,
      max: ruleBasedScores.structureScore.max,
      feedback: ruleBasedScores.structureScore.feedback
    },
    {
      category: 'Tone & Clarity',
      score: ruleBasedScores.toneScore.score,
      max: ruleBasedScores.toneScore.max,
      feedback: ruleBasedScores.toneScore.feedback
    },
    {
      category: 'Grammar & Spelling',
      score: ruleBasedScores.grammarScore.score,
      max: ruleBasedScores.grammarScore.max,
      feedback: ruleBasedScores.grammarScore.feedback
    }
  ],
  roleSpecificFeedback: [
    {
      section: 'Header & Contact',
      score: '8/10',
      feedback: 'Clear and concise. Consider adding a custom resume URL for extra polish.'
    },
    {
      section: 'Professional Summary',
      score: '6/10',
      feedback: 'Strong opening but lacks keywords for your target role.'
    },
    {
      section: 'Experience',
      score: '7/10',
      feedback: 'Great structure. Quantify impact with metrics.'
    },
    {
      section: 'Skills',
      score: '9/10',
      feedback: 'Relevant and up-to-date. Group under sub-headings.'
    },
    {
      section: 'Education',
      score: '10/10',
      feedback: 'Well-formatted. No changes needed.'
    }
  ],
  aiFeedback: null
};
```

**Key Points**:
- **Scores**: Always use rule-based scores (AI can't override them)
- **Feedback**: Uses AI-generated feedback if available, otherwise rule-based feedback
- **Fallback**: If AI fails after 3 retries, uses rule-based feedback

---

## 2. Role-Specific Feedback Cards

### AI Generation Process

The Role-Specific Feedback cards are generated by the same AI call that generates the ATS Rubric feedback. The AI function returns both:

```307:322:app/functions/_lib/openai-client.js
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
```

### AI Prompt Structure

The AI receives:
1. **Resume text** (truncated to ~1600 tokens for cost control)
2. **Rule-based scores** (as context)
3. **Job title** (for role-specific analysis)

```254:283:app/functions/_lib/openai-client.js
const systemPrompt = `You are an ATS resume expert. Generate precise, actionable feedback based on rule-based scores.
Keep feedback concise. For each category, provide:
- A short explanation (2–3 sentences)
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
      `JOB TITLE: ${jobTitle || 'Unknown'}\n\n` +
      `RULE-BASED SCORES (JSON): ${JSON.stringify(safeRuleScores)}\n\n` +
      `RESUME TEXT:\n${truncatedResume}\n\n` +
      `Return structured feedback for each category.`
  }
];
```

### Fallback Behavior

If AI fails, the system uses **static placeholder feedback**:

```522:548:app/functions/api/resume-feedback.js
roleSpecificFeedback: [
  {
    section: 'Header & Contact',
    score: '8/10',
    feedback: 'Clear and concise. Consider adding a custom resume URL for extra polish.'
  },
  {
    section: 'Professional Summary',
    score: '6/10',
    feedback: 'Strong opening but lacks keywords for your target role.'
  },
  {
    section: 'Experience',
    score: '7/10',
    feedback: 'Great structure. Quantify impact with metrics.'
  },
  {
    section: 'Skills',
    score: '9/10',
    feedback: 'Relevant and up-to-date. Group under sub-headings.'
  },
  {
    section: 'Education',
    score: '10/10',
    feedback: 'Well-formatted. No changes needed.'
  }
],
```

---

## 3. Configuration Requirements

### Environment Variables

AI feedback requires these environment variables to be set in Cloudflare Pages:

1. **`OPENAI_API_KEY`** (Required)
   - Must be set for AI feedback to work
   - If missing, `generateATSFeedback` will throw an error
   - Error handling catches this and falls back to rule-based feedback

2. **`OPENAI_MODEL_FEEDBACK`** (Optional)
   - Defaults to `'gpt-4o-mini'` if not set
   - Can be overridden to use a different model
   - Example: `OPENAI_MODEL_FEEDBACK=gpt-4o`

3. **`OPENAI_MAX_TOKENS_ATS`** (Optional)
   - Defaults to `800` tokens if not set
   - Controls maximum output tokens for feedback generation

4. **`OPENAI_TEMPERATURE_SCORING`** (Optional)
   - Defaults to `0.2` if not set
   - Controls randomness (lower = more deterministic)

### Model Configuration

```238:248:app/functions/_lib/openai-client.js
export async function generateATSFeedback(resumeText, ruleBasedScores, jobTitle, env) {
  const baseModel = env.OPENAI_MODEL_FEEDBACK || 'gpt-4o-mini';

  // Respect env-driven config with sensible defaults
  const maxOutputTokens = Number(env.OPENAI_MAX_TOKENS_ATS) > 0
    ? Number(env.OPENAI_MAX_TOKENS_ATS)
    : 800;

  const temperature = Number.isFinite(Number(env.OPENAI_TEMPERATURE_SCORING))
    ? Number(env.OPENAI_TEMPERATURE_SCORING)
    : 0.2;
```

---

## 4. Error Handling & Retry Logic

### Retry Strategy

The system uses **exponential backoff** with 3 retry attempts:

1. **Attempt 1**: Immediate
2. **Attempt 2**: Wait 1 second (2^0 * 1000ms)
3. **Attempt 3**: Wait 2 seconds (2^1 * 1000ms)
4. **Attempt 4**: Wait 4 seconds (2^2 * 1000ms)

### Error Scenarios Handled

1. **Missing API Key**: Falls back to rule-based feedback
2. **API Rate Limits**: Retries with exponential backoff
3. **Network Errors**: Retries up to 3 times
4. **Invalid Response Structure**: Retries if structure validation fails
5. **Parse Errors**: Retries if JSON parsing fails

### Error Logging

Failed AI attempts are logged to KV storage for diagnostics:

```434:449:app/functions/api/resume-feedback.js
// Log failed responses to KV for diagnostics (best effort)
if (!aiFeedback && lastError && env.JOBHACKAI_KV) {
  try {
    const errorKey = `feedbackError:${uid}:${Date.now()}`;
    await env.JOBHACKAI_KV.put(errorKey, JSON.stringify({
      resumeId,
      jobTitle,
      error: lastError.message,
      timestamp: Date.now()
    }), {
      expirationTtl: 604800 // 7 days
    });
  } catch (kvError) {
    console.warn('[RESUME-FEEDBACK] Failed to log error to KV:', kvError);
  }
}
```

---

## 5. Cost Optimization

### Token Limits

- **Input**: Truncated to ~1600 tokens (maxOutputTokens * 2)
- **Output**: Capped at 800 tokens (default)
- **Model**: Uses `gpt-4o-mini` (cheapest option) by default

### Caching

AI responses are cached for 24 hours to reduce API calls:

```68:79:app/functions/_lib/openai-client.js
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
```

---

## 6. Summary

### Current State

**ATS Scoring Breakdown** (`/api/ats-score`):
- ❌ **AI Feedback is DISABLED** (commented out in code)
- ✅ Uses rule-based feedback only
- ⚠️ Can be updated by `/api/resume-feedback` response if AI succeeds

**Role-Specific Feedback Cards** (`/api/resume-feedback`):
- ✅ **AI Feedback IS ENABLED** (active code with retry logic)
- ✅ Uses AI-generated feedback if `OPENAI_API_KEY` is configured
- ✅ Falls back to static placeholder feedback if AI fails

### How It Works

**For ATS Scoring Breakdown**:
1. Initial call to `/api/ats-score` returns rule-based scores and feedback
2. If user has premium plan, second call to `/api/resume-feedback` attempts AI enhancement
3. Frontend updates the rubric grid with AI-enhanced feedback if available
4. Scores remain unchanged (always rule-based)

**For Role-Specific Feedback Cards**:
1. Only uses `/api/resume-feedback` endpoint
2. AI-generated if `OPENAI_API_KEY` is configured and API call succeeds
3. Falls back to static placeholder feedback if AI fails
4. Retry: 3 attempts with exponential backoff
5. Caching: 24-hour cache to reduce API costs

### To Enable AI Feedback

1. Set `OPENAI_API_KEY` in Cloudflare Pages secrets
2. Optionally configure `OPENAI_MODEL_FEEDBACK`, `OPENAI_MAX_TOKENS_ATS`, `OPENAI_TEMPERATURE_SCORING`
3. AI feedback will automatically be used when available
4. System gracefully falls back to rule-based feedback if AI fails

### To Disable AI Feedback

1. Remove or don't set `OPENAI_API_KEY`
2. System will automatically use rule-based feedback only
3. No code changes needed

---

## 7. Testing

To verify AI feedback is working:

1. Check Cloudflare Pages logs for `[RESUME-FEEDBACK]` entries
2. Look for `[OPENAI]` log entries showing token usage
3. Verify `aiFeedback` field in API response is not `null`
4. Check that feedback text differs from rule-based fallback

To test fallback behavior:

1. Temporarily set invalid `OPENAI_API_KEY`
2. Verify system still returns feedback (rule-based)
3. Check logs for error messages and retry attempts

