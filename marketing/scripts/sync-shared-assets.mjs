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
console.log(check ? 'Marketing shared assets match source.' : 'Marketing shared assets refreshed.');
