# Public Markdown for AI agents

JobHackAI serves a deterministic Markdown representation of each public marketing
page. HTML remains the content source. Conversion uses an HTML parser and Turndown
at build time, with no model calls, browser rendering, database, or runtime Worker.
Cloudflare Pages static asset requests are free and unlimited on free and paid
plans: <https://developers.cloudflare.com/pages/functions/pricing/>.

## Public endpoints and discovery

- `/llms.txt` prioritizes the product, pricing, interview guides, and job search
  articles. Its introduction reuses the published homepage explanation and
  free/paid boundary. Local content is linked under `Optional`.
- `/llms-full.txt` combines product and job search pages (25 at this release).
- `/directory/llms.txt` and `/directory/llms-full.txt` cover Local listings and
  comparisons (23 pages at this release), including the detailing comparison
  article under `/blog/`.
- Every sitemap-listed page still has its own Markdown copy. Prefer individual
  pages when a full document exceeds an agent's context budget.
- `/index.md` represents `/`; `/features.md` represents `/features`.
- `/blog/<slug>.md` represents a blog article.
- `/interview-questions/index.md` represents the role hub; each role has its own
  `.md` file. Directory pages follow the same convention.
- `/agent-index.json` lists canonical HTML URLs, Markdown URLs, byte sizes, and
  SHA-256 hashes, without a timestamp that would change on every build.

Each HTML head includes `rel="alternate" type="text/markdown"` and
`rel="describedby"` links to the appropriate index, following the llms.txt proposal:
<https://llmstxt.org/>. HTTP `Link` headers advertise `/llms.txt`; Local responses
also advertise `/directory/llms.txt`. One shared classification rule in
`agent-discovery.mjs` controls indexes, bundles and HTML discovery. That rule
explicitly assigns the detailing comparison article to Local.
Appending `.md` to an existing `.html` URL redirects to the corresponding `.md`
asset. There is no user-agent sniffing. Browsers and agents receive the same
published facts.

Markdown responses have `Content-Type: text/markdown; charset=utf-8` and `nosniff`.
The HTML canonical is recorded in the Markdown metadata. Markdown copies use
`X-Robots-Tag: noindex` to keep duplicate documents out of ordinary search indexes;
they remain accessible for retrieval. The existing HTML canonicals and sitemap
remain the search entry points. Existing preview noindex headers are preserved.

## Content fidelity and boundaries

The sitemap is the explicit publication allowlist. Each entry must be a local
marketing page with a matching canonical, title, description, main element, and
heading. Offsite URLs, app/API paths, duplicates, noindex pages and invalid JSON-LD
fail the build. The unpublished article template is never converted.

Conversion preserves headings, lists, tables, FAQ answers, definition lists,
meaningful images, source notes, product limits and JSON-LD. It removes scripts,
styles, navigation, forms, input values, hidden elements and decorative images.
Relative links become absolute links based on the HTML URL; existing campaign
parameters survive. Unsafe link schemes and URLs containing credentials are
omitted. Nothing reads user resumes, transcripts, accounts, or authenticated app
responses.

The converter updates only marked discovery blocks in HTML heads and a marked
section of `_headers`. Retired sitemap entries lose their generated Markdown and
discovery links. Manually authored Markdown is never overwritten. The role and
directory generators use the same dependency-free discovery helper.

## Build and verify

From the repository root, with Node 20.18.1 or newer:

```sh
npm --prefix marketing ci --ignore-scripts
npm run build:agents
npm run check:agents
npm run test:agents
npm run build:marketing
```

Run `build:agents` after changing a public page or its sitemap entry and include
the generated files in the same change. The existing marketing workflow checks
that those copies are current and runs the conversion tests. `--check` never
writes files. Repeated builds produce identical content and hashes.

`build:marketing` creates `marketing/dist/`, which contains public assets only.
Dependencies, tests, generators, package files and source data are excluded.

### Editorial dates

Role records in `marketing/data/roles/` may supply `datePublished` and
`dateModified` as real `YYYY-MM-DD` dates. Dates must not be in the future, and
modification must not precede publication. Supply them only with editorial
evidence; a build, deployment, or format conversion is not an editorial update.
Missing dates are omitted from Article JSON-LD. Role sitemap `lastmod` uses only
an explicit `dateModified`; the hub has no inferred `lastmod`. After editing role
data, run `npm run build:roles` and then `npm run build:agents`.

### Regression boundaries

Markdown conversion removes scripts only from its text representation. Website
GA4 configuration, consent scripts, CTA events, app links and campaign parameters
are preserved. Markdown retrieval does not execute GA4; use server/CDN data for
agent downloads. Verify source and output asset inventories, generated HTML
differences, clean URLs, campaign redirects, and production/preview headers
before release. The default build does not rerun role or directory templates;
run those generators only for their corresponding source changes and review
their HTML diffs before regenerating Markdown.

## Release configuration

