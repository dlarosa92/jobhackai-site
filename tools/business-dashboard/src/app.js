const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
const time = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(/^[\d-]+ [\d:]+$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso));
let currentMonth = null;
let boardData = null;
let selectedChannel = 'All';
let notificationChange = 0;
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
  $('progress').textContent = `${data.d1UserRecords ?? 'Unknown'} of ${data.userGoal} user records`;
  $('goal-fill').style.width = `${Math.max(0,Math.min(100,(data.d1UserRecords||0)/data.userGoal*100))}%`;
  if (data.estimatedAvailableCents === null) {
    $('available').textContent = 'Actual: not yet verified';

  } else {
    $('available').textContent = `Estimated available: ${money(data.estimatedAvailableCents)}`;

  }
  $('error').hidden = true;
}

// Legacy Outreach records were verified as email; never infer a channel from an agent's name.
function channelName(item) {
  if (item.source === 'directory') return 'Directory';
  if (item.department === 'product') return 'Product';
  if (item.source === 'gmail' || /\b(email|gmail|outreach)\b/i.test(item.channel)) return 'Email';
  return ['LinkedIn', 'Pinterest', 'Facebook', 'Instagram', 'Nextdoor', 'Blog', 'X'].find(channel => new RegExp(`\\b${channel}\\b`, 'i').test(item.channel)) || 'Channel not recorded';
}
function stateLabel(item) {
  if(item.canApprove)return 'Ready for approval';
  if(item.decision?.action==='changes'||item.feedback?.action==='changes')return 'Changes requested';
  if(item.decision?.action==='decline'||item.feedback?.action==='decline')return 'Declined';
  if(item.preparation==='up_next')return 'Up next';
  if (item.state === 'approved') return channelName(item) === 'Email' ? 'Approved, not sent' : 'Approved, not scheduled';
  return { pending: item.impact === 'campaign' ? 'Needs your approval' : 'Needs your review', handled: 'Handled', closed: 'Closed in directory source', waiting: 'Waiting for an email reply', sent: 'Email sent', scheduled: 'Post scheduled', published: 'Published', hold: 'Not ready for approval' }[item.state] || item.state;
}
function plainEmailText(value) {
  const named = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
  });
}
let selectedDepartment = 'all';
let openItemId = null;
let lastReviewTrigger = null;
const departmentNames = {marketing:'Marketing',sales:'Sales & Outreach',product:'Product & Technology'};
const lanes = [
  ['ready','Ready for your review','Complete drafts and individual requests needing your decision.'],
  ['in_progress','In progress','Preparation, approved work and verified schedules.'],
  ['up_next','Up next','Supported opportunities, ordered with their dependencies.'],
  ['blocked','Waiting or blocked','Waiting for a reply, a source check or another task.'],
  ['completed','Completed activity','Verified activity and reviewed notifications.'],
];
function element(tag,text,className) { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node; }
function button(text,fn,className) { const node=element('button',text,className);node.type='button';node.addEventListener('click',fn);return node; }
function safeLink(href,label) { try{if(new URL(href).protocol!=='https:')return null;}catch{return null;}const node=element('a',label);node.href=href;node.target='_blank';node.rel='noreferrer noopener';return node; }
function displayLane(item) {
  if(item.boardLane)return item.boardLane;
  if(['sent','published','closed','handled'].includes(item.state))return 'completed';
  if(item.state==='waiting')return 'blocked';
  if(['gmail','directory'].includes(item.source)&&item.state==='pending')return 'ready';
  if(item.source==='outreach'&&item.deliveryState==='review'&&!item.issues?.length)return 'ready';
  return 'in_progress';
}
function department(item){return item.department||(['gmail','outreach','directory'].includes(item.source)||/Stan|Email|Outreach/i.test(item.channel)?'sales':'marketing');}
function renderCampaigns(data) {
  boardData=data;
  const filters=$('department-filters');filters.replaceChildren();
  for(const [key,label] of [['all','All departments'],...Object.entries(departmentNames)]){
    const node=button(label,()=>{selectedDepartment=key;renderCampaigns(boardData);});node.setAttribute('aria-pressed',String(selectedDepartment===key));filters.append(node);
  }
  const channelFilters=$('channel-filters');channelFilters.replaceChildren();
  const channels=['All','Directory','Email','LinkedIn','Pinterest','Facebook','Instagram','X','Nextdoor','Blog','Product'];
  if(data.items.some(i=>channelName(i)==='Channel not recorded'))channels.push('Channel not recorded');
  for(const channel of channels){
    const count=data.items.filter(i=>(selectedDepartment==='all'||department(i)===selectedDepartment)&&(channel==='All'||channelName(i)===channel)).length;
    const node=button(`${channel} (${count})`,()=>{selectedChannel=channel;renderCampaigns(boardData);});node.setAttribute('aria-pressed',String(selectedChannel===channel));channelFilters.append(node);
  }
  const visible=data.items.filter(i=>(selectedDepartment==='all'||department(i)===selectedDepartment)&&(selectedChannel==='All'||channelName(i)===selectedChannel));
  $('filter-status').textContent=visible.length?`Showing ${visible.length} saved items.`:`No saved items match these filters. This does not mean there is no native activity.`;
  const decisions=data.items.filter(i=>displayLane(i)==='ready');
  const next=$('next-decisions');next.replaceChildren();
  for(const [index,item] of decisions.slice(0,3).entries()){
    const row=element('li');const trigger=button(`${index+1}. ${item.title}`,()=>openReview(item,trigger),'decision-link');
    row.append(trigger,element('p',`${departmentNames[department(item)]} · ${item.reason||item.nextAction||'Review the individual request.'}`));
    row.append(element('p',item.nextAction||'Review the complete draft and evidence.','next-action'));next.append(row);
  }
  const counts=Object.fromEntries(lanes.map(([key])=>[key,data.items.filter(i=>displayLane(i)===key).length]));
  $('focus-text').textContent=decisions.length?`${decisions.length} ${decisions.length===1?'decision':'decisions'} ready. Start with the first item below.`:`${counts.in_progress} items in progress · ${counts.up_next} up next · ${counts.blocked} waiting or blocked. ${counts.up_next?'Review the next supported opportunity below.':'The department owners need to complete preparation or identify the next supported opportunity.'}`;
  const board=$('board');board.replaceChildren();
  for(const [key,title,note] of lanes){
    const items=visible.filter(i=>displayLane(i)===key),collapsed=['blocked','completed'].includes(key);
    const lane=element(collapsed?'details':'section',undefined,'lane');
    if(collapsed)lane.open=expandedLanes.has(key);
    const heading=element(collapsed?'summary':'div',undefined,'lane-heading');heading.append(element('h2',title),element('span',`${items.length} items`));lane.append(heading,element('p',note,'lane-explanation'));
    if(collapsed)lane.addEventListener('toggle',()=>{if(lane.open)expandedLanes.add(key);else expandedLanes.delete(key);});
    const cards=element('div',undefined,'lane-cards');lane.append(cards);
    const shown=expandedLanes.has(`${key}-all`)?items:items.slice(0,6);
    for(const item of shown){
      const card=element('article',undefined,`item ${item.impact==='customer'?'customer-impact':''}`);
      card.append(element('p',`${departmentNames[department(item)]} · ${item.product==='local'?'Local':'Core'} · ${channelName(item)}`,'kicker'));
      const trigger=button(item.title,()=>openReview(item,trigger),'card-title');const h=element('h3');h.append(trigger);card.append(h);
      card.append(element('p',stateLabel(item),'state-label'));
      card.append(element('p',(item.reason||item.detail||'').slice(0,260)));
      if(item.nextAction)card.append(element('p',`Next: ${item.nextAction}`,'next-action'));
      if(item.unfinishedDependencies?.length)card.append(element('p',`Waiting on: ${item.unfinishedDependencies.map(id=>data.items.find(i=>i.id===id)?.title||id).join(', ')}`,'caution'));
      if(item.checkedAt)card.append(element('p',`Source checked ${time(item.checkedAt)} ET`,'evidence'));
      if(item.state==='scheduled')card.append(element('p','Scheduled on the source. Publication still needs verification.','evidence'));
      cards.append(card);
    }
    if(!items.length)cards.append(element('p',key==='ready'?'No complete decisions match these filters.':'No saved items in this section.','lane-note'));
    if(items.length>6)lane.append(button(expandedLanes.has(`${key}-all`)?'Show fewer':`Show ${items.length-6} more`,()=>{const id=`${key}-all`;if(expandedLanes.has(id))expandedLanes.delete(id);else expandedLanes.add(id);renderCampaigns(boardData);},'show-more'));
    board.append(lane);
  }
  $('campaign-checked').textContent=`Board loaded ${time(data.asOf)} ET. Source verification times are shown separately.`;
  const sync=data.gmailSync||{status:'not_connected'};
  $('gmail-sync').textContent=sync.lastSuccessfulSyncAt?`Gmail last synced ${time(sync.lastSuccessfulSyncAt)} ET · ${sync.trackedCount} conversations · ${sync.status}.`:'Gmail has no successful sync timestamp.';
  $('gmail-sync').className=`sync-status${sync.status==='current'?'':' stale'}`;
  const directory=data.directorySource;
  $('directory-sync').textContent=directory?.status==='current'?`Directory checked ${time(directory.checkedAt)} ET. No Gmail label is needed.`:'Directory source unavailable. Previous evidence may be incomplete.';
  const sources=$('source-health');sources.replaceChildren();
  for(const source of data.sources||[])sources.append(element('li',`${source.source}: ${source.status}. ${source.last_success_at?`Last verified ${time(source.last_success_at)} ET.`:'No successful verification recorded.'} ${source.detail}${source.requires_mac?' Browser access requires the Mac.':''}`,source.status==='current'?'':'caution'));
  if(!data.sources?.length)sources.append(element('li','Meta, Marblism and repository freshness has not been registered yet. Saved campaign records are retained.','caution'));
  $('campaign-status').textContent='Preparation, owner decisions and native status are separate. Source failures preserve evidence; approval never sends, schedules or publishes.';
  $('campaign-error').hidden=true;
  const coordination=$('coordination-status');coordination.replaceChildren();
  for(const run of (data.coordination||[]).slice(0,3)){
    const details=element('details');details.append(element('summary',`${run.cadence} review · ${time(run.created_at)} ET`));
    for(const assessment of run.document.assessments||[])details.append(element('p',`${departmentNames[assessment.department]||assessment.department}: ${assessment.summary}`));
    details.append(element('p',`Next adjustments: ${run.document.adjustments}`));coordination.append(details);
  }
  if(!data.coordination?.length)coordination.append(element('p','No department review has been recorded yet. Hourly checks, daily coordination and weekly planning will appear here.'));
  if(openItemId){const current=data.items.find(i=>i.id===openItemId);if(current)openReview(current,lastReviewTrigger,true);else closeReview();}
}
function closeReview(){openItemId=null;$('review-dialog').close();lastReviewTrigger?.focus();}
function openReview(item,trigger,refreshing=false){
  openItemId=item.id;if(trigger)lastReviewTrigger=trigger;
  $('review-title').textContent=item.title;
  const content=$('review-content');content.replaceChildren();
  content.append(element('p',`${departmentNames[department(item)]} · ${item.product==='local'?'Local':'Core'} · ${stateLabel(item)}`,'kicker'));
  const snapshot=item.snapshot;
  const message=item.message;
  if(message||snapshot){
    const copy=message||snapshot;
    content.append(element('p',`Destination: ${copy.recipient||copy.destination}\n${copy.subject?`Subject: ${copy.subject}`:''}`,'email-envelope'));
    if(snapshot)content.append(element('p',`Proposed timing: ${snapshot.timing}`));
    content.append(element('pre',copy.text,'email-copy'));
    if(copy.html){const frame=element('iframe');frame.title='Exact formatted draft';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+copy.html;content.append(frame);}
    for(const media of snapshot?.media||[]){const link=safeLink(media.url,'Open source media ↗');if(link){const img=element('img');img.src=media.url;img.alt=media.alt;img.loading='lazy';img.referrerPolicy='no-referrer';img.className='review-media';content.append(img,element('p',media.alt),link);}}
    for(const href of snapshot?.links||[]){const link=safeLink(href,href);if(link)content.append(link);}
  }else{
    content.append(element('pre',item.source==='gmail'?plainEmailText(item.detail||''):item.detail||'','email-copy'));
    if(!['gmail','directory'].includes(item.source))content.append(element('p','The complete draft, destination and media have not been verified in this dashboard. Preparation is still needed before a new approval.','caution'));
    if(item.source==='gmail')content.append(element('p','This is the synced message preview. Full conversation review is required before preparing a reply.','evidence'));
  }
  if(item.expectedValue)content.append(element('p',`Expected value: ${item.expectedValue}`));
  if(item.completionCriteria)content.append(element('p',`Done when: ${item.completionCriteria}`));
  if(item.dependencies?.length)content.append(element('p',`Dependencies: ${item.dependencies.map(id=>boardData.items.find(i=>i.id===id)?.title||id).join(', ')}`));
  content.append(element('h3','Evidence and next step'),element('p',item.evidence||item.reason||''),element('p',item.nextAction||''));
  for(const evidence of snapshot?.evidence||[]){content.append(element('p',evidence.fact));const link=safeLink(evidence.url,`Source ${evidence.id} ↗`);if(link)content.append(link);}
  for(const contribution of item.contributions||[])content.append(element('p',`${departmentNames[contribution.department]}: ${contribution.document.recommendation}`));
  if(item.sourceEvidence){content.append(element('p',item.sourceEvidence.fitFact));const link=safeLink(item.sourceEvidence.sourceUrl,'First-party contact evidence ↗');if(link)content.append(link);}
  const sourceLink=safeLink(item.reviewUrl,'Open original source ↗');if(sourceLink)content.append(sourceLink);
  if(item.decision)content.append(element('p',`Your decision: ${item.decision.action}${item.decision.note?` · ${item.decision.note}`:''} · ${time(item.decision.created_at)} ET`));
  const actions=$('review-actions');actions.replaceChildren();
  const notificationId=item.sourceItemId||item.id;
  if(['gmail','directory'].includes(item.source)&&item.notificationRevision){
    const handled=item.state==='handled';const control=button(handled?'Reopen':'Mark reviewed',()=>resolveNotification({...item,id:notificationId},handled?'reopen':'handle',control));actions.append(control);
  }
  if(item.source==='outreach'){
    if(item.deliveryState==='review'&&!item.issues.length){
      const action=item.approved?'send':'approve';const control=button(item.approved?'Send approved email':'Approve',()=>outreachAction(item,action,control),'approve');
      control.disabled=item.approved&&(!boardData.outreachSendingEnabled||!item.senderAvailable);actions.append(control);
    }
    if(item.deliveryState==='queued'){const control=button('Cancel queued email',()=>outreachAction(item,'cancel',control));actions.append(control);}
    if(item.deliveryState==='review'){
      for(const [action,label] of [['changes','Request changes'],['decline','Decline']]){const control=button(label,()=>outreachFeedback(item,action,control));actions.append(control);}
    }
  }else if(item.workId&&item.snapshot&&!['gmail','directory'].includes(item.source)){
    if(item.canApprove){const control=button('Approve',()=>workFeedback(item,'approve',control),'approve');actions.append(control);}
    if(!['sent','published','closed'].includes(item.nativeState))for(const [action,label] of [['changes','Request changes'],['decline','Decline']]){const control=button(label,()=>workFeedback(item,action,control));actions.append(control);}
  }
  if(!refreshing){$('review-note').value='';$('review-error').textContent='';}$('review-note-label').hidden=!actions.children.length;
  if(!refreshing)$('review-dialog').showModal();
}
async function workFeedback(item,action,control){
  if(action==='approve'&&!confirm('Approve this exact draft, destination, media and timing? This does not release it.'))return;
  const note=$('review-note').value;if(action==='changes'&&!note.trim()){showBoardError('Describe the changes needed.');return;}
  control.disabled=true;notificationChange++;
  try{const response=await fetch('/api/work-items/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,action,note,requestId:crypto.randomUUID()})});const result=await response.json();if(!response.ok)throw new Error(result.error);await refresh();}catch(error){showBoardError(error.message);}finally{control.disabled=false;}
}
function showBoardError(message){$('campaign-error').textContent=message;$('campaign-error').hidden=false;$('review-error').textContent=message;}
async function outreachFeedback(item,action,control){
  const note=$('review-note').value;if(action==='changes'&&!note.trim()){showBoardError('Describe the changes needed.');return;}control.disabled=true;
  try{const response=await fetch('/api/outreach/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.outreachId,revision:item.revision,action,note})});const result=await response.json();if(!response.ok)throw new Error(result.error);notificationChange++;await refresh();}catch(error){showBoardError(error.message);}finally{control.disabled=false;}
}
async function resolveNotification(item,action,control){
  control.disabled=true;notificationChange++;
  try{const response=await fetch(`/api/notifications/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,revision:item.notificationRevision})});const result=await response.json();if(!response.ok)throw new Error(result.error);notificationChange++;await refresh();}catch(error){showBoardError(error.message);}finally{control.disabled=false;}
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
  const notificationVersion = notificationChange;
  $('refresh').disabled = true;
  $('refresh').textContent = 'Checking…';
  const [numbers, campaigns] = await Promise.allSettled([
    fetch('/api/overview', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
    fetch('/api/work-items', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
  ]);
  if (numbers.status === 'fulfilled') render(numbers.value);
  else {
    $('error').textContent = 'The Cloudflare numbers could not be refreshed. The last displayed numbers may be stale.';
    $('error').hidden = false;
    $('checked').textContent = 'Cloudflare numbers: last refresh failed';
  }
  if (notificationVersion === notificationChange && campaigns.status === 'fulfilled') renderCampaigns(campaigns.value);
  else if (notificationVersion === notificationChange) {
    $('campaign-error').textContent = 'Action board records could not be refreshed. The last displayed status may be stale.';
    $('campaign-error').hidden = false;
    $('campaign-checked').textContent = 'Action board: last refresh failed';
    $('campaign-status').textContent = 'Last read failed; check again before making a decision.';
  }
  $('refresh').disabled = false;
  $('refresh').textContent = 'Refresh dashboard';
}

$('review-close').addEventListener('click',closeReview);
$('review-dialog').addEventListener('cancel',()=>{openItemId=null;});
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
