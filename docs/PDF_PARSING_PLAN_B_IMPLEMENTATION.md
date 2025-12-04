# PDF Parsing Plan B - Implementation Plan

## Overview

This document outlines the implementation plan for moving PDF parsing from Cloudflare Workers (using PDF.js) to a dedicated Node.js/Python microservice. This approach eliminates the PDF.js v4 + Cloudflare Workers compatibility issues and provides a more reliable, maintainable solution.

## Problem Statement

- PDF.js v4 requires `GlobalWorkerOptions.workerSrc` which doesn't work cleanly in Cloudflare Workers
- Intermittent failures due to Worker instance caching and environment mismatches
- Ongoing maintenance burden of fighting library/runtime incompatibilities

## Solution Architecture

```
User Upload → Cloudflare Worker → PDF Parse Service → Worker → OpenAI → Response
              (receives PDF)      (extracts text)     (AI processing)
```

## Implementation Steps

### Phase 1: PDF Parse Service Setup

#### Option A: Node.js Service (Recommended)
- **Library**: `pdf-parse` (already in dependencies)
- **Framework**: Express.js or Fastify
- **Hosting**: Render/Railway/Fly.io
- **Endpoint**: `POST /parse-pdf`

#### Option B: Python Service
- **Library**: `pdfplumber` or `PyPDF2`
- **Framework**: FastAPI or Flask
- **Hosting**: Same as Node.js option
- **Endpoint**: `POST /parse-pdf`

### Phase 2: Service Implementation

#### Service Requirements
1. Accept PDF bytes via POST request
2. Extract text using appropriate library
3. Return structured JSON response
4. Handle errors gracefully
5. Basic authentication (API key)

#### Response Format
```json
{
  "success": true,
  "text": "extracted text...",
  "numPages": 2,
  "wordCount": 450,
  "metadata": {
    "fileName": "resume.pdf",
    "fileSize": 12345
  }
}
```

#### Error Response Format
```json
{
  "success": false,
  "error": "parse_error",
  "message": "PDF could not be parsed",
  "details": {
    "errorCode": "corrupted_pdf"
  }
}
```

### Phase 3: Worker Integration

#### Changes to `app/functions/api/resume-upload.js`
1. Add environment variable for parse service URL
2. Add API key for authentication
3. Forward PDF bytes to parse service
4. Handle parse service response
5. Fallback to existing DOCX/TXT handling

#### Integration Flow
```javascript
// Pseudo-code
if (fileExt === 'pdf') {
  // Forward to parse service
  const parseResponse = await fetch(PARSE_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-API-Key': env.PDF_PARSE_API_KEY
    },
    body: arrayBuffer
  });
  
  if (parseResponse.ok) {
    const result = await parseResponse.json();
    text = result.text;
    // Continue with existing flow
  } else {
    // Handle error
  }
}
```

### Phase 4: Error Handling & Fallbacks

1. **Timeout handling**: 10-15 second timeout for parse service
2. **Retry logic**: 1 retry on network failures
3. **Fallback**: If service unavailable, return helpful error message
4. **Logging**: Log all parse service interactions

### Phase 5: Security

1. **API Key Authentication**: Shared secret between Worker and service
2. **Rate Limiting**: Service should rate limit requests
3. **Input Validation**: Validate PDF size/format before parsing
4. **IP Allowlisting** (optional): Restrict service to Cloudflare IPs

## File Structure

```
pdf-parse-service/
├── src/
│   ├── server.js (or server.py)
│   ├── parser.js (or parser.py)
│   └── utils.js (or utils.py)
├── package.json (or requirements.txt)
├── Dockerfile
├── README.md
└── .env.example
```

## Environment Variables

### Parse Service
- `PORT`: Server port (default: 3000)
- `API_KEY`: Authentication key
- `MAX_FILE_SIZE`: Max PDF size in bytes (default: 2MB)
- `TIMEOUT_MS`: Parse timeout (default: 30000)

### Cloudflare Worker
- `PDF_PARSE_SERVICE_URL`: Parse service endpoint URL
- `PDF_PARSE_API_KEY`: Authentication key (must match service)

## Testing Strategy

1. **Unit Tests**: Test parser with various PDF types
2. **Integration Tests**: Test Worker → Service → Worker flow
3. **Error Cases**: Corrupted PDFs, password-protected, large files
4. **Performance Tests**: Measure latency impact

## Deployment Checklist

- [ ] Create parse service repository
- [ ] Implement parse service (Node.js or Python)
- [ ] Deploy parse service to hosting platform
- [ ] Configure environment variables
- [ ] Update Worker with parse service integration
- [ ] Test end-to-end flow
- [ ] Monitor service health and performance
- [ ] Update documentation

## Rollback Plan

If Plan B has issues:
1. Revert Worker changes to use PDF.js (with legacy build)
2. Keep parse service running for gradual migration
3. A/B test both approaches if needed

## Performance Expectations

- **Parse Service Latency**: 50-300ms for typical resume
- **Network Hop**: 50-150ms (same region)
- **Total Added Latency**: ~100-450ms
- **User Impact**: Negligible (OpenAI call is 2-5 seconds)

## Cost Considerations

- **Parse Service Hosting**: ~$5-20/month (Render/Railway free tier may suffice)
- **Bandwidth**: Minimal (PDFs are small)
- **Compute**: Low (parsing is CPU-bound but fast)

## Next Steps

1. Choose Node.js or Python implementation
2. Create parse service repository
3. Implement basic service
4. Deploy to staging environment
5. Integrate with Worker
6. Test thoroughly
7. Deploy to production

## Future Enhancements

- Support for DOCX parsing in service (consolidate all parsing)
- Caching parsed results
- Batch processing for multiple files
- OCR support for scanned PDFs
- Webhook support for async processing

