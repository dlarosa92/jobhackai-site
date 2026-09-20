// Old environment settings can still point at the retired pricing experiment.
// Voice checkout returns to the current offers while preserving campaign/query data.
export function checkoutCancelUrl(env, plan) {
  const configured = env.STRIPE_CANCEL_URL || `${env.FRONTEND_URL || 'https://dev.jobhackai.io'}/pricing`;
  if (!['weekly', 'monthly', 'pack'].includes(plan)) return configured;
  const url = new URL(configured);
  if (/^\/pricing-a(?:\.html)?\/?$/.test(url.pathname)) url.pathname = '/pricing';
  return url.href;
}
