// JobHackAI ATS Resume Scoring Worker
// Edge-based resume scoring using Cloudflare Workers AI toMarkdown()
// Rule-based scoring engine (no AI tokens) - AI feedback available via OpenAI binding

// Constants - aligned with resume-extractor.js
const SCANNED_PDF_THRESHOLD = 400; // If text < 400 chars after cleaning, likely scanned

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

      // 1️⃣ Extract text using Cloudflare Workers AI toMarkdown()
      if (mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
        try {
          // Verify AI binding is available
          if (!env?.AI) {
            throw new Error("AI binding not configured");
          }

          // Use Cloudflare Workers AI toMarkdown() for PDF extraction
          const result = await env.AI.toMarkdown([{
            data: buffer,
            filename: fileName || "resume.pdf"
          }]);

          // toMarkdown returns an array of results
          const pdfResult = Array.isArray(result) ? result[0] : result;

          if (!pdfResult || pdfResult.error) {
            throw new Error(pdfResult?.error || "toMarkdown returned no result");
          }

          text = (pdfResult.data || pdfResult.text || "").trim();
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
      // Strip markdown syntax (toMarkdown returns markdown-formatted text)
      text = stripMarkdown(text);
      // Fix encoding issues and normalize whitespace
      text = cleanText(text);

      // Detect multi-column layout before final sanitization (needs newlines)
      if (text && text.length >= SCANNED_PDF_THRESHOLD) {
        isMultiColumn = detectMultiColumnLayout(text);
      }

      // Final sanitization for scoring
      text = text.replace(/\s+/g, " ").trim();

      // Check if PDF appears to be scanned (very little text after cleaning)
      if (text.length < SCANNED_PDF_THRESHOLD) {
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

      // Validate text quality
      if (!text || text.length < 500) {
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
  const lines = text.split("\n");
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
    // Remove inline code (`code`)
    .replace(/`([^`]+)`/g, "$1")
    // Remove code blocks (```code```)
    .replace(/```[\s\S]*?```/g, "")
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

