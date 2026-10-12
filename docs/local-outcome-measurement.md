# Local outcome measurement

October 11, 2026. This measurement contract supersedes the older scorecard's provider-website-only event description. It does not change outreach limits, permissions, pricing, experiment clocks or historical campaign namespaces.

## Three outcomes

1. **Directory visits:** GA4 sessions containing a production directory category or provider page. Report observed consented visits, not unique named people or every visitor. A separate all-directory total is deduplicated; category totals can overlap and must not be added as unique visitors.
2. **Provider actions:** `directory_contact_click` broken down by public `listing_id`, `directory_category` and `contact_method`. Count clicks as events and sessions containing a click separately. A tap is not a completed call, sent email, quote, booking or sale.
3. **Businesses responding:** distinct businesses with substantive inbound responses in the business inbox, reconciled with the outreach ledger. Report corrections, interest, declines and opt-outs separately. Auto-replies and bounces are not substantive responses. Replies are operational evidence, never fabricated browser events. An AI-assisted response still counts as an actual business response when sender/context are verified; authorship cannot be inferred from prose.

## Versioned collection

`directory_tracking_version=2` marks category views, profile views, filter events and provider actions from the corrected directory runtime. Actual destination determines contact method:

| Value | Meaning |
| --- | --- |
| `provider_website` | HTTP(S) link to a provider, including its source or booking page |
| `phone` | `tel:` tap |
| `email` | `mailto:` tap |

Events lacking version 2 are legacy. Their `provider_website` label mixed phone and email taps and did not include every source link. Never relabel those events as website-only, or compare legacy versus version 2 counts as pure growth. Unknown methods remain unknown. No raw phone numbers, email addresses or destination queries are added to these custom events. Internal navigation receives no acquisition tags.

Existing `directory_category` dimension plus event-scoped `listing_id`, `contact_method` and `directory_tracking_version` support provider/action reporting. Dimension registration is not retrospective evidence and newly configured fields may need processing time. Do not present missing new fields as zero activity. Verify actual received version 2 events independently after release.

## Saved reporting views

Use the existing production Local exploration in GA4 property 523348532:
https://analytics.google.com/analytics/web/?authuser=1#/analysis/a366252518p523348532/edit/MRa7w10USY-iG8auzYJECg

- Rolling last 28 complete days, with the displayed dates visible.
- Acquisition: directory sessions and sessions containing a provider action by session source/medium and campaign. Label historical actions as mixed.
- Provider detail: version 2 profile-view/contact events by category, provider and method, showing event count. Do not use the number of event types as the number of people.
- Reply evidence is maintained separately from GA4, with its own time window and fresh mailbox reconciliation. Present it alongside the GA view in the operating receipt, not inside click totals.

Exclude identified QA sessions from customer views and retain the active property test exclusions. Explicit production staff validation uses the existing temporary marker and debug classification. Historical unmarked staff traffic cannot be reliably identified after the fact. Consent-denied visits are not measured by the custom browser events; the report is an observable sample, not a census.

## Honest limits

A source URL and check date indicate what was checked, not an endorsement or verification of workmanship, insurance, current licensing, availability or final prices. Keep unknown service facts visible as unknown and do not refresh dates merely by rebuilding.

Outbound tracking ends at our link click. Provider-side bookings need independent confirmation from the provider. AI crawler requests are a separate technical visibility metric; they do not prove an AI recommendation or a person visiting. AI referrals need an observed referring source. Do not combine bots, QA, visits, replies and payments into a single growth total.

## Release checks

Test all three contact protocols, consent denial/regrant, no private contact values in custom payloads, exclusion of internal/unsupported links, category/provider context, generated pages and Markdown freshness. Verify production serves the expected script hash and cache references. Save GA configuration and observed receipts separately; code passing tests alone is not proof GA received a new event.

## Provider value evidence and review trigger

A provider-specific evidence summary should show, for one clearly dated period:
- Observed profile-view events and distinct profile-view sessions/users where GA4 can return that grain.
- Distinct sessions with website handoffs, plus website click events. Separate source-reading links, primary website links and booking-page links using `contact_link`.
- Phone taps and email taps separately, not completed calls or messages.
- Source/medium/campaign and relevant service/area filtering where the actual events support them.
- Verified substantive business responses, and provider-confirmed referred sessions/leads/bookings only when supplied and reconciled. Missing provider evidence stays unknown.

Provisional commercial-review trigger: **25 distinct consented sessions with a version-2 website handoff to one provider within 28 days**. This is an operating hypothesis, not an industry benchmark or proof of ROI. At that point review traffic quality, sources, repeat behavior where measurable, provider feedback and collection limitations before proposing a paid pilot. Do not multiply click events into extra visitors or describe our count as incremental traffic; incremental lift needs a baseline/comparison. No automatic offer, price, billing or spending is created. Lower volume can justify learning from a provider, but not a proven-performance claim.

Outbound provider website/source/booking URLs carry public `utm_source=jobhackai_local`, `utm_medium=referral`, the existing September category namespace, and a provider/placement content tag. These describe directory-to-provider referrals, not the October provider-notification email wave. Existing provider query values and campaign tags are preserved. Provider analytics may strip tags, require consent, or lack collection; matching receipts remain unverified until observed or supplied.

The differentiation is an auditable referral evidence record: show exactly what people viewed and clicked, what was actually confirmed afterward, and which useful category/service information contributed. Do not promise irresistible value, complete surveillance or customer revenue from engagement alone.

Agent Markdown and Local full-text feeds use the original provider URLs, without our browser-handoff referral tags. This reduces attribution mixing from agent feeds; it cannot guarantee that every tagged request is human, since crawlers can also read HTML. Provider-side bot filtering and independent corroboration remain necessary.
