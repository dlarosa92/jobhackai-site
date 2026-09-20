import { getDb } from './db.js';
import { admitAccountOperation, settleAccountOperation } from './account-deletion-admission.js';

// Unlike bearer-authenticated requests, a signed webhook resolves its owner
// inside the event handler. Admit that verified UID before its first account
// write, then keep the claim through the atomic batch and post-commit work.
// Financial-only events never acquire a user claim or recreate an account.
export async function withWebhookAccountScope(context, handler, { eventId }) {
  let claim = null, owner = null, allowed = false, closed = false, uncertain = false;
  const pending = [];
  const scope = {
    async admit(uid) {
      if (closed) throw new Error('webhook_account_scope_closed');
      if (owner !== null) {
        if (owner !== uid) throw new Error('webhook_account_owner_changed');
        return allowed;
      }
      owner = uid;
      try {
        claim = await admitAccountOperation(context.env, uid, 'billing', { webhookEventId: eventId });
      } catch (error) {
        if (error?.message === 'account_deletion_pending') return false;
        throw error;
      }
      // Older deletions have a tombstone without a durable admission. Read
      // D1 strictly, including for an existing users row; never fail open.
      const deleted = await getDb(context.env).prepare('SELECT 1 FROM deleted_auth_ids WHERE auth_id = ?').bind(uid).first();
      const cached = await context.env.JOBHACKAI_KV?.get(`deleted:${uid}`);
      allowed = !deleted && !cached;
      return allowed;
    },
    background(task) {
      if (closed || typeof task !== 'function') throw new Error('webhook_account_scope_closed');
      const promise = Promise.resolve().then(task);
      pending.push(promise);
      void promise.catch(() => { uncertain = true; });
      context.waitUntil(promise);
    },
    uncertain() { uncertain = true; }
  };

  async function finish() {
    let offset = 0;
    while (offset < pending.length) {
      const batch = pending.slice(offset);
      offset += batch.length;
      if ((await Promise.allSettled(batch)).some(result => result.status === 'rejected')) uncertain = true;
    }
    closed = true;
    if (claim) await settleAccountOperation(context.env, claim, uncertain ? 'uncertain' : 'finished');
  }

  try {
    const response = await handler(scope);
    if (!response || response.status >= 500) uncertain = true;
    if (pending.length) context.waitUntil(finish());
    else await finish();
    return response;
  } catch (error) {
    uncertain = true;
    if (!closed) await finish();
    throw error;
  }
}
