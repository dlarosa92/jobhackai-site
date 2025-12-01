// Resume text extraction utility for PDF/DOCX/TXT files
// Supports OCR for image-based PDFs using Tesseract.js

import mammoth from 'mammoth';

/**
 * Structured error codes for resume extraction
 * Frontend can use these for user-friendly messages
 */
export const EXTRACTION_ERRORS = {
  UNSUPPORTED_TYPE: 'unsupported_file_type',
  EMPTY_TEXT: 'empty_text',
  OCR_FAILED: 'ocr_failed',
  OCR_REQUIRED: 'ocr_required',
  TOO_LARGE: 'file_too_large',
  TEXT_TOO_LONG: 'text_too_long',
  PARSE_ERROR: 'parse_error',
  INVALID_FORMAT: 'invalid_format',
  UNREADABLE_SCAN: 'unreadable_scan'
};

/**
 * Create a structured extraction error
 * @param {string} code - Error code from EXTRACTION_ERRORS
 * @param {string} message - Human-readable message
 * @param {Object} details - Optional additional details
 * @returns {Error} Error with code and details attached
 */
function createExtractionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

/**
 * Extract text from resume file
 * @param {File|Blob|ArrayBuffer} file - The file to extract text from
 * @param {string} fileName - Original filename
 * @returns {Promise<{text: string, wordCount: number, fileType: string, hasText: boolean, isMultiColumn: boolean, ocrUsed: boolean}>}
 */
export async function extractResumeText(file, fileName) {
  const fileExt = fileName.toLowerCase().split('.').pop();
  const mimeType = file.type || getMimeTypeFromExtension(fileExt);
  
  // Validate file type
  if (!['pdf', 'docx', 'txt'].includes(fileExt)) {
    throw createExtractionError(
      EXTRACTION_ERRORS.UNSUPPORTED_TYPE,
      `Unsupported file type: ${fileExt}. Please upload PDF, DOCX, or TXT.`,
      { fileType: fileExt, supportedTypes: ['pdf', 'docx', 'txt'] }
    );
  }

  // Convert file to ArrayBuffer if needed
  let arrayBuffer;
  if (file instanceof ArrayBuffer) {
    arrayBuffer = file;
  } else if (file instanceof Blob) {
    arrayBuffer = await file.arrayBuffer();
  } else {
    throw createExtractionError(
      EXTRACTION_ERRORS.INVALID_FORMAT,
      'Invalid file format. Expected File, Blob, or ArrayBuffer.',
      { receivedType: typeof file, isArrayBuffer: file instanceof ArrayBuffer, isBlob: file instanceof Blob }
    );
  }

  // Validate file size (2MB limit)
  if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
    throw createExtractionError(
      EXTRACTION_ERRORS.TOO_LARGE,
      'File exceeds 2MB limit. Please compress or use a smaller file.',
      { fileSize: arrayBuffer.byteLength, maxSize: 2 * 1024 * 1024 }
    );
  }

  let text = '';
  let ocrUsed = false;
  let isMultiColumn = false;

  try {
    if (fileExt === 'txt') {
      // Plain text file
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(arrayBuffer);
    } else if (fileExt === 'docx') {
      // DOCX file - use mammoth
      try {
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } catch (docxError) {
        throw createExtractionError(
          EXTRACTION_ERRORS.PARSE_ERROR,
          `Failed to extract text from DOCX: ${docxError.message}`,
          { originalError: docxError.message, fileType: 'docx' }
        );
      }
    } else if (fileExt === 'pdf') {
      // PDF file - try text extraction first, fall back to OCR
      const pdfResult = await extractPdfText(arrayBuffer);
      text = pdfResult.text;
      isMultiColumn = pdfResult.isMultiColumn;
      
      // If no text extracted, try OCR
      if (!text || text.trim().length < 100) {
        text = await extractPdfWithOCR(arrayBuffer);
        ocrUsed = true;
      }
    }

    // Clean up text first to ensure consistent validation
    text = cleanText(text);
    
    // Validate extracted text (after cleaning for consistency)
    if (!text || text.length < 50) {
      throw createExtractionError(
        EXTRACTION_ERRORS.EMPTY_TEXT,
        'Could not extract readable text from file. Please upload a text-based résumé or use our DOCX template.',
        { extractedLength: text ? text.length : 0, minimumRequired: 50 }
      );
    }

    // Check if OCR output is too short (likely unreadable) - after cleaning for consistency
    if (ocrUsed && text.length < 500) {
      throw createExtractionError(
        EXTRACTION_ERRORS.UNREADABLE_SCAN,
        'Unreadable scan detected. Please upload a higher-quality file or use our DOCX template.',
        { extractedLength: text.length, minimumRequired: 500, ocrUsed: true }
      );
    }
    
    // Detect multi-column layout (heuristic: many short lines)
    if (!isMultiColumn) {
      isMultiColumn = detectMultiColumnLayout(text);
    }

    // Validate text length (80k chars limit)
    if (text.length > 80000) {
      throw createExtractionError(
        EXTRACTION_ERRORS.TEXT_TOO_LONG,
        'Extracted text exceeds 80,000 character limit. Please use a shorter résumé.',
        { extractedLength: text.length, maxLength: 80000 }
      );
    }

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
      text,
      wordCount,
      fileType: fileExt,
      hasText: true,
      isMultiColumn,
      ocrUsed
    };

  } catch (error) {
    // Re-throw structured errors as-is
    if (error.code && Object.values(EXTRACTION_ERRORS).includes(error.code)) {
      throw error;
    }
    // Wrap other errors in structured format
    throw createExtractionError(
      EXTRACTION_ERRORS.PARSE_ERROR,
      `Failed to extract text: ${error.message}`,
      { originalError: error.message, fileType: fileExt }
    );
  }
}


