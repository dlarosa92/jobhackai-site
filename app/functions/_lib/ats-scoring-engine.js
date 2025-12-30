// Rule-based ATS scoring engine
// Computes numeric scores without AI tokens - uses rules only
// AI is used separately for narrative feedback

import { calcOverallScore } from './calc-overall-score.js';
import { getGrammarDiagnostics } from './grammar-engine.js';
import { normalizeRoleToFamily } from './role-normalizer.js';
import { loadRoleTemplate } from './role-template-loader.js';
import { ROLE_SKILL_TEMPLATES } from './role-skills.js'; // Fallback only

// --- Extraction-quality & heading detection helpers (trust-first) ---
function buildExtractionQuality(grammarDiagnostics) {
  return {
    extractionStatus: grammarDiagnostics?.extractionStatus || 'ok',
    confidence: typeof grammarDiagnostics?.confidence === 'number' ? grammarDiagnostics.confidence : 1.0,
    tokenCount: typeof grammarDiagnostics?.tokenCount === 'number' ? grammarDiagnostics.tokenCount : 0
  };
}

function isHighConfidenceQuality(q) {
  if (!q) return false;
  if (q.extractionStatus && q.extractionStatus !== 'ok') return false;
  return (q.confidence || 0) >= 0.65 && (q.tokenCount || 0) >= 80;
}

function getNormalizedLines(text) {
  return (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.toLowerCase());
}

function anyLineMatches(linesLower, patterns) {
  return linesLower.some((line) => patterns.some((re) => re.test(line)));
}

function detectSectionHeadings(resumeText) {
  const linesLower = getNormalizedLines(resumeText);

  // Headings are commonly short, uppercase, or end with ':' in extracted text.
  // We match whole-line headings to reduce accidental matches inside bullets.
  const patterns = {
    experience: [
      /^experience:?$/,
      /^work experience:?$/,
      /^professional experience:?$/,
      /^employment:?$/,
      /^work history:?$/,
      /^career history:?$/,
      /^relevant experience:?$/,
      /^projects:?$/ // many resumes use Projects as a primary experience proxy
    ],
    education: [
      /^education:?$/,
      /^academic background:?$/,
      /^academics:?$/,
      /^certifications:?$/,
      /^certificates:?$/,
      /^training:?$/
    ],
    skills: [
      /^skills:?$/,
      /^technical skills:?$/,
      /^core skills:?$/,
      /^core competencies:?$/,
      /^competencies:?$/,
      /^technologies:?$/,
      /^technology:?$/,
      /^tech stack:?$/,
      /^tools:?$/,
      /^tooling:?$/,
      /^frameworks:?$/,
      /^languages:?$/
    ]
  };

  const byHeading = {
    experience: anyLineMatches(linesLower, patterns.experience),
    education: anyLineMatches(linesLower, patterns.education),
    skills: anyLineMatches(linesLower, patterns.skills)
  };

  // Fallback: broader substring hints (kept minimal; used only to reduce false positives)
  const textLower = (resumeText || '').toLowerCase();
  const byHint = {
    experience: textLower.includes('\nexperience') || textLower.includes('work experience') || textLower.includes('employment'),
    education: textLower.includes('\neducation') || textLower.includes('university') || textLower.includes('degree'),
    skills: textLower.includes('\nskills') || textLower.includes('tech stack') || textLower.includes('technologies') || textLower.includes('tools')
  };

  return {
    experience: byHeading.experience || byHint.experience,
    education: byHeading.education || byHint.education,
    skills: byHeading.skills || byHint.skills
  };
}

