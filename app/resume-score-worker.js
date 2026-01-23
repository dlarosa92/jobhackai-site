// JobHackAI ATS Resume Scoring Worker
// Edge-based resume scoring using Cloudflare Workers AI toMarkdown()
// Rule-based scoring engine (no AI tokens) - AI feedback available via OpenAI binding

// Constants - aligned with resume-extractor.js
const SCANNED_PDF_THRESHOLD = 400; // If text < 400 chars after cleaning, likely scanned
const PDF_TEXT_LIMIT = 40000; // Match extractPdfText truncation
const MIN_TEXT_LENGTH = 50; // Match extractor minimum readable text

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = [
      "https://dev.jobhackai.io",
      "https://qa.jobhackai.io",
      "https://app.jobhackai.io",
      "http://localhost:3003",
      "http://localhost:8788"
    ];
    
    const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method Not Allowed" }),
        { 
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    try {
      const formData = await request.formData();
      const file = formData.get("file");
      const jobTitle = formData.get("jobTitle") || "";

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file uploaded" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      // Validate file size (10MB limit)
      const fileSize = file.size;
      if (fileSize > 10 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: "File size exceeds 10MB limit" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      const mime = file.type || "application/pdf";
      const fileName = file.name || "";

      let text = "";
      let ocrUsed = false;
      let isMultiColumn = false;
      const isPdf = mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

      // 1️⃣ Extract text using Cloudflare Workers AI toMarkdown()
      if (isPdf) {
        try {
          // Verify AI binding is available
          if (!env?.AI) {
            throw new Error("AI binding not configured");
          }

          // Use Cloudflare Workers AI toMarkdown() for PDF extraction
          // API expects: { name: string, blob: Blob }
          const blob = new Blob([buffer], { type: "application/pdf" });
          const result = await env.AI.toMarkdown([{
            name: fileName || "resume.pdf",
            blob: blob
          }]);

          // toMarkdown returns an array of results
          const pdfResult = Array.isArray(result) ? result[0] : result;

          if (!pdfResult || pdfResult.error) {
            throw new Error(pdfResult?.error || "toMarkdown returned no result");
          }

          const rawPdfText = pdfResult.data || pdfResult.text || "";
          text = rawPdfText.slice(0, PDF_TEXT_LIMIT).trim();
        } catch (pdfError) {
          console.error("[RESUME-SCORE-WORKER] PDF extraction failed:", pdfError);
          return new Response(
            JSON.stringify({
              error: "Failed to extract text from PDF. Please upload a text-based PDF.",
              details: pdfError.message
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }
      } else if (mime.includes("text") || fileName.toLowerCase().endsWith(".txt")) {
        // Plain text file
        const decoder = new TextDecoder("utf-8");
        text = decoder.decode(buffer);
      } else {
        return new Response(
          JSON.stringify({ error: "Unsupported file type. Please upload PDF or TXT." }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      // 2️⃣ Clean and sanitize text
      // For PDFs: Filter out metadata and base64 image data FIRST
      // This must happen before any other processing to prevent metadata from affecting scoring
      if (isPdf && text && text.trim().length > 0) {
        text = filterPdfMetadata(text);
      }

      // For PDFs: Multi-column detection BEFORE stripMarkdown (to preserve list markers for accurate line length)
      // This matches resume-extractor.js behavior and prevents false positives from shortened lines
      if (isPdf && text && text.trim().length > 0) {
        // Multi-column detection using original text with markdown (preserves list markers)
        const linesForDetection = text.split('\n').filter(line => line.trim().length > 0);
        const avgLineLengthForDetection = linesForDetection.reduce((sum, line) => sum + line.trim().length, 0) / Math.max(linesForDetection.length, 1);
        isMultiColumn = avgLineLengthForDetection < 30 && linesForDetection.length > 20;
      }

      // Strip markdown syntax (toMarkdown returns markdown-formatted text)
      // Note: Only PDFs need markdown stripping (toMarkdown returns markdown)
      if (isPdf) {
        text = stripMarkdown(text);
      }
      // Fix encoding issues and normalize whitespace
      text = cleanText(text);

      // Check if PDF appears to be scanned (only for PDF files, after cleanText for consistency with resume-extractor.js)
      // This check happens at the same stage in both files: after stripMarkdown and cleanText
      if (isPdf && text && text.length < SCANNED_PDF_THRESHOLD) {
        return new Response(
          JSON.stringify({
            error: "This PDF appears to be image-based (scanned). Please upload a text-based PDF for best results."
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      // Fallback multi-column detection post-cleaning (matches extractor behavior)
      if (!isMultiColumn && text) {
        isMultiColumn = detectMultiColumnLayout(text);
      }

      // Final sanitization for scoring (collapses all whitespace)
      text = text.replace(/\s+/g, " ").trim();

      // Validate text quality
      if (!text || text.length < MIN_TEXT_LENGTH) {
        return new Response(
          JSON.stringify({
            error: "Unreadable resume. Please upload a higher-quality file.",
            ocrUsed
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      // Validate text length (80k chars limit)
      if (text.length > 80000) {
        return new Response(
          JSON.stringify({ error: "Resume text exceeds 80,000 character limit" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      // 3️⃣ Run scoring
      const score = calculateAtsScore(text, jobTitle, { isMultiColumn });

      return new Response(
        JSON.stringify({
          success: true,
          ...score,
          metadata: {
            textLength: text.length,
            wordCount: text.split(/\s+/).filter(w => w.length > 0).length,
            ocrUsed,
            isMultiColumn
          }
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    } catch (err) {
      console.error("[RESUME-SCORE-WORKER] Error:", err);
      return new Response(
        JSON.stringify({ 
          error: "Internal server error",
          message: err.message 
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }
  }
};

// 4️⃣ Rule-based ATS scoring engine (no AI)
function calculateAtsScore(text, jobTitle = "", metadata = {}) {
  const { isMultiColumn = false } = metadata;
  
  const breakdown = {
    keywordScore: keywordScore(text, jobTitle),
    formatting: formattingCompliance(text, isMultiColumn),
    structure: sectionCompleteness(text),
    tone: toneClarity(text),
    grammar: grammarCheck(text)
  };

  const total = Math.round(
    Object.values(breakdown).reduce((a, b) => a + b, 0)
  );

  const flags = detectIssues(text, isMultiColumn);

  return {
    score: total,
    breakdown,
    flags
  };
}

// === Subfunctions ===

// Unified keyword scoring function (alias for keywordRelevance)
function keywordScore(text, jobTitle) {
  const textLower = text.toLowerCase();
  const jobTitleLower = (jobTitle || "").toLowerCase();
  
  // Base keywords (can be enhanced with job-title-specific keywords)
  const baseKeywords = [
    "project", "data", "lead", "AWS", "Python", "SQL",
    "JavaScript", "React", "Node", "API", "Git", "Agile"
  ];
  
  // Job-title-specific keywords
  let keywords = [...baseKeywords];
  
  if (jobTitleLower) {
    // Extract meaningful words from job title
    const titleWords = jobTitleLower
      .split(/\s+/)
      .filter(w => w.length > 3 && !["senior", "junior", "lead", "principal"].includes(w));
    keywords = [...titleWords, ...keywords];
  }
  
  // Remove duplicates
  keywords = [...new Set(keywords)];

  let match = 0;
  for (const word of keywords) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const count = (text.match(regex) || []).length;
    if (count > 0 && count <= 3) {
      match += 1;
    }
  }

  // Cap at 40% weight
  return Math.min((match / keywords.length) * 40, 40);
}

// Alias for backward compatibility
const keywordRelevance = keywordScore;

function formattingCompliance(text, isMultiColumn) {
  let score = 20;
  
  // Multi-column penalty (-10 pts)
  if (isMultiColumn) {
    score -= 10;
  }
  
  // Check for problematic characters
  const penalty = 
    (text.includes("│") ? 2 : 0) +
    (text.includes("•") && (text.match(/•/g) || []).length > 20 ? 0 : 0) + // Bullets are OK
    (text.includes("\t") ? 3 : 0);
  
  score -= penalty;
  
  // Check for tables (pipe characters in patterns)
  const tablePattern = /\|.*\|/g;
  if (tablePattern.test(text)) {
    score -= 5;
  }
  
  return Math.max(0, score);
}

function sectionCompleteness(text) {
  const textLower = text.toLowerCase();
  const sections = ["experience", "education", "skills"];
  
  const found = sections.filter(section => {
    return textLower.includes(section) || 
           (section === "experience" && (textLower.includes("work") || textLower.includes("employment"))) ||
           (section === "education" && (textLower.includes("degree") || textLower.includes("university"))) ||
           (section === "skills" && (textLower.includes("technical") || textLower.includes("competencies")));
  }).length;

  return (found / sections.length) * 15;
}

function toneClarity(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  if (sentences.length === 0) {
    return 10;
  }
  
  const avgLength = sentences.reduce((sum, s) => {
    return sum + s.split(/\s+/).filter(w => w.length > 0).length;
  }, 0) / sentences.length;
  
  // Good tone: average sentence length < 25 words
  if (avgLength < 25) {
    return 15;
  } else if (avgLength < 30) {
    return 12;
  } else {
    return 10;
  }
}

function grammarCheck(text) {
  let score = 10;
  
  // Common errors
  const errors = [
    { pattern: /\bteh\b/gi, penalty: 1 },
    { pattern: /\brecieve\b/gi, penalty: 1 },
    { pattern: /\bseperate\b/gi, penalty: 1 },
    { pattern: /\boccured\b/gi, penalty: 1 },
    { pattern: /\bexistance\b/gi, penalty: 1 }
  ];
  
  for (const error of errors) {
    const matches = (text.match(error.pattern) || []).length;
    score -= Math.min(matches * error.penalty, 2); // Cap penalty per error type
  }
  
  return Math.max(0, score);
}

/**
 * Detect multi-column layout in resume text
 * @param {string} text - Resume text to analyze
 * @returns {boolean} - True if multi-column layout detected
 */
function detectMultiColumnLayout(text) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return false;
  }

  const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  
  // If average line length is very short (< 30 chars), likely multi-column
  if (avgLineLength < 30 && lines.length > 20) {
    return true;
  }
  
  // Check for many lines with similar short lengths (column pattern)
  const shortLines = lines.filter(line => line.length < 40);
  if (shortLines.length > lines.length * 0.6) {
    return true;
  }
  
  return false;
}

function detectIssues(text, isMultiColumn) {
  const issues = [];
  const textLower = text.toLowerCase();

  if (text.length < 1000) {
    issues.push("Resume too short (<1 page)");
  }

  if (!textLower.match(/experience|work|employment/i)) {
    issues.push("Missing 'Experience' section");
  }

  if (!textLower.match(/education|degree|university/i)) {
    issues.push("Missing 'Education' section");
  }

  if (isMultiColumn) {
    issues.push("Detected 2-column layout");
  }

  // Check for date formatting
  const datePattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
  const datesFound = (text.match(datePattern) || []).length;

  if (datesFound < 2) {
    issues.push("Inconsistent or missing date formatting");
  }

  return issues;
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
 * - Adobe Illustrator CMYK color metadata (CMYKPROCESS, color values)
 */
function filterPdfMetadata(text) {
  if (!text) return "";

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
    /^xmptpg:/i,
    // Section headers that indicate metadata blocks
    /^Metadata$/i,
    /^Contents$/i,
    // File name at start (e.g., "resume.pdf", "document.pdf")
    /^[a-zA-Z0-9_-]+\.pdf$/i
  ];

  // Split into lines and filter
  const lines = text.split("\n");
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
      // Has multiple words (not a key=value pair) and doesn't contain CMYK metadata
      (trimmedLine.split(/\s+/).length > 2 && !trimmedLine.includes("=") && !trimmedLine.includes("CMYKPROCESS")) ||
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

    // Check for Adobe Illustrator CMYK color metadata
    // Patterns like: "K=40CMYKPROCESS55.00000060...", "C=15 M=100 Y=90 K=10CMYKPROCESS"
    // Also matches color swatch names like "Grays0C=0 M=0 Y=0 K=100CMYKPROCESS"
    if (/CMYKPROCESS/i.test(trimmedLine)) {
      continue;
    }

    // Check for CMYK color value patterns (e.g., "C=15 M=100 Y=90 K=10")
    // These are lines with multiple color channel values
    if (/^[CKMY]=\d/i.test(trimmedLine) || /\b[CKMY]=\d+(\.\d+)?\s+[CKMY]=\d/i.test(trimmedLine)) {
      continue;
    }

    // Check for color swatch group names and definitions
    // Patterns like "Grays0C=", "Brights0C=", "Default Swatch Group0White"
    if (/^(Grays|Brights|Default Swatch Group)/i.test(trimmedLine)) {
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

    // Skip if still in metadata block (key=value pairs, even with spaces for CMYK-like values)
    if (inMetadataBlock) {
      // Check for key=value patterns (with or without spaces)
      if (trimmedLine.includes("=")) {
        // Allow lines that look like actual content (email addresses, URLs with or without protocol)
        const hasEmail = /@/.test(trimmedLine);
        const hasProtocolUrl = /https?:\/\//.test(trimmedLine);
        const hasUrlDomain = /\b[a-z0-9-]+\.(com|org|net|io|edu|gov|co|me|info|biz|dev|app)\b/i.test(trimmedLine);
        if (!hasEmail && !hasProtocolUrl && !hasUrlDomain) {
          continue;
        }
      }
    }

    // This line looks like actual content
    inMetadataBlock = false;
    filteredLines.push(line);
  }

  return filteredLines.join("\n").trim();
}

/**
 * Strip markdown syntax from text
 * toMarkdown() returns markdown-formatted text which can affect scoring
 */
function stripMarkdown(text) {
  if (!text) return "";

  return text
    // Remove headers (# ## ### etc)
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic (**text**, *text*, __text__, _text_)
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Remove inline code (`code`) - extract content only
    .replace(/`([^`]+)`/g, "$1")
    // Remove code blocks (```code```) - extract content only, preserve newlines
    .replace(/```[\s\S]*?```/g, (match) => {
      // Extract content between triple backticks, preserving it as plain text
      const content = match.replace(/^```[\s\S]*?\n?/, "").replace(/\n?```$/, "");
      return content;
    })
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove horizontal rules (---, ***, ___)
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Remove blockquotes (> text)
    .replace(/^>\s+/gm, "")
    // Remove list markers (-, *, +, 1.)
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, "$1");
}

/**
 * Clean extracted text - fix encoding issues and normalize whitespace
 * Matches resume-extractor.js cleanText function
 */
function cleanText(text) {
  if (!text) return "";

  // Remove excessive line breaks (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, "\n\n");

  // Normalize whitespace (but preserve newlines for multi-column detection)
  text = text.replace(/[ \t]+/g, " ");

  // Fix common encoding issues (UTF-8 decoded as Latin-1 mojibake)
  text = text.replace(/â\x80\x99/g, "'");  // Right single quotation mark
  text = text.replace(/â\x80\x9C/g, '"');  // Left double quotation mark
  text = text.replace(/â\x80\x9D/g, '"');  // Right double quotation mark
  text = text.replace(/â\x80\x94/g, "—");  // Em dash
  text = text.replace(/â\x80\x93/g, "–");  // En dash

  return text.trim();
}
