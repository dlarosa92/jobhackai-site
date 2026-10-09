import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { buildAgentMarkdown, convertPage } from '../scripts/build-agent-markdown.mjs';
import { buildMarketingSite } from '../scripts/build.mjs';
import { agentIndexPath, isLocalPage, withoutDiscovery } from '../scripts/agent-discovery.mjs';
import { buildRolePages } from '../scripts/build-role-pages.mjs';
import { editorialDates } from '../scripts/editorial-dates.mjs';

const url = 'https://jobhackai.io/blog/practice';
const html = (canonical = url, content = '<h1>Practice</h1><p>One public answer.</p>', schema = '') => `<!doctype html>
<html lang="en"><head><title>Practice &amp; prepare</title><meta name="description" content="A public interview guide.">
<link rel="canonical" href="${canonical}">${schema}</head><body><nav>Navigation noise</nav><main>${content}</main><footer>Footer noise</footer></body></html>`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jobhackai-agent-content-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'blog'));
  writeFileSync(join(root, 'index.html'), html('https://jobhackai.io/'));
  writeFileSync(join(root, 'blog/practice.html'), html());
  writeFileSync(join(root, '_headers'), 'https://qa-marketing.jobhackai.io/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');
  writeFileSync(join(root, 'sitemap.xml'), '<urlset><url><loc>https://jobhackai.io/</loc></url><url><loc>https://jobhackai.io/blog/practice</loc></url></urlset>');
  return root;
}

