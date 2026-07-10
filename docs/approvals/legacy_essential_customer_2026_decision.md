# Active Legacy Essential Customer Decision

Date: July 10, 2026

Status: Approved implementation decision

Repository: `dlarosa92/jobhackai-site`

Required base and target branch: `dev0`

## Confirmed production fact

One active customer currently exists on the legacy Essential subscription.

Customer personally identifying information and Stripe identifiers must not be committed to the repository. The exact Stripe customer and subscription records must be verified in the authorized production billing system before launch.

## Decision

The active Essential customer will be grandfathered as a Founding Pro customer.

The customer will keep the existing recurring Stripe price and billing cadence. The customer will receive the approved Pro Monthly product benefits without a price increase.

Customer facing benefits after the voice pricing launch:

1. Thirty voice mock interviews per Stripe billing cycle.
2. Full scorecards.
3. Full transcripts.
4. Session history during the approved retention period.
5. Progress tracking.
6. All preparation tools.
7. Access through the paid period after cancellation.

The customer facing plan label should be `Founding Pro` where a plan name is shown.

The internal Stripe subscription and historical D1 plan value may remain `essential` for compatibility. Entitlement logic must explicitly map this verified legacy Essential subscription to the Pro Monthly allowance and report access.

## Why this decision is required

The preparation tools previously sold through Essential will become free for all accounts. Continuing to charge the customer only for benefits that are now free would be poor treatment of the first paying customer.

Providing Pro Monthly benefits at the existing price:

1. Honors the original subscription.
2. Avoids an involuntary price increase.
3. Rewards the earliest paying customer.
4. Costs the business very little because only one customer is affected.
5. Avoids unnecessary Stripe subscription migration risk.
6. Creates a potential founding customer testimonial and referral relationship.

## Cancellation and return policy

1. The grandfathered price remains available only while the existing subscription remains continuously active.
2. If the customer cancels, access remains through the current paid period.
3. After the subscription ends, the grandfathered price is lost.
4. A later resubscription uses the current public pricing.
5. Support may restore the grandfathered subscription only to correct a documented billing or technical error.

## Billing and entitlement requirements

1. Do not replace the customer’s current Stripe price automatically.
2. Do not create a second subscription.
3. Do not charge an additional fee for the upgrade.
4. Store and honor the existing Stripe billing period start and end.
5. Enforce thirty sessions per billing cycle, not unlimited sessions.
6. Preserve the customer’s existing reports under the normal retention policy.
7. Treat payment failure, cancellation, refunds, and disputes under the approved canonical rules.
8. Unknown or unverified Essential subscriptions must not automatically receive grandfathered access.
9. The implementation must verify that the subscription is active and tied to the expected legacy Essential Stripe price.

## Customer communication

Before or at public launch, send a transactional service message explaining:

1. JobHackAI is moving to voice first interview preparation.
2. The customer is being upgraded to Founding Pro at no additional cost.
3. The current recurring price remains unchanged while the subscription stays active.
4. The plan includes thirty voice interviews per billing cycle, full reports, transcripts, and progress tracking.
5. The customer may cancel anytime through billing management.
6. If the subscription is cancelled and later restarted, current public pricing will apply.

This is a service and billing communication, not a promotional marketing message.

## Implementation acceptance tests

1. The verified active Essential subscription receives Founding Pro display state.
2. The verified active Essential subscription receives thirty sessions per Stripe billing cycle.
3. The thirty first session is blocked.
4. The customer is not charged a new price.
5. The customer does not receive a duplicate subscription.
6. Cancellation preserves access through period end.
7. Ended Essential subscriptions do not retain Founding Pro access.
8. A new customer cannot purchase Essential.
9. An unknown Essential price identifier fails closed.
10. The public pricing page never displays Essential or Founding Pro as a purchasable plan.

## Human verification required before production

1. Confirm the subscription is a real production subscription and not a test record.
2. Confirm the current amount and billing cadence.
3. Confirm the Stripe price identifier.
4. Confirm the subscription status and next renewal date.
5. Confirm whether any discount or coupon is attached.
6. Confirm the customer has not requested cancellation.
7. Record the verification in the secure launch checklist, not the repository.
