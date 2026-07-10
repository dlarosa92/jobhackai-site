# JobHackAI Canonical Pricing and Commercial Rules

Version: 1.0

Date: July 10, 2026

Status: Proposed canonical decision for owner approval

Authority: Once approved by the owner, this document replaces every earlier JobHackAI pricing matrix, trial policy, package definition, entitlement assumption, and customer facing pricing statement.

## 1. Purpose

This document defines the launch pricing model, customer promises, billing rules, entitlement behavior, financial targets, migration approach, validation gates, and rollout sequence for the voice first version of JobHackAI.

The technical starting point is the current `dev0` branch. The commercial starting point is the voice mock interview product already implemented there.

This document is intentionally broader than a pricing page specification. Pricing, Stripe, entitlement logic, legal language, email, analytics, marketing automation, and product access must all tell the same story.

## 2. Executive decision

JobHackAI will launch with three customer choices.

| Choice | Customer price | Billing type | Voice access | Best for |
|---|---:|---|---|---|
| Free Account | $0 | No card | One lifetime voice interview | Trying the product |
| Interview Sprint | $19 | One time | Five voice interviews within seven days | An interview happening soon |
| Pro Monthly | $39 per month | Recurring monthly | Thirty voice interviews per Stripe billing cycle | An active job search |

The following offers will not be sold after this model launches.

1. Weekly Pass at $17 per week
2. Monthly at $34 per month
3. Interview Pack at $39 for five sessions over ninety days
4. Essential at $29 per month
5. Pro at $59 per month
6. Premium at $99 per month
7. The three day card required trial

The word `unlimited` will not be used for voice interviews. The customer will see the real allowance.

No annual plan will launch with version 1.0. An annual commitment conflicts with the naturally temporary job search use case and should be considered only after real retention data exists.

## 3. Product position

JobHackAI is a realistic AI voice interview practice platform.

The primary paid outcome is not a better document. It is a candidate who has already practiced the interview out loud, received evidence based feedback, corrected weak answers, and entered the real interview with less uncertainty.

The free preparation tools support acquisition and preparation. They are not the primary paid value proposition.

Approved positioning statement:

> Walk into your interview having already done it.

Approved product description:

> JobHackAI runs a realistic voice mock interview for your target role. You speak naturally, the interviewer asks relevant follow up questions, and you receive a scored report showing what worked and what to improve.

## 4. Business objective

The owner objective is to replace approximately $14,000 of monthly employment income with durable JobHackAI income.

Revenue is not the same as owner income. The business must pay payment processing, AI usage, hosting, email, marketing, refunds, taxes, professional services, and operating reserves before owner distributions.

The primary commercial target is therefore:

| Metric | Target |
|---|---:|
| Active Pro Monthly subscribers | 500 |
| Pro Monthly recurring revenue | $19,500 per month |
| Sprint revenue | Additional operating buffer |
| Target operating profit before owner taxes | At least $14,000 per month |

A base of 359 Pro Monthly subscribers produces approximately $14,000 of gross revenue. It does not produce $14,000 of owner income. The operating target must remain higher.

The planning target of 500 active monthly subscribers creates room for Stripe fees, AI costs, support, refunds, acquisition experiments, and weak months.

## 5. Market rationale

The $39 monthly price is intentionally positioned in the middle of the interview preparation market.

Big Interview publicly lists a monthly interview preparation plan at $39. Lower cost communication tools exist, but they generally compete on broad speaking practice or annual billing rather than a live role specific interview, natural follow up questions, a transcript, a scored report, and progress tracking.

JobHackAI should not attempt to win by being the cheapest product. It should win on realism, useful feedback, speed, privacy, and simple access.

The $19 Interview Sprint reduces commitment for a candidate who has one urgent interview. It also prevents the recurring weekly billing confusion created by the prior Weekly Pass.

The $39 Pro Monthly plan anchors recurring revenue and is the recommended plan for an active search.

These prices are launch hypotheses. They must remain unchanged for the first sixty days after public launch unless measured unit economics show an unacceptable loss.

## 6. Canonical offer definitions

### 6.1 Free Account

Price: $0

Billing: No card and no automatic conversion

Included preparation tools:

1. ATS resume scoring
2. Resume feedback
3. Resume rewriting
4. Cover letter generation
5. Interview question generation
6. Typed mock interviews

Voice entitlement:

1. One full voice mock interview for the lifetime of the account
2. Up to twenty minutes
3. Role and seniority targeting
4. Optional job description targeting
5. Natural follow up questions

Report entitlement after the free session:

1. Top strength
2. Top improvement
3. No overall score
4. No detailed scoring dimensions
5. No transcript
6. No detailed moment analysis
7. No progress tracking

The complete report may be displayed as a clearly locked preview, but restricted content must also be withheld by the server.

The free session is not a trial. It does not require a card, does not expire before use, and does not automatically convert into a paid purchase.

The one lifetime free session rule may be protected through a minimal anti abuse record after account deletion, consistent with the Privacy Policy and applicable law.

### 6.2 Interview Sprint

Customer name: Interview Sprint

Price: $19 one time

Billing: One time Stripe payment with no automatic renewal

Voice entitlement:

1. Five complete voice interviews
2. Seven days to use them
3. The seven day period begins when Stripe confirms successful payment
4. Credits do not roll over
5. Unused credits expire at the end of the seven day period
6. A customer may purchase another Sprint after the current Sprint expires or all credits are used

Included report access:

1. Full overall score
2. Communication score
3. S plus A equals O structure score
4. Content depth score
5. Role fit score
6. Full transcript
7. Specific moment feedback
8. S plus A equals O balance and coaching
9. Session history during the applicable retention period

Sprint does not include automatic renewal. The checkout page, receipt, pricing page, and account page must state this plainly.

### 6.3 Pro Monthly

Customer name: Pro Monthly

Price: $39 per month

Billing: Recurring monthly subscription through Stripe

Voice entitlement:

1. Thirty complete voice interviews per Stripe billing cycle
2. Usage resets at the start of the customer’s next Stripe billing cycle
3. Unused sessions do not roll over
4. The allowance follows the Stripe billing period, not the calendar month
5. The account interface displays sessions used, sessions remaining, and the next reset date

Included report access:

1. Every report feature included in Interview Sprint
2. Progress tracking across sessions
3. Full session history during the applicable retention period
4. Access until the paid billing period ends after cancellation

Pro Monthly is the recommended choice on the pricing page.

## 7. Feature matrix

| Capability | Free Account | Interview Sprint | Pro Monthly |
|---|---|---|---|
| Preparation tools | Included | Included | Included |
| Voice interviews | One lifetime | Five within seven days | Thirty per billing cycle |
| Full scorecard | No | Yes | Yes |
| Transcript | No | Yes | Yes |
| Detailed moments | No | Yes | Yes |
| S plus A equals O analysis | Limited preview only | Full | Full |
| Session history | Free session metadata while retained | Included | Included |
| Progress tracking | No | No | Yes |
| Card required | No | Yes | Yes |
| Automatic renewal | No | No | Yes |

## 8. Session consumption rules

A voice entitlement is valuable and must be consumed predictably.

### 8.1 When a session counts

A session counts when the server creates the session record and successfully returns a usable OpenAI Realtime client credential.

A customer ending an interview early still consumes the session because provider resources were used and the session was available.

### 8.2 Reconnection

Reconnecting to the same active session does not consume another credit or another monthly session.

The current resume behavior should remain: a reconnect attaches to the existing session within the permitted window.

### 8.3 Infrastructure failure

If JobHackAI or the voice provider fails before a usable session begins, the credit or free entitlement must be restored automatically and any orphaned session record removed.

If a completed interview permanently fails to produce its paid report, JobHackAI must either:

1. Restore one session credit automatically, or
2. Grant one replacement session through support

The preferred behavior is automatic restoration when the failure can be detected reliably.

### 8.4 Concurrent starts

The server must prevent two simultaneous starts from spending the same free session or Sprint credit.

The database operation remains the authoritative guard. A KV lock may reduce duplicate work but may not be the only protection.

### 8.5 Monthly allowance enforcement

The thirty session allowance must be enforced server side.

The count begins at `current_period_start` and ends at `current_period_end` from Stripe.

The current calendar month counter must be replaced before launch.

## 9. Billing lifecycle

