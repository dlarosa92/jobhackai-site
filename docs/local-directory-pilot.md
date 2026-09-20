# Northern Kentucky and Cincinnati directory pilot

Owner-confirmed outcome: a directory website experiment on existing JobHackAI infrastructure, with one researched category, public browsing, individual provider pages, a Get listed entry point and measurable contact interest. Voice and career-product campaigns remain separate. Production and public promotion remain held.

## Current prototype

Mobile detailing is the working category for the prototype, not a validated commercial conclusion. Six providers publish useful comparison information. The directory emphasizes differences in package scope and water/power requirements rather than unsupported rankings or a cheapest-first list. Each listing links to its first-party source and records the check date in `marketing/data/directory/mobile-detailing.json`. Published starting prices are not quotes or like-for-like comparisons.

The hub is `/directory`, provider pages are `/directory/mobile-detailing/<slug>`, and `/directory/get-listed` opens a prefilled email to the site's existing support address. An email click is explicitly not a submitted lead. No outgoing message has been sent in testing. Listings are alphabetical, unpaid and have no fabricated reviews or service-quality endorsements.

Run `node marketing/scripts/build-directory.mjs` after changing the source data. It generates the checked-in HTML. Cloudflare Pages resolves extensionless provider URLs from `.html` files, as with the existing blog. No new platform or authentication is needed.

All pages currently carry `noindex, nofollow`; there are no homepage navigation or sitemap changes. This is a preview for category, content and interaction validation. The production launch review must explicitly change the indexing state and add approved discovery links.

## Measurement contract and remaining integration

Directory JS uses only the existing site's consent-owned helper when it is available. It never creates its own identifier, storage or third-party tracker. The prototype does not yet include the shared consent loader, so **it currently sends no Analytics events**. Connecting and testing that loader against the exact candidate deployment is required before launch. Do not report tracking as operational merely because these event hooks exist.

- `directory_listing_view`: individual provider page viewed with consent; `listing_id` is the public slug.
- `directory_contact_click`: outbound provider website click. This measures intent, not a quote request, booking or sale.
- `directory_interest_click`: email composer link clicked, classified as listing request or correction. Submission/receipt must be reconciled with the actual inbox separately.
- Every event includes `business_line=local_directory`, `directory_category=mobile_detailing`, `directory_market=nky_cincinnati`. External campaign IDs must be distinct from `voice_beta_2026_09`; internal directory links must not overwrite campaign attribution.

Do not claim visibility into a provider's sales from outbound clicks. Provider-confirmed bookings and any future paid placement invoices need their own evidence and accounting.

## Observed local browser checks, September 20, 2026

- Hub renders six listings without sign-in; water/power filter narrows to the one provider whose reviewed source says both are supplied.
- Combining that filter with Boat returns the explicit empty state. Reset restores all six.
- Provider link opens the intended detail page with source, check date, separate package scopes and outbound provider link.
- Get listed opens the intended instructions page with the correct prefilled `mailto:` destination; no email was sent.
- Desktop layout visually inspected. Narrow-screen browser verification and keyboard/assistive-technology checks remain pending.

## Research and launch gates

Still required: compare local search intent and competition with at least one alternative category; record evidence without inventing search volume or demand. Confirm the most decision-relevant unknowns with public first-party information where possible. Do not contact providers or publish implied partnerships under the current hold.

Before promoting: settle the first category, finish mobile/accessibility QA, connect and observe consent-aware event delivery, verify support intake and truthful lead reporting, and make the release and indexing changes reviewable. Traffic, leads, customers and revenue currently remain unavailable, not zero or forecast results.
