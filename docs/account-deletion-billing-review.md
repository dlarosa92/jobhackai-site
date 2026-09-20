# Account deletion billing guard

The previous self-service handler deleted Firebase authentication before attempting subscription cancellation. A Stripe outage could leave a subscription running after the customer lost access to cancel it.

The handler now completes a strict billing scan and confirms cancellation before removing authentication. It reads both D1 and KV customer mappings, searches stored and token emails, follows customer/subscription pagination, and checks all owned duplicate customers. Email alone cannot authorize cancellation. Conflicting customer/subscription metadata or D1 ownership, unavailable dependencies, unknown subscription states, and incomplete pagination stop deletion with sign-in access intact. All candidate ownership checks finish before cancellation begins. Every nonterminal subscription is canceled, including paused and incomplete subscriptions; existing invoice obligations and past payments are not refunded.

Cancellation is not transactional across Stripe subscriptions. If one succeeds and another fails, the response explicitly says some subscriptions may have been canceled and allows retry. Firebase failure likewise reports completed cancellation accurately. The confirmation email runs after KV/tombstone attempts and discloses cleanup failures instead of promising universal data removal.

Validation: 20 focused tests exercise paging, duplicate customers, cross-account conflicts, service failures, partial cancellation/retry, handler ordering, and cleanup email outcomes. No live customer deletion or Stripe mutation was performed for this change.

## Remaining release gates

This is a bounded billing-order fix, not a complete durable erasure workflow. Cleanup after Firebase removal still uses best-effort steps without an authenticated retry or persistent recovery job. A coordinated deletion lock is also needed to prevent concurrent checkout/webhook activity during deletion, including pending Checkout Sessions. The inactive-account cleanup worker has its own deletion flow and has not been made equivalent by this patch. Legacy customers without a verifiable UID require support review rather than destructive guessing. Old customers under an unrelated former email with neither stored mapping nor current email are not globally discoverable by this scan. Production deployment and real account-deletion validation remain held.
