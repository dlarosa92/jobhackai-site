// Resume text extraction utility for PDF/DOCX/TXT files
// Uses Cloudflare Workers AI toMarkdown() for PDF extraction

import mammoth from 'mammoth';

// Import shared PDF metadata filtering
import { filterPdfMetadata, stripMarkdown, cleanText } from './pdf-metadata-filter.js';

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
 * @param {Object} env - Cloudflare Workers environment (for AI binding)
 * @returns {Promise<{text: string, wordCount: number, fileType: string, hasText: boolean, isMultiColumn: boolean, ocrUsed: boolean}>}
 */
export async function extractResumeText(file, fileName, env) {
  let fileExt = (fileName.toLowerCase().includes('.')
    ? fileName.toLowerCase().split('.').pop()
    : '').trim();
  const mimeType = file.type || getMimeTypeFromExtension(fileExt);

  // If no extension, infer from mimeType
  if (!fileExt && mimeType) {
    fileExt = inferExtensionFromMime(mimeType);
  }
  
  // Explicitly block legacy .doc (OLE) files to avoid misleading DOCX errors
  if (fileExt === 'doc') {
    throw createExtractionError(
      EXTRACTION_ERRORS.UNSUPPORTED_TYPE,
      'Legacy .doc files are not supported. Please re-save as DOCX or PDF.',
      { fileType: fileExt, supportedTypes: ['pdf', 'docx', 'txt'] }
    );
  }
  
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
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
    // Node/edge Buffer -> ArrayBuffer
    arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  } else if (ArrayBuffer.isView(file)) {
    // TypedArray/DataView
    arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  } else {
    throw createExtractionError(
      EXTRACTION_ERRORS.INVALID_FORMAT,
      'Invalid file format. Expected File, Blob, or ArrayBuffer.',
      { receivedType: typeof file, isArrayBuffer: file instanceof ArrayBuffer, isBlob: file instanceof Blob, isView: ArrayBuffer.isView(file) }
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
  let extractionStatus = 'ok';

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
        // Retry using convertToHtml with images skipped, then strip HTML to text
        try {
          const retryResult = await mammoth.convertToHtml({ arrayBuffer }, { convertImage: () => null });
          text = stripHtmlToText(retryResult.value);
        } catch (secondError) {
          // Final fallback: best-effort unzip of word/document.xml without new deps
          const fallbackText = await extractDocxXmlFallback(arrayBuffer);
          if (fallbackText) {
            text = fallbackText;
          } else {
            throw createExtractionError(
              EXTRACTION_ERRORS.PARSE_ERROR,
              `Failed to extract text from DOCX: ${secondError.message}`,
              { originalError: secondError.message, fileType: 'docx' }
            );
          }
        }
      }
    } else if (fileExt === 'pdf') {
      // PDF file - use Cloudflare Workers AI toMarkdown()
      const pdfResult = await extractPdfText(arrayBuffer, env);
      text = pdfResult.text;
      isMultiColumn = pdfResult.isMultiColumn;
      
      // If PDF.js parse failed (corruption, encryption, password protection, etc.)
      if (pdfResult.parseFailed) {
        // Use more specific error message based on errorMessage content
        // Note: toMarkdown API always sets errorName to 'ToMarkdownError', so we check errorMessage instead
        let userMessage = 'This PDF could not be processed. It may be corrupted, password-protected, or encrypted. Please try a different file or ensure the PDF is not password-protected.';
        
        const errorMsgLower = (pdfResult.errorMessage || '').toLowerCase();
        if (errorMsgLower.includes('password') || errorMsgLower.includes('encrypted')) {
          userMessage = 'This PDF is password-protected. Please remove the password and try again.';
        } else if (errorMsgLower.includes('invalid') || errorMsgLower.includes('corrupt')) {
          userMessage = 'This PDF appears to be corrupted or invalid. Please try re-saving the file or use a different PDF.';
        } else if (errorMsgLower.includes('missing') || errorMsgLower.includes('empty')) {
          userMessage = 'The PDF file appears to be empty or incomplete. Please check the file and try again.';
        }
        
        throw createExtractionError(
          EXTRACTION_ERRORS.PARSE_ERROR,
          userMessage,
          { 
            parseFailed: true,
            numPages: pdfResult.numPages || 0,
            errorName: pdfResult.errorName || null,
            errorMessage: pdfResult.errorMessage || null
          }
        );
      }
      
      // If PDF is empty (zero pages), throw parse error
      if (pdfResult.isEmpty) {
        throw createExtractionError(
          EXTRACTION_ERRORS.PARSE_ERROR,
          'This PDF appears to be empty or corrupted. Please upload a valid PDF file with content.',
          { 
            isEmpty: true,
            numPages: 0
          }
        );
      }
      
      // Flag likely scanned/low-text PDFs but continue (only block when zero text)
      if (pdfResult.isScanned || pdfResult.lowText) {
        extractionStatus = 'low_text';
      }
    }

    // Clean up text first to ensure consistent validation
    text = cleanText(text);
    
    // Validate extracted text (after cleaning for consistency)
    if (!text || text.length < 25) {
      throw createExtractionError(
        EXTRACTION_ERRORS.EMPTY_TEXT,
        'Could not extract readable text from file. Please upload a text-based résumé or use our DOCX template.',
        { extractedLength: text ? text.length : 0, minimumRequired: 25 }
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
    // For consistency: multi-column detection happens after cleanText for all file types
    // (PDFs already detected before stripMarkdown, but we re-check here for consistency)
    if (!isMultiColumn) {
      isMultiColumn = detectMultiColumnLayout(text);
    }

    // Validate text length (80k chars limit)
    if (text.length > 100000) {
      throw createExtractionError(
        EXTRACTION_ERRORS.TEXT_TOO_LONG,
        'Extracted text exceeds 100,000 character limit. Please use a shorter résumé.',
        { extractedLength: text.length, maxLength: 100000 }
      );
    }

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
      text,
      wordCount,
      fileType: fileExt,
      hasText: true,
      isMultiColumn,
      ocrUsed,
      extractionStatus
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
 * Extract text from PDF file using Cloudflare Workers AI toMarkdown()
 *
 * Uses native Cloudflare Workers AI binding for reliable PDF text extraction.
 * No external npm dependencies - maintained by Cloudflare.
 *
 * Handles text-based PDFs including:
 * - Google Docs exports
 * - Microsoft Word exports
 * - Canva PDFs
 * - LaTeX-generated PDFs
 * - Most modern PDF generators
 *
 * Performance optimizations:
 * - Character limit (40k chars) for early exit on very large PDFs
 * - Smart scanned PDF detection (text < 400 chars)
 * - Text-based multi-column detection (heuristic)
 */
async function extractPdfText(arrayBuffer, env) {
  const MAX_CHARS = 100000; // Character limit for early exit (aligned with overall limit)
  const SCANNED_PDF_THRESHOLD = 200; // If text < 200 chars, likely scanned

  try {
    // Verify AI binding is available
    if (!env?.AI) {
      throw new Error('AI binding not configured. Please add [ai] binding to wrangler.toml');
    }

    // Use Cloudflare Workers AI toMarkdown() for PDF extraction
    // API expects: { name: string, blob: Blob }
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const result = await env.AI.toMarkdown([{
      name: 'resume.pdf',
      blob: blob
    }]);

    // toMarkdown returns an array of results
    const pdfResult = Array.isArray(result) ? result[0] : result;

    if (!pdfResult || pdfResult.error) {
      const errorMessage = pdfResult?.error || 'toMarkdown returned no result';
      console.error('[PDF] toMarkdown failed', { error: errorMessage });
      return {
        text: '',
        isMultiColumn: false,
        numPages: 0,
        parseFailed: true,
        errorName: 'ToMarkdownError',
        errorMessage
      };
    }

    // Extract text from markdown result
    let extractedText = pdfResult.data || pdfResult.text || '';

    // Check if PDF appears empty (before processing)
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('[PDF] PDF has no extractable text');
      return { text: '', isMultiColumn: false, numPages: 0, isEmpty: true };
    }

    // Apply character limit (early exit for very large PDFs)
    if (extractedText.length > MAX_CHARS) {
      console.log('[PDF] Text limit reached, truncating', {
        originalLength: extractedText.length,
        truncatedLength: MAX_CHARS
      });
      extractedText = extractedText.substring(0, MAX_CHARS);
    }

    // Filter out PDF metadata and base64 image data FIRST
    // This must happen before any other processing to prevent metadata from affecting scoring
    extractedText = filterPdfMetadata(extractedText);

    // Multi-column detection BEFORE stripMarkdown (to preserve list markers for accurate line length)
    // This ensures consistent detection regardless of markdown formatting
    const linesForDetection = extractedText.split('\n').filter(line => line.trim().length > 0);
    const avgLineLengthForDetection = linesForDetection.reduce((sum, line) => sum + line.trim().length, 0) / Math.max(linesForDetection.length, 1);
    const isMultiColumn = avgLineLengthForDetection < 30 && linesForDetection.length > 20;

    // Now strip markdown syntax (after multi-column detection)
    extractedText = stripMarkdown(extractedText);

    // Clean text (fix encoding issues, normalize whitespace)
    extractedText = cleanText(extractedText);

    const trimmedText = extractedText.trim();

    // If we got minimal text, return empty (check before scanned PDF detection)
    // This handles truly empty or corrupted PDFs
    if (trimmedText.length === 0) {
      console.warn('[PDF] Extracted text empty after cleaning');
      return { text: '', isMultiColumn: false, numPages: 0, isEmpty: true };
    }

    // Smart low-text detection (soft flag)
    if (trimmedText.length < SCANNED_PDF_THRESHOLD) {
      console.warn('[PDF] Low-text PDF detected', {
        textLength: trimmedText.length,
        threshold: SCANNED_PDF_THRESHOLD
      });
      return { text: trimmedText, isMultiColumn, numPages: 0, lowText: true, isScanned: true };
    }

    console.log('[PDF] Successfully extracted text via toMarkdown', {
      textLength: trimmedText.length,
      isMultiColumn
    });

    return {
      text: trimmedText,
      isMultiColumn,
      numPages: 0 // toMarkdown doesn't provide page count
    };
  } catch (error) {
    // PDF parse failure (corruption, encryption, password protection, etc.)
    const errorName = error?.name || 'UnknownError';
    const errorMessage = error?.message || String(error);

    console.error('[PDF] toMarkdown extraction failed', {
      errorName,
      errorMessage,
      stack: error?.stack
    });

    return {
      text: '',
      isMultiColumn: false,
      numPages: 0,
      parseFailed: true,
      errorName,
      errorMessage
    };
  }
}

/**
 * OCR extraction placeholder
 *
 * NOTE: OCR is not implemented. For scanned PDFs, users are directed to upload
 * text-based PDFs or Word documents instead.
 *
 * Future: Consider Cloudflare Workers AI image-to-text capabilities.
 */
async function extractPdfWithOCR() {
  throw createExtractionError(
    EXTRACTION_ERRORS.OCR_REQUIRED,
    'This PDF appears to be image-based (scanned). Please upload a text-based PDF or Word document for best results.',
    {
      isScanned: true,
      requiresOcr: true
    }
  );
}

// Note: filterPdfMetadata, stripMarkdown, cleanText from ./pdf-metadata-filter.js

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

/**
 * Infer file extension from MIME type when no extension is present
 */
function inferExtensionFromMime(mimeType) {
  const map = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc', // still mapped so we can show the explicit .doc warning
    'text/plain': 'txt'
  };
  return map[mimeType] || '';
}