### 9.1 Source of truth

Stripe webhooks are the source of truth for payment and subscription state.

D1 is the application source of truth for entitlement decisions after webhook processing.

The browser may read entitlement state but may never create or modify it.

### 9.2 Successful Sprint purchase

A successful Interview Sprint checkout must:

1. Record the Stripe customer and payment reference
2. Grant five voice credits
3. Set the expiration to seven days from successful payment
4. Mark the account as having paid
5. Invalidate stale billing and plan caches
6. Emit the purchase analytics event exactly once
7. Send a purchase confirmation

Webhook replay may not grant additional credits.

### 9.3 Successful Pro Monthly purchase

A successful Pro Monthly checkout must:

1. Set plan to `monthly`
2. Store Stripe subscription status
3. Store `current_period_start`
4. Store `current_period_end`
5. Clear any payment grace state
6. Mark the account as having paid
7. Invalidate stale billing and plan caches
8. Emit the purchase analytics event exactly once
9. Send a purchase confirmation

### 9.4 Cancellation

Cancellation takes effect at the end of the paid billing period unless Stripe or support performs an immediate cancellation for fraud, refund, or legal reasons.

The customer keeps access until `current_period_end`.

Cancellation must not delete prior reports. Reports follow the normal ninety day retention rule.

### 9.5 Failed payment

A failed recurring payment creates a seventy two hour recovery period beginning with the first failed invoice event.

During the recovery period:

1. Existing reports remain available
2. New voice sessions remain available only if the prior paid period has not ended or the recovery policy explicitly permits them
3. The customer sees a clear payment update message
4. Stripe recovery emails and the billing portal remain available

After the recovery period:

1. New paid voice sessions are blocked
2. Prior reports remain available through normal retention
3. The account is not deleted
4. The customer is directed to update payment details

The current rule that treats every `past_due` subscription as fully active without a time boundary must be replaced.

### 9.6 Subscription renewal

A successful renewal updates the billing period start and end. The new thirty session allowance begins with the new Stripe period.

Usage must not reset on the first day of the calendar month unless that date is also the customer’s Stripe renewal date.

## 10. Refund and credit policy

The policy must be customer friendly without inviting obvious abuse.

### 10.1 Interview Sprint

A full refund may be approved when:

1. The request is made within seven days of purchase, and
2. No Sprint voice session has been used

After a Sprint session is used, the purchase is generally nonrefundable except for duplicate charges, applicable law, or a confirmed product failure that JobHackAI could not remedy.

### 10.2 Pro Monthly

The first Pro Monthly charge may be refunded when:

1. The request is made within seventy two hours of the first charge, and
2. No paid voice session has been used

Renewal charges are generally nonrefundable except for duplicate charges, applicable law, or a confirmed billing error.

Customers may cancel at any time to stop future renewal.

### 10.3 Technical failure credits

A session lost because of a confirmed JobHackAI or provider failure should be restored rather than forcing the customer through a refund process.

Support actions that grant credits must be logged.

## 11. Data retention and privacy

Voice transcripts, scorecards, and visible session history are sensitive career data.

The canonical rule is:

1. Voice transcripts are deleted after ninety days
2. Voice scorecards are deleted after ninety days
3. Visible voice session history is deleted after ninety days
4. Customers may delete individual sessions or clear history sooner
5. Cancelling a subscription does not accelerate deletion
6. Inactive account cleanup remains twenty four months
7. Billing, tax, fraud, security, and legal records may be retained longer when necessary
8. A minimal one time free session anti abuse record may be retained after content deletion

No expired session should remain visible to the customer after ninety days merely as a permanent upgrade prompt. That behavior conflicts with the plain language promise that tool history is automatically deleted after ninety days.

The retention cleaner, list endpoints, Privacy Policy, Retention Notice, and Terms must implement and describe the same rule.

## 12. Legacy customer policy

Old offers must stop accepting new purchases when the new model launches.

Before migration, a human must determine how many active production customers exist on Essential, Pro, Premium, Trial, Weekly, Monthly at $34, or the old Interview Pack.

If there are no active legacy customers:

1. Archive the old Stripe prices
2. Remove the old checkout choices
3. Retain old price identifiers only as webhook history references

