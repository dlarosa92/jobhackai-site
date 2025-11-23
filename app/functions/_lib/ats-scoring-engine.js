// Rule-based ATS scoring engine
// Computes numeric scores without AI tokens - uses rules only
// AI is used separately for narrative feedback

import { calcOverallScore } from './calc-overall-score.js';
import { getGrammarDiagnostics } from './grammar-engine.js';
import { normalizeRoleToFamily } from './role-normalizer.js';
import { ROLE_SKILL_TEMPLATES } from './role-skills.js';

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
  
  // Safety check for missing templates
  const template = ROLE_SKILL_TEMPLATES[roleFamily];
  if (!template) {
    console.warn(`[ATS-SCORING] No template found for roleFamily: ${roleFamily}, using generic_professional`);
  }
  const finalTemplate = template || ROLE_SKILL_TEMPLATES.generic_professional;
  
  const expectedMustHave = finalTemplate.must_have || [];
  const expectedNiceToHave = finalTemplate.nice_to_have || [];
  
  // Score each category
  const keywordScore = scoreKeywordRelevanceWithTemplates(
    resumeText,
    normalizedJobTitle,
    expectedMustHave,
    expectedNiceToHave
  );
  const formattingScore = scoreFormattingCompliance(resumeText, isMultiColumn);
  const structureScore = scoreStructureAndCompleteness(resumeText);
  const toneScore = scoreToneAndClarity(resumeText);
  
  // Get grammar diagnostics (single source of truth)
  const grammarDiagnostics = await getGrammarDiagnostics(env, resumeText, {
    extractionHint
  });

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
    roleSkillSummary: {
      expectedMustHaveCount: keywordScore.expectedMustHaveCount,
      expectedNiceToHaveCount: keywordScore.expectedNiceToHaveCount,
      matchedMustHave: keywordScore.matchedMustHave,
      matchedNiceToHave: keywordScore.matchedNiceToHave,
      missingMustHave: keywordScore.missingMustHave,
      missingNiceToHave: keywordScore.missingNiceToHave
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
      const titleWords = jobTitleLower.split(/\s+/).filter(w => w.length > 0);
      if (titleWords.length > 0) {
        const matchedWords = titleWords.filter(word => 
          word.length > 3 && textLower.includes(word)
        );
        titleScore = Math.round((matchedWords.length / titleWords.length) * 10);
      }
    }
  }
  
  // Must-have skills (30 pts)
  let matchedMustHave = [];
  let missingMustHave = [];
  
  for (const skill of expectedMustHave) {
    const skillLower = skill.toLowerCase();
    // Check if it's a phrase (contains space or hyphen)
    const isPhrase = skillLower.includes(' ') || skillLower.includes('-');
    
    let matches = 0;
    if (isPhrase) {
      // For phrases, check if all words appear in order (flexible matching)
      const words = skillLower.split(/[\s-]+/).filter(w => w.length > 0);
      if (words.length > 0) {
        // Create regex that matches words in order with flexible spacing
        // Add word boundary after each word including the final one
        const phrasePattern = words
          .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*?\\b') + '\\b';
        const phraseRegex = new RegExp(`\\b${phrasePattern}`, 'gi');
        matches = (textLower.match(phraseRegex) || []).length;
      }
    } else {
      // Single word - use word boundary
      const regex = new RegExp(`\\b${skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      matches = (textLower.match(regex) || []).length;
    }
    
    // Count as matched if found 1-3 times (prevent keyword stuffing)
    if (matches > 0 && matches <= 3) {
      matchedMustHave.push(skill);
    } else if (matches === 0) {
      missingMustHave.push(skill);
    }
    // If matches > 3, don't count it (keyword stuffing detected)
  }
  
  const mustHaveScore = expectedMustHave.length > 0
    ? Math.round((matchedMustHave.length / expectedMustHave.length) * 30)
    : 0;
  
  // Nice-to-have skills (10 pts)
  let matchedNiceToHave = [];
  let missingNiceToHave = [];
  
  for (const skill of expectedNiceToHave) {
    const skillLower = skill.toLowerCase();
    const isPhrase = skillLower.includes(' ') || skillLower.includes('-');
    
    let matches = 0;
    if (isPhrase) {
      const words = skillLower.split(/[\s-]+/).filter(w => w.length > 0);
      if (words.length > 0) {
        // Add word boundary after each word including the final one
        const phrasePattern = words
          .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*?\\b') + '\\b';
        const phraseRegex = new RegExp(`\\b${phrasePattern}`, 'gi');
        matches = (textLower.match(phraseRegex) || []).length;
      }
    } else {
      const regex = new RegExp(`\\b${skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      matches = (textLower.match(regex) || []).length;
    }
    
    if (matches > 0 && matches <= 3) {
      matchedNiceToHave.push(skill);
    } else if (matches === 0) {
      missingNiceToHave.push(skill);
    }
  }
  
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
    expectedMustHaveCount: expectedMustHave.length,
    expectedNiceToHaveCount: expectedNiceToHave.length
  };
}

