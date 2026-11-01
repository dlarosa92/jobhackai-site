const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
const parseDate = value => new Date(/^[\d-]+ [\d:.]+$/.test(value||'') ? `${value.replace(' ','T')}Z` : value);
const time = value => Number.isFinite(parseDate(value).getTime()) ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(parseDate(value))+' ET' : 'Not recorded';
const shortDate = value => new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(value+'T12:00:00Z'));
const relative = (value, now=Date.now()) => { const minutes=Math.max(0,Math.floor((now-parseDate(value).getTime())/60000));return !Number.isFinite(minutes)?'Not recorded':minutes<1?'Just now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:`${Math.floor(minutes/1440)}d ago`; };
let currentMonth=null, boardData=null, overviewData=null, selectedDepartment='all', selectedChannel='All', selectedProduct='all', selectedPeriod=7;
let openItemId=null,lastReviewTrigger=null,reviewedItem=null,notificationChange=0,refreshSequence=0,actionPending=false,costDirty=false;
let numbersFailed=false,boardFailed=false;
const expandedLanes=new Set();
const departmentNames={marketing:'Marketing',sales:'Sales',product:'Product'};
const lanes=[['needs','Needs you','red'],['working','Working','blue'],['waiting','Waiting','amber'],['done','Done','green']];
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
function button(text,fn,className,helpText){const node=element('button',text,className);node.type='button';node.addEventListener('click',fn);const hint=helpText||({'Request changes':'Saves your note for the owner. It does not send or publish anything.','Decline draft':'Declines this saved draft. It does not delete the original source.','Show fewer':'Collapses extra cards. All work stays saved.'}[text]);if(hint)node.setAttribute('data-help',hint);return node;}
function help(text,label){const node=button('?',()=>{},'help',text);node.setAttribute('aria-label',label||'Explain this');return node;}
function detail(label,content){const node=element('details');const summary=element('summary',label);summary.setAttribute('data-help','Open or close these details. This does not start any work.');node.append(summary);if(content)node.append(typeof content==='string'?element('p',content):content);return node;}
function retainDisclosures(root){
  const key=node=>{const parts=[];for(let current=node;current&&current!==root;current=current.parentElement){const named=current.getAttribute?.('data-disclosure-key');if(named)parts.unshift(named);else if(current.tagName==='DETAILS')parts.unshift(current.querySelector('summary')?.textContent||'');}return parts.join(' / ');};
  const previous=new Map(Array.from(root.querySelectorAll?.('details')||[],node=>[key(node),node.open]));
  return ()=>{for(const node of root.querySelectorAll?.('details')||[]){const id=key(node);if(previous.has(id))node.open=previous.get(id);}};
}
function safeLink(href,label){try{if(new URL(href).protocol!=='https:')return null;}catch{return null;}const node=element('a',label);node.href=href;node.target='_blank';node.rel='noreferrer noopener';return node;}
function department(item){return item.department||(['gmail','outreach','directory'].includes(item.source)||/Stan|Email|Outreach/i.test(item.channel)?'sales':'marketing');}
function channelName(item){if(item.source==='directory')return 'Directory';if(item.department==='product')return 'Product';if(item.source==='gmail'||item.source==='outreach'||/\b(email|gmail|outreach)\b/i.test(item.channel))return 'Email';return ['LinkedIn','Pinterest','Facebook','Instagram','Nextdoor','Blog','X'].find(c=>new RegExp(`\\b${c}\\b`,'i').test(item.channel))||'Other';}
function approved(item){return !item.receipts?.length&&(item.state==='approved'||item.approved===true||item.decision?.action==='approve');}
function displayLane(item){
  if(item.staleSource)return 'waiting';
  if(item.boardLane==='completed'||['sent','published','closed','handled'].includes(item.state)||['sent','published','closed'].includes(item.nativeState))return 'done';
  if(['sending','uncertain','queued'].includes(item.deliveryState)||item.state==='scheduled'||item.nativeState==='scheduled')return 'waiting';
  if(approved(item))return 'needs';
  if(item.canApprove||item.boardLane==='ready')return 'needs';
  if(item.boardLane==='up_next'||item.preparation==='up_next')return 'backlog';
  if((item.sourceHealth&&item.sourceHealth.status!=='current')||item.boardLane==='blocked'||item.preparation==='blocked'||item.blocker||item.state==='waiting'||item.unfinishedDependencies?.length||item.issues?.length)return 'waiting';
  return 'working';
}
function receiptLabel(stage){return ({dev_deployed:'Development deployed',dev_verified:'Development accepted',qa_deployed:'QA deployed',qa_verified:'QA accepted',production_deployed:'Production deployed',production_verified:'Production verified',published:'Published',sent:'Sent'})[stage]||stage;}
function stateLabel(item){
  if(item.receipts?.length)return receiptLabel(item.receipts.at(-1).stage);
  if(item.staleSource)return 'Source check failed';
  if(item.deliveryState==='uncertain')return 'Send result unknown';
  if(item.deliveryState==='sending')return 'Sending · not confirmed';
  if(item.deliveryState==='queued')return 'Queued · not sent';
  if(item.state==='sent'||item.nativeState==='sent')return 'Sent';
  if(item.state==='published'||item.nativeState==='published')return 'Published';
  if(item.state==='scheduled'||item.nativeState==='scheduled')return 'Scheduled · not published';
  if(item.state==='handled')return 'Reviewed';
  if(item.decision?.action==='decline'||item.feedback?.action==='decline')return 'Declined';
  if(displayLane(item)==='done')return 'Done';
  if(approved(item))return channelName(item)==='Email'||channelName(item)==='Nextdoor'?'Approved · not sent':'Approved · not published';
  if(item.canApprove)return 'Draft ready to review';
  if(item.source==='gmail'&&item.state==='pending')return 'Reply needs review';
  if(item.source==='directory'&&item.state==='pending')return 'Listing needs review';
  if(item.decision?.action==='changes'||item.feedback?.action==='changes')return 'Changes requested';
  if(item.state==='waiting')return 'Waiting for reply';
  if(displayLane(item)==='backlog')return 'Up next';
  if(item.unfinishedDependencies?.length)return 'Waiting on another task';
  if(item.issues?.length)return 'Checks need attention';
  if(item.sourceHealth&&item.sourceHealth.status!=='current')return 'Source update missing or overdue';
  if(displayLane(item)==='waiting')return 'Waiting on a next step';
  return 'Preparing';
}
function cardTitle(item){
  if(item.id==='michael-nextdoor-reply')return 'Michael’s reply';
  if(item.id==='voice-qa-acceptance-pr-1032')return 'Voice interview test';
  if(item.id==='campaign-measurement-acceptance')return 'Make the numbers trustworthy';
  if(item.id==='nextdoor-test-closeout')return 'Nextdoor test results';
  if(item.id==='nextdoor-expired-receipts')return 'Close the old Nextdoor campaign';
  if(item.id==='product-pr-1045')return 'Check signup tracking';
  if(item.id==='product-pr-949')return 'Check the directory release';
  if(item.id==='cloud-execution-acceptance')return 'Move scheduled work to the cloud';
  return (item.title||'Untitled work').replace(/^PR #\d+:\s*/,'').replace(/\s*[—–]\s*(copy approved.*|awaiting release.*)$/i,'').replace(/\s*\(Product priority \d+\)$/,'');
}
function nextStep(item){
  if(item.receipts?.length)return item.nextAction;
  const lane=displayLane(item),channel=channelName(item);
  if(item.staleSource||item.deliveryState==='uncertain')return 'Check the source first';
  if(item.deliveryState==='queued')return 'Review the send queue';
  if(item.state==='scheduled'||item.nativeState==='scheduled')return 'Check the posting plan';
  if(approved(item))return ['Email','Nextdoor'].includes(channel)?'Review send step':'Review publishing step';
  if(item.canApprove)return 'Review the full draft';
  if(item.source==='gmail'&&item.state==='pending')return 'Review the conversation';
  if(item.source==='directory'&&item.state==='pending')return 'Review the listing request';
  if(item.issues?.length)return 'Review the failed checks';
  if(item.unfinishedDependencies?.length)return 'See what this needs first';
  if(lane==='done')return 'View the result';
  if(item.id==='voice-qa-acceptance-pr-1032')return 'Review the test checklist';
  if(item.id==='campaign-measurement-acceptance')return 'Review the missing checks';
  if(item.state==='waiting')return 'Review the follow-up plan';
  return lane==='backlog'?'Review the next task':lane==='waiting'?'Review what is holding this up':'Review the work plan';
}
function metricValue(metric,value){return value===null||value===undefined?'—':metric.id==='money'?money(value):Number(value).toLocaleString();}
function metricChange(metric){if(metric.change===null||metric.change===undefined)return 'No comparison';if(metric.change===0)return 'No change';return `${metric.change>0?'+':'−'}${metricValue(metric,Math.abs(metric.change))}`;}
function sparkline(series,label){
  if(!series?.length)return null;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 34');svg.setAttribute('class','sparkline');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);
  const values=series.map(p=>p.value),min=Math.min(0,...values),max=Math.max(0,...values),range=max-min||1;
  const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',values.map((n,i)=>`${3+i*94/Math.max(1,values.length-1)},${max===min?17:30-(n-min)*26/range}`).join(' '));svg.append(line);return svg;
}
function render(data){
  overviewData=data;currentMonth=data.month;numbersFailed=false;
  $('month-label').textContent=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${data.month}-01T12:00:00Z`));
  $('monthly-money').textContent=`Collected after refunds: ${money(data.netCollectedCents)}.`;
  $('basis').textContent='Payment totals have not been compared with Stripe. Add all costs before using this as available cash.';
  if(!costDirty){$('costs').value=data.costCents===null?'':(data.costCents/100).toFixed(2);$('complete').checked=data.costsComplete;}
  if(!costDirty)$('cost-status').textContent=data.costCents===null?'No costs recorded yet.':`${data.costsComplete?'Costs marked complete':'Some costs may be missing'} · saved ${time(data.costUpdatedAt)}`;
  $('available').textContent=data.estimatedAvailableCents===null?'Cash after costs: not known yet.':`Estimated cash after costs: ${money(data.estimatedAvailableCents)}`;
  $('goal-status').textContent='Real user count unknown';$('goal-fill').style.width='0%';$('goal-fill').parentElement?.classList.add('unverified');
  $('goal-status').setAttribute('data-help',`${data.d1UserRecords??'Unknown'} account records are saved. Staff and test accounts have not been removed, so verified progress toward 250 users is not yet known.`);
  $('error').hidden=true;renderMetrics();renderHealth();
}
function renderMetrics(){
  const period=overviewData?.business?.periods?.[selectedPeriod];
  const metrics=period?.metrics||['customers','money','accounts','interviews'].map((id,i)=>({id,label:['Paying customers','Money collected','New accounts','Interviews finished'][i],value:null,change:null,previous:null,series:[],definition:'Waiting for the source.',note:'Data has not loaded.',source:'Not available'}));
  $('period-dates').textContent=period?`${shortDate(period.start)}–${shortDate(period.end)} vs ${shortDate(period.previousStart)}–${shortDate(period.previousEnd)}. Eastern time. Today is still in progress.`:'The comparison dates have not loaded.';
  $('trends-period').textContent=`Last ${selectedPeriod} days`;
  const grid=$('kpi-grid'),definitions=$('metric-definitions');grid.replaceChildren();definitions.replaceChildren();
  for(const metric of metrics){
    const card=element('article',undefined,'metric');const head=element('div',undefined,'metric-head');head.append(element('span',metric.label),help(`${metric.definition} ${metric.note}`,`What ${metric.label.toLowerCase()} means`));
    card.append(head,element('div',metric.value===null?(period||numbersFailed?'Unavailable':'Loading…'):metricValue(metric,metric.value),`metric-value${metric.value===null?' unknown':''}`));
    const bottom=element('div',undefined,'metric-bottom'),change=element('div');change.append(element('p',metricChange(metric),'metric-change'),element('p',metric.value===null?'No trusted count yet':`vs prior ${selectedPeriod} days`,'metric-caption'));bottom.append(change);
    const chart=sparkline(metric.series,`${metric.label}: daily raw records from ${period?.start} to ${period?.end}. ${metric.series.map(p=>`${p.date}: ${metricValue(metric,p.value)}`).join('; ')}`);if(chart)bottom.append(chart);
    if(metric.value!==null)card.append(bottom);
    const quality=element('div',undefined,'metric-quality');
    const problem=numbersFailed?'Refresh failed. Saved numbers may be old.':!period?null:metric.id==='customers'?'Paid customer count is missing.':metric.value===null?'Could not load this number.':metric.id==='money'?'Total is not verified with Stripe.':null;
    if(problem){quality.append(element('strong','Needs attention','amber'),element('p',problem));const link=element('a','See what to do');link.href='#data-health';link.addEventListener('click',()=>{$('data-health').open=true;});quality.append(link);}
    else quality.append(element('p',!period?'Waiting for business numbers…':metric.id==='accounts'?'Includes staff and test accounts.':'Includes staff and test interviews.'));
    card.append(quality);
    grid.append(card);
    const definition=element('div',undefined,'definition');definition.append(element('strong',metric.label),element('p',metric.definition),element('p',`${metric.source}. ${metric.note}`));definitions.append(definition);
  }
  const table=element('table'),head=element('thead'),row=element('tr');['Metric','This period','Previous','Change'].forEach(t=>row.append(element('th',t)));head.append(row);table.append(head);const body=element('tbody');
  for(const metric of metrics){const row=element('tr'),label=element('td',metric.label);label.append(element('small',metric.value===null?'Not verified':metric.id==='money'?'Saved ledger':'Includes tests','raw-note'));row.append(label,element('td',metricValue(metric,metric.value)),element('td',metricValue(metric,metric.previous)),element('td',metric.change===null?'—':metricChange(metric),'change'));body.append(row);}table.append(body);$('trends-table').replaceChildren(table);
}
function matches(item){return (selectedDepartment==='all'||department(item)===selectedDepartment)&&(selectedChannel==='All'||channelName(item)===selectedChannel)&&(selectedProduct==='all'||(item.product||'core')===selectedProduct);}
function rankedItems(items){
  // Keep the server's dependency-aware priority order. The numbers are display positions.
  return items.map((item,index)=>({...item,displayRank:index+1}));
}
function makeCard(item){
  const key=displayLane(item),color=lanes.find(l=>l[0]===key)?.[2]||'blue';const card=element('article',undefined,'item');card.style.setProperty('--lane-color',`var(--${color})`);card.setAttribute('data-lane',key);card.setAttribute('data-rank',String(item.displayRank));
  const main=element('div',undefined,'item-main'),kicker=element('p',undefined,'kicker');kicker.append(element('span',departmentNames[department(item)]),element('span',item.product==='local'?'Local':'Core',`tag${item.product==='local'?' local':''}`),element('span',`#${item.displayRank}`,'rank'));main.append(kicker);
  const trigger=button('',()=>openReview(item,trigger),'card-title',`Open ${cardTitle(item)}. This only opens the details.`);trigger.append(element('span',cardTitle(item),'card-title-text'));const h=element('h3');h.append(trigger);main.append(h);
  const status=element('p',undefined,'state-line');status.append(element('span',undefined,'dot'),element('span',stateLabel(item)));main.append(status);
  const approvedAt=approved(item)&&displayLane(item)!=='done'?item.decision?.created_at:null;
  const late=item.handoff?.overdue;
  const age=late?'Follow-up late':approvedAt?`Approved ${relative(approvedAt)}`:item.lastMovedAt?`Moved ${relative(item.lastMovedAt)}`:'Move date not tracked';
  const ageNode=element('p',age,`card-age${late?' red':''}`);ageNode.setAttribute('data-help',late?`The owner's follow-up was due ${time(item.handoff.due_at)}. A newer source check does not complete it.`:approvedAt?`Draft approval saved ${time(approvedAt)}. This is not a send time.`:item.lastMovedAt?`A draft or work milestone changed ${time(item.lastMovedAt)}. Source checks do not reset this time.`:'Older records do not have a trusted work-move date. The next saved deliverable will start this history.');main.append(ageNode);
  const action=button(nextStep(item),()=>openReview(item,action),'card-action','Opens the work details and explains the next step. It does not run the task.');card.append(main,action);return card;
}
function renderCampaigns(data){
  boardData=data;
  const ranked=rankedItems(data.items||[]),visible=ranked.filter(matches);
  const filters=$('department-filters');filters.replaceChildren();
  for(const [key,label] of [['all','All'],...Object.entries(departmentNames)]){const node=button(label,()=>{selectedDepartment=key;renderCampaigns(boardData);},null,`Show ${key==='all'?'all owners':label+' work'}.`);node.setAttribute('aria-pressed',String(selectedDepartment===key));filters.append(node);}
  const channels=['All',...new Set(data.items.map(channelName))].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b));
  const channelSelect=$('channel-filter');channelSelect.replaceChildren();for(const name of channels){const option=element('option',name==='All'?'All platforms':name);option.value=name;channelSelect.append(option);}channelSelect.value=selectedChannel;
  $('filter-status').textContent=visible.length?`${visible.length} saved items match these filters.`:'No saved items match. This does not prove there is no activity on a platform.';
  const decisions=ranked.filter(i=>displayLane(i)==='needs');
  renderDecisionStatus();
  const next=$('next-decisions');next.replaceChildren();
  for(const item of decisions.slice(0,1)){const row=element('div',undefined,'decision-row');const trigger=button('',()=>openReview(item,trigger),'decision-link');const copy=element('span',undefined,'decision-copy');copy.append(element('strong',cardTitle(item)),element('small',`${departmentNames[department(item)]} · ${stateLabel(item)}`));trigger.append(element('span',channelName(item)==='Email'||channelName(item)==='Nextdoor'?'✉':'◇','decision-icon'),copy);row.append(trigger);if(item.decision?.created_at)row.append(element('span',`Approved ${relative(item.decision.created_at)}`,'pill amber'));const action=button(nextStep(item),()=>openReview(item,action),'review-link','Opens the next step. No message will be sent by opening it.');row.append(action);next.append(row);}
  if(!decisions.length)next.append(element('p',`${ranked.filter(i=>displayLane(i)==='working').length} being prepared · ${ranked.filter(i=>displayLane(i)==='waiting').length} waiting`,'muted'));
  const board=$('board');board.replaceChildren();
  $('work-summary').textContent=`${visible.filter(i=>displayLane(i)!=='done').length} open · ${visible.filter(i=>displayLane(i)==='done').length} done`;
  const mobile=typeof matchMedia==='function'&&matchMedia('(max-width: 600px)').matches;
  if(mobile){
    const active=visible.filter(i=>displayLane(i)!=='done'&&displayLane(i)!=='backlog');
    for(const item of (expandedLanes.has('mobile')?active:active.slice(0,3)))board.append(makeCard(item));
    if(!active.length)board.append(element('p','No active work matches these filters.','muted'));
    if(active.length>3)board.append(button(expandedLanes.has('mobile')?'Show fewer cards':`See all ${active.length} active cards`,()=>{if(expandedLanes.has('mobile'))expandedLanes.delete('mobile');else expandedLanes.add('mobile');renderCampaigns(boardData);},'show-more'));
    const done=visible.filter(i=>displayLane(i)==='done');if(done.length){const completed=detail(`Done · ${done.length}`);for(const item of done)completed.append(makeCard(item));completed.open=expandedLanes.has('done-mobile');completed.addEventListener('toggle',()=>{if(completed.open)expandedLanes.add('done-mobile');else expandedLanes.delete('done-mobile');});board.append(completed);}
  }else for(const [key,title,color] of lanes){const lane=element('section',undefined,'lane'),heading=element('div',undefined,'lane-heading');const items=visible.filter(i=>displayLane(i)===key);heading.append(element('span',undefined,`dot ${color}`),element('h3',title),element('span',items.length,'count'));lane.append(heading);const cards=element('div',undefined,'lane-cards');for(const item of (expandedLanes.has(key)?items:items.slice(0,1)))cards.append(makeCard(item));if(!items.length)cards.append(element('p','No saved items here.','lane-note'));lane.append(cards);if(items.length>1)lane.append(button(expandedLanes.has(key)?'Show fewer':`See ${items.length-1} more`,()=>{if(expandedLanes.has(key))expandedLanes.delete(key);else expandedLanes.add(key);renderCampaigns(boardData);},'show-more'));board.append(lane);}
  renderBacklog(visible);renderLearnings(data);renderSafeguards();renderHealth();renderWorkflow(data.workflow,data.analytics);
  $('campaign-checked').textContent=`Board records read ${time(data.asOf)}. Platform checks are listed below.`;
  if(openItemId&&reviewedItem){const current=data.items.find(i=>i.id===openItemId);if(!current||reviewKey(current)!==reviewKey(reviewedItem)){$('review-error').textContent='This item changed while you were reading. Close and reopen it before saving a decision. Your note is still here.';for(const control of $('review-actions').children)control.disabled=true;}}
}
function renderBacklog(items){
  const open=items.filter(i=>displayLane(i)!=='done'),next=open.filter(i=>displayLane(i)==='backlog');
  $('next-work').replaceChildren();for(const item of (next.length?next:open).slice(0,3))$('next-work').append(backlogRow(item));
  if(!open.length)$('next-work').append(element('p','No open work matches these filters.','muted'));
  $('backlog-count').textContent=`(${open.length})`;$('backlog-list').replaceChildren();for(const item of open)$('backlog-list').append(backlogRow(item));
  const since=boardData.progress?.trackedSince;const moved=items.filter(i=>i.lastMovedAt&&Date.now()-parseDate(i.lastMovedAt).getTime()<7*86400000).length;const waiting=open.filter(i=>displayLane(i)==='waiting').length;
  $('movement-summary').textContent=since?`${moved} moved · ${waiting} waiting`:`${waiting} waiting · move history starting`;
  $('movement-summary').setAttribute('data-help',since?`Unique items with a changed draft or verified milestone in the past 7 days. Tracking began ${time(since)}; earlier history is not counted.`:'Older check receipts could include wording edits. We will not call those progress. New history counts changed drafts and verified milestones.');
}
function backlogRow(item){const row=element('div',undefined,'backlog-row');row.append(element('span',`#${item.displayRank}`));const trigger=button('',()=>openReview(item,trigger));trigger.append(element('span',cardTitle(item),'backlog-title'),element('span',departmentNames[department(item)],'tag'));row.append(trigger);return row;}
function plainLesson(dept,assessment){
  const text=assessment?.summary||'';
  if(dept==='marketing'&&/existing|draft|packet|claims|prepar|measure|attribution/i.test(text))return 'Finish and measure existing posts.';
  if(dept==='sales'&&/commitment|reply|replies|follow.up|sent|send|suppression|qualified/i.test(text))return 'Finish warm replies. Check past sends.';
  if(dept==='product'&&/voice|releas|deploy|test|QA|acceptance/i.test(text))return 'Test the version customers will use.';
  return text?(text.split(/(?<=[.!?])\s/)[0].slice(0,100)+(text.length>100?'…':'')):'No owner learning saved yet.';
}
function renderLearnings(data){
  const node=$('owner-learnings'),restore=retainDisclosures(node);node.replaceChildren();
  for(const [dept,label] of Object.entries(departmentNames)){
    const run=(data.coordination||[]).find(r=>r.document?.assessments?.some(a=>a.department===dept));const assessment=run?.document?.assessments?.find(a=>a.department===dept);
    const row=element('details',undefined,'learning'),summary=element('summary');row.setAttribute('data-disclosure-key',dept);summary.append(element('strong',label),element('span',plainLesson(dept,assessment),'lesson-text'));row.append(summary);
    if(run){row.append(element('p',`Saved review · ${time(run.created_at)}`,'source-note'),element('p',assessment.summary));const priority=data.items.find(i=>department(i)===dept&&displayLane(i)!=='done');if(priority){const trigger=button(`First task: ${cardTitle(priority)}`,()=>openReview(priority,trigger));row.append(trigger);}const more=detail('Original review and evidence');for(const [key,title] of [['worked','What worked'],['failed','What did not'],['adjustments','What changes next']])if(run.document[key])more.append(element('strong',title),element('p',run.document[key]));for(const url of run.document.evidence||[]){const link=safeLink(url,'Open saved source ↗');if(link)more.append(element('p',undefined),link);}row.append(more);}
    else row.append(element('p','The next saved owner review will appear here.'));
    node.append(row);
  }
  restore();
}
function renderSafeguards(){
  const rules=[['Do not resend sent emails','On','The email send gate checks saved sends and Gmail before one send attempt. An unknown result stays on hold. Historical conflicts still need review.'],['Keep tests out of growth','Needs attention','The current account and interview counts still include staff and tests. The goal stays unverified until that list is checked.'],['Approval does not mean sent','On','Approving a draft saves the decision and a follow-up for its owner. Only a recorded send or published result can show it as done.'],['Checks are not progress','On','Only changed draft content or a verified work milestone counts as a move. Reworded tasks and new check times do not. Older move history is not assumed.']];
  const node=$('safeguards'),restore=retainDisclosures(node);node.replaceChildren();for(const [title,status,explanation] of rules){const row=element('details',undefined,'learning safeguard'),summary=element('summary');summary.append(element('span','◇','shield'),element('span',title),element('span',status,`pill ${status==='On'?'green':'amber'}`));row.append(summary,element('p',explanation));node.append(row);}restore();
}
function renderDecisionStatus(){
  const count=boardData?.items?.filter(item=>displayLane(item)==='needs').length||0;
  const unavailable=boardFailed||!boardData;
  $('attention').className=`attention${unavailable?' unavailable':count?' needs-action':''}`;
  $('attention-title').textContent=unavailable?(boardFailed?'Decision list could not refresh':'Loading your decisions…'):count?'Needs your attention':'Nothing ready for your approval';
  $('attention-dot').className=`dot ${unavailable?'amber':count?'red':'green'}`;
  $('attention-dot').hidden=unavailable&&!boardFailed;
  $('decision-count').textContent=count;$('decision-count').hidden=unavailable||!count;
  $('focus-text').textContent=boardFailed?'Saved items may be old':count?'Start with the first item':'';
}
function sourceState(status,good,problem){
  if(status==='current')return {status:'Up to date',tone:'green',reason:good};
  if(status==='loading')return {status:'Loading',tone:'muted',reason:'Waiting for saved source information.'};
  return {status:'Needs attention',tone:'amber',reason:problem||({stale:'The last update is overdue. Run the source refresh.',failed:'The last update failed. Retry it and inspect the error if it fails again.',blocked:'The update is blocked. Resolve the saved blocker, then retry.',incomplete:'The last update could not verify all required information. Retry the source refresh.'}[status]||'No successful update is available. Run the source refresh.')};
}
const analyticsChecks={internalTrafficExcluded:'staff and test removal',attributionVerified:'signup and payment source',purchasesReconciled:'payment checks',campaignBreakdownComplete:'campaign breakdown',kitActionBreakdownComplete:'kit action breakdown'};
function renderHealth(){
  renderDecisionStatus();
  const data=boardData,sources=[],missing=data?'missing':'loading';
  const appMetrics=overviewData?.business?.periods?.[selectedPeriod]?.metrics||[],appLoaded=['accounts','interviews'].every(id=>appMetrics.some(metric=>metric.id===id&&metric.value!==null));
  sources.push({name:'App records',...sourceState(numbersFailed?'failed':overviewData?(appLoaded?'current':'incomplete'):'loading','Saved account and interview records loaded. These counts include staff and tests.','Could not load all business numbers. Retry with the refresh button.'),date:overviewData?.asOf,how:'Read from the app database each visible minute.',detail:'A successful read confirms the records loaded. Staff and test activity still needs to be removed before measuring customer growth.'});
  sources.push({name:'Stripe',...sourceState('incomplete',null,'Paid customers and payment totals are not verified with Stripe.'),how:'Next: compare the saved payments and current paid accounts with Stripe.',detail:'This dashboard reads saved payment records, not a fresh Stripe account total. This warning means verification is missing. It does not report a Stripe outage.'});
  const coverage=data?.analytics?.report?.coverage,analyticsGaps=Object.keys(analyticsChecks).some(key=>coverage?.[key]!==true);
  const analyticsState=data?.analytics?.status==='current'&&analyticsGaps?'incomplete':data?.analytics?.status||missing;
  sources.push({name:'Website analytics',...sourceState(analyticsState,'The saved report is current and all required data checks passed.',analyticsState==='incomplete'?'Visitor and campaign numbers are not fully verified. Finish the checks listed under website visits below.':null),date:data?.analytics?.report?.checkedAt,how:'Codex imports one 28-day report each Eastern day.',detail:data?.analytics?.detail||'Staff exclusions, attribution, purchases and campaign breakdowns require separate verification.'});
  const gmail=data?.gmailSync;sources.push({name:'Gmail',...sourceState(gmail?.status||missing,'Tracked email synced successfully.','Tracked email is not up to date. Rerun the mail sync before relying on the inbox count.'),date:gmail?.lastSuccessfulSyncAt,how:'Google checks tracked conversations about every 5 minutes.',detail:'Only tracked conversations and send records are included. A page refresh does not start a Gmail scan.'});
  const directory=data?.directorySource,directoryFailed=directory?.status==='unavailable';
  sources.push({name:'Directory requests',...sourceState(directory?.status==='current'&&directory.truncated?'incomplete':directory?.status||missing,'Listing requests loaded successfully.',directoryFailed?'Directory check failed. New requests could be missing. Refresh again before relying on this list.':directory?.truncated?'Only the newest 200 requests are shown. Review older requests in the source.':null),date:directory?.checkedAt||directory?.lastSuccessfulCheckAt,dateLabel:directoryFailed?'Last successful check':'Checked',how:'Read from the app database on each board refresh.',detail:'Listing requests are read directly. They do not depend on email delivery or the Gmail scan.'});
  for(const [key,label,good,how] of [['marblism','Marblism','The latest required Marblism pages were read successfully.','Codex checks the required Marblism pages every 30 minutes.'],['github','Product work','GitHub source information is current. Open each work card for its release status.','Codex checks GitHub during its source refresh.']]){const source=data?.sources?.find(x=>x.source===key);sources.push({name:label,...sourceState(source?.status||missing,good),date:source?.checked_at,dateLabel:'Last attempt',how,detail:source?.detail||'No source check is saved yet.'});}
  const node=$('source-health'),restore=retainDisclosures(node);node.replaceChildren();
  for(const source of sources){const card=element('article',undefined,'source-card'),head=element('header');card.setAttribute('data-disclosure-key',source.name);head.append(element('strong',source.name),element('span',source.status,source.tone));card.append(head,element('p',source.reason,'source-reason'));
    if(source.name!=='Stripe')card.append(element('p',source.date?`${source.dateLabel||'Checked'} ${time(source.date)}`:'No check time saved.'));
    card.append(element('p',source.how),detail('Technical details',source.detail));node.append(card);
  }restore();
  const problems=data?.workflow?.alerts||[],jobProblems=problems.filter(alert=>alert.id?.startsWith('workflow-')),otherProblems=problems.filter(alert=>!alert.id?.startsWith('workflow-'));
  const problemCount=[jobProblems.length?`${jobProblems.length} background ${jobProblems.length===1?'job':'jobs'}`:'',otherProblems.length?`${otherProblems.length} work ${otherProblems.length===1?'follow-up':'follow-ups'}`:''].filter(Boolean).join(' and ');
  $('data-summary').textContent=numbersFailed||boardFailed?'Needs attention: refresh failed':directoryFailed?'Needs attention: directory check failed':directory?.truncated?'Needs attention: only newest 200 requests shown':problems.length?`Needs attention: ${problemCount}`:'Needs attention: business data is unverified';
  $('data-summary').className=numbersFailed||boardFailed||directoryFailed||problems.length?'red':'amber';
  $('checked').textContent=data?`Board read ${relative(data.asOf)}`:'Loading…';
  $('source-count').textContent='What is working and what needs attention';
  const brief=$('data-brief');brief.replaceChildren(element('p','Stripe verification is missing. Compare paid accounts and payment totals with Stripe. Remove staff and test activity before using the account count as customer growth.'));
  if(numbersFailed||boardFailed)brief.append(element('p','Refresh failed. Saved information may be old. Use the refresh button to retry.','caution'));
  if(directoryFailed)brief.append(element('p',`Directory check failed. New requests could be missing. ${directory.lastSuccessfulCheckAt?`Last successful check: ${time(directory.lastSuccessfulCheckAt)}.`:'No successful check is saved.'}`, 'caution'));
  else if(directory?.truncated)brief.append(element('p','Only the newest 200 directory requests are shown. Older requests are not included.', 'caution'));
  for(const run of data?.workflow?.workflows||[])if(!['current','running'].includes(run.status)){const issue=workflowStatus(run);brief.append(element('p',`${workflowName(run)}: ${issue.reason}`,'caution'));}
  for(const problem of otherProblems)brief.append(element('p',problem.detail,'caution'));
  if(problems.length)brief.append(element('p','These jobs and follow-ups need attention from the team. They are separate from decisions waiting for your approval. See the details below.'));
}
function workflowName(run){return ({preparation:'Prepare work',reconciliation:'Refresh sources',coordination:'Set team priorities'})[run.id]||run.label;}
function workflowStatus(run){
  const reason=({failed:'The last run failed. Fix the error in its saved notes, then rerun it.',blocked:'The last run was blocked. Resolve the missing source or blocker, then rerun it.',stalled:'The job stopped before finishing. Inspect its last run and restart it.',stale:'The job is overdue. Check the Mac scheduler and run it again.',incomplete:'Required work is missing. Finish the missing steps and rerun it.',missing:'No completed run is saved. Run this job.'})[run.status];
  if(run.status==='running')return {status:'Running',tone:'blue',reason:'This job is still working. A result has not been saved yet.'};
  return sourceState(run.status,'The last run completed its required checks.',reason);
}
function renderWorkflow(workflow,analytics){
  const runs=$('workflow-runs'),alerts=$('workflow-alerts'),restoreRuns=retainDisclosures(runs),restoreAlerts=retainDisclosures(alerts);runs.replaceChildren();alerts.replaceChildren();
  const labels={preparation:['Prepare work','Hourly · Codex on the Mac'],reconciliation:['Refresh sources','Every 30 minutes · Codex on the Mac'],coordination:['Set team priorities','Daily · Codex on the Mac']};
  for(const run of workflow?.workflows||[]){const name=labels[run.id]||[run.label,'Codex scheduled work'];const row=element('details',undefined,'workflow-run'),summary=element('summary');const health=workflowStatus(run);summary.append(element('strong',name[0]),element('span',health.status,health.tone));row.append(summary,element('p',health.reason),element('p',name[1]),element('p',run.lastSuccessAt?`Last completed check: ${time(run.lastSuccessAt)}`:'No completed check saved.'));
    if(run.requiredSources?.length){const disputed=run.disputedSources||[],verified=(run.lastRun?.result?.coverage?.verified||[]).filter(source=>!disputed.includes(source));row.append(element('p',`Verified in the last run: ${verified.join(', ')||'none'}.`));const unverified=run.requiredSources.filter(source=>!verified.includes(source));if(unverified.length)row.append(element('p',`Still unverified: ${unverified.join(', ')}.`, 'caution'));if(disputed.length)row.append(element('p','A later source check disputed the saved success. The original run notes remain in history.','caution'));}
    if(run.lastRun?.result?.summary)row.append(detail('Saved run notes',run.lastRun.result.summary));if(run.lastRun?.result?.nextCheckAt)row.append(element('p',`Next check: ${time(run.lastRun.result.nextCheckAt)}`));runs.append(row);}
  if(!workflow)runs.append(element('p','Scheduled work records have not loaded.','caution'));
  for(const alert of workflow?.alerts||[]){const row=detail('Work needs attention',alert.detail);row.setAttribute('data-disclosure-key',alert.id||alert.detail);alerts.append(row);}restoreRuns();restoreAlerts();
  const content=$('analytics-report'),report=analytics?.report,restoreReport=retainDisclosures(content);content.replaceChildren();$('analytics-status').textContent=report?`${report.startDate} to ${report.endDate} · ${analytics.status==='current'?'Report loaded':'Needs attention: '+(analytics.status==='stale'?'report is overdue':'report is incomplete')}`:'No saved website analytics report.';
  if(!report)return;
  if(analytics.status==='incomplete')content.append(element('p',analytics.detail,'caution'));
  content.append(element('p',`Source read ${time(report.checkedAt)}. These are reported events, not a customer count.`,'muted'));
  const table=element('table'),head=element('tr');['Event','Times','Reported users'].forEach(t=>head.append(element('th',t)));table.append(head);
  for(const name of ['session_start','sign_up','voice_session_start','voice_session_complete','begin_checkout','purchase','refund','partner_kit_action','directory_contact_click']){const e=report.events?.find(e=>e.name===name),row=element('tr');row.append(element('td',name.replaceAll('_',' ')),element('td',e?e.count:'Not observed'),element('td',e?e.users:'Unverified'));table.append(row);}content.append(table);
  const gaps=Object.entries(analyticsChecks).filter(([key])=>report.coverage?.[key]!==true).map(([,label])=>label);if(gaps.length)content.append(element('p',`Finish these data checks: ${gaps.join('; ')}.`,'caution'));
  content.append(detail('Original report notes',report.notes));const link=safeLink(report.sourceUrl,'Open Analytics ↗');if(link)content.append(link);restoreReport();
}
function reviewKey(item){return JSON.stringify([item.version,item.snapshotRevision,item.revision,item.notificationRevision,item.deliveryState,item.approved,item.state,item.fresh,item.issues]);}
function plainEmailText(value){const named={amp:'&',apos:"'",quot:'"',lt:'<',gt:'>',nbsp:' '};return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi,(entity,code)=>{if(code[0]!=='#')return named[code.toLowerCase()];const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):entity;});}
function closeReview(){openItemId=null;reviewedItem=null;$('review-dialog').close();if(lastReviewTrigger?.isConnected)lastReviewTrigger.focus();else $('work').focus?.();}
function openReview(item,trigger,refreshing=false){
  openItemId=item.id;reviewedItem=item;if(trigger)lastReviewTrigger=trigger;$('review-title').textContent=cardTitle(item);
  const content=$('review-content');content.replaceChildren();content.append(element('p',`${departmentNames[department(item)]} · ${item.product==='local'?'Local':'Core'} · ${channelName(item)}`,'kicker'));
  content.append(element('p',stateLabel(item),'review-status'));
  const isDone=['sent','published','closed'].includes(item.nativeState)||['sent','published'].includes(item.state);
  if(item.snapshot||item.message||approved(item)){const steps=element('ol',undefined,'review-steps');steps.append(element('li',approved(item)||isDone?'Draft approved ✓':'Draft needs review',approved(item)||isDone?'reached':'current'),element('li',item.deliveryState==='queued'?'Queued to send':isDone?'Work finished':approved(item)?'Waiting for next step':'Prepare next step',approved(item)&&!isDone?'current':''),element('li',isDone?stateLabel(item)+' ✓':'Sent / published',isDone?'reached':''));content.append(steps);}
  const next=element('div',undefined,'review-next');next.append(element('strong',nextStep(item)));
  const release=approved(item)&&!isDone;
  const connected=release&&item.source==='outreach';
  next.append(element('p',release?(connected?'The email below is approved. “Queue approved email” asks the sender to check it again and make one send attempt.':`${departmentNames[department(item)]} needs your separate go-ahead for the next step. This board has no send or publish connection for this item. Open the original source or give the owner that instruction in chat.`):item.canApprove?'Approve draft saves this exact version and a follow-up for its owner. It does not send, publish, or start a new chat.':displayLane(item)==='done'?'A result is saved. Open the evidence below to see what was completed.':`${departmentNames[department(item)]} owns this next step. Open the work plan below for the exact task and any missing checks.`));content.append(next);
  const plan=detail('Work plan and next step');if(item.nextAction)plan.append(element('p',item.nextAction));if(item.blocker)plan.append(element('p',`Holding this up: ${item.blocker}`,'caution'));if(item.completionCriteria)plan.append(element('p',`Done when: ${item.completionCriteria}`));if(item.expectedValue)plan.append(element('p',`Why it matters: ${item.expectedValue}`));if(item.dependencies?.length)plan.append(element('p',`Needs first: ${item.dependencies.map(id=>boardData.items.find(i=>i.id===id)?.title||id).join(', ')}`));if(item.handoff)plan.append(element('p',`Owner follow-up: ${item.handoff.status}. Due ${time(item.handoff.due_at)}. ${item.handoff.next_check_at?`Next check ${time(item.handoff.next_check_at)}.`:''}`,item.handoff.overdue?'caution':''));content.append(plan);
  if(item.receipts?.length){const results=detail('Verified progress');results.open=true;for(const receipt of item.receipts){results.append(element('p',`${receiptLabel(receipt.stage)}: ${receipt.summary}`));const link=safeLink(receipt.evidence_url,'Open verified result ↗');if(link)results.append(link);}content.append(results);}
  const snapshot=item.snapshot,message=item.message,copy=message||snapshot;
  const draft=detail(copy?(release?'View approved draft':'Read the full draft'):item.source==='gmail'?'Read the saved message':'Saved details');
  if(copy){draft.append(element('p',`To: ${copy.recipient||copy.destination}${copy.subject?` · Subject: ${copy.subject}`:''}`));if(snapshot)draft.append(element('p',`Proposed timing: ${snapshot.timing}`));if(message)draft.append(element('p',message.html?`Format exception: ${item.formatRequest?.reason||'No reason saved.'}${item.formatApproved?' · Format approved.':' · Needs a format decision.'}`:'Format: Plain text with visible URLs.'));draft.append(element('pre',copy.text,'email-copy'));
    if(copy.html){const frame=element('iframe');frame.title='Exact formatted draft';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+copy.html;draft.append(frame);}
    for(const media of snapshot?.media||[]){const link=safeLink(media.url,'Open saved media ↗');if(link){const img=element('img');img.src=media.url;img.alt=media.alt;img.loading='lazy';img.referrerPolicy='no-referrer';img.className='review-media';draft.append(img,link);}}
    for(const href of snapshot?.links||[]){const link=safeLink(href,href);if(link)draft.append(element('p',undefined),link);}
  }else{draft.append(element('pre',item.source==='gmail'?plainEmailText(item.detail||''):item.detail||'No full draft is saved.','email-copy'));if(!['gmail','directory'].includes(item.source))draft.append(element('p','A complete draft, destination and media have not been verified here. The owner needs to finish preparation before approval.','caution'));}
  content.append(draft);
  const evidence=detail('Source, checks and decision history');evidence.append(element('p',`Source checked: ${time(item.checkedAt)}. Last real move: ${time(item.lastMovedAt)}.`));if(item.priorDecision)evidence.append(element('p',`Earlier draft decision: ${item.priorDecision.action}. Retained as history.`));if(item.title!==cardTitle(item))evidence.append(element('p',`Original title: ${item.title}`));if(item.evidence||item.reason)evidence.append(element('p',item.evidence||item.reason));
  for(const record of snapshot?.evidence||[]){evidence.append(element('p',record.fact));const link=safeLink(record.url,'Open evidence ↗');if(link)evidence.append(link);}for(const contribution of item.contributions||[])evidence.append(element('p',`${departmentNames[contribution.department]}: ${contribution.document.recommendation}`));if(item.sourceEvidence)evidence.append(element('p',item.sourceEvidence.fitFact));for(const issue of item.issues||[])evidence.append(element('p',issue,'caution'));if(item.decision)evidence.append(element('p',`Your decision: ${item.decision.action} · ${time(item.decision.created_at)}${item.decision.note?` · ${item.decision.note}`:''}`));content.append(evidence);
  const sourceLink=safeLink(item.reviewUrl,'Open original source ↗');if(sourceLink)content.append(sourceLink);
  const actions=$('review-actions');actions.replaceChildren();
  if(['gmail','directory'].includes(item.source)&&item.notificationRevision){const handled=item.state==='handled';const control=button(handled?'Reopen':'Mark reviewed',()=>resolveNotification({...item,id:item.sourceItemId||item.id},handled?'reopen':'handle',control),null,'Updates this dashboard only. It does not reply to mail or approve a listing.');actions.append(control);}
  if(item.source==='outreach'){
    if(item.deliveryState==='review'&&item.message?.html&&item.formatRequest&&!item.formatApproved){const control=button('Approve format',()=>outreachAction(item,'format-approve',control),null,'Allows this email format only. It does not approve the copy or send it.');actions.append(control);}
    if(item.deliveryState==='review'&&!item.issues?.length){const action=item.approved?'send':'approve';const control=button(item.approved?'Queue approved email':'Approve draft',()=>outreachAction(item,action,control),'approve',item.approved?'Queues this exact email. The sender checks it again before one attempt. Queued does not mean sent.':'Saves this exact draft approval. It does not send.');control.disabled=item.approved&&(!boardData.outreachSendingEnabled||!item.senderAvailable);actions.append(control);if(control.disabled)content.append(element('p','Sending is not available right now. The email stays unsent.','caution'));}
    if(item.deliveryState==='queued'){const control=button('Cancel queued email',()=>outreachAction(item,'cancel',control),null,'Cancels only if a send attempt has not started.');actions.append(control);}
    if(item.deliveryState==='review')for(const [action,label] of [['changes','Request changes'],['decline','Decline draft']]){const control=button(label,()=>outreachFeedback(item,action,control));actions.append(control);}
  }else if(item.workId&&item.snapshot&&!item.receipts?.length&&!['gmail','directory'].includes(item.source)){
    if(item.canApprove){const control=button('Approve draft',()=>workFeedback(item,'approve',control),'approve','Saves this version and a follow-up for the owner. No sending or publishing.');actions.append(control);}
    if(!['sent','published','closed'].includes(item.nativeState))for(const [action,label] of [['changes','Request changes'],['decline','Decline draft']]){const control=button(label,()=>workFeedback(item,action,control));actions.append(control);}
  }
  $('review-note-label').hidden=!actions.children.length;$('review-effect').textContent=actions.children.length?'Each button changes only the step named on it. Approve draft never sends or publishes.':'Opening these details does not start work. The next step is described above.';
  if(!refreshing){$('review-note').value='';$('review-error').textContent='';}if(!$('review-dialog').open)$('review-dialog').showModal();
}

