// Deterministic score <-> feedback coherence and feedback-quality checks.
//
// These assert that a scorecard's numbers and words tell one story
// (e.g. a high outcome share may never co-occur with "no outcome given"
// feedback) and that the feedback meets baseline quality bars (exactly two
// coaching tips, quotes that actually appear in the transcript, no
// robotic tone). All rules are pure functions of the scorecard plus the
// candidate's transcript text; they are skipped entirely for too-short
// scorecards, which are a fixed template.

import { conceptAppears, coachingText, allFeedbackText } from './concepts.mjs';

const QUOTE_MIN_WORD_LEN = 4;
const QUOTE_MATCH_RATIO = 0.5;

function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= QUOTE_MIN_WORD_LEN);
}

/**
 * Fraction of a quote's content words that appear in the candidate's
 * spoken text. Returns 1 for quotes with no content words (nothing to
 * verify).
 */
export function quoteFidelity(quote, candidateText) {
  const words = contentWords(quote);
  if (words.length === 0) return 1;
  const spoken = new Set(contentWords(candidateText));
  const found = words.filter(w => spoken.has(w)).length;
  return found / words.length;
}

/**
 * Run all coherence/quality checks against a scorecard.
 *
 * @param {object} scorecard - full voice scorecard
 * @param {string|null} candidateText - concatenated candidate turns; when
 *   falsy, the quote-fidelity check is skipped (nothing to compare against)
 * @returns {Array<{category: string, message: string}>} failures
 */
export function coherenceChecks(scorecard, candidateText = null) {
  if (!scorecard || scorecard.tooShort) return [];

  const failures = [];
  const fail = (category, message) => failures.push({ category, message });

  const outcome = scorecard.saoBalance?.outcome;
  const situation = scorecard.saoBalance?.situation;
  const action = scorecard.saoBalance?.action;
  const structure = scorecard.dimensions?.structure;
  const roleFit = scorecard.dimensions?.roleFit;
  const coaching = coachingText(scorecard);
  const everything = allFeedbackText(scorecard);

  // 1. Numbers say outcomes were given; words must not deny it.
  if (typeof outcome === 'number' && outcome >= 50 && conceptAppears('claims-no-outcome', everything)) {
    fail('coherence-halo', `saoBalance.outcome = ${outcome} but feedback claims no outcome was given`);
  }

  // 2. Structure is scored BY the S+A=O formula, so it must track outcome
  // share. Thresholds mirror the prompt's own anchors (structure >= 80
  // requires outcome >= 65; structure <= 55 below outcome 40) with a
  // 5-point tolerance so borderline-but-anchor-consistent scores pass.
  if (typeof structure === 'number' && typeof outcome === 'number') {
    if (structure >= 80 && outcome < 60) {
      fail('coherence-formula', `structure = ${structure} despite outcome share ${outcome} (< 60)`);
    }
    if (structure <= 40 && outcome > 45) {
      fail('coherence-formula', `structure = ${structure} despite outcome share ${outcome} (> 45)`);
    }
  }

  // 3. A very low roleFit must be explained; a high one must not be
  // contradicted. The threshold matches the prompt's irrelevance anchor
  // (roleFit <= 30 for unrelated answers) — weak-but-on-topic answers
  // legitimately land at 35-40 with specificity coaching instead, which
  // also addresses the fit gap.
  if (typeof roleFit === 'number') {
    if (roleFit <= 30 &&
        !conceptAppears('relevance-concern', coaching) &&
        !conceptAppears('specificity', coaching)) {
      fail('coherence-rolefit', `roleFit = ${roleFit} but coaching never addresses relevance or specificity`);
    }
    // Only outright irrelevance assertions contradict a high roleFit —
    // "answer the question more directly" is focus coaching a coach can
    // honestly pair with well-fitting content.
    if (roleFit >= 75 && conceptAppears('asserts-irrelevance', scorecard.topImprovement || '')) {
      fail('coherence-rolefit', `roleFit = ${roleFit} but topImprovement asserts the content is off-topic`);
    }
  }

  // 4. A very low outcome share demands outcome-focused coaching.
  if (typeof outcome === 'number' && outcome <= 20 && !conceptAppears('outcome-focus', coaching)) {
    fail('coherence-outcome-coaching', `saoBalance.outcome = ${outcome} but coaching never mentions outcomes`);
  }

  // 5. saoBalance percents must roughly sum to 100.
  if ([situation, action, outcome].every(v => typeof v === 'number')) {
    const sum = situation + action + outcome;
    if (sum < 95 || sum > 105) {
      fail('lint-sao-sum', `saoBalance sums to ${sum}, expected 95-105`);
    }
  }

  // 6. Exactly two coaching tips, each under 120 characters (schema contract).
  const tips = scorecard.saoCoaching;
  if (!Array.isArray(tips) || tips.length !== 2) {
    fail('lint-coaching-shape', `saoCoaching has ${Array.isArray(tips) ? tips.length : 'no'} items, expected exactly 2`);
  } else {
    for (const tip of tips) {
      if (typeof tip !== 'string' || tip.length >= 120) {
        fail('lint-coaching-shape', `saoCoaching tip exceeds 120 chars: "${String(tip).slice(0, 60)}..."`);
      }
    }
  }

  // 7. Moment quotes must come from the candidate's actual words.
  if (candidateText) {
    for (const moment of scorecard.moments || []) {
      const ratio = quoteFidelity(moment?.quote, candidateText);
      if (ratio < QUOTE_MATCH_RATIO) {
        fail('lint-quote-fidelity',
          `moment quote not found in transcript (${Math.round(ratio * 100)}% word match): "${String(moment?.quote).slice(0, 60)}"`);
      }
    }
  }

  // 8. Feedback must address the candidate, not describe "the candidate".
  if (conceptAppears('robotic-tone', everything)) {
    fail('personability-robotic', 'Feedback uses robotic/third-person phrasing');
  }

  return failures;
}
