# JobHackAI Repositioning: PR Sequence

Execution plan for Claude Code, one PR at a time. Pairs with `jobhackai-repositioning-brief.md` (each PR references its brief section).

**Pipeline:** feature branch off `dev` → merge to `dev` (dev env) → PR `dev` to `develop` (QA env) → PR `develop` to `main` (prod). All three branches auto deploy on Cloudflare. **Marketing `main` deploys to production immediately on merge**, so some PRs below have an explicit hold point.

**Sites:** [MKT] = jobhackai.io marketing site. [APP] = app.jobhackai.io.

**How to run this:** give Claude Code one PR at a time, pasting that PR's scope and acceptance criteria plus the matching brief section. Keep diffs small so BugBot and Cursor can do meaningful reviews. Target under ~500 changed lines per PR except PR 7a.

---

## Task 0: Dashboard config (not PRs, do first)

These are settings changes, not code. Do them before PR 1.

- [ ] Cloudflare: allow AI crawlers on the marketing zone (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, CCBot, Bingbot). Check Bot Fight Mode and WAF rules are not challenging them.
- [ ] Stripe (test mode): create Weekly Pass $17/wk, Monthly $34/mo, Interview Pack $39 one time. Record the Price IDs for PR 2.
- [ ] GA4 Admin: configure cross domain measurement for jobhackai.io and app.jobhackai.io (Admin → Data Streams → Configure tag settings → Configure your domains).

---

## Overview

| PR | Name | Site | Depends on | Promote to main? |
|----|------|------|-----------|------------------|
| 1 | robots-llms-sitemap | MKT | Task 0 | Immediately |
| 2 | stripe-entitlements | APP | Task 0 | Immediately (inert until used) |
| 3 | schema-jsonld | MKT | 1 | Immediately |
| 4 | pricing-page | MKT | 2 | **Hold at develop until launch** |
| 5 | programmatic-roles | MKT | 1, 3 | Immediately |
| 6 | voice-interview-core | APP | 2 | Dark, behind feature flag |
| 7 | voice-scorecard-paywall | APP | 6 | Dark, behind feature flag |
| 8 | free-tool-ctas | APP | 7 | **Hold at develop until launch** |
| 9 | analytics-events | Both | 4, 7 | With launch |

---

## PR 1: `feature/robots-llms-sitemap` [MKT]

Brief section 5 (AI discoverability files).

**Scope:** Add or update `robots.txt` with explicit Allow rules for the crawlers in Task 0. Add `llms.txt` at root (one page plain text: what JobHackAI is, who it is for, the tools, pricing summary, key page links). Verify `sitemap.xml` exists, is current, and is referenced in robots.txt.

**Acceptance criteria:**
- [ ] `curl https://jobhackai.io/robots.txt` returns the new file with Allow rules
- [ ] `curl https://jobhackai.io/llms.txt` returns the descriptor
- [ ] Sitemap validates and is submitted in Google Search Console and Bing Webmaster Tools
- [ ] No existing page or route is modified

---

## PR 2: `feature/stripe-entitlements` [APP]

Brief section 2.

