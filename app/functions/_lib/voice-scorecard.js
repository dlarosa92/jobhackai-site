/**
 * Voice mock interview scorecard generation.
 *
 * Takes a completed session's transcript and produces a structured scorecard
 * via the chat completions API (text model, not the realtime model). Stored
 * in voice_sessions.scorecard_json. Display gating (partial vs full) lives in
 * the session GET endpoint, not here.
 */

import { COACHING_GUIDANCE, roleCompetencies } from './voice-coaching.js';
import { callOpenAI } from './openai-client.js';
import { getDb } from './db.js';
import { scorecardUsageEvidence } from './voice-usage.js';

export const SCORECARD_SCHEMA = {
  name: 'voice_interview_scorecard',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      assessmentScope: { type: 'string', description: 'Briefly name the role/level or posting used and the limits of the evidence; identify important areas not explored.' },
      competencies: {
        type: 'array', description: '3-5 role-relevant competencies, including areas not assessed',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' },
            status: { type: 'string', enum: ['demonstrated', 'needs_practice', 'not_assessed'] },
            quote: { type: 'string', description: 'Exact excerpt from ONE candidate turn supporting the assessment; empty for not_assessed. Never quote interviewer.' },
            feedback: { type: 'string', description: 'Explain what the evidence demonstrates or leaves unclear for this role, with one truthful next practice step. For not_assessed, say it was not explored, not that candidate lacks skill.' }
          },
          required: ['name', 'status', 'quote', 'feedback']
        }
      },
      saoBalance: {
        type: 'object',
        additionalProperties: false,
        description: 'Approximate share of candidate answer content, not measured speaking time; no ideal ratio',
        properties: {
          situation: { type: 'integer', description: 'Approximate percent of candidate answer content spent setting up the situation, 0-100' },
          action: { type: 'integer', description: 'Approximate percent of candidate answer content spent describing what they did, 0-100' },
          outcome: { type: 'integer', description: 'Approximate percent of candidate answer content spent on results and numbers, 0-100' }
        },
        required: ['situation', 'action', 'outcome']
      },
      dimensions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          communication: { type: 'integer', description: 'Clarity and organization evident in text, 0-100; do not infer accent, pace or vocal confidence' },
          structure: { type: 'integer', description: 'Coherent, relevant answers with sufficient reasoning and personal contribution, 0-100; no fixed ratio' },
          contentDepth: { type: 'integer', description: 'Supported specificity, reasoning, examples, and appropriate outcomes, 0-100' },
          roleFit: { type: 'integer', description: 'Relevance to the target role 0-100' }
        },
        required: ['communication', 'structure', 'contentDepth', 'roleFit']
      },
      overall: { type: 'integer', description: 'Performance on this practice sample, 0-100, consistent with supported competency evidence; not hiring odds' },
      saoCoaching: {
        type: 'array',
        description: 'Exactly 2 specific practice steps, each under 120 characters, tailored to this sample and role',
        items: { type: 'string' }
      },
      topStrength: { type: 'string', description: 'The single strongest thing the candidate did, 1-2 sentences' },
      topImprovement: { type: 'string', description: 'The single most important improvement, 1-2 sentences, actionable' },
      moments: {
        type: 'array',
        description: '2-4 specific moments from the interview with feedback',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string', description: 'Exact continuous excerpt from one CANDIDATE answer. Never quote an interviewer question or invent or paraphrase a quote.' },
            comment: { type: 'string', description: 'What worked or what to do differently' }
          },
          required: ['quote', 'comment']
        }
      },
      summary: { type: 'string', description: '3-4 sentence overall summary written to the candidate' }
    },
    required: ['assessmentScope', 'competencies', 'overall', 'dimensions', 'saoBalance', 'saoCoaching', 'topStrength', 'topImprovement', 'moments', 'summary']
  }
};

