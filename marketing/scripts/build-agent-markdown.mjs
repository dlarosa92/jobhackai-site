#!/usr/bin/env node
// Compile only sitemap-listed public HTML. No network, browser, model, or runtime Worker.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { SITE, LOCAL_ARTICLE, LOCAL_BLOG_INDEX, isLocalPage, markdownPath, withAgentDiscovery, withoutDiscovery } from './agent-discovery.mjs';

const GENERATOR = 'jobhackai-agent-markdown';
const HEADER_BEGIN = '# BEGIN AGENT MARKDOWN';
const HEADER_END = '# END AGENT MARKDOWN';
const sha = text => createHash('sha256').update(text).digest('hex');
const scalar = text => JSON.stringify(text);
const inline = text => text.replace(/\s+/g, ' ').trim().replace(/[\[\]\\]/g, '\\$&');

function safeUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/[()[\]<>\\]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  } catch { return null; }
}

export function convertPage(html, url) {
  const $ = load(html);
  if ($('meta[name="robots"]').toArray().some(el => /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test($(el).attr('content') || ''))) {
    throw new Error(`${url}: noindex pages must not be in the public sitemap`);
  }
  if ($('link[rel="canonical"]').length !== 1 || $('link[rel="canonical"]').attr('href') !== url) {
    throw new Error(`${url}: sitemap and HTML canonical must agree`);
  }
  if ($('main').length !== 1 || !$('main h1').length) throw new Error(`${url}: needs a main element and heading`);
  const title = $('title').text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';
  if (!title || !description) throw new Error(`${url}: title and description are required`);
  const structuredData = $('script[type="application/ld+json"]').toArray().map(el => {
    try { return JSON.parse($(el).html()); }
    catch { throw new Error(`${url}: invalid JSON-LD`); }
  });
  const main = $('main').clone();
  main.find('script, style, template, noscript, nav, svg, canvas, iframe, object, embed, form, input, textarea, select, button, [hidden], [aria-hidden="true"], [data-agent-exclude], .breadcrumb, .rq-breadcrumb, .blog-filters').remove();
  main.find('[style]').each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr('style'))) $(el).remove();
  });
  // These spans are displayed as separate lines by the directory stylesheet.
  main.find('.price > span').each((_, el) => $(el).replaceWith(`<p>${$(el).html()}</p>`));
  main.find('h1 br, h2 br, h3 br, h4 br, h5 br, h6 br').replaceWith(' ');
  // Resolve using the public page URL, not the Markdown asset's file location.
  const base = safeUrl($('base[href]').attr('href') || url, url) || url;
  main.find('a[href], img[src]').each((_, el) => {
    const attr = el.tagName === 'img' ? 'src' : 'href';
    const absolute = safeUrl($(el).attr(attr), base);
    if (el.tagName === 'img' && (!absolute || !$(el).attr('alt')?.trim())) $(el).remove();
    else if (absolute) $(el).attr(attr, absolute);
    else $(el).removeAttr(attr);
  });
  const service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  service.use(gfm);
  service.addRule('faq', { filter: 'summary', replacement: content => `\n\n### ${content.trim()}\n\n` });
  service.addRule('definition-term', { filter: 'dt', replacement: content => `\n\n**${content.trim()}**\n\n` });
  service.addRule('definition-description', { filter: 'dd', replacement: content => `${content.trim()}\n\n` });
  // Preserve every cell, including tables with no header row. Escape GFM pipes.
  service.addRule('table', {
    filter: 'table',
    replacement: (_, node) => {
      const rows = Array.from(node.querySelectorAll('tr')).map(row => ({
        header: Array.from(row.children).every(cell => cell.nodeName === 'TH'),
        cells: Array.from(row.children).filter(cell => ['TD', 'TH'].includes(cell.nodeName))
          .map(cell => service.turndown(cell.innerHTML).replace(/\n+/g, ' ').replace(/\|/g, '\\|'))
      })).filter(row => row.cells.length);
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.cells.length));
      const line = cells => `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
      const header = rows[0].header ? rows.shift().cells : [];
      const caption = node.querySelector('caption')?.textContent?.trim();
      return `\n\n${caption ? `${caption}\n\n` : ''}${[line(header), line(Array(width).fill('---')), ...rows.map(row => line(row.cells))].join('\n')}\n\n`;
    }
  });
  let fence = null;
  const body = service.turndown(main.html()).split('\n').map(line => {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    // Use CommonMark's backslash hard break instead of trailing spaces.
    const hardBreak = /\S.* {2,}$/.test(line);
    return line.trimEnd() + (hardBreak ? '\\' : '');
  }).join('\n').trim();
  if (!body) throw new Error(`${url}: empty Markdown`);
  const metadata = { title, description, url, language: $('html').attr('lang') || 'en', generated_by: GENERATOR };
  const frontmatter = Object.entries(metadata).map(([key, value]) => `${key}: ${scalar(value)}`).join('\n');
  const schema = structuredData.length ? `\n\n## Structured data\n\n\`\`\`json\n${JSON.stringify(structuredData.length === 1 ? structuredData[0] : structuredData, null, 2)}\n\`\`\`` : '';
  return { title, description, markdown: `---\n${frontmatter}\n---\n\n${body}${schema}\n` };
}

