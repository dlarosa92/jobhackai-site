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

Eight event-scoped definitions were saved and read back on September 29 Eastern:
Content asset (`asset_id`), Voice access mode (`mode`), and first/last campaign
source, asset and name (`jha_first_source`, `jha_first_asset`,
`jha_first_campaign`, `jha_last_source`, `jha_last_asset`, `jha_last_campaign`).
Existing directory category and page path definitions remain intact. No unique
interview IDs were registered as report dimensions.

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

## Campaign tags and decisions

Use campaign `voice_beta_2026_09`, medium `organic_social`, platform `linkedin`
or `instagram`, and a unique content slug per linked placement. Native Instagram
caption URLs are not clickable: use a verified profile-link destination and
report it as bio traffic rather than pretend each feed post has direct-click
attribution. Multiple posts sharing one bio link cannot be reliably separated.

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
