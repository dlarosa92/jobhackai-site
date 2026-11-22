// Public, nonpersonal referral context; no browser identifiers or email addresses.
const campaigns = {
  'mobile-detailing': 'directory_mobile_detailing_nky_2026_09',
  'junk-removal': 'directory_junk_removal_nky_2026_09',
  'ev-charger-installation': 'directory_ev_charger_installation_nky_2026_09'
};
export function providerReferralUrl(raw, category, listing, placement) {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Unsafe provider referral');
  if (!campaigns[category] || !/^[a-z0-9-]+$/.test(listing) || !['website','source','booking'].includes(placement)) throw Error('Invalid referral context');
  // Existing provider campaign parameters take precedence. Never rewrite them.
  const tags = { utm_source: 'jobhackai_local', utm_medium: 'referral', utm_campaign: campaigns[category], utm_content: listing + '_profile_' + placement };
  for (const [key, value] of Object.entries(tags)) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.href;
}
