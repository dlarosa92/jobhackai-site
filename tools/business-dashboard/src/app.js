const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
const time = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(/^[\d-]+ [\d:]+$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso));
let currentMonth = null;
let boardData = null;
let selectedChannel = 'All';
const expandedLanes = new Set();

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

// Legacy Outreach records were verified as email; never infer a channel from an agent's name.
function channelName(item) {
  if (item.source === 'gmail' || /\b(email|gmail|outreach)\b/i.test(item.channel)) return 'Email';
  return ['LinkedIn', 'Pinterest', 'Facebook', 'Instagram', 'Nextdoor', 'Blog', 'X'].find(channel => new RegExp(`\\b${channel}\\b`, 'i').test(item.channel)) || 'Channel not recorded';
}
function stateLabel(item) {
  if (item.state === 'approved') return channelName(item) === 'Email' ? 'Approved, not sent' : 'Approved, not scheduled';
  return { pending: item.impact === 'campaign' ? 'Needs your approval' : 'Needs your review', waiting: 'Waiting for an email reply', sent: 'Email sent', scheduled: 'Post scheduled', published: 'Published', hold: 'Not ready for approval' }[item.state] || item.state;
}
function plainEmailText(value) {
  const named = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
  });
}
const laneDefinitions = [
  { title: 'Emails to review or reply to', note: 'A customer or partner may need your response.', empty: 'No tracked emails need your response.', matches: item => ['pending', 'hold'].includes(item.state) && item.impact !== 'campaign' },
  { title: 'Needs your approval', note: 'Finished drafts for you to review. Approval alone does not send or publish.', empty: 'Nothing is ready for your approval.', matches: item => item.state === 'pending' && item.impact === 'campaign' },
  { title: 'Being prepared', note: 'Drafts with checks or fixes still needed. Each card says what happens next.', empty: 'No saved drafts are being prepared.', matches: item => item.state === 'hold' && item.impact === 'campaign' },
  { title: 'Waiting for an email reply', note: 'Your email was sent. The other person has not replied in the tracked conversation.', empty: 'No tracked email conversations are waiting for a reply.', matches: item => item.state === 'waiting' },
  { title: 'Approved, not sent or scheduled', note: 'You approved the draft. Sending or scheduling is still a separate step.', empty: 'No approved drafts are waiting to be sent or scheduled.', matches: item => item.state === 'approved' },
  { title: 'Scheduled posts', note: 'These posts have a saved date and time on their platform.', empty: 'No posts have a saved schedule.', matches: item => item.state === 'scheduled' },
  { title: 'Emails sent and posts published', note: 'Recorded activity. An email marked sent does not prove it reached the inbox.', empty: 'No completed activity is saved here.', matches: item => ['sent', 'published'].includes(item.state) },
];

