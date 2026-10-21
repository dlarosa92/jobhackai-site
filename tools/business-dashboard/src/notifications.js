import { digest, OWNER } from './outreach-policy.js';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const directoryId = new RegExp(`^directory-(${UUID})$`);
const receiptSubject = new RegExp(`^\\[JobHackAI Local\\] Directory request (${UUID})$`);
const fields = 'id, category, business_name, website, service_area, service_details, contact_email, review_status, created_at';

// Delivery retries update updated_at; they must not reopen a reviewed submission.
async function directoryItem(row) {
  const revision = await digest(row);
  return {
    id: `directory-${row.id}`, source: 'directory', channel: 'Directory', impact: 'prospect',
    state: row.review_status === 'closed' ? 'closed' : 'pending', notificationRevision: revision,
    title: `Directory request: ${row.business_name}`,
    detail: `Category: ${row.category}\nWebsite (submitted, not verified): ${row.website}\nService area: ${row.service_area}\nService details: ${row.service_details}\nContact email (submitted): ${row.contact_email}\nReference: ${row.id}`,
    updatedAt: row.created_at,
    evidence: `Saved directory submission. Editorial status: ${row.review_status}. Submitted information is untrusted and requires independent review. No listing or outreach is authorized.`,
    nextAction: row.review_status === 'closed' ? 'Closed in the directory source. No automatic listing or outreach.' : 'Review the submitted business details and contact address before any response or listing. Mark handled when finished; this does not publish a listing or send email.',
    reviewUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(OWNER)}#search/${encodeURIComponent(`"[JobHackAI Local] Directory request ${row.id}"`)}`,
  };
}

async function directoryRecords(env, now) {
  try {
    if (!env.PRODUCTION_DB) throw new Error('Missing source');
    const result = await env.PRODUCTION_DB.prepare(`SELECT ${fields} FROM directory_requests ORDER BY created_at DESC, id DESC LIMIT 201`).all();
    return {
      items: await Promise.all(result.results.slice(0, 200).map(directoryItem)),
      directorySource: { status: 'current', checkedAt: now.toISOString(), truncated: result.results.length > 200 },
    };
  } catch {
    // Keep other source records visible, but never claim an empty source is current.
    return { items: [], directorySource: { status: 'unavailable' } };
  }
}

function duplicateDirectoryRecord(item, ids) {
  if (item.source === 'gmail') {
    const id = receiptSubject.exec(item.title)?.[1];
    // Exact sender + subject only. A later business reply must remain visible.
    return ids.has(`directory-${id}`) && /^(?:JobHackAI\s*<noreply@jobhackai\.io>|noreply@jobhackai\.io)$/i.test(item.sender || '');
  }
  return ids.has(item.id.replace(/^local-request-/, 'directory-'));
}

async function applyResolutions(db, items) {
  // One bounded parameter and indexed lookups, independent of audit-history size.
  const keys = items.map(item => ({ id: item.id, revision: item.notificationRevision }));
  const rows = await db.prepare(`SELECT r.item_id, r.revision, r.handled_at FROM json_each(?) j
    JOIN board_resolutions r ON r.item_id=json_extract(j.value,'$.id') AND r.revision=json_extract(j.value,'$.revision')
    WHERE r.reopened_at IS NULL`).bind(JSON.stringify(keys)).all();
  const handled = new Map(rows.results.map(row => [`${row.item_id}:${row.revision}`, row.handled_at]));
  return items.map(item => {
    const at = handled.get(`${item.id}:${item.notificationRevision}`);
    return at ? { ...item, originalState: item.state, state: 'handled', handledAt: at,
      nextAction: 'Marked handled. A new message or changed submission returns to review. Reopen if more work is needed.' } : item;
  });
}

async function resolveNotification(env, input, action, now = new Date()) {
  if (!input || typeof input.id !== 'string' || typeof input.revision !== 'string') return false;
  const gmail = /^gmail-([a-f0-9]{1,64})$/.exec(input.id);
  const directory = directoryId.exec(input.id);
  if (gmail && /^[a-f0-9]{1,64}$/.test(input.revision)) {
    if (action === 'handle') {
      const result = await env.DASHBOARD_DB.prepare(`INSERT INTO board_resolutions(item_id,revision,handled_at,reopened_at)
        SELECT ?, ?, ?, NULL FROM gmail_threads WHERE thread_id=? AND last_message_id=? AND active=1
        ON CONFLICT(item_id,revision) DO UPDATE SET handled_at=CASE WHEN reopened_at IS NULL THEN handled_at ELSE excluded.handled_at END, reopened_at=NULL
        RETURNING item_id`).bind(input.id, input.revision, now.toISOString(), gmail[1], input.revision).first();
      return !!result;
    }
    const result = await env.DASHBOARD_DB.prepare(`UPDATE board_resolutions SET reopened_at=? WHERE item_id=? AND revision=?
      AND EXISTS(SELECT 1 FROM gmail_threads WHERE thread_id=? AND last_message_id=? AND active=1) RETURNING item_id`)
      .bind(now.toISOString(), input.id, input.revision, gmail[1], input.revision).first();
    return !!result;
  }
  if (!directory || !/^[a-f0-9]{64}$/.test(input.revision) || !env.PRODUCTION_DB) return false;
  const row = await env.PRODUCTION_DB.prepare(`SELECT ${fields} FROM directory_requests WHERE id=?`).bind(directory[1]).first();
  if (!row || (await directoryItem(row)).notificationRevision !== input.revision) return false;
  // Cross-database writes are deliberately restricted to the exact read revision.
  // If source content changes concurrently, this old revision cannot hide it.
  if (action === 'handle') {
    await env.DASHBOARD_DB.prepare(`INSERT INTO board_resolutions(item_id,revision,handled_at,reopened_at) VALUES(?,?,?,NULL)
      ON CONFLICT(item_id,revision) DO UPDATE SET handled_at=CASE WHEN reopened_at IS NULL THEN handled_at ELSE excluded.handled_at END, reopened_at=NULL`).bind(input.id, input.revision, now.toISOString()).run();
    return true;
  }
  return !!await env.DASHBOARD_DB.prepare('UPDATE board_resolutions SET reopened_at=? WHERE item_id=? AND revision=? RETURNING item_id')
    .bind(now.toISOString(), input.id, input.revision).first();
}

export { directoryRecords, duplicateDirectoryRecord, applyResolutions, resolveNotification };