If active legacy customers exist:

1. Do not change their price without explicit notice and consent
2. Preserve the access already promised to them
3. Do not force an automatic migration during the launch deployment
4. Create a documented mapping for each legacy plan
5. Allow voluntary migration through support or the billing portal
6. Remove legacy plans from new customer checkout

Unknown Stripe price identifiers must fail closed. They must not silently map to Essential or another paid plan.

## 13. Promotions and discounts

JobHackAI will not launch with a permanent public discount.

Approved promotion limits:

1. Up to twenty percent off the first Pro Monthly charge
2. Up to twenty percent off Interview Sprint
3. One promotion per purchase
4. No stacking
5. No lifetime discount without owner approval
6. No promotion that lowers expected contribution margin below the launch threshold

Career coach or partner referrals may receive tracked codes, but revenue share and customer discounts require a separate written partner policy.

## 14. Unit economics requirements

Pricing cannot be considered proven until real session cost is measured.

The current application logs per session voice cost. That instrumentation must be validated and used.

Before production launch, run at least twenty realistic interviews across:

1. Five minute sessions
2. Ten minute sessions
3. Fifteen minute sessions
4. Full twenty minute sessions
5. Mobile and desktop browsers
6. Different speaking speeds
7. Different role and job description lengths

Measure:

1. Realtime input cost
2. Realtime output cost
3. Transcription cost
4. Scorecard generation cost
5. Total cost per completed session
6. Failed session cost
7. Connection success rate
8. Scorecard success rate
9. Average questions per interview
10. Average candidate speaking time

Launch gates:

| Measure | Required result |
|---|---:|
| Average completed session cost | $0.75 or less |
| Ninety fifth percentile completed session cost | $1.25 or less |
| Voice connection success | At least 97 percent |
| Scorecard success | At least 97 percent |
| Entitlement accuracy | 100 percent in the test set |
| Duplicate credit or duplicate charge defects | Zero |

If the economics fail, use this correction order:

1. Optimize or change the voice model
2. Reduce unnecessary interviewer speaking time
3. Reduce scorecard cost
4. Reduce the Pro Monthly allowance from thirty to twenty
5. Shorten the maximum session only if user research supports it
6. Raise price only after conversion evidence exists

Do not lower the $39 price to compensate for inefficient model usage.

## 15. Financial model

### 15.1 Core recurring target

| Pro Monthly subscribers | Gross recurring revenue |
|---:|---:|
| 359 | $14,001 |
| 400 | $15,600 |
| 450 | $17,550 |
| 500 | $19,500 |
| 600 | $23,400 |

The official salary replacement planning target is 500 active Pro Monthly subscribers.

### 15.2 Example blended month

Planning example only:

1. Four hundred Pro Monthly subscribers
2. Two hundred Interview Sprint purchases
3. Average eight monthly voice sessions per Pro customer
4. All five Sprint sessions used
5. Average session cost of $0.65
6. Fixed operating expense of $1,500
7. Stripe planning assumption of 2.9 percent plus $0.30 per successful charge

Estimated result:

| Item | Estimate |
|---|---:|
| Pro Monthly revenue | $15,600 |
| Interview Sprint revenue | $3,800 |
| Total gross revenue | $19,400 |
| Estimated Stripe fees | About $742 |
| Estimated voice session cost | About $2,730 |
| Fixed operating expense | $1,500 |
| Estimated operating profit before owner taxes | About $14,428 |

This is a planning model, not observed performance. Actual cost and usage data must replace every assumption after beta.

Sprint revenue is treated as a buffer. The business should not depend on acquiring the same one time buyers every month to meet the core recurring target.

## 16. Funnel and growth targets

The primary funnel is:

1. Visitor
2. Free account
3. Free preparation tool use
4. Free voice interview start
5. Free voice interview completion
6. Partial report view
7. Paid checkout start
8. Sprint or Pro Monthly purchase
9. Repeated practice
10. Referral or testimonial

Initial targets:

