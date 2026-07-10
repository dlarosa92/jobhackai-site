# JobHackAI Canonical Pricing Implementation Execution Brief

Date: July 10, 2026

Status: Approved for implementation

Repository: `dlarosa92/jobhackai-site`

Required base branch: `dev0`

Working branch: `feature/canonical-pricing-2026`

Target branch for pull request: `dev0`

Canonical commercial source: `docs/jobhackai_canonical_pricing_2026.md`

Approval record: `docs/approvals/canonical_pricing_2026_approval.md`

## Mission

Implement the approved JobHackAI voice pricing model across database schema, Stripe checkout and webhooks, entitlements, application user experience, marketing, analytics, email, legal copy, tests, and documentation.

The approved customer offers are:

1. Free Account at $0 with one lifetime voice interview and a partial report.
2. Interview Sprint at $19 one time with five voice interviews valid for seven days.
3. Pro Monthly at $39 per month with thirty voice interviews per Stripe billing cycle.

Retire the following offers for new customers:

1. Weekly Pass at $17 per week.
2. Monthly at $34 per month.
3. Interview Pack at $39 for five sessions valid for ninety days.
4. Essential at $29 per month.
5. Pro at $59 per month.
6. Premium at $99 per month.
7. The three day card required trial.

Do not use the word `unlimited` for voice interview access.

## Non negotiable branch rule

1. Confirm the working branch descends from the current approved `dev0` head.
2. Do not rebase onto, merge from, or recreate the branch from `develop` or `main`.
3. Do not target a pull request to `develop` or `main`.
4. If `dev0` advances during implementation, synchronize from `dev0` before final testing and document the synchronization commit.
5. Do not force push shared branches.

## Non negotiable deployment boundary

Do not:

1. Deploy production.
2. Apply the production D1 migration.
3. Change live Stripe products or prices.
4. Archive live Stripe prices.
5. Flip the production voice feature flag.
6. Publish revised legal terms to production.
7. Reprice or migrate active customers.
8. Issue real charges, cancellations, or refunds.

Code, migrations, tests, environment variable documentation, and deployment instructions may be prepared. Human controlled production actions remain outside this implementation run.

## Required implementation sequence

Deliver the work as atomic commits in this order. A single pull request is acceptable. A single giant commit is not.

### Commit 1: Audit and baseline record

1. Record the starting `dev0` commit and working branch commit.
2. Search the repository for all pricing, trial, plan, Stripe price, entitlement, usage limit, refund, cancellation, email, analytics, structured data, and retention references.
3. Create an impact inventory under `docs/implementation`.
4. Identify existing active plan compatibility paths and legacy behavior.
5. Do not change runtime behavior in this commit.

### Commit 2: D1 migration 021 and schema

Create `app/db/migrations/021_canonical_voice_pricing.sql`.

Add fields required for the approved model, including at minimum:

1. `current_period_start`
2. `payment_grace_until`
3. A canonical voice credit expiration field, or deliberately reuse and document `pack_expires_at`

Update `app/db/schema.sql`.

The migration must be additive and safe for DEV, QA, and PROD. Document exact Wrangler commands. Do not execute against PROD.

### Commit 3: Canonical plan and Stripe price mapping

Update shared billing utilities and plan mappings.

Required active plan identifiers:

1. `free`
2. `sprint`
3. `monthly`

Required environment variables:

1. `STRIPE_PRICE_SPRINT`
2. `STRIPE_PRICE_PRO_MONTHLY`

Requirements:

1. Stop offering `weekly` and `pack` to new customers.
2. Preserve explicit legacy mappings for historical webhook and customer compatibility.
3. Unknown Stripe price identifiers must fail closed.
4. Remove any fallback that silently maps an unknown paid price to Essential or another paid plan.
5. Update plan rank and display utilities.
6. Document temporary aliases if they are required for staged rollout.

### Commit 4: Stripe checkout and webhook lifecycle

Implement:

1. Sprint checkout in Stripe payment mode.
2. Pro Monthly checkout in Stripe subscription mode.
3. Sprint purchase grants five credits.
4. Sprint expiration is seven days from confirmed payment.
5. Pro Monthly stores `current_period_start` and `current_period_end` from Stripe.
6. Successful renewal updates both period fields.
7. Failed recurring payment starts a seventy two hour recovery period.
8. Successful recovery clears payment grace state.
9. Cancellation preserves access until the paid period ends.
10. Refund, dispute, and immediate cancellation behavior is explicit and tested.
11. Webhook replay cannot grant duplicate credits or duplicate entitlement.
12. Billing and plan caches are invalidated after state changes.
13. Existing customer and duplicate subscription guards remain intact.

