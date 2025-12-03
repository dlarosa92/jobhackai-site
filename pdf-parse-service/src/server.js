// PDF Parse Service - Node.js/Express implementation
// Extracts text from PDF files for Cloudflare Workers

const express = require('express');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '2097152', 10); // 2MB default
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10); // 30s default

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
    console.error('[PDF-PARSE] Error:', error.message, error.stack);

    // Handle specific error types
    let errorCode = 'parse_error';
    let message = 'PDF could not be parsed';

    if (error.message.includes('timeout')) {
      errorCode = 'timeout';
      message = 'PDF parsing timed out';
    } else if (error.message.includes('Invalid PDF')) {
      errorCode = 'invalid_pdf';
      message = 'Invalid or corrupted PDF file';
    } else if (error.message.includes('password')) {
      errorCode = 'password_protected';
      message = 'PDF is password-protected';
    }

    res.status(400).json({
      success: false,
      error: errorCode,
      message,
      details: {
        errorMessage: error.message
      }
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Check for body-parser file size limit errors
  // Express body-parser errors have status 413 and type 'entity.too.large'
  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'file_too_large',
      message: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
      details: {
        fileSize: err.limit ? err.limit : MAX_FILE_SIZE,
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

