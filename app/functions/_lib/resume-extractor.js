// Resume text extraction utility for PDF/DOCX/TXT files
// Uses Cloudflare Workers AI toMarkdown() for PDF extraction

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
 * @param {Object} env - Cloudflare Workers environment (for AI binding)
 * @returns {Promise<{text: string, wordCount: number, fileType: string, hasText: boolean, isMultiColumn: boolean, ocrUsed: boolean}>}
 */
export async function extractResumeText(file, fileName, env) {
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
      
      // If scanned PDF detected, return helpful error (no OCR attempt)
      if (pdfResult.isScanned) {
        throw createExtractionError(
          EXTRACTION_ERRORS.OCR_REQUIRED,
          'This PDF appears to be image-based (scanned). Please upload a text-based PDF or Word document for best results. We\'re working on scan support for a future update.',
          { 
            isScanned: true, 
            requiresOcr: true,
            numPages: pdfResult.numPages || 0
          }
        );
      }
      
      // If no text extracted (but not necessarily scanned), try OCR detection
      if (!text || text.trim().length < 100) {
        // This will throw a helpful error message instead of attempting OCR
        throw createExtractionError(
          EXTRACTION_ERRORS.OCR_REQUIRED,
          'This PDF appears to be image-based (scanned). Please upload a text-based PDF or Word document for best results. We\'re working on scan support for a future update.',
          { 
            isScanned: true, 
            requiresOcr: true,
            numPages: pdfResult.numPages || 0
          }
        );
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
    // For consistency: multi-column detection happens after cleanText for all file types
    // (PDFs already detected before stripMarkdown, but we re-check here for consistency)
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
  const MAX_CHARS = 40000; // Character limit for early exit
  const SCANNED_PDF_THRESHOLD = 400; // If text < 400 chars, likely scanned

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
    if (trimmedText.length < 100) {
      console.warn('[PDF] Extracted text too short', {
        length: trimmedText.length
      });
      return { text: '', isMultiColumn: false, numPages: 0 };
    }

    // Smart scanned PDF detection (after cleaning for consistency with resume-score-worker.js)
    // This check happens after stripMarkdown and cleanText to match resume-score-worker.js behavior
    // Only flag as scanned if text is between 100-399 chars (very short but not empty)
    // PDFs with < 100 chars are handled above as empty/corrupted
    if (trimmedText.length < SCANNED_PDF_THRESHOLD) {
      console.warn('[PDF] Scanned PDF detected', {
        textLength: trimmedText.length,
        threshold: SCANNED_PDF_THRESHOLD
      });
      return { text: '', isMultiColumn: false, numPages: 0, isScanned: true };
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

/**
 * Filter out PDF metadata and base64 image data from extracted text
 * The toMarkdown() API can include PDF internal metadata and embedded images
 * which corrupt the resume text and cause rewrite hallucinations.
 *
 * Filters:
 * - PDF metadata fields (PDFFormatVersion=, CreationDate=, Producer=, etc.)
 * - XMP metadata (xmp:, xmpmm:, dc:, etc.)
 * - Section headers like "Metadata" and "Contents" that precede metadata blocks
 * - Base64-encoded image data (long alphanumeric strings)
 * - File name references at the start (e.g., "resume.pdf")
 */
function filterPdfMetadata(text) {
  if (!text) return '';

  // Known PDF metadata field prefixes (case-insensitive)
  const metadataPatterns = [
    /^PDFFormatVersion=/i,
    /^IsLinearized=/i,
    /^IsAcroFormPresent=/i,
    /^IsXFAPresent=/i,
    /^IsCollectionPresent=/i,
    /^IsSignaturesPresent=/i,
    /^CreationDate=/i,
    /^Creator=/i,
    /^ModDate=/i,
    /^Producer=/i,
    /^Title=/i,
    /^Author=/i,
    /^Subject=/i,
    /^Keywords=/i,
    /^Trapped=/i,
    /^AAPL:/i,
    // XMP metadata prefixes
    /^xmp:/i,
    /^xmpmm:/i,
    /^xmpMM:/i,
    /^dc:/i,
    /^pdf:/i,
    /^pdfx:/i,
    /^photoshop:/i,
    /^illustrator:/i,
    /^xmpTPg:/i,
    // Section headers that indicate metadata blocks
    /^Metadata$/i,
    /^Contents$/i,
    // File name at start (e.g., "resume.pdf", "document.pdf")
    /^[a-zA-Z0-9_-]+\.pdf$/i
  ];

  // Split into lines and filter
  const lines = text.split('\n');
  const filteredLines = [];
  let inMetadataBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines in metadata context (but keep them in content)
    if (trimmedLine.length === 0) {
      // Only add empty lines if we're not in a metadata block
      if (!inMetadataBlock && filteredLines.length > 0) {
        filteredLines.push(line);
      }
      continue;
    }

    // Check if this line is a metadata section header
    if (/^Metadata$/i.test(trimmedLine)) {
      inMetadataBlock = true;
      continue;
    }

    // Check if this line looks like actual content (ends metadata block)
    // Content typically has spaces, punctuation, or is a recognizable section header
    const looksLikeContent = (
      // Has multiple words (not a key=value pair)
      (trimmedLine.split(/\s+/).length > 2 && !trimmedLine.includes('=')) ||
      // Is a resume section header
      /^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|AWARDS|CERTIFICATIONS|SUMMARY|OBJECTIVE|PROFILE|ABOUT|CONTACT|WORK|EMPLOYMENT|PROFESSIONAL|TECHNICAL|QUALIFICATIONS)/i.test(trimmedLine) ||
      // Contains common resume text patterns (phone, email, name patterns)
      /[@.]\w+\.(com|edu|org|net|io)/i.test(trimmedLine) ||
      /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(trimmedLine)
    );

    if (looksLikeContent) {
      inMetadataBlock = false;
    }

    // Check if this line matches any metadata pattern
    const isMetadataLine = metadataPatterns.some(pattern => pattern.test(trimmedLine));
    if (isMetadataLine) {
      inMetadataBlock = true;
      continue;
    }

    // Check for base64-encoded data (very long alphanumeric strings without spaces)
    // Base64 data is typically 50+ chars of continuous alphanumeric/+/= characters
    const base64Pattern = /^[A-Za-z0-9+/=]{50,}$/;
    if (base64Pattern.test(trimmedLine)) {
      continue;
    }

    // Check for lines that contain embedded base64 (e.g., xmp:thumbnails=200256JPEG/9j/4AAQ...)
    // These have a short prefix followed by long alphanumeric string
    const embeddedBase64Pattern = /^[\w:]+=[A-Za-z0-9+/]{40,}/;
    if (embeddedBase64Pattern.test(trimmedLine)) {
      continue;
    }

    // Check for partial base64 data (continuation lines)
    // These are long lines without spaces that look like encoded data
    if (trimmedLine.length > 60 && !/\s/.test(trimmedLine) && /^[A-Za-z0-9+/=]+$/.test(trimmedLine)) {
      continue;
    }

    // Skip if still in metadata block
    if (inMetadataBlock && trimmedLine.includes('=') && !trimmedLine.includes(' ')) {
      continue;
    }

    // This line looks like actual content
    inMetadataBlock = false;
    filteredLines.push(line);
  }

  return filteredLines.join('\n').trim();
}

/**
 * Strip markdown syntax from text
 * toMarkdown() returns markdown-formatted text which can affect scoring
 */
function stripMarkdown(text) {
  if (!text) return '';

  return text
    // Remove headers (# ## ### etc)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic (**text**, *text*, __text__, _text_)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove inline code (`code`) - extract content only
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks (```code```) - extract content only, preserve newlines
    .replace(/```[\s\S]*?```/g, (match) => {
      // Extract content between triple backticks, preserving it as plain text
      const content = match.replace(/^```[\s\S]*?\n?/, '').replace(/\n?```$/, '');
      return content;
    })
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules (---, ***, ___)
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquotes (> text)
    .replace(/^>\s+/gm, '')
    // Remove list markers (-, *, +, 1.)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, '$1');
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

