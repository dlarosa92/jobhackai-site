const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
const time = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
let currentMonth = null;

function render(data) {
  currentMonth = data.month;
  $('checked').textContent = `Cloudflare numbers checked ${time(data.asOf)} ET`;
  $('month-label').textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.month}-01T12:00:00Z`));
  $('collected').textContent = money(data.netCollectedCents);
  $('users').textContent = data.d1UserRecords === null ? 'Unavailable' : data.d1UserRecords.toLocaleString();
  $('d1-status').textContent = `Read on ${time(data.asOf)} ET. Ledger is not reconciled against a fresh Stripe balance.`;
  $('basis').textContent = data.basis;
  if (data.costCents !== null) {
    $('costs').value = (data.costCents / 100).toFixed(2);
    $('complete').checked = data.costsComplete;
    $('cost-status').textContent = `${data.costsComplete ? 'Marked complete' : 'Recorded but incomplete'} · updated ${time(`${data.costUpdatedAt.replace(' ', 'T')}Z`)} ET`;
  }
  if (data.estimatedAvailableCents === null) {
    $('available').textContent = 'Actual: not yet verified';
    $('progress').textContent = 'Complete the cost total to estimate income';
    $('goal-fill').style.width = '0%';
  } else {
    $('available').textContent = `Estimated available: ${money(data.estimatedAvailableCents)}`;
    const pct = data.estimatedAvailableCents / data.incomeGoalCents * 100;
    $('progress').textContent = `${Math.max(0, pct).toFixed(0)}% of $3,000`;
    $('goal-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
  $('error').hidden = true;
}

const stateLabels = { pending: 'Needs review', waiting: 'Waiting for their reply', approved: 'Approved · awaiting action', sent: 'Sent', scheduled: 'Scheduled', published: 'Published', hold: 'On hold' };
const laneDefinitions = [
  { title: 'People waiting on us', matches: item => ['pending', 'hold'].includes(item.state) && item.impact !== 'campaign', first: true },
  { title: 'Waiting for their reply', matches: item => item.state === 'waiting', first: true },
  { title: 'Campaign decisions', matches: item => ['pending', 'hold'].includes(item.state) && item.impact === 'campaign' },
  { title: 'Approved and scheduled', matches: item => ['approved', 'scheduled'].includes(item.state) },
  { title: 'Recent outcomes', matches: item => ['sent', 'published'].includes(item.state) },
];

function renderCampaigns(data) {
  const board = $('board');
  board.replaceChildren();
  for (const laneDefinition of laneDefinitions) {
    const items = data.items.filter(laneDefinition.matches);
    const lane = document.createElement('div');
    lane.className = `lane${laneDefinition.first ? ' people-lane' : ''}`;
    const heading = document.createElement('div');
    heading.className = 'lane-heading';
    const title = document.createElement('h2');
    title.textContent = laneDefinition.title;
    const count = document.createElement('span');
    count.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    heading.append(title, count);
    lane.append(heading);
    for (const item of items) {
      const article = document.createElement('article');
      article.className = `item${item.impact === 'customer' ? ' customer-impact' : item.impact === 'prospect' ? ' prospect-impact' : item.state === 'pending' ? ' important' : ''}`;
      if (item.impact === 'customer' || item.impact === 'prospect') {
        const priority = document.createElement('span');
        priority.className = `priority-badge ${item.impact}`;
        priority.textContent = item.state === 'waiting' ? (item.impact === 'customer' ? 'Customer conversation' : 'Prospect conversation') : item.impact === 'customer' ? 'Customer directly affected · priority 1' : 'Inbound prospect · priority 2';
        article.append(priority);
      }
      const kicker = document.createElement('div');
      kicker.className = `kicker${item.state === 'hold' ? ' caution' : ''}${['sent', 'scheduled', 'published'].includes(item.state) ? ' good' : ''}`;
      const stateLabel = item.source === 'gmail' && item.state === 'pending' ? 'Needs your review' : item.impact !== 'campaign' && ['pending', 'hold'].includes(item.state) ? 'Needs reply' : stateLabels[item.state] || item.state;
      kicker.textContent = `${item.channel} · ${stateLabel}`;
      const name = document.createElement('h3');
      name.textContent = item.title;
      const detail = document.createElement('p');
      detail.textContent = item.detail;
      const evidence = document.createElement('p');
      evidence.className = 'evidence';
      evidence.textContent = item.source === 'gmail' ? `Latest ${item.state === 'waiting' ? 'sent' : 'received'} message ${time(item.updatedAt)} ET` : item.evidence;
      article.append(kicker, name, detail);
      if (item.nextAction) {
        const action = document.createElement('p');
        action.className = 'next-action';
        action.textContent = `Next: ${item.nextAction}`;
        article.append(action);
      }
      article.append(evidence);
      try {
        const reviewUrl = new URL(item.reviewUrl);
        if (reviewUrl.protocol === 'https:' && ['chatgpt.com', 'mail.google.com'].includes(reviewUrl.hostname)) {
          const link = document.createElement('a');
          link.href = reviewUrl.href;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = reviewUrl.hostname === 'mail.google.com' ? 'Open email thread ↗' : 'Open exact review record ↗';
          article.append(link);
        }
      } catch { /* An invalid review URL is omitted. */ }
      if (item.state === 'pending' && item.impact === 'campaign') {
        const approval = document.createElement('button');
        approval.type = 'button';
        approval.className = 'approve';
        approval.textContent = 'Record approval';
        approval.addEventListener('click', () => recordApproval(item, approval));
        article.append(approval);
      }
      lane.append(article);
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'lane-note';
      empty.textContent = 'Nothing in this lane.';
      lane.append(empty);
    }
    board.append(lane);
  }
  const waiting = data.items.filter(item => ['pending', 'hold'].includes(item.state) && item.impact !== 'campaign');
  const approvals = data.items.filter(item => item.state === 'pending' && item.impact === 'campaign');
  $('focus-text').textContent = waiting.length ? `${waiting[0].title}. ${waiting[0].nextAction || 'Open the source and respond.'}` : approvals.length ? `${approvals.length} campaign ${approvals.length === 1 ? 'decision needs' : 'decisions need'} review.` : 'No recorded replies or approvals are waiting on this board.';
  $('campaign-checked').textContent = `Action board records checked ${time(data.asOf)} ET`;
  const sync = data.gmailSync || { status: 'not_connected' };
  const syncText = sync.status === 'not_connected' ? 'Gmail sync is not connected yet. Saved email records may be out of date.' : `Gmail last synced ${time(sync.lastSuccessfulSyncAt)} ET · ${sync.trackedCount} tracked ${sync.trackedCount === 1 ? 'conversation' : 'conversations'}. ${sync.status === 'stale' ? 'Sync is overdue; email status may be out of date.' : 'Checks automatically about every five minutes.'}`;
  $('gmail-sync').textContent = syncText;
  $('gmail-sync').className = `sync-status${sync.status !== 'current' ? ' stale' : ''}`;
  $('campaign-status').textContent = 'Campaigns use saved review records. Tracked email status comes from the last successful Gmail scan.';
  if (sync.status !== 'current' && !waiting.length) $('focus-text').textContent += ' Gmail status is not current; check Gmail for new replies.';
  $('campaign-error').hidden = true;
}

async function recordApproval(item, button) {
  if (!confirm(`Record approval for “${item.title}”? Review the exact copy and recipients in its linked record first. This does not send or schedule anything.`)) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const response = await fetch(`/api/campaigns/${item.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Approval could not be saved. Refresh and try again.');
    renderCampaigns(await response.json());
  } catch (error) {
    $('campaign-error').textContent = error.message;
    $('campaign-error').hidden = false;
    button.disabled = false;
    button.textContent = 'Record approval';
  }
}