| Metric | Early acceptable | Strong |
|---|---:|---:|
| Visitor to free account | 5 percent | 8 percent or more |
| Free account to free voice start | 25 percent | 40 percent or more |
| Voice start to completion | 75 percent | 90 percent or more |
| Free completion to paid purchase | 3 percent | 8 percent or more |
| Paid refund rate | Under 5 percent | Under 2 percent |
| Pro Monthly first month cancellation | Under 35 percent | Under 20 percent |
| Voice connection failure | Under 3 percent | Under 1 percent |

Job search churn is naturally high because successful users leave. Growth planning must account for replacement acquisition.

At 500 active monthly customers and 25 percent monthly churn, the business needs approximately 125 new Pro Monthly customers each month merely to remain at 500.

## 17. Canonical terminology

Approved customer facing terms:

1. Free Account
2. One free voice interview
3. Interview Sprint
4. Pro Monthly
5. Five interviews within seven days
6. Thirty interviews per billing cycle
7. Full scorecard and transcript
8. Cancel anytime
9. No automatic renewal for Interview Sprint
10. Next reset date
11. Sessions remaining

Terms that must be removed from new customer surfaces:

1. Unlimited voice interviews
2. Weekly Pass
3. Interview Pack
4. Three day trial
5. Card required trial
6. Essential
7. Premium
8. Monthly at $34
9. $17 per week
10. $39 five session pack
11. Trial to paid conversion language

The word `Pro` may be used only as part of `Pro Monthly` after launch.

## 18. Required technical state

The canonical internal entitlement states are:

1. `free`
2. `sprint`
3. `monthly`
4. Explicit legacy values when required

The application may temporarily preserve old database column names for migration safety, but customer facing and API contract names should use Sprint and Pro Monthly.

Required user entitlement fields include:

1. Plan
2. Voice credits remaining
3. Voice credit expiration
4. Free session used
5. Stripe customer identifier
6. Stripe subscription identifier
7. Subscription status
8. Current billing period start
9. Current billing period end
10. Payment grace expiration
11. Has ever paid

Required plan API output includes:

1. Voice feature enabled
2. Plan name
3. Can start
4. Entitlement mode
5. Sessions used
6. Sessions remaining
7. Session limit
8. Credit expiration when applicable
9. Billing reset date when applicable
10. Payment action required
11. Full report access

## 19. One session implementation strategy

The pricing migration may be built in one coordinated AI coding session, but it must not be delivered as one giant unreviewable commit.

Use one feature branch and a sequence of atomic commits.

### Commit 1. Repository and branch synchronization

1. Create a safety branch from the current `dev0` head
2. Compare the unique commits on `main`, `develop`, and `dev0`
3. Merge only verified missing work into the implementation branch
4. Do not discard the current voice work
5. Record the starting commit identifiers

### Commit 2. Database migration

Create migration 021.

Add at minimum:

1. `current_period_start`
2. `payment_grace_until`
3. A generic voice credit expiration field if the team chooses to replace `pack_expires_at`

Update `app/db/schema.sql`.

Migration must be safe for development, quality assurance, and production databases.

### Commit 3. Canonical plan mapping

Update billing utilities and plan constants.

1. Add `sprint`
2. Retain `monthly`
3. Stop offering `weekly` and `pack`
4. Preserve explicit legacy mappings
5. Remove unknown price fallback to Essential
6. Add new environment variable names for Sprint and Pro Monthly prices
7. Support temporary aliases only during rollout

Recommended environment names:

1. `STRIPE_PRICE_SPRINT`
2. `STRIPE_PRICE_PRO_MONTHLY`

### Commit 4. Stripe checkout and webhook logic

1. Sprint uses Stripe payment mode
2. Pro Monthly uses subscription mode
3. Sprint grants five credits and seven day expiration
4. Monthly stores Stripe period start and end
5. Renewal updates the period boundaries
6. Payment failure starts the recovery period
7. Successful payment clears recovery state
8. Cancellation preserves access through period end
9. Webhook replay remains idempotent
10. Refund and dispute events remove or suspend access when appropriate

### Commit 5. Voice entitlement logic

1. Replace calendar month counting with Stripe billing period counting
2. Enforce thirty monthly sessions
3. Enforce five Sprint credits
4. Enforce seven day Sprint expiration
5. Preserve one lifetime free session
6. Apply payment recovery rules
7. Keep reconnection free from double consumption
8. Keep automatic restoration on failed setup
9. Return accurate usage data to the plan API

