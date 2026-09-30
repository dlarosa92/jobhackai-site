import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { withAccountOperation } from '../_lib/account-operation-scope.js';

const BILLING_PATHS = new Set([
  '/api/stripe-checkout', '/api/upgrade-plan', '/api/cancel-subscription',
  '/api/billing-portal', '/api/sync-stripe-plan'
]);

function unavailable(code, status) {
  return Response.json({ ok: false, error: code }, {
    status, headers: { 'cache-control': 'no-store', 'retry-after': '30' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  // Deletion must acquire its intent, not a regular operation that would
  // deadlock its own quiescence check. Its handler verifies the same identity.
  if (request.method === 'OPTIONS' || path === '/api/user/delete') return context.next();
  const token = getBearer(request);
  // Public endpoints retain their own authentication rules. Stripe callbacks
  // require signature-verified, resolved-owner admission in the webhook.
  if (!token) return context.next();
  let uid;
  try {
    ({ uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID));
  } catch (_) {
    return unavailable('unauthorized', 401);
  }
  try {
    return await withAccountOperation(context, uid, () => context.next(),
      BILLING_PATHS.has(path) ? 'billing' : 'account');
  } catch (error) {
    if (error?.message === 'account_deletion_pending') return unavailable('account_deletion_pending', 409);
    // Never expose SQL, provider details, tokens or another account's identity.
    return unavailable('account_operation_unavailable', 503);
  }
}
