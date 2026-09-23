# Directory expansion: production review package

Status: production held. Junk removal and home Level 2 EV charger installation are implemented and verified in Dev and QA. No production database migration, main merge, production deployment, agent run, public campaign publication, live scheduling, outreach or new spending is authorized by this package.

## Review surfaces

- [Draft PR955: API and mobile-only bridge](https://github.com/dlarosa92/jobhackai-site/pull/955).
- [Draft PR956: category pages and campaign packages](https://github.com/dlarosa92/jobhackai-site/pull/956), stacked on PR955.


- [Dev junk removal](https://directory-dev.jobhackai-app-marketing-seo.pages.dev/directory/junk-removal/) and [Dev EV installation](https://directory-dev.jobhackai-app-marketing-seo.pages.dev/directory/ev-charger-installation/).
- [QA junk removal](https://directory-qa.jobhackai-app-marketing-seo.pages.dev/directory/junk-removal/) and [QA EV installation](https://directory-qa.jobhackai-app-marketing-seo.pages.dev/directory/ev-charger-installation/).
- [QA mobile detailing regression](https://directory-qa.jobhackai-app-marketing-seo.pages.dev/directory/) and [QA intake](https://directory-qa.jobhackai-app-marketing-seo.pages.dev/directory/get-listed).
- [Verified businesses and sources](campaigns/directory-expansion-2026-09-23/listing-register.md), [campaign packages](campaigns/directory-expansion-2026-09-23/README.md), [tracking manifest](campaigns/directory-expansion-2026-09-23/manifest.json), [three-category scorecard](directory-experiment-scorecard.md), and [verification evidence](evidence/directory-expansion-2026-09-23/observations.md).

Both production PRs are draft and unmerged. The source of truth is the isolated main-based release branch, not all of dev0 or develop. Base is addf6cadd0b4fcf921ff88ec9eb082c2886d25fc. Production work is split into an intake/bridge stage and a stacked category-page stage to make deployment ordering safe. Dev PR953 and QA PR954 contain only the directory API/migration; Dev additionally updates two existing directory test-harness fixtures. Their unrelated application behavior is retained.

## What changes

Twelve sourced providers, six per category, two comparison hubs, individual provider pages, category navigation, filters, labels, consented analytics, sitemap and production canonicals. Junk guidance includes eligible Cincinnati and Covington pickup options. EV guidance covers independent credential checks, panel assessment, hardware supply, permits, inspections and written scope. Unknowns are explicit; listings are unpaid and are not endorsements or certifications. Provider facts were checked September23 against linked public first-party sources. No providers were contacted.

The mobile root, provider URLs, listing data, prices, guide, filters, campaign namespace and existing event labels are preserved. Directory controls use existing JobHackAI tokens and primary/secondary button colors with keyboard focus, hover, disabled and mobile states. Shared changes are confined to directory assets; unrelated pages, voice, billing and Firebase are excluded.

Migration031 adds a checked category with mobile-detailing as the historical default, notification format version1 for old rows, and a category/date index. New requests explicitly carry a supported category and notification version2. Mobile payload hashes retain their exact historical shape; other categories include category in deduplication. Existing notifications retry with their original bytes and idempotency key. Origin checks, abuse bounds, private review and consent gating remain. Nothing submits a public listing automatically.

## Production migration and deployment order — only after explicit go

Do not merge either production draft or run the production commands before approval. Do not merge dev0/develop wholesale.

1. Fetch main and recheck that both draft diffs contain only this directory release. Recheck migration031 is still the next unused directory migration and the live D1 schema lacks its two new columns. If main or the schema changed, stop and reconcile the exact candidate. Record fresh canonical production app and marketing deployment IDs and queue counts. Keep a private, access-restricted D1 export/backup outside Git; never paste private requests or credentials into the review.
2. Apply only `app/db/migrations/031_directory_request_categories.sql` from the approved API stage: `npx wrangler@4 d1 execute jobhackai-prod-db --env production --remote --file app/db/migrations/031_directory_request_categories.sql`. Confirm DB ID f9b709fd-56c3-4a0b-8141-4542327c9d4d, unchanged request count, historical category mobile-detailing, format1 and all old statuses/hashes intact. This file is additive and not rerunnable; do not use a broad migration-all command.
3. Deploy the approved **mobile-only bridge marketing tree** from the API-stage branch to the marketing project's main production branch. From that branch's `marketing` directory: `npx wrangler@4 pages deploy . --project-name jobhackai-app-marketing-seo --branch main --commit-hash <approved-api-stage-sha>`. It changes only the Get listed form's hidden `category=mobile-detailing`. It works with the old and new APIs; the public directory and campaign remain mobile-only. Verify the hidden field and mobile links before proceeding. Record this bridge deployment ID as the preferred UI rollback.
4. Merge only the approved API-stage PR into main. The existing Git integrations rebuild marketing and the application; the marketing contents are still the same bridge. Wait for **jobhackai-app-prod canonical deployment** to show that exact merged commit and success. Verify category validation and mobile intake against the deployed API. Do not release the new pages until this gate passes.
5. Retarget the reviewed stacked category-page PR to current main if needed, inspect the final diff, resolve only directory overlap, and rerun generation/tests. It must contain the new directory UI/data, scoped styles, measurement, sitemap, docs and tests, with no unrelated branch content. Merge only after the API deployment is verified. Wait for the marketing canonical deployment to match the merged commit and finish. A branch preview or green base-environment E2E is not proof of production deployment.
6. Run the smoke list below. Only then record actual new-category launch timestamps and proposed day7/14/21/28 review dates. Do not reset the mobile campaign clock. Review scheduling itself remains a separate owner-controlled action. Production approval does not automatically activate Marblism or approve social copy/artwork, prospect contact or paid spending.

The bridge prevents a new-category request reaching the old API during the asynchronous Pages builds. A form left open before the bridge can still require a refresh after the API contract changes; check the stale-tab error path during release and keep the bridge available for rollback.

## Live smoke checks after approval

- Mobile root, six existing provider URLs and published guide still resolve with unchanged claims and working provider links; new category hubs and12 provider pages resolve200. New hub clean paths may redirect308 to their canonical trailing-slash form; provider paths remain extensionless.
- Production canonicals and sitemap point only to jobhackai.io. Production pages have no noindex header; directory-dev/directory-qa and other marketing previews still have noindex,nofollow.
- Keyboard skip link, navigation, filters/reset/no-results, required category, invalid email/site, submit focus, disabled submitting state and mobile overflow work. Primary/secondary styles remain consistent.
- Submit only a clearly labeled owner-approved synthetic request, verify category and pending-review row, repeat to confirm one row/notification attempt, and observe the actual support inbox message. Test all categories within the existing abuse limits; exclude the synthetic data from experiment reporting. Do not publish or contact test businesses.
- Reject/grant/withdraw consent. Production events use G-SQYSWPFM5X and the exact three category labels; no personal form fields or request reference are sent. Verify received events and campaign links, then verify session denominators before reporting rates. A click is not a booking.
- Inspect pending/needs_review notification counts privately. Accepted status alone is not inbox receipt. Never reset an ambiguous accepted notification or change a provider idempotency key to force another send.

## Rollback preserving submitted requests

Prefer the smallest rollback. Restore the recorded **mobile-only bridge marketing deployment** (or redeploy the approved bridge tree) while retaining the additive schema and the category-aware API/outbox renderer. This removes new-category public discovery while leaving mobile intake compatible and every saved category request private and reviewable. Keep all new rows, old rows, hashes, notification versions and idempotency keys. Returning a saved request to an older database snapshot would lose submissions and is prohibited.

If the API also fails, temporarily close directory intake with a clear unavailable message and HTTP503, retain all D1 data, and preserve the current version-aware notification renderer during recovery. Do not blindly restore the pre031 API while format2 rows are pending: its old email body would differ under the same provider idempotency key. Do not invoke an old recovery endpoint against format2 rows. Rebuild the prior app revision with the reviewed directory compatibility modules, or correct the specific directory fault, then verify the exact runtime before reopening intake. Unrelated app rollback must not remove this compatibility layer.

A UI rollback does not retract already sent notifications, erase submitted requests or authorize campaigns. Reconcile each accepted/pending/needs_review row privately, observe the provider's23-hour idempotency window and five-attempt bound, and escalate ambiguous delivery rather than replaying it with a new key. Migration031 stays in place; no DROP, reverse migration, truncate, bulk repair or destructive restore.

## Review decisions and known limits

- Additional editorial workload is proposed at six total hours weekly (two/category), up from two. No new paid-ad budget. If the owner keeps a two-hour total cap, keep the new campaigns paused and preserve the live mobile workload.
- Both new Marblism text packets are saved unassigned with visibility disabled for every employee. The inspected UI did not expose dormant custom-agent creation. Named agent configurations, briefs, full guide drafts, two channel drafts each, graphic specifications, source registers, links and schedules are supplied. Native runtime-agent objects, native social post cards, final generated graphics and verified Instagram link routes are not configured. No agents were started; those capabilities must not be described as active or ready to publish.
- The connected Instagram route has not been proved category-specific. Do not replace mobile detailing's live route to launch another category. Hold Instagram publication until a separate supported story route or approved shared-link arrangement is reviewed.
- Resend marked the Dev notification bounced even though the exact support-group message arrived in the company inbox. Aggregate provider status is not a complete account of group distribution. The cause is unconfirmed; preserve inbox verification and inspect it before promising automated delivery coverage.
- Provider prices, current license status, insurance and availability are not independently established. The pages explicitly distinguish website claims and unknowns. Recheck sources if launch is delayed.
- Preview consent sync is browser-local because the isolated marketing previews have no account consent endpoint. QA uses its own GA stream; production retains its existing consent endpoint. Processed session reporting can lag and must not be reported as zero demand.
- Bugbot could not run because of account usage limits. Focused tests, source review, builds and deployed browser/D1 checks provide the recorded evidence; no successful automated review is claimed.
