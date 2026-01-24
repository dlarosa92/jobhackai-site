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
 * This filter uses a robust two-phase approach:
 * 1. Find where actual resume content starts (after metadata block)
 * 2. Filter any remaining embedded metadata/base64 from content
 *
 * Handles various toMarkdown output formats including:
 * - Plain text headers (Metadata, Contents)
 * - Markdown headers (# Metadata, ## Contents)
 * - Various PDF creator metadata (Adobe, XMP, etc.)
 * - CMYK color definitions from design software
 * - Base64 encoded thumbnails and images
 */
function filterPdfMetadata(text) {
  if (!text) return '';

  const lines = text.split('\n');

  // Phase 1: Find where actual resume content starts
  // toMarkdown typically outputs: filename, Metadata section, Contents, Page N, then actual content
  let contentStartIndex = findContentStartIndex(lines);

  // If we found a clear content start, slice from there
  // Otherwise, fall back to line-by-line filtering from the beginning
  const startIndex = contentStartIndex !== -1 ? contentStartIndex : 0;

  // Phase 2: Filter the content section for any remaining metadata/base64
  const filteredLines = [];
  let inMetadataBlock = contentStartIndex === -1; // If no clear start found, assume we might be in metadata

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines at the beginning
    if (trimmedLine.length === 0) {
      if (filteredLines.length > 0) {
        filteredLines.push(line);
      }
      continue;
    }

    // Strip markdown header syntax for pattern checking
    const cleanLine = stripMarkdownHeaderPrefix(trimmedLine);

    // Skip if this is definitely metadata
    if (isDefinitelyMetadataLine(cleanLine)) {
      continue;
    }

    // Skip base64 encoded data
    if (isBase64Data(cleanLine)) {
      continue;
    }

    // Skip CMYK/color metadata
    if (isCMYKMetadata(cleanLine)) {
      continue;
    }

    // If we haven't confirmed we're in content yet, check if this looks like resume content
    if (inMetadataBlock) {
      if (looksLikeResumeContent(cleanLine)) {
        inMetadataBlock = false;
      } else if (cleanLine.includes('=') && !hasEmailOrUrl(cleanLine)) {
        // Still looks like metadata key=value
        continue;
      } else {
        // Not clearly content, but also not clearly metadata - allow it and exit metadata mode
        inMetadataBlock = false;
      }
    }

    filteredLines.push(line);
  }

  return filteredLines.join('\n').trim();
}

/**
 * Find the index where actual resume content starts
 * Returns -1 if no clear content start marker is found
 */
function findContentStartIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const cleanLine = stripMarkdownHeaderPrefix(line);

    // "Page N" markers indicate content is about to start (next line)
    if (/^Page\s*\d+$/i.test(cleanLine)) {
      // Content starts after "Page N"
      // Skip any empty lines after "Page N"
      let nextIndex = i + 1;
      while (nextIndex < lines.length && lines[nextIndex].trim().length === 0) {
        nextIndex++;
      }
      return nextIndex;
    }

    // Common resume section headers indicate content has started
    if (/^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|AWARDS|CERTIFICATIONS|SUMMARY|OBJECTIVE|PROFILE|ABOUT ME|CONTACT|WORK HISTORY|EMPLOYMENT|PROFESSIONAL EXPERIENCE|TECHNICAL SKILLS|CORE COMPETENCIES|CAREER SUMMARY)/i.test(cleanLine)) {
      return i;
    }

    // A line that looks like a person's name (2-5 capitalized words, no special chars)
    // followed by job title or contact info pattern
    if (looksLikePersonName(cleanLine) && i + 1 < lines.length) {
      // Skip any empty lines after the name (like "Page N" detection does)
      let nextIndex = i + 1;
      while (nextIndex < lines.length && lines[nextIndex].trim().length === 0) {
        nextIndex++;
      }
      if (nextIndex < lines.length) {
        const nextLine = stripMarkdownHeaderPrefix(lines[nextIndex].trim());
        // Check if next non-empty line looks like job title, email, phone, or location
        if (looksLikeJobTitle(nextLine) || hasEmailOrPhone(nextLine) || looksLikeLocation(nextLine)) {
          return i;
        }
      }
    }

    // Email + Phone on same line often indicates header/contact section start
    if (hasEmailAndPhone(cleanLine)) {
      // This might be the start or there's a name before it
      // Look back for a potential name
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const prevClean = stripMarkdownHeaderPrefix(lines[j].trim());
        if (looksLikePersonName(prevClean)) {
          return j;
        }
      }
      return i;
    }
  }

  return -1;
}

