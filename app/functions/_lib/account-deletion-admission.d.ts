// Public types for the shared JavaScript helper. Its implementation validates
// the database binding and identity at runtime; no Worker Env is redefined here.
export type AccountOperationPurpose = 'api' | 'webhook' | 'analytics' | 'followup' | 'retention' | 'inactivity' | 'maintenance';
export type AccountOperationClaim = { id: string; uid: string; kind: 'billing' | 'account' | 'maintenance'; purpose: AccountOperationPurpose };
export function admitAccountOperation(
  env: unknown, uid: string, kind?: AccountOperationClaim['kind'],
  options?: { webhookEventId?: string | null; analyticsEventKey?: string | null; purpose?: AccountOperationPurpose }
): Promise<AccountOperationClaim>;
export function settleAccountOperation(env: unknown, claim: AccountOperationClaim, outcome: 'finished' | 'uncertain'): Promise<void>;
export function beginDeletionAdmission(env: unknown, identity: { uid: string; email?: string | null; origin: 'user_request' | 'inactivity' }): Promise<{
  id: string; auth_id: string; email: string | null; origin: 'user_request' | 'inactivity'; state: 'requested' | 'complete'; created_at: string; updated_at: string;
}>;
export function assertDeletionQuiescent(env: unknown, uid: string): Promise<string>;
