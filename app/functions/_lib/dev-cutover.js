// A temporary operator switch for the development cutover. Keep the check
// independent of storage: requests and scheduled jobs must stop before they
// read or write a binding being moved. Other environments cannot enable it.
export function isDevCutoverPaused(env = {}) {
  const name = String(env.ENVIRONMENT || '').trim().toLowerCase();
  return (name === 'dev' || name === 'development') &&
    String(env.DEV_CUTOVER_PAUSED || '').trim().toLowerCase() === 'true';
}
