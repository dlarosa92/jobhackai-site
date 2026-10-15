// Temporarily enabled operator-only fixture runner. Never accepts user prompts or model overrides.
import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { isExplicitNonProductionEnvironment, notFoundInProductionResponse, STANDARD_SECURITY_HEADERS } from '../../_lib/debug-access.js';
import { evaluateTextFixture } from '../../_lib/model-quality-eval.js';
import { cases } from '../../../tests/model-quality/cases.mjs';

export function createTextQaHandler({ verify = verifyFirebaseIdToken, evaluate = evaluateTextFixture } = {}) {
  return async ({ request, env }) => {
    const expires = Date.parse(env.VOICE_QA_EVAL_UNTIL || '');
    if (!isExplicitNonProductionEnvironment(env) || !env.VOICE_QA_EVAL_UID || !Number.isFinite(expires) || expires <= Date.now()) return notFoundInProductionResponse();
    const json = (body, status = 200) => Response.json(body, { status, headers: { ...STANDARD_SECURITY_HEADERS, 'cache-control': 'no-store' } });
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    const token = getBearer(request);
    if (!token) return json({ error: 'unauthorized' }, 401);
    let user;
    try { user = await verify(token, env.FIREBASE_PROJECT_ID); } catch { return json({ error: 'unauthorized' }, 401); }
    if (user.uid !== env.VOICE_QA_EVAL_UID) return notFoundInProductionResponse();
    if (request.method === 'GET') return json({ cases: cases.map(({ id, feature }) => ({ id, feature })) });
    const fixture = cases.find(c => c.id === new URL(request.url).searchParams.get('case'));
    if (!fixture) return json({ error: 'unknown_fixture' }, 400);
    if (!env.OPENAI_API_KEY) return json({ error: 'generation_unavailable' }, 503);
    try {
      const started = Date.now();
      const result = await evaluate(fixture, env, user.uid);
      return json({ id: fixture.id, ...result, elapsedMs: Date.now() - started });
    } catch { return json({ id: fixture.id, error: 'synthetic_generation_failed' }, 502); }
  };
}
export const onRequest = createTextQaHandler();
