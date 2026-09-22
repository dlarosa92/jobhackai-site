# Directory-only staging promotion

Owner authorizes the separate directory release. This changes directory API
modules only; voice production remains held. Isolated marketing candidate PR947
uses explicit directory-dev and directory-qa aliases mapped to canonical dev/QA
APIs. Unknown and cross-environment origins fail closed. Existing DEV notification
payloads and idempotency keys remain unchanged for safe recovery.

12 handler tests plus8 form/consent-event tests pass. Dedicated preview checks
follow deployment. The general E2E suite targets the already-deployed base and can
mutate unrelated billing fixtures; it is skipped for this promotion.
