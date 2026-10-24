# Gmail dashboard relay

The existing Google Apps Script belongs to the business mailbox owner. Keep the existing project, secret, label and five-minute trigger. `Code.gs` synchronizes metadata for conversations selected by `0: JobHackAI / Track` plus every verified outbound thread returned by the signed dashboard feed. Missing labels cannot hide a recorded outbound conversation. The feed includes native thread IDs from exact sender receipts and legacy saved sent receipts; draft links never count. The combined scan is bounded to 200 conversations and fails without replacing the last successful snapshot if incomplete. `Outreach.gs` adds independent lead history checks and an optional guarded sender.

## Initial read-only installation

These initial-installation steps are not rollback instructions for an already approved sender. On an existing installation, preserve current owner-authorized permissions and flags. Reconcile the authorization receipt before any permission change; runtime enabled status alone never authorizes an email. See the [current operating guide](../OPERATING-GUIDE.md).

1. Apply dashboard D1 migration `003-outreach-gate.sql`, then deploy the dashboard and ingestion Workers from the same reviewed source. Keep `OUTREACH_SENDER_ENABLED=false` on **both** Workers.
2. In the existing Apps Script project, update `Code.gs`, add `Outreach.gs` and keep `appsscript.json`. The normal manifest still requests `gmail.readonly`, external requests and trigger management. No new trigger is needed.
3. Keep existing Script Properties `SYNC_URL` (HTTPS, ending `/sync`), `SYNC_SECRET` (at least 32 characters), `MAILBOX_EMAIL` and optional `TRACK_LABEL_NAME`. Set `OUTREACH_CHECKS_ENABLED=true`. Keep `OUTREACH_SEND_ENABLED` absent or `false`. Do not print secrets or include them in screenshots.
4. Run `syncTrackedMail` once. Verify a successful Google execution and a fresh dashboard timestamp. An ordinary five-minute trigger then checks both tracked conversations and submitted outreach packets.

Tracked-thread reads remain metadata only. Outreach checks use full Gmail messages for the candidate's entire history, including Spam and Trash, to detect earlier sends, drafts, replies and delivery reports outside the original thread. Bodies are parsed inside Google; only native IDs, dates and classifications go to the private dashboard. The dashboard separately stores the owner-submitted exact proposed email. Global delivery-report discovery covers the last 60 days; candidate-specific history is not date-limited. Pagination must complete and scans over 200 matches hold for individual review. A scan failure never means clean history.

`syncTrackedMail` owns the existing script lock. Do not add a separate trigger for `syncOutreach`. Removing the existing trigger stops the relay. Revoking Google access stops Gmail reads. Active triggers provide Google failure notifications.

## Optional sender activation

This is a separate access change. Do not silently replace the normal manifest or enable sending during the read-only upgrade.

After the mailbox owner approves adding Gmail **send** access, replace the manifest with `appsscript.sender.json`, authorize that scope in Google, set Script Property `OUTREACH_SEND_ENABLED=true`, and explicitly set `OUTREACH_SENDER_ENABLED=true` on both Workers. Verify the relay reports its enabled state before presenting an executable send button. The manifest grants no Gmail modify/delete scope.

The owner reviews complete To/subject/plain text/HTML and source evidence, then chooses **Approve exact email**. Approval does not send. **Send approved email** queues that same revision. The relay immediately repeats all-folder history; the server repeats DNS and atomically reserves one attempt. It sends MIME built from the immutable approved packet, not an editable Gmail draft. Extra recipients, attachments and arbitrary headers are unsupported. Changing recipient, copy or thread invalidates approval. Queued mail can be cancelled only before an attempt is reserved.

A send is marked verified only after reading the native `SENT` message and matching its complete envelope, copy and subject. Identity must match the exact native ID/thread returned by the reserved Gmail send, or the unique requested transport Message-ID. Gmail can replace the requested Message-ID. Immediately after Gmail returns, the script saves its native ID/thread in `OUTREACH_RECEIPT_<attemptId>` before verification or receipt upload. A later run uses those saved IDs for read-only reconciliation and clears them only after the server acknowledges the verified receipt. Timeout, mismatch or missing receipt leaves the attempt held; they never resend an attempted message. Received mail stops cold follow-ups and becomes an individual conversation review. A native failure remains suppressed even if its Gmail report is subsequently deleted. Clearing a suppression requires separate reviewed operational repair; no automatic release exists.

A fresh routing pass proves neither mailbox existence nor inbox delivery. The owner must still verify first-party contact evidence and current business relevance. The gate controls this dashboard path; it cannot prevent someone sending directly from Gmail or Marblism. Existing agent guidance must route new outreach through the gate and never treat an old generic approval as permission.

## Ingestion and release

`wrangler.gmail-sync.jsonc` defines the ingestion Worker with dashboard D1 only. Signed `POST /sync` receives tracked metadata. Signed `POST /outreach` serves the relay's poll/check/claim/receipt/delivery protocol. HMAC-SHA256 covers `timestamp + '.' + raw JSON`, using `X-Sync-Timestamp` and `X-Sync-Signature`; signatures expire after five minutes and bodies are bounded. There is no unsigned read, approval or send endpoint. Owner approval and queue endpoints remain behind dashboard Cloudflare Access and same-origin checks.

The existing dashboard Access policy, disabled dashboard workers.dev, mailbox and label identifiers remain private runtime configuration. Preserve all existing Worker secrets when deploying. Apply migrations only to **dashboard D1**, never the production payment/user database. Preserve legacy approvals and historical native receipts; pending generic email cards become holds until reconciled and prepared as exact unsent packets.

## Optional workflow labels (separate authorization)

The code supports label maintenance only when `OUTREACH_LABELS_ENABLED=true`. Keep this property absent/false until the owner separately approves Gmail label-edit access and completes Google authorization. All supplied OAuth manifests remain unchanged by this upgrade. Applying labels through the API requires Gmail modify permission, which is broader than labels alone; do not add it or enable the flag without explicit access approval.

Once authorized, reuse the existing `0: JobHackAI / Track`, `1: To respond` and `6: Awaiting reply` labels. Tracked threads and verified sends receive Track and exactly one status based on the latest non-draft message. Sending selects Awaiting reply; a newer incoming message selects To respond. Only the opposite managed status label is removed. Inbox, unread, importance, handled and unrelated labels remain intact. Missing labels or failed label writes produce a warning and do not hide metadata or invalidate a verified send. The next periodic run retries label updates only. No new trigger, archive, deletion, or filter is added.
