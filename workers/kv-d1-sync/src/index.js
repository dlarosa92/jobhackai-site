import * as handler from '../../app/functions/cron/kv-d1-sync.js';

export default {
  async scheduled(event, env, ctx) {
    try {
      // Reuse existing onRequest handler from app/functions/cron/kv-d1-sync.js
      // The handler expects a context-like object with env; provide minimal shape.
      await handler.onRequest({ env });
    } catch (e) {
      console.error('[KV-D1-SYNC-WRAPPER] scheduled invocation failed', e);
      throw e;
    }
  }
};


