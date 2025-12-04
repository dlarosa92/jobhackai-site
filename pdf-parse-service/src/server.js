// PDF Parse Service - Node.js/Express implementation
// Extracts text from PDF files for Cloudflare Workers

const express = require('express');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// Parse and validate MAX_FILE_SIZE (default: 2MB)
const MAX_FILE_SIZE_RAW = parseInt(process.env.MAX_FILE_SIZE || '2097152', 10);
const MAX_FILE_SIZE = (isNaN(MAX_FILE_SIZE_RAW) || MAX_FILE_SIZE_RAW <= 0) ? 2097152 : MAX_FILE_SIZE_RAW;
if (process.env.MAX_FILE_SIZE && isNaN(MAX_FILE_SIZE_RAW)) {
  console.warn(`[PDF-PARSE] Invalid MAX_FILE_SIZE "${process.env.MAX_FILE_SIZE}", using default 2097152 bytes`);
}

// Parse and validate TIMEOUT_MS (default: 30s)
const TIMEOUT_MS_RAW = parseInt(process.env.TIMEOUT_MS || '30000', 10);
const TIMEOUT_MS = (isNaN(TIMEOUT_MS_RAW) || TIMEOUT_MS_RAW <= 0) ? 30000 : TIMEOUT_MS_RAW;
if (process.env.TIMEOUT_MS && isNaN(TIMEOUT_MS_RAW)) {
  console.warn(`[PDF-PARSE] Invalid TIMEOUT_MS "${process.env.TIMEOUT_MS}", using default 30000ms`);
}

if (!API_KEY) {
  console.error('ERROR: API_KEY environment variable is required');
  process.exit(1);
}

// Middleware to verify API key
function verifyApiKey(req, res, next) {
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Invalid or missing API key'
    });
  }
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pdf-parse-service' });
});

// PDF parsing endpoint
app.post('/parse-pdf', verifyApiKey, express.raw({ limit: MAX_FILE_SIZE, type: 'application/pdf' }), async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate content type (case-insensitive, handles MIME parameters)
    const contentType = req.get('content-type') || '';
    const normalizedContentType = contentType.toLowerCase().split(';')[0].trim();
    if (normalizedContentType !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: 'invalid_content_type',
        message: 'Content-Type must be application/pdf'
      });
    }

    // Validate file size
    const fileSize = req.body.length;
    if (fileSize === 0) {
      return res.status(400).json({
        success: false,
        error: 'empty_file',
        message: 'PDF file is empty'
      });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: 'file_too_large',
        message: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
        details: { fileSize, maxSize: MAX_FILE_SIZE }
      });
    }

    // Parse PDF with timeout
    const parsePromise = pdfParse(req.body);
    // Attach catch handler to suppress late rejections if timeout wins the race
    parsePromise.catch(() => {
      // Suppress unhandled promise rejection if parsePromise rejects after timeout
      // This can happen when Promise.race returns due to timeout but parsePromise
      // continues running and later rejects
    });
    
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Parse timeout')), TIMEOUT_MS);
    });

    let pdfData;
    try {
      pdfData = await Promise.race([parsePromise, timeoutPromise]);
    } finally {
      // Always clear the timeout to prevent unhandled promise rejections
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // Extract text and metadata
    const text = pdfData.text || '';
    const numPages = pdfData.numpages || 0;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    // Validate extracted text
    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: 'empty_text',
        message: 'Could not extract readable text from PDF. File may be image-based (scanned) or corrupted.',
        details: {
          numPages,
          extractedLength: text ? text.length : 0,
          minimumRequired: 50
        }
      });
    }

    const parseTime = Date.now() - startTime;

    res.json({
      success: true,
      text: text,
      numPages,
      wordCount,
      metadata: {
        fileSize,
        parseTimeMs: parseTime
      }
    });

  } catch (error) {
    // Safely extract error message (handle non-Error values)
    const errorMessage = error?.message || String(error || 'Unknown error');
    const errorStack = error?.stack || 'No stack trace available';
    
    console.error('[PDF-PARSE] Error:', errorMessage, errorStack);

    // Handle specific error types
    let errorCode = 'parse_error';
    let message = 'PDF could not be parsed';

    if (errorMessage.includes('timeout')) {
      errorCode = 'timeout';
      message = 'PDF parsing timed out';
    } else if (errorMessage.includes('Invalid PDF')) {
      errorCode = 'invalid_pdf';
      message = 'Invalid or corrupted PDF file';
    } else if (errorMessage.includes('password')) {
      errorCode = 'password_protected';
      message = 'PDF is password-protected';
    }

    res.status(400).json({
      success: false,
      error: errorCode,
      message,
      details: {
        errorMessage: errorMessage
      }
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Check for body-parser file size limit errors
  // Express body-parser errors have status 413 and type 'entity.too.large'
  // err.length contains the actual file size, err.limit contains the configured limit
  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'file_too_large',
      message: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
      details: {
        fileSize: err.length || MAX_FILE_SIZE,
        maxSize: MAX_FILE_SIZE
      }
    });
  }
  
  console.error('[PDF-PARSE] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'internal_error',
    message: 'An internal error occurred'
  });
});

app.listen(PORT, () => {
  console.log(`[PDF-PARSE] Service started on port ${PORT}`);
  console.log(`[PDF-PARSE] Max file size: ${MAX_FILE_SIZE} bytes`);
  console.log(`[PDF-PARSE] Timeout: ${TIMEOUT_MS}ms`);
});

