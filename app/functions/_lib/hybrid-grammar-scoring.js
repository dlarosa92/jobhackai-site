// Unified hybrid grammar scoring module
// Consolidates grammar-AI verification logic used across endpoints
// Uses Bugbot's fixed deduction logic

import { verifyGrammarWithAI } from './grammar-ai-check.js';
import { calcOverallScore } from './calc-overall-score.js';

/**
 * Clean resume text for grammar AI processing
 * Normalizes whitespace, removes control characters, trims, and limits length
 * Preserves Unicode characters (accented names, em dashes, smart quotes, etc.)
 * @param {string} text - Raw resume text
 * @returns {string} Cleaned and truncated text (max 2000 chars)
 */
function cleanResumeForGrammarAI(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    .replace(/\s+/g, ' ')
    // Remove only control characters (0x00-0x1F) and DEL (0x7F)
    // Preserve all printable Unicode characters (accented names, em dashes, etc.)
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .substring(0, 2000);
}

/**
 * Create a deep copy of the rule-based scores object
 * @param {Object} scores - Original scores object
 * @returns {Object} Deep copy of scores object
 */
function deepCopyScores(scores) {
  return JSON.parse(JSON.stringify(scores));
}

/**
 * Apply hybrid grammar scoring with AI verification
 * Only runs AI check if rule-based score is perfect (aiCheckRequired flag)
 * Uses Bugbot's fixed deduction logic: originalScore - 3
 * 
 * @param {Object} params - Parameters object
 * @param {Object} params.ruleBasedScores - Score object from scoring engine
 * @param {string} params.resumeText - Resume text to check
 * @param {Object} params.env - Environment variables
 * @param {string} [params.resumeId] - Optional resume ID for logging
 * @returns {Promise<Object>} Updated ruleBasedScores object (deep copy, does not mutate input)
 */
export async function applyHybridGrammarScoring({ ruleBasedScores, resumeText, env, resumeId }) {
  // Create a deep copy to avoid mutating the original object
  const scoresCopy = deepCopyScores(ruleBasedScores);
  
  // Only proceed if AI check is required (rule-based score is perfect)
  if (!scoresCopy.grammarScore?.aiCheckRequired) {
    return scoresCopy;
  }

  try {
    // Clean and prepare resume text for AI check
    const cleanedText = cleanResumeForGrammarAI(resumeText);
    
    if (!cleanedText || cleanedText.length < 10) {
      console.warn('[HYBRID-GRAMMAR] Cleaned text too short, skipping AI check');
      return scoresCopy;
    }

    // Call AI verification
    const errorsPresent = await verifyGrammarWithAI(cleanedText, env);
    
    if (errorsPresent) {
      // Apply Bugbot's fixed deduction logic: originalScore - 3
      const deduction = 3;
      const originalScore = scoresCopy.grammarScore.score;
      const newScore = Math.max(0, originalScore - deduction);
      scoresCopy.grammarScore.score = newScore;
      
      // Update feedback message
      scoresCopy.grammarScore.feedback =
        'Some grammar or spelling inconsistencies were detected. Review and correct misspellings.';
      
      // Recalculate overall score using shared helper
      scoresCopy.overallScore = calcOverallScore(scoresCopy);
      
      console.log('[GRAMMAR-AI] checked:', { 
        resumeId: resumeId || 'unknown', 
        errorsPresent, 
        originalScore, 
        newScore, 
        deduction 
      });
    } else {
      console.log('[GRAMMAR-AI] checked:', { 
        resumeId: resumeId || 'unknown', 
        errorsPresent: false 
      });
    }
  } catch (grammarCheckError) {
    // Fail gracefully - keep original score if AI check fails
    console.error('[GRAMMAR-AI] Grammar check error (non-fatal):', grammarCheckError);
  }

  return scoresCopy;
}