/**
 * Strip markdown header prefix (# ## ### etc) from a line
 */
function stripMarkdownHeaderPrefix(line) {
  return line.replace(/^#{1,6}\s*/, '').trim();
}

/**
 * Check if a line is definitely PDF metadata (should always be filtered)
 */
function isDefinitelyMetadataLine(line) {
  const patterns = [
    // PDF filename
    /^[a-zA-Z0-9_\-\s]+\.pdf$/i,
    // Section headers
    /^Metadata$/i,
    /^Contents$/i,
    /^Page\s*\d+$/i,
    // PDF structure fields
    /^PDFFormatVersion=/i,
    /^IsLinearized=/i,
    /^IsAcroFormPresent=/i,
    /^IsXFAPresent=/i,
    /^IsCollectionPresent=/i,
    /^IsSignaturesPresent=/i,
    /^HasXFA=/i,
    /^Linearized=/i,
    /^Tagged=/i,
    /^Encrypted=/i,
    /^PageCount=/i,
    /^PageLayout=/i,
    /^PageMode=/i,
    // Document metadata
    /^CreationDate=/i,
    /^ModDate=/i,
    /^Creator=/i,
    /^Producer=/i,
    /^Title=/i,
    /^Author=/i,
    /^Subject=/i,
    /^Keywords=/i,
    /^Trapped=/i,
    /^AAPL:/i,
    // XMP metadata namespaces
    /^xmp:/i,
    /^xmpmm:/i,
    /^xmpMM:/i,
    /^xmpTPg:/i,
    /^xmptpg:/i,
    /^xmpRights:/i,
    /^xmpidq:/i,
    /^dc:/i,
    /^pdf:/i,
    /^pdfx:/i,
    /^pdfaid:/i,
    /^pdfuaid:/i,
    /^photoshop:/i,
    /^illustrator:/i,
    /^crs:/i,
    /^aux:/i,
    /^exif:/i,
    /^tiff:/i,
    /^stRef:/i,
    /^stEvt:/i,
    // UUID/GUIDs that appear in metadata
    /^uuid:[a-f0-9-]+$/i,
    /^urn:uuid:/i,
  ];

  return patterns.some(p => p.test(line));
}

/**
 * Check if a line contains base64 encoded data
 */
function isBase64Data(line) {
  // Pure base64 string (50+ chars) - covers full-line base64 data
  if (/^[A-Za-z0-9+/=]{50,}$/.test(line)) return true;

  // Embedded base64 after key= (e.g., xmp:thumbnails=200256JPEG/9j/4AAQ...)
  if (/^[\w:]+=[A-Za-z0-9+/]{40,}/.test(line)) return true;

  // JPEG/PNG data signature patterns
  if (/\/9j\/[A-Za-z0-9+/]+/.test(line)) return true; // JPEG
  if (/iVBORw0KGgo[A-Za-z0-9+/]+/.test(line)) return true; // PNG

  return false;
}

/**
 * Check if a line is CMYK color metadata (from design software)
 */
function isCMYKMetadata(line) {
  // CMYKPROCESS indicator
  if (/CMYKPROCESS/i.test(line)) return true;

  // CMYK color values (C=15 M=100 Y=90 K=10)
  if (/^[CKMY]=\d/i.test(line)) return true;
  if (/\b[CKMY]=\d+(\.\d+)?(\s+[CKMY]=\d+(\.\d+)?){2,}/i.test(line)) return true;

  // Color swatch definitions (Grays0C=, Brights0C=)
  // Must have digit after name to avoid filtering "Grays Harbor" etc
  if (/^(Grays|Brights)\d+[CMYK]=/i.test(line)) return true;
  if (/^Default Swatch Group\d+/i.test(line)) return true;

  // Spot color definitions
  if (/^(PANTONE|Spot|Process)\s*(Color)?\s*\d/i.test(line)) return true;

  return false;
}

/**
 * Check if a line looks like actual resume content
 */
function looksLikeResumeContent(line) {
  // Common resume section headers
  if (/^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|AWARDS|CERTIFICATIONS|SUMMARY|OBJECTIVE|PROFILE|ABOUT|CONTACT|WORK|EMPLOYMENT|PROFESSIONAL|TECHNICAL|QUALIFICATIONS|LANGUAGES|INTERESTS|HOBBIES|VOLUNTEER|REFERENCES|PUBLICATIONS)/i.test(line)) {
    return true;
  }

  // Has email pattern
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line)) {
    return true;
  }

  // Has phone pattern
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line)) {
    return true;
  }

  // Has multiple words and no = sign (likely prose/content)
  if (line.split(/\s+/).length >= 3 && !line.includes('=')) {
    return true;
  }

  // Date range patterns common in resumes (2020 - 2023, Jan 2020 - Present)
  if (/\b(19|20)\d{2}\s*[-–—]\s*(Present|\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(line)) {
    return true;
  }

  // Bullet points (common in resumes)
  if (/^[•\-\*]\s+\w/.test(line)) {
    return true;
  }

  return false;
}

