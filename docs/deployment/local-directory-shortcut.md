# Local directory navigation and shortcut

JobHackAI's interview homepage stays at https://jobhackai.io/.
The public desktop and mobile navigation includes Local directory, and the
shared marketing footer includes a clickable JobHackAI logo and directory link.

## Cloudflare shortcut

After the approved navigation candidate passes dev0, develop/QA and main
checks, configure this independent hostname redirect in the jobhackai.io zone.
Do not move or duplicate directory content, or modify the existing www and
campaign redirect rules.

- DNS: proxied A record `local.jobhackai.io` pointing to `192.0.2.0`, TTL auto.
  This is Cloudflare's documented reserved placeholder for an originless redirect.
- Phase: `http_request_dynamic_redirect`.
- Rule reference: `local_directory_shortcut`.
- Match: `(http.host eq "local.jobhackai.io")`.
- Action: redirect, status 301, target `https://jobhackai.io/directory/`.
- Preserve query string: true, so campaign tags survive the shortcut.
- Scope: every request to this shortcut lands on the directory homepage.
  Existing provider links continue to use their full jobhackai.io/directory URLs.

Install the rule before publishing its DNS record. Verify HTTP and HTTPS,
query preservation, a final 200 response, and that the apex homepage is unchanged.
Read back the rule and DNS IDs into the release evidence. To roll back, remove
only this DNS record and this rule by those IDs; preserve all other zone rules.

References:
- https://developers.cloudflare.com/rules/url-forwarding/single-redirects/
- https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/#originless-setups