function renderCampaigns(data) {
  boardData = data;
  const filters = $('channel-filters');
  filters.replaceChildren();
  const channels = ['All', 'Email', 'LinkedIn', 'Pinterest', 'Facebook', 'Instagram', 'X', 'Nextdoor', 'Blog'];
  if (data.items.some(item => channelName(item) === 'Channel not recorded')) channels.push('Channel not recorded');
  for (const channel of channels) {
    const button = document.createElement('button');
    button.type = 'button';
    const count = data.items.filter(item => channel === 'All' || channelName(item) === channel).length;
    button.textContent = `${channel} (${count})`;
    button.setAttribute('aria-pressed', String(selectedChannel === channel));
    button.addEventListener('click', () => { selectedChannel = channel; renderCampaigns(boardData); });
    filters.append(button);
  }
  const visibleItems = data.items.filter(item => selectedChannel === 'All' || channelName(item) === selectedChannel);
  $('filter-status').textContent = selectedChannel === 'All' ? 'Showing all saved emails, posts and articles.' : visibleItems.length ? `Showing ${selectedChannel} only.` : `No ${selectedChannel} items are saved on this board. This does not mean there is no activity on ${selectedChannel}.`;
  const board = $('board');
  board.replaceChildren();
  for (const laneDefinition of laneDefinitions) {
    const items = visibleItems.filter(laneDefinition.matches);
    const lane = document.createElement('section');
    lane.className = `lane${items.length ? '' : ' empty-lane'}`;
    const heading = document.createElement('div');
    heading.className = 'lane-heading';
    const title = document.createElement('h2');
    title.textContent = laneDefinition.title;
    const count = document.createElement('span');
    count.textContent = `${items.length} ${items.length === 1 ? 'card' : 'cards'}`;
    heading.append(title, count);
    lane.append(heading);
    const explanation = document.createElement('p');
    explanation.className = 'lane-explanation';
    explanation.textContent = laneDefinition.note;
    lane.append(explanation);
    const cards = document.createElement('div');
    cards.className = 'lane-cards';
    lane.append(cards);
    const shownItems = expandedLanes.has(laneDefinition.title) ? items : items.slice(0, 3);
    for (const item of shownItems) {
      const article = document.createElement('article');
      article.className = `item${item.impact === 'customer' ? ' customer-impact' : item.impact === 'prospect' ? ' prospect-impact' : item.state === 'pending' ? ' important' : ''}`;
      if (item.impact === 'customer' || item.impact === 'prospect') {
        const priority = document.createElement('span');
        priority.className = `priority-badge ${item.impact}`;
        priority.textContent = item.impact === 'customer' ? 'Customer email' : 'Business email';
        article.append(priority);
      }
      const kicker = document.createElement('div');
      kicker.className = `kicker${item.state === 'hold' ? ' caution' : ''}${['sent', 'scheduled', 'published'].includes(item.state) ? ' good' : ''}`;
      kicker.textContent = `${channelName(item)} · ${stateLabel(item)}`;
      const name = document.createElement('h3');
      name.textContent = item.title;
      const detail = document.createElement('p');
      detail.textContent = item.source === 'gmail' ? plainEmailText(item.detail) : item.detail;
      const evidence = document.createElement('p');
      evidence.className = 'evidence';
      evidence.textContent = item.source === 'gmail' ? `Latest ${item.state === 'waiting' ? 'sent' : 'received'} message ${time(item.updatedAt)} ET` : item.evidence;
      article.append(kicker, name, detail);
      const manager = /^(Stan|Sonny|Penny)\s*·/.exec(item.channel)?.[1];
      if (manager) {
        const owner = document.createElement('p');
        owner.className = 'manager';
        owner.textContent = `Managed by ${manager}`;
        article.append(owner);
      }
      const nextAction = item.nextAction || ({ hold: 'Finish the checks listed above before asking for your approval.', pending: 'Open the draft and review the exact content before approving.', approved: channelName(item) === 'Email' ? 'Send the approved email, then verify it in Gmail Sent.' : 'Choose a date and schedule the approved post on its platform.', scheduled: 'Wait for the scheduled time, then verify the published post.' })[item.state];
      if (nextAction) {
        const action = document.createElement('p');
        action.className = 'next-action';
        action.textContent = `Next: ${nextAction}`;
        article.append(action);
      }
      if (item.source === 'gmail') article.append(evidence);
      else {
        const sourceDetails = document.createElement('details');
        sourceDetails.className = 'source-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Why this status?';
        sourceDetails.append(summary, evidence);
        article.append(sourceDetails);
      }
      if(item.source === 'outreach') {
        const review=document.createElement('details');
        const summary=document.createElement('summary'); summary.textContent='Review exact email'; review.append(summary);
        const envelope=document.createElement('p'); envelope.textContent=`To: ${item.message.recipient}\nSubject: ${item.message.subject}`; envelope.className='email-envelope'; review.append(envelope);
        const body=document.createElement('pre'); body.className='email-copy'; body.textContent=item.message.text; review.append(body);
        if(item.message.html){
          const preview=document.createElement('iframe'); preview.title='Exact formatted email preview'; preview.setAttribute('sandbox',''); preview.setAttribute('referrerpolicy','no-referrer');
          preview.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+item.message.html;
          review.append(preview);
        }
        const source=document.createElement('a'); source.href=item.sourceEvidence.sourceUrl; source.target='_blank'; source.rel='noreferrer'; source.textContent='Open first-party evidence ↗'; review.append(source);
        const fact=document.createElement('p'); fact.textContent=`${item.sourceEvidence.fitFact} · checked ${time(item.sourceEvidence.checkedAt)} ET`; review.append(fact);
        article.append(review);
        if(item.sentThreadId){const thread=document.createElement('a');thread.href=`https://mail.google.com/mail/u/1/#all/${item.sentThreadId}`;thread.target='_blank';thread.rel='noreferrer';thread.textContent='Open verified Gmail conversation ↗';article.append(thread);}
        if(item.impact==='campaign' && item.deliveryState==='review' && !item.issues.length){
          const action=document.createElement('button');action.type='button';action.className='approve';
          action.textContent=item.approved?'Send approved email':'Approve exact email';
          action.disabled=item.approved&&(!data.outreachSendingEnabled||!item.senderAvailable);
          action.addEventListener('click',()=>outreachAction(item,item.approved?'send':'approve',action));article.append(action);
          if(action.disabled){const note=document.createElement('p');note.textContent='Guarded Gmail sender activation is required. No email has been sent.';article.append(note);}
        }
        if(item.deliveryState==='queued'){
          const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel queued email';
          cancel.addEventListener('click',()=>outreachAction(item,'cancel',cancel));article.append(cancel);
        }
      }
      try {
        const reviewUrl = new URL(item.reviewUrl);
        if (reviewUrl.protocol === 'https:' && ['chatgpt.com', 'mail.google.com'].includes(reviewUrl.hostname)) {
          const link = document.createElement('a');
          link.href = reviewUrl.href;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = reviewUrl.hostname === 'mail.google.com' ? 'Open email in Gmail ↗' : ['sent', 'published', 'scheduled'].includes(item.state) ? 'Open saved details ↗' : 'Open draft details ↗';
          article.append(link);
        }
      } catch { /* An invalid review URL is omitted. */ }
      if (item.source !== 'outreach' && !item.requiresOutreachManifest && item.state === 'pending' && item.impact === 'campaign') {
        const approval = document.createElement('button');
        approval.type = 'button';
        approval.className = 'approve';
        approval.textContent = 'Approve this draft';
        approval.addEventListener('click', () => recordApproval(item, approval));
        article.append(approval);
      }
      cards.append(article);
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'lane-note';
      empty.textContent = laneDefinition.empty;
      lane.append(empty);
    }
    if (items.length > 3) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'show-more';
      toggle.textContent = expandedLanes.has(laneDefinition.title) ? 'Show fewer' : `Show ${items.length - 3} more`;
      toggle.setAttribute('aria-expanded', String(expandedLanes.has(laneDefinition.title)));
      toggle.addEventListener('click', () => {
        if (expandedLanes.has(laneDefinition.title)) expandedLanes.delete(laneDefinition.title);
        else expandedLanes.add(laneDefinition.title);
        renderCampaigns(boardData);
      });
      lane.append(toggle);
    }
    board.append(lane);
  }
  const waiting = data.items.filter(item => ['pending', 'hold'].includes(item.state) && item.impact !== 'campaign');
  const approvals = data.items.filter(item => item.state === 'pending' && item.impact === 'campaign');
  const preparing = data.items.filter(item => item.state === 'hold' && item.impact === 'campaign');
  $('focus-text').textContent = waiting.length ? `${waiting[0].title}. ${waiting[0].nextAction || 'Open the email and review it.'}` : approvals.length ? `${approvals.length} ${approvals.length === 1 ? 'draft needs' : 'drafts need'} your approval.` : `No emails need your response and no drafts are ready for approval.${preparing.length ? ` ${preparing.length} saved drafts are still being prepared below.` : ''}`;
  const savedChanges = data.items.filter(item => item.source !== 'gmail').map(item => item.updatedAt).filter(Boolean).sort();
  $('campaign-checked').textContent = `Board loaded ${time(data.asOf)} ET.${savedChanges.length ? ` Saved draft and post records last updated ${time(savedChanges.at(-1))} ET.` : ''}`;
  const sync = data.gmailSync || { status: 'not_connected' };
  const syncText = sync.status === 'not_connected' ? 'Gmail sync is not connected yet. Saved email records may be out of date.' : `Gmail last synced ${time(sync.lastSuccessfulSyncAt)} ET · ${sync.trackedCount} tracked ${sync.trackedCount === 1 ? 'conversation' : 'conversations'}. ${sync.status === 'stale' ? 'Sync is overdue; email status may be out of date.' : 'Checks automatically about every five minutes.'}`;
  $('gmail-sync').textContent = syncText;
  $('gmail-sync').className = `sync-status${sync.status !== 'current' ? ' stale' : ''}`;
  $('campaign-status').textContent = 'Saved drafts and posts require explicit preparation. Outreach approval binds the recipient and copy; release requires current source, routing and all-folder Gmail checks.';
  if (sync.status !== 'current' && !waiting.length) $('focus-text').textContent += ' Gmail status is not current; check Gmail for new replies.';
  $('campaign-error').hidden = true;
}

