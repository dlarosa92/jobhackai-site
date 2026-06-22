# JobHackAI Repositioning Brief

Handoff document for Claude Code. This describes the target business model, Stripe and entitlement changes, pricing page structure, and GEO/SEO retrofit. The existing app stays in place: Cloudflare hosting with dev/QA/prod, Firebase Auth, and Stripe are already wired. **Do not rebuild. Modify in place.** Adapt all file paths and naming to the existing repo conventions.

---

## 1. Target business model

**Free tier (requires Firebase signup):**
- Interview Questions generator
- Resume Rewrite
- Cover Letter
- LinkedIn Optimizer: keep only if analytics show meaningful traffic. Otherwise remove the nav entry and 301 its page to the resume tool.

**Paid product (the only one):** Voice Mock Interview.

**Free taste:** every account gets exactly 1 full voice mock interview, lifetime. After it ends, show a partial scorecard (top strength plus one improvement area). The full report, transcript, and all further sessions sit behind the paywall.

Every free tool's output screen must end with a contextual CTA into the voice interview, for example: "You have your questions. Now practice answering them out loud."

---

## 2. Stripe changes

Create these Products/Prices (test mode first, then prod):

| Offer | Price | Type | Notes |
|---|---|---|---|
| Weekly Pass | $17/week | Recurring, weekly | Cancel anytime, no proration needed |
| Monthly | $34/month | Recurring, monthly | Highlight as default plan |
| Interview Pack | $39 one time | One time payment | 5 voice sessions, 90 day expiry |

Pricing rationale: the market has a $9/month bundler (Himalayas) at the bottom and premium players near $100/month at the top. Sit in the middle and compete on session realism and feedback depth, not price. Treat these numbers as launch hypotheses and revisit after 60 days of conversion data.

**Webhooks to handle** (verify which already exist in the codebase):
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

**Entitlement model:**
- Store entitlement state per user in Firestore (or Firebase custom claims if already used): `plan` (free | weekly | monthly | pack), `voiceSessionsRemaining` (for pack), `freeSessionUsed` (boolean), `currentPeriodEnd`.
- Stripe webhooks are the single source of truth. Client never sets entitlements.
- Server side gate on the voice interview start endpoint: free users pass only if `freeSessionUsed` is false; pack users decrement credits atomically; subscribers check `currentPeriodEnd`.
- Fair use cap for subscribers (e.g., 60 sessions/month) to bound model costs. Enforce silently server side.

**Unit economics check before locking prices:** model the per session cost of the chosen voice stack (OpenAI Realtime, Gemini Live, or similar). A 20 minute session can range from well under $1 with mini realtime models to a few dollars with full models. Verify current per minute pricing and confirm gross margin at the Weekly Pass price under heavy use.

---

## 3. Pricing page structure

Route: `/pricing`. Server rendered (see section 5).

1. **Hero:** outcome headline, e.g., "Walk into your interview having already done it." Subhead names the product: realistic voice mock interviews with detailed feedback.
2. **Free vs Pro comparison table:** rows for each tool; free column shows the prep tools plus "1 voice interview," Pro column shows unlimited sessions, full scorecards, transcripts, progress tracking.
3. **Three plan cards:** Weekly / Monthly (visually emphasized, "Most popular") / Interview Pack. Each card states the job it solves: "Interview this week," "Active search," "One big interview."
4. **How it works:** 3 steps with screenshots or short demo clip.
5. **FAQ:** 6 to 8 questions, marked up with FAQPage schema (cancellation, refunds, how realistic, what feedback covers, data privacy).
6. **Trust strip:** cancel anytime, secure checkout via Stripe, testimonial placeholders until real ones exist.

Copy rules: no em dashes or en dashes anywhere on the site. Short sentences.

---

## 4. Funnel and paywall logic

- Free tools: gate full output behind signup, but render enough ungated preview content for crawlers and for the user to see value.
- Post free voice session: partial scorecard with blurred full report and a single upgrade CTA. No popups, no countdown timers, no dark patterns.
- Email sequence trigger on `freeSessionUsed = true` without purchase within 48 hours: one helpful email with a concrete tip from their session plus the upgrade link. One email, not a drip barrage.
- Track funnel events (signup, tool use, free session start/finish, paywall view, checkout start, purchase) so pricing can be tuned with data.

---

## 5. GEO / SEO retrofit checklist

**Cloudflare first (highest priority, do before anything else):**
- [ ] Check Cloudflare's AI crawler / bot settings for the zone. Cloudflare blocks many AI crawlers by default on newer configurations. Explicitly allow: GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, CCBot, Bingbot.
- [ ] Verify robots.txt does not disallow these agents. Add explicit Allow rules.
- [ ] Confirm no WAF or Bot Fight Mode rule challenges these crawlers.

**Rendering:**
- [ ] All marketing, pricing, and content pages must be server rendered or statically prerendered (Cloudflare Pages / Workers SSR). Client only React shells are invisible or degraded for many AI crawlers.
- [ ] Fast TTFB, clean canonical tags, XML sitemap submitted in Google Search Console and Bing Webmaster Tools.

**Structured data (JSON-LD on relevant pages):**
- [ ] `Organization` and `WebSite` sitewide
- [ ] `SoftwareApplication` with `offers` (the three price points) on the pricing page
- [ ] `FAQPage` on pricing and on each programmatic page
- [ ] `HowTo` on the "how it works" content

**AI discoverability files:**
- [ ] `llms.txt` at root: one page plain text description of the product, who it is for, pricing, and links to key pages.
- [ ] Optional `llms-full.txt` with expanded tool descriptions.

**Programmatic content engine (the growth core):**
- [ ] Template: `/interview-questions/[role]` pages. Launch with 50 to 100 roles, expand toward 300. Each page: unique 150 word intro, 10 to 15 role specific questions, 2 worked sample answers, and the CTA "Practice answering these out loud" into the voice interview.
- [ ] Companion template: `/mock-interview/[role]` landing pages targeting "mock interview for [role]" queries.
- [ ] Publish original data posts from anonymized usage once volume exists (e.g., "the 10 most common follow up questions in PM interviews"). Original statistics are what AI answer engines cite.

**Distribution (assign to the Marblism agents):**
- [ ] Sunny (social agent): every programmatic page becomes 2 to 3 social posts; one strength/mistake insight per post, link back to the page.
- [ ] Sales agent: redirect from cold selling to partnership outreach with career coaches, university career centers, and bootcamps. Goal is backlinks, listings, and referral deals, not direct sales.
- [ ] List the product on AI tool directories (There's An AI For That and similar) and plan a Product Hunt style relaunch around the voice product.

---

## 6. Build order

1. Cloudflare AI crawler fix plus robots.txt (one hour, immediate GEO unblock)
2. Stripe products, webhooks, entitlement model
3. Voice mock interview feature (the real build; pick the voice stack and validate per session cost first)
4. Pricing page plus paywall and free taste logic
5. Schema, llms.txt, sitemap
6. Programmatic page templates plus first 50 roles
7. Funnel analytics events
8. Hand distribution playbook to the agents

## 7. Success metrics (first 90 days)

- Indexed programmatic pages (Search Console)
- Citations appearing in AI answers (spot check ChatGPT, Perplexity, Claude for "[role] interview questions")
- Free signup to free voice session completion rate
- Free session to paid conversion rate (target 3 to 8 percent to start)
- Per session model cost vs. plan revenue