async function workFeedback(item,action,control){
  if(action==='approve'&&!confirm('Approve this exact draft? This saves your decision and a follow-up for its owner. It does not send or publish.'))return;
  const note=$('review-note').value;if(action==='changes'&&!note.trim()){showBoardError('Describe the changes needed.');return;}
  control.disabled=true;actionPending=true;notificationChange++;
  try{const response=await fetch('/api/work-items/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,expectedVersion:item.version,revision:item.snapshotRevision,action,note,requestId:crypto.randomUUID()})});const result=await response.json();if(!response.ok)throw new Error(result.error);await refreshBoard(); refreshOpenReview();}catch(error){showBoardError(error.message);}finally{control.disabled=false;actionPending=false;}
}
function showBoardError(message){$('campaign-error').textContent=message;$('campaign-error').hidden=false;$('review-error').textContent=message;}
async function outreachFeedback(item,action,control){
  const note=$('review-note').value;if(action==='changes'&&!note.trim()){showBoardError('Describe the changes needed.');return;}control.disabled=true;actionPending=true;
  try{const response=await fetch('/api/outreach/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.outreachId,revision:item.revision,action,note})});const result=await response.json();if(!response.ok)throw new Error(result.error);notificationChange++;await refreshBoard(); refreshOpenReview();}catch(error){showBoardError(error.message);}finally{control.disabled=false;actionPending=false;}
}
async function resolveNotification(item,action,control){
  control.disabled=true;actionPending=true;notificationChange++;
  try{const response=await fetch(`/api/notifications/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,revision:item.notificationRevision})});const result=await response.json();if(!response.ok)throw new Error(result.error);notificationChange++;await refreshBoard(); refreshOpenReview();}catch(error){showBoardError(error.message);}finally{control.disabled=false;actionPending=false;}
}

async function outreachAction(item,action,button) {
  const verb=action==='format-approve'?'Allow the formatted version of':action==='approve'?'Approve':action==='cancel'?'Cancel the queued send of':'Queue';
  if(!confirm(`${verb} this exact email to ${item.message.recipient}?\nSubject: ${item.message.subject}\n${action==='format-approve'?`Reason: ${item.formatRequest.reason}\nThis approves only the format. Copy approval and sending remain separate.`:action==='send'?'The guarded sender checks Gmail and routing again before one send attempt.':action==='cancel'?'Cancellation succeeds only before a send attempt is reserved.':'Approval does not send it.'}`))return;
  button.disabled=true;actionPending=true;
  try {
    const response=await fetch(`/api/outreach/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.outreachId,revision:item.revision})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The email remains held.');
    await refreshBoard(); refreshOpenReview();
  }catch(error){showBoardError(error.message);}finally{button.disabled=false;actionPending=false;}
}

$('outreach-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const button=form.querySelector('button');button.disabled=true;actionPending=true;
  try{
    const packet={id:values.get('id'),lane:values.get('lane'),phase:values.get('phase'),message:{recipient:values.get('recipient'),subject:values.get('subject'),text:values.get('text'),html:values.get('html'),threadId:values.get('threadId'),inReplyTo:values.get('inReplyTo'),references:values.get('references')},...(values.get('html')?{formatRequest:{reason:values.get('formatReason')}}:{}),evidence:{sourceUrl:values.get('sourceUrl'),profileUrl:values.get('profileUrl'),publishedEmail:values.get('publishedEmail'),mailtoEmail:values.get('mailtoEmail'),fit:'current',fitFact:values.get('fitFact'),checkedBy:'sebastian.larosa@jobhackai.io',checkedAt:new Date().toISOString()}};
    const response=await fetch('/api/outreach/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save the prepared email.');
    $('outreach-status').textContent='Saved for source, routing and Gmail checks. This does not approve or send the email.';await refreshBoard(); refreshOpenReview();
  }catch(error){$('outreach-status').textContent=error.message;}finally{button.disabled=false;actionPending=false;}
});

function refreshOpenReview(){
  if(boardFailed){$('review-error').textContent='Your change was saved, but the latest status could not load. Refresh before taking another action.';showToast('Saved. Status refresh still needed.');return;}
  const current=boardData?.items.find(i=>i.id===openItemId);if(current)openReview(current,lastReviewTrigger,true);
  $('review-error').textContent='';showToast('Saved. The latest recorded status is shown.');
}
let toastTimer;
function showToast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},6500);}
async function getJSON(path){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(path,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Read failed');return await response.json();}finally{clearTimeout(timeout);}}
let boardRequestSequence=0,lastBoardRevision=null,changePollPending=false;
async function refreshBoard(){
  const sequence=++boardRequestSequence,version=notificationChange;
  try {
    const data=await getJSON('/api/work-items');
    if(sequence!==boardRequestSequence||version!==notificationChange)return false;
    boardFailed=false;$('campaign-error').hidden=true;renderCampaigns(data);renderHealth();
    if(openItemId&&!actionPending&&$('review-dialog').open){
      const current=data.items.find(item=>item.id===openItemId);
      if(current&&current.version!==reviewedItem?.version){
        if(!current.receipts?.length&&current.snapshotRevision!==reviewedItem?.snapshotRevision){
          $('review-error').textContent='This draft changed while you were reading. Close and reopen it to review the new version.';
          for(const control of $('review-actions').children)control.disabled=true;
        }else {openReview(current,lastReviewTrigger,true);$('review-error').textContent='';}
      }
    }
    return true;
  } catch {
    if(sequence!==boardRequestSequence||version!==notificationChange)return false;
    boardFailed=true;$('campaign-error').textContent='Work could not refresh. Saved cards may be old. Check again before making a decision.';$('campaign-error').hidden=false;renderHealth();return false;
  }
}
async function pollBoardChanges(){
  if(document.hidden||actionPending||changePollPending)return;
  changePollPending=true;
  try {
    const {revision}=await getJSON('/api/work-items/changes');
    if(actionPending)return;
    if((boardFailed||revision!==lastBoardRevision) && await refreshBoard())lastBoardRevision=revision;
  } catch {
    boardFailed=true;renderHealth();$('campaign-error').textContent='Live updates are disconnected. Saved cards may be old. Retrying automatically.';$('campaign-error').hidden=false;
  } finally {changePollPending=false;}
}
async function refresh(){
  const sequence=++refreshSequence;$('refresh').disabled=true;$('refresh').setAttribute('aria-label','Refreshing saved data');
  // Work renders independently of slower revenue and analytics queries.
  await Promise.all([refreshBoard(),(async()=>{
    try{const numbers=await getJSON('/api/overview');if(sequence===refreshSequence)render(numbers);}
    catch{if(sequence===refreshSequence){numbersFailed=true;$('error').textContent='Numbers could not refresh. Any saved numbers below may be old.';$('error').hidden=false;renderMetrics();}}
  })()]);
  if(sequence!==refreshSequence)return;
  renderHealth();$('refresh').disabled=false;$('refresh').setAttribute('aria-label','Refresh saved data');
}
// Startup is kept separate so the view and action rules can be tested without a live service.
$('refresh').addEventListener('click',refresh);
$('review-close').addEventListener('click',closeReview);
$('review-dialog').addEventListener('cancel',()=>{openItemId=null;reviewedItem=null;});
$('period').addEventListener('change',event=>{selectedPeriod=Number(event.target.value)===28?28:7;renderMetrics();});
$('product-filter').addEventListener('change',event=>{selectedProduct=event.target.value;if(boardData)renderCampaigns(boardData);});
$('channel-filter').addEventListener('change',event=>{selectedChannel=event.target.value;if(boardData)renderCampaigns(boardData);});
$('cost-form').addEventListener('input',()=>{costDirty=true;});
$('cost-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!currentMonth)return;const amountCents=Math.round(Number($('costs').value)*100);if(!Number.isSafeInteger(amountCents)||amountCents<0)return;
  const control=$('cost-form').querySelector('button');control.disabled=true;actionPending=true;refreshSequence++;$('cost-status').textContent='Saving…';
  try{const response=await fetch('/api/costs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:currentMonth,amountCents,complete:$('complete').checked})});if(!response.ok)throw new Error();costDirty=false;render(await response.json());showToast('Costs saved.');}catch{$('cost-status').textContent='Could not save costs. Your entry is still here.';}finally{control.disabled=false;actionPending=false;$('refresh').disabled=false;}
});
function applyTheme(theme){document.documentElement.dataset.theme=theme;const light=theme==='light';$('theme-toggle').textContent=light?'☾':'☀';$('theme-toggle').setAttribute('aria-label',`Switch to ${light?'dark':'light'} mode`);$('theme-toggle').setAttribute('aria-pressed',String(light));document.querySelector('meta[name="theme-color"]').content=light?'#f2f6f9':'#091722';}
let savedTheme='dark';try{if(localStorage.getItem('jobhackai-dashboard-theme')==='light')savedTheme='light';}catch{}applyTheme(savedTheme);
$('theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);try{localStorage.setItem('jobhackai-dashboard-theme',theme);}catch{}});
let helpTarget=null,helpTimer;
function hideHelp(){if(helpTarget)helpTarget.removeAttribute('aria-describedby');$('help-tooltip').hidden=true;helpTarget=null;}
function showHelp(target){if(!target)return;clearTimeout(helpTimer);if(helpTarget&&helpTarget!==target)helpTarget.removeAttribute('aria-describedby');helpTarget=target;const tooltip=$('help-tooltip');tooltip.textContent=target.getAttribute('data-help');tooltip.hidden=false;target.setAttribute('aria-describedby','help-tooltip');const rect=target.getBoundingClientRect(),box=tooltip.getBoundingClientRect();tooltip.style.left=`${Math.max(12,Math.min(innerWidth-box.width-12,rect.left))}px`;tooltip.style.top=`${rect.bottom+box.height+18<innerHeight?rect.bottom+8:Math.max(12,rect.top-box.height-8)}px`;}
document.addEventListener('pointerover',event=>{const target=event.target.closest?.('[data-help]');if(target&&event.pointerType!=='touch')showHelp(target);if(event.target.closest?.('#help-tooltip'))clearTimeout(helpTimer);});
document.addEventListener('pointerout',event=>{if(event.target.closest?.('[data-help],#help-tooltip'))helpTimer=setTimeout(hideHelp,200);});
document.addEventListener('focusin',event=>{const target=event.target.closest?.('[data-help]');if(target)showHelp(target);});
document.addEventListener('focusout',()=>{helpTimer=setTimeout(hideHelp,200);});
document.addEventListener('click',event=>{const target=event.target.closest?.('.help');if(target){showHelp(target);return;}if(!event.target.closest?.('#help-tooltip'))hideHelp();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('help-tooltip').hidden){hideHelp();event.preventDefault();event.stopPropagation();}},true);
window.addEventListener('scroll',hideHelp,{passive:true});
const mobileQuery=matchMedia('(max-width: 600px)');
if(mobileQuery.matches)$('trends').open=false;
mobileQuery.addEventListener('change',()=>{if(boardData)renderCampaigns(boardData);hideHelp();});
refresh();
setInterval(pollBoardChanges,2000);
setInterval(()=>{if(!document.hidden&&!actionPending)refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!actionPending)refresh();});