async function recordApproval(item, button) {
  if (!confirm(`Record approval for “${item.title}”? Review the exact copy and recipients in its linked record first. This does not send or schedule anything.`)) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const response = await fetch(`/api/campaigns/${item.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision:item.reviewRevision }) });
    if (!response.ok) throw new Error('Approval could not be saved. Refresh and try again.');
    renderCampaigns(await response.json());
  } catch (error) {
    $('campaign-error').textContent = error.message;
    $('campaign-error').hidden = false;
    button.disabled = false;
    button.textContent = 'Approve this draft';
  }
}

async function outreachAction(item,action,button) {
  const verb=action==='approve'?'Approve':action==='cancel'?'Cancel the queued send of':'Send';
  if(!confirm(`${verb} this exact email to ${item.message.recipient}?\nSubject: ${item.message.subject}\n${action==='send'?'The guarded sender checks Gmail and routing again before one send attempt.':action==='cancel'?'Cancellation succeeds only before a send attempt is reserved.':'Approval does not send it.'}`))return;
  button.disabled=true;
  try {
    const response=await fetch(`/api/outreach/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.outreachId,revision:item.revision})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The email remains held.');
    await refresh();
  }catch(error){$('campaign-error').textContent=error.message;$('campaign-error').hidden=false;button.disabled=false;}
}

$('outreach-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const button=form.querySelector('button');button.disabled=true;
  try{
    const packet={id:values.get('id'),lane:values.get('lane'),phase:values.get('phase'),message:{recipient:values.get('recipient'),subject:values.get('subject'),text:values.get('text'),html:values.get('html'),threadId:values.get('threadId'),inReplyTo:values.get('inReplyTo'),references:values.get('references')},evidence:{sourceUrl:values.get('sourceUrl'),profileUrl:values.get('profileUrl'),publishedEmail:values.get('publishedEmail'),mailtoEmail:values.get('mailtoEmail'),fit:'current',fitFact:values.get('fitFact'),checkedBy:'sebastian.larosa@jobhackai.io',checkedAt:new Date().toISOString()}};
    const response=await fetch('/api/outreach/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save the prepared email.');
    $('outreach-status').textContent='Saved for source, routing and Gmail checks. This does not approve or send the email.';await refresh();
  }catch(error){$('outreach-status').textContent=error.message;}finally{button.disabled=false;}
});

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