/**
 * Minimal DOCX fallback: unzip word/document.xml and strip tags
 * Avoids new deps by using Web Crypto-friendly unzip via Uint8Array + TextDecoder
 */
async function extractDocxXmlFallback(arrayBuffer) {
  try {
    // DOCX is a zip; look for the central header of word/document.xml via simple search
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder('utf-8');

    // Very small ad-hoc parser: find "word/document.xml" bytes
    const marker = new TextEncoder().encode('word/document.xml');
    const idx = indexOfSubarray(bytes, marker);
    if (idx === -1) return '';

    // Heuristic: document.xml usually follows the filename entry; grab next ~512KB window
    const window = bytes.slice(idx, Math.min(bytes.length, idx + 512 * 1024));
    const asString = decoder.decode(window);
    const xmlStart = asString.indexOf('<?xml');
    if (xmlStart === -1) return '';
    const xml = asString.slice(xmlStart);

    // Strip XML tags to get plain text
    const text = xml
      .replace(/<w:t[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  } catch (err) {
    console.warn('[DOCX] XML fallback failed', err);
    return '';
  }
}

// Find subarray within Uint8Array (naive search, sufficient for fallback)
function indexOfSubarray(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Minimal HTML stripper used for the convertToHtml retry path
function stripHtmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[^<]*<\\/style>/gi, ' ')
    .replace(/<script[^>]*>[^<]*<\\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\s+/g, ' ')
    .trim();
}
