# JobHackAI Repositioning: PR Sequence

> **Build status (2026-06-13, branch `claude/vibrant-ritchie-s82b22`):** the
> full sequence was implemented end to end on one branch per the one-shot
> build instructions. Checked boxes were verified in code or by unit tests in
> this build. Unchecked boxes marked *(pending env verify)* need a deployed
> dev/QA environment, dashboards, or a human (see the build summary's NEEDS
> HUMAN section). Entitlements adapted from Firestore to D1 per the brief's
> "adapt to existing repo conventions" rule: D1 is this app's source of truth
> and clients have no write path to it.

Execution plan for Claude Code, one PR at a time. Pairs with `jobhackai-repositioning-brief.md` (each PR references its brief section).

**Pipeline:** feature branch off `dev` → merge to `dev` (dev env) → PR `dev` to `develop` (QA env) → PR `develop` to `main` (prod). All three branches auto deploy on Cloudflare. **Marketing `main` deploys to production immediately on merge**, so some PRs below have an explicit hold point.

**Sites:** [MKT] = jobhackai.io marketing site. [APP] = app.jobhackai.io.

**How to run this:** give Claude Code one PR at a time, pasting that PR's scope and acceptance criteria plus the matching brief section. Keep diffs small so BugBot and Cursor can do meaningful reviews. Target under ~500 changed lines per PR except PR 7a.

---

## Task 0: Dashboard config (not PRs, do first)

These are settings changes, not code. Do them before PR 1.

- [x] Cloudflare: allow AI crawlers on the marketing zone (verified already-allowed, Task 0 report 2026-06-12) (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, CCBot, Bingbot). Check Bot Fight Mode and WAF rules are not challenging them.
- [x] Stripe (test mode): create Weekly Pass $17/wk, Monthly $34/mo, Interview Pack $39 one time. Record the Price IDs for PR 2. (Task 0 report; IDs live only in env vars)
- [x] GA4 Admin: configure cross domain measurement for jobhackai.io and app.jobhackai.io (Admin → Data Streams → Configure tag settings → Configure your domains).

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
- [ ] `curl https://jobhackai.io/robots.txt` returns the new file with Allow rules *(file authored + committed; pending env verify after deploy)*
- [ ] `curl https://jobhackai.io/llms.txt` returns the descriptor *(authored, plus llms-full.txt; pending env verify after deploy)*
- [ ] Sitemap validates and is submitted in Google Search Console and Bing Webmaster Tools *(XML validates locally; GSC/Bing submission is NEEDS HUMAN)*
- [x] No existing page or route is modified (GEO commit touched only robots/sitemap/llms files; app sitemap host corrected to app.jobhackai.io)

---

## PR 2: `feature/stripe-entitlements` [APP]

Brief section 2.

