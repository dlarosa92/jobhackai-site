# Voice beta content and marketing assets

Status: draft preparation only. Production deployment, public posting and scheduling remain held. No publication date or live-destination verification is claimed.

## Article

- Source: `marketing/blog/how-to-answer-tell-me-about-yourself.html`.
- Canonical path: `/blog/how-to-answer-tell-me-about-yourself`.
- Campaign: `voice_beta_2026_09`; asset: `tell_me_about_yourself_blog_01`.
- Adapted from the owned Penny draft, with original wording, explicitly fictional examples, and links to Indeed and The Muse for the answer structure. The timed exercise is guidance, not a research finding.
- Draft is `noindex, nofollow`, visibly labeled for review, absent from the blog index and sitemap, and contains no invented publication date or customer outcome.
- Before approved publication: check both final articles; add the actual publication metadata, discovery links and indexing; verify the deployed canonical page before adding social campaign URLs.

## Linked practice guide

The existing `/blog/mock-interview-online` guide is revised in this same draft: practical advice replaces unsupported neuroscience/therapy claims, an invented 15 percent result, guaranteed-outcome framing, and generated images presented as product screenshots. The original publication date and canonical path are retained; a new publication/modification date is not invented before release. The title, description, social metadata and existing blog card match the revised copy. The product section distinguishes typed practice from voice and the free preview from full paid reports.

## Shared assets

The live Cloudflare marketing deployment settings were inspected on September 20, 2026: no build command is configured. Checked-in marketing assets are therefore required. Run `node marketing/scripts/sync-shared-assets.mjs` after changing the root consent or blog CTA script. CI verifies byte equality with `--check`.

Marketing pages load their own deployed copies instead of reaching into the production app for these scripts. Production consent destinations remain defined by the shared consent source; nonproduction analytics stays off by default. Local preview has no consent API: a local saved preference with pending account sync is expected, and is not evidence of successful server sync.

Blog offers now describe free preparation tools, one lifetime free voice interview with a feedback preview, and full paid reports/transcripts. Existing CTA blocks are reused. A CTA view requires at least 50 percent visibility, a visible document, and analytics consent; loading a below-fold CTA is not a view. No extra analytics identity or storage is introduced.

Preview navigation, footer and blog CTA app destinations use development, or QA for the `develop` marketing alias. Actual production hosts continue using the production app.

## Evidence and limits

- 42 local tests passed: blog visibility/consent, duplication, preview destinations, shared navigation/footer and existing analytics consent regressions.
- Shared asset equality and article script/style/icon existence checks passed.
- Local Chrome desktop and 375px iframe rendering checked; mobile menu opened and cookie rejection was operable. This is responsive browser evidence, not a native mobile-device test.
- Article remained a draft throughout. Neither a public post nor GA receipt was produced by these checks.
- Existing blog and Marblism draft backlogs still need individual factual review. This change does not endorse old statistical claims, fear-based framing or outdated product promises in their bodies.

## Social handoff

Sonny saved separate LinkedIn and Instagram article adaptations; their public release remains held. On September 20, Codex saved and reopened a clearer LinkedIn body beginning “A useful way to prepare for ‘Tell me about yourself’ is to write three prompts”. It contains an illustrative coordinator example and no unverified URL. Sonny subsequently read the saved records and reported canonical LinkedIn record `496a8590-3e55-4688-bb22-7bcd2afb8816`; its parent `47784b1e-ad32-4ef2-b498-a274f93fdc24` carries the older copy and is superseded in the register, with no publishing, scheduling or deletion. These IDs come from his recorded handoff, while the canonical body was independently saved and reopened through the UI. Do not delete drafts as a metadata workaround.

Codex may verify final destinations and supply campaign URLs after approved publication. This routine verification does not require the owner personally to check a URL. Use the correct platform source and distinct content IDs. Leave verified destination and publication timestamp blank until evidenced. The older draft backlog is excluded from this launch until individually reviewed.