test('retains visible answers, plan limits and the original structured data', () => {
  const offer = { '@context': 'https://schema.org', '@type': 'Offer', price: '17.00', priceCurrency: 'USD', description: '60 interviews per month' };
  const result = convertPage(html(url, '<h1>Practice</h1><p>$17 per week. 60 interviews per month.</p><details><summary>Can I cancel?</summary><p>Cancel anytime.</p></details>', `<script type="application/ld+json">${JSON.stringify(offer)}</script>`), url);
  assert.match(result.markdown, /# Practice/);
  assert.match(result.markdown, /\$17 per week\. 60 interviews per month\./);
  assert.match(result.markdown, /### Can I cancel\?\n\nCancel anytime\./);
  const schema = result.markdown.match(/```json\n([\s\S]*?)\n```/)[1];
  assert.deepEqual(JSON.parse(schema), offer);
  assert.equal(result.title, 'Practice & prepare');
});

test('removes scripts, navigation, form values, hidden UI and decorative images', () => {
  const content = `<h1>Visible guide</h1><p>Visible content.</p><script>globalThis.secret = 'SCRIPT_VALUE';</script><style>.secret { content: 'STYLE_VALUE' }</style>
<form><input value="FORM_VALUE"><textarea>TEXTAREA_VALUE</textarea></form><p hidden>HIDDEN_VALUE</p><p aria-hidden="true">ARIA_VALUE</p>
<p style="display: none">CSS_VALUE</p><template>TEMPLATE_VALUE</template><img src="/icon.png" alt=""><nav>NESTED_NAV_VALUE</nav>`;
  const markdown = convertPage(html(url, content), url).markdown;
  assert.match(markdown, /Visible content/);
  assert.doesNotMatch(markdown, /SCRIPT_VALUE|STYLE_VALUE|FORM_VALUE|TEXTAREA_VALUE|HIDDEN_VALUE|ARIA_VALUE|CSS_VALUE|TEMPLATE_VALUE|NAV_VALUE|Navigation noise|Footer noise|icon\.png/);
});

test('resolves page-relative links, fragments and images and retains campaign tags', () => {
  const content = `<h1>Links</h1><a href="../features?utm_source=chatgpt&amp;utm_campaign=voice#plans">Plans</a>
<a href="next">Next guide</a><a href="#answer">Answer</a><a href="mailto:support@jobhackai.io">Contact</a><img src="/assets/example.png" alt="Example scorecard">`;
  const markdown = convertPage(html(url, content), url).markdown;
  assert.match(markdown, /https:\/\/jobhackai.io\/features\?utm_source=chatgpt&utm_campaign=voice#plans/);
  assert.match(markdown, /https:\/\/jobhackai.io\/blog\/next/);
  assert.match(markdown, /https:\/\/jobhackai.io\/blog\/practice#answer/);
  assert.match(markdown, /mailto:support@jobhackai.io/);
  assert.match(markdown, /!\[Example scorecard\]\(https:\/\/jobhackai.io\/assets\/example.png\)/);
});

test('unsafe link schemes and embedded credentials are never emitted', () => {
  const content = '<h1>Links</h1><a href="javascript:alert(1)">Unsafe one</a><a href="data:text/html,secret">Unsafe two</a><a href="https://username:password@example.com/">Unsafe three</a><a href="https://example.com/path(a)">Safe</a>';
  const markdown = convertPage(html(url, content), url).markdown;
  assert.doesNotMatch(markdown, /javascript:|data:text|username|password/);
  assert.match(markdown, /Unsafe one/);
  assert.match(markdown, /\[Safe\]\(https:\/\/example.com\/path%28a%29\)/);
});

test('tables retain all prices, links and pipe characters with or without headings', () => {
  const content = `<h1>Plans</h1><table><tr><th>Plan</th><th>Price</th></tr><tr><td><a href="/features">Weekly | Pass</a></td><td>$17</td></tr></table>
<table><tr><td>Pack</td><td>$39</td></tr><tr><td>Sessions</td><td>5</td></tr></table>`;
  const markdown = convertPage(html(url, content), url).markdown;
  assert.match(markdown, /\| Plan \| Price \|\n\| --- \| --- \|/);
  assert.ok(markdown.includes('[Weekly \\| Pass](https://jobhackai.io/features) | $17'));
  assert.match(markdown, /\| Pack \| \$39 \|/);
  assert.match(markdown, /\| Sessions \| 5 \|/);
});

test('provider disclaimers and definition lists remain readable', () => {
  const markdown = convertPage(html(url, '<h1>Provider</h1><aside>No endorsement is implied.</aside><div class="price"><strong>From $199</strong><span>Interior package</span></div><dl><dt>Water</dt><dd>Customer supplies water.</dd></dl>'), url).markdown;
  assert.match(markdown, /No endorsement is implied/);
  assert.match(markdown, /\*\*From \$199\*\*\n\nInterior package/);
  assert.match(markdown, /\*\*Water\*\*\n\nCustomer supplies water/);
});

test('line breaks keep headings intact and preserve paragraph breaks without trailing whitespace', () => {
  const markdown = convertPage(html(url, '<h1>Practice<br>out loud</h1><p>One<br>Two</p>'), url).markdown;
  assert.match(markdown, /# Practice out loud/);
  assert.ok(markdown.includes('One\\\nTwo'));
  assert.ok(markdown.split('\n').every(line => !/[ \t]+$/.test(line)));
});

test('rejects noindex pages, wrong canonicals and invalid structured data', () => {
  assert.throws(() => convertPage(html().replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>'), url), /noindex/);
  assert.throws(() => convertPage(html().replace(url, 'https://example.com/'), url), /canonical/);
  assert.throws(() => convertPage(html(url, '<h1>Practice</h1>', '<script type="application/ld+json">{broken}</script>'), url), /JSON-LD/);
});

test('build is reproducible and check mode detects drift without writing', t => {
  const root = fixture(t);
  assert.equal(buildAgentMarkdown({ root }).pages, 2);
  assert.equal(buildAgentMarkdown({ root }).changed, 0);
  assert.equal(buildAgentMarkdown({ root, check: true }).changed, 0);
  const source = join(root, 'blog/practice.html');
  const markdown = readFileSync(join(root, 'blog/practice.md'), 'utf8');
  writeFileSync(source, readFileSync(source, 'utf8').replace('One public answer.', 'Updated public answer.'));
  assert.throws(() => buildAgentMarkdown({ root, check: true }), /Agent content is stale/);
  assert.equal(readFileSync(join(root, 'blog/practice.md'), 'utf8'), markdown);
  buildAgentMarkdown({ root });
  assert.match(readFileSync(join(root, 'blog/practice.md'), 'utf8'), /Updated public answer/);
});

test('discovery links resolve, headers preserve preview protection and manifest hashes match', t => {
  const root = fixture(t);
  buildAgentMarkdown({ root });
  const manifest = JSON.parse(readFileSync(join(root, 'agent-index.json'), 'utf8'));
  for (const page of manifest.pages) {
    const sourcePath = new URL(page.url).pathname === '/' ? 'index.html' : 'blog/practice.html';
    const $ = load(readFileSync(join(root, sourcePath), 'utf8'));
    assert.equal($('link[rel="alternate"][type="text/markdown"]').attr('href'), page.path);
    assert.equal($('link[rel="describedby"]').attr('href'), '/llms.txt');
    assert.equal($('link[rel="alternate"]').length, 1);
    const markdown = readFileSync(join(root, page.path), 'utf8');
    assert.equal(createHash('sha256').update(markdown).digest('hex'), page.markdown_sha256);
    assert.equal(Buffer.byteLength(markdown), page.bytes);
    assert.ok(readFileSync(join(root, 'llms.txt'), 'utf8').includes(page.markdown));
  }
  const headers = readFileSync(join(root, '_headers'), 'utf8');
  assert.ok(headers.startsWith('https://qa-marketing.jobhackai.io/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store'));
  assert.match(headers, /Content-Type: text\/markdown; charset=utf-8/);
  assert.match(headers, /Link: <\/llms.txt>; rel="describedby"/);
  assert.match(headers, /\/\*\.md\n[^]*?X-Robots-Tag: noindex/);
});

test('removing a page removes its generated Markdown and stale discovery links', t => {
  const root = fixture(t);
  buildAgentMarkdown({ root });
  writeFileSync(join(root, 'sitemap.xml'), '<urlset><url><loc>https://jobhackai.io/</loc></url></urlset>');
  assert.throws(() => buildAgentMarkdown({ root, check: true }), /stale/);
  assert.equal(buildAgentMarkdown({ root }).removed, 1);
  assert.equal(existsSync(join(root, 'blog/practice.md')), false);
  assert.doesNotMatch(readFileSync(join(root, 'blog/practice.html'), 'utf8'), /AGENT DISCOVERY/);
  assert.doesNotMatch(readFileSync(join(root, 'llms.txt'), 'utf8'), /practice\.md/);
});

test('never overwrites manually authored Markdown', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'blog/practice.md'), '# Manual content');
  assert.throws(() => buildAgentMarkdown({ root }), /manually authored/);
  assert.equal(readFileSync(join(root, 'blog/practice.md'), 'utf8'), '# Manual content');
  assert.equal(existsSync(join(root, 'index.md')), false);
});

test('sitemap cannot convert app pages, offsite content or duplicate URLs', t => {
  const root = fixture(t);
  for (const invalid of ['https://app.jobhackai.io/account', 'https://jobhackai.io/api/account', 'https://example.com/blog/practice']) {
    writeFileSync(join(root, 'sitemap.xml'), `<urlset><url><loc>${invalid}</loc></url></urlset>`);
    assert.throws(() => buildAgentMarkdown({ root }), /allowed public/);
  }
  writeFileSync(join(root, 'sitemap.xml'), `<urlset><url><loc>${url}</loc></url><url><loc>${url}</loc></url></urlset>`);
  assert.throws(() => buildAgentMarkdown({ root }), /Duplicate/);
});

test('more than 100 public pages do not exhaust Cloudflare header rules', t => {
  const root = fixture(t);
  let sitemap = '<urlset><url><loc>https://jobhackai.io/</loc></url>';
  for (let index = 0; index < 110; index++) {
    const pageUrl = `https://jobhackai.io/blog/guide-${index}`;
    writeFileSync(join(root, `blog/guide-${index}.html`), html(pageUrl));
    sitemap += `<url><loc>${pageUrl}</loc></url>`;
  }
  writeFileSync(join(root, 'sitemap.xml'), `${sitemap}</urlset>`);
  assert.equal(buildAgentMarkdown({ root }).pages, 111);
  const rules = readFileSync(join(root, '_headers'), 'utf8').split('\n').filter(line => line && !/^[\s#]/.test(line));
  assert.ok(rules.length < 20);
});

test('all checked-in public Markdown matches current website HTML', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.ok(buildAgentMarkdown({ root, check: true }).pages > 0);
});

test('deployable output includes public assets and omits dependencies, tests and source data', t => {
  const root = fixture(t);
  const redirects = '/go/voice-x https://jobhackai.io/features?utm_source=x&utm_medium=organic_social 302\n';
  writeFileSync(join(root, '_redirects'), redirects);
  for (const dir of ['scripts', 'tests', 'data', 'node_modules']) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, 'private-source.txt'), 'Do not publish');
  }
  writeFileSync(join(root, 'package.json'), '{}');
  const { out } = buildMarketingSite({ root });
  for (const asset of ['index.html', 'index.md', 'blog/practice.html', 'blog/practice.md', 'llms.txt', 'llms-full.txt', 'directory/llms.txt', 'directory/llms-full.txt', 'agent-index.json', '_headers', '_redirects']) {
    assert.equal(existsSync(join(out, asset)), true, asset);
  }
  assert.equal(readFileSync(join(out, '_redirects'), 'utf8'), redirects);
  for (const asset of ['scripts', 'tests', 'data', 'node_modules', 'package.json']) {
    assert.equal(existsSync(join(out, asset)), false, asset);
  }
  writeFileSync(join(out, 'stale.md'), '# Stale asset');
  buildMarketingSite({ root });
  assert.equal(existsSync(join(out, 'stale.md')), false);
});

test('Local content has its own index and full bundle, including the comparison article outside /directory/', t => {
  const root = fixture(t);
  const localPaths = ['/directory/', '/directory/junk-removal/example', '/blog/compare-mobile-detailing-cincinnati-nky'];
  let sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  for (const path of localPaths) {
    const source = path.endsWith('/') ? `${path}index.html` : `${path}.html`;
    mkdirSync(dirname(join(root, source)), { recursive: true });
    writeFileSync(join(root, source), html(`https://jobhackai.io${path}`));
    sitemap = sitemap.replace('</urlset>', `<url><loc>https://jobhackai.io${path}</loc></url></urlset>`);
  }
  writeFileSync(join(root, 'sitemap.xml'), sitemap);
  const home = readFileSync(join(root, 'index.html'), 'utf8').replace('</main>', '<p class="hero-subtitle">Published product explanation.</p><div class="hero-card"><p>Published free and paid boundary.</p></div></main>');
  writeFileSync(join(root, 'index.html'), home);
  buildAgentMarkdown({ root });
  const main = readFileSync(join(root, 'llms.txt'), 'utf8');
  assert.match(main, /> Published product explanation\./);
  assert.match(main, /Published free and paid boundary\./);
  assert.ok(main.indexOf('## Account and pricing') < main.indexOf('## Interview questions'));
  assert.ok(main.indexOf('/directory/llms.txt') > main.indexOf('## Optional'));
  const manifest = JSON.parse(readFileSync(join(root, 'agent-index.json'), 'utf8'));
  for (const page of manifest.pages) {
    const local = localPaths.includes(new URL(page.url).pathname);
    const prefix = local ? 'directory/' : '';
    const opposite = local ? '' : 'directory/';
    assert.equal(isLocalPage(page.url), local);
    assert.ok(readFileSync(join(root, prefix + 'llms.txt'), 'utf8').includes(page.markdown));
    assert.ok(readFileSync(join(root, prefix + 'llms-full.txt'), 'utf8').includes(`Markdown: ${page.markdown}\n`));
    assert.ok(!readFileSync(join(root, opposite + 'llms-full.txt'), 'utf8').includes(`Markdown: ${page.markdown}\n`));
    const source = page.path.replace(/\.md$/, '.html');
    const $ = load(readFileSync(join(root, source), 'utf8'));
    assert.equal($('link[rel="describedby"]').attr('href'), agentIndexPath(page.url));
  }
  const headers = readFileSync(join(root, '_headers'), 'utf8');
  assert.match(headers, /\/directory\/\*\n  Link: <\/directory\/llms.txt>/);
  assert.match(headers, /\/blog\/compare-mobile-detailing-cincinnati-nky\*\n  Link: <\/directory\/llms.txt>/);
  assert.equal(withoutDiscovery(readFileSync(join(root, 'index.html'), 'utf8')), home);
});

test('every current public page belongs to exactly one complete bundle', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, 'agent-index.json'), 'utf8'));
  const main = readFileSync(join(root, 'llms-full.txt'), 'utf8');
  const local = readFileSync(join(root, 'directory/llms-full.txt'), 'utf8');
  for (const page of manifest.pages) {
    const marker = `Markdown: ${page.markdown}\n`;
    assert.equal(main.split(marker).length + local.split(marker).length - 2, 1, page.url);
    assert.ok((isLocalPage(page.url) ? local : main).includes(marker), page.url);
    assert.ok(readFileSync(join(root, agentIndexPath(page.url)), 'utf8').includes(page.markdown), page.url);
  }
});