**Scope:** Webhook endpoint handling `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Firestore entitlement fields per user: `plan`, `voiceSessionsRemaining`, `freeSessionUsed`, `currentPeriodEnd`. Server side entitlement check function (generic "can start a session" gate, nothing calls it yet). Test mode keys in dev and QA env vars, live keys reserved for prod env vars only.

**Acceptance criteria:**
- [x] Webhook verifies Stripe signatures and is idempotent (replaying an event does not double grant) (existing HMAC verify + KV dedup, plus D1 stripe_event_log hard idempotency for pack grants; unit tested)
- [ ] Stripe test clock or test checkout updates the D1 entitlement correctly for all three offers *(mapping implemented; pending env verify with test webhooks in dev/QA)*
- [x] Pack purchase sets `voice_sessions_remaining = 5` with 90 day expiry (unit tested)
- [x] Subscription cancel/expiry downgrades `plan` to free (existing customer.subscription.deleted path, unchanged; entitlement fallthrough unit tested)
- [x] Client code cannot write entitlement fields (adapted: entitlements live in D1, which has no client access path; written only by webhook/server code)
- [x] No user facing UI changes from the webhook/entitlement layer itself (the free-tool regrade shipped alongside it in this single-branch build, per the one-shot instructions)

---

## PR 3: `feature/schema-jsonld` [MKT]

Brief section 5 (structured data).

**Scope:** JSON-LD across the marketing site: `Organization` and `WebSite` sitewide, `SoftwareApplication` with `offers` on the homepage. (Pricing page and FAQ schema land in PR 4 with the page itself.)

**Acceptance criteria:**
- [ ] All pages pass Google Rich Results Test with zero errors *(JSON-LD parse-validated locally; Rich Results Test is NEEDS HUMAN after deploy)*
- [x] Schema renders in initial HTML (static HTML), not injected client side
- [x] No visual changes

---

## PR 4: `feature/pricing-page` [MKT] — HOLD AT DEVELOP

Brief section 3.

**Scope:** Rebuild `/pricing` per the brief layout: hero, free vs Pro table, three plan cards (Monthly emphasized), how it works, FAQ with `FAQPage` schema, trust strip. Checkout buttons link to the app checkout flow using PR 2 Price IDs.

**Acceptance criteria:**
- [x] Page is static HTML with FAQPage + SoftwareApplication offers in initial markup *(Rich Results Test after deploy: NEEDS HUMAN)*
- [ ] Each card's checkout button initiates the correct Stripe test checkout from QA *(wired to /api/stripe-checkout with weekly/monthly/pack; pending env verify)*
- [ ] Mobile layout verified (most job seeker traffic is mobile) *(built mobile-first; visual pass pending env verify)*
- [x] No em dashes or en dashes anywhere in copy (grep-verified)

**Promotion:** merge to `dev` and `develop` freely. **Do not PR `develop` to `main` until the launch checklist**, because marketing `main` deploys instantly and this page sells a product that does not exist in prod yet.

---

## PR 5: `feature/programmatic-roles` [MKT]

Brief section 5 (programmatic content engine).

**Scope:** Template route `/interview-questions/[role]` driven by content data files (JSON or markdown per role), so future role additions are content commits with no code review burden. Ship the template plus the first 10 pilot roles. Each page: unique intro (~150 words), 10 to 15 questions, 2 worked sample answers, FAQPage schema, CTA into the voice interview signup. Auto include new pages in the sitemap.

**Acceptance criteria:**
- [x] 10 pilot role pages render as static HTML with unique content (no shared boilerplate intros)
- [x] Pages appear in sitemap.xml automatically (marker-delimited block maintained by the generator; rerun-idempotent)
- [ ] Rich Results Test passes on a sample page *(JSON-LD parse-validated; external test NEEDS HUMAN)*
- [x] Adding a role requires only a new data file + `npm run build:roles` (generator validates structure; verified by rerun)

**Follow up (no PR needed):** content batches to reach 50, then 100+ roles.

---

## PR 6: `feature/voice-interview-core` [APP] — FEATURE FLAGGED

Brief sections 1 and 2 (the paid product). The one genuinely new build. Pick the voice stack and validate per session cost before starting.

**Scope:** Voice session lifecycle behind a `VOICE_INTERVIEW_ENABLED` flag: session create (gated by PR 2 entitlement check), realtime voice conversation against the user's target role/JD, session end and transcript persistence. Atomic credit decrement for pack users, `freeSessionUsed` set on free users, fair use cap for subscribers enforced server side.

**Acceptance criteria:**
- [x] Flag off: zero user visible change (voice APIs return 404, dashboard tile hidden, CTAs not injected)
- [ ] Flag on in dev/QA: full session start to finish works on desktop and mobile browsers *(pending env verify: needs OPENAI_API_KEY + migration 020 + flag on in dev)*
- [x] Free user blocked from a second session; pack decrements exactly once per session including on disconnect/retry (atomic conditional UPDATEs + resume-without-consume path; unit tested)
- [x] Transcript persisted and tied to the user (voice_sessions.user_id FK; ownership checked on every read)
- [x] Per session model cost logged for unit economics tracking (voice_sessions.cost_usd + [VOICE-COST] log line; rates via VOICE_COST_IN_PER_M / VOICE_COST_OUT_PER_M)

**Promotion:** can merge all the way to `main` dark (flag off in prod).

---

## PR 7: `feature/voice-scorecard-paywall` [APP] — FEATURE FLAGGED

Brief sections 1 and 4.

**Scope:** Post session scorecard and feedback report. Free taste behavior: partial scorecard (top strength plus one improvement), blurred full report, single upgrade CTA, no dark patterns. Full report for entitled users. Trigger for the single 48 hour follow up email when `freeSessionUsed` is true with no purchase.

**Acceptance criteria:**
- [x] Free user sees partial scorecard and blurred report with one CTA (partial enforced server-side in the session GET, not just visually)
- [x] Paid user sees full report and transcript (paid sessions stay unlocked even after pack credits run out; upgrading retroactively unlocks the free session)
- [x] Exactly one follow up email fires at 48h, none for purchasers (hourly worker; sent-claim before send; filters: plan=free, no credits, never paid) *(live send pending env verify with RESEND_API_KEY)*
- [x] All behind the same flag as PR 6 (worker checks VOICE_INTERVIEW_ENABLED too)

---

## PR 8: `feature/free-tool-ctas` [APP] — HOLD AT DEVELOP

Brief sections 1 and 4.

**Scope:** Contextual CTA into the voice interview at the end of each free tool's output (interview questions, resume rewrite, cover letter). Signup gating on full tool output with ungated preview content preserved for crawlers. Remove or 301 the LinkedIn optimizer if analytics say so.

**Acceptance criteria:**
- [x] Each free tool output ends with the voice CTA (interview questions, typed mock results, resume feedback, cover letter; injected only when the flag is on)
- [x] Logged out users see preview content plus signup gate (preview mode on the four tool pages; crawlers receive full static HTML since guards are client-side JS) *(visual pass pending env verify)*
- [x] Safe even on `main`: CTAs only render when VOICE_INTERVIEW_ENABLED is on (hold still applies for the pricing page messaging)

---

## PR 9: `feature/analytics-events` [Both]

Brief section 4 (funnel tracking).

**Scope:** GA4 events: `sign_up`, `tool_output_viewed`, `voice_session_start`, `voice_session_complete`, `paywall_view`, `begin_checkout`, `purchase`. Cross domain tag config in code to match Task 0 GA4 admin settings.

**Acceptance criteria:**
- [ ] Events visible in GA4 DebugView from QA *(all events wired client/server-side; pending env verify)*
- [ ] A session crossing jobhackai.io → app.jobhackai.io keeps one session ID *(linker.domains configured in code + GA4 admin done in Task 0; pending env verify)*
- [x] `purchase` event carries plan and value (server-side Measurement Protocol, incl. weekly/monthly/pack)

---

## Launch checklist (one sitting)

1. [ ] Stripe live mode products created, prod env keys set
2. [ ] PR 4 and PR 8: promote `develop` to `main`
3. [ ] Flip `VOICE_INTERVIEW_ENABLED` in prod
4. [ ] Live smoke test: real checkout on Weekly Pass, run a session, verify scorecard and entitlement, then refund
5. [ ] Verify GA4 events flowing in prod
6. [ ] Hand the distribution playbook (brief section 5) to Sunny and the sales agent
