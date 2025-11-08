// Rule-based ATS scoring engine
// Computes numeric scores without AI tokens - uses rules only
// AI is used separately for narrative feedback

/**
 * Score resume using rule-based rubric
 * @param {string} resumeText - Extracted resume text
 * @param {string} jobTitle - Target job title
 * @param {Object} metadata - Resume metadata (isMultiColumn, etc.)
 * @returns {Object} Score breakdown
 */
export function scoreResume(resumeText, jobTitle, metadata = {}) {
  const { isMultiColumn = false } = metadata;
  
  // Normalize job title for keyword matching
  const normalizedJobTitle = normalizeJobTitle(jobTitle);
  const jobKeywords = extractJobKeywords(normalizedJobTitle);
  
  // Score each category
  const keywordScore = scoreKeywordRelevance(resumeText, jobTitle, jobKeywords);
  const formattingScore = scoreFormattingCompliance(resumeText, isMultiColumn);
  const structureScore = scoreStructureAndCompleteness(resumeText);
  const toneScore = scoreToneAndClarity(resumeText);
  const grammarScore = scoreGrammarAndSpelling(resumeText);
  
  // Calculate overall score
  const overallScore = Math.round(
    keywordScore.score +
    formattingScore.score +
    structureScore.score +
    toneScore.score +
    grammarScore.score
  );
  
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
 * Score Keyword Relevance (40 pts)
 */
function scoreKeywordRelevance(resumeText, jobTitle, jobKeywords) {
  const textLower = resumeText.toLowerCase();
  const jobTitleLower = jobTitle.toLowerCase();
  
  // Check for job title match (10 pts)
  let titleScore = 0;
  if (textLower.includes(jobTitleLower)) {
    titleScore = 10;
  } else {
    // Partial match
    const titleWords = jobTitleLower.split(/\s+/);
    const matchedWords = titleWords.filter(word => 
      word.length > 3 && textLower.includes(word)
    );
    titleScore = Math.round((matchedWords.length / titleWords.length) * 10);
  }
  
  // Check for skill keywords (30 pts)
  // Common skill keywords based on job title
  const skillKeywords = getSkillKeywordsForJob(jobTitle);
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
  
  // Check for tables (look for pipe characters or excessive tabs)
  const tablePattern = /\|.*\|/g;
  if (tablePattern.test(resumeText)) {
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
 * Score Grammar & Spelling (10 pts)
 */
function scoreGrammarAndSpelling(resumeText) {
  let score = 10;
  
  // Basic spell check (common errors)
  const commonErrors = [
    { pattern: /\b(recieve|seperate|occured|existance)\b/gi, penalty: 1 },
    { pattern: /\b(its|it's)\b.*\b(its|it's)\b/gi, penalty: 1 }, // Wrong its/it's usage
    { pattern: /\b(their|there|they're)\b.*\b(their|there|they're)\b/gi, penalty: 1 }
  ];
  
  for (const error of commonErrors) {
    if (error.pattern.test(resumeText)) {
      score -= error.penalty;
    }
  }
  
  // Check for consistent tense (should be past tense for past jobs)
  // This is a simplified check
  const presentTenseVerbs = ['develops', 'creates', 'manages', 'leads'];
  const pastTenseVerbs = ['developed', 'created', 'managed', 'led'];
  
  const textLower = resumeText.toLowerCase();
  const presentCount = presentTenseVerbs.filter(v => textLower.includes(v)).length;
  const pastCount = pastTenseVerbs.filter(v => textLower.includes(v)).length;
  
  // If significantly more present tense than past, might be inconsistent
  if (presentCount > pastCount * 1.5 && pastCount > 0) {
    score -= 1;
  }
  
  score = Math.max(0, score);
  
  let feedback = '';
  if (score >= 9) {
    feedback = 'No major errors detected.';
  } else if (score >= 7) {
    feedback = 'Minor grammar issues detected. Review for consistency.';
  } else {
    feedback = 'Grammar and spelling need attention. Proofread carefully.';
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

