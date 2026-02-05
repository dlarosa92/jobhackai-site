// Shared helper for calculating overall ATS score
// Ensures consistent score calculation across all endpoints

/**
 * Calculate overall ATS score from individual category scores
 * @param {Object} scores - Score object with keywordScore, formattingScore, structureScore, toneScore, grammarScore
 * @returns {number} Rounded overall score
 */
export function calcOverallScore(scores) {
  return Math.round(
    scores.keywordScore.score +
    scores.formattingScore.score +
    scores.structureScore.score +
    scores.toneScore.score +
    scores.grammarScore.score
  );
}

