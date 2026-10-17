# Tracked Gmail sync installation

This standalone Google Apps Script is owned by the mailbox owner. It reads only threads selected by the exact Gmail label `0: JobHackAI / Track`. Google authorization grants mailbox-wide **read-only** Gmail API access; code restricts reads to the selected threads. It cannot send, modify, label, archive, or delete mail.

## One-time installation

1. Create a standalone project at https://script.google.com/ under the intended Google account.
2. Paste `Code.gs` into its code file. In Project Settings, enable **Show appsscript.json manifest file in editor**, then replace the manifest with this directory's `appsscript.json`. Gmail API v1 is enabled by that manifest; use the default Google Cloud project.
3. In Project Settings → Script Properties, add `SYNC_URL` (the deployed ingestion Worker's HTTPS URL ending in `/sync`), `SYNC_SECRET` (a random secret of at least 32 characters identical to the Worker's secret), and `MAILBOX_EMAIL` (the mailbox owner's exact email). Optional `TRACK_LABEL_NAME` defaults to `0: JobHackAI / Track`. Keep secrets out of Git, screenshots, logs and chat.
4. Run **installGmailSync** and authorize the stated permissions in Google. The first full scan must succeed before the recurring trigger is installed. Rerunning installation retains one trigger for the sync handler.
5. Verify the execution reports a completed sync and the dashboard shows a fresh Gmail timestamp. Confirm a latest sent conversation is waiting for its recipient.

## Behavior

- Runs approximately every five minutes on Google, even when the owner's computer is off.
- Lists all labelled threads, then reads message metadata from each complete thread; a reply does not need a separate label. Drafts never count as sent replies.
- Last non-draft message has Gmail's `SENT` label → waiting for the recipient. Otherwise → needs review. Receiving an email does not prove a reply is necessary; the owner decides after reading it.
- Uploads only thread/message IDs, sender, subject, short Gmail preview, status, timestamps and the selected label identifier. No bodies or attachments are retrieved or sent.
- At most 200 selected conversations per scan. Pagination and all reads must finish before uploading. Missing labels, authorization problems, quotas, excess selected threads or rejected uploads fail the run and preserve dashboard data. Active Apps Script triggers provide failure notifications.
- A successful scan after a label is removed retires that conversation from the board. Stored customer/prospect classification is preserved for later relabelling.
- Remove the trigger to stop sync; revoke Google access to stop Gmail reads. Rotate the ingestion secret in both locations if needed.

The dashboard warns when no scan has succeeded or the last successful scan is over 15 minutes old. Refresh reloads the stored scan; it does not force a Google execution.

## Ingestion deployment

Build with `npm run build` in the parent directory. Deploy `gmail-ingest.bundle.js` as `jobhackai-dashboard-gmail-sync` using `wrangler.gmail-sync.jsonc`. Its sole interface is signed `POST /sync`; it has only dashboard D1. Set Worker variables `MAILBOX_EMAIL` and `TRACK_LABEL_ID` to the verified mailbox and label ID, and secret `SYNC_SECRET` to the shared random secret. The main dashboard retains Cloudflare Access. This separate endpoint requires HMAC-SHA256 over `timestamp + '.' + raw JSON body`, in `X-Sync-Timestamp` and `X-Sync-Signature` headers. Signatures expire after five minutes. It has no read or approval endpoint.

Apply migration `002-gmail-sync.sql` once to existing dashboard D1 before deploying the new dashboard Worker. Fresh databases use `schema.sql`. Link existing manual email cards' `gmail_thread_id` to verified private thread IDs with bound parameters; duplicates hide only after the first successful sync. Do not commit real thread IDs, contact data, keys or setup files to this public repository.
