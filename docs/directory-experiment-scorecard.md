# Directory experiment: three concurrent categories

Prepared September 23, 2026 for production review. Mobile detailing is live. Junk removal and home Level 2 EV installation remain in Dev/QA and their campaign materials are draft/paused. This update does not authorize production, publication, agent activation, outreach or spending.

## Scope, clocks and workload

| Category | Landing page | Campaign namespace | Verified clock |
| --- | --- | --- | --- |
| Mobile detailing | `/directory` | `directory_mobile_detailing_nky_2026_09` | Launch September 22, 2026 at 13:03:21 UTC; day28 October 20. Preserve weekly September29, October6 and October13 reviews. |
| Junk removal | `/directory/junk-removal` | `directory_junk_removal_nky_2026_09` | Unset until approved production launch is observed. |
| Home Level 2 EV installation | `/directory/ev-charger-installation` | `directory_ev_charger_installation_nky_2026_09` | Unset until approved production launch is observed. |

Mobile timing comes from the live Marblism controlling brief inspected September23. Do not restart its clock or silently replace its landing page, posts or links. Each new category has six sourced businesses, a comparison hub, six provider pages, one anchor guide draft and exactly one company LinkedIn and one Instagram adaptation. All initial placements are unpaid and editorial.

No incremental ad spend, paid tools or contact lists. The original mobile allocation was two editorial hours weekly. Proposed expanded allocation is six total hours weekly: two per category, including source checks, inbox review, claims, distribution and measurement; shared tasks are logged once and allocated explicitly. This adds up to four hours weekly and needs the owner's production-review decision before recurring work begins. If the owner retains the two-hour total cap, keep both new campaigns paused and prioritize the live mobile pilot; do not silently dilute its support. Log actual time by category and request a decision before exceeding the approved cap.

For each category, run four weeks from its verified launch, allow at most one substantive content adjustment, and record the date and rationale. No cold outreach, agent execution or public scheduling until the exact action is approved. No implied partners, endorsements or paying customers.

## Scorecard and decision rules

These are operational thresholds chosen to bound effort, not industry benchmarks,
statistical significance claims or forecasts. Report measurement coverage and
missing data alongside every result. Do not buy traffic just to meet a threshold.

| Measure | Definition | Day-28 interpretation |
| --- | --- | --- |
| Observable visitor sample | At least 100 production GA sessions containing a page in that category, with Analytics consent; exclude identified owner/QA tests and known automation. Show acquisition source and available geography separately; do not assume all visitors are local. | Below 100: insufficient observable traffic, not proof that the industry failed. Diagnose distribution and consent coverage. |
| Contact intent | Sessions with at least one `directory_contact_click` divided by the same category-session denominator; count each session once, irrespective of repeat/provider clicks. | With at least 100 sessions, 10% or more supports testing commercial interest. Below 10% calls for the single relevance/usability adjustment or a stop/pivot recommendation. |
| Business interest | Unique real businesses whose listing/paid-placement inquiry or response is received in the company inbox. Deduplicate by business privately. Email-composer clicks do not count. | Two independent interested businesses support preparing a small written offer. Zero is not a willingness-to-pay rejection if no offer was actually made. |
| Commercial validation | A business accepts a specific written placement offer and a corresponding invoice is actually collected. Separately show refunds, incremental cost and owner effort. | One paying business is an initial commercial signal, not proof of profitability or a scalable business. No paid offer tested means monetization remains untested. |

Do not report a rate when session deduplication, exclusions or the denominator
cannot be verified. Show raw events as such until the report is corrected.
Provider clicks are not leads, bookings or provider revenue. Confirmed bookings
require independent provider evidence and permission to share that evidence.

At day 28 prepare one recommendation: continue with a defined next test, adjust,
pivot category, or stop. If the sample is insufficient, recommend stopping or
one extension of at most 14 days only when a concrete distribution change is
ready within the same spending limit. The owner approves that exception; no
silent renewal. At day 42, close the initial experiment and request a new bounded
decision if further work is justified. Do not imply SEO should mature in four weeks.

## Category attribution and exclusions

Use event parameter `directory_category` values `mobile_detailing`, `junk_removal`, and `ev_charger_installation`, with `business_line=local_directory` and `directory_market=nky_cincinnati`. Existing mobile labels remain unchanged. `directory_category_view` identifies hubs; `directory_listing_view` identifies provider pages; `directory_filter_change` records published filter choices; `directory_contact_click` identifies provider website intent; `directory_request_saved` records only a newly saved consented request. No form fields, email, submission key or request reference belong in Analytics.

Create one session-scope category-page segment and one segment adding the exact provider-click event for each category. Use the same date range and exclusions for numerator and denominator. Mobile page membership is exact `/directory` (allow a trailing slash) or `/directory/mobile-detailing/`; other membership is the respective category path prefix. Do not include the generic intake page in a category denominator without an explicit category event. A session visiting multiple categories can appear in more than one category row. Do not sum those rows into a unique all-directory audience; calculate the deduplicated total separately.

Acquisition campaign and content IDs measure which approved asset brought the session. Category events measure what the visitor actually viewed. Preserve both when a visitor crosses categories; internal links have no UTMs. Exclude Dev/QA hosts, synthetic submissions, owner tests and known automation. Previews use QA stream G-VH888WWY3M; production uses G-SQYSWPFM5X. Show consent coverage, geographic uncertainty and Instagram shared-bio attribution limits. Unknown/processing-delayed data is unavailable, not zero.

Maintain private inquiry deduplication by business and category. Do not count a duplicate submission or support notification as a second business. Submitted requests never publish automatically. Evaluate the operational thresholds below per category; comparisons between categories are descriptive, not a controlled experiment.

## Reporting and responsibility

- Codex verifies production release/indexing, links, consent, event receipt,
  session-based reporting and received intake; maintains the evidence scorecard.
- Penny prepares the useful guide; Sonny adapts it for approved channels; Stan
  researches facts and prepares any later written offer; Eva coordinates records.
  These remain paused assignments for the new categories; saving a brief is not agent execution or acknowledgment.
- Use the three namespaces above and the exact asset links in `campaigns/directory-expansion-2026-09-23/manifest.json`. Keep directory data separate from `voice_beta_2026_09`.
- Review weekly after launch, bringing the owner only a meaningful finding or
  prepared decision. Day-28 review is mandatory even if traffic is weak.
- Deliver the action, evidence, recommendation and cost directly in the owner's
  task with Approve / Change / Stop. No dashboard hunting or calls are required.
- The existing hourly decision heartbeat is an interim route. Weekly/day-28
  dates must be added after the real launch date is known. This document does
  not itself schedule those reviews or establish customer-inbox automation.

## Launch acceptance still required

Directory mobile/keyboard/accessibility checks; verified Get listed inbox receipt;
accurate sourced listing facts; noindex removal plus approved navigation/sitemap;
production event/session report verification and QA exclusion; trust-first copy
review; exact reviewed publication assets and rollback. Public links and dates
must remain blank until the corresponding deployment/publication is observed.

## Weekly record template

Category / period / verified launch and review dates / deployed revision / approved changes / time spent / approved time cap / incremental spend:

Observed directory sessions / source mix / geography coverage / tracking limits:

Sessions with provider clicks / intent rate / real business inquiries received:

Offers actually sent / accepted offers / collected invoices / refunds / net:

Missing evidence / recommendation / exact owner decision (if any) / next review:
