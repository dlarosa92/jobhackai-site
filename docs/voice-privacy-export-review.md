# Voice and campaign data export

The authenticated account export omitted voice sessions and consent-owned checkout attribution. It now includes the verified account's voice inputs, stored transcript/feedback, checkout campaign context and Analytics delivery state. It does not apply the commercial report paywall or hide still-retained expired records from a privacy export. It does not restore already-deleted records or treat delivery acceptance as Google receipt.

All new reads use the user ID resolved from the verified Firebase identity, not a request parameter. An inner join through that account's checkout attribution scopes delivery records. Internal model cost, credentials, delivery event keys and Stripe customer IDs are not added. Schema omissions are listed in `unavailableSections`; database failures return a generic error instead of a successful partial export or internal error details.

Five tests run the actual handler with stubbed token verification and a real SQLite database using migrations020/021/024–027. They cover a free owner with an expired-but-still-stored session, a second user's private records, missing/invalid authentication, absent schema, database failure, deletion/revocation cascades and retained financial records. They do not validate live Firebase or a signed-in browser download; that remains a QA check after deployment.

## Related release checks still open

- Privacy and Help's blanket90-day deletion claims omit pinned LinkedIn runs, reused resumes and the latest expired voice metadata exception. Retention worker deployment and deletion execution require separate evidence; QA audit mode does not fulfill deletion.
- Existing Help says Cloudflare storage is US-based without evidence of every service's placement. [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/configuration/data-location/) distinguishes jurisdiction from location hints; a D1 choice alone does not establish residence for all service providers.
- Voice audio goes directly from the browser to OpenAI over WebRTC. Stored voice data includes text transcript, feedback, role/job context and session metadata. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) describe API training defaults and separate provider retention; no account-specific zero-retention setting has been verified.
- Cookie policy currently calls Analytics anonymous even though consented Firebase/browser identifiers and campaign-to-payment joins exist; Microsoft Clarity also needs disclosure. Update the factual description and validate project settings before publication.
- Voice and typed interview pages lack explicit `data-clarity-mask` protection for rendered report text. [Microsoft's masking documentation](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking) distinguishes input masking from rendered text and supports masking a container and its children. Current remote masking settings and actual recordings have not been inspected. Do not claim an exposure occurred or that all private output is already protected.
- The existing Clarity revocation helper removes the script element and global function. That alone does not prove an already-loaded vendor runtime stops. Verify the supported stop/consent behavior and actual browser requests before treating in-session withdrawal as complete.

These findings are launch work, not a claim of legal certification. Production/public policy changes remain within the existing release hold.