Live settings read on October 8, 2026:

- Zone: `jobhackai.io`, Free Website plan.
- Pages project: `jobhackai-app-marketing-seo`.
- Root: `marketing`; build command: empty; publish directory: `.`.
- Production branch: `main`; no marketing Pages Functions.

The generated copies support the current no-build deployment. When releasing the
build pipeline, set this marketing project's build command to
`npm ci --ignore-scripts && npm run build` and publish directory to `dist`.
Keep its root and production branch unchanged. This setting change must accompany
the source release. Do not publish the installed `node_modules` directory or
modify the application projects' build settings.

Cloudflare's native Markdown for Agents converter is a different option. Its
current documentation says it is included at no extra cost for Pro, Business,
Enterprise and SSL for SaaS customers, and is not available on the ordinary Free
zone plan: <https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/>.
This implementation needs no zone-plan upgrade. It exposes discoverable `.md`
assets; it does not negotiate the HTML URL using `Accept: text/markdown`.

After a preview deployment, fetch the HTML discovery links, every Markdown URL in
the manifest, and the `.html.md` aliases. Verify `200`, Markdown MIME type and
body hashes, and confirm the preview retains `noindex`. After production release,
repeat those checks against `jobhackai.io` and confirm the deployed Git SHA.
Record the previous deployment and build settings before any release so both
can be restored together. Local implementation and testing do not authorize
committing, pushing, merging, deployment, or remote configuration changes.

## Measurement

Markdown downloads and crawler visits show access, not recommendations or sales.
Use available CDN request data for downloads and agent requests. Use the existing
consented analytics and billing attribution for AI referral visits, signup and
collected purchases. Do not add browser analytics scripts to Markdown responses
or infer purchases from bot activity.

## Production-content validation — October 9, 2026

This earlier validation used the production-based implementation preserved in
local commit `cc1960b`. It is not the current `dev0` candidate.

- All 48 individual Markdown pages are current and discoverable: 25 product/job
  search pages and 23 Local pages, each in exactly one full bundle.
- 138 marketing, consent, CTA and converter tests passed. The 20 converter/date
  tests also passed on Node 20, matching CI.
- Compared all 51 source HTML files before/after regeneration: only discovery
  blocks and the intended removal of unsupported role dates changed.
- All 95 existing public files are in the publishing output. The 39 non-HTML
  public assets compared against Git HEAD are byte-for-byte unchanged, including
  analytics JavaScript and CSS. The shared-asset consistency check passed.
- Local Wrangler 4.135.0 parsed 16 redirect rules and 12 header rules. All 48
  Markdown endpoints, hashes, HTML discovery links, Markdown aliases and HTML
  indexing headers passed. Both QA and Pages-preview host protections passed.
  All 32 referenced local assets resolved without HTML fallback responses.
- All 15 existing explicit redirects retained their status, host, path and
  complete campaign query strings. Same-host redirects use HTTP in the local
  HTTP preview; production HTTPS behavior remains a hosted release check.
- An isolated browser emitted no analytics events before consent and one page
  view after consent. A blog visit emitted exactly one page view, one
  `blog_cta_view`, and one `cta_click`, preserving first/last campaign context.
  These checks used a stubbed consent API, an anonymous auth stub, a test GA ID,
  and a stubbed Google script. Other external dependencies were blocked. They
  verify the local event queue, not receipt in GA4 or the live auth/backend flow.
- Read-only automated GETs to live app pricing and both signup destinations
  returned HTTP 403 from Cloudflare. Their URLs are unchanged. Verify browser
  access on the hosted preview before release; no remote setting was changed.

No commit, push, deployment, or remote configuration change was performed during
that initial validation. The user subsequently authorized the `dev0` pipeline.


## Dev0 integration

The feature is ported onto `dev0` commit `7856cc2`, without importing unrelated
production or application changes. This branch has 24 sitemap-listed public
pages; its Local directory remains a noindex prototype outside the sitemap.
The generator preserves that publication boundary: 23 product/job-search mirrors, one
Local comparison article, and no Markdown discovery links on excluded prototype
pages. The same
generator covers all 48 pages when integrated with current production content.
The original production-based implementation is retained on the local
`codex/agent-markdown` branch.

- 92 applicable dev0 marketing, analytics, CTA and generator tests passed,
  including clean and trailing-slash hub URLs.
- Marketing build, shared-asset consistency and Markdown freshness checks passed.
- Dev0 HTML content and scripts are preserved, apart from the intended discovery
  blocks and removal of unsupported role metadata dates.
- Existing no-build Pages previews can serve the checked-in generated mirrors.
  They do not prove the clean `dist` publishing configuration; that configuration
  must still be coordinated before production promotion.

The repository's deployed-app E2E suite targets the already-live base environment
and changes billing/test-account state. Use its documented `[skip-e2e]` gate for
this static marketing PR; verify the actual candidate marketing deployment
separately.
