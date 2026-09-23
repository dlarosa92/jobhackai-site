// Source-backed directory. Preview deployments retain noindex response headers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildAdditionalCategories } from './directory-categories.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/directory/mobile-detailing.json'), 'utf8'));
const out = join(root, 'directory');
// Returning visitors can retain directory assets for hours. Tie each URL to
// its contents so a new page never mixes category markup with an older runtime.
const assets = Object.fromEntries(['directory.css', 'consent.css', 'consent.js', 'directory.js', 'request-form.js'].map(name => [
  name, `/directory/${name}?v=${createHash('sha256').update(readFileSync(join(out, name))).digest('hex').slice(0, 12)}`
]));
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
const shell = (title, description, body, listing = '', canonical = listing ? `/directory/${data.category}/${listing}` : '/directory', category = data.category, noun = 'detailer') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | JobHackAI Local</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://jobhackai.io${canonical}"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="${assets['directory.css']}"><link rel="stylesheet" href="${assets['consent.css']}">
<script src="${assets['consent.js']}" defer></script>

</head><body data-listing="${esc(listing)}" data-directory-category="${esc(category)}" data-provider-noun="${esc(noun)}" data-category-page="${!listing && canonical !== '/directory/get-listed'}"><a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="/directory">JobHackAI <span>LOCAL</span></a><nav aria-label="Directory"><a href="/directory">Mobile detailing</a><a href="/directory/junk-removal/">Junk removal</a><a href="/directory/ev-charger-installation/">EV charger installation</a><a href="/directory/get-listed${category ? `?category=${esc(category)}` : ''}">Get listed</a></nav></header>
<main id="main" tabindex="-1">${body}</main><footer><p>A local directory experiment from <a href="/">JobHackAI</a>. No paid placements.</p><p><a href="https://app.jobhackai.io/privacy">Privacy</a> · <a href="https://app.jobhackai.io/cookies">Cookies</a> · <a href="/directory/get-listed${category ? `?category=${esc(category)}` : ''}">Suggest a correction</a></p><button type="button" id="open-cookie-preferences">Cookie preferences</button></footer>
<script src="${assets['directory.js']}" defer></script></body></html>`;
const cards = data.listings.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(l => `<article class="listing" data-region="${esc(l.regions.join('|'))}" data-service="${esc(l.services.join('|'))}" data-utilities="${esc(l.waterPower)}"><div><span class="eyebrow">Mobile service</span><h2><a href="${path(l)}">${esc(l.name)}</a></h2><p>${esc(l.regions.join(' · '))}</p></div><div class="price">${price(l.interiorPrice)}</div><p>${esc(l.waterPowerNote)}</p><a class="more" href="${path(l)}">See packages &amp; booking details <span aria-hidden="true">→</span></a></article>`).join('\n');
writeFileSync(join(out, 'index.html'), shell('Mobile detailing in Northern Kentucky & Cincinnati', 'Compare local mobile detailers by package scope, starting prices, and water and power requirements.', `
<section class="hero"><span class="eyebrow">Northern Kentucky + Cincinnati · Directory pilot</span><h1>A cleaner car.<br>Fewer tabs to open.</h1><p class="lead">Compare mobile detailers by what they actually include, what they charge to start, and what they need at your home.</p><p>Browse freely. Book directly with the provider.</p></section>
<aside class="notice">These are provider-published details, checked ${esc(data.checkedAt)}. A listing is not a service-quality endorsement. Prices cover different jobs; confirm your address, vehicle condition and final quote before booking.</aside>
<form id="filters" class="filters" role="search" aria-label="Filter detailers"><label>Service area<select name="region"><option value="">Both sides of the river</option><option>Northern Kentucky</option><option>Cincinnati</option></select></label><label>What needs cleaning?<select name="service"><option value="">Any service</option><option value="interior">Interior</option><option value="exterior">Exterior</option><option value="full-detail">Full detail package</option><option value="boats">Boat</option><option value="rvs">RV</option><option value="fleets">Fleet</option></select></label><label>Water &amp; power<select name="utilities"><option value="">Any setup</option><option value="self-contained">Provider brings both</option><option value="customer-required">I can supply both</option><option value="confirm">Needs confirmation</option></select></label><button type="reset">Reset filters</button></form>
<p id="result-count" role="status" aria-live="polite">${data.listings.length} detailers · alphabetical order</p><div class="grid">${cards}</div><p id="no-results" hidden>No providers match those filters. Try a broader service or equipment requirement.</p>
<section class="guide"><h2>Three things to confirm before you book</h2><ol><li><strong>Cleanup or deep clean?</strong> A vacuum and wipe-down costs less than extraction, stain treatment or pet hair removal. Ask for the scope in writing.</li><li><strong>Where can they work?</strong> Confirm parking permission, vehicle access, and whether you must provide water or power.</li><li><strong>What changes the quote?</strong> Send photos and describe vehicle size, pet hair and spills. Starting prices are not a guaranteed quote.</li></ol></section>
<section class="business"><h2>Run a detailing business here?</h2><p>Suggest your business or correct a listing. Initial listings are reviewed by JobHackAI.</p><a class="button" href="/directory/get-listed?category=mobile-detailing">Get listed</a></section>`));
for (const l of data.listings) {
  const correction = mail(`Directory correction: ${l.name}`, `Business: ${l.name}\nListing: https://jobhackai.io${path(l)}\nCorrection and source URL:\n`);
  writeFileSync(join(out, data.category, `${l.id}.html`), shell(`${l.name} — mobile detailing`, `Package details and booking requirements for ${l.name} in Northern Kentucky and Cincinnati.`, `
<p class="breadcrumb"><a href="/directory">All detailers</a> / ${esc(l.name)}</p><section class="hero compact"><span class="eyebrow">${esc(l.regions.join(' + '))}</span><h1>${esc(l.name)}</h1><p class="lead">Mobile detailing, booked directly with the provider.</p><a class="button" href="${esc(l.website)}" rel="noopener noreferrer" data-directory-contact="${esc(l.id)}">Visit provider &amp; request a quote <span aria-hidden="true">↗</span></a></section>
<aside class="notice">Details from the provider’s website, checked ${esc(data.checkedAt)}. Confirm availability and service at your address. No paid placement or partnership is implied.</aside>
<section class="packages"><div class="panel"><h2>Interior package</h2><div class="price">${price(l.interiorPrice)}</div></div><div class="panel"><h2>Full detail package</h2><div class="price">${price(l.fullPrice)}</div></div></section>
<section class="details"><h2>Before the appointment</h2><dl><dt>Water, power &amp; parking</dt><dd>${esc(l.waterPowerNote)}</dd><dt>Pet hair</dt><dd>${esc(l.petHairNote)}</dd><dt>Services mentioned</dt><dd>${esc(l.services.map(s=>s.replaceAll('-', ' ')).join(', '))}</dd><dt>Information source</dt><dd><a href="${esc(l.source)}" rel="noopener noreferrer">Provider website</a> · checked ${esc(data.checkedAt)}</dd></dl><a href="${esc(correction)}" data-directory-interest="correction">Suggest a correction by email</a></section>` , l.id));
}
writeFileSync(join(out, 'get-listed.html'), shell('Get listed', 'Suggest a local business for private editorial review.', `<section class="hero compact"><span class="eyebrow">For local businesses</span><h1>Help people find the right fit.</h1><p class="lead">Suggest a mobile detailing, junk removal, or home Level 2 EV charger installation business serving Northern Kentucky or Cincinnati. We review the details before adding any public listing.</p></section>
<section class="panel request-panel"><h2>Request a listing</h2><p>There is no listing fee during this pilot. A request does not guarantee inclusion. No account or phone number is needed.</p>
<p id="request-environment" class="notice">Your request will be reviewed before any listing is published.</p>
<form id="directory-request" aria-describedby="request-privacy">
<div id="request-error" role="alert" tabindex="-1" hidden></div>
<label for="directory-category">Business category</label><select id="directory-category" name="category" required><option value="">Choose a category</option><option value="mobile-detailing">Mobile detailing</option><option value="junk-removal">Junk removal</option><option value="ev-charger-installation">Home Level 2 EV charger installation</option></select>
<label for="business-name">Business name</label><input id="business-name" name="business_name" autocomplete="organization" maxlength="120" required>
<label for="business-website">Business website</label><input id="business-website" name="website" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com" maxlength="500" required>
<label for="service-area">Service area</label><input id="service-area" name="service_area" placeholder="For example: Covington, Florence and Cincinnati" maxlength="240" required>
<label for="service-details">Services and useful details</label><textarea id="service-details" name="service_details" rows="5" maxlength="2000" aria-describedby="service-help" required></textarea><p id="service-help" class="small">Choose a category, then describe your services. Include corrections here if your business is already listed.</p>
<label for="contact-email">Contact email</label><input id="contact-email" name="contact_email" type="email" inputmode="email" autocomplete="email" maxlength="254" required>
<div class="request-honeypot" aria-hidden="true"><label for="company-fax">Leave this field empty</label><input id="company-fax" name="company_fax" tabindex="-1" autocomplete="off"></div>
<p id="request-privacy" class="small">Your request is saved privately for editorial review and follow-up by email. Your contact email is not added to a public listing or a marketing list. Do not include sensitive personal information. <a href="https://app.jobhackai.io/privacy">Privacy policy</a>.</p>
<button class="button" id="request-submit" type="submit" disabled>Save listing request</button>
<noscript><p>JavaScript is needed to submit this form. You can email support@jobhackai.io instead.</p></noscript>
</form><div id="request-success" role="status" tabindex="-1" hidden><h2>Request saved</h2><p>Your details are saved privately for review. Nothing has been published. Keep this reference if you need to contact us.</p><p id="request-reference"></p><p class="small">This confirms storage of your request, not email delivery or acceptance of a listing.</p></div>
<p class="small">Need help? <a href="mailto:support@jobhackai.io">support@jobhackai.io</a></p></section><p><a href="/directory">Back to the directory</a></p><script src="${assets['request-form.js']}" defer></script>`, '', '/directory/get-listed', ''));
buildAdditionalCategories({root, out, shell, esc});
console.log(`Built directory hub, ${data.listings.length} provider pages and Get listed.`);
