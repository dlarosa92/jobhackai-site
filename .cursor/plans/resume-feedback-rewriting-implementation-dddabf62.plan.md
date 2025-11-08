<!-- dddabf62-5d94-4111-8882-58cd0908f58a 01031c51-9d59-4e35-a85a-9e5d92edac92 -->
# Resume Feedback & Resume Rewriting - Production Implementation Plan

## Overview

Transform `resume-feedback-pro.html` from mockup to production-ready by implementing:

1. **ATS Resume Scoring** - **Rule-based numeric scoring** (no AI tokens) + AI for narrative feedback only
2. **Resume Feedback** - AI-powered section-by-section feedback (uses extracted text + rule-based scores)
3. **Resume Rewriting** - AI-powered resume optimization (Pro/Premium only)

**Cost Strategy**: Score with rules (cheaper, faster, defensible). Use AI only for narrative feedback and rewrites.

## Branch Strategy

- Create new branch: `feature/resume-feedback-rewrite-ai` from current branch (`dev0`)
- Make all changes on this branch
- Create pull request after implementation

## Architecture Overview

### Backend API Endpoints (Cloudflare Workers)

1. `/api/resume-upload` - PDF/DOCX upload, text extraction, validation
2. `/api/ats-score` - ATS scoring with structured outputs (gpt-4o-mini)
3. `/api/resume-feedback` - Detailed feedback generation (gpt-4o-mini)
4. `/api/resume-rewrite` - Resume rewriting (gpt-4o, Pro/Premium only)

### Frontend Updates

- `resume-feedback-pro.html` - Wire up real API calls, remove mocks
- Update UI text to match current subscription model
- Fix outdated "Perfect! You have everything" messaging

## Implementation Steps

### Phase 1: Backend Infrastructure

#### 1.1 Create PDF Text Extraction Utility with OCR

**File**: `app/functions/_lib/resume-extractor.js`

- **File Type Detection**:
  - Detect MIME type and file extension
  - Support: `.pdf`, `.docx`, `.txt`
  - Reject: `.png`, `.jpg`, `.jpeg` (direct images, not PDFs)

- **Text-Based PDF Processing**:
  - Use `pdf-parse` for PDFs with selectable text
  - Detect if PDF has no selectable text (image-based PDF)
  - If image-based PDF detected → proceed to OCR pipeline

- **OCR Processing (Tesseract)**:
  - **Cost**: $0 (open-source, runs locally)
  - **Accuracy**: ~90-95% on clean text-based images
  - **Implementation**:
    - Use `tesseract.js` for Node.js/Cloudflare Workers
    - Convert PDF pages to images (if needed)
    - Run OCR on each page
    - Combine extracted text from all pages
  - **Edge Case**: If OCR output < 500 chars, return error: "Unreadable scan detected. Please upload a higher-quality file or use our DOCX template."

- **DOCX Processing**:
  - Use `mammoth` library to extract text
  - Preserve basic formatting structure

- **Text Cleanup**:
  - Remove excessive line breaks
  - Fix encoding issues
  - Normalize whitespace
  - Detect multi-column layouts (flag for formatting penalty)

- **Validation**:
  - File size < 2MB (hard cap for cost control)
  - Text length < 80k chars (reject if exceeded)
  - Validate MIME type matches extension

- **Return**: `{ text: string, wordCount: number, fileType: string, hasText: boolean, isMultiColumn: boolean, ocrUsed: boolean }`

- **Error Messages**:
  - Image-only PDF: "Please upload a text-based résumé. Download our DOCX template."
  - File too large: "File exceeds 2MB limit. Please compress or use a smaller file."
  - Unreadable OCR: "Unreadable scan detected. Please upload a higher-quality file."

#### 1.2 Create ATS Scoring Engine (Rule-Based Layer)

**File**: `app/functions/_lib/ats-scoring-engine.js`

