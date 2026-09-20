# Clarity consent and private content

The previous withdrawal helper removed the script element and global function. That does not unload an executing tracker. The shared consent owner now tells Clarity to deny both storage categories and stop its runtime. A later analytics grant restarts that same runtime, with advertising storage denied. Queued identity/control calls from the previous decision are discarded. A load callback reapplies a withdrawal if the script finishes late.

The private interview, resume, cover-letter, LinkedIn, dashboard and account pages explicitly mask their body content. This also covers dynamically appended report text. Consent remains required before the first vendor script is inserted; nonproduction destinations still default off. The marketing copy of the script is generated from the app source.

## Sources checked September 20, 2026

- [Microsoft ConsentV2](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2): the two storage categories use `analytics_Storage` and `ad_Storage`. Denial can still leave cookieless tracking, so it is not used as a substitute for stopping the runtime.
- [Clarity SDK lifecycle](https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/clarity.ts) and [queue](https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/queue.ts): stop shuts down observers/modules; start reprocesses the stopped queue.
- [Microsoft masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking): an explicit container mask covers its descendants and takes precedence over project defaults. Input-field masking alone is insufficient for generated text rendered elsewhere.

## Verification boundary

Tests verify analytics-only grant, denial/stop ordering, same-script restart, late loading and clearing stale queued identity, plus explicit masking on the ten private pages. These are application contract tests, not a simulation proving Microsoft's runtime or network receipt. Inspect the deployed browser requests and a new non-sensitive test recording before declaring in-session withdrawal and masking fully verified. A final vendor flush can contain previously collected events; distinguish it from new post-withdrawal collection. Historical recordings are not retroactively masked, and none were inspected or deleted by this change.

Production deployment and public privacy/cookie text remain within the release hold. Existing cookie-policy anonymous wording, provider disclosure, and retention wording still need the separately tracked factual review.