### Commit 6. Customer application surfaces

Update:

1. Pricing page
2. Voice interview page
3. Dashboard
4. Navigation
5. Account settings
6. Billing management
7. Free report paywall
8. Mobile signup button
9. Plan badges
10. Usage and reset displays

### Commit 7. Marketing and discoverability

Update:

1. Marketing homepage
2. Features page
3. Blog calls to action
4. Programmatic role page template
5. Existing generated role pages
6. Structured data
7. `llms.txt`
8. `llms-full.txt`
9. Sitemaps
10. Metadata and social cards
11. Marblism operating instructions

### Commit 8. Legal, privacy, and email

Update:

1. Terms of Service
2. Privacy Policy
3. Retention Notice
4. Refund language
5. Help page
6. Purchase confirmations
7. Failed payment email
8. Free session follow up email
9. Cancellation messages
10. Transactional templates

Remove old trial language.

### Commit 9. Analytics

Use canonical event parameters.

1. `plan` equals `sprint` or `monthly`
2. Purchase value equals 19 or 39
3. Capture free session start and completion
4. Capture partial report view
5. Capture checkout start
6. Capture purchase
7. Capture payment failure
8. Capture cancellation
9. Capture allowance exhaustion
10. Preserve cross domain attribution

### Commit 10. Tests and repository sweep

Required automated coverage:

1. Exactly one free session
2. Sprint grants five credits
3. Sprint sixth session blocked
4. Sprint expiration after seven days
5. Sprint repurchase behavior
6. Failed setup restores credit
7. Reconnect does not consume again
8. Monthly thirty session limit
9. Monthly thirty first session blocked
10. Billing renewal resets usage by Stripe period
11. Cancellation access until period end
12. Payment recovery expiration
13. Webhook replay does not double grant
14. Unknown Stripe price fails closed
15. Free report is partial server side
16. Paid report is full
17. Ninety day content deletion
18. User ownership on history reads and deletes
19. Mobile pricing and checkout
20. Feature flag off behavior

Repository sweep terms:

1. `Unlimited voice`
2. `Weekly Pass`
3. `Interview Pack`
4. `$17`
5. `$34`
6. `3 day trial`
7. `three day trial`
8. `Essential`
9. `Premium`
10. Old price identifiers

Every surviving occurrence must be either a migration compatibility reference, a test fixture, or a documented legacy mapping.

## 20. Systems and files likely to change

This is the expected impact map, not a substitute for repository search.

### Data and entitlement

1. `app/db/migrations/021_voice_pricing_entitlements.sql`
2. `app/db/schema.sql`
3. `app/functions/_lib/voice-entitlements.js`
4. `app/functions/_lib/plan-access.js`
5. `app/functions/_lib/db.js`
6. `app/functions/api/plan/me.js`
7. `app/functions/api/usage.js`

### Stripe and billing

1. `app/functions/_lib/billing-utils.js`
2. `app/functions/api/stripe-checkout.js`
3. `app/functions/api/stripe-webhook.js`
4. Billing portal and plan change endpoints
5. Account billing status endpoints

### Voice application

1. `voice-interview.html`
2. `js/voice-interview.js`
3. `js/voice-cta.js`
4. `dashboard.html`
5. `js/navigation.js`
6. `js/plan-cache.js`
7. `account-setting.html`

### Pricing and marketing

1. `pricing.html`
2. `app/functions/pricing.js`
3. `marketing/index.html`
4. `marketing/features.html`
5. `marketing/interview-questions/index.html`
6. `marketing/scripts/build-role-pages.mjs`
7. `marketing/data/roles`
8. `marketing/llms.txt`
9. `marketing/llms-full.txt`
10. Marketing and application sitemaps

### Legal and communication

1. `terms.html`
2. `privacy.html`
3. Retention Notice surface
4. `help.html`
5. Email templates
6. `workers/voice-followup-email`
7. Refund and cancellation copy

### Tests

1. Voice entitlement tests
2. Stripe webhook tests
3. Billing end to end tests
4. Plan access tests
5. Voice history tests
6. Authentication and checkout tests
7. Mobile browser tests

## 21. Human controlled actions