- Implement hybrid scoring per rubric:
  - Keyword Relevance (40 pts): Count job-relevant keywords
  - Formatting Compliance (20 pts): Detect tables/graphics, validate headings
  - Structure & Completeness (15 pts): Check section order, date formatting
  - Tone & Clarity (15 pts): Sentence length, action verb density
  - Grammar & Spelling (10 pts): Basic spell check
- Return structured score breakdown

#### 1.3 Create OpenAI Client Utility

**File**: `app/functions/_lib/openai-client.js`

- Centralized OpenAI API client
- Handle rate limiting (exponential backoff on 429)
- Implement prompt caching for ATS rubric system prompt
- Structured outputs support
- Cost tracking (log tokens, estimate costs)
- Moderation API integration for user inputs

### Phase 2: API Endpoints

#### 2.1 Resume Upload Endpoint

**File**: `app/functions/api/resume-upload.js`

- Accept: POST with FormData (PDF/DOCX file)
- Auth: Firebase JWT token required
- Process:

  1. Verify authentication
  2. Validate file (type, size)
  3. Extract text using resume-extractor
  4. Store extracted text in KV (key: `resume:${uid}:${timestamp}`)
  5. Return: `{ success: true, resumeId, textPreview, wordCount }`

- CORS: Support dev/qa/prod origins

#### 2.2 ATS Score Endpoint

**File**: `app/functions/api/ats-score.js`

- Accept: POST `{ resumeId, jobTitle }` (jobTitle required for role-specific scoring)
- Auth: Firebase JWT required
- Plan Check: Free (1/month), Trial (unlimited with throttle), Essential/Pro/Premium (unlimited with cache)
- Process:

  1. Verify auth + plan access
  2. **Throttle Check** (Trial only):

     - Check last run timestamp in KV: `atsThrottle:${uid}`
     - If < 30 seconds since last run, return 429 with retry-after header

  1. **Cache Check** (all plans):

     - Generate hash: `SHA256(resumeId + jobTitle + settings)`
     - Check KV: `atsCache:${hash}`
     - If cached (within 24h), return cached result (skip AI call)

  1. **Usage Limits** (Free only):

     - Check usage in KV: `atsUsage:${uid}:${YYYY-MM}`
     - If >= 1, return 403 with upgrade message

  1. Retrieve resume text from KV
  2. **Cost Guardrails**:

     - Validate text length < 80k chars (reject if exceeded)
     - Check file size was < 2MB (stored in resume metadata)

  1. Run rule-based scoring engine
  2. Call OpenAI (gpt-4o-mini) with structured outputs for refinement
  3. Combine rule-based + AI scores
  4. **Cache Result**: Store in KV `atsCache:${hash}` with 24h TTL
  5. **Update Throttle**: Store timestamp in `atsThrottle:${uid}` (Trial only)
  6. **Track Usage**: Increment `atsUsage:${uid}:${YYYY-MM}` (Free only)
  7. Return: `{ score: 89, breakdown: {...}, recommendations: [...] }`

- Structured Output Schema:
```json
{
  "keywordScore": { "score": 34, "max": 40, "feedback": "..." },
  "formattingScore": { "score": 24, "max": 25, "feedback": "..." },
  "structureScore": { "score": 19, "max": 20, "feedback": "..." },
  "toneScore": { "score": 9, "max": 15, "feedback": "..." },
  "grammarScore": { "score": 7, "max": 10, "feedback": "..." },
  "overallScore": 89,
  "recommendations": ["...", "..."]
}
```


#### 2.3 Resume Feedback Endpoint

**File**: `app/functions/api/resume-feedback.js`

