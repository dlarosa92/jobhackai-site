// Pack purchases are repeatable. A client attempt id survives a lost response,
// while a fresh purchase gets a fresh key. Older clients still get a new checkout.
export function packCheckoutAttemptKey(parameterKey, attemptId) {
  return `${parameterKey}:pack:${attemptId || crypto.randomUUID()}`;
}