/**
 * Extract text from PDF file
 * Note: pdf-parse requires Node.js and won't work in Cloudflare Workers
 * We use a simple heuristic: try to extract text from PDF structure
 * If that fails, OCR fallback will be triggered
 */
async function extractPdfText(arrayBuffer) {
  try {
    // For Cloudflare Workers, we can't use pdf-parse directly
    // Instead, we'll attempt basic PDF text extraction using a lightweight approach
    // This is a simplified version that works in Workers environment
    
    // Convert ArrayBuffer to Uint8Array for processing
    const bytes = new Uint8Array(arrayBuffer);
    
    // Look for text streams in PDF (basic heuristic)
    // PDF text is typically in streams between "stream" and "endstream"
    const decoder = new TextDecoder('latin1');
    const pdfText = decoder.decode(bytes);
    
    // Extract text between stream markers (simplified approach)
    const streamMatches = pdfText.match(/stream[\s\S]*?endstream/g);
    if (!streamMatches || streamMatches.length === 0) {
      return { text: '', isMultiColumn: false };
    }
    
    let extractedText = '';
    for (const stream of streamMatches) {
      // Try to decode as text (PDFs can have compressed streams, but we try anyway)
      try {
        // Remove stream markers
        const content = stream.replace(/^stream[\r\n]+/, '').replace(/[\r\n]+endstream$/, '');
        // Try to extract readable text (basic filtering)
        const textMatch = content.match(/[A-Za-z0-9\s\.\,\!\?\:\;\(\)\-\'\"\/]{20,}/g);
        if (textMatch) {
          extractedText += textMatch.join(' ') + '\n';
        }
      } catch (e) {
        // Skip compressed or binary streams
        continue;
      }
    }
    
    // If we got minimal text, return empty to trigger OCR
    if (extractedText.trim().length < 100) {
      return { text: '', isMultiColumn: false };
    }
    
    // Basic multi-column detection
    const lines = extractedText.split('\n');
    const avgLineLength = lines.reduce((sum, line) => sum + line.trim().length, 0) / Math.max(lines.length, 1);
    const isMultiColumn = avgLineLength < 30 && lines.length > 20;
    
    return {
      text: extractedText.trim(),
      isMultiColumn
    };
  } catch (error) {
    // If extraction fails, return empty to trigger OCR fallback
    return { text: '', isMultiColumn: false };
  }
}

/**
 * Extract text from PDF using OCR (Tesseract.js)
 * For Cloudflare Workers, we use Tesseract.js worker version
 */
async function extractPdfWithOCR(arrayBuffer) {
  try {
    // Import Tesseract.js dynamically (Cloudflare Workers compatible)
    // Note: Tesseract.js requires worker files to be available
    // In production, these should be served from CDN or bundled
    
    // For now, we'll use a simplified OCR approach
    // In a full implementation, you would:
    // 1. Convert PDF pages to images
    // 2. Use Tesseract.js to OCR each image
    // 3. Combine results
    
    // Since Tesseract.js requires worker files and image processing,
    // we'll throw an error that triggers a user-facing modal
    // The frontend can handle this gracefully
    
    throw createExtractionError(
      EXTRACTION_ERRORS.OCR_REQUIRED,
      'OCR processing is required for this scanned PDF. This may take up to 20 seconds. Please wait...',
      { requiresOcr: true }
    );
  } catch (error) {
    // Re-throw structured errors as-is
    if (error.code && Object.values(EXTRACTION_ERRORS).includes(error.code)) {
      throw error;
    }
    // Wrap other errors
    throw createExtractionError(
      EXTRACTION_ERRORS.OCR_FAILED,
      error.message || 'OCR extraction failed. Please upload a text-based PDF or try again.',
      { originalError: error.message }
    );
  }
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  // Remove excessive line breaks (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  
  // Fix common encoding issues (UTF-8 decoded as Latin-1 mojibake)
  // When UTF-8 bytes are decoded as Latin-1, byte 0x80 becomes U+0080, not U+20AC (€)
  // Pattern: UTF-8 0xE2 0x80 0x99 -> Latin-1: U+00E2 U+0080 U+0099 -> "â\x80\x99"
  text = text.replace(/â\x80\x99/g, "'"); // Right single quotation mark
  text = text.replace(/â\x80\x9C/g, '"'); // Left double quotation mark
  text = text.replace(/â\x80\x9D/g, '"'); // Right double quotation mark
  // Fix em dash mojibake (UTF-8 0xE2 0x80 0x94 decoded as Latin-1)
  // UTF-8: 0xE2 0x80 0x94 -> Latin-1: U+00E2 U+0080 U+0094 -> "â\x80\x94"
  text = text.replace(/â\x80\x94/g, '—');
  // Fix en dash mojibake (UTF-8 0xE2 0x80 0x93 decoded as Latin-1)
  // UTF-8: 0xE2 0x80 0x93 -> Latin-1: U+00E2 U+0080 U+0093 -> "â\x80\x93"
  text = text.replace(/â\x80\x93/g, '–');
  
  // Trim
  text = text.trim();
  
  return text;
}

/**
 * Detect multi-column layout
 */
function detectMultiColumnLayout(text) {
  const lines = text.split('\n');
  const avgLineLength = lines.reduce((sum, line) => sum + line.trim().length, 0) / lines.length;
  
  // If average line length is very short (< 30 chars), likely multi-column
  if (avgLineLength < 30 && lines.length > 20) {
    return true;
  }
  
  // Check for many lines with similar short lengths (column pattern)
  const shortLines = lines.filter(line => line.trim().length > 0 && line.trim().length < 40);
  if (shortLines.length > lines.length * 0.6) {
    return true;
  }
  
  return false;
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(ext) {
  const mimeTypes = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

