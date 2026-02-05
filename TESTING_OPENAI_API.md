# OpenAI API Validation Tests

## Quick Test (No Auth Required)

Test the OpenAI integration endpoint:

```bash
curl https://dev.jobhackai.io/api/test-openai
```

**Expected Response:**
```json
{
  "success": true,
  "message": "OpenAI integration test successful",
  "config": {
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "maxTokens": 800,
    "apiKeyConfigured": true
  },
  "response": {
    "score": 90,
    "section_breakdown": {...},
    "test_status": "success"
  },
  "usage": {
    "promptTokens": 230,
    "completionTokens": 63,
    "totalTokens": 293,
    "cachedTokens": 0
  },
  "model": "gpt-4o-mini-2024-07-18",
  "finishReason": "stop"
}
```

## Full Endpoint Tests (Requires Authentication)

### Step 1: Get Firebase JWT Token

1. Login to https://dev.jobhackai.io
2. Open browser console (F12)
3. Run:
```javascript
window.FirebaseAuthManager.getCurrentUser().getIdToken().then(token => console.log(token))
```
4. Copy the token

### Step 2: Upload Resume

```bash
curl -X POST https://dev.jobhackai.io/api/resume-upload \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -F 'file=@resume.pdf'
```

**Response:**
```json
{
  "success": true,
  "resumeId": "abc123...",
  "textPreview": "...",
  "wordCount": 450
}
```

Save the `resumeId` for next steps.

### Step 3: Test Resume Feedback

```bash
curl -X POST https://dev.jobhackai.io/api/resume-feedback \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "resumeId": "YOUR_RESUME_ID",
    "jobTitle": "Data Engineer"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "atsRubric": [
    {
      "category": "Keyword Match",
      "score": 35,
      "max": 40,
      "feedback": "...",
      "suggestions": [...]
    },
    ...
  ],
  "roleSpecificFeedback": [
    {
      "section": "Professional Summary",
      "score": "7/10",
      "feedback": "...",
      "examples": [...]
    },
    ...
  ]
}
```

### Step 4: Test Resume Rewrite (Pro/Premium Only)

```bash
curl -X POST https://dev.jobhackai.io/api/resume-rewrite \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "resumeId": "YOUR_RESUME_ID",
    "section": "Experience",
    "jobTitle": "Data Engineer"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "original": "Original section text...",
  "rewritten": "Rewritten section text...",
  "changes": [
    {
      "type": "improvement",
      "description": "Added quantifiable metrics"
    },
    ...
  ]
}
```

## Running Test Scripts

### Automated Test Script

```bash
./test-openai-endpoints.sh
```

This script:
- Tests the `/api/test-openai` endpoint (no auth required)
- Validates response structure
- Provides instructions for authenticated endpoints

### Direct Function Tests

```bash
node test-openai-direct.js
```

This script validates:
- Token truncation logic
- Function input/output structures
- Expected response formats

## Validation Checklist

- [ ] `/api/test-openai` returns 200 with valid JSON
- [ ] Response contains `success: true`
- [ ] Response contains `usage` object with token counts
- [ ] Response contains `model` field
- [ ] Resume upload works and returns `resumeId`
- [ ] Resume feedback returns structured JSON with `atsRubric` and `roleSpecificFeedback`
- [ ] Resume rewrite returns structured JSON with `original`, `rewritten`, and `changes`
- [ ] Token usage is logged correctly
- [ ] Cost estimation works (check logs)

## Notes

- Endpoints use `resumeId` (from upload), not `resumeText` directly
- Resumes are stored in KV after upload for security and caching
- Resume feedback requires Trial/Essential/Pro/Premium plan
- Resume rewrite requires Pro/Premium plan only
- All endpoints require Firebase JWT authentication

## Troubleshooting

**401 Unauthorized:**
- Check that your token is valid and not expired
- Ensure token is prefixed with "Bearer "

**403 Forbidden:**
- Check your subscription plan
- Resume rewrite requires Pro/Premium

**404 Not Found:**
- Verify resumeId is correct
- Ensure resume was uploaded successfully

**500 Internal Server Error:**
- Check Cloudflare logs for details
- Verify OpenAI API key is configured
- Check that environment variables are set