- Accept: POST `{ resumeId, jobTitle }` (jobTitle required)
- Auth: Firebase JWT required
- Plan Check: Trial (unlimited with throttles), Essential (3/month), Pro/Premium (unlimited)
- Process:

  1. Verify auth + plan access
  2. **Throttle Check** (Trial only):

     - Check last run timestamp: `feedbackThrottle:${uid}`
     - If < 60 seconds since last run, return 429 with retry-after
     - Check daily count: `feedbackDaily:${uid}:${YYYY-MM-DD}`
     - If >= 5 today, return 429: "Daily limit reached (5/day). Upgrade to Pro for unlimited feedback."

  1. **Per-Doc Cap Check** (Trial only):

     - Check per-doc passes: `feedbackDocPasses:${uid}:${resumeId}`
     - If >= 3 passes for this resume, return 403: "You've reached the limit for this resume (3 passes). Upgrade to Pro for unlimited passes."

  1. **Usage Limits** (Essential only):

     - Check monthly usage: `feedbackUsage:${uid}:${YYYY-MM}`
     - If >= 3 this month, return 403: "You've used all 3 feedbacks this month. Upgrade to Pro for unlimited feedback."

  1. **Cache Check** (all plans):

     - Generate hash: `SHA256(resumeId + jobTitle + 'feedback')`
     - Check KV: `feedbackCache:${hash}`
     - If cached (within 24h), return cached result

  1. Retrieve resume text from KV
  2. **Cost Guardrails**:

     - Validate text length < 80k chars
     - Check file size < 2MB

  1. **[OPENAI INTEGRATION POINT]** Call OpenAI (gpt-4o-mini) for section-by-section feedback

     - TODO: Implement OpenAI API call here
     - Use structured outputs for consistent response format
     - Generate 5 ATS rubric categories + 5 role-specific feedback sections

  1. **Cache Result**: Store in KV `feedbackCache:${hash}` with 24h TTL
  2. **Update Throttles**:

     - Update `feedbackThrottle:${uid}` timestamp (Trial only)
     - Increment `feedbackDaily:${uid}:${YYYY-MM-DD}` (Trial only)
     - Increment `feedbackDocPasses:${uid}:${resumeId}` (Trial only)
     - Increment `feedbackUsage:${uid}:${YYYY-MM}` (Essential only)

  1. Return: `{ atsRubric: [...], roleSpecificFeedback: [...] }`

- Response matches UI structure (5 ATS categories + 5 role-specific sections)

#### 2.4 Resume Rewrite Endpoint

**File**: `app/functions/api/resume-rewrite.js`

- Accept: POST `{ resumeId, section?, jobTitle? }`
- Auth: Firebase JWT required
- Plan Check: Pro/Premium only (lock others)
- Process:

  1. Verify auth + plan (must be Pro/Premium)
  2. Retrieve resume text
  3. Call OpenAI (gpt-4o) for rewrite
  4. Return: `{ original: "...", rewritten: "..." }`

- Use gpt-4o for higher quality

### Phase 3: Frontend Integration

#### 3.1 Update resume-feedback-pro.html

**Changes**:

1. Replace `simulateAtsScoring()` with real API call to `/api/resume-upload` → `/api/ats-score`
2. Replace `simulateRewrite()` with real API call to `/api/resume-rewrite`
3. Add loading states (disable buttons, show spinners)
4. Add error handling (display user-friendly messages)
5. Update text:

   - Remove "Perfect! You have everything" from Pro plan banner
   - Update "Upgrade to Pro to unlock..." to match current model
   - Fix conflicting subscription messages

#### 3.2 API Client Functions

**Add to resume-feedback-pro.html script section**:

- `async function uploadResume(file)` - Handle file upload
- `async function getAtsScore(resumeId, jobTitle)` - Fetch ATS score
- `async function getResumeFeedback(resumeId, jobTitle)` - Fetch feedback
- `async function rewriteResume(resumeId, section, jobTitle)` - Fetch rewrite
- `function handleApiError(error)` - Centralized error handling
- Update `updateProgressRing()`, `updateRubricGrid()`, `updateFeedbackGrid()` to use real data

#### 3.3 Usage Tracking UI

- Display usage meters based on plan:
  - Free: "1 ATS score remaining this month"
  - Trial: "3 feedbacks remaining in trial"
  - Essential: "3 feedbacks remaining this month"