function getTopLines(resumeText, maxLines = 30) {
  return (resumeText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');
}

function detectContactSignals(text) {
  const t = text || '';
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t);
  const hasPhone = /(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(t);
  const hasLinkedIn = /\blinkedin\.com\/in\/[a-z0-9-_%]+/i.test(t);
  const hasGitHub = /\bgithub\.com\/[a-z0-9-_%]+/i.test(t);
  return { hasEmail, hasPhone, hasLinkedIn, hasGitHub };
}

function safeQualityPrefix(quality) {
  const highConf = isHighConfidenceQuality(quality);
  return highConf
    ? ''
    : 'We may not have read your resume perfectly, so some checks are less certain. ';
}

/**
 * Score resume using rule-based rubric
 * @param {string} resumeText - Extracted resume text
 * @param {string} jobTitle - Target job title
 * @param {Object} metadata - Resume metadata (isMultiColumn, etc.)
 * @param {Object} env - Cloudflare environment (for KV-backed grammar engine)
 * @returns {Promise<Object>} Score breakdown
 */
export async function scoreResume(resumeText, jobTitle, metadata = {}, env) {
  const { isMultiColumn = false, extractionHint = null } = metadata;
  
  // Normalize job title for keyword matching
  const normalizedJobTitle = normalizeJobTitle(jobTitle);
  const roleFamily = normalizeRoleToFamily(normalizedJobTitle);
  
  // Load template from D1 (with code fallback)
  const finalTemplate = await loadRoleTemplate(env, roleFamily);
  
  const expectedMustHave = finalTemplate.must_have || [];
  const expectedNiceToHave = finalTemplate.nice_to_have || [];
  
  // Compute grammar diagnostics early so we can gate structure/section checks on extraction quality.
  // This avoids "confidently wrong" missing-section/contact claims when extraction is shaky.
  const grammarDiagnostics = await getGrammarDiagnostics(env, resumeText, {
    extractionHint
  });
  const extractionQuality = buildExtractionQuality(grammarDiagnostics);

  // Score each category
  const keywordScore = scoreKeywordRelevanceWithTemplates(
    resumeText,
    normalizedJobTitle,
    expectedMustHave,
    expectedNiceToHave
  );
  const formattingScore = scoreFormattingCompliance(resumeText, isMultiColumn, extractionQuality);
  const structureScore = scoreStructureAndCompleteness(resumeText, extractionQuality);
  const toneScore = scoreToneAndClarity(resumeText);
  
  // Derive band + final numeric grammar score from diagnostics and other rubric scores
  const { band: grammarBand, finalScore: grammarNumericScore } =
    mapGrammarDiagnosticsToScore(grammarDiagnostics, {
      formattingScore: formattingScore.score,
      structureScore: structureScore.score
    });
  
  const grammarScore = buildGrammarScore(grammarNumericScore, grammarBand);
  
  // Build scores object for overall calculation
  const scores = {
    keywordScore,
    formattingScore,
    structureScore,
    toneScore,
    grammarScore
  };
  
  // Calculate overall score using shared helper
  const overallScore = calcOverallScore(scores);
  
  return {
    keywordScore: {
      score: keywordScore.score,
      max: 40,
      feedback: keywordScore.feedback
    },
    formattingScore: {
      score: formattingScore.score,
      max: 20,
      feedback: formattingScore.feedback
    },
    structureScore: {
      score: structureScore.score,
      max: 15,
      feedback: structureScore.feedback
    },
    toneScore: {
      score: toneScore.score,
      max: 15,
      feedback: toneScore.feedback
    },
    grammarScore: {
      score: grammarScore.score,
      max: 10,
      feedback: grammarScore.feedback
    },
    overallScore,
    roleFamily,
    extractionQuality,
    detectedHeadings: detectSectionHeadings(resumeText),
    roleSkillSummary: {
      expectedMustHaveCount: keywordScore.expectedMustHaveCount,
      expectedNiceToHaveCount: keywordScore.expectedNiceToHaveCount,
      matchedMustHave: keywordScore.matchedMustHave,
      matchedNiceToHave: keywordScore.matchedNiceToHave,
      missingMustHave: keywordScore.missingMustHave,
      missingNiceToHave: keywordScore.missingNiceToHave,
      stuffedMustHave: keywordScore.stuffedMustHave || [],
      stuffedNiceToHave: keywordScore.stuffedNiceToHave || []
    },
    recommendations: generateRecommendations({
      keywordScore,
      formattingScore,
      structureScore,
      toneScore,
      grammarScore
    })
  };
}

/**
 * Check if a skill phrase matches in resume text, handling alternative operators (or, /, |)
 * @param {string} skill - Skill phrase to match (e.g., "Kubernetes or container orchestration", "ETL / ELT pipelines")
 * @param {string} textLower - Lowercase resume text
 * @returns {number} Number of matches found
 */
function matchSkillPhrase(skill, textLower) {
  const skillLower = skill.toLowerCase();
  
  // Check for alternative operators: " or ", " / ", " | "
  // Use word boundaries to ensure we match whole words/phrases
  const alternativePattern = /\s+(?:or|\/|\|)\s+/i;
  if (alternativePattern.test(skillLower)) {
    // Split into alternatives and check if ANY match (OR logic)
    const alternatives = skillLower.split(/\s+(?:or|\/|\|)\s+/i);
    let totalMatches = 0;
    let anyMatched = false;
    
    // Special handling for cases like "ETL / ELT pipelines" where alternatives share a suffix
    // Check if the last alternative contains words that might be a shared suffix
    if (alternatives.length === 2) {
      const first = alternatives[0].trim();
      const second = alternatives[1].trim();
      
      // If first is a single word and second is a phrase, check if first+rest matches
      // Example: "ETL" / "ELT pipelines" -> check "ETL pipelines" and "ELT pipelines"
      // But also check "first" standalone for cases like "Kubernetes or container orchestration"
      const firstWords = first.split(/\s+/);
      const secondWords = second.split(/\s+/);
      
      if (firstWords.length === 1 && secondWords.length > 1) {
        // Check "first" as standalone (e.g., "Kubernetes", "ETL")
        const firstStandaloneMatches = matchSkillPhrase(first, textLower);
        if (firstStandaloneMatches > 0) {
          totalMatches += firstStandaloneMatches;
          anyMatched = true;
        }
        
        // Check if second part starts with a single word that might be an alternative
        // Then check "first + rest" (e.g., "ETL pipelines" when first="ETL", second="ELT pipelines")
        const secondFirstWord = secondWords[0];
        const secondRest = secondWords.slice(1).join(' ');
        
        // Only combine first+rest if it makes sense (second starts with alternative word)
        // For "ETL / ELT pipelines", secondFirstWord="ELT" is an alternative to first="ETL"
        // For "Kubernetes or container orchestration", secondFirstWord="container" is NOT an alternative
        // In the latter case, we've already checked "Kubernetes" standalone above
        const firstCombined = `${first} ${secondRest}`.trim();
        const firstCombinedMatches = matchSkillPhrase(firstCombined, textLower);
        if (firstCombinedMatches > 0) {
          totalMatches += firstCombinedMatches;
          anyMatched = true;
        }
        
        // Check "second" as-is (e.g., "ELT pipelines", "container orchestration")
        const secondMatches = matchSkillPhrase(second, textLower);
        if (secondMatches > 0) {
          totalMatches += secondMatches;
          anyMatched = true;
        }
        
        return anyMatched ? totalMatches : 0;
      }
    }
    
    // General case: check each alternative independently
    for (const alternative of alternatives) {
      const trimmed = alternative.trim();
      if (!trimmed) continue;
      
      // Check if this alternative matches (recursive call for phrases within alternatives)
      const altMatches = matchSkillPhrase(trimmed, textLower);
      if (altMatches > 0) {
        totalMatches += altMatches;
        anyMatched = true;
      }
    }
    
    // Return matches if at least one alternative matched (OR logic)
    // We sum matches to detect keyword stuffing across alternatives
    return anyMatched ? totalMatches : 0;
  }
  
  // No alternatives - use standard phrase matching (AND logic for all words)
  const isPhrase = /[\s\-/&,()]/.test(skillLower);
  
  if (isPhrase) {
    // For phrases, extract meaningful words (filter out punctuation-only tokens)
    // Split on spaces, hyphens, slashes, and other common separators
    const words = skillLower
      .split(/[\s\-/&,()]+/)
      .filter(w => w.length > 0 && /[a-z0-9]/.test(w)); // Keep only alphanumeric tokens
    
    if (words.length > 0) {
      // Create regex that matches words in order with flexible separators
      // Allows any punctuation or whitespace between words
      // Add word boundary after each word including the final one
      const phrasePattern = words
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\-\\/&,()]*?\\b') + '\\b';
      const phraseRegex = new RegExp(`\\b${phrasePattern}`, 'gi');
      return (textLower.match(phraseRegex) || []).length;
    }
  } else {
    // Single word - use word boundary
    const regex = new RegExp(`\\b${skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    return (textLower.match(regex) || []).length;
  }
  
  return 0;
}

/**
 * Score Keyword Relevance using role-based skill templates (40 pts)
 * @param {string} resumeText - Resume text to analyze
 * @param {string} jobTitle - Target job title
 * @param {string[]} expectedMustHave - Must-have skills from template
 * @param {string[]} expectedNiceToHave - Nice-to-have skills from template
 * @returns {Object} Score object with metadata
 */
function scoreKeywordRelevanceWithTemplates(resumeText, jobTitle, expectedMustHave, expectedNiceToHave) {
  const textLower = resumeText.toLowerCase();
  const jobTitleLower = (jobTitle || '').toLowerCase();
  
  // Job title match (10 pts) - keep existing logic
  let titleScore = 0;
  if (jobTitleLower && jobTitleLower.trim().length > 0) {
    if (textLower.includes(jobTitleLower)) {
      titleScore = 10;
    } else {
      // Partial match
      // Special-case short acronyms (e.g. "ios", "ml", "qa") so they are not ignored.
      // Require the *same* acronym to appear in both the job title and the resume text.
      const ACRONYM_ALLOW = ['ios', 'ml', 'qa'];
      // Use word-boundary regexes to avoid substring matches (e.g., "ml" in "html")
      if (ACRONYM_ALLOW.some(a => {
        const safe = a.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
        const re = new RegExp(`\\b${safe}\\b`, 'i');
        return re.test(jobTitleLower) && re.test(textLower);
      })) {
        titleScore = 10;
      } else {
        const titleWords = jobTitleLower.split(/\s+/).filter(w => w.length > 0);
        if (titleWords.length > 0) {
          const matchedWords = titleWords.filter(word => 
            word.length > 3 && textLower.includes(word)
          );
          titleScore = Math.round((matchedWords.length / titleWords.length) * 10);
        }
      }
    }
  }
  
  // Must-have skills (30 pts)
  let matchedMustHave = [];
  let missingMustHave = [];
  let stuffedMustHave = []; // Track keyword stuffing separately
  
  for (const skill of expectedMustHave) {
    // Use matchSkillPhrase to handle alternative operators (or, /, |)
    const matches = matchSkillPhrase(skill, textLower);
    
    // Count as matched if found at least once (skill exists in resume)
    if (matches > 0) {
      matchedMustHave.push(skill);
      // If matches > 3, also track as keyword stuffing for feedback
      if (matches > 3) {
        stuffedMustHave.push(skill);
      }
    } else {
      missingMustHave.push(skill);
    }
  }
  
  // Calculate score: all skills count as matched if they appear at least once
  // Stuffed skills are still counted as matched, but flagged separately for feedback
  const mustHaveScore = expectedMustHave.length > 0
    ? Math.round((matchedMustHave.length / expectedMustHave.length) * 30)
    : 0;
  
  // Nice-to-have skills (10 pts)
  let matchedNiceToHave = [];
  let missingNiceToHave = [];
  let stuffedNiceToHave = []; // Track keyword stuffing separately
  
  for (const skill of expectedNiceToHave) {
    // Use matchSkillPhrase to handle alternative operators (or, /, |)
    const matches = matchSkillPhrase(skill, textLower);
    
    // Count as matched if found at least once (skill exists in resume)
    if (matches > 0) {
      matchedNiceToHave.push(skill);
      // If matches > 3, also track as keyword stuffing for feedback
      if (matches > 3) {
        stuffedNiceToHave.push(skill);
      }
    } else {
      missingNiceToHave.push(skill);
    }
  }
  
  // Calculate score: all skills count as matched if they appear at least once
  // Stuffed skills are still counted as matched, but flagged separately for feedback
  const niceToHaveScore = expectedNiceToHave.length > 0
    ? Math.round((matchedNiceToHave.length / expectedNiceToHave.length) * 10)
    : 0;
  
  const totalScore = Math.min(40, titleScore + mustHaveScore + niceToHaveScore);
  
  // Generate feedback
  let feedback = '';
  if (totalScore >= 35) {
    feedback = 'Excellent keyword alignment with your target role.';
  } else if (totalScore >= 25) {
    feedback = 'Good keyword coverage. Add more industry-specific terms for your target job.';
  } else if (totalScore >= 15) {
    feedback = 'Add more industry keywords for your target job.';
  } else {
    feedback = 'Significantly improve keyword relevance by adding role-specific skills and terms.';
  }
  
  // Return with metadata for roleSkillSummary
  return { 
    score: totalScore, 
    feedback,
    matchedMustHave,
    matchedNiceToHave,
    missingMustHave,
    missingNiceToHave,
    stuffedMustHave,
    stuffedNiceToHave,
    expectedMustHaveCount: expectedMustHave.length,
    expectedNiceToHaveCount: expectedNiceToHave.length
  };
}


/**
 * Detect tables in resume text (improved to ignore header lines)
 */
function detectTables(resumeText) {
  const lines = resumeText.split('\n');
  let tableLikeLines = 0;
  
  for (const line of lines) {
    const pipeCount = (line.match(/\|/g) || []).length;
    
    // Skip header-like lines (email | phone | location)
    const isHeaderLine = 
      pipeCount > 0 &&
      line.length < 140 &&
      (/@/.test(line) || /(\(\d{3}\)\s*[- ]?|\d{3}[- ])\d{3}[- ]\d{4}/.test(line));
    
    // Only count as table if: 3+ pipes AND not a header line
    if (pipeCount >= 3 && !isHeaderLine) {
      tableLikeLines++;
    }
  }
  
  // Require at least 2 table-like lines to flag as "tables detected"
  return tableLikeLines >= 2;
}

/**
 * Score Formatting Compliance (20 pts)
 */
/**
 * Score Formatting Compliance (20 pts) – trust-first version (quality-gated)
 */
function scoreFormattingCompliance(resumeText, isMultiColumn, quality) {
  let score = 20;
  const issues = [];
  const highConf = isHighConfidenceQuality(quality);

  // Multi-column penalty (-10 pts)
  if (isMultiColumn) {
    score -= 10;
    issues.push('Multi-column layout detected');
  }

  // Tables penalty (-5 pts)
  if (detectTables(resumeText)) {
    score -= 5;
    issues.push('Tables detected');
  }

  // Headings detection (synonyms + heading-line matching)
  const headings = detectSectionHeadings(resumeText);

  if (!headings.experience) {
    if (highConf) score -= 3;
    issues.push(
      highConf
        ? 'Experience section not detected'
        : 'Couldn’t confidently detect an Experience heading (may be labeled differently)'
    );
  }
  if (!headings.education) {
    if (highConf) score -= 2;
    issues.push(
      highConf
        ? 'Education section not detected'
        : 'Couldn’t confidently detect an Education heading (may be labeled differently)'
    );
  }
  if (!headings.skills) {
    if (highConf) score -= 2;
    issues.push(
      highConf
        ? 'Skills section not detected'
        : 'Couldn’t confidently detect a Skills heading (e.g., “Tech Stack”, “Technologies”)'
    );
  }

  score = Math.max(0, score);

  // Cap perfect scores when confidence is low to show uncertainty
  if (!highConf && score >= 18) {
    score = 17; // Cap at 17/20 to show we're not 100% certain
  }

  const prefix = safeQualityPrefix(quality);
  let feedback = '';
  if (score >= 18) {
    feedback = prefix + 'Excellent formatting. Avoid tables, graphics, and use standard headings.';
  } else if (score === 17 && !highConf) {
    // Score was capped from 18+ due to low confidence - acknowledge uncertainty
    // Note: prefix already mentions uncertainty, so we don't repeat it here
    feedback = prefix + 'Formatting appears good based on what we could read.';
  } else if (score >= 15) {
    feedback =
      prefix +
      'Good formatting. ' +
      (issues.length > 0 ? issues.join(', ') + '. ' : '') +
      'Avoid tables and graphics.';
  } else {
    feedback =
      prefix +
      'Formatting needs improvement. ' +
      (issues.length > 0 ? issues.join(', ') + '. ' : '') +
      'Use single-column layout and standard headings.';
  }

  return { score, feedback };
}

/**
 * Score Structure & Completeness (15 pts)
 */
/**
 * Score Structure & Completeness (15 pts) – trust-first version (quality-gated)
 */
function scoreStructureAndCompleteness(resumeText, quality) {
  let score = 15;
  const issues = [];
  const highConf = isHighConfidenceQuality(quality);

  const textLower = (resumeText || '').toLowerCase();

  // Contact placement: only penalize if we can detect contact somewhere AND we're confident.
  const topBlock = getTopLines(resumeText, 30);
  const topContact = detectContactSignals(topBlock);
  const anyContact = detectContactSignals(resumeText);
  const hasAnyContact = anyContact.hasEmail || anyContact.hasPhone || anyContact.hasLinkedIn || anyContact.hasGitHub;
  const hasTopContact = topContact.hasEmail || topContact.hasPhone || topContact.hasLinkedIn || topContact.hasGitHub;

  if (highConf && hasAnyContact && !hasTopContact) {
    score -= 2;
    issues.push('Contact details may not be near the top');
  } else if (!highConf && hasAnyContact && !hasTopContact) {
    issues.push('Contact placement check is less certain due to extraction quality');
  }

  // Order check: Experience should come before Education (only if both are present as headings).
  if (highConf) {
    const expIdx = textLower.indexOf('experience');
    const eduIdx = textLower.indexOf('education');
    if (expIdx !== -1 && eduIdx !== -1 && expIdx > eduIdx) {
      score -= 2;
      issues.push('Experience should come before Education');
    }
  }

  // Date formatting: broaden patterns; only enforce when confident.
  if (highConf) {
    const monthYear = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
    const numericMonthYear = /\b\d{1,2}[\/\-]\d{4}\b/g;
    const yearOnly = /\b(19|20)\d{2}\b/g;
    // Count distinct date occurrences (avoid double-counting years inside other date matches)
    const spans = [];
    const pushSpan = (start, end) => {
      if (typeof start !== 'number' || typeof end !== 'number') return;
      if (start < 0 || end <= start) return;
      spans.push([start, end]);
    };

    for (const m of resumeText.matchAll(monthYear)) {
      pushSpan(m.index, m.index + m[0].length);
    }
    for (const m of resumeText.matchAll(numericMonthYear)) {
      pushSpan(m.index, m.index + m[0].length);
    }

    const isInsideSpan = (idx) => spans.some(([s, e]) => idx >= s && idx < e);
    const standaloneYears = new Set();
    for (const m of resumeText.matchAll(yearOnly)) {
      const idx = typeof m.index === 'number' ? m.index : -1;
      if (idx === -1) continue;
      if (isInsideSpan(idx)) continue; // don't count "2020" inside "Jan 2020" or "01/2020"
      standaloneYears.add(m[0]);
    }

    const datesFound = spans.length + standaloneYears.size;
    if (datesFound < 2) {
      score -= 2;
      issues.push('Date formatting may be inconsistent');
    }
  }

  // Experience entry parseability: guard and soften.
  if (highConf) {
    const expStart = textLower.indexOf('experience');
    if (expStart !== -1) {
      const eduStart = textLower.indexOf('education');
      const experienceSection = resumeText.substring(expStart, eduStart !== -1 ? eduStart : resumeText.length);
      const jobTitlePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:at|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
      const jobMatches = (experienceSection.match(jobTitlePattern) || []).length;
      if (jobMatches === 0 && experienceSection.length > 140) {
        score -= 1;
        issues.push('Experience entries may be easier for ATS to parse with a consistent Title → Company format');
      }
    }
  }

  score = Math.max(0, score);

  // Cap perfect scores when confidence is low to show uncertainty
  if (!highConf && score >= 13) {
    score = 12; // Cap at 12/15 to show uncertainty
  }

  const prefix = safeQualityPrefix(quality);
  let feedback = '';
  if (score >= 13) {
    feedback = prefix + 'Well-structured resume. Order sections: Contact, Experience, Education, Skills.';
  } else if (score === 12 && !highConf) {
    // Score was capped from 13+ due to low confidence - acknowledge uncertainty
    // Note: prefix already mentions uncertainty, so we don't repeat it here
    feedback = prefix + 'Structure appears good based on what we could read.';
  } else if (score >= 10) {
    feedback = prefix + 'Good structure. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Ensure consistent formatting.';
  } else {
    feedback = prefix + 'Structure may need improvement. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Follow a standard resume format.';
  }

  return { score, feedback };
}

/**
 * Score Tone & Clarity (15 pts)
 */
function scoreToneAndClarity(resumeText) {
  let score = 15;
  
  // Check sentence length (should be < 25 words on average)
  const sentences = resumeText.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const avgWordsPerSentence = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
    : 0;
  
  if (avgWordsPerSentence > 25) {
    score -= 3;
  } else if (avgWordsPerSentence > 20) {
    score -= 1;
  }
  
  // Check for action verbs
  const actionVerbs = [
    'developed', 'created', 'implemented', 'designed', 'built', 'managed',
    'led', 'improved', 'increased', 'reduced', 'optimized', 'delivered',
    'achieved', 'executed', 'launched', 'established', 'transformed'
  ];
  
  const textLower = resumeText.toLowerCase();
  const actionVerbCount = actionVerbs.filter(verb => textLower.includes(verb)).length;
  const verbDensity = actionVerbCount / (resumeText.split(/\s+/).length / 100);
  
  if (verbDensity < 2) {
    score -= 3;
  } else if (verbDensity < 3) {
    score -= 1;
  }
  
  // Check for bullet points
  const bulletPoints = (resumeText.match(/^[\s]*[•\-\*]\s+/gm) || []).length;
  if (bulletPoints < 5) {
    score -= 2;
  }
  
  // Check for metrics/quantification
  const metricsPattern = /\d+%/g;
  const hasMetrics = metricsPattern.test(resumeText);
  if (!hasMetrics) {
    score -= 1;
  }
  
  score = Math.max(0, score);
  
  let feedback = '';
  if (score >= 13) {
    feedback = 'Excellent tone and clarity. Use action verbs and concise bullet points.';
  } else if (score >= 10) {
    feedback = 'Good clarity. Use more action verbs and quantify impact with metrics.';
  } else {
    feedback = 'Improve clarity. Use action verbs, concise bullet points, and quantify outcomes.';
  }
  
  return { score, feedback };
}

/**
 * Map grammar diagnostics + rubric scores into a band and final numeric score.
 * Higher-quality bands are checked first; the first matching rule wins.
 */
function mapGrammarDiagnosticsToScore(diagnostics, context) {
  const {
    rawScore,
    misspellPenalty,
    structurePenalty,
    passiveRatio,
    repeatedWords,
    longParaCount,
    dictionaryHitRate,
    extractionStatus,
    confidence,
    tokenCount
  } = diagnostics;

  const { formattingScore, structureScore } = context;

  const lowConfidence =
    extractionStatus === 'empty' ||
    extractionStatus === 'scanned_pdf' ||
    extractionStatus === 'very_short' ||
    extractionStatus === 'probably_non_english' ||
    confidence < 0.5;

  if (lowConfidence) {
    return {
      band: 'neutral_low_conf',
      finalScore: 6
    };
  }

  let band;
  let finalScore = rawScore;
  const raw = rawScore;

  // Excellent (A) band
  if (
    formattingScore >= 18 &&
    structureScore >= 13 &&
    raw >= 8.5 &&
    misspellPenalty <= 1 &&
    structurePenalty <= 1 &&
    dictionaryHitRate >= 0.8 &&
    passiveRatio <= 0.25 &&
    !repeatedWords &&
    longParaCount <= 1
  ) {
    band = 'excellent';
    if (finalScore < 9) finalScore = 9; // floor into 9–10 band
  }
  // Good (B) band
  else if (
    formattingScore >= 15 &&
    structureScore >= 11 &&
    raw >= 7 &&
    misspellPenalty <= 2 &&
    structurePenalty <= 2 &&
    dictionaryHitRate >= 0.7
  ) {
    band = 'good';
    if (finalScore < 7) finalScore = 7; // clamp into 7–8 band
    if (finalScore > 8) finalScore = 8; // clamp into 7–8 band
  }
  // Fair (C) band – catch all scores >= 5 that don't qualify for higher bands
  // This includes scores >= 7 that don't meet Good band formatting/structure requirements
  else if (raw >= 5) {
    band = 'fair';
    // If raw score is >= 7, preserve it in [7, 8) range (good grammar, imperfect formatting/structure)
    // If raw score is < 7, clamp to [5, 7) range
    // This prevents scores >= 7 from being incorrectly penalized down to 5
    if (raw >= 7) {
      if (finalScore < 7) finalScore = 7;
      if (finalScore > 8) finalScore = 8;
    } else {
      if (finalScore < 5) finalScore = 5;
      if (finalScore > 7) finalScore = 7;
    }
  }
  // Poor (D) band
  else if (raw >= 3) {
    band = 'poor';
    if (finalScore < 3) finalScore = 3;
    if (finalScore > 5) finalScore = 5;
  }
  // Very poor (E) band
  else {
    band = 'very_poor';
    if (finalScore > 3) finalScore = 3;
  }

  if (finalScore < 0) finalScore = 0;
  if (finalScore > 10) finalScore = 10;

  return { band, finalScore };
}

/**
 * Map numeric grammar score to feedback text (granular bands).
 * Provides distinct feedback for different score ranges.
 */
function buildGrammarScore(score, band = null) {
  // Special feedback for low-confidence / noisy inputs.
  if (band === 'neutral_low_conf') {
    return {
      score,
      feedback:
        'Automated grammar scoring may be unreliable for this document (for example, scanned, very short, or non-English).',
      aiCheckRequired: false // Don't run AI check on low-confidence inputs
    };
  }

  let feedback = '';
  if (score >= 9) {
    feedback = 'No major errors detected.';
  } else if (score >= 8) {
    feedback = 'Minor grammar issues detected. Review for consistency.';
  } else if (score >= 7) {
    feedback = 'Some grammar and spelling issues found. Proofread carefully.';
  } else if (score >= 5) {
    feedback = 'Multiple grammar and spelling errors detected. Review and correct key sections.';
  } else if (score >= 3) {
    feedback = 'Significant grammar and spelling problems. Thorough proofreading required.';
  } else {
    feedback = 'Severe grammar and spelling issues. Professional editing is recommended.';
  }
  
  // Set aiCheckRequired flag when rule-based score is perfect (>= 9)
  // This triggers AI verification in hybrid-grammar-scoring.js
  const aiCheckRequired = score >= 9;
  
  return { score, feedback, aiCheckRequired };
}

/**
 * Generate recommendations from scores
 */
function generateRecommendations(scores) {
  const recommendations = [];
  
  if (scores.keywordScore.score < 30) {
    recommendations.push('Add more industry-specific keywords related to your target role');
  }
  
  if (scores.formattingScore.score < 15) {
    recommendations.push('Convert to single-column format and use standard section headings');
  }
  
  if (scores.structureScore.score < 12) {
    recommendations.push('Reorganize sections in standard order: Contact, Experience, Education, Skills');
  }
  
  if (scores.toneScore.score < 12) {
    recommendations.push('Use more action verbs and quantify achievements with metrics');
  }
  
  if (scores.grammarScore.score < 8) {
    recommendations.push('Proofread for grammar and spelling errors');
  }
  
  return recommendations;
}

/**
 * Normalize job title for keyword matching
 */
function normalizeJobTitle(jobTitle) {
  // Handle null/undefined/empty strings
  if (!jobTitle || typeof jobTitle !== 'string' || jobTitle.trim().length === 0) {
    return '';
  }
  return jobTitle.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}


