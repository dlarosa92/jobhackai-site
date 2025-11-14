// Persistence helpers for last ATS analysis (24h TTL)
// KV key: atsLastAnalysis:${uid}

const ANALYSIS_KEY_PREFIX = 'atsLastAnalysis:';
const TTL_SECONDS = 24 * 60 * 60; // 24h

export async function saveLastAtsAnalysis(env, uid, payload) {
  if (!env?.JOBHACKAI_KV || !uid || !payload) return false;
  const key = `${ANALYSIS_KEY_PREFIX}${uid}`;
  try {
    const toSave = {
      ...payload
    };
    await env.JOBHACKAI_KV.put(key, JSON.stringify(toSave), {
      expirationTtl: TTL_SECONDS
    });
    return true;
  } catch (err) {
    console.warn('[ATS-ANALYSIS-PERSIST] KV write failed:', err);
    return false;
  }
}

export async function getLastAtsAnalysis(env, uid) {
  if (!env?.JOBHACKAI_KV || !uid) return null;
  const key = `${ANALYSIS_KEY_PREFIX}${uid}`;
  try {
    const val = await env.JOBHACKAI_KV.get(key);
    if (!val) return null;
    return JSON.parse(val);
  } catch (err) {
    console.warn('[ATS-ANALYSIS-PERSIST] KV read failed:', err);
    return null;
  }
}


