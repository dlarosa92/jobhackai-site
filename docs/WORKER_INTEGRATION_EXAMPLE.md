# Worker Integration Example

This document shows how to integrate the PDF Parse Service with Cloudflare Workers.

## Environment Variables

Add these to your Cloudflare Pages/Workers environment:

```
PDF_PARSE_SERVICE_URL=https://your-parse-service.onrender.com
PDF_PARSE_API_KEY=your-secret-api-key-here
```

## Integration Code

### Modified `app/functions/api/resume-upload.js`

Add this function to call the parse service:

```javascript
/**
 * Parse PDF using external parse service
 * @param {ArrayBuffer} arrayBuffer - PDF file bytes
 * @param {string} fileName - Original filename
 * @param {Object} env - Cloudflare environment
 * @returns {Promise<Object>} Parse result with text and metadata
 */
async function parsePdfViaService(arrayBuffer, fileName, env) {
  const serviceUrl = env.PDF_PARSE_SERVICE_URL;
  const apiKey = env.PDF_PARSE_API_KEY;

  if (!serviceUrl || !apiKey) {
    throw new Error('PDF parse service not configured');
  }

  try {
    const response = await fetch(serviceUrl + '/parse-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-API-Key': apiKey
      },
      body: arrayBuffer
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createExtractionError(
        EXTRACTION_ERRORS.PARSE_ERROR,
        errorData.message || 'PDF could not be parsed by service',
        {
          serviceError: errorData.error,
          serviceDetails: errorData.details || {}
        }
      );
    }

    const result = await response.json();
    
    if (!result.success || !result.text) {
      throw createExtractionError(
        EXTRACTION_ERRORS.EMPTY_TEXT,
        'No text extracted from PDF',
        { numPages: result.numPages || 0 }
      );
    }

    return {
      text: result.text,
      wordCount: result.wordCount || 0,
      fileType: 'pdf',
      hasText: true,
      isMultiColumn: false, // Could be enhanced with layout detection
      ocrUsed: false,
      numPages: result.numPages || 0
    };

  } catch (error) {
    // Re-throw structured errors
    if (error.code && Object.values(EXTRACTION_ERRORS).includes(error.code)) {
      throw error;
    }

    // Handle network/timeout errors
    if (error.name === 'TypeError' || error.message.includes('fetch')) {
      throw createExtractionError(
        EXTRACTION_ERRORS.PARSE_ERROR,
        'PDF parse service unavailable. Please try again later.',
        { serviceUnavailable: true }
      );
    }

    // Re-throw as parse error
    throw createExtractionError(
      EXTRACTION_ERRORS.PARSE_ERROR,
      error.message || 'PDF parsing failed',
      { originalError: error.message }
    );
  }
}
```

### Modify `extractResumeText` in `resume-extractor.js`

Update the PDF handling section:

```javascript
} else if (fileExt === 'pdf') {
  // Try external parse service first (if configured)
  if (env?.PDF_PARSE_SERVICE_URL && env?.PDF_PARSE_API_KEY) {
    try {
      return await parsePdfViaService(arrayBuffer, fileName, env);
    } catch (serviceError) {
      // Log but fall through to PDF.js fallback
      console.warn('[RESUME-EXTRACT] Parse service failed, falling back to PDF.js:', serviceError.message);
    }
  }

  // Fallback to PDF.js (legacy build)
  const pdfResult = await extractPdfText(arrayBuffer);
  // ... rest of existing code
}
```

## Fallback Strategy

1. **Primary**: Use parse service if configured
2. **Fallback**: Use PDF.js legacy build if service unavailable
3. **Error**: Return structured error to user

## Testing

Test the integration:

1. Deploy parse service
2. Set environment variables in Cloudflare
3. Upload a test PDF
4. Verify text extraction works
5. Test error cases (service down, invalid PDF, etc.)

## Monitoring

Monitor these metrics:
- Parse service response time
- Parse service error rate
- Fallback usage (PDF.js usage)
- Service availability

