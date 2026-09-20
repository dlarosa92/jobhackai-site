# Voice beta content and marketing assets

Status: draft preparation only. Production deployment, public posting and scheduling remain held. No publication date or live-destination verification is claimed.

## Article

- Source: `marketing/blog/how-to-answer-tell-me-about-yourself.html`.
- Canonical path: `/blog/how-to-answer-tell-me-about-yourself`.
- Campaign: `voice_beta_2026_09`; asset: `tell_me_about_yourself_blog_01`.
- Adapted from the owned Penny draft, with original wording, explicitly fictional examples, and links to Indeed and The Muse for the answer structure. The timed exercise is guidance, not a research finding.
- Draft is `noindex, nofollow`, visibly labeled for review, absent from the blog index and sitemap, and contains no invented publication date or customer outcome.
- Before approved publication: finish the linked legacy mock-interview guide's factual review; check the final copy; add the actual publication metadata, discovery links and indexing; verify the deployed canonical page before adding social campaign URLs.

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

Sonny saved separate LinkedIn and Instagram article adaptations; their public release remains held. On September 20, Codex saved and reopened a clearer LinkedIn body beginning “A useful way to prepare for ‘Tell me about yourself’ is to write three prompts”. It contains an illustrative coordinator example and no unverified URL. A duplicate-looking card still needs saved-ID reconciliation by Sonny; do not delete drafts as a metadata workaround.

Codex may verify final destinations and supply campaign URLs after approved publication. This routine verification does not require the owner personally to check a URL. Use the correct platform source and distinct content IDs. Leave verified destination and publication timestamp blank until evidenced. The older draft backlog is excluded from this launch until individually reviewed.