Do not grant Sprint credits from browser state or checkout success redirects. Grant only from verified Stripe webhook events.

### Commit 5: Voice entitlements and usage accounting

Implement server side rules:

1. One lifetime free voice interview.
2. Sprint grants five usable credits before expiration.
3. A sixth Sprint session is blocked.
4. Pro Monthly grants thirty sessions per Stripe billing cycle.
5. A thirty first session is blocked.
6. Monthly usage is counted from `current_period_start`, not the calendar month.
7. Unused monthly sessions do not roll over.
8. Reconnection to an active session does not consume again.
9. Provider or JobHackAI setup failure restores the consumed entitlement.
10. Concurrent starts cannot double spend an entitlement.
11. Expired or unpaid access cannot start a paid session.
12. The payment recovery period is bounded by `payment_grace_until`.
13. Existing paid reports remain accessible through retention after cancellation or failed payment.

Update `/api/plan/me` to return:

1. Canonical plan name.
2. Voice enabled state.
3. Can start state.
4. Entitlement mode.
5. Session limit.
6. Sessions used.
7. Sessions remaining.
8. Sprint expiration when applicable.
9. Billing reset date when applicable.
10. Payment action required state.
11. Full report access state.

### Commit 6: Retention consistency

Make runtime behavior match the approved privacy promise.

1. Delete voice transcripts after ninety days.
2. Delete voice scorecards after ninety days.
3. Remove visible voice history after ninety days.
4. Preserve only records allowed for billing, fraud, security, tax, or minimal one time free session abuse prevention.
5. Remove the permanent expired session upgrade prompt after ninety days.
6. Keep user initiated delete and clear history controls.
7. Align the retention cleaner, list endpoint, session endpoint, Terms, Privacy Policy, and Retention Notice.

### Commit 7: Customer application surfaces

Update:

1. `pricing.html`
2. Voice interview page and client logic
3. Dashboard
4. Navigation
5. Plan cache
6. Account settings
7. Billing management
8. Free report paywall
9. Plan badges
10. Mobile navigation signup label

Customer experience requirements:

1. Free shows one lifetime session.
2. Sprint shows five credits and expiration date.
3. Monthly shows thirty session allowance, used count, remaining count, and reset date.
4. Free report shows only top strength and top improvement from the server limited response.
5. Sprint and Monthly show complete reports and transcripts.
6. Progress tracking is included in Pro Monthly.
7. Exhausted or expired access shows the correct purchase path.
8. Payment failure shows a payment update path rather than a generic upgrade prompt.
9. No customer facing surface says unlimited.
10. No new customer surface displays retired pricing.

### Commit 8: Marketing, SEO, GEO, and generated role pages

Update:

1. Marketing homepage
2. Features page
3. Pricing links and calls to action
4. Blog calls to action
5. Programmatic role page template
6. Generated role pages
7. Structured data offers
8. FAQ structured data
9. Metadata
10. `llms.txt`
11. `llms-full.txt`
12. Sitemaps
13. Robots behavior only when needed

Regenerate role pages with the existing generator and prove the generator is idempotent.

Canonical public message:

`Walk into your interview having already done it.`

### Commit 9: Legal, privacy, support, and email

Update:

1. Terms of Service
2. Privacy Policy
3. Retention and Deletion Notice
4. Refund language
5. Help page
6. Purchase confirmations
7. Failed payment messages
8. Cancellation messages
9. Free session follow up email
10. Voice follow up worker
11. Account and billing labels

Required commercial rules:

1. Sprint is one time and does not renew.
2. Sprint refund eligibility is limited to requests within seven days when no Sprint session was used, except as required by law or confirmed billing and product failures.
3. First Monthly charge refund eligibility is limited to requests within seventy two hours when no paid voice session was used, except as required by law or confirmed billing error.
4. Renewal charges are generally nonrefundable.
5. Cancellation stops future renewal and preserves access through the paid period.
6. Technical failures should restore sessions when reliably detectable.
7. History content is deleted after ninety days.

Mark legal changes for qualified human review. Do not claim legal approval.

### Commit 10: Analytics and commercial measurement

Canonical plan event values:

1. `sprint`
2. `monthly`

Canonical purchase values:

1. Sprint: 19 USD
2. Monthly: 39 USD

Instrument or verify:

1. Signup
2. Free voice session start
3. Free voice session completion
4. Partial report view
5. Pricing view
6. Checkout start
7. Purchase
8. Session completion
9. Allowance exhaustion
10. Sprint expiration
11. Payment failure
12. Payment recovery
13. Cancellation
14. Refund when observable

Preserve consent gating and cross domain attribution.

### Commit 11: Tests, sweeps, and launch runbook

Required automated tests:

1. Exactly one free session.
2. Second free session blocked.
3. Sprint grants five credits.
4. Sixth Sprint session blocked.
5. Sprint expires after seven days.
6. Sprint repurchase behavior.
7. Failed session setup restores credit.
8. Reconnection does not consume again.
9. Monthly grants thirty sessions per billing cycle.
10. Thirty first monthly session blocked.
11. Renewal resets allowance using Stripe period boundaries.
12. Cancellation preserves access through period end.
13. Payment recovery expires after seventy two hours.
14. Webhook replay cannot double grant.
15. Unknown price fails closed.
16. Free report remains partial server side.
17. Paid reports remain full.
18. Ninety day content deletion.
19. User ownership on reads, deletes, and clears.
20. Feature flag off behavior.
21. Pricing checkout paths.
22. Mobile critical flows.
23. Legacy mapping behavior.

Repository sweep for:

1. `Unlimited voice`
2. `Weekly Pass`
3. `Interview Pack`
4. `$17`
5. `$34`
6. `3-day trial`
7. `3 day trial`
8. `three day trial`
9. `Essential`
10. `Premium`
11. Old Stripe price variable names

Every surviving result must be classified as one of:

1. Intentional historical documentation
2. Legacy compatibility code
3. Test fixture
4. Defect requiring removal

Create a launch runbook containing:

1. DEV migration commands
2. QA migration commands
3. PROD migration commands, clearly marked human only
4. Cloudflare variable list
5. Stripe test setup
6. Stripe live setup, clearly marked human only
7. End to end purchase test
8. Cancellation test
9. Refund test
10. Unit economics test procedure
11. Rollback procedure
12. Seventy two hour production monitoring checklist

## Validation requirements

Run all existing relevant tests plus new tests.

At minimum:

1. Node syntax checks on changed JavaScript files.
2. Voice entitlement tests.
3. Voice history tests.
4. Stripe webhook tests.
5. Billing end to end tests.
6. Authentication tests.
7. Plan access tests.
8. Role page build twice to prove idempotency.
9. Repository copy sweep.
10. Local or preview browser validation of pricing, dashboard, voice, account, and mobile states.

Do not report success when tests were skipped. List every command, result, and known limitation in the pull request.

## Unit economics preparation

Preserve and verify per session cost instrumentation.

Prepare a repeatable twenty session measurement procedure covering five, ten, fifteen, and twenty minute interviews.

The implementation does not need to fabricate cost results. It must make actual costs measurable.

Launch targets from the canonical document:

1. Average completed session cost at or below $0.75.
2. Ninety fifth percentile completed session cost at or below $1.25.
3. Voice connection success at or above 97 percent.
4. Scorecard success at or above 97 percent.
5. Entitlement accuracy at 100 percent in the validation set.
6. Zero duplicate charge or duplicate credit defects.

## Pull request requirements

Open one pull request from `feature/canonical-pricing-2026` to `dev0`.

The pull request body must include:

1. Executive summary
2. Starting `dev0` commit
3. Atomic commit list
4. Data migration details
5. Stripe changes
6. Entitlement state diagram
7. Legacy compatibility behavior
8. Customer visible changes
9. Legal files requiring human review
10. Environment variables required
11. Test commands and results
12. Screenshots or preview evidence
13. Known risks
14. Manual DEV actions
15. Manual QA actions
16. Manual PROD actions
17. Rollback plan

Do not merge the pull request automatically.

## Stop conditions

Stop and request owner review when any of the following is true:

1. Active legacy customer behavior cannot be preserved safely.
2. The existing schema cannot support an additive migration.
3. A change would require deleting production customer or billing data.
4. Stripe behavior is ambiguous and could double bill.
5. The free report cannot be restricted server side.
6. Retention requirements conflict with another approved policy.
7. Tests reveal pre existing defects that materially affect checkout or entitlements.
8. A requested change would require production credentials or direct production action.

## Completion definition

Implementation is complete when:

1. All approved behavior exists on the working branch.
2. All tests pass or every failure is explicitly documented and accepted.
3. The repository sweep is classified.
4. No production action has occurred.
5. The pull request targets `dev0`.
6. Human action checklists are complete.
7. The owner can review one coherent pull request and decide whether to merge into `dev0`.
