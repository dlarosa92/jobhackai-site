# Voice beta Help and billing-copy review

These edits are prepared for development/QA. Production release remains held.

## Corrected offer

Help and the billing portions of Terms now describe one lifetime free voice interview with a feedback preview and no automatic conversion; $17 weekly and $34 monthly subscriptions; and a $39 one-time five-session pack valid for 90 days. Subscription voice access has a 60-session UTC-calendar-month allowance, not a billing-cycle reset. Free preparation tools are no longer described as paid legacy-plan features.

The Help page uses the actual Account Settings label, **Billing Management**, for cancellation and payment updates. Its legacy-subscription answer directs existing customers to their existing billing agreement. The Terms changes do not migrate those subscriptions, change their prices, change the existing refund policy, or alter the unrelated dispute provisions.

An internal implementation recommendation about proving clickwrap acceptance was removed from customer-facing Terms. This is a copy correction, not proof that acceptance records, notices or every legal requirement have been verified.

## Sources checked

- Product authority: accepted beta offer, `pricing.html`, `app/functions/_lib/voice-entitlements.js`, `app/functions/_lib/plan-access.js`, and the Account Settings billing button.
- [Stripe cancellation documentation](https://docs.stripe.com/billing/subscriptions/cancel): portal cancellation and end-of-period cancellation are distinct from refunds. Sandbox cancellation behavior was previously observed in the release evidence.
- [California BPC section 17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602.): the existing state disclosure was checked against the official text when correcting renewal frequency, price and cancellation wording. This edit is not a legal compliance certification.

## Verification and release work

- Local Chrome renders the new Help content, and searching for `60` finds the updated session-limit answers.
- Static checks find no obsolete $29/$59/$99 or three-day conversion offer in these two pages; accepted amounts/limits are present, IDs are unique, and internal anchors resolve.
- Before production publication, set the actual Terms effective/update date and verify the appropriate customer notice and acceptance behavior as part of the final release review. Existing dates are retained while this is an unpublished draft; no future date has been invented.
- Other Help/Privacy claims, including retention, processing location and deletion behavior, need their own runtime evidence. This narrowly scoped offer correction does not verify them.
