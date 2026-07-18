/**
 * Voice mock interview scorecard generation.
 *
 * Takes a completed session's transcript and produces a structured scorecard
 * via the chat completions API (text model, not the realtime model). Stored
 * in voice_sessions.scorecard_json. Display gating (partial vs full) lives in
 * the session GET endpoint, not here.
 */

import { callOpenAI } from './openai-client.js';
import { getDb } from './db.js';

export const SCORECARD_SCHEMA = {
  name: 'voice_interview_scorecard',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overall: { type: 'integer', description: 'Overall interview performance 0-100' },
      dimensions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          communication: { type: 'integer', description: 'Clarity, pace, confidence 0-100' },
          structure: { type: 'integer', description: 'Answer structure scored BY the S + A = O formula (goal: about 5% situation, 10% action, 85% outcome) 0-100' },
          contentDepth: { type: 'integer', description: 'Specificity, examples, numbers 0-100' },
          roleFit: { type: 'integer', description: 'Relevance to the target role 0-100' }
        },
        required: ['communication', 'structure', 'contentDepth', 'roleFit']
      },
      saoBalance: {
        type: 'object',
        additionalProperties: false,
        description: 'Share of the candidate speaking time spent on each S + A = O component, integer percents summing to about 100',
        properties: {
          situation: { type: 'integer', description: 'Percent of candidate speaking time spent setting up the situation, 0-100' },
          action: { type: 'integer', description: 'Percent of candidate speaking time spent describing what they did, 0-100' },
          outcome: { type: 'integer', description: 'Percent of candidate speaking time spent on results and numbers, 0-100' }
        },
        required: ['situation', 'action', 'outcome']
      },
      saoCoaching: {
        type: 'array',
        description: 'Exactly 2 imperative coaching lines, each under 120 characters, telling the candidate how to rebalance toward outcomes, e.g. "Open answers with the result. Then explain how."',
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
            quote: { type: 'string', description: 'Short paraphrased quote or moment from the candidate' },
            comment: { type: 'string', description: 'What worked or what to do differently' }
          },
          required: ['quote', 'comment']
        }
      },
      summary: { type: 'string', description: '3-4 sentence overall summary written to the candidate' }
    },
    required: ['overall', 'dimensions', 'saoBalance', 'saoCoaching', 'topStrength', 'topImprovement', 'moments', 'summary']
  }
};

export function transcriptToText(transcript) {
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((t) => `${t.speaker === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${String(t.text || '').trim()}`)
    .filter((line) => line.length > 14)
    .join('\n');
}

// Below this many characters of formatted transcript, sessions get the
// fixed "too short" scorecard instead of a model call.
export const MIN_SCOREABLE_CHARS = 200;

function tooShortScorecard() {
  // Too short to score meaningfully (mic failure, instant hangup)
  return {
    overall: 0,
    dimensions: { communication: 0, structure: 0, contentDepth: 0, roleFit: 0 },
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
 * @param {{role: string, seniority?: string|null, transcript: Array<{speaker: 'user'|'assistant', text: string}>}} params
 * @param {object} env - environment configuration (OPENAI_API_KEY, OPENAI_MODEL_VOICE_SCORE, ...)
 * @returns {Promise<{scorecard: object, usage: object|null, model: string|null}>}
 * @throws on model call/parse failure (callers decide whether to swallow)
 */
export async function scoreVoiceTranscript({ role, seniority, transcript }, env) {
  const text = transcriptToText(transcript);
  if (text.length < MIN_SCOREABLE_CHARS) {
    return { scorecard: tooShortScorecard(), usage: null, model: null };
  }

  const systemPrompt = [
    'You are an expert interview coach scoring a voice mock interview transcript.',
    'Score honestly: a rambling or vague performance should score in the 40s-60s, a strong one in the 70s-80s, exceptional in the 90s.',
    'Base every judgment only on what the CANDIDATE actually said. Quote or closely paraphrase real moments.',
    'JobHackAI teaches the S + A = O answer formula: Situation about 5 percent, Action about 10 percent, Outcome about 85 percent of an answer.',
    'Compute saoBalance from the transcript: the share of the candidate speaking time spent on situation setup, actions taken, and outcomes or results, as integer percents summing to about 100.',
    'Score the structure dimension BY the S + A = O formula, not generic answer organization: answers that spend most of their time on concrete outcomes score high; answers stuck in backstory or process score low.',
    'Write saoCoaching as exactly two imperative tips, each under 120 characters, telling the candidate how to rebalance toward outcomes.',
    'Write feedback to the candidate directly, in second person, plain language, short sentences. Do not use em dashes.'
  ].join(' ');

  const roleLine = seniority ? `${seniority} ${role}` : role;
  const result = await callOpenAI({
    model: env.OPENAI_MODEL_VOICE_SCORE || 'gpt-4.1-mini',
    fallbackModel: 'gpt-4.1',
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Target role: ${roleLine}\n\nTranscript:\n${text.slice(0, 24000)}` }
    ],
    responseFormat: SCORECARD_SCHEMA,
    maxTokens: 1200,
    temperature: 0.3,
    feature: 'voice_scorecard'
  }, env);

  // callOpenAI returns the model text on result.content (see openai-client.js),
  // matching how interview-questions/generate.js and mock-interview/score.js read it.
  if (!result || !result.content) throw new Error('Empty scorecard response');
  const scorecard = typeof result.content === 'string'
    ? JSON.parse(result.content)
    : result.content;

  return { scorecard, usage: result.usage || null, model: result.model || null };
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
      `SELECT id, role, seniority, transcript_json, scorecard_json FROM voice_sessions WHERE id = ?`
    ).bind(sessionId).first();
    if (!session) return null;
    if (session.scorecard_json) {
      try { return JSON.parse(session.scorecard_json); } catch (_) { /* regenerate */ }
    }

    let transcript = [];
    try { transcript = JSON.parse(session.transcript_json || '[]'); } catch (_) {}

    const { scorecard } = await scoreVoiceTranscript(
      { role: session.role, seniority: session.seniority, transcript },
      env
    );

    await db.prepare(
      `UPDATE voice_sessions SET scorecard_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(scorecard), sessionId).run();

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
