// Unified hybrid grammar scoring module
// Consolidates grammar-AI verification logic used across endpoints
// Uses Bugbot's fixed deduction logic

import { verifyGrammarWithAI } from './grammar-ai-check.js';
import { calcOverallScore } from './calc-overall-score.js';

/**
 * Clean resume text for grammar AI processing
 * Normalizes whitespace, removes non-ASCII characters, trims, and limits length
 * @param {string} text - Raw resume text
 * @returns {string} Cleaned and truncated text (max 2000 chars)
 */
function cleanResumeForGrammarAI(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .substring(0, 2000);
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
 * @returns {Promise<Object>} Updated ruleBasedScores object
 */
export async function applyHybridGrammarScoring({ ruleBasedScores, resumeText, env, resumeId }) {
  // Only proceed if AI check is required (rule-based score is perfect)
  if (!ruleBasedScores.grammarScore?.aiCheckRequired) {
    return ruleBasedScores;
  }

  try {
    // Clean and prepare resume text for AI check
    const cleanedText = cleanResumeForGrammarAI(resumeText);
    
    if (!cleanedText || cleanedText.length < 10) {
      console.warn('[HYBRID-GRAMMAR] Cleaned text too short, skipping AI check');
      return ruleBasedScores;
    }

    // Call AI verification
    const errorsPresent = await verifyGrammarWithAI(cleanedText, env);
    
    if (errorsPresent) {
      // Apply Bugbot's fixed deduction logic: originalScore - 3
      const deduction = 3;
      const originalScore = ruleBasedScores.grammarScore.score;
      const newScore = Math.max(0, originalScore - deduction);
      ruleBasedScores.grammarScore.score = newScore;
      
      // Update feedback message
      ruleBasedScores.grammarScore.feedback =
        'Some grammar or spelling inconsistencies were detected. Review and correct misspellings.';
      
      // Recalculate overall score using shared helper
      ruleBasedScores.overallScore = calcOverallScore(ruleBasedScores);
      
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

  return ruleBasedScores;
}

