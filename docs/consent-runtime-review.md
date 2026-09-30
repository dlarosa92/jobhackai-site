# Clarity consent and private content

The previous withdrawal helper removed the script element and global function, which does not unload an executing tracker. The shared consent owner now stops Clarity directly and clears its `_clck` and `_clsk` cookies. Clarity stays stopped for the rest of that document, even after a later analytics grant. A fresh navigation with consent starts a new recording; GA resumes in the current document. This deliberately sacrifices replay continuity after a changed decision rather than restarting with uncertain vendor storage state.

Review found that the current Clarity SDK denial API can itself schedule an internal restart. We therefore do not invoke denial on an active SDK. Pending bootstrap queues retain only stop after withdrawal, and a load callback reinforces it. Stale identity calls are discarded and no new identity is queued while stopped. A known bootstrap whose external tag failed to download can retry on a new grant; a vendor runtime that has already taken over is never replaced.
The private interview, resume, cover-letter, LinkedIn, dashboard and account pages explicitly mask their body content. This also covers dynamically appended report text. Consent remains required before the first vendor script is inserted; nonproduction destinations still default off. The marketing copy of the script is generated from the app source.

## Sources checked September 20, 2026

- [Microsoft ConsentV2](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2): the two storage categories use `analytics_Storage` and `ad_Storage`. Denial can still leave cookieless tracking, so it is not used as a substitute for stopping the runtime.
- [Clarity SDK lifecycle](https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/clarity.ts) and [queue](https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/queue.ts): stop shuts down observers/modules; the stopped queue prioritizes start. [Metadata consent handling](https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/data/metadata.ts) also schedules a restart when active cookie tracking is denied.
- [Microsoft masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking): an explicit container mask covers its descendants and takes precedence over project defaults. Input-field masking alone is insufficient for generated text rendered elsewhere.

## Verification boundary

Tests verify analytics-only initial grant, direct stop without the restart-triggering denial command, no same-document restart, late loading, failed-download retry, and clearing stale queued identity, plus explicit masking on the ten private pages. These are application contract tests, not a simulation proving Microsoft's runtime or network receipt. Inspect the deployed browser requests and a new non-sensitive test recording before declaring in-session withdrawal and masking fully verified. A final vendor flush can contain previously collected events; distinguish it from new post-withdrawal collection. Historical recordings are not retroactively masked, and none were inspected or deleted by this change.

Production deployment and public privacy/cookie text remain within the release hold. Existing cookie-policy anonymous wording, provider disclosure, and retention wording still need the separately tracked factual review.

## Isolated vendor verification

Created the existing-service project **JobHackAI QA**, public ID `yl6ysb5n74`, website `https://qa.jobhackai.io/`. Its Cookies default is Off, and no Google Analytics or ads account is connected. Production project `wskzma4clw` settings were inspected only. The QA project is not yet a default script destination: QA subdomain cookie isolation and real vendor stop/masking must be verified before enabling it. Use synthetic text on localhost for the initial vendor recording test, with production GA and Clarity explicitly disabled.

### Real vendor evidence, September 20

A localhost fixture using the actual candidate script and only QA project `yl6ysb5n74` loaded Clarity SDK **0.8.70** after an explicit grant. Before grant its visible diagnostic showed no Clarity resource. After grant the vendor runtime, its cookies and collector resource entries appeared. Withdrawal at fixture elapsed 57 seconds made the runtime inactive and removed both Clarity cookies. No newer collector entries appeared through elapsed 122 seconds, including after regrant; a final entry at withdrawal is treated as the SDK's flush of earlier events. A fresh navigation with the saved grant loaded a new active runtime and sent new collector requests.

Microsoft's QA project received the localhost live session. Its replay iframe showed the public control text readable while the private dummy heading and dynamically changed paragraph were replaced by mask glyphs. This verifies receipt and masking for the synthetic test in SDK 0.8.70, not historic production recordings or every device. Production Cookies is currently On, while QA is Off; production vendor defaults remain part of the held release configuration review. QA subdomain isolation is still unverified, so no QA default Clarity destination was added.
