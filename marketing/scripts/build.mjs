import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentMarkdown } from './build-agent-markdown.mjs';

export function buildMarketingSite({ root = fileURLToPath(new URL('..', import.meta.url)) } = {}) {
  root = resolve(root);
  const result = buildAgentMarkdown({ root });
  const out = join(root, 'dist');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  // Publish assets only. Dependencies, tests, generators and source data stay out.
  const assets = ['assets', 'css', 'js', 'components', 'blog', 'directory', 'interview-questions',
    'index.html', 'features.html', 'blog.html', 'index.md', 'features.md', 'blog.md',
    'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', 'agent-index.json', '_headers', '_redirects'];
  for (const asset of assets) {
    if (existsSync(join(root, asset))) cpSync(join(root, asset), join(out, asset), { recursive: true });
  }
  return { ...result, out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildMarketingSite();
  console.log(`Built ${result.pages} public pages and Markdown in ${result.out}.`);
}
