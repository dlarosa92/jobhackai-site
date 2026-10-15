import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
// These diagnostic pages are deliberately denied by production middleware.
const blocked = ['voice-coaching-check.html', 'voice-connection-check.html', 'text-model-check.html'];
const restored = ['404', 'about', 'dashboard-trial', 'demo-improved-flow', 'features',
  'free-account-onboarding', 'help', 'interview-questions-mockup', 'privacy',
  'resume-feedback-all-plans-mockup', 'resume-feedback-redesign-mockup-pro-with-feedback',
  'resume-feedback-redesign-mockup-pro', 'resume-feedback-redesign-mockup',
  'resume-feedback-ux-improved', 'resume-feedback-ux-mockup', 'skeleton-loading-mockup',
  'terms', 'test-navigation', 'test-user-flow'];

for (const file of readdirSync(root).filter(name => name.endsWith('.html'))) {
  test(`${file}: deployed HTML has one consent owner or an explicit production block`, () => {
    if (blocked.includes(file)) {
      assert.ok(read('app/functions/_middleware.js').includes(`'/${file}'`));
      return;
    }
    const html = read(file);
    const loaders = [...html.matchAll(/<script\b[^>]*src=["']([^"']*cookie-consent\.js[^"']*)["'][^>]*>/gi)];
    assert.equal(loaders.length, 1, 'Missing or duplicate consent owner');
    assert.match(loaders[0][0], /\bdefer\b/);
    assert.doesNotMatch(html, /<script[^>]*src=["'][^"']*googletagmanager\.com\/gtag\/js/i);
  });
}
for (const page of restored) {
  test(`${page}: auth restoration can release the consent gate without bypassing it`, () => {
    const html = read(`${page}.html`);
    assert.match(html, /<script\b[^>]*type=["']module["'][^>]*src=["'][^"']*firebase-auth\.js|<script\b[^>]*src=["'][^"']*firebase-auth\.js[^>]*type=["']module["']/);
    assert.ok(html.indexOf('cookie-consent.js') < html.indexOf('firebase-auth.js'));
    assert.match(html, /href=["'][^"']*css\/(?:main|cookie-consent)\.css/);
    assert.doesNotMatch(html, /__REAL_AUTH_READY\s*=\s*true/);
  });
}
test('isolated consent styles match shared source without restyling legacy pages', () => {
  const main = read('css/main.css');
  assert.equal(read('css/cookie-consent.css'), main.slice(main.indexOf('/* Cookie Consent Banner */')));
});

test('legacy HTML asset alias routes to the tracked dashboard-trial page', () => {
  const redirects = read('app/public/_redirects');
  assert.match(redirects, /^\/js\/dashboard-trial\.html +\/dashboard-trial +301$/m);
  assert.match(redirects, /^\/js\/dashboard-trial +\/dashboard-trial +301$/m);
  assert.ok(redirects.indexOf('/js/dashboard-trial ') < redirects.indexOf('/* '));
  assert.match(read('dashboard-trial.html'), /cookie-consent\.js/);
});