/**
 * Score Keyword Relevance (40 pts) - DEPRECATED: Use scoreKeywordRelevanceWithTemplates instead
 * @deprecated This function is kept for backward compatibility but should not be used for new code
 */
function scoreKeywordRelevance(resumeText, jobTitle, jobKeywords) {
  const textLower = resumeText.toLowerCase();
  const jobTitleLower = (jobTitle || '').toLowerCase();
  
  // Check for job title match (10 pts)
  // Skip if job title is empty - don't award points for empty string match
  let titleScore = 0;
  if (jobTitleLower && jobTitleLower.trim().length > 0) {
    if (textLower.includes(jobTitleLower)) {
      titleScore = 10;
    } else {
      // Partial match
      const titleWords = jobTitleLower.split(/\s+/).filter(w => w.length > 0);
      if (titleWords.length > 0) {
        const matchedWords = titleWords.filter(word => 
          word.length > 3 && textLower.includes(word)
        );
        titleScore = Math.round((matchedWords.length / titleWords.length) * 10);
      }
    }
  }
  
  // Check for skill keywords (30 pts)
  // Common skill keywords based on job title
  const skillKeywords = getSkillKeywordsForJob(jobTitleLower);
  let keywordMatches = 0;
  let totalKeywords = skillKeywords.length;
  
  for (const keyword of skillKeywords) {
    // Count occurrences (but cap at 3 to prevent keyword stuffing penalty)
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = (textLower.match(regex) || []).length;
    if (matches > 0 && matches <= 3) {
      keywordMatches++;
    } else if (matches > 3) {
      // Keyword stuffing detected - don't count this keyword
      totalKeywords--;
    }
  }
  
  const keywordScore = totalKeywords > 0 
    ? Math.round((keywordMatches / totalKeywords) * 30)
    : 0;
  
  const totalScore = Math.min(40, titleScore + keywordScore);
  
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
  
  // Check for keyword stuffing
  const stuffingDetected = skillKeywords.some(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    return (textLower.match(regex) || []).length > 3;
  });
  
  if (stuffingDetected) {
    feedback += ' Avoid repeating keywords excessively.';
  }
  
  return { score: totalScore, feedback };
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
function scoreFormattingCompliance(resumeText, isMultiColumn) {
  let score = 20;
  let issues = [];
  
  // Multi-column penalty (-10 pts)
  if (isMultiColumn) {
    score -= 10;
    issues.push('Multi-column layout detected');
  }
  
  // Check for tables using improved detection
  if (detectTables(resumeText)) {
    score -= 5;
    issues.push('Tables detected');
  }
  
  // Check for standard headings
  const requiredHeadings = ['experience', 'education', 'skills'];
  const textLower = resumeText.toLowerCase();
  const hasExperience = textLower.includes('experience') || textLower.includes('work');
  const hasEducation = textLower.includes('education') || textLower.includes('degree');
  const hasSkills = textLower.includes('skills') || textLower.includes('technical');
  
  if (!hasExperience) {
    score -= 3;
    issues.push('Missing Experience section');
  }
  if (!hasEducation) {
    score -= 2;
    issues.push('Missing Education section');
  }
  if (!hasSkills) {
    score -= 2;
    issues.push('Missing Skills section');
  }
  
  score = Math.max(0, score);
  
  let feedback = '';
  if (score >= 18) {
    feedback = 'Excellent formatting. Avoid tables, graphics, and use standard headings.';
  } else if (score >= 15) {
    feedback = 'Good formatting. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Avoid tables and graphics.';
  } else {
    feedback = 'Formatting needs improvement. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Use single-column layout and standard headings.';
  }
  
  return { score, feedback };
}

/**
 * Score Structure & Completeness (15 pts)
 */
