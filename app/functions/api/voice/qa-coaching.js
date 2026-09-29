// Operator-only synthetic evaluation. No voice calls, interview rows or credits.
import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { isExplicitNonProductionEnvironment, notFoundInProductionResponse, STANDARD_SECURITY_HEADERS } from '../../_lib/debug-access.js';
import { scoreVoiceTranscript, groundedMoments } from '../../_lib/voice-scorecard.js';
import { cases } from '../../../tests/voice-coaching/cases.mjs';

export function createQaCoachingHandler({ verify = verifyFirebaseIdToken, score = scoreVoiceTranscript } = {}) {
  return async ({ request, env }) => {
    const expires = Date.parse(env.VOICE_QA_EVAL_UNTIL || '');
    if (!isExplicitNonProductionEnvironment(env) || !env.VOICE_QA_EVAL_UID ||
        !Number.isFinite(expires) || expires <= Date.now()) return notFoundInProductionResponse();
    const json = (body, status = 200) => Response.json(body, { status, headers: {
      ...STANDARD_SECURITY_HEADERS, 'cache-control': 'no-store'
    } });
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    const token = getBearer(request);
    if (!token) return json({ error: 'unauthorized' }, 401);
    let user;
    try { user = await verify(token, env.FIREBASE_PROJECT_ID); }
    catch { return json({ error: 'unauthorized' }, 401); }
    if (user.uid !== env.VOICE_QA_EVAL_UID) return notFoundInProductionResponse();
    if (request.method === 'GET') return json({ cases: cases.map(({ id, review }) => ({ id, review })) });
    const fixture = cases.find(item => item.id === new URL(request.url).searchParams.get('case'));
    if (!fixture) return json({ error: 'unknown_fixture' }, 400);
    if (!env.OPENAI_API_KEY) return json({ error: 'scoring_unavailable' }, 503);
    try {
      // Only server-owned synthetic fixtures enter the exact production scorer.
      // No request body, candidate transcript, role or model override is accepted.
      const { scorecard, usage, model, fromCache } = await score(fixture, env);
      const issues = [];
      if (scorecard.tooShort || scorecard.methodologyVersion !== 2) issues.push('missing scoped report');
      if (!scorecard.assessmentScope || scorecard.competencies?.length < 3) issues.push('missing scope or competency coverage');
      if (groundedMoments(scorecard.moments, fixture.transcript).length !== scorecard.moments.length) issues.push('ungrounded moment');
      return json({ id: fixture.id, reviewRequired: fixture.review, issues, scorecard, usage, model, fromCache });
    } catch {
      // Do not return or log provider bodies, authentication data or thrown text.
      return json({ error: 'synthetic_scoring_failed' }, 502);
    }
  };
}

export const onRequest = createQaCoachingHandler();
