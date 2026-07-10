# Canonical Pricing Approval Record

Date: July 10, 2026

Owner: Sebastian LaRosa

Repository: `dlarosa92/jobhackai-site`

Approved source document: `docs/jobhackai_canonical_pricing_2026.md`

Source document version: 1.0

Source document commit on `dev0`: `7f03ea8e568016751950f2a53874972ddb6bf43c`

Implementation branch: `feature/canonical-pricing-2026`

## Owner approval

The owner approved the canonical JobHackAI pricing and commercial rules without amendments.

The approved launch model is:

1. Free Account at $0 with one lifetime voice interview and a partial report.
2. Interview Sprint at $19 one time with five voice interviews valid for seven days.
3. Pro Monthly at $39 per month with thirty voice interviews per Stripe billing cycle.

The word `unlimited` will not be used for voice interview allowances.

## Retired offers for new customers

1. Weekly Pass at $17 per week.
2. Monthly at $34 per month.
3. Interview Pack at $39 for five sessions valid for ninety days.
4. Essential at $29 per month.
5. Pro at $59 per month.
6. Premium at $99 per month.
7. The three day card required trial.

## Mandatory branch policy

`dev0` is the sole parent branch for all new JobHackAI feature, fix, documentation, migration, and implementation branches.

Rules:

1. Every new working branch must be created from the current approved `dev0` head.
2. No working branch may be created from `develop` or `main`.
3. Pull requests for implementation work must target `dev0` unless the owner explicitly authorizes a different promotion step.
4. `develop` and `main` are promotion branches, not development starting points.
5. Before creating a new branch, the agent or developer must verify and record the `dev0` starting commit.
6. If `dev0` changes while a feature branch is active, the branch must be synchronized from `dev0` before final review.
7. No agent may merge `develop` or `main` into a feature branch merely to resolve drift without first documenting the unique commits and obtaining owner approval.

## Authority

The approved canonical pricing document and this approval record are now the commercial and branching sources of truth for the pricing implementation.

Older pricing documents remain historical records only.

## Implementation boundary

This approval authorizes implementation work on branches created from `dev0`.

It does not authorize production deployment, live Stripe changes, production database migration, customer repricing, publication of revised legal terms, or enabling the production voice feature flag without a separate owner controlled launch decision.
