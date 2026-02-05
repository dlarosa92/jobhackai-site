// Lightweight cron worker to sync KV-cached resume states into D1 when possible.
import { getDb, getOrCreateUserByAuthId, upsertResumeSessionWithScores, setFirstResumeSnapshot, getFirstResumeSnapshot, isD1Available } from '../_lib/db.js';
import { sanitizeResumeId } from '../_lib/input-sanitizer.js';

export async function onRequest(context) {
  const { env } = context;
  const kv = env.JOBHACKAI_KV;
  if (!kv) {
    console.warn('[KV-D1-SYNC] No KV binding available');
    return new Response(null, { status: 204 });
  }

  // List recent keys with prefix user: and try to sync those needing it.
  try {
    let cursor = undefined;
    do {
      const listResp = await kv.list({ prefix: 'user:', cursor });
      for (const keyInfo of listResp.keys) {
        try {
          const raw = await kv.get(keyInfo.name);
          if (!raw) continue;
          const record = JSON.parse(raw);
          if (!record || !record.needsSync) continue;
          
          // Normalize resumeId to ensure consistent raw_text_location across all code paths
          if (!record.resumeId) {
            console.warn('[KV-D1-SYNC] Skipping record with missing resumeId', keyInfo.name);
            continue;
          }
          const resumeIdValidation = sanitizeResumeId(record.resumeId);
          if (!resumeIdValidation.valid) {
            console.warn('[KV-D1-SYNC] Skipping record with invalid resumeId', keyInfo.name, resumeIdValidation.error);
            continue;
          }
          const sanitizedResumeId = resumeIdValidation.sanitized;
          
          // Attempt to mirror into D1
          if (!isD1Available(env)) continue;
          const d1User = await getOrCreateUserByAuthId(env, record.uid, null);
          if (!d1User) continue;
          // Upsert session with scores
          const session = await upsertResumeSessionWithScores(env, d1User.id, {
            resumeId: sanitizedResumeId,
            role: record.jobTitle || null,
            atsScore: record.score,
            ruleBasedScores: record.breakdown || null
          });
          if (session) {
            // mark first snapshot if needed
            const existingFirst = await getFirstResumeSnapshot(env, d1User.id);
            if (!existingFirst) {
              await setFirstResumeSnapshot(env, d1User.id, session.id, {
                uid: record.uid,
                resumeId: sanitizedResumeId,
                score: record.score,
                breakdown: record.breakdown,
                summary: record.summary || '',
                jobTitle: record.jobTitle || '',
                extractionQuality: record.extractionQuality || null,
                feedback: null,
                timestamp: record.timestamp || Date.now()
              });
            }
            // update KV record
            record.syncedAt = Date.now();
            record.needsSync = false;
            await kv.put(keyInfo.name, JSON.stringify(record), { expirationTtl: 2592000 });
          }
        } catch (innerErr) {
          console.warn('[KV-D1-SYNC] item failed to sync', keyInfo.name, innerErr);
        }
      }
      // paginate
      cursor = listResp.list_complete ? undefined : listResp.cursor;
    } while (cursor);
  } catch (e) {
    console.warn('[KV-D1-SYNC] sync worker failed', e);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}

// NOTE: isD1Available is provided by ../_lib/db.js for consistent binding resolution.