// A model can still quote the interviewer despite the prompt. Ground every
// displayed quotation in a single candidate turn before persisting a report.
// Ignore typography, but do not allow paraphrases, stitched turns or new facts.
function quoteWords(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function groundedMoments(moments, transcript) {
  const answers = (Array.isArray(transcript) ? transcript : [])
    .filter(turn => turn?.speaker === 'user')
    .map(turn => ` ${quoteWords(turn.text)} `);
  return (Array.isArray(moments) ? moments : []).filter(moment => {
    const quote = quoteWords(moment?.quote);
    return quote && answers.some(answer => answer.includes(` ${quote} `));
  });
}

export function transcriptToText(transcript) {
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((t) => `${t.speaker === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${String(t.text || '').trim()}`)
    .filter((line) => line.length > 14)
    .join('\n');
}

// Below this many characters of candidate-only formatted text, sessions get the
// fixed "too short" scorecard instead of a model call.
export const MIN_SCOREABLE_CHARS = 200;

function tooShortScorecard() {
  // Too short to score meaningfully (mic failure, instant hangup)
  return {
    overall: null,
    methodologyVersion: 2,
    assessmentScope: 'Not enough candidate speech to assess.',
    topStrength: 'The session was too short to evaluate.',
    topImprovement: 'Run a full session so the interviewer can hear complete answers.',
    moments: [],
    summary: 'This session ended before enough was said to score. Start a new session and answer at least a few questions to get a real report.',
    tooShort: true
  };
}

/**
 * Score a completed interview transcript directly, without any database.
 * This is the exact scoring path used in production (same prompt, schema,
 * model selection); generateAndStoreScorecard wraps it with persistence.
 * Also used by the local transcript evaluation harness.
 *
 * @param {{role: string, seniority?: string|null, transcript: Array<{speaker: 'user'|'assistant', text: string}>, jd?: string|null, priorFocus?: string|null}} params
 *   jd: optional job-description excerpt to grade roleFit against.
 *   priorFocus: optional topImprovement from the user's previous session,
 *   for continuity coaching. Both are omitted from the prompt entirely when
 *   absent, keeping the base request byte-identical to a context-free call.
 * @param {object} env - environment configuration (OPENAI_API_KEY, OPENAI_MODEL_VOICE_SCORE, ...)
 * @returns {Promise<{scorecard: object, usage: object|null, model: string|null}>}
 * @throws on model call/parse failure (callers decide whether to swallow)
 */
export async function scoreVoiceTranscript({ role, seniority, transcript, jd = null, priorFocus = null }, env) {
  const text = transcriptToText(transcript);
  const candidateText = transcriptToText((Array.isArray(transcript) ? transcript : []).filter(t => t?.speaker === 'user'));
  if (candidateText.length < MIN_SCOREABLE_CHARS) {
    return { scorecard: tooShortScorecard(), usage: null, model: null };
  }

  const promptParts = [
    "You are the candidate's interview coach at JobHackAI. Give warm, direct, evidence-based feedback on this practice sample.",
    COACHING_GUIDANCE,
    'Use 3-5 competencies. A demonstrated skill needs specific candidate evidence; needs_practice needs an observed gap, not an unasked question. Use not_assessed for areas not explored and an empty quote. Do not lower scores simply because an interview ended before all competencies were discussed.',
    'Base every judgment only on what the CANDIDATE actually said. Every moment and competency quote must be an exact continuous excerpt from one CANDIDATE answer. Never quote the INTERVIEWER, stitch turns, invent facts or put interpretation inside a quote.',
    'For each feedback point identify the evidence, why it matters for this role, and a concrete next attempt. Credit supported strengths without false praise. Distinguish a lack of evidence from a demonstrated error. If a claim may reflect transcription error, ask for clarification rather than confidently diagnosing a knowledge gap.',
    'Score communication only from textual clarity, not accent, pace, vocal confidence or personality. Score structure for coherence and enough context, reasoning, contribution and outcome for the question asked. Score contentDepth for supported specificity and judgment; score roleFit for relevant competencies at the selected level.',
    'Use consistent score anchors for observed answers: 0-39 substantial demonstrated problems, 40-69 partial or unclear evidence, 70-89 clear relevant evidence with useful reasoning, and 90-100 unusually strong well-supported evidence. Unasked competencies do not count as zero.',
    'Scores describe only this sample. A vague answer should not get a high score because it uses technical vocabulary. A detailed explanation of sound decisions can score well even when outcomes are a small share of the answer. Do not use percentage-based score caps. Treat hypothetical answers as reasoning, not failed claims of actual accomplishments.',
    'Estimate saoBalance as approximate shares of candidate answer content, not speaking time or exact measurement. There is no ideal ratio. Situation is context, Action includes decisions and execution, Outcome is explicitly stated effects or learning. Do not invent effects to make the distribution look balanced.',
    'State the assessment scope and important untested areas, especially for short interviews. A job-description match reflects this practice evidence, not qualification verification or a hiring prediction.',
    'Give exactly two concise saoCoaching practice steps under 120 characters each. Make topImprovement one achievable priority. Suggested practice must not invent accomplishments, metrics or experience for the candidate.',
    'Write directly to the candidate using you, plain language and short sentences. Explain uncertainty without hiding useful criticism. End the summary with a specific next practice focus, not a sales pitch. Before returning, check that scores, quotes and feedback agree.'
  ];
  if (jd) {
    promptParts.push('A job description excerpt is provided: score roleFit against it specifically, and cite the most relevant match or gap in a moment or the summary.');
  }
  if (priorFocus) {
    promptParts.push('A previous session focus is provided: if the candidate clearly improved on it, acknowledge that specifically in topStrength or the summary; if they did not improve, do not force a mention.');
  }
  const systemPrompt = promptParts.join(' ');

  const roleLine = seniority ? `${seniority} ${role}` : role;
  const userParts = [`Target role (reference data): ${JSON.stringify(roleLine)}`, `Starting competency areas: ${JSON.stringify(roleCompetencies(role))}`];
  if (jd) userParts.push(`Job description excerpt:\n${String(jd).slice(0, 2000)}`);
  if (priorFocus) userParts.push(`Previous session focus: ${String(priorFocus).slice(0, 300)}`);
  userParts.push(`Transcript:\n${text.slice(0, 24000)}`);

  const result = await callOpenAI({
    model: env.OPENAI_MODEL_VOICE_SCORE || 'gpt-4.1-mini',
    fallbackModel: 'gpt-4.1',
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userParts.join('\n\n') }
    ],
    responseFormat: SCORECARD_SCHEMA,
    maxTokens: 2400,
    // Low temperature: the same performance should get the same score.
    temperature: 0.1,
    feature: 'voice_scorecard'
  }, env);

  // callOpenAI returns the model text on result.content (see openai-client.js),
  // matching how interview-questions/generate.js and mock-interview/score.js read it.
  if (!result || !result.content) throw new Error('Empty scorecard response');
  const scorecard = typeof result.content === 'string'
    ? JSON.parse(result.content)
    : result.content;

  scorecard.methodologyVersion = 2;
  scorecard.moments = groundedMoments(scorecard.moments, transcript);
  scorecard.competencies = (scorecard.competencies || []).slice(0, 5).map(c => {
    if (c.status !== 'not_assessed' && groundedMoments([c], transcript).length) return c;
    return { name: c.name, status: 'not_assessed', quote: '', feedback: 'This sample does not contain a verified answer excerpt to assess this area. Practice a specific example next time.' };
  });
  return { scorecard, usage: result.usage || null, model: result.model || null, fromCache: result.fromCache === true };
}