- Fetch usage from `/api/usage` endpoint (may need enhancement)

### Phase 4: Environment Configuration

#### 4.1 Cloudflare Pages Environment Variables

**Required Secrets** (set in Cloudflare Dashboard):

- `OPENAI_API_KEY` - OpenAI API key
- `OPENAI_MODEL_ATS` - Default: `gpt-4o-mini`
- `OPENAI_MODEL_REWRITE` - Default: `gpt-4o`
- `OPENAI_MODEL_FEEDBACK` - Default: `gpt-4o-mini`

**Optional Vars** (can be in wrangler.toml):

- `OPENAI_MAX_TOKENS_ATS` - Default: 800
- `OPENAI_MAX_TOKENS_REWRITE` - Default: 2000
- `OPENAI_TEMPERATURE_SCORING` - Default: 0.2
- `OPENAI_TEMPERATURE_REWRITE` - Default: 0.2

### Phase 5: Testing & Cleanup

#### 5.1 Remove Dead Code

- Remove all `simulate*()` functions
- Clean up commented-out mock code
- Remove unused event listeners

#### 5.2 Error Handling

- Handle API failures gracefully
- Show retry options for transient errors
- Display plan upgrade prompts for locked features

#### 5.3 UX Improvements

- Add job title input field (optional, for role-specific feedback)
- Improve loading states (skeleton screens)
- Add success animations (score updates, copy confirmation)

## File Changes Summary

### New Files

- `app/functions/_lib/resume-extractor.js`
- `app/functions/_lib/ats-scoring-engine.js`
- `app/functions/_lib/openai-client.js`
- `app/functions/api/resume-upload.js`
- `app/functions/api/ats-score.js`
- `app/functions/api/resume-feedback.js`
- `app/functions/api/resume-rewrite.js`

### Modified Files

- `resume-feedback-pro.html` - Wire up real APIs, fix text, remove mocks
- `app/functions/api/usage.js` - Enhance to track resume feedback usage
- `package.json` - Add dependencies: `pdf-parse`, `mammoth`, `openai`

## Dependencies to Add

```json
{
  "pdf-parse": "^1.1.1",
  "mammoth": "^1.6.0",
  "openai": "^4.20.0"
}
```

## Subscription Gating Logic

| Plan | ATS Scoring | Feedback | Rewriting |

|------|-------------|----------|-----------|

| Free | 1/Lifetime | Locked | Locked |

| Trial | Unlimited | 3 total | Locked |

| Essential | Unlimited | 3/month | Locked |

| Pro | Unlimited | Unlimited | Unlimited |

| Premium | Unlimited | Unlimited | Unlimited |

## ATS Scoring Rubric (Gold Standard)

- **Keyword Relevance**: 40 pts (job title + skill keywords)
- **Formatting Compliance**: 20 pts (no tables/graphics, standard headings)
- **Structure & Completeness**: 15 pts (section order, dates, completeness)
- **Tone & Clarity**: 15 pts (action verbs, concise bullets)
- **Grammar & Spelling**: 10 pts (no errors)

**Total**: 100 points

## Notes

- **OpenAI API Key**: Must be set in Cloudflare Pages Dashboard as secret before deployment
- Use Structured Outputs for all scoring endpoints to ensure consistent JSON responses
- Implement prompt caching for the ATS rubric system prompt (saves ~50% on input tokens)
- Track usage server-side in KV to prevent client-side manipulation (atomic increments)
- All endpoints must verify Firebase JWT tokens (use existing `verifyFirebaseIdToken` utility)
- Support CORS for dev.jobhackai.io, qa.jobhackai.io, app.jobhackai.io
- Log all OpenAI API calls with token counts for cost monitoring
- Job title is required for role-specific feedback (validate/clean user input)
- PDF extraction must handle both text-based and image-based PDFs (error gracefully for images)
- Usage limits reset monthly for Essential plan (track by YYYY-MM key in KV)
- Trial usage is lifetime total (track by `:trial` suffix in KV)