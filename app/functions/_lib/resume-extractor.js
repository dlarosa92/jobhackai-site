// Resume text extraction utility for PDF/DOCX/TXT files
// Supports OCR for image-based PDFs using Tesseract.js

import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

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
      // PDF file - try text extraction first, detect scanned PDFs
      const pdfResult = await extractPdfText(arrayBuffer);
      text = pdfResult.text;
      isMultiColumn = pdfResult.isMultiColumn;
      
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
 * Extract text from PDF file using PDF.js
 * PDF.js works in Cloudflare Workers and handles text-based PDFs including:
 * - Google Docs exports
 * - Microsoft Word exports
 * - Canva PDFs
 * - LaTeX-generated PDFs
 * - Most modern PDF generators
 * 
 * Performance optimizations:
 * - Limits to first 3 pages (most resumes are 1-2 pages)
 * - Early exit if text exceeds 40k characters
 * - Smart scanned PDF detection (text < 400 chars AND pages >= 1)
 * 
 * If extraction fails or returns minimal text, scanned PDF detection will be triggered
 */
async function extractPdfText(arrayBuffer) {
  const MAX_PAGES = 3; // Most resumes are 1-2 pages, limit for performance
  const MAX_CHARS = 40000; // Reasonable character limit for early exit
  const SCANNED_PDF_THRESHOLD = 400; // If text < 400 chars and pages >= 1, likely scanned
  
  try {
    // PDF.js in Cloudflare Workers doesn't need worker configuration
    // The library will use its built-in fallback for serverless environments
    // Setting workerSrc to a CDN URL would fail in Workers (no web workers support)
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      useSystemFonts: true, // Reduce font loading overhead
      disableAutoFetch: true, // Don't pre-fetch all pages
      disableStream: false, // Allow streaming for better memory usage
      verbosity: 0 // Suppress console warnings
    });
    
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    
    if (numPages === 0) {
      console.warn('[PDF] PDF has no pages');
      return { text: '', isMultiColumn: false, numPages: 0 };
    }
    
    // Performance optimization: Only process first N pages
    const pagesToProcess = Math.min(numPages, MAX_PAGES);
    
    // Extract text from pages sequentially (with early exit)
    // Use positioning info to preserve line structure for accurate multi-column detection
    let fullText = '';
    const pageTexts = [];
    const startTime = Date.now();
    
    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Group text items by y-coordinate (line) to preserve line structure
        // Items with similar y-coordinates are on the same line
        const lineGroups = new Map();
        const LINE_TOLERANCE = 2; // Pixels - items within 2px vertically are on same line
        
        for (const item of textContent.items) {
          if (!item.str || item.str.trim().length === 0) continue;
          
          // Extract y-coordinate from transform matrix [a, b, c, d, e, f]
          // Transform: [a b c d e f] where e=x, f=y
          const y = item.transform ? item.transform[5] : 0;
          
          // Find existing line group with similar y-coordinate
          let matchedLine = null;
          for (const [lineY, lineItems] of lineGroups.entries()) {
            if (Math.abs(y - lineY) <= LINE_TOLERANCE) {
              matchedLine = lineY;
              break;
            }
          }
          
          // Add to existing line or create new line
          if (matchedLine !== null) {
            lineGroups.get(matchedLine).push(item);
          } else {
            lineGroups.set(y, [item]);
          }
        }
        
        // Sort lines by y-coordinate (top to bottom) and build page text
        const sortedLines = Array.from(lineGroups.entries())
          .sort((a, b) => b[0] - a[0]) // Sort by y descending (top to bottom)
          .map(([y, items]) => {
            // Sort items within line by x-coordinate (left to right)
            const sortedItems = items.sort((a, b) => {
              const xA = a.transform ? a.transform[4] : 0;
              const xB = b.transform ? b.transform[4] : 0;
              return xA - xB;
            });
            // Join items on same line with spaces
            return sortedItems.map(item => item.str).join(' ');
          });
        
        const pageText = sortedLines.join('\n');
        
        if (pageText.trim().length > 0) {
          pageTexts.push(pageText);
          fullText += pageText + '\n';
          
          // Early exit if we've exceeded character limit
          if (fullText.length > MAX_CHARS) {
            console.log('[PDF] Early exit: text limit reached', { 
              pagesProcessed: pageNum, 
              textLength: fullText.length 
            });
            fullText = fullText.substring(0, MAX_CHARS);
            break;
          }
        }
      } catch (pageError) {
        console.warn(`[PDF] Error extracting text from page ${pageNum}:`, pageError.message);
        // Continue with other pages even if one fails
        continue;
      }
    }
    
    const extractedText = fullText.trim();
    const extractionTime = Date.now() - startTime;
    
    // Smart scanned PDF detection: if text is very short AND we have pages, likely scanned
    if (extractedText.length < SCANNED_PDF_THRESHOLD && numPages >= 1) {
      console.warn('[PDF] Scanned PDF detected', { 
        textLength: extractedText.length, 
        pages: numPages,
        threshold: SCANNED_PDF_THRESHOLD
      });
      return { text: '', isMultiColumn: false, numPages, isScanned: true };
    }
    
    // If we got minimal text (but not necessarily scanned), return empty
    if (extractedText.length < 100) {
      console.warn('[PDF] Extracted text too short', { 
        length: extractedText.length, 
        pages: numPages 
      });
      return { text: '', isMultiColumn: false, numPages };
    }
    
    // Multi-column detection: now that we preserve line structure, split by \n gives actual lines
    const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
    const avgLineLength = lines.reduce((sum, line) => sum + line.trim().length, 0) / Math.max(lines.length, 1);
    const isMultiColumn = avgLineLength < 30 && lines.length > 20;
    
    console.log('[PDF] Successfully extracted text', { 
      pages: numPages,
      pagesProcessed: pagesToProcess,
      textLength: extractedText.length, 
      isMultiColumn,
      extractionTimeMs: extractionTime
    });
    
    return {
      text: extractedText,
      isMultiColumn,
      numPages
    };
  } catch (error) {
    // Log error but don't throw - return empty to trigger scanned PDF detection
    console.warn('[PDF] PDF.js extraction failed:', error.message);
    return { text: '', isMultiColumn: false, numPages: 0 };
  }
}

/**
 * Extract text from PDF using OCR (Tesseract.js)
 * 
 * NOTE: This function is intentionally not implemented for MVP.
 * OCR in Cloudflare Workers has compatibility issues (no OffscreenCanvas, no Web Workers).
 * 
 * For scanned PDFs, we return a helpful error message directing users to upload
 * text-based PDFs or Word documents instead.
 * 
 * Future V2: Implement client-side OCR using Tesseract.js in the browser,
 * or use an external OCR API service.
 */
async function extractPdfWithOCR(arrayBuffer) {
  // This function is kept for API compatibility but should not be called
  // Scanned PDF detection happens in extractPdfText() and throws OCR_REQUIRED error
  throw createExtractionError(
    EXTRACTION_ERRORS.OCR_REQUIRED,
    'This PDF appears to be image-based (scanned). Please upload a text-based PDF or Word document for best results. We\'re working on scan support for a future update.',
    { 
      isScanned: true, 
      requiresOcr: true 
    }
  );
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

