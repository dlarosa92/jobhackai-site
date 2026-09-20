# QA marketing-to-app attribution

The existing develop Pages marketing alias has no local consent API and keeps analytics disabled. It is useful for content review, but cannot verify the marketing-to-app campaign journey required before release.

The QA marketing hostname is `qa-marketing.jobhackai.io`, paired with `qa.jobhackai.io`. Only those two exact hosts opt into the existing QA GA stream G-VH888WWY3M. Marketing sends consent to the QA app; its navigation and blog CTAs also target QA. The host is explicitly noindex/nofollow and no-store. Arbitrary Pages previews remain off by default.

QA uses `jha_client_id_qa`, `jha_campaign_qa_v2`, and GA's `jha_qa` cookie prefix across the shared jobhackai.io cookie domain. Production retains its existing names and measurement destination. Dev uses its own host-only client cookie. Server consent and checkout attribution read only their configured environment's client cookie; conflicting duplicates are rejected as an identity source. This intentionally starts new anonymous QA/dev browser identities rather than copying production identities into testing. Existing authenticated account consent remains authoritative. Internal QA links preserve the external acquisition campaign.

## Hosting configuration and remaining evidence

On September 20, 2026, the hostname was associated with the existing marketing Pages project and its proxied CNAME set to `develop.jobhackai-app-marketing-seo.pages.dev`, TTL Auto. Cloudflare confirmed Active and SSL enabled. Existing production DNS records were not changed. QA app deployment `aeeb0b13-6946-4f08-868a-70ab498bc74b` and marketing deployment `a6b45b61-d976-40ce-b22d-f4f67c86e562` both succeeded at revision `796ee4a`. HTTPS returned 200 with `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

The real browser journey used campaign `qa_cross_site_20260920_1044`, source `linkedin`, medium `organic_social`, and content `qa_blog_link_01`. Before grant the article had zero Google tags; after grant it loaded exactly the QA tag. Its practice CTA opened QA pricing. Google DebugView in property `502443078` received both page views with the same session ID, plus one blog CTA view and click. Expanded parameters confirmed the original campaign tags and article asset `tell_me_about_yourself_blog_01`, business line `career_product`.

Withdrawal through QA Cookie Preferences persisted to QA D1. Fresh marketing navigation and reload loaded zero Google tags, and the QA diagnostic page showed analytics consent false with no tag or Google command function. The consent API's preflight allowed the exact QA marketing origin with credentials. No synthetic signup or purchase was emitted. This proves browser delivery, cross-site session continuity and withdrawal behavior; it does not prove paid attribution, processed revenue reports, or production collection.

Browser review found one inline footer Blog link still targeting production after hydration. The navigation follow-up keeps absolute marketing links on the current QA marketing host while preserving their path, query and fragment. Reverify that link after this follow-up is deployed. Static fallback markup still contains canonical production destinations before JavaScript runs.

Cloudflare documents this [custom branch alias flow](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/). The dashboard may require a different sequence than the documentation; inspect the actual offered fields and verify branch routing afterward. An unproxied record routes to production and is not acceptable for this QA host.

Server purchase/refund/renewal receipt still requires the pending owner-entered QA Measurement Protocol secret. Authenticated checkout and natural voice acceptance still need the existing QA sign-in/retest gates. No production collection, release, public post, or prospect contact is authorized by this setup.

Review follow-up: the former QA campaign cookie is explicitly expired at both host and parent-domain scope before using the new v2 name. A scoped-cookie regression covers rejection/re-consent without stale campaign resurrection. Consent GET and POST now reject ambiguous selected-environment cookies rather than allowing a body identifier to override them.