async function refresh() {
  $('refresh').disabled = true;
  $('refresh').textContent = 'Checking…';
  const [numbers, campaigns] = await Promise.allSettled([
    fetch('/api/overview', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
    fetch('/api/campaigns', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
  ]);
  if (numbers.status === 'fulfilled') render(numbers.value);
  else {
    $('error').textContent = 'The Cloudflare numbers could not be refreshed. The last displayed numbers may be stale.';
    $('error').hidden = false;
    $('checked').textContent = 'Cloudflare numbers: last refresh failed';
  }
  if (campaigns.status === 'fulfilled') renderCampaigns(campaigns.value);
  else {
    $('campaign-error').textContent = 'Action board records could not be refreshed. The last displayed status may be stale.';
    $('campaign-error').hidden = false;
    $('campaign-checked').textContent = 'Action board: last refresh failed';
    $('campaign-status').textContent = 'Last read failed; check again before making a decision.';
  }
  $('refresh').disabled = false;
  $('refresh').textContent = 'Refresh dashboard';
}

$('refresh').addEventListener('click', refresh);
$('cost-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentMonth) return;
  const amountCents = Math.round(Number($('costs').value) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return;
  const button = $('cost-form').querySelector('button');
  button.disabled = true;
  $('cost-status').textContent = 'Saving…';
  try {
    const response = await fetch('/api/costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: currentMonth, amountCents, complete: $('complete').checked }) });
    if (!response.ok) throw new Error('Save failed');
    render(await response.json());
  } catch {
    $('cost-status').textContent = 'Could not save the cost total. Try again.';
  } finally { button.disabled = false; }
});
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
