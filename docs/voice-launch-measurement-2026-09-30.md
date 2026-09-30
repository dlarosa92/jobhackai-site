# Voice launch measurement

The commercial objective is 250 paying customers. This is the owner's target,
not a forecast or a claim about current customers. The opening campaign explains
the product, lets a visitor try one interview, and gives a clear reason to pay
for the full report and further practice.

## Website and editorial assets

- `/features`: Voice Mock Interview first; role, spoken answers, follow-ups,
  feedback; free preview versus full paid report. Asset `voice_features_01`.
- `/blog/how-to-answer-tell-me-about-yourself`: practical introduction exercise.
  Asset `tell_me_about_yourself_blog_01`; Marblism draft
  `62450f7e-2166-4d50-bf60-afa239330052`.
- `/blog/what-to-expect-from-a-voice-mock-interview`: product walkthrough,
  633 words including captions and CTA. Asset `voice_mock_interview_guide_01`;
  Marblism reference `fc2f1ca6-b1e0-4316-9395-508a7b6cc87e`. Codex edited out
  internal test notes and the obsolete trial CTA and separated follow-ups into
  their own step. Repository copy controls publication.
- Setup screenshot is a real production screen. Report screenshot is a real QA
  internal-test report, explicitly labelled; neither depicts a customer outcome.
- Internal links have no campaign UTMs. They must not overwrite acquisition.

## Funnel and evidence

| Stage | Event/filter | Interpretation |
|---|---|---|
| Tagged visit | `page_view`, landing path, session source/medium/campaign | Consented website visit, not a lead |
| Signup | `sign_up` | Actual account creation; returning OAuth logins excluded |
| First interview started | `voice_session_start`, `mode=free` | Free interview started, not completed |
| Free interview completed | `voice_session_complete`, `mode=free` | Report saved; may be unscored if the session is very short |
| Checkout | `begin_checkout` | Intent only, not revenue |
| Purchase | server `purchase` | Collected live payment, deduplicated by charge ID |
| Refund | server `refund` | Actual succeeded refund |
| Repeat practice | completed events with `mode=pack` or `subscription` | Practice use; do not equate event count with unique customers |

Browser events use the consent wrapper. Campaign cookies contain only validated
UTM slugs, not arbitrary queries. First and last external campaign source, name
and content are retained through the marketing-to-app handoff and attached to
consented events and eligible checkout payment records. The interview UUID uses
`interview_id`, preserving GA4's actual `session_id`. No answer, transcript,
job description, email or display name is added to these events.

Email signups retain their existing event. Google popup/redirect and LinkedIn
popup/same-window flows now use provider-confirmed account-creation evidence.
The LinkedIn redirect receipt is one-use, bound to the restored account, and
expires after 15 minutes. Fixture tests exercise new versus returning accounts,
receipt mismatch/expiry, consent restoration, and event deduplication. A new real
OAuth signup has not been created merely to generate a conversion.

## Production GA4 configuration

Verified native property `523348532` (`jobhackai-prod-510a4`), web stream
`13491084245`, measurement ID `G-SQYSWPFM5X`. Cross-domain configuration already
includes jobhackai.io and app.jobhackai.io and was preserved.

On September 30, exact-match unwanted-referral rules for `checkout.stripe.com`
and `billing.stripe.com` were saved and reopened in the production Google tag.
This prevents those payment-service returns from becoming new referral sources;
it does not recover missing historical campaign data. Both the shared site
consent script and the separate directory runtime use basic Consent Mode v2:
Google stays unloaded until analytics consent, and advertising storage, user
data and personalization remain denied. Withdrawal immediately sends a denial
to an already initialized tag. Diagnostic warnings require subsequent live
collection and reporting before they can be called cleared.

Eight event-scoped definitions were saved and read back on September 29 Eastern:
Content asset (`asset_id`), Voice access mode (`mode`), and first/last campaign
source, asset and name (`jha_first_source`, `jha_first_asset`,
`jha_first_campaign`, `jha_last_source`, `jha_last_asset`, `jha_last_campaign`).
Existing directory category and page path definitions remain intact. No unique
interview IDs were registered as report dimensions.

