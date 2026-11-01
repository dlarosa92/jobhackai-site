# Local analytics

GA4 and Clarity remain enabled for consenting production visitors to JobHackAI Local. The production destinations are GA4 `G-SQYSWPFM5X` and Clarity `wskzma4clw`. Consent denial and nonproduction isolation still apply.

The September directory-specific default that blanked the Clarity project is superseded. Protect private listing-request fields and the resulting confirmation with `data-clarity-mask` before loading the SDK. Do not disable replay across the directory to protect one form. The public directory cards, category navigation and provider handoffs remain measurable. No form field values are added to analytics events.

The directory uses `marketing/directory/consent.js`; the main application uses `js/cookie-consent.js`. Directory generators must reference the directory module. Regression checks cover both providers after consent, denial, nonproduction isolation, masking, stale consent and repeat grants.

Development and QA use their own analytics settings. Verify the accepted source at each stage and the production network receipts after promotion. Loading a tag alone is not proof of event delivery or a recorded session in a provider report.
