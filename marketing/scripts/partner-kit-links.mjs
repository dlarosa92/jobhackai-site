// Nonpersonal partner IDs keep recipient and resident identities out of URLs.
import { pathToFileURL } from 'node:url';
export function partnerKitLinks(type, id) {
  if (!['interview', 'moveout'].includes(type)) throw new Error('Use interview or moveout');
  if (!/^(recruiter|property)_[0-9]{3,6}$/.test(id) || !id.startsWith(type === 'interview' ? 'recruiter_' : 'property_')) {
    throw new Error('Use an allocated nonpersonal ID: recruiter_001 or property_001');
  }
  const path = type === 'interview' ? '/interview-prep-kit' : '/directory/move-out-kit';
  const campaign = type === 'interview' ? 'voice_recruiter_handoff_2026_10' : 'local_moveout_partners_2026_10';
  const build = (medium, suffix) => {
    const url = new URL(path, 'https://jobhackai.io');
    url.search = new URLSearchParams({ utm_source: 'email', utm_medium: medium, utm_campaign: campaign, utm_content: `${id}_${suffix}` });
    return url.href;
  };
  return { partner_id: id, campaign, introduction: build('outreach', 'intro_01'),
    followup: build('outreach', 'followup_01'), recipient_handoff: build('partner_referral', 'handoff_01') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(partnerKitLinks(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