The saved exploration [JobHackAI Voice — visits to paying customers](https://analytics.google.com/analytics/web/?authuser=1#/analysis/a366252518p523348532/edit/piNHoQmLR-y8JBUC3a70rQ)
is shared read-only with users of the production property. Its first tab is a
closed, indirect four-step funnel: campaign page view, actual signup, completed
free interview (`mode=free`), and purchase. The first step requires
`jha_first_campaign=voice_beta_2026_09`. The source breakdown is First user source.
This describes the new-account/free-interview path, not every possible purchase.

The second tab, Campaign assets and conversions, groups first campaign source
and asset, with event-name columns and Active users, Event count and Transactions.
It filters the same first campaign and the seven path events above. Returning
customers who first arrived through another campaign, and purchases that bypass
the free-interview path, require separate acquisition/payment analysis. First
touch is not proof that one post caused a purchase. New definitions do not
backfill historical events; the initial exploration has no campaign data.

Production Realtime showed the new Features page title after release. This
confirms a page view arrived, not that a signup, free completion or purchase
conversion has been verified end to end. Release checks are not campaign demand.

The production payment-delivery Worker is enabled at version
`23c081b0-ec9e-49b0-838a-17397a04472b`, with production D1, the production GA4
stream, debug events off, a dedicated Measurement Protocol secret, and a five
minute cron. Settings and schedules were independently read back; a scheduled
run completed with outcome `ok`, zero exceptions, and zero qualifying rows.
The temporary local secret file was removed after verification. Deployment
configuration defaults off; preserving this live state requires explicit
`--var DELIVERY_ENABLED:true` when deploying `--env prod`.

The initial ledger contains zero collected payment rows and one checkout
attribution. No purchase was fabricated or charged for testing. HTTP acceptance
is recorded as `accepted_unverified`; it is not proof of a processed GA purchase.
The first legitimate payment must be reconciled between Stripe, D1 delivery,
and GA4 transaction ID/value before revenue attribution is called verified.
Consent rejection, blockers and cross-device journeys create gaps: Stripe/D1
are the source for actual collected revenue, GA4 for the attributable subset.

The September 30 follow-up found that the production Stripe destination still
subscribed to only six legacy event types. At 15:56 UTC, all six were preserved
and the six supported financial events (`charge.succeeded`, `charge.captured`,
`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`) plus
Checkout's async-payment success/failure events were saved and read back.
The destination now listens to 14 events. No charge, refund or historical replay
was generated by that configuration correction. The production Transactions
list's newest payment was September 5, outside the delivery verification window.

## Campaign tags and decisions

Every external promotional placement must use its actual platform in
`utm_source`, a consistent medium, a campaign, and a unique `utm_content` slug
for the linked placement. The current Voice campaign is `voice_beta_2026_09`;
organic social uses `organic_social`, and email uses `email`. Future campaigns
must use their own identifiers. Verify the saved destination and redirect before
publication; do not include personal data in tags or add acquisition UTMs to
internal navigation. Preserve existing measured slugs rather than changing
historical attribution labels merely for cosmetic consistency.

On September 30 this standing requirement was saved and reopened in Marblism's
shared Brain for all seven agents, and saved in the owner's Codex memory at the
owner's request. The four published launch links on LinkedIn, X, Threads and
Pinterest and all three scheduled LinkedIn links were checked with complete,
platform-specific tags. The two scheduled Instagram posts use the shared bio
link and cannot be attributed individually from that link alone.

X and Pinterest profile website fields now use the first-party short paths
`/go/voice-x` and `/go/voice-pinterest`. The saved values were reopened and their
public links followed to Features with all four expected campaign parameters.
These redirects address X's field-length limit and Pinterest's removal of query
parameters from its stored website field. LinkedIn, Threads and YouTube profile
destinations were also read back with full platform-specific tags. TikTok's
current web profile has no website field, and the connected Facebook page's
public identity/destination remains unverified; neither is marked complete.

Native Instagram caption URLs
are not clickable. The existing primary Instagram profile link was verified as
`https://jobhackai.io/?utm_source=ig&utm_medium=social&utm_content=link_in_bio`.
Its visible label is Start Your Free Trial. Instagram web restricts website-link
editing to its mobile app, so this working link and both Local links were kept.
Instagram is aggregate profile-link traffic (`ig / social`), not article-level
or per-post campaign attribution. This legacy URL lacks `utm_campaign`, so it
is excluded from the campaign-filtered exploration and from the custom campaign
cookie; use native source/medium reporting for this traffic. Do not imply full
purchase attribution from those aggregate visits.

Review visits, signups, completed free interviews, checkouts, first-time paid
customers, collected revenue net of refunds, and repeat use by platform/content.
Show counts and dates before interpreting rates. Separate renewals from new
paid customers; exclude staff acceptance samples from conversion conclusions.
The earlier seven-day GA overview (7 active users, 259 events, 81 views, 0 key
events) includes other site activity and is not a Voice campaign baseline.

Google Search Ads remains a contingency. Prepare a small intent-focused search
test only after the real purchase path is verified and a spend cap is explicitly
approved. Estimate allowable acquisition cost from collected revenue less
payment fees, voice/report costs and refunds; do not invent lifetime value or
use the 250-customer target as proof of demand. No ad account, campaign, billing
change, budget or spend has been activated by this release.
