Merge `dev0` → `develop` to sync development changes to QA.

Pre-merge checklist (ensure completed before merging):
- [ ] D1 migrations applied on QA (007_add_plan_to_users, others in `app/db/migrations/`).
- [ ] Environment variables verified in Cloudflare Pages for QA (Firebase, Stripe, LinkedIn secrets, OPENAI keys).
- [ ] Stripe webhook configured for `https://qa.jobhackai.io/api/stripe-webhook`.
- [ ] Smoke tests: API health, auth/login/email flows, LinkedIn sign-in, Stripe checkout.

Post-merge actions:
- Build & deploy to QA: `cd app && npm install && npm run build && npm run deploy:qa`.
- Run smoke tests and verify endpoints.

Notes: D1 migrations were applied to QA (confirmed) — verify `PRAGMA table_info(users);` shows `plan` and subscription columns.

Automated by developer request.
