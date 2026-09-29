// Cloudflare's marketing project publishes checked-in files without a build.
// Keep these deployable copies reproducible from the app's shared source.
import { readFileSync, writeFileSync } from 'node:fs';
const check = process.argv.includes('--check');
for (const name of ['cookie-consent.js', 'blog-cta.js']) {
  const source = new URL('../../js/' + name, import.meta.url);
  const destination = new URL('../js/' + name, import.meta.url);
  const content = readFileSync(source, 'utf8');
  if (check) {
    let actual;
    try { actual = readFileSync(destination, 'utf8'); } catch { actual = null; }
    if (actual !== content) throw new Error(`${name} is stale: run node marketing/scripts/sync-shared-assets.mjs`);
  } else writeFileSync(destination, content);
}
// The directory needs the shared dialog styles without the main stylesheet's
// homepage/header rules. This tail section is the canonical app CSS source.
const appCss = readFileSync(new URL('../../css/main.css', import.meta.url), 'utf8');
const marker = '/* Cookie Consent Banner */';
const start = appCss.indexOf(marker);
if (start < 0) throw new Error('Shared cookie style section missing');
const cookieCss = appCss.slice(start);
const cookieDestination = new URL('../css/cookie-consent.css', import.meta.url);
if (check) {
  if (readFileSync(cookieDestination, 'utf8') !== cookieCss) throw new Error('Cookie styles are stale: run node marketing/scripts/sync-shared-assets.mjs');
} else writeFileSync(cookieDestination, cookieCss);
console.log(check ? 'Marketing shared assets match source.' : 'Marketing shared assets refreshed.');
