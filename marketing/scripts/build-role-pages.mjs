#!/usr/bin/env node
/**
 * Programmatic role-page generator for the marketing site.
 *
 * Reads marketing/data/roles/*.json and writes:
 *   - marketing/interview-questions/<slug>.html  (one page per role)
 *   - marketing/interview-questions/index.html   (hub page listing all roles)
 *   - updates the role-page block in marketing/sitemap.xml (between markers)
 *
 * Adding a role = drop a new JSON file in marketing/data/roles/ and run:
 *   node marketing/scripts/build-role-pages.mjs
 *
 * Pages are fully static HTML (server rendered for crawlers). Cloudflare
 * Pages pretty URLs serve /interview-questions/<slug> from <slug>.html.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKETING = join(__dirname, '..');
const DATA_DIR = join(MARKETING, 'data', 'roles');
const OUT_DIR = join(MARKETING, 'interview-questions');
const SITEMAP = join(MARKETING, 'sitemap.xml');
const SITE = 'https://jobhackai.io';
const APP = 'https://app.jobhackai.io';
const TODAY = new Date().toISOString().split('T')[0];

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const jsonEsc = (s) => JSON.stringify(String(s));

function validateRole(role, file) {
  const need = ['slug', 'role', 'category', 'metaDescription', 'intro', 'questions', 'workedAnswers', 'faq'];
  for (const k of need) {
    if (!role[k]) throw new Error(`${file}: missing field "${k}"`);
  }
  if (!Array.isArray(role.intro) || role.intro.join(' ').split(/\s+/).length < 100) {
    throw new Error(`${file}: intro must be paragraphs totaling ~150 words`);
  }
  if (role.questions.length < 10 || role.questions.length > 15) {
    throw new Error(`${file}: needs 10-15 questions, has ${role.questions.length}`);
  }
  if (role.workedAnswers.length !== 2) {
    throw new Error(`${file}: needs exactly 2 worked answers`);
  }
  if (role.faq.length < 3) {
    throw new Error(`${file}: needs at least 3 FAQ entries`);
  }
  if (!/^[a-z0-9-]+$/.test(role.slug)) {
    throw new Error(`${file}: slug must be kebab-case`);
  }
}

const header = (depth) => `  <header class="site-header" id="top">
    <div class="container">
      <a href="${SITE}/" class="nav-logo" aria-label="Go to homepage">
        <svg width="24" height="24" fill="none" stroke="#1F2937" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="7" width="18" height="13" rx="2"/>
          <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
        <span>JOBHACKAI<sup>&trade;</sup></span>
      </a>
      <div class="nav-group">
        <nav class="nav-links" role="navigation">
          <!-- Static fallback for crawlers; replaced by navigation.js -->
          <a href="${SITE}/">Home</a>
          <a href="${SITE}/blog">Blog</a>
          <a href="${SITE}/features">Features</a>
        </nav>
      </div>
      <button class="mobile-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobileNav">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
    </div>
  </header>
  <nav class="mobile-nav" id="mobileNav">
    <!-- Static fallback for crawlers; replaced by navigation.js -->
    <a href="${SITE}/">Home</a>
    <a href="${SITE}/blog">Blog</a>
    <a href="${SITE}/features">Features</a>
  </nav>
  <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
  <script src="${depth}js/mobile-menu.js?v=20250115-1"></script>`;

const footer = () => `  <footer class="site-footer">
    <div class="footer-container">
      <div class="footer-brand">
        <svg class="footer-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="7" width="18" height="13" rx="2" stroke="#1F2937" stroke-width="2"/>
          <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="#1F2937" stroke-width="2"/>
        </svg>
        <span class="footer-name">JOBHACKAI<sup>&trade;</sup></span>
      </div>
      <div class="footer-legal">
        <p>© 2026 JobHackAI. All rights reserved.</p>
      </div>
      <div class="footer-links">
        <a href="${APP}/help.html">Help</a>
        <a href="${APP}/privacy.html">Privacy</a>
        <a href="${APP}/terms.html">Terms</a>
        <a href="${APP}/cookies.html">Cookies</a>
      </div>
    </div>
  </footer>`;

const pageStyles = `
  <style>
    .rq-main { max-width: 820px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    .rq-breadcrumb { font-size: 0.85rem; color: #6B7280; margin-bottom: 1rem; }
    .rq-breadcrumb a { color: #00897B; text-decoration: none; }
    .rq-badge { display: inline-block; background: #E0F2F1; color: #00695C; font-size: 0.78rem; font-weight: 700; padding: 0.2rem 0.7rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.75rem; }
    .rq-main h1 { font-size: 1.9rem; line-height: 1.25; color: #1F2937; margin: 0 0 1rem; }
    .rq-main h2 { font-size: 1.35rem; color: #1F2937; margin: 2.25rem 0 1rem; }
    .rq-main p { color: #374151; line-height: 1.65; }
    .rq-q { background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 0.8rem; }
    .rq-q h3 { margin: 0 0 0.45rem; font-size: 1.02rem; color: #1F2937; }
    .rq-q p { margin: 0.25rem 0; font-size: 0.93rem; color: #4B5563; }
    .rq-q .rq-label { font-weight: 700; color: #00695C; }
    .rq-answer { background: #fff; border-left: 4px solid #00E676; border-radius: 8px; padding: 1.1rem 1.3rem; margin-bottom: 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .rq-answer h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: #1F2937; }
    .rq-answer p { font-size: 0.95rem; }
    .rq-answer .rq-breakdown { font-size: 0.88rem; color: #6B7280; border-top: 1px dashed #E5E7EB; margin-top: 0.8rem; padding-top: 0.8rem; }
    .rq-cta { background: #1F2937; color: #fff; border-radius: 14px; padding: 1.6rem 1.5rem; text-align: center; margin: 2.5rem 0; }
    .rq-cta h2 { color: #fff; margin: 0 0 0.5rem; font-size: 1.3rem; }
    .rq-cta p { color: #D1D5DB; margin: 0 0 1.1rem; }
    .rq-cta a { display: inline-block; background: #00E676; color: #1F2937; font-weight: 700; padding: 0.8rem 1.8rem; border-radius: 8px; text-decoration: none; }
    .rq-faq details { background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 0.85rem 1.1rem; margin-bottom: 0.6rem; }
    .rq-faq summary { font-weight: 600; color: #1F2937; cursor: pointer; }
    .rq-faq p { margin: 0.6rem 0 0; font-size: 0.93rem; }
    .rq-roles-list { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
    @media (min-width: 640px) { .rq-roles-list { grid-template-columns: 1fr 1fr; } }
    .rq-roles-list a { display: block; background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 0.9rem 1.1rem; color: #1F2937; font-weight: 600; text-decoration: none; }
    .rq-roles-list a:hover { border-color: #00E676; }
    .rq-roles-list span { display: block; font-size: 0.85rem; color: #6B7280; font-weight: 400; margin-top: 0.2rem; }
  </style>`;

function ctaBlock(roleName) {
  return `      <div class="rq-cta">
        <h2>You have the questions. Now practice answering them out loud.</h2>
        <p>Reading answers is not the same as saying them. JobHackAI runs a realistic voice mock interview for a ${esc(roleName)} role and scores your answers. Your first voice interview is free.</p>
        <a href="${APP}/login?mode=signup" data-cta="role-page-voice">Practice out loud free</a>
      </div>`;
}

function rolePage(role) {
  const url = `${SITE}/interview-questions/${role.slug}`;
  const title = `${role.role} Interview Questions (2026): ${role.questions.length} Real Questions and Sample Answers`;

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: role.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Interview Questions', item: `${SITE}/interview-questions/` },
      { '@type': 'ListItem', position: 3, name: role.role, item: url }
    ]
  };

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: role.metaDescription,
    author: { '@type': 'Organization', name: 'JobHackAI', url: SITE },
    publisher: { '@type': 'Organization', name: 'JobHackAI', url: SITE },
    datePublished: role.datePublished || TODAY,
    dateModified: TODAY,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }
  };

  const questionsHtml = role.questions.map((q, i) => `        <div class="rq-q">
          <h3>${i + 1}. ${esc(q.q)}</h3>
          <p><span class="rq-label">What they are really asking:</span> ${esc(q.why)}</p>
          <p><span class="rq-label">How to answer:</span> ${esc(q.tip)}</p>
        </div>`).join('\n');

  const answersHtml = role.workedAnswers.map((a) => `        <div class="rq-answer">
          <h3>${esc(a.q)}</h3>
          ${a.answer.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('\n          ')}
          <p class="rq-breakdown"><strong>Why this works:</strong> ${esc(a.breakdown)}</p>
        </div>`).join('\n');

  const faqHtml = role.faq.map((f) => `        <details>
          <summary>${esc(f.q)}</summary>
          <p>${esc(f.a)}</p>
        </details>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${esc(title)} | JobHackAI</title>
  <meta name="description" content="${esc(role.metaDescription)}">
  <link rel="canonical" href="${url}">

  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(role.metaDescription)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="JobHackAI">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(role.metaDescription)}">

  <script type="application/ld+json">
${JSON.stringify(articleLd, null, 2)}
  </script>
  <script type="application/ld+json">
${JSON.stringify(faqLd, null, 2)}
  </script>
  <script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
  </script>

  <link rel="icon" type="image/png" sizes="128x128" href="${APP}/assets/jobhackai_icon_Favicon_128.png">
  <link rel="stylesheet" href="../css/reset.css">
  <link rel="stylesheet" href="../css/tokens.css">
  <link rel="stylesheet" href="../css/main.css">
  <link rel="stylesheet" href="../css/header.css">
  <link rel="stylesheet" href="../css/footer.css">
  <link rel="stylesheet" href="../css/marketing.css">
  <script src="https://app.jobhackai.io/js/cookie-consent.js?v=20260506-1" defer></script>
${pageStyles}
</head>
<body>
${header('../')}

  <main class="rq-main">
    <nav class="rq-breadcrumb" aria-label="Breadcrumb">
      <a href="${SITE}/">Home</a> / <a href="${SITE}/interview-questions/">Interview Questions</a> / ${esc(role.role)}
    </nav>
    <span class="rq-badge">${esc(role.category)}</span>
    <h1>${esc(role.role)} Interview Questions</h1>

${role.intro.map((p) => `      <p>${esc(p)}</p>`).join('\n')}

      <h2>The ${role.questions.length} questions to prepare for</h2>
${questionsHtml}

${ctaBlock(role.role)}

      <h2>Two worked sample answers</h2>
${answersHtml}

      <h2>${esc(role.role)} interview FAQ</h2>
      <div class="rq-faq">
${faqHtml}
      </div>

      <div class="rq-cta">
        <h2>Do a dress rehearsal before the real thing.</h2>
        <p>Run a voice mock interview for your ${esc(role.role)} interview. Get a scorecard, your top strength, and the one thing to fix. First session free.</p>
        <a href="${APP}/login?mode=signup" data-cta="role-page-voice-bottom">Start your free voice interview</a>
      </div>
  </main>

${footer()}

  <script src="../js/component-loader.js?v=20260206-1"></script>
</body>
</html>
`;
}

function hubPage(roles) {
  const url = `${SITE}/interview-questions/`;
  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Interview Questions by Role',
    url,
    description: 'Role specific interview question guides with sample answers, updated for 2026.',
    publisher: { '@type': 'Organization', name: 'JobHackAI', url: SITE }
  };

  const items = roles.map((r) => `        <li><a href="${SITE}/interview-questions/${r.slug}">${esc(r.role)}<span>${r.questions.length} questions with sample answers</span></a></li>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>Interview Questions by Role (2026): Real Questions and Sample Answers | JobHackAI</title>
  <meta name="description" content="Free role specific interview question guides: what interviewers really ask, why they ask it, and worked sample answers. Then practice answering out loud with a voice mock interview.">
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="Interview Questions by Role (2026) | JobHackAI">
  <meta property="og:description" content="Role specific interview questions with sample answers. Practice answering out loud with a free voice mock interview.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">

  <script type="application/ld+json">
${JSON.stringify(listLd, null, 2)}
  </script>

  <link rel="icon" type="image/png" sizes="128x128" href="${APP}/assets/jobhackai_icon_Favicon_128.png">
  <link rel="stylesheet" href="../css/reset.css">
  <link rel="stylesheet" href="../css/tokens.css">
  <link rel="stylesheet" href="../css/main.css">
  <link rel="stylesheet" href="../css/header.css">
  <link rel="stylesheet" href="../css/footer.css">
  <link rel="stylesheet" href="../css/marketing.css">
  <script src="https://app.jobhackai.io/js/cookie-consent.js?v=20260506-1" defer></script>
${pageStyles}
</head>
<body>
${header('../')}

  <main class="rq-main">
    <nav class="rq-breadcrumb" aria-label="Breadcrumb">
      <a href="${SITE}/">Home</a> / Interview Questions
    </nav>
    <h1>Interview questions by role</h1>
    <p>Pick your role. Each guide covers the questions interviewers actually ask, what they are really probing for, and worked sample answers you can adapt. New roles are added regularly.</p>

    <ul class="rq-roles-list">
${items}
    </ul>

${ctaBlock('your target')}
  </main>

${footer()}

  <script src="../js/component-loader.js?v=20260206-1"></script>
</body>
</html>
`;
}

function updateSitemap(roles) {
  const BEGIN = '  <!-- BEGIN ROLE PAGES (auto-generated by scripts/build-role-pages.mjs, do not edit by hand) -->';
  const END = '  <!-- END ROLE PAGES -->';

  let block = [BEGIN];
  block.push(`  <url>
    <loc>${SITE}/interview-questions/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  for (const r of roles) {
    block.push(`  <url>
    <loc>${SITE}/interview-questions/${r.slug}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }
  block.push(END);
  const blockStr = block.join('\n');

  let xml = readFileSync(SITEMAP, 'utf8');
  if (xml.includes(BEGIN)) {
    const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    xml = xml.replace(re, blockStr);
  } else {
    xml = xml.replace('</urlset>', `${blockStr}\n\n</urlset>`);
  }
  writeFileSync(SITEMAP, xml);
}

// ---------- main ----------

const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No role data files found in', DATA_DIR);
  process.exit(1);
}

const roles = files.map((f) => {
  const role = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
  validateRole(role, f);
  return role;
});

mkdirSync(OUT_DIR, { recursive: true });
for (const role of roles) {
  writeFileSync(join(OUT_DIR, `${role.slug}.html`), rolePage(role));
  console.log(`✓ interview-questions/${role.slug}.html`);
}
writeFileSync(join(OUT_DIR, 'index.html'), hubPage(roles));
console.log('✓ interview-questions/index.html (hub)');

updateSitemap(roles);
console.log(`✓ sitemap.xml updated (${roles.length} role pages + hub)`);
