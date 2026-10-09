// Keep this helper dependency-free: role and directory generators also use it.
export const SITE = 'https://jobhackai.io';
export const BEGIN = '<!-- BEGIN AGENT DISCOVERY -->';
export const END = '<!-- END AGENT DISCOVERY -->';
export const LOCAL_ARTICLE = '/blog/compare-mobile-detailing-cincinnati-nky';

// One classification for HTML discovery, indexes, bundles, and response headers.
export function isLocalPage(url) {
  const path = new URL(url, SITE).pathname.replace(/\.html\.md$|\.html$|\.md$/, '');
  return path === '/directory' || path.startsWith('/directory/') || path === LOCAL_ARTICLE;
}

export function agentIndexPath(url) {
  return isLocalPage(url) ? '/directory/llms.txt' : '/llms.txt';
}

export function markdownPath(url) {
  const path = new URL(url).pathname;
  return path.endsWith('/') ? `${path}index.md` : `${path.replace(/\.html$/, '')}.md`;
}

export function withoutDiscovery(html) {
  return html.replace(/<!-- BEGIN AGENT DISCOVERY -->[\s\S]*?<!-- END AGENT DISCOVERY -->\n?/g, '');
}

export function withAgentDiscovery(html, url) {
  const block = `${BEGIN}\n<link rel="alternate" type="text/markdown" href="${markdownPath(url)}">\n<link rel="describedby" type="text/markdown" href="${agentIndexPath(url)}">\n${END}`;
  if (html.includes(BEGIN)) {
    if (!html.includes(END)) throw new Error('Incomplete agent discovery block');
    return html.replace(/<!-- BEGIN AGENT DISCOVERY -->[\s\S]*?<!-- END AGENT DISCOVERY -->/, block);
  }
  if (!/<\/head>/i.test(html)) throw new Error('Missing HTML head');
  return html.replace(/<\/head>/i, `${block}\n</head>`);
}