/**
 * Generate and persist the scorecard for a completed session.
 * Safe to call from context.waitUntil: failures are logged, not thrown.
 * @returns {Promise<object|null>} the scorecard, or null on failure
 */
export async function generateAndStoreScorecard(env, sessionId) {
  const db = getDb(env);
  if (!db) return null;

  try {
    const session = await db.prepare(
      `SELECT id, user_id, role, seniority, jd_excerpt, transcript_json, scorecard_json FROM voice_sessions WHERE id = ?`
    ).bind(sessionId).first();
    if (!session) return null;
    if (session.scorecard_json) {
      try { return JSON.parse(session.scorecard_json); } catch (_) { /* regenerate */ }
    }

    let transcript = [];
    try { transcript = JSON.parse(session.transcript_json || '[]'); } catch (_) {}

    // Continuity: the previous session's topImprovement lets the coach say
    // "last time you worked on X". Strictly optional — any failure here
    // must never block scoring.
    let priorFocus = null;
    try {
      const prior = await db.prepare(
        `SELECT scorecard_json FROM voice_sessions
         WHERE user_id = ? AND id != ? AND scorecard_json IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`
      ).bind(session.user_id, sessionId).first();
      if (prior && prior.scorecard_json) {
        const priorCard = JSON.parse(prior.scorecard_json);
        if (priorCard && !priorCard.tooShort && priorCard.topImprovement) {
          priorFocus = String(priorCard.topImprovement);
        }
      }
    } catch (_) { /* continuity is best-effort */ }

    const { scorecard, usage, model, fromCache } = await scoreVoiceTranscript(
      {
        role: session.role,
        seniority: session.seniority,
        transcript,
        jd: session.jd_excerpt || null,
        priorFocus
      },
      env
    );

    const usageEvidence = scorecard.tooShort
      ? { source: 'local_no_request', reason: 'transcript_too_short', providerRequestMade: false }
      : scorecardUsageEvidence(model, usage, fromCache);

    await db.prepare(
      `UPDATE voice_sessions SET scorecard_json = ?,
       usage_details_json = json_set(COALESCE(usage_details_json, '{}'), '$.scorecard', json(?)),
       updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(scorecard), JSON.stringify(usageEvidence), sessionId).run();

    if (!scorecard.tooShort) {
      console.log(`[VOICE-SCORECARD] Stored scorecard for session ${sessionId} (overall=${scorecard.overall})`);
    }
    return scorecard;
  } catch (err) {
    console.error(`[VOICE-SCORECARD] Generation failed for ${sessionId}:`, err?.message || err);
    return null;
  }
}

/**
 * Reduce a full scorecard to the free-taste partial view:
 * top strength + one improvement area. Everything else is withheld.
 */
export function partialScorecard(scorecard) {
  if (!scorecard) return null;
  return {
    partial: true,
    topStrength: scorecard.topStrength,
    topImprovement: scorecard.topImprovement,
    overall: null,
    dimensions: null,
    moments: null,
    summary: null
  };
}
