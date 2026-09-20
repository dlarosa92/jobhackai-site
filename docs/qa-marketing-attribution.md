# QA marketing-to-app attribution

The existing develop Pages marketing alias has no local consent API and keeps analytics disabled. It is useful for content review, but cannot verify the marketing-to-app campaign journey required before release.

The proposed QA marketing hostname is `qa-marketing.jobhackai.io`, paired with `qa.jobhackai.io`. Only those two exact hosts opt into the existing QA GA stream G-VH888WWY3M. Marketing sends consent to the QA app; its navigation and blog CTAs also target QA. The new host is explicitly noindex/nofollow and no-store. Arbitrary Pages previews remain off by default.

QA uses `jha_client_id_qa`, `jha_campaign_qa_v2`, and GA's `jha_qa` cookie prefix across the shared jobhackai.io cookie domain. Production retains its existing names and measurement destination. Dev uses its own host-only client cookie. Server consent and checkout attribution read only their configured environment's client cookie; conflicting duplicates are rejected as an identity source. This intentionally starts new anonymous QA/dev browser identities rather than copying production identities into testing. Existing authenticated account consent remains authoritative. Internal QA links preserve the external acquisition campaign.

## Hosting configuration and remaining evidence

No custom domain or DNS record has been created for this change yet. After review and QA promotion, associate the new hostname with the existing marketing Pages project and route its proxied CNAME to `develop.jobhackai-app-marketing-seo.pages.dev`. Verify the actual served revision, QA links, response noindex header, consent API receipt, grant/reject/reload behavior, and GA DebugView events on both sites before calling this operational. Never change jobhackai.io or app.jobhackai.io routing.

Cloudflare documents this [custom branch alias flow](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/). The dashboard may require a different sequence than the documentation; inspect the actual offered fields and verify branch routing afterward. An unproxied record routes to production and is not acceptable for this QA host.

Server purchase/refund/renewal receipt still requires the pending owner-entered QA Measurement Protocol secret. Authenticated checkout and natural voice acceptance still need the existing QA sign-in/retest gates. No production collection, release, public post, or prospect contact is authorized by this setup.

Review follow-up: the former QA campaign cookie is explicitly expired at both host and parent-domain scope before using the new v2 name. A scoped-cookie regression covers rejection/re-consent without stale campaign resurrection. Consent GET and POST now reject ambiguous selected-environment cookies rather than allowing a body identifier to override them.