function scoreStructureAndCompleteness(resumeText) {
  let score = 15;
  let issues = [];
  
  // Check section order (Contact, Experience, Education, Skills)
  const textLower = resumeText.toLowerCase();
  const contactIndex = Math.min(
    textLower.indexOf('email'),
    textLower.indexOf('phone'),
    textLower.indexOf('@')
  );
  const experienceIndex = Math.min(
    textLower.indexOf('experience'),
    textLower.indexOf('work history'),
    textLower.indexOf('employment')
  );
  const educationIndex = Math.min(
    textLower.indexOf('education'),
    textLower.indexOf('degree'),
    textLower.indexOf('university')
  );
  
  if (contactIndex === -1 || contactIndex > 500) {
    score -= 2;
    issues.push('Contact information not at top');
  }
  
  if (experienceIndex !== -1 && educationIndex !== -1 && experienceIndex > educationIndex) {
    score -= 2;
    issues.push('Experience should come before Education');
  }
  
  // Check date formatting
  const datePattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
  const datesFound = (resumeText.match(datePattern) || []).length;
  
  if (datesFound < 2) {
    score -= 2;
    issues.push('Inconsistent or missing date formatting');
  }
  
  // Check for job title-company-description order in experience
  const experienceSection = resumeText.substring(
    textLower.indexOf('experience'),
    textLower.indexOf('education') !== -1 ? textLower.indexOf('education') : resumeText.length
  );
  
  // Look for patterns like "Software Engineer at Company Name"
  const jobTitlePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:at|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  const jobMatches = (experienceSection.match(jobTitlePattern) || []).length;
  
  if (jobMatches === 0 && experienceSection.length > 100) {
    score -= 2;
    issues.push('Experience entries should follow Title-Company-Description format');
  }
  
  score = Math.max(0, score);
  
  let feedback = '';
  if (score >= 13) {
    feedback = 'Well-structured resume. Order sections: Contact, Experience, Education, Skills.';
  } else if (score >= 10) {
    feedback = 'Good structure. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Ensure consistent date formatting.';
  } else {
    feedback = 'Structure needs improvement. ' + (issues.length > 0 ? issues.join(', ') + '. ' : '') + 'Follow standard resume format.';
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
        'Automated grammar scoring may be unreliable for this document (for example, scanned, very short, or non-English).'
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
  return { score, feedback };
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

/**
 * Extract keywords from job title
 */
function extractJobKeywords(jobTitle) {
  const words = jobTitle.split(/\s+/).filter(w => w.length > 3);
  return words;
}

/**
 * Get skill keywords based on job title
 */
function getSkillKeywordsForJob(jobTitle) {
  // Handle empty/null/undefined job titles
  if (!jobTitle || typeof jobTitle !== 'string' || jobTitle.trim().length === 0) {
    // Return general tech keywords for empty job titles
    return ['collaboration', 'problem solving', 'communication', 'project management'];
  }
  const jobTitleLower = jobTitle.toLowerCase();
  const keywords = [];
  
  // Software Engineering
  if (jobTitleLower.includes('software') || jobTitleLower.includes('developer') || jobTitleLower.includes('engineer')) {
    keywords.push('javascript', 'python', 'java', 'react', 'node', 'api', 'git', 'agile', 'scrum');
  }
  
  // DevOps/Platform
  if (jobTitleLower.includes('devops') || jobTitleLower.includes('platform') || jobTitleLower.includes('sre')) {
    keywords.push('kubernetes', 'docker', 'ci/cd', 'aws', 'terraform', 'monitoring', 'automation');
  }
  
  // Data Engineering/Science
  if (jobTitleLower.includes('data')) {
    keywords.push('sql', 'python', 'etl', 'data pipeline', 'analytics', 'machine learning');
  }
  
  // AI/ML
  if (jobTitleLower.includes('ai') || jobTitleLower.includes('ml') || jobTitleLower.includes('machine learning')) {
    keywords.push('python', 'tensorflow', 'pytorch', 'nlp', 'deep learning', 'neural networks');
  }
  
  // Product Management
  if (jobTitleLower.includes('product')) {
    keywords.push('roadmap', 'stakeholder', 'agile', 'scrum', 'user research', 'metrics', 'kpi');
  }
  
  // UX/Design
  if (jobTitleLower.includes('ux') || jobTitleLower.includes('design')) {
    keywords.push('user research', 'prototyping', 'figma', 'usability', 'wireframes', 'design system');
  }
  
  // QA/Testing
  if (jobTitleLower.includes('qa') || jobTitleLower.includes('test')) {
    keywords.push('testing', 'automation', 'selenium', 'test cases', 'quality assurance');
  }
  
  // Security
  if (jobTitleLower.includes('security') || jobTitleLower.includes('threat')) {
    keywords.push('security', 'vulnerability', 'penetration testing', 'compliance', 'encryption');
  }
  
  // If no specific match, return general tech keywords
  if (keywords.length === 0) {
    keywords.push('collaboration', 'problem solving', 'communication', 'project management');
  }
  
  return keywords.slice(0, 10); // Limit to 10 keywords
}

