# JobHackAI — Scalability & Load Analysis

> Last updated: March 2026
> Status: Workers Paid plan ($5/month) activated; Firebase Auth on Spark (free)

---

## Architecture Overview

| Layer | Service | Plan |
|---|---|---|
| CDN + Static Hosting | Cloudflare Pages | Free (unlimited bandwidth) |
| Serverless API | Cloudflare Workers (Pages Functions) | **Paid ($5/month)** |
| Database | Cloudflare D1 (SQLite) | Included with Workers Paid |
| Cache / Throttle | Cloudflare KV | Included with Workers Paid |
| PDF Parsing | Cloudflare Workers AI (`toMarkdown()`) | Free tier + Paid overage |
| Authentication | Firebase Auth | Spark (Free) |
| Email | Resend API | Separate |
| Payments | Stripe | Separate |
| AI Features | OpenAI API (GPT-4o / GPT-4o-mini) | Separate (pay-per-token) |

---

## Current Plan Limits (Workers Paid — $5/month)

### Workers & Pages Functions
| Metric | Included | Overage Rate |
|---|---|---|
| Requests | **10,000,000/month** | $0.30/million |
| CPU time | 30s/request, **30,000,000 ms/month** | $0.02/million ms |
| Cron triggers | **Enabled** | — |

### Cloudflare KV (included with Workers Paid)
| Metric | Included | Overage Rate |
|---|---|---|
| Reads | **10,000,000/month** | $0.50/million |
| Writes | **1,000,000/month** | $0.50/million |
| Deletes | **1,000,000/month** | $0.50/million |
| Lists | **1,000,000/month** | $0.50/million |
| Storage | **1 GB** | $0.50/GB-month |

### Cloudflare D1 (included with Workers Paid)
| Metric | Included | Overage Rate |
|---|---|---|
| Rows read | **25,000,000,000/month** | $0.001/million |
| Rows written | **50,000,000/month** | $0.001/million |
| Storage | **5 GB** | $0.75/GB-month |

### Cloudflare Workers AI
| Metric | Included | Notes |
|---|---|---|
| Neurons | **10,000/day** (free tier) | Used by `toMarkdown()` PDF parsing |

### Firebase Auth (Spark/Free)
| Metric | Limit | Risk |
|---|---|---|
| Email/password auth | **Unlimited** | None |
| Google OAuth | **Unlimited** | None |
| Phone/SMS auth | 10/day | Not in use |
| Anonymous auth | N/A | Not in use |

### Firebase Hosting (Spark/Free)
| Metric | Limit | Risk |
|---|---|---|
| Data transfer | 360 MB/day | **N/A — not deployed** |
| Storage | 10 GB | N/A |

> Firebase Hosting shows "Get started" in the console — no sites are deployed. All hosting runs through Cloudflare Pages.

---

## Capacity Estimates

### How many users can the current setup handle?

**Assumptions per active user session:**
- 1 auth verification (JWT, no Firebase call — uses cached JWKS)
- 1 `getOrCreateUserByAuthId` → 1 D1 read + 1 D1 write (`last_login_at`)
- 2–3 feature requests (ATS score, resume feedback, interview questions)
- Each feature request: ~2 KV reads (throttle check, plan cache) + 1–3 KV writes (throttle, usage, cache) + 2–4 D1 reads/writes

**Per session totals:**
| Resource | Per Session | Monthly Limit | Sessions/Month |
|---|---|---|---|
| Worker requests | ~8 | 10,000,000 | **~1,250,000** |
| KV reads | ~10 | 10,000,000 | **~1,000,000** |
| KV writes | ~6 | 1,000,000 | **~166,000** |
| D1 row reads | ~15 | 25,000,000,000 | Effectively unlimited |
| D1 row writes | ~8 | 50,000,000 | **~6,250,000** |

**Bottleneck: KV writes at ~166,000 sessions/month (~5,500/day).**

With the Workers Paid plan, this supports **~5,500 active user sessions per day** before KV write overage kicks in. Overage is $0.50/million additional writes — very affordable.

### What if we go viral? (10,000+ users in a day)

| Scenario | Worker Requests | KV Writes | D1 Writes | Est. Overage Cost |
|---|---|---|---|---|
| 5,000 users/day | 40,000 | 30,000 | 40,000 | $0 (within limits) |
| 10,000 users/day | 80,000 | 60,000 | 80,000 | $0 (within limits) |
| 50,000 users/day | 400,000 | 300,000 | 400,000 | ~$0 (within monthly) |
| 100,000 users/day | 800,000 | 600,000 | 800,000 | ~$0.15/day KV overage |