function localPath(root, asset) {
  const path = resolve(root, asset.replace(/^\//, ''));
  if (relative(root, path).startsWith('..') || path === root) throw new Error(`Unsafe local asset: ${asset}`);
  if (existsSync(path) && relative(realpathSync(root), realpathSync(path)).startsWith('..')) throw new Error(`Asset escapes marketing root: ${asset}`);
  return path;
}

function sitemapPages(root) {
  const $ = load(readFileSync(join(root, 'sitemap.xml'), 'utf8'), { xmlMode: true });
  const seen = new Set();
  return $('url > loc').toArray().map(el => {
    const url = $(el).text().trim();
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (parsed.origin !== SITE || parsed.search || parsed.hash || !/^\/[a-z0-9/-]*$/.test(path) ||
        !(/^\/$|^\/features$|^\/blog(?:\/|$)|^\/interview-questions(?:\/|$)|^\/directory(?:\/|$)/.test(path))) {
      throw new Error(`Sitemap entry is not an allowed public marketing URL: ${url}`);
    }
    if (seen.has(url)) throw new Error(`Duplicate sitemap entry: ${url}`);
    seen.add(url);
    const source = markdownPath(url).replace(/\.md$/, '.html');
    const html = readFileSync(localPath(root, source), 'utf8');
    const page = convertPage(html, url);
    return { url, source, html, path: markdownPath(url), ...page };
  }).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

function pageList(pages) {
  return pages.map(page => `- [${inline(page.title)}](${SITE}${page.path}): ${inline(page.description)} [HTML](${page.url})`).join('\n') + '\n\n';
}

function agentIndex(pages) {
  const home = pages.find(page => page.url === `${SITE}/`);
  if (!home) throw new Error('Homepage must be in sitemap');
  // Reuse the published explanation, including its free/paid boundary, verbatim.
  const $ = load(home.html);
  const summary = $('main .hero-subtitle').first().text().trim() || home.description;
  const facts = $('main .hero-card p').last().text().trim();
  let text = `# JobHackAI\n\n> ${inline(summary)}\n\n${facts ? `${inline(facts)}\n\n` : ''}`;
  text += '## Product\n\n' + pageList(pages.filter(page => ['/', '/features'].includes(new URL(page.url).pathname)));
  text += '## Account and pricing\n\n- [Pricing](https://app.jobhackai.io/pricing): current plans and billing terms.\n- [Sign up](https://app.jobhackai.io/login?mode=signup): create an account to use the tools.\n\n';
  const groups = [
    ['Interview questions by role', page => /^\/interview-questions(?:\/|$)/.test(new URL(page.url).pathname)],
    ['Interview preparation and job search articles', page => page.url.includes('/blog')]
  ];
  for (const [heading, matches] of groups) {
    text += `## ${heading}\n\n` + pageList(pages.filter(matches));
  }
  text += `## Optional\n\n- [Full product and job search content](${SITE}/llms-full.txt): the product pages, interview guides, and job search articles in one document.\n- [JobHackAI Local](${SITE}/directory/llms.txt): local service listings and comparisons, with a separate full-content document.\n- [Page manifest](${SITE}/agent-index.json): all canonical URLs, Markdown URLs, and content hashes.\n`;
  return text;
}

function localIndex(pages) {
  const home = pages.find(page => ['/directory', '/directory/'].includes(new URL(page.url).pathname));
  let text = `# JobHackAI Local\n\n${home ? `> ${inline(home.description)}\n\n` : ''}`;
  text += '## Directory\n\n' + pageList(pages.filter(page => /^\/directory(?:\/|$)/.test(new URL(page.url).pathname)));
  text += '## Local service guides\n\n' + pageList(pages.filter(page => [LOCAL_BLOG_INDEX, LOCAL_ARTICLE].includes(new URL(page.url).pathname)));
  text += `## Optional\n\n- [Full Local content](${SITE}/directory/llms-full.txt): all Local listings and comparisons in one document.\n- [JobHackAI interview preparation](${SITE}/llms.txt): the product and job search guides.\n- [Page manifest](${SITE}/agent-index.json): all canonical URLs, Markdown URLs, and content hashes.\n`;
  return text;
}

function fullContent(title, pages) {
  return `# ${title}\n\n${pages.map(page => `Source: [${inline(page.title)}](${page.url})\nMarkdown: ${SITE}${page.path}\n\n${page.markdown}`).join('\n---\n\n')}`;
}

function headers(original) {
  const markdownHeaders = '  Content-Type: text/markdown; charset=utf-8\n  Cache-Control: public, max-age=0, must-revalidate';
  const localDiscovery = '  Link: </directory/llms.txt>; rel="describedby"; type="text/markdown"';
  const block = [
    HEADER_BEGIN,
    '/*\n  Link: </llms.txt>; rel="describedby"; type="text/markdown"',
    // Pages joins matching Link headers; Local responses advertise both guides.
    `/directory/*\n${localDiscovery}`,
    `${LOCAL_ARTICLE}*\n${localDiscovery}`,
    `${LOCAL_BLOG_INDEX}*\n${localDiscovery}`,
    '/*.md\n  Content-Type: text/markdown; charset=utf-8\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n  Cache-Control: public, max-age=0, must-revalidate',
    ...['/llms.txt', '/directory/llms.txt'].map(path => `${path}\n${markdownHeaders}`),
    ...['/llms-full.txt', '/directory/llms-full.txt'].map(path => `${path}\n${markdownHeaders}\n  X-Robots-Tag: noindex`),
    '/agent-index.json\n  Content-Type: application/json; charset=utf-8\n  X-Robots-Tag: noindex\n  Cache-Control: public, max-age=0, must-revalidate',
    HEADER_END
  ].join('\n\n');
  if (original.includes(HEADER_BEGIN) && !original.includes(HEADER_END)) throw new Error('Incomplete agent header block');
  const result = original.includes(HEADER_BEGIN)
    ? original.replace(/# BEGIN AGENT MARKDOWN[\s\S]*?# END AGENT MARKDOWN/, block)
    : `${original.trimEnd()}\n\n${block}\n`;
  if (result.split('\n').some(line => line.length > 2000) || result.split('\n').filter(line => line && !/^[\s#]/.test(line)).length > 100) {
    throw new Error('Cloudflare Pages header limits exceeded');
  }
  return result;
}

export function buildAgentMarkdown({ root = fileURLToPath(new URL('..', import.meta.url)), check = false } = {}) {
  root = resolve(root);
  const pages = sitemapPages(root);
  const expected = new Map();
  for (const page of pages) {
    const existing = localPath(root, page.path);
    if (existsSync(existing) && !readFileSync(existing, 'utf8').includes(`generated_by: "${GENERATOR}"`)) {
      throw new Error(`Refusing to overwrite a manually authored file: ${page.path}`);
    }
    expected.set(page.source, withAgentDiscovery(page.html, page.url));
    expected.set(page.path, page.markdown);
  }
  const manifest = { version: 1, generator: GENERATOR, pages: pages.map(page => ({
    url: page.url, markdown: `${SITE}${page.path}`, path: page.path, title: page.title, description: page.description,
    source_sha256: sha(withoutDiscovery(page.html)), markdown_sha256: sha(page.markdown), bytes: Buffer.byteLength(page.markdown)
  })) };
  const oldManifestPath = join(root, 'agent-index.json');
  const previous = existsSync(oldManifestPath) ? JSON.parse(readFileSync(oldManifestPath, 'utf8')) : null;
  if (previous && (previous.generator !== GENERATOR || !Array.isArray(previous.pages))) throw new Error('Unrecognized agent manifest');
  const stale = (previous?.pages || []).filter(page => !expected.has(page.path)).map(page => {
    if (!page.path.endsWith('.md')) throw new Error('Invalid generated asset in previous manifest');
    const path = localPath(root, page.path);
    if (existsSync(path) && !readFileSync(path, 'utf8').includes(`generated_by: "${GENERATOR}"`)) throw new Error(`Stale file is manually authored: ${page.path}`);
    const source = page.path.replace(/\.md$/, '.html');
    const html = localPath(root, source);
    if (existsSync(html)) expected.set(source, withoutDiscovery(readFileSync(html, 'utf8')));
    return path;
  }).filter(existsSync);
  const core = pages.filter(page => !isLocalPage(page.url));
  const local = pages.filter(page => isLocalPage(page.url));
  expected.set('/llms.txt', agentIndex(core));
  expected.set('/llms-full.txt', fullContent('JobHackAI product and job search content', core));
  expected.set('/directory/llms.txt', localIndex(local));
  expected.set('/directory/llms-full.txt', fullContent('JobHackAI Local content', local));
  expected.set('/agent-index.json', `${JSON.stringify(manifest, null, 2)}\n`);
  expected.set('/_headers', headers(readFileSync(join(root, '_headers'), 'utf8')));
  const changes = [...expected].filter(([asset, content]) => !existsSync(localPath(root, asset)) || readFileSync(localPath(root, asset), 'utf8') !== content);
  if (check && (changes.length || stale.length)) {
    throw new Error(`Agent content is stale. Run npm --prefix marketing run build:agents.\n${changes.map(([asset]) => asset).concat(stale.map(path => relative(root, path))).join('\n')}`);
  }
  if (!check) {
    // All source and output checks finish before the first mutation.
    for (const [asset, content] of changes) {
      const path = localPath(root, asset);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    for (const path of stale) rmSync(path);
  }
  return { pages: pages.length, changed: changes.length, removed: stale.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildAgentMarkdown({ check: process.argv.includes('--check') });
    console.log(`${process.argv.includes('--check') ? 'Verified' : 'Built'} Markdown for ${result.pages} public pages (${result.changed} files changed, ${result.removed} removed).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
