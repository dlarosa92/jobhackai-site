# Merge revert notes: `claude/vibrant-ritchie-s82b22` → `dev0`

> **Purpose:** Emergency rollback reference if the voice repositioning merge needs to be undone.
> **Created:** 2026-06-19 (local merge session)

---

## Merge identifiers (save these)

| Item | SHA / value |
|------|-------------|
| **Pre-merge `dev0` (safe restore point)** | `e9597d3c9e1b8f185afbd3212b48776c68ceeb53` |
| **Tip of merged feature branch** | `0adfb29c69399defdf3f76df44ffafcdf0504de8` |
| **Merge commit on `dev0`** | `0e76e8144ac06e86d845e979ca99571f21a0d72b` |
| **Source branch** | `claude/vibrant-ritchie-s82b22` |
| **Target branch** | `dev0` |
| **Merge strategy** | `--no-ff` (explicit merge commit; revert-friendly) |
| **Files touched** | 120 files, +8994 / −447 lines |

### Commits included (20, oldest → newest)

```
b7184ca docs: repositioning brief and PR sequence
2dd17ae feat(geo): explicit AI crawler allows, llms.txt, corrected app sitemap
8aad23e feat(stripe): voice entitlements, new plans, free prep-tool regrade
366ab5a feat(schema): SoftwareApplication offers on homepage, Org/WebSite sitewide
c4b6ffa feat(pricing): new /pricing page selling the voice mock interview
95e534d feat(roles): programmatic /interview-questions/[role] pages, 10 pilot roles
7434fdf feat(voice): voice mock interview core behind VOICE_INTERVIEW_ENABLED
2921eac feat(voice): 48h follow-up email worker + stale session sweeper
9d413e8 feat(funnel): voice CTAs on tool output + logged-out signup preview gate
e33611d feat(analytics): GA4 funnel events, cross-domain linker, single-tag cleanup
f5724ce docs: check off PR-sequence acceptance criteria with verification notes
83c3f8d fix(voice,pricing): resolve 4 BugBot findings on PR #834
2c5c167 fix(usage,voice): resolve 2 BugBot findings on PR #834
8b08094 fix(voice,webhook): resolve 3 BugBot findings on PR #834
348f6f4 fix(linkedin,voice): resolve 2 BugBot findings on PR #834
b1865fd fix(webhook,voice,email): resolve 3 BugBot findings on PR #834
7104c70 fix(dashboard,voice): resolve 2 BugBot findings on PR #834
e6a6f88 fix(account): show voice plan labels in billing settings
d927097 fix(plan): voice.enabled reflects backend readiness, not just the flag
0adfb29 fix(voice): refund consumed credit on any post-consume failure
```

---

## What this merge introduces (high level)

1. **Voice mock interview** — `voice-interview.html`, `js/voice-interview.js`, `/api/voice/*` endpoints, scorecard lib, session lifecycle.
2. **Entitlements & billing** — Stripe webhook/plan changes, `voice-entitlements.js`, migration `020_add_voice_entitlements.sql`, new pricing surfaces (`pricing.html`, `app/functions/pricing.js`).
3. **Marketing repositioning** — 10 programmatic role pages, llms.txt, sitemap/robots updates, signup preview gates on free tools.
4. **Analytics funnel** — GA4 events, cross-domain linker, single-tag cleanup.
5. **Background worker** — `workers/voice-followup-email/` (48h follow-up emails; gated by `VOICE_INTERVIEW_ENABLED`).
6. **Free-tool access model** — Logged-out preview + signup gate on mock interview, interview questions, resume feedback, cover letter.

**Feature flag:** `VOICE_INTERVIEW_ENABLED` (Pages/Worker env var). When `false`, voice APIs return 404 and UI CTAs stay hidden; other repositioning UI may still ship.

---

## Rollback option A — Revert the merge commit (preferred if already pushed)

Use when `dev0` history must stay linear and the merge commit is on the remote.

```bash
git checkout dev0
git pull origin dev0

# Reverts the merge; -m 1 keeps the pre-merge dev0 parent
git revert -m 1 0e76e8144ac06e86d845e979ca99571f21a0d72b

git push origin dev0
```

Then redeploy **jobhackai-site-dev** (and any other env that picked up `dev0`) from the reverted tip.

**Also revert this doc commit** if you added it after the merge:

```bash
git revert <commit-sha-of-this-doc>   # optional cleanup
```

---

## Rollback option B — Hard reset `dev0` to pre-merge (local / unpushed only)

Use only if the merge **has not been pushed**, or the team agrees to force-push `dev0` (avoid on shared branches unless coordinated).

```bash
git checkout dev0
git reset --hard e9597d3c9e1b8f185afbd3212b48776c68ceeb53
# If already pushed and team approves:
# git push --force-with-lease origin dev0
```

Restores `dev0` exactly to state before this merge. The feature branch `claude/vibrant-ritchie-s82b22` remains unchanged on GitHub.

---

## Rollback option C — Keep code, disable voice in production

Fastest **operational** kill switch without a git revert:

1. Set **`VOICE_INTERVIEW_ENABLED=false`** on Cloudflare Pages (dev/qa/prod as needed).
2. Set **`VOICE_INTERVIEW_ENABLED=false`** on the `voice-followup-email` worker (`workers/voice-followup-email/wrangler.toml` per env).
3. Redeploy Pages + worker.

Voice sessions stop; prep tools and marketing changes remain. See `docs/jobhackai-pr-sequence.md` runbook step 10.

---

## Infrastructure rollback checklist (do not skip if reverting fully)

These are **not** undone by `git revert` alone:

| Area | Action if rolling back |
|------|----------------------|
| **D1 migration 020** | Adds columns on `users`, `stripe_event_log`, `voice_sessions`. SQLite has no `DROP COLUMN`. Leaving schema in place is usually safe if code is reverted. Do **not** re-run migration 020 after revert. |
| **Stripe products/prices** | New voice plans may exist in Stripe test/live. Archive or deactivate in Stripe Dashboard if no longer sold. |
| **Cloudflare Worker** | `workers/voice-followup-email` — undeploy or disable cron if reverting voice entirely. |
| **Pages env vars** | `VOICE_INTERVIEW_ENABLED`, any new Stripe price IDs referenced in webhook/checkout code. |
| **Marketing deploy** | Separate Pages project (`jobhackai.io`) may need its own redeploy from reverted `dev0` or `main`. |
| **User data** | Rows in `voice_sessions` and updated `users.voice_*` columns remain after code revert; acceptable for rollback. |

---

## Verify rollback succeeded

```bash
# dev0 should not contain voice-interview.html at tip (after full revert)
git show dev0:voice-interview.html   # should fail after revert

# Pre-merge dashboard should match
git diff e9597d3c9e1b8f185afbd3212b48776c68ceeb53 dev0 -- dashboard.html
```

Smoke-test on **dev.jobhackai.io** after redeploy:

- Mock interview loads without voice CTAs (if flag off or full revert).
- Login / plan / existing prep tools unchanged.
- No `/api/voice/*` 500s (404 when flag off is expected).

---

## Restore feature branch work later

The source branch is preserved:

```bash
git checkout claude/vibrant-ritchie-s82b22
# or cherry-pick individual commits onto a new branch from e9597d3
```

---

## Related docs

- `docs/jobhackai-repositioning-brief.md` — product scope
- `docs/jobhackai-pr-sequence.md` — PR order, acceptance criteria, launch runbook
- `app/db/migrations/020_add_voice_entitlements.sql` — schema changes

---

*Delete this file after a successful launch or once rollback is no longer needed.*
