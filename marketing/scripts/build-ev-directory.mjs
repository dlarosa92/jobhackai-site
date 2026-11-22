// EV-only adapter reuses the accepted production template and source fields.
// Existing detailing pages and unrelated product assets remain on their own baseline.
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildAdditionalCategories} from './ev-directory-category.mjs';
import {withAgentDiscovery} from './agent-discovery.mjs';

export function buildEVDirectory({root = fileURLToPath(new URL('..', import.meta.url))} = {}) {
  root = resolve(root);
  const out = join(root,'directory');
  // Include only destinations actually available in this branch's asset tree.
  const junkNavigation = existsSync(join(out,'junk-removal/index.html'))
    ? '<a href="/directory/junk-removal/">Junk removal</a>' : '';
  const assets = Object.fromEntries(['ev-directory.css','consent.css','consent.js','directory.js'].map(name=>[
    name, `/directory/${name}?v=${createHash('sha256').update(readFileSync(join(out,name))).digest('hex').slice(0,12)}`
  ]));
  const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const shell = (title, description, body, listing = '', canonical = listing ? `/directory/ev-charger-installation/${listing}` : '/directory/ev-charger-installation/', category = 'ev-charger-installation', noun = 'installer') => withAgentDiscovery(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | JobHackAI Local</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://jobhackai.io${canonical}"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="${assets['ev-directory.css']}"><link rel="stylesheet" href="${assets['consent.css']}">
<script src="${assets['consent.js']}" defer></script>

</head><body data-listing="${esc(listing)}" data-directory-category="${esc(category)}" data-provider-noun="${esc(noun)}" data-category-page="${!listing && canonical !== '/directory/get-listed'}"><a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="/directory">JobHackAI <span>LOCAL</span></a><nav aria-label="Directory"><a href="/directory">Mobile detailing</a>${junkNavigation}<a href="/directory/ev-charger-installation/">EV charger installation</a><a href="/directory/get-listed${category ? `?category=${esc(category)}` : ''}">Get listed</a></nav></header>
<main id="main" tabindex="-1">${body}</main><footer><p>A local directory experiment from <a href="/">JobHackAI</a>. No paid placements.</p><p><a href="https://app.jobhackai.io/privacy">Privacy</a> · <a href="https://app.jobhackai.io/cookies">Cookies</a> · <a href="/directory/get-listed${category ? `?category=${esc(category)}` : ''}">Suggest a correction</a></p><button type="button" id="open-cookie-preferences">Cookie preferences</button></footer>
<script src="${assets['directory.js']}" defer></script></body></html>`, `https://jobhackai.io${canonical}`);
  buildAdditionalCategories({root,out,shell,esc});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildEVDirectory();
