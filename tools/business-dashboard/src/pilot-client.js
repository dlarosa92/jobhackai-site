(() => {
  'use strict';
  const root = document.getElementById('pilot');
  if (!root) return;
  const form = document.getElementById('pilot-form');
  const status = document.getElementById('pilot-status');
  const preview = document.getElementById('pilot-preview');
  const apply = document.getElementById('pilot-apply');
  const list = document.getElementById('pilot-accounts');
  let prepared = null, loading = false, requestNumber = 0;
  const time = value => value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')) : 'No retained activity';
  const element = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  async function api(body) {
    const response = await fetch('/api/pilot', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Pilot data unavailable.');
    return data;
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const data = await api();
      const participants = data.items.filter(item => item.role === 'participant').length;
      const specialists = data.items.filter(item => item.role === 'specialist').length;
      document.getElementById('pilot-summary').textContent = `${participants} of ${data.capacity.participant} participants · ${specialists} of ${data.capacity.specialist} specialists · Checked ${time(data.checkedAt)} Eastern`;
      document.getElementById('pilot-note').textContent = data.note;
      list.replaceChildren();
      if (!data.items.length) list.append(element('p', 'No accounts have been enrolled through this pilot tool. Previously granted credits are not automatically imported.'));
      for (const item of data.items) {
        const card = element('article', undefined, 'pilot-account');
        card.append(element('h3', item.email), element('p', `${item.role === 'specialist' ? 'Specialist' : 'Participant'} · ${item.status.replaceAll('_', ' ')}`));
        const details = element('dl');
        const values = [ ['Granted credits', item.granted], ['Used credits', item.usedCredits ?? 'Needs review'], ['Available credits', item.remaining ?? 'Needs review'], ['Unused lifetime free interview', item.freeSessionAvailable ? 'Yes, separate from granted credits' : 'No'], ['Retained starts', item.retainedStarts], ['Retained completions', item.retainedCompletions], ['Access expires', time(item.expiresAt) + ' Eastern'], ['Last retained activity', time(item.lastActivity)] ];
        for (const [label, value] of values) details.append(element('dt', label), element('dd', String(value)));
        if (item.status === 'review_access') card.append(element('p', 'Account access changed after enrollment. Reconcile billing, expiry and credit balance before relying on the remaining allowance.', 'error'));
        card.append(details); list.append(card);
      }
    } catch (error) {
      document.getElementById('pilot-summary').textContent = error.message;
      list.replaceChildren(element('p', 'Current pilot data is unavailable. No zero usage or enrollment is implied.'));
    } finally { loading = false; }
  }
  form.addEventListener('input', () => { requestNumber++; prepared = null; apply.disabled = true; preview.replaceChildren(); document.getElementById('pilot-confirm').checked = false; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const thisRequest = ++requestNumber;
    prepared = null; apply.disabled = true;
    const input = new FormData(form);
    let payload;
    try {
      payload = { id: input.get('grantId').trim(), cohortId: 'brighton-2026-11', email: input.get('email'), role: input.get('role'), startsAt: new Date(input.get('startsAt')).toISOString(), expiresAt: new Date(input.get('expiresAt')).toISOString(), dryRun: true };
      status.textContent = 'Checking the account and access details…';
      const data = await api(payload);
      if (thisRequest !== requestNumber) return;
      prepared = { ...payload, expectedRevision: data.expectedRevision };
      preview.replaceChildren(element('p', `${data.account.email}: ${data.grant.credits} complimentary credits. Access from ${time(data.grant.startsAt)} through ${time(data.grant.expiresAt)} Eastern.`), element('p', data.note));
      if (data.account.freeSessionAvailable) preview.append(element('p', 'This account also has its separate lifetime free interview. This grants 60 credits; it does not impose a hard total cap of 60 sessions.'));
      status.textContent = data.alreadyApplied ? 'This exact enrollment was already applied. No additional credits will be granted.' : data.canApplyNow ? 'Preview only. Confirm the account identity below to apply this grant.' : 'The start date is in the future. Apply on the agreed start date; no future activation has been scheduled.';
      apply.disabled = data.alreadyApplied || !data.canApplyNow;
    } catch (error) { if (thisRequest === requestNumber) status.textContent = error.message; }
  });
  apply.addEventListener('click', async () => {
    if (!prepared) return;
    if (!document.getElementById('pilot-confirm').checked) { status.textContent = 'Confirm that this is the intended person’s own account before applying.'; return; }
    apply.disabled = true;
    try {
      const data = await api({ ...prepared, dryRun: false, confirmAccountOwner: true });
      status.textContent = data.duplicate ? 'This grant was already applied. No duplicate credits were added.' : '60 complimentary credits granted. Stripe and payment history were not changed.';
      prepared = null; await refresh();
    } catch (error) { status.textContent = error.message + ' Preview again before retrying.'; prepared = null; }
  });
  document.getElementById('pilot-refresh').addEventListener('click', refresh);
  document.getElementById('refresh')?.addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
})();
