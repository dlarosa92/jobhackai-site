# Collected payment evidence

This change replaces the webhook's estimated GA purchases with a durable financial record. It does **not** finish campaign attribution or send any data to Google Analytics. Keep production and public marketing held.

## What is counted

Fresh Stripe Charge `amount_captured`, in integer minor currency units, keyed by charge ID. A plan update, list price, authorization, zero-dollar trial, or invoice marked paid without a captured Stripe charge is not a new payment. Initial subscription payments and renewals resolve through the invoice payment's subscription; one-time packs resolve through Checkout. Explicit environment stamps isolate dev and QA despite their shared test-mode Stripe account.

Refund IDs are stored separately. Only `succeeded` refunds reduce the total. Pending, failed and canceled refunds do not. A failed refund after success restores that amount. Duplicated or out-of-order notifications cannot count the same charge/refund twice. Refund-before-purchase delivery reads and records the captured charge in the same transaction.

`stripe_collected_payment_totals` separates currencies and environments. `net_collected` means captured amounts less succeeded refunds, before payment fees, taxes and disputes. It is not profit, bank payouts, GA ecommerce revenue or campaign ROI. The timestamps distinguish Stripe charge creation from local recording; a delayed capture is not assigned a fabricated capture timestamp.

No email, card details, Firebase UID, browser identifier or campaign data is stored by this module. Financial records do not constitute Analytics consent. No synthetic `server.<uid>` client IDs or unconsented server events remain in the webhook. Existing browser funnel tracking is unchanged.

## Deployment and proof

1. Apply additive migration `024_collected_payments.sql` to the target D1 before enabling the events. Earlier code ignores these tables. Missing tables cause the new events to return 503 and stay retryable; existing entitlement processing does not use these tables.
2. Deploy through dev0 and develop. Verify the exact deployed revision.
3. Add these event types to the matching Stripe webhook: `charge.succeeded`, `charge.captured`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`. Preserve every existing event subscription. Check restricted-key read permissions for Charges, Refunds, Checkout Sessions, Invoice Payments, Invoices and Subscriptions without exposing credentials.
4. Complete sandbox pack and subscription payments, a renewal, and a partial refund. Compare charge/refund IDs, captured amounts, currencies and statuses with Stripe. Redeliver notifications and prove the totals do not change. Verify no financial row appears in the other environment. Do not treat local tests or an HTTP 200 as deployed evidence.
5. Inspect `stripe_event_ledger WHERE status='failed'` and its reason labels. Missing/contradictory stamps, unresolved context, multi-invoice allocations, more than 500 refunds, or Stripe failures require reconciliation. They are never acknowledged as complete financial evidence.

The API reads pin `2025-03-31.basil`, including `/v1/invoice_payments`. A charge may precede Checkout completion or invoice attachment; returning 503 lets Stripe retry after that context exists. Historical processed notifications are not automatically replayed/backfilled. Disputes, non-Stripe/manual payments and manually split invoice allocations are outside these totals and must remain explicit in reporting.

## Remaining release work

Consent-aware browser campaign capture and checkout linkage, a durable Analytics delivery queue with retry/withdrawal handling, live GA receipt and revenue reconciliation, and campaign reporting are still required. Missing consent or attribution must remain unattributed. Never infer a marketing source from a customer email or insert list-price purchases to fill gaps.

Run `npm run test:billing` in `app`. The collected-revenue suite exercises the signed webhook against actual SQLite transactions, including rollback after a staged payment, retry, missing migration, duplicates, discounts, renewals, partial/refused refunds, cross-environment isolation, currency separation and pre-Checkout races. It uses Python 3's SQLite stdlib and performs no network calls.

References: [Stripe Charge](https://docs.stripe.com/api/charges/object), [Refund](https://docs.stripe.com/api/refunds/object), [Invoice Payments](https://docs.stripe.com/api/invoice-payment/list), [Basil Checkout timing](https://docs.stripe.com/changelog/basil/2025-03-31/checkout-legacy-subscription-upgrade), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