The AI implementation may prepare code and instructions, but the following require owner or authorized human control.

1. Approve this canonical document
2. Verify the number of active legacy customers
3. Create Stripe test products and prices
4. Create Stripe live products and prices
5. Archive old prices only after legacy review
6. Set environment variables in Cloudflare
7. Apply D1 migrations to each environment
8. Confirm OpenAI production limits and billing
9. Confirm Resend production configuration
10. Review legal language with qualified counsel
11. Perform a real card purchase
12. Perform a real cancellation
13. Perform a real refund
14. Review Stripe tax settings
15. Approve production promotion
16. Flip the production voice feature flag

## 22. Rollout sequence

### Development

1. Apply migration 021
2. Configure Stripe test prices
3. Enable voice
4. Run automated tests
5. Run twenty unit economics sessions
6. Test Sprint purchase and expiration
7. Test Pro Monthly purchase and allowance
8. Verify analytics
9. Verify retention

### Quality assurance

1. Promote the atomic commit sequence
2. Apply the quality assurance migration
3. Configure independent quality assurance secrets
4. Run the complete end to end suite
5. Conduct mobile testing on iPhone and Android
6. Conduct accessibility testing
7. Conduct payment failure and recovery testing
8. Obtain owner acceptance

### Production

1. Create and verify live Stripe prices
2. Apply the production migration
3. Set live environment variables
4. Deploy with the voice flag still controlled
5. Run a real Pro Monthly checkout
6. Complete a voice interview
7. Verify D1 entitlement and scorecard
8. Cancel and verify end of period access
9. Refund the test charge
10. Verify analytics and email
11. Enable the public funnel
12. Monitor errors and cost closely for seventy two hours

## 23. Rollback requirements

Before production promotion:

1. Export or snapshot the production D1 database
2. Record every changed Cloudflare variable
3. Record every new Stripe price identifier
4. Preserve the prior production commit
5. Keep old Stripe prices archived rather than deleted
6. Keep the voice feature flag available as the immediate kill switch

Rollback order:

1. Disable the voice feature flag
2. Stop new checkout traffic
3. Restore the prior application version if required
4. Preserve all successful purchases and customer records
5. Reconcile affected customers manually
6. Do not reverse a database migration without a tested reverse migration

## 24. Definition of launch ready

The new model is launch ready only when all conditions are true.

1. Owner approved canonical pricing
2. No unresolved high severity code review findings
3. Development and quality assurance migrations complete
4. All entitlement tests pass
5. Full checkout tests pass
6. Unit economics gates pass
7. Mobile voice session passes
8. Microphone and Content Security Policy pass
9. Analytics events appear correctly
10. Legal surfaces contain no obsolete trial or plan language
11. Pricing and checkout agree exactly
12. Stripe and D1 agree after purchase, renewal, cancellation, failure, and refund
13. Production rollback plan is documented
14. A real production smoke test succeeds

## 25. Sixty day decision rules

Do not change price casually during the first sixty days.

Review weekly, decide monthly.

After sixty days:

1. Keep $39 when conversion and margin are healthy
2. Test $44 only when free completion to paid conversion exceeds 8 percent and refund rate remains under 3 percent
3. Reduce the monthly allowance before reducing price when heavy usage harms margin
4. Improve the report and onboarding before adding more tiers
5. Add an annual plan only when meaningful twelve month retention evidence exists
6. Consider a coach or institution plan only after the consumer funnel works

## 26. Approval

Owner decision:

1. Approved as written
2. Approved with listed amendments
3. Rejected and returned for revision

Approval date:

Owner:

Amendments:

## 27. Source and assumption notes

This document was prepared from:

1. The current JobHackAI `dev0` repository
2. The voice repositioning brief and implementation sequence
3. Pull requests 834 through 837
4. The November 2025 and July 2025 JobHackAI business model documents
5. Current JobHackAI privacy and retention documents
6. Current JobHackAI Terms of Service
7. Public competitor pricing reviewed in July 2026
8. Current OpenAI API pricing and model documentation reviewed in July 2026
9. The owner objective of replacing approximately $14,000 in monthly employment income

Every financial example is a planning assumption until replaced by actual Stripe, D1, OpenAI, and accounting data.
