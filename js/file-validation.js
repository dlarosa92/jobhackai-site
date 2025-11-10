/**
 * JobHackAI File Validation Utilities
 * Validates file types and detects scanned PDFs
 */

(function() {
  'use strict';

  // Allowed file types
  const ALLOWED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'text/plain'
  ];

  const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];

  // Maximum file size: 2MB
  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  /**
   * Validate file type
   * @param {File} file - File to validate
   * @returns {Object} { valid: boolean, error?: string }
   */
  function validateFileType(file) {
    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));

    // Check extension
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return {
        valid: false,
        error: `File type not supported. Please upload a PDF, DOCX, or TXT file.`
      };
    }

    // Check MIME type (if available)
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      // MIME type mismatch - but extension is valid, so allow it
      // Some browsers don't set MIME types correctly
      console.warn('[FILE-VALIDATION] MIME type mismatch:', file.type, 'but extension is valid');
    }

    return { valid: true };
  }

  /**
   * Validate file size
   * @param {File} file - File to validate
   * @returns {Object} { valid: boolean, error?: string }
   */
  function validateFileSize(file) {
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds 2MB limit. Please compress or use a smaller file.`
      };
    }

    if (file.size === 0) {
      return {
        valid: false,
        error: `File is empty. Please upload a valid file.`
      };
    }

    return { valid: true };
  }

  /**
   * Detect if PDF is likely scanned (image-based)
   * This is a heuristic check - not 100% accurate but catches most cases
   * @param {File} file - PDF file to check
   * @returns {Promise<Object>} { isScanned: boolean, confidence: 'high'|'medium'|'low' }
   */
  async function detectScannedPDF(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return { isScanned: false, confidence: 'low' };
    }

    try {
      // Read first few bytes to check PDF header
      const arrayBuffer = await file.slice(0, 1024).arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Check PDF header (only first 4 bytes)
      const headerBytes = Array.from(uint8Array.slice(0, 4));
      const pdfHeader = String.fromCharCode.apply(null, headerBytes);
      if (pdfHeader !== '%PDF') {
        return { isScanned: false, confidence: 'low' };
      }

      // Heuristic: Check for text extraction markers
      // Scanned PDFs often have fewer text extraction markers
      // Convert uint8Array to string safely (avoid spread operator on large arrays)
      const text = Array.from(uint8Array).map(byte => String.fromCharCode(byte)).join('');
      
      // Look for common PDF text operators
      // Escape regex special characters and use word boundaries to avoid substring matches
      const textOperators = ['BT', 'Tj', 'TJ', 'Td', 'Tm', 'Tf'];
      let textOperatorCount = 0;
      
      for (const op of textOperators) {
        // Escape special regex characters
        const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use word boundaries or look for operators in context (e.g., preceded by space/newline)
        // For PDF operators, they're typically standalone tokens
        const regex = new RegExp(`\\b${escapedOp}\\b|\\s${escapedOp}\\s|\\n${escapedOp}\\n`, 'g');
        const matches = text.match(regex);
        if (matches) {
          textOperatorCount += matches.length;
        }
      }

      // If very few text operators, likely scanned
      if (textOperatorCount < 5) {
        return { isScanned: true, confidence: 'high' };
      }

      // Check file size vs expected text content
      // Scanned PDFs are often larger for the same amount of "content"
      // This is a rough heuristic
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > 1 && textOperatorCount < 20) {
        return { isScanned: true, confidence: 'medium' };
      }

      return { isScanned: false, confidence: 'low' };
    } catch (error) {
      console.warn('[FILE-VALIDATION] Error detecting scanned PDF:', error);
      return { isScanned: false, confidence: 'low' };
    }
  }

  /**
   * Comprehensive file validation
   * @param {File} file - File to validate
   * @returns {Promise<Object>} Validation result
   */
  async function validateFile(file) {
    // Type validation
    const typeCheck = validateFileType(file);
    if (!typeCheck.valid) {
      return typeCheck;
    }

    // Size validation
    const sizeCheck = validateFileSize(file);
    if (!sizeCheck.valid) {
      return sizeCheck;
    }

    // Scanned PDF detection (for PDFs only)
    // Skip OCR detection for free users - show educational modal instead
    if (file.name.toLowerCase().endsWith('.pdf')) {
      // Check user plan
      const userPlan = localStorage.getItem('user-plan') || 'free';
      if (userPlan === 'free') {
        // For free users, detect scanned PDFs but show educational modal instead of blocking
        const scanCheck = await detectScannedPDF(file);
        if (scanCheck.isScanned && scanCheck.confidence === 'high') {
          return {
            valid: true, // Allow upload but show modal
            warning: true,
            warningMessage: 'This appears to be a scanned PDF. For best results, please upload a text-based PDF, DOCX, or TXT file. Scanned PDFs may not be processed correctly.',
            isScanned: true
          };
        }
      } else {
        // For paid users, detect and warn about scanned PDFs
      const scanCheck = await detectScannedPDF(file);
      if (scanCheck.isScanned && scanCheck.confidence === 'high') {
        return {
            valid: true, // Allow upload but show modal about OCR processing
            warning: true,
            warningMessage: 'We\'re scanning your résumé — this may take up to 20 seconds.',
          isScanned: true
        };
        }
      }
    }

    return { valid: true };
  }

  // Export public API
  window.JobHackAIFileValidation = {
    validateFile,
    validateFileType,
    validateFileSize,
    detectScannedPDF,
    ALLOWED_TYPES,
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE
  };
})();