**Scope:** Webhook endpoint handling `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Firestore entitlement fields per user: `plan`, `voiceSessionsRemaining`, `freeSessionUsed`, `currentPeriodEnd`. Server side entitlement check function (generic "can start a session" gate, nothing calls it yet). Test mode keys in dev and QA env vars, live keys reserved for prod env vars only.

**Acceptance criteria:**
- [ ] Webhook verifies Stripe signatures and is idempotent (replaying an event does not double grant)
- [ ] Stripe test clock or test checkout updates the Firestore entitlement correctly for all three offers
- [ ] Pack purchase sets `voiceSessionsRemaining = 5` with 90 day expiry
- [ ] Subscription cancel/expiry downgrades `plan` to free
- [ ] Client code cannot write entitlement fields (Firestore rules verified)
- [ ] No user facing UI changes in this PR

---

## PR 3: `feature/schema-jsonld` [MKT]

Brief section 5 (structured data).

**Scope:** JSON-LD across the marketing site: `Organization` and `WebSite` sitewide, `SoftwareApplication` with `offers` on the homepage. (Pricing page and FAQ schema land in PR 4 with the page itself.)

**Acceptance criteria:**
- [ ] All pages pass Google Rich Results Test with zero errors
- [ ] Schema renders in initial HTML (server rendered), not injected client side
- [ ] No visual changes

---

## PR 4: `feature/pricing-page` [MKT] — HOLD AT DEVELOP

Brief section 3.

**Scope:** Rebuild `/pricing` per the brief layout: hero, free vs Pro table, three plan cards (Monthly emphasized), how it works, FAQ with `FAQPage` schema, trust strip. Checkout buttons link to the app checkout flow using PR 2 Price IDs.

**Acceptance criteria:**
- [ ] Page is server rendered and passes Rich Results Test (FAQPage, SoftwareApplication with offers)
- [ ] Each card's checkout button initiates the correct Stripe test checkout from QA
- [ ] Mobile layout verified (most job seeker traffic is mobile)
- [ ] No em dashes or en dashes anywhere in copy

**Promotion:** merge to `dev` and `develop` freely. **Do not PR `develop` to `main` until the launch checklist**, because marketing `main` deploys instantly and this page sells a product that does not exist in prod yet.

---

## PR 5: `feature/programmatic-roles` [MKT]

Brief section 5 (programmatic content engine).

**Scope:** Template route `/interview-questions/[role]` driven by content data files (JSON or markdown per role), so future role additions are content commits with no code review burden. Ship the template plus the first 10 pilot roles. Each page: unique intro (~150 words), 10 to 15 questions, 2 worked sample answers, FAQPage schema, CTA into the voice interview signup. Auto include new pages in the sitemap.

**Acceptance criteria:**
- [ ] 10 pilot role pages render server side with unique content (no shared boilerplate intros)
- [ ] Pages appear in sitemap.xml automatically
- [ ] Rich Results Test passes on a sample page
- [ ] Adding a role requires only a new data file, verified by adding one in review

**Follow up (no PR needed):** content batches to reach 50, then 100+ roles.

---

## PR 6: `feature/voice-interview-core` [APP] — FEATURE FLAGGED

Brief sections 1 and 2 (the paid product). The one genuinely new build. Pick the voice stack and validate per session cost before starting.

**Scope:** Voice session lifecycle behind a `VOICE_INTERVIEW_ENABLED` flag: session create (gated by PR 2 entitlement check), realtime voice conversation against the user's target role/JD, session end and transcript persistence. Atomic credit decrement for pack users, `freeSessionUsed` set on free users, fair use cap for subscribers enforced server side.

**Acceptance criteria:**
- [ ] Flag off: zero user visible change in any environment
- [ ] Flag on in dev/QA: full session start to finish works on desktop and mobile browsers
- [ ] Free user blocked from a second session; pack decrements exactly once per session including on disconnect/retry
- [ ] Transcript persisted and tied to the user
- [ ] Per session model cost logged for unit economics tracking

**Promotion:** can merge all the way to `main` dark (flag off in prod).

---

## PR 7: `feature/voice-scorecard-paywall` [APP] — FEATURE FLAGGED

Brief sections 1 and 4.

**Scope:** Post session scorecard and feedback report. Free taste behavior: partial scorecard (top strength plus one improvement), blurred full report, single upgrade CTA, no dark patterns. Full report for entitled users. Trigger for the single 48 hour follow up email when `freeSessionUsed` is true with no purchase.

**Acceptance criteria:**
- [ ] Free user sees partial scorecard and blurred report with one CTA
- [ ] Paid user sees full report and transcript
- [ ] Exactly one follow up email fires at 48h, none for purchasers
- [ ] All behind the same flag as PR 6

---

## PR 8: `feature/free-tool-ctas` [APP] — HOLD AT DEVELOP

Brief sections 1 and 4.

**Scope:** Contextual CTA into the voice interview at the end of each free tool's output (interview questions, resume rewrite, cover letter). Signup gating on full tool output with ungated preview content preserved for crawlers. Remove or 301 the LinkedIn optimizer if analytics say so.

**Acceptance criteria:**
- [ ] Each free tool output ends with the voice CTA
- [ ] Logged out users see preview content plus signup gate; crawler accessible preview verified
- [ ] Hold `develop` to `main` until launch (CTAs point at a flagged off feature)

---

## PR 9: `feature/analytics-events` [Both]

Brief section 4 (funnel tracking).

**Scope:** GA4 events: `sign_up`, `tool_output_viewed`, `voice_session_start`, `voice_session_complete`, `paywall_view`, `begin_checkout`, `purchase`. Cross domain tag config in code to match Task 0 GA4 admin settings.

**Acceptance criteria:**
- [ ] Events visible in GA4 DebugView from QA
- [ ] A session crossing jobhackai.io → app.jobhackai.io keeps one session ID (cross domain verified)
- [ ] `purchase` event carries plan and value

---

## Launch checklist (one sitting)

1. [ ] Stripe live mode products created, prod env keys set
2. [ ] PR 4 and PR 8: promote `develop` to `main`
3. [ ] Flip `VOICE_INTERVIEW_ENABLED` in prod
4. [ ] Live smoke test: real checkout on Weekly Pass, run a session, verify scorecard and entitlement, then refund
5. [ ] Verify GA4 events flowing in prod
6. [ ] Hand the distribution playbook (brief section 5) to Sunny and the sales agent
