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
  if (!text) return "";

  const lines = text.split("\n");

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
      } else if (cleanLine.includes("=") && !hasEmailOrUrl(cleanLine)) {
        // Still looks like metadata key=value
        continue;
      } else {
        // Not clearly content, but also not clearly metadata - allow it and exit metadata mode
        inMetadataBlock = false;
      }
    }

    filteredLines.push(line);
  }

  return filteredLines.join("\n").trim();
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
  return line.replace(/^#{1,6}\s*/, "").trim();
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
  if (line.split(/\s+/).length >= 3 && !line.includes("=")) {
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
 * Matches patterns like: John, JOHN, José, JOSÉ, Mary-Jane, O'Brien, O'BRIEN, D'Angelo, McDonald, MacArthur
 */
function isValidNameWordWithUnicode(word) {
  // Apostrophe names - title case
  // O'Brien, O'Connor, O'Neil (Irish)
  // D'Angelo, D'Arcy, D'Souza (Italian/Portuguese)
  // L'Amour, L'Esperance (French)
  // N'Dour, N'Golo, N'Diaye (West African)
  // Also handles accented versions like Ó'Brien
  if (/^[\p{Lu}]'[\p{Lu}][\p{Ll}]+$/u.test(word)) return true;

  // Apostrophe names - all caps (O'BRIEN, D'ANGELO, N'GOLO)
  if (/^[\p{Lu}]'[\p{Lu}]+$/u.test(word)) return true;

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