/**
 * Check if a line looks like a person's name
 * Supports:
 * - Title case (John Smith), all-caps (JOHN SMITH), and mixed
 * - Hyphenated names (Mary-Jane, Jean-Pierre)
 * - Unicode/accented characters (José García, François Müller, Björk Guðmundsdóttir)
 * - Name prefixes (O'Brien, McDonald, MacArthur, de la Cruz, van der Berg)
 * - Suffixes (Jr., Sr., III, PhD, MD)
 */
function looksLikePersonName(line) {
  // 2-5 words, each starting with capital letter
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;

  // Exclude lines that are PRIMARILY job titles (not just containing a job keyword)
  // "Project Lead" and "Senior Developer" should be rejected
  // "Junior Martinez" and "John Senior" should be allowed (names that happen to contain job keywords)
  if (isPrimarilyJobTitle(line)) return false;

  // Each word should be a valid name component
  // Using Unicode property escapes for international name support
  const suffixes = /^(Jr\.?|Sr\.?|II|III|IV|PhD|MD|MBA|CPA|Esq\.?|[\p{Lu}]\.)$/iu;
  const isValidNameWord = words.every(w => {
    // Known suffixes (check first to avoid false negatives)
    if (suffixes.test(w)) return true;
    // Single initial with optional period (Unicode support for É., Ø., etc.)
    if (/^[\p{Lu}]\.?$/u.test(w)) return true;
    // Name particles (de, la, van, der, von, etc.)
    if (/^(de|la|van|der|von|del|di|da|le|du|dos|das|el|al|bin|ibn|ben)$/i.test(w)) return true;

    // For actual name words, check structure with Unicode support
    // Title-case or all-caps word with Unicode letter support
    // Matches: John, JOHN, José, JOSÉ, François, Müller, Björk, Guðmundsdóttir
    if (isValidNameWordWithUnicode(w)) return true;

    return false;
  });

  if (!isValidNameWord) return false;

  // Should not contain special characters used in metadata
  if (/[=@#$%^&*(){}[\]|\\<>\/]/.test(line)) return false;

  // Should not look like metadata (has both : and =)
  if (/:/.test(line) && /=/.test(line)) return false;

  return true;
}

/**
 * Check if a word is a valid name word, supporting Unicode/accented characters
 * Matches patterns like: John, JOHN, José, JOSÉ, Mary-Jane, O'Brien, D'Angelo, McDonald, MacArthur
 */
function isValidNameWordWithUnicode(word) {
  // Apostrophe names - single letter prefix followed by apostrophe and capitalized name
  // O'Brien, O'Connor, O'Neil (Irish)
  // D'Angelo, D'Arcy, D'Souza (Italian/Portuguese)
  // L'Amour, L'Esperance (French)
  // N'Dour, N'Golo, N'Diaye (West African)
  // Also handles accented versions like Ó'Brien
  if (/^[\p{Lu}]'[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // McDonald, McArthur, McNeil etc
  if (/^Mc[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // MacArthur, MacDonald, MacNeil etc
  if (/^Mac[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // Hyphenated names - title case (Mary-Jane, Jean-Pierre, Anne-Marie)
  if (/^[\p{Lu}][\p{Ll}]+-[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // Hyphenated names - all caps (MARY-JANE)
  if (/^[\p{Lu}]+-[\p{Lu}]+$/u.test(word)) return true;

  // Standard title-case word (John, José, François, Müller)
  // Must start with uppercase, followed by lowercase letters
  if (/^[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // All-caps word (JOHN, JOSÉ, FRANÇOIS) - 2+ uppercase letters
  if (/^[\p{Lu}]{2,}$/u.test(word)) return true;

  return false;
}

/**
 * Check if a line is primarily a job title (not just a name containing a job keyword)
 * "Senior Developer" -> true (job title)
 * "Junior Martinez" -> false (name with "Junior" as first name)
 * "Project Lead" -> true (job title)
 * "John Senior" -> false (name with "Senior" as last name or suffix)
 */
function isPrimarilyJobTitle(line) {
  const words = line.split(/\s+/);

  // Job title role keywords (the "what you do" part)
  // Note: assistant, associate, executive, lead can be standalone roles OR modifiers
  // We keep them here as roles since "Lead" alone is a valid job title
  const roleKeywords = /^(engineer|developer|manager|director|analyst|designer|consultant|specialist|coordinator|administrator|assistant|associate|executive|officer|lead|architect|scientist|researcher|accountant|attorney|lawyer|nurse|doctor|teacher|professor|chef|writer|editor|producer|technician|mechanic|electrician|plumber|carpenter|supervisor|foreman|clerk|secretary|receptionist|representative|agent|broker|advisor|counselor|therapist|pharmacist|veterinarian|dentist|surgeon|physician|pilot|captain|driver|operator)$/i;

  // Job title modifier keywords (the "level/area" part)
  // Note: Removed assistant, associate, executive, lead to avoid duplication with roleKeywords
  // The if/else-if logic means duplicates would always count as roles anyway
  const modifierKeywords = /^(senior|junior|chief|head|principal|staff|managing|general|regional|national|global|vice|deputy|interim|acting|software|web|mobile|frontend|backend|fullstack|full-stack|data|product|project|program|marketing|sales|hr|human|resources|finance|financial|operations|it|ux|ui|qa|quality|devops|cloud|security|network|systems|database|machine|learning|ai|ml)$/i;

  // Count how many words are job-related
  let roleCount = 0;
  let modifierCount = 0;

  for (const word of words) {
    if (roleKeywords.test(word)) roleCount++;
    else if (modifierKeywords.test(word)) modifierCount++;
  }

  // It's primarily a job title if:
  // 1. Has at least one role keyword AND at least one modifier (e.g., "Senior Developer", "Project Manager")
  // 2. Has 2+ role keywords (e.g., "Manager Director" - rare but possible)
  // 3. All words are job-related (e.g., "Software Engineer", "Data Analyst")
  if (roleCount >= 1 && modifierCount >= 1) return true;
  if (roleCount >= 2) return true;
  if (roleCount + modifierCount === words.length && words.length >= 2) return true;

  return false;
}

/**
 * Check if a line looks like a job title
 */
function looksLikeJobTitle(line) {
  const jobTitlePatterns = [
    /\b(engineer|developer|manager|director|analyst|designer|consultant|specialist|coordinator|administrator|assistant|associate|executive|officer|lead|senior|junior|intern|architect|scientist|researcher)\b/i,
    /\b(software|web|mobile|frontend|backend|fullstack|full-stack|data|product|project|program|marketing|sales|hr|human resources|finance|operations|it|ux|ui)\b/i,
  ];

  return jobTitlePatterns.some(p => p.test(line));
}

/**
 * Check if a line looks like a location (city, state/country)
 */
function looksLikeLocation(line) {
  // City, STATE or City, Country patterns
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?,\s*[A-Z]{2}(\s+\d{5})?$/i.test(line)) return true;
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?,\s*[A-Z][a-z]+$/i.test(line)) return true;

  // Common location indicators
  if (/\b(remote|hybrid|onsite|on-site)\b/i.test(line)) return true;

  return false;
}

/**
 * Check if a line has email or URL (but not in metadata context)
 */
function hasEmailOrUrl(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasProtocolUrl = /https?:\/\//.test(line);
  const hasUrlDomain = /\b[a-z0-9-]+\.(com|org|net|io|edu|gov|co|me|info|biz|dev|app)\b/i.test(line);

  return hasEmail || hasProtocolUrl || hasUrlDomain;
}

/**
 * Check if a line has email or phone number
 */
function hasEmailOrPhone(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line);

  return hasEmail || hasPhone;
}

/**
 * Check if a line has both email and phone (common in resume headers)
 */
function hasEmailAndPhone(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line);

  return hasEmail && hasPhone;
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

