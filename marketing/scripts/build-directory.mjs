// Static, source-backed directory prototype. Preview only until release review.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/directory/mobile-detailing.json'), 'utf8'));
const out = join(root, 'directory');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const seen = new Set();
for (const listing of data.listings) {
  if (!/^[a-z0-9-]+$/.test(listing.id) || seen.has(listing.id)) throw new Error('Invalid or duplicate listing ID');
  seen.add(listing.id);
  for (const key of ['website', 'source']) {
    const url = new URL(listing[key]);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe provider URL');
  }
}
mkdirSync(join(out, data.category), { recursive: true });
const path = listing => `/directory/${data.category}/${listing.id}`;
const price = p => p ? `<strong>${p.to ? `$${p.from}–$${p.to}` : `From $${p.from}`}</strong><span>${esc(p.package)}</span><p>${esc(p.scope)}</p>` : '<strong>Request a quote</strong><p>No comparable package price recorded.</p>';
const mail = (subject, body) => `mailto:support@jobhackai.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
const shell = (title, description, body, listing = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | JobHackAI Local</title><meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/directory/directory.css"><link rel="stylesheet" href="/css/cookie-consent.css">
<script src="/js/cookie-consent.js?v=20260920-marketing-2" defer></script>
<script src="/js/component-loader.js?v=20260920-marketing-2" defer></script>
</head><body data-listing="${esc(listing)}"><a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="/directory">JobHackAI <span>LOCAL</span></a><nav aria-label="Directory"><a href="/directory">Find a detailer</a><a href="/directory/get-listed">Get listed</a></nav></header>
<main id="main" tabindex="-1">${body}</main><footer><p>A local directory experiment from <a href="/">JobHackAI</a>. No paid placements.</p><p><a href="https://app.jobhackai.io/privacy">Privacy</a> · <a href="https://app.jobhackai.io/cookies">Cookies</a> · <a href="/directory/get-listed">Suggest a correction</a></p><button type="button" id="open-cookie-preferences">Cookie preferences</button></footer>
<script src="/directory/directory.js" defer></script></body></html>`;
const cards = data.listings.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(l => `<article class="listing" data-region="${esc(l.regions.join('|'))}" data-service="${esc(l.services.join('|'))}" data-utilities="${esc(l.waterPower)}"><div><span class="eyebrow">Mobile service</span><h2><a href="${path(l)}">${esc(l.name)}</a></h2><p>${esc(l.regions.join(' · '))}</p></div><div class="price">${price(l.interiorPrice)}</div><p>${esc(l.waterPowerNote)}</p><a class="more" href="${path(l)}">See packages &amp; booking details <span aria-hidden="true">→</span></a></article>`).join('\n');
writeFileSync(join(out, 'index.html'), shell('Mobile detailing in Northern Kentucky & Cincinnati', 'Compare local mobile detailers by package scope, starting prices, and water and power requirements.', `
<section class="hero"><span class="eyebrow">Northern Kentucky + Cincinnati · Directory pilot</span><h1>A cleaner car.<br>Fewer tabs to open.</h1><p class="lead">Compare mobile detailers by what they actually include, what they charge to start, and what they need at your home.</p><p>Browse freely. Book directly with the provider.</p></section>
<aside class="notice">These are provider-published details, checked September 20, 2026. A listing is not a service-quality endorsement. Prices cover different jobs; confirm your address, vehicle condition and final quote before booking.</aside>
<form id="filters" class="filters" role="search" aria-label="Filter detailers"><label>Service area<select name="region"><option value="">Both sides of the river</option><option>Northern Kentucky</option><option>Cincinnati</option></select></label><label>What needs cleaning?<select name="service"><option value="">Any service</option><option value="interior">Interior</option><option value="exterior">Exterior</option><option value="full-detail">Full detail package</option><option value="boats">Boat</option><option value="rvs">RV</option><option value="fleets">Fleet</option></select></label><label>Water &amp; power<select name="utilities"><option value="">Any setup</option><option value="self-contained">Provider brings both</option><option value="customer-required">I can supply both</option><option value="confirm">Needs confirmation</option></select></label><button type="reset">Reset filters</button></form>
<p id="result-count" role="status" aria-live="polite">${data.listings.length} detailers · alphabetical order</p><div class="grid">${cards}</div><p id="no-results" hidden>No providers match those filters. Try a broader service or equipment requirement.</p>
<section class="guide"><h2>Three things to confirm before you book</h2><ol><li><strong>Cleanup or deep clean?</strong> A vacuum and wipe-down costs less than extraction, stain treatment or pet hair removal. Ask for the scope in writing.</li><li><strong>Where can they work?</strong> Confirm parking permission, vehicle access, and whether you must provide water or power.</li><li><strong>What changes the quote?</strong> Send photos and describe vehicle size, pet hair and spills. Starting prices are not a guaranteed quote.</li></ol></section>
<section class="business"><h2>Run a detailing business here?</h2><p>Suggest your business or correct a listing. Initial listings are reviewed by JobHackAI.</p><a class="button" href="/directory/get-listed">Get listed</a></section>`));
for (const l of data.listings) {
  const correction = mail(`Directory correction: ${l.name}`, `Business: ${l.name}\nListing: https://jobhackai.io${path(l)}\nCorrection and source URL:\n`);
  writeFileSync(join(out, data.category, `${l.id}.html`), shell(`${l.name} — mobile detailing`, `Package details and booking requirements for ${l.name} in Northern Kentucky and Cincinnati.`, `
<p class="breadcrumb"><a href="/directory">All detailers</a> / ${esc(l.name)}</p><section class="hero compact"><span class="eyebrow">${esc(l.regions.join(' + '))}</span><h1>${esc(l.name)}</h1><p class="lead">Mobile detailing, booked directly with the provider.</p><a class="button" href="${esc(l.website)}" rel="noopener noreferrer" data-directory-contact="${esc(l.id)}">Visit provider &amp; request a quote <span aria-hidden="true">↗</span></a></section>
<aside class="notice">Details from the provider’s website, checked September 20, 2026. Confirm availability and service at your address. No paid placement or partnership is implied.</aside>
<section class="packages"><div class="panel"><h2>Interior package</h2><div class="price">${price(l.interiorPrice)}</div></div><div class="panel"><h2>Full detail package</h2><div class="price">${price(l.fullPrice)}</div></div></section>
<section class="details"><h2>Before the appointment</h2><dl><dt>Water, power &amp; parking</dt><dd>${esc(l.waterPowerNote)}</dd><dt>Pet hair</dt><dd>${esc(l.petHairNote)}</dd><dt>Services mentioned</dt><dd>${esc(l.services.map(s=>s.replaceAll('-', ' ')).join(', '))}</dd><dt>Information source</dt><dd><a href="${esc(l.source)}" rel="noopener noreferrer">Provider website</a> · checked ${esc(data.checkedAt)}</dd></dl><a href="${esc(correction)}" data-directory-interest="correction">Suggest a correction by email</a></section>` , l.id));
}
const interest = mail('Local directory listing request — mobile detailing', 'Business name:\nWebsite:\nService area:\nMobile services offered:\nPublic package/pricing link:\nWater and power requirements:\nYour role at the business:\n');
writeFileSync(join(out, 'get-listed.html'), shell('Get listed', 'Suggest a local mobile detailing business or correct directory information.', `<section class="hero compact"><span class="eyebrow">For local businesses</span><h1>Help people find the right fit.</h1><p class="lead">We’re testing a useful directory for Northern Kentucky and Cincinnati. Suggest a mobile detailing business for editorial review.</p></section><section class="panel"><h2>What to send</h2><p>Include your business name, website, service area, package details and water or power requirements. We’ll check the public information before adding a listing.</p><p>There is no listing fee during this pilot. Submission does not guarantee inclusion. We have no paid placements or verified leads to sell yet.</p><a class="button" href="${esc(interest)}" data-directory-interest="listing">Open email to request a listing</a><p class="small">This opens your email app; clicking is not a submitted request. You can also email <a href="mailto:support@jobhackai.io">support@jobhackai.io</a> with the subject “Local directory listing request.”</p></section><p><a href="/directory">Back to the directory</a></p>`));
console.log(`Built directory hub, ${data.listings.length} provider pages and Get listed.`);