for (const hub of ['/directory', '/interview-questions']) {
  for (const suffix of ['', '/']) {
    test(`directory-backed hub ${hub}${suffix} resolves its index file and discovery links`, t => {
      const root = fixture(t);
      const url = `https://jobhackai.io${hub}${suffix}`;
      mkdirSync(join(root, hub), { recursive: true });
      const source = join(root, hub, 'index.html');
      writeFileSync(source, html(url));
      const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8').replace('</urlset>', `<url><loc>${url}</loc></url></urlset>`);
      writeFileSync(join(root, 'sitemap.xml'), sitemap);
      buildAgentMarkdown({ root });
      const manifest = JSON.parse(readFileSync(join(root, 'agent-index.json'), 'utf8'));
      const page = manifest.pages.find(page => page.url === url);
      assert.equal(page.path, `${hub}/index.md`);
      assert.ok(existsSync(join(root, page.path)));
      const $ = load(readFileSync(source, 'utf8'));
      assert.equal($('link[rel="alternate"]').attr('href'), page.path);
      assert.equal($('link[rel="canonical"]').attr('href'), url);
      assert.ok(readFileSync(join(root, agentIndexPath(url)), 'utf8').includes(page.markdown));
      assert.equal(buildAgentMarkdown({ root, check: true }).changed, 0);
    });
  }
}

