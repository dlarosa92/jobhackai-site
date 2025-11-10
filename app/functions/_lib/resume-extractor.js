// Resume text extraction utility for PDF/DOCX/TXT files
// Supports OCR for image-based PDFs using Tesseract.js

import mammoth from 'mammoth';

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
    throw new Error(`Unsupported file type: ${fileExt}. Please upload PDF, DOCX, or TXT.`);
  }

  // Convert file to ArrayBuffer if needed
  let arrayBuffer;
  if (file instanceof ArrayBuffer) {
    arrayBuffer = file;
  } else if (file instanceof Blob) {
    arrayBuffer = await file.arrayBuffer();
  } else {
    throw new Error('Invalid file format');
  }

  // Validate file size (2MB limit)
  if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
    throw new Error('File exceeds 2MB limit. Please compress or use a smaller file.');
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
        throw new Error(`Failed to extract text from DOCX: ${docxError.message}`);
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

    // Validate extracted text
    if (!text || text.trim().length < 50) {
      throw new Error('Could not extract readable text from file. Please upload a text-based résumé or use our DOCX template.');
    }

    // Check if OCR output is too short (likely unreadable)
    if (ocrUsed && text.length < 500) {
      throw new Error('Unreadable scan detected. Please upload a higher-quality file or use our DOCX template.');
    }

    // Clean up text
    text = cleanText(text);
    
    // Detect multi-column layout (heuristic: many short lines)
    if (!isMultiColumn) {
      isMultiColumn = detectMultiColumnLayout(text);
    }

    // Validate text length (80k chars limit)
    if (text.length > 80000) {
      throw new Error('Extracted text exceeds 80,000 character limit. Please use a shorter résumé.');
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
    if (error.message.includes('exceeds') || error.message.includes('limit') || error.message.includes('Unreadable')) {
      throw error;
    }
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}


/**
 * Extract text from PDF file
 */
async function extractPdfText(arrayBuffer) {
  // TODO: [OPENAI INTEGRATION POINT] - Implement PDF.js or pdf-parse
  // For Cloudflare Workers, we need a browser-compatible PDF parser
  // Options: pdf.js-dist or use a service
  
  // For now, return empty text to trigger OCR fallback
  // In production, implement PDF text extraction
  return {
    text: '',
    isMultiColumn: false
  };
}

/**
 * Extract text from PDF using OCR (Tesseract.js)
 */
async function extractPdfWithOCR(arrayBuffer) {
  // TODO: [OPENAI INTEGRATION POINT] - Implement Tesseract.js OCR
  // For Cloudflare Workers, use tesseract.js worker version
  // import { createWorker } from 'tesseract.js';
  // const worker = await createWorker('eng');
  // const { data: { text } } = await worker.recognize(arrayBuffer);
  // await worker.terminate();
  // return text;
  
  throw new Error('OCR extraction not yet implemented. Please upload a text-based PDF.');
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  // Remove excessive line breaks (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  
  // Fix common encoding issues
  text = text.replace(/â€™/g, "'");
  text = text.replace(/â€œ/g, '"');
  text = text.replace(/â€/g, '"');
  text = text.replace(/â€"/g, '—');
  text = text.replace(/â€"/g, '–');
  
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

