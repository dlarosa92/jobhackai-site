# JobHackAI ATS Resume Scoring Worker

Edge-based resume scoring Cloudflare Worker with Tesseract OCR and pdf-parse support.

## Overview

This standalone Cloudflare Worker provides ATS (Applicant Tracking System) resume scoring at the edge, with zero backend server requirements. It processes resume uploads, extracts text using OCR when needed, and computes rule-based ATS scores.

## Features

- ⚡ **Edge Performance**: Runs at Cloudflare's edge, close to users
- 💸 **Zero Cost for MVP**: Free tier provides ~100,000 requests/day
- 🔒 **Privacy-Safe**: Files processed in-memory, no storage
- 🧠 **Flexible**: Ready for OpenAI integration for Pro-tier AI feedback
- 📄 **Multi-Format Support**: PDF (text-based and image-based), TXT
- 🔍 **OCR Fallback**: Automatic OCR for image-based PDFs using Tesseract.js

## Scoring Categories

| Category | Weight | Description |
|----------|--------|-------------|
| Keyword Relevance | 40% | Skills & job title alignment |
| Formatting Compliance | 20% | Layout, headings, parser readability |
| Structure & Completeness | 15% | Education, Experience, Skills sections |
| Tone & Clarity | 15% | Action-oriented, concise writing |
| Grammar & Spelling | 10% | Typos and tense correctness |

## Installation

1. Install dependencies:
```bash
cd app
npm install tesseract.js pdf-parse
```

2. Deploy the worker:
```bash
wrangler deploy --config wrangler-resume-worker.toml
```

## Usage

### API Endpoint

**POST** `/`

### Request Format

```javascript
const formData = new FormData();
formData.append('file', fileBlob); // PDF or TXT file
formData.append('jobTitle', 'Software Engineer'); // Optional

const response = await fetch('https://jobhackai-resume-worker.your-subdomain.workers.dev/', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

### Response Format

```json
{
  "success": true,
  "score": 84,
  "breakdown": {
    "keywordRelevance": 35,
    "formatting": 18,
    "structure": 14,
    "tone": 12,
    "grammar": 5
  },
  "flags": [
    "Education section missing",
    "Detected 2-column layout"
  ],
  "metadata": {
    "textLength": 5234,
    "wordCount": 892,
    "ocrUsed": false,
    "isMultiColumn": false
  }
}
```

## Configuration

### Environment Variables

Set secrets via Wrangler:
```bash
wrangler secret put OPENAI_API_KEY  # For future AI feedback
```

### KV Namespaces (Optional)

For storing scan history:
```bash
wrangler kv:namespace create "RESUME_SCANS"
```

Then update `wrangler-resume-worker.toml` with the namespace IDs.

## Future Enhancements

### Pro/Premium Tier Features

1. **OpenAI Integration**: AI-powered feedback and recommendations
   - Uncomment OpenAI binding in `wrangler-resume-worker.toml`
   - Add OpenAI API key as secret
   - Implement AI feedback generation

2. **Workers AI**: Use Cloudflare's Workers AI for keyword mapping
   - Enable AI binding in config
   - Implement vectorized keyword matching

3. **KV Storage**: Store scan history for authenticated users
   - Create KV namespace
   - Store results with user ID
   - Implement history retrieval endpoint

## Architecture

```
/upload
 ├── Validate file size < 10MB
 ├── Detect MIME type (.pdf, .txt)
 ├── If PDF → test for selectable text
 │      ├── YES → parse via pdf-parse
 │      └── NO → send to OCR (Tesseract)
 ├── Sanitize text
 ├── Run rule-based scoring
 └── Return JSON response
```

## Limitations

- File size limit: 10MB
- Text length limit: 80,000 characters
- Supported formats: PDF, TXT (DOCX support can be added)
- OCR quality depends on image quality

## Error Handling

The worker returns appropriate HTTP status codes:

- `400`: Bad request (invalid file, unreadable text, size limits)
- `405`: Method not allowed (only POST supported)
- `500`: Internal server error

## Performance

- Text-based PDFs: <200ms
- OCR processing: 1-3 seconds (depending on image quality)
- Edge execution: Runs close to user location

## Security

- CORS protection: Only allows requests from configured origins
- File validation: Size and type checks
- No data retention: Files processed in-memory only
- Rate limiting: Can be added via Durable Objects

## Integration with JobHackAI Dashboard

Connect from your dashboard upload flow:

```javascript
// In your dashboard upload handler
async function scoreResume(file, jobTitle) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('jobTitle', jobTitle);
  
  const response = await fetch('https://jobhackai-resume-worker.your-subdomain.workers.dev/', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error('Failed to score resume');
  }
  
  return await response.json();
}
```

## Development

### Local Testing

```bash
wrangler dev --config wrangler-resume-worker.toml
```

### Testing with curl

```bash
curl -X POST https://jobhackai-resume-worker.your-subdomain.workers.dev/ \
  -F "file=@resume.pdf" \
  -F "jobTitle=Software Engineer"
```

## License

Part of JobHackAI platform.

