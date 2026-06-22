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
          structure: { type: 'integer', description: 'Answer organization, STAR usage 0-100' },
          contentDepth: { type: 'integer', description: 'Specificity, examples, numbers 0-100' },
          roleFit: { type: 'integer', description: 'Relevance to the target role 0-100' }
        },
        required: ['communication', 'structure', 'contentDepth', 'roleFit']
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
    required: ['overall', 'dimensions', 'topStrength', 'topImprovement', 'moments', 'summary']
  }
};

function transcriptToText(transcript) {
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((t) => `${t.speaker === 'assistant' ? 'INTERVIEWER' : 'CANDIDATE'}: ${String(t.text || '').trim()}`)
    .filter((line) => line.length > 14)
    .join('\n');
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
    const text = transcriptToText(transcript);
    if (text.length < 200) {
      // Too short to score meaningfully (mic failure, instant hangup)
      const minimal = {
        overall: 0,
        dimensions: { communication: 0, structure: 0, contentDepth: 0, roleFit: 0 },
        topStrength: 'The session was too short to evaluate.',
        topImprovement: 'Run a full session so the interviewer can hear complete answers.',
        moments: [],
        summary: 'This session ended before enough was said to score. Start a new session and answer at least a few questions to get a real report.',
        tooShort: true
      };
      await db.prepare(
        `UPDATE voice_sessions SET scorecard_json = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(JSON.stringify(minimal), sessionId).run();
      return minimal;
    }

    const systemPrompt = [
      'You are an expert interview coach scoring a voice mock interview transcript.',
      'Score honestly: a rambling or vague performance should score in the 40s-60s, a strong one in the 70s-80s, exceptional in the 90s.',
      'Base every judgment only on what the CANDIDATE actually said. Quote or closely paraphrase real moments.',
      'Write feedback to the candidate directly, in second person, plain language, short sentences. Do not use em dashes.'
    ].join(' ');

    const roleLine = session.seniority ? `${session.seniority} ${session.role}` : session.role;
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

    await db.prepare(
      `UPDATE voice_sessions SET scorecard_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(scorecard), sessionId).run();

    console.log(`[VOICE-SCORECARD] Stored scorecard for session ${sessionId} (overall=${scorecard.overall})`);
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
