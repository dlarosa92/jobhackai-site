// Semantic feedback-concept matching.
//
// Fixtures reference concepts by ID. A concept "appears" in feedback text
// when any of its patterns matches. Required concepts are matched against
// coaching-oriented text (saoCoaching, topImprovement, moment comments,
// summary); forbidden concepts are matched against ALL feedback text
// including topStrength.

export const CONCEPTS = {
  'outcome-focus': [
    /(outcome|result|impact|quantif|metric|measurabl|measure)/i
  ],
  specificity: [
    /(specific|concrete|detail|example|vague|generic|substantiate|depth|elaborat)/i
  ],
  conciseness: [
    /(concise|ramb|brevit|succinct|shorten|trim|condense|to the point|focus|streamlin|lengthy|long-winded|wordy|tangent)/i
  ],
  structure: [
    /(structur|STAR|framework|organiz|coherent|flow|situation.{0,30}action)/i
  ],
  'relevance-concern': [
    /(relevan|off.?topic|unrelated|tangent)/i,
    /(didn'?t|did not|doesn'?t|does not|fail(s|ed)? to)\s+(directly\s+)?(answer|address)/i,
    /(answer|address)\s+the\s+(question|prompt)/i,
    /stay (on|focused)/i
  ],
  confidence: [
    /(confiden|filler|hesitat|assert|nervous|composure|poise|hedg|apolog|\bum\b|\buh\b)/i
  ],
  consistency: [
    /(contradict|inconsisten|conflicting|conflicts? with|doesn'?t (quite )?add up|undermine|mixed (message|signal)|discrepan)/i
  ],
  'clarity-concern': [
    /(clarif|unclear|confus|ambigu|credib|consisten|contradict)/i
  ],
  ownership: [
    /(your|their|his|her) (own |specific |individual |personal )?(role|contribution|part|impact|actions?)/i,
    /individual (role|contribution|impact|actions?)/i,
    /personal (role|contribution|impact|actions?|ownership)/i,
    /\bownership\b/i,
    /["'“”‘’]I["'“”‘’]/,
    /\bI[- ]statements?/i,
    /what (you|the candidate) (did|owned|personally)/i,
    /(clarify|distinguish|highlight|specify).{0,40}(your|their) (role|part|contribution)/i
  ],
  positivity: [
    /(blam|negative|professional|diplomat|constructive|tactful|complain|criticiz|tone|positive)/i,
    /speak(ing)?\s+(ill|poorly|badly)/i
  ],
  'real-example': [
    /(specific|real|actual|concrete|past) (example|situation|experience|instance|story)/i,
    /hypothetical/i,
    /\bSTAR\b/,
    /past experience/i
  ],
  audience: [
    /(jargon|technical detail|simplif|plain (language|terms)|non.?technical|accessib|translate)/i,
    /business (impact|outcome|value|result)/i
  ],
  elaboration: [
    /(elaborat|expand|more detail|develop|flesh out|depth)/i,
    /too (short|brief)/i,
    /brief|short answer/i
  ],

  // Forbidden concepts
  'claims-no-outcome': [
    // Window kept tight (15 chars) so critiques of OTHER missing elements
    // that merely mention results ("without more context, the results...")
    // don't false-positive.
    /\b(no|without|lacks?|lacking|missing|absence of)\b[^.!?\n]{0,15}\b(outcome|result|impact)s?\b/i,
    /\b(didn'?t|did not|fails? to|failed to|never|doesn'?t|does not)\s+(provide|share|state|mention|give|include|offer|present|quantify|describe)\b[^.!?\n]{0,40}\b(outcome|result|impact|metric)s?\b/i,
    /\b(outcome|result)s?\b[^.!?\n]{0,30}\b(not (provided|stated|mentioned|given|shared|clear)|missing|absent|unstated)\b/i
  ],
  'praises-relevance': [
    /(highly|very|strongly|extremely|directly) relevant/i,
    /directly (addresses|answers|answered|addressed)/i,
    /(excellent|strong|great|outstanding) (relevance|role fit|alignment|fit for the role)/i
  ]
};

/**
 * True if the concept (by ID) appears in the given text.
 */
export function conceptAppears(conceptId, text) {
  const patterns = CONCEPTS[conceptId];
  if (!patterns) throw new Error(`Unknown concept: ${conceptId}`);
  return patterns.some(p => p.test(text));
}

/**
 * Extract the coaching-oriented feedback text from a voice scorecard
 * (excludes topStrength).
 */
export function coachingText(scorecard) {
  const parts = [
    ...(scorecard.saoCoaching || []),
    scorecard.topImprovement || '',
    ...(scorecard.moments || []).map(m => m?.comment || ''),
    scorecard.summary || ''
  ];
  return parts.join('\n');
}

/**
 * Extract ALL feedback text from a voice scorecard (includes topStrength;
 * excludes candidate quotes, which are the candidate's own words).
 */
export function allFeedbackText(scorecard) {
  return [coachingText(scorecard), scorecard.topStrength || ''].join('\n');
}