**Verdict: The Workers Paid plan comfortably handles a viral launch up to ~100k users/day with negligible overage costs.**

---

## Remaining Risks (Post-Upgrade)

### 1. OpenAI API Costs (HIGH risk, external)

Every resume feedback and interview question generation calls OpenAI's API. There is no global spend cap in the codebase.

- **GPT-4o**: ~$2.50/1M input tokens, ~$10/1M output tokens
- A single resume feedback call: ~2,000 input + ~1,500 output tokens ≈ $0.02
- 10,000 users × 2 AI calls each = 20,000 calls = **~$400/day**

**Mitigation already in place:**
- Input truncation (10,000 chars max)
- Per-user daily quotas (D1-backed)
- Per-feature throttle/cooldown (KV-backed)
- Fallback from GPT-4o to GPT-4o-mini on failure
- Cached results (ATS cache, feedback tier-1 cache)

**Recommended additional safeguards:**
- Set an OpenAI monthly spend cap in the OpenAI dashboard
- Monitor daily spend via OpenAI usage dashboard
- Consider adding a global daily AI request counter with circuit breaker

### 2. Workers AI Neuron Limit (MEDIUM risk)

PDF text extraction via `toMarkdown()` uses Workers AI neurons. The free tier provides 10,000 neurons/day — each PDF parse consumes an unknown but non-trivial number.

**Mitigation:** Monitor via Cloudflare dashboard → Workers AI → Usage. If consistently hitting limits, Workers AI paid tier is $0.011/1,000 neurons.

### 3. No IP-Based Rate Limiting (MEDIUM risk)

Current rate limiting is per-authenticated-user only (KV throttle keys). An unauthenticated bot or scraper can hammer public endpoints (OPTIONS, static assets don't count — but auth-required endpoints still consume Worker invocations before rejecting).

**Mitigation:** Add a Cloudflare WAF rate limiting rule:
1. Cloudflare Dashboard → Security → WAF → Rate Limiting Rules
2. Rule: If same IP sends >60 requests per minute to `/api/*` → Block for 5 minutes
3. This runs at the edge before Workers, consuming zero Worker invocations

### 4. `last_login_at` D1 Write on Every Request (LOW risk post-upgrade)

`getOrCreateUserByAuthId()` with `updateActivity: true` writes to D1 on every authenticated request. On the Paid plan (50M writes/month), this is not a bottleneck — but it's still a wasteful write.

**Optimization applied:** Debounce writes to once per hour using a KV cache key. See code changes below.

---

## Code Optimizations Applied

### 1. Debounced `last_login_at` writes (`app/functions/_lib/db.js`)

Before: Every authenticated API request updated `users.last_login_at` in D1.
After: Only updates if the last write was >1 hour ago (checked via KV cache).
Savings: ~80% reduction in D1 writes from auth, ~4 fewer D1 writes per session.

### 2. Security headers on all environments (`app/functions/_middleware.js`)

Before: Security headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.) only applied in QA.
After: Security headers applied on all environments. QA additionally gets `noindex` and no-cache headers.

---

## Pre-Launch Checklist

- [x] Upgrade to Cloudflare Workers Paid ($5/month)
- [x] Verify Firebase Hosting is not serving traffic (confirmed: not deployed)
- [ ] Set OpenAI monthly spend cap in OpenAI dashboard
- [ ] Add Cloudflare WAF rate limiting rule (60 req/min per IP on `/api/*`)
- [ ] Monitor Workers AI neuron usage after first week of real traffic
- [ ] Verify all 3 cron workers appear as "Scheduled" in Cloudflare dashboard
- [ ] Run a basic load test (50–100 concurrent users) and check for 429/500 errors
- [ ] Review Cloudflare Analytics after first week for request patterns

---

## Cost Projection

| Monthly Traffic | Base Cost | Est. Overage | OpenAI Est. | Total Est. |
|---|---|---|---|---|
| 1,000 users | $5 | $0 | ~$40 | **~$45** |
| 5,000 users | $5 | $0 | ~$200 | **~$205** |
| 10,000 users | $5 | ~$0.50 | ~$400 | **~$406** |
| 50,000 users | $5 | ~$5 | ~$2,000 | **~$2,010** |

> OpenAI costs dominate at scale. Cloudflare infrastructure costs remain negligible.
