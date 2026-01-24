/**
 * PDF Metadata Filter Utilities
 *
 * Shared functions for filtering PDF metadata from extracted text.
 * Used by both resume-extractor.js and resume-score-worker.js.
 *
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

/**
 * Filter out PDF metadata and base64 image data from extracted text
 */
export function filterPdfMetadata(text) {
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
export function findContentStartIndex(lines) {
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
export function stripMarkdownHeaderPrefix(line) {
  return line.replace(/^#{1,6}\s*/, '').trim();
}

/**
 * Check if a line is definitely PDF metadata (should always be filtered)
 */
export function isDefinitelyMetadataLine(line) {
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
export function isBase64Data(line) {
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
export function isCMYKMetadata(line) {
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
export function looksLikeResumeContent(line) {
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
export function looksLikePersonName(line) {
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
export function isValidNameWordWithUnicode(word) {
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
export function isPrimarilyJobTitle(line) {
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
export function looksLikeJobTitle(line) {
  const jobTitlePatterns = [
    /\b(engineer|developer|manager|director|analyst|designer|consultant|specialist|coordinator|administrator|assistant|associate|executive|officer|lead|senior|junior|intern|architect|scientist|researcher)\b/i,
    /\b(software|web|mobile|frontend|backend|fullstack|full-stack|data|product|project|program|marketing|sales|hr|human resources|finance|operations|it|ux|ui)\b/i,
  ];

  return jobTitlePatterns.some(p => p.test(line));
}

/**
 * Check if a line looks like a location (city, state/country)
 * Uses case-sensitive [A-Z]/[a-z] for title-case (e.g. "San Francisco, CA");
 * the 'i' flag is intentionally omitted so "hello, world" / "foo, bar" are not
 * misclassified as locations.
 */
export function looksLikeLocation(line) {
  // City, STATE or City, Country patterns (case-sensitive for title-case)
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?,\s*[A-Z]{2}(\s+\d{5})?$/.test(line)) return true;
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?,\s*[A-Z][a-z]+$/.test(line)) return true;

  // Common location indicators
  if (/\b(remote|hybrid|onsite|on-site)\b/i.test(line)) return true;

  return false;
}

/**
 * Check if a line has email or URL (but not in metadata context)
 * Extended TLD list to include modern/tech TLDs commonly used by professionals
 */
export function hasEmailOrUrl(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasProtocolUrl = /https?:\/\//.test(line);
  // Extended TLD list: common TLDs + tech/startup TLDs + country codes used generically
  const hasUrlDomain = /\b[a-z0-9-]+\.(com|org|net|io|edu|gov|co|me|info|biz|dev|app|ai|tech|xyz|cloud|design|studio|agency|digital|online|site|website|page|link|click|blog|shop|store|pro|expert|guru|ninja|rocks|solutions|systems|software|services|consulting|engineering|ventures|capital|fund|finance|money|bank|insurance|health|medical|legal|law|realty|property|homes|travel|tours|food|restaurant|cafe|bar|art|music|video|photo|media|news|press|tv|fm|radio|social|chat|email|mail|web|host|server|data|code|hack|labs|works|tools|hub|zone|space|world|global|local|city|nyc|london|paris|berlin|tokyo|asia|africa|eu|uk|de|fr|es|it|nl|au|nz|ca|us|in|sg|hk|jp|kr|cn|br|mx|ar)\b/i.test(line);

  return hasEmail || hasProtocolUrl || hasUrlDomain;
}

/**
 * Check if a line has email or phone number
 */
export function hasEmailOrPhone(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line);

  return hasEmail || hasPhone;
}

/**
 * Check if a line has both email and phone (common in resume headers)
 */
export function hasEmailAndPhone(line) {
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line);

  return hasEmail && hasPhone;
}