test('editorial dates must be real, nonfuture dates in chronological order', () => {
  const today = '2026-10-09';
  assert.deepEqual(editorialDates({}, 'fixture', today), {});
  assert.deepEqual(editorialDates({ datePublished: '2024-02-29', dateModified: '2026-10-01' }, 'fixture', today), { datePublished: '2024-02-29', dateModified: '2026-10-01' });
  for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-10-10', '2026-1-1', '', null, 2026]) {
    for (const field of ['datePublished', 'dateModified']) {
      assert.throws(() => editorialDates({ [field]: value }, 'fixture', today), /real YYYY-MM-DD/);
    }
  }
  assert.throws(() => editorialDates({ datePublished: '2026-10-01', dateModified: '2026-09-30' }, 'fixture', today), /precedes/);
});

test('role output omits unsupported dates and remains identical across rebuild days', t => {
  const root = fixture(t);
  const dataDir = join(root, 'data/roles');
  mkdirSync(dataDir, { recursive: true });
  const role = JSON.parse(readFileSync(new URL('../data/roles/software-engineer.json', import.meta.url), 'utf8'));
  const source = join(dataDir, 'software-engineer.json');
  const output = join(root, 'interview-questions/software-engineer.html');
  delete role.datePublished;
  delete role.dateModified;
  writeFileSync(source, JSON.stringify(role));
  buildRolePages({ root, today: '2026-10-09' });
  const first = readFileSync(output, 'utf8');
  const firstSitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(first, /"datePublished"|"dateModified"/);
  assert.doesNotMatch(firstSitemap, /<lastmod>/);
  buildRolePages({ root, today: '2026-10-10' });
  assert.equal(readFileSync(output, 'utf8'), first);
  assert.equal(readFileSync(join(root, 'sitemap.xml'), 'utf8'), firstSitemap);
  role.datePublished = '2026-09-01';
  role.dateModified = '2026-10-01';
  writeFileSync(source, JSON.stringify(role));
  buildRolePages({ root, today: '2026-10-10' });
  assert.match(readFileSync(output, 'utf8'), /"dateModified": "2026-10-01"/);
  const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.match(/<lastmod>/g).length, 1);
  assert.match(sitemap, /software-engineer<\/loc>\n    <lastmod>2026-10-01<\/lastmod>/);
  const beforeInvalid = readFileSync(output, 'utf8');
  role.dateModified = '2026-10-11';
  writeFileSync(source, JSON.stringify(role));
  assert.throws(() => buildRolePages({ root, today: '2026-10-10' }), /future/);
  assert.equal(readFileSync(output, 'utf8'), beforeInvalid);
  assert.equal(readFileSync(join(root, 'sitemap.xml'), 'utf8'), sitemap);
});
