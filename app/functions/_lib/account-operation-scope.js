import { admitAccountOperation, settleAccountOperation } from './account-deletion-admission.js';

// Pages supplies a shared context.data object, but constructs a different
// context for each middleware/handler. Replacing context.waitUntil in a parent
// therefore does not capture work queued by a child. Register work explicitly.
const SCOPE = 'jobhackaiAccountOperation';
const BILLING_SCOPE = Symbol('accountBillingScope');

// Only this request receives the observer. Never mutate the shared env object
// or put request/account state in a module-global variable.
export function accountOperationEnv(context) {
  const scope = context.data?.[SCOPE];
  return scope ? { ...context.env, [BILLING_SCOPE]: scope } : context.env;
}

export function observeBillingWrite(env, method, run) {
  const scope = env[BILLING_SCOPE];
  if (!scope || ['GET', 'HEAD'].includes((method || 'GET').toUpperCase())) return run();
  if (scope.closed) throw new Error('account_operation_closed');
  // Observe the provider result before endpoint catch blocks can turn a
  // timeout/5xx into a nominally successful or client-error HTTP response.
  const promise = Promise.resolve().then(run).then(response => {
    if (!response || response.status >= 500 || [408, 429].includes(response.status)) scope.uncertain = true;
    return response;
  }, error => {
    scope.uncertain = true;
    throw error;
  });
  scope.pending.push(promise);
  void promise.catch(() => {});
  return promise;
}

export async function withAccountOperation(context, uid, handler, kind = 'account') {
  if (!context.data || context.data[SCOPE]) throw new Error('account_operation_context_invalid');
  const claim = await admitAccountOperation(context.env, uid, kind);
  const scope = { claim, pending: [], uncertain: false, closed: false };
  context.data[SCOPE] = scope;

  async function finish() {
    // Background work may itself enqueue work. Drain until no registered
    // operation remains, without leaving a gap between the check and close.
    let offset = 0;
    while (offset < scope.pending.length) {
      const batch = scope.pending.slice(offset);
      offset += batch.length;
      const results = await Promise.allSettled(batch);
      if (results.some(result => result.status === 'rejected')) scope.uncertain = true;
    }
    scope.closed = true;
    await settleAccountOperation(context.env, claim, scope.uncertain ? 'uncertain' : 'finished');
  }

  try {
    const response = await handler();
    if (!response || response.status >= 500) scope.uncertain = true;
    if (scope.pending.length) {
      // The claim remains active after HTTP completion until every queued
      // task and the durable settlement finish. A killed isolate leaves it
      // active, never implicitly safe for deletion.
      context.waitUntil(finish());
    } else {
      await finish();
    }
    return response;
  } catch (error) {
    scope.uncertain = true;
    if (!scope.closed) await finish();
    throw error;
  }
}

export function queueAccountWork(context, task) {
  if (typeof task !== 'function') throw new Error('account_operation_task_invalid');
  const scope = context.data?.[SCOPE];
  if (scope?.closed) throw new Error('account_operation_closed');
  // Accept a factory, not an already-started promise: no work may start before
  // registration, or after a closed scope is rejected.
  const promise = Promise.resolve().then(task);
  if (scope) {
    scope.pending.push(promise);
    // Attach immediately so an early rejection is never unhandled while the
    // foreground handler is still running. The original rejection is also
    // observed by finish(), which retains the claim as uncertain.
    void promise.catch(() => { scope.uncertain = true; });
  }
  context.waitUntil(promise);
  return promise;
}
