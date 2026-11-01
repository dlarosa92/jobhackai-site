import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.textContent = ''; this.style={setProperty(){}}; this.open=false; this.showModal=()=>{this.open=true;}; this.close=()=>{this.open=false;}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, value) { this.listeners[key] = value; }
}
function ui(options = {}) {
  const nodes = new Map(['review-dialog','review-note','review-error'].map(id=>[id,new Element('div')]));
  const document = { createElement: tag => new Element(tag), getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, new Element('div'));
    return nodes.get(id);
  } };
  const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ document, URL, Intl, Date, Set, ...options });
  vm.runInContext(source.slice(0, source.indexOf("$('refresh').addEventListener")), context);
  return { render: data => { context.data = data; vm.runInContext('renderCampaigns(data)', context); }, run: code=>vm.runInContext(code,context), nodes };
}
const item = (id, channel, state, extra = {}) => ({ id, channel, state, title: id, detail: 'Saved draft details', evidence: 'Source checked', impact: 'campaign', reviewUrl: 'https://chatgpt.com/space/example', updatedAt: '2026-10-17 23:00:00', ...extra });
const data = items => ({ items, asOf: '2026-10-18T02:00:00Z', gmailSync: { status: 'current', lastSuccessfulSyncAt: '2026-10-18T01:59:00Z', trackedCount: 1 } });

test('zero decisions is calm, real decisions are highlighted, and a failed read cannot claim none',()=>{
 const view=ui();view.render(data([]));
 assert.equal(view.nodes.get('attention').className,'attention');
 assert.equal(view.nodes.get('attention-title').textContent,'Nothing ready for your approval');
 assert.equal(view.nodes.get('decision-count').hidden,true);
 view.render(data([item('Ready','Facebook','pending',{canApprove:true,boardLane:'ready'})]));
 assert.equal(view.nodes.get('attention').className,'attention needs-action');
 assert.equal(view.nodes.get('decision-count').hidden,false);
 assert.equal(view.nodes.get('decision-count').textContent,1);
 view.run('boardFailed=true;renderHealth()');
 assert.equal(view.nodes.get('attention-title').textContent,'Decision list could not refresh');
 assert.equal(view.nodes.get('attention').className,'attention unavailable');
 assert.equal(view.nodes.get('decision-count').hidden,true);
 view.run('boardFailed=false');view.render(data([]));
 assert.equal(view.nodes.get('attention').className,'attention');
});

test('money warnings explain missing verification; test counts stay neutral; Stripe has no invented check time',()=>{
 const view=ui();view.render(data([]));
 view.run(`render({asOf:'2026-10-31T20:00:00Z',month:'2026-10',netCollectedCents:1700,costCents:null,business:{periods:{7:{start:'2026-10-24',end:'2026-10-30',previousStart:'2026-10-17',previousEnd:'2026-10-23',metrics:[
 {id:'customers',label:'Paying customers',value:null,previous:null,change:null,series:[]},
 {id:'money',label:'Money collected',value:1700,previous:0,change:1700,series:[]},
 {id:'accounts',label:'New accounts',value:0,previous:0,change:0,series:[]},
 {id:'interviews',label:'Interviews finished',value:2,previous:3,change:-1,series:[]}
 ]}}}})`);
 const cards=view.nodes.get('kpi-grid').children;
 assert.match(text(cards[0]),/Unavailable.*Needs attention.*Paid customer count is missing/s);
 assert.match(text(cards[1]),/\$17.00.*Needs attention.*Total is not verified with Stripe/s);
 assert.match(text(cards[2]),/Includes staff and test accounts/);
 assert.doesNotMatch(text(cards[2]),/Needs attention/);
 assert.match(text(cards[3]),/Includes staff and test interviews/);
 const stripe=view.nodes.get('source-health').children.find(c=>c.attributes['data-disclosure-key']==='Stripe');
 assert.match(text(stripe),/Next: compare the saved payments and current paid accounts with Stripe/);
 assert.doesNotMatch(text(stripe),/Checked|Last attempt|Oct 31/);
 walk(cards[0]).find(n=>n.tag==='a').listeners.click();
 assert.equal(view.nodes.get('data-health').open,true);
 view.run('numbersFailed=true;renderMetrics();renderHealth()');
 assert.match(text(view.nodes.get('kpi-grid')),/Refresh failed. Saved numbers may be old/);
 assert.equal(view.nodes.get('data-summary').className,'red');
});

test('source indicators explain success and preserve incomplete or missing coverage',()=>{
 const view=ui();const state=data([]);
 state.sources=[{source:'marblism',status:'incomplete',checked_at:'2026-10-31T20:00:00Z',detail:'Native pages did not load.'}];
 state.analytics={status:'current',report:{checkedAt:'2026-10-31T20:00:00Z',coverage:{internalTrafficExcluded:true}}};
 state.directorySource={status:'current',checkedAt:'2026-10-31T20:00:00Z'};
 view.render(state);
 const card=name=>view.nodes.get('source-health').children.find(c=>c.attributes['data-disclosure-key']===name);
 assert.match(text(card('Gmail')),/Up to date.*Tracked email synced successfully/s);
 assert.match(text(card('Website analytics')),/Needs attention.*not fully verified/s);
 assert.match(text(card('Marblism')),/Needs attention.*Retry the source refresh/s);
 assert.doesNotMatch(text(card('Marblism')),/Up to date/);
 state.sources[0].status='current';view.render(state);
 assert.match(text(card('Marblism')),/Up to date.*pages were read successfully/s);
 state.sources[0].status='stale';view.render(state);
 assert.match(text(card('Marblism')),/Needs attention.*overdue/s);
});

test('background failures explain the next step without creating a fake owner decision',()=>{
 const view=ui();const state=data([]);
 state.workflow={alerts:[{id:'workflow-preparation',detail:'Preparation failed.'}],workflows:[{id:'preparation',status:'failed',lastRun:{result:{summary:'No saved work changed.'}}}]};
 view.render(state);
 assert.equal(view.nodes.get('data-summary').textContent,'Needs attention: 1 background job');
 assert.match(text(view.nodes.get('data-brief')),/Prepare work: The last run failed.*Fix the error/s);
 assert.match(text(view.nodes.get('workflow-runs')),/Needs attention.*Fix the error.*No saved work changed/s);
 assert.equal(view.nodes.get('attention-title').textContent,'Nothing ready for your approval');
 assert.equal(view.nodes.get('attention').className,'attention');
});
test('overdue blocked jobs keep their completed history and point to the saved blocker',()=>{
 const view=ui();const state=data([]);
 state.workflow={alerts:[{id:'workflow-preparation',detail:'Preparation follow-up overdue.'}],workflows:[{id:'preparation',status:'overdue',lastSuccessAt:'2026-10-30T20:00:00Z',lastRun:{result:{summary:'Waiting for required source access.',blocker:'Required source access',nextCheckAt:'2026-10-31T12:00:00Z'}}}]};
 view.render(state);
 assert.match(text(view.nodes.get('data-brief')),/Prepare work: The follow-up date has passed.*Review the saved blocker/s);
 assert.match(text(view.nodes.get('workflow-runs')),/Needs attention.*resolve it, then rerun this job.*Last completed check:.*Waiting for required source access/s);
 assert.doesNotMatch(text(view.nodes.get('workflow-runs')),/No successful update|Run the source refresh|No completed check saved/);
});
test('workflow messages distinguish old success from no history and scheduled waiting',()=>{
 const view=ui();const state=data([]);const run={id:'coordination',status:'missing',lastSuccessAt:'2026-10-20T12:00:00Z'};
 state.workflow={alerts:[{id:'workflow-coordination'}],workflows:[run]};view.render(state);
 assert.match(text(view.nodes.get('workflow-runs')),/Needs attention.*last completed check is too old.*rerun this job.*Last completed check:/s);
 assert.doesNotMatch(text(view.nodes.get('workflow-runs')),/No completed run is saved/);
 run.lastSuccessAt=null;view.render(state);
 assert.match(text(view.nodes.get('workflow-runs')),/No completed run is saved. Run this job/);
 run.status='waiting';state.workflow.alerts=[];view.render(state);
 assert.match(text(view.nodes.get('workflow-runs')),/Waiting.*first scheduled run/s);
 assert.doesNotMatch(text(view.nodes.get('workflow-runs')),/Needs attention|Run the source refresh/);
});
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(x => x.textContent).join(' ');
const lane = (nodes, title) => nodes.get('board').children.find(x => text(x.children[0]).includes(title));


test('the board separates decisions, preparation, backlog, blockers and completed activity',()=>{
 const {render,nodes}=ui();render(data([
 item('Ready social','Sonny · Facebook','pending',{boardLane:'ready',canApprove:true,department:'marketing'}),
 item('Copy checks','Penny · Blog','hold',{boardLane:'in_progress'}),
 item('Measure signups','Product','hold',{boardLane:'up_next',department:'product'}),
 item('Suppressed contact','Email','hold',{boardLane:'blocked',department:'sales'}),
 item('Published post','LinkedIn','published',{boardLane:'completed'}),
 ]));
 assert.match(text(lane(nodes,'Needs you')),/Ready social/);
 assert.match(text(lane(nodes,'Working')),/Copy checks/);
 assert.match(text(nodes.get('next-work')),/Measure signups/);
 assert.match(text(lane(nodes,'Waiting')),/Suppressed contact/);
 assert.match(text(lane(nodes,'Done')),/Published post/);
 assert.match(text(nodes.get('next-decisions')),/Ready social/);
 assert.doesNotMatch(text(nodes.get('next-decisions')),/Suppressed contact|Published post/);
});
test('department and platform filters persist through refresh',()=>{
 const uiState=ui();const {render,nodes}=uiState;const items=[item('Social','Facebook','hold',{department:'marketing'}),item('Feature','Product','hold',{department:'product'})];render(data(items));
 nodes.get('department-filters').children.find(x=>x.textContent==='Product').listeners.click();render(data(items));
 assert.match(text(nodes.get('board')),/Feature/);assert.doesNotMatch(text(nodes.get('board')),/Social/);
 uiState.run("selectedChannel='Pinterest';renderCampaigns(boardData)");
 assert.match(nodes.get('filter-status').textContent,/does not prove there is no activity/);
});
test('all draft cards open full copy inside one accessible dialog; unsafe URLs and HTML remain inert',()=>{
 const {render,nodes}=ui();const full='Complete draft <script>untrusted()</script> with all of the copy.';
 render(data([item('Exact post','Facebook','pending',{boardLane:'ready',workId:'one',canApprove:true,snapshot:{text:full,html:'<script>untrusted()</script>',destination:'Exact company account',timing:'Monday after release',media:[],links:[],evidence:[]},reviewUrl:'javascript:alert(1)'})]));
 nodes.get('review-dialog').showModal=()=>{nodes.get('review-dialog').open=true;};
 walk(lane(nodes,'Needs you')).find(x=>x.className==='card-title').listeners.click();
 assert.equal(nodes.get('review-dialog').open,true);assert.match(text(nodes.get('review-content')),/Complete draft.*Exact company account|Exact company account.*Complete draft/s);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='script'),false);
 const frame=walk(nodes.get('review-content')).find(x=>x.tag==='iframe');assert.equal(frame.attributes.sandbox,'');assert.match(frame.srcdoc,/default-src/);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='a'),false);
 assert.match(text(nodes.get('review-actions')),/Approve.*Request changes.*Decline/);
});
test('incomplete summaries cannot expose an approval button and empty decisions explain real work',()=>{
 const {render,nodes}=ui();render(data([item('Incomplete','Facebook','pending')]));
 nodes.get('review-dialog').showModal=()=>{};
 walk(lane(nodes,'Working')).find(x=>x.className==='card-title').listeners.click();
 assert.doesNotMatch(text(nodes.get('review-actions')),/Approve/);
 assert.match(text(nodes.get('review-content')),/complete draft, destination and media have not been verified/i);
 assert.match(text(nodes.get('next-decisions')),/1 being prepared/);
 assert.doesNotMatch(nodes.get('focus-text').textContent,/caught up/i);
});
test('healthy Gmail cannot hide a stalled preparation run or a partial Analytics report',()=>{
 const {render,nodes}=ui();const state=data([]);
 state.workflow={alerts:[{detail:'Content preparation: stalled. No completed receipt.'}],workflows:[{label:'Content preparation',status:'stalled',lastSuccessAt:null,lastRun:null}]};
 state.analytics={status:'stale',detail:'Source observation only.',report:{startDate:'2026-09-27',endDate:'2026-10-24',checkedAt:'2026-10-25T14:00:00Z',sourceUrl:'https://analytics.google.com/analytics/web/',events:[{name:'partner_kit_action',count:6,users:1}],coverage:{internalTrafficExcluded:false,attributionVerified:false,purchasesReconciled:false,campaignBreakdownComplete:false,kitActionBreakdownComplete:false},notes:'One reported user is not six customers.'}};
 render(state);
 assert.match(text(nodes.get('source-health')),/Gmail.*Up to date.*Tracked email synced successfully/s);assert.match(text(nodes.get('workflow-alerts')),/stalled/);
 assert.match(text(nodes.get('data-brief')),/need attention/);
 assert.match(text(nodes.get('analytics-report')),/Not observed.*Unverified/);assert.match(text(nodes.get('analytics-report')),/kit action breakdown/);assert.match(text(nodes.get('analytics-status')),/report is overdue/);
});
test('directory outages remain visible with an empty queue, cached history, and recovery',()=>{
 const {render,nodes}=ui();const state=data([]);state.directorySource={status:'unavailable'};
 render(state);
 assert.match(text(nodes.get('data-summary')),/directory check failed/i);
 assert.match(text(nodes.get('data-brief')),/New requests could be missing.*No successful check is saved/s);
 assert.match(text(nodes.get('source-health')),/Directory requests.*Needs attention.*Directory check failed.*No check time saved/s);
 state.directorySource.lastSuccessfulCheckAt='2026-10-25T14:00:00Z';render(state);
 assert.match(text(nodes.get('data-brief')),/Last successful check: Oct 25, 2026/);
 assert.match(text(nodes.get('source-health')),/Directory requests.*Needs attention.*Last successful check Oct 25, 2026/s);
 state.directorySource={status:'current',checkedAt:'2026-10-28T04:00:00Z',truncated:true};render(state);
 assert.doesNotMatch(text(nodes.get('data-summary')),/directory check failed/i);
 assert.match(text(nodes.get('data-summary')),/newest 200/);
 state.directorySource.truncated=false;render(state);
 assert.match(text(nodes.get('source-health')),/Directory requests.*Up to date.*Listing requests loaded successfully.*Checked Oct 2[78], 2026/s);
 assert.doesNotMatch(text(nodes.get('data-brief')),/requests could be missing|newest 200/);
});
test('prospect review shows the format and holds copy approval behind a separate format decision',()=>{
 const {render,nodes}=ui();nodes.get('review-dialog');
 const outreach=item('Coach email','Email','hold',{source:'outreach',outreachId:'coach',deliveryState:'review',revision:'a'.repeat(64),message:{recipient:'coach@example.com',subject:'Practice',text:'Complete email',html:'<p>Complete email</p>'},formatRequest:{reason:'The recipient requested a formatted comparison.'},formatApproved:false,issues:['HTML needs owner format approval.']});
 nodes.get('review-dialog').showModal=()=>{};
 render(data([outreach]));walk(nodes.get('board')).find(x=>x.className==='card-title').listeners.click();
 assert.match(text(nodes.get('review-content')),/Format exception: The recipient requested/);
 assert.match(text(nodes.get('review-actions')),/Approve format/);
 assert.equal(nodes.get('review-actions').children.some(x=>x.textContent==='Approve draft'),false);
 outreach.message.html='';outreach.formatRequest=null;outreach.issues=[];
 render(data([outreach]));walk(nodes.get('board')).find(x=>x.className==='card-title').listeners.click();assert.match(text(nodes.get('review-content')),/Format: Plain text with visible URLs/);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='iframe'),false);
 assert.equal(nodes.get('review-actions').children.some(x=>x.textContent==='Approve draft'),true);
});

test('approved but unsent work is visible under Needs you, without another approval or unsupported send',()=>{
 const {render,nodes}=ui();const approved=item('Approved reply','Nextdoor','approved',{id:'michael-nextdoor-reply',boardLane:'blocked',workId:'michael',canApprove:false,department:'sales',nativeState:'draft',snapshot:{text:'The approved reply',destination:'Native thread',timing:'After release',media:[],links:[],evidence:[]},decision:{action:'approve',created_at:'2026-10-24T12:00:00Z'}});
 render(data([approved]));assert.match(text(lane(nodes,'Needs you')),/Michael’s reply.*Approved · not sent/s);
 walk(lane(nodes,'Needs you')).find(x=>x.className==='card-title').listeners.click();
 assert.doesNotMatch(text(nodes.get('review-actions')),/Approve draft|Queue approved email/);
 assert.match(text(nodes.get('review-content')),/no send or publish connection/);assert.match(text(nodes.get('review-content')),/View approved draft/);
});
test('an open review keeps its note and disables old actions after a source revision changes',()=>{
 const {render,nodes}=ui();const ready=item('Ready','Facebook','pending',{workId:'ready',canApprove:true,boardLane:'ready',version:1,snapshot:{text:'One',destination:'Page',timing:'Tomorrow',media:[],links:[],evidence:[]}});
 render(data([ready]));walk(nodes.get('board')).find(x=>x.className==='card-title').listeners.click();nodes.get('review-note').value='Keep my feedback';
 render(data([{...ready,version:2,snapshot:{...ready.snapshot,text:'Two'}}]));
 assert.equal(nodes.get('review-note').value,'Keep my feedback');assert.match(nodes.get('review-error').textContent,/changed while you were reading/);assert.equal(nodes.get('review-actions').children.every(x=>x.disabled),true);
});
test('mobile shows the same priority order and collapses completed activity',()=>{
 const {render,nodes}=ui({matchMedia:()=>({matches:true})});render(data([item('First','Product','hold',{department:'product'}),item('Second','Email','waiting'),item('Third','Facebook','hold'),item('Fourth','Facebook','hold'),item('Old sent','Email','sent')]));
 const cards=nodes.get('board').children.filter(x=>x.className==='item');assert.equal(cards.length,3);assert.match(text(cards[0]),/First/);assert.match(text(cards[1]),/Second/);
 const completed=nodes.get('board').children.find(x=>x.tag==='details');assert.equal(completed.open,false);assert.match(text(completed),/Old sent/);
});
test('queued, uncertain and scheduled work cannot be displayed as done',()=>{
 const {run}=ui();
 assert.equal(run("displayLane({source:'outreach',state:'approved',approved:true,deliveryState:'queued'})"),'waiting');
 assert.equal(run("stateLabel({source:'outreach',deliveryState:'queued'})"),'Queued · not sent');
 assert.equal(run("displayLane({state:'scheduled',boardLane:'in_progress'})"),'waiting');
 assert.equal(run("stateLabel({deliveryState:'uncertain'})"),'Send result unknown');
});

test('an older network response cannot replace a newer board; a failed read keeps the last cards and warning',async()=>{
 const requests=[];const uiState=ui({AbortController,setTimeout,clearTimeout,fetch:()=>new Promise(resolve=>requests.push(resolve))});
 const first=uiState.run('refresh()'),second=uiState.run('refresh()');
 const numbers={asOf:'2026-10-27T12:00:00Z',month:'2026-10',netCollectedCents:0,d1UserRecords:38,userGoal:250,costCents:null,costsComplete:false,estimatedAvailableCents:null};
 const response=payload=>({ok:true,json:async()=>payload});
 requests[3](response(numbers));requests[2](response(data([item('Newest work','Product','hold')])));await second;
 requests[1](response(numbers));requests[0](response(data([item('Old work','Product','hold')])));await first;
 assert.match(text(uiState.nodes.get('board')),/Newest work/);assert.doesNotMatch(text(uiState.nodes.get('board')),/Old work/);
 const failed=uiState.run('refresh()');requests[4]({ok:false});requests[5]({ok:false});await failed;
 assert.match(text(uiState.nodes.get('board')),/Newest work/);assert.equal(uiState.nodes.get('campaign-error').hidden,false);
 uiState.run("selectedDepartment='product';renderCampaigns(boardData)");assert.equal(uiState.nodes.get('campaign-error').hidden,false);
 assert.match(text(uiState.nodes.get('data-summary')),/refresh failed/i);
});

for(let round=1;round<=3;round++)test(`live update replay ${round}: publication appears without reload and unchanged polls stay cheap`,async()=>{
 let revision=1,reads=0,fail=false;
 let current=data([item('Live post','Facebook','approved',{boardLane:'in_progress'})]);
 const view=ui({AbortController,setTimeout,clearTimeout,fetch:async path=>{
  if(fail)throw Error('offline');
  if(path==='/api/work-items/changes')return {ok:true,json:async()=>({revision})};
  assert.equal(path,'/api/work-items');reads++;return {ok:true,json:async()=>current};
 }});
 await view.run('pollBoardChanges()');assert.match(text(lane(view.nodes,'Needs you')),/Live post/);
 current=data([item('Live post','Facebook','published',{boardLane:'completed'})]);revision++;
 await view.run('pollBoardChanges()');assert.match(text(lane(view.nodes,'Done')),/Live post/);
 assert.doesNotMatch(text(lane(view.nodes,'Needs you')),/Live post/);
 await view.run('pollBoardChanges()');assert.equal(reads,2,'No full board read when nothing changed');
 fail=true;await view.run('pollBoardChanges()');assert.equal(view.nodes.get('campaign-error').hidden,false);
 fail=false;await view.run('pollBoardChanges()');assert.equal(view.nodes.get('campaign-error').hidden,true);
 assert.match(text(lane(view.nodes,'Done')),/Live post/);
});
test('slow metrics never delay a saved board change',async()=>{
 let releaseMetrics;const view=ui({AbortController,setTimeout,clearTimeout,fetch:async path=>path==='/api/overview'?new Promise(resolve=>{releaseMetrics=resolve;}):({ok:true,json:async()=>data([item('Already published','Facebook','published',{boardLane:'completed'})])})});
 const pending=view.run('refresh()');await new Promise(resolve=>setImmediate(resolve));
 assert.match(text(lane(view.nodes,'Done')),/Already published/);
 releaseMetrics({ok:false});await pending;
});
test('a pending action or hidden tab does not start a competing poll',async()=>{
 let requests=0;const view=ui({fetch:()=>{requests++;throw Error('unexpected');}});
 view.run('actionPending=true');await view.run('pollBoardChanges()');assert.equal(requests,0);
 view.run('actionPending=false;document.hidden=true');await view.run('pollBoardChanges()');assert.equal(requests,0);
});

test('release receipts override old draft approval labels and remove draft actions',()=>{
 const view=ui();const release=item('Release candidate','Product','hold',{workId:'release',department:'product',nativeState:'draft',boardLane:'in_progress',decision:{action:'approve'},snapshot:{text:'Old approved draft',media:[],links:[],evidence:[]},receipts:[{stage:'dev_deployed',summary:'Deployed candidate',evidence_url:'https://example.com/deployment'}],nextAction:'Complete development acceptance.'});
 view.render(data([release]));assert.match(text(lane(view.nodes,'Working')),/Release candidate/);assert.doesNotMatch(text(lane(view.nodes,'Needs you')),/Release candidate/);
 walk(lane(view.nodes,'Working')).find(x=>x.className==='card-title').listeners.click();
 assert.match(text(view.nodes.get('review-content')),/Complete development acceptance/);
 assert.doesNotMatch(text(view.nodes.get('review-actions')),/Approve|Decline|Request changes/);
 release.snapshot=null;release.source='github';release.state='closed';release.nativeState='closed';release.boardLane='completed';release.receipts=[{stage:'production_verified',summary:'Production checks passed',evidence_url:'https://example.com/deployment'}];
 view.render(data([release]));walk(lane(view.nodes,'Done')).find(x=>x.className==='card-title').listeners.click();
 assert.match(text(view.nodes.get('review-content')),/Production checks passed/);
 assert.doesNotMatch(text(view.nodes.get('review-content')),/draft, destination and media have not been verified|finish preparation before approval/);
});
test('open details reflect completion without another click and changed copy cannot be silently approved',async()=>{
 let current=data([item('Visible draft','Facebook','hold',{version:1,workId:'visible',snapshotRevision:'v1',canApprove:true,boardLane:'ready',snapshot:{text:'Exact copy',links:[],media:[],evidence:[]}})]);
 const view=ui({AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>current})});
 view.render(current);walk(lane(view.nodes,'Needs you')).find(x=>x.className==='card-title').listeners.click();
 current=data([{...current.items[0],version:2,snapshotRevision:'v2'}]);await view.run('refreshBoard()');
 assert.match(view.nodes.get('review-error').textContent,/Close and reopen/);assert.ok(view.nodes.get('review-actions').children.every(x=>x.disabled));
 current=data([{...current.items[0],version:3,state:'published',nativeState:'published',boardLane:'completed',canApprove:false,receipts:[{stage:'published',summary:'Verified live post',evidence_url:'https://example.com/post'}],nextAction:'Publication verified.'}]);
 await view.run('refreshBoard()');assert.match(text(view.nodes.get('review-content')),/Verified live post/);assert.equal(view.nodes.get('review-actions').children.length,0);
});

test('the source-check panel names missing Marblism coverage even when a run note claims success',()=>{
 const {render,nodes}=ui();const state=data([]);
 state.workflow={alerts:[],workflows:[{id:'reconciliation',status:'incomplete',requiredSources:['marblism','campaign','gmail','directory','github'],lastSuccessAt:null,lastRun:{result:{summary:'Checked GitHub',coverage:{verified:['github']}}}}]};
 render(state);
 assert.match(text(nodes.get('workflow-runs')),/Every 30 minutes/);
 assert.match(text(nodes.get('workflow-runs')),/Verified in the last run: github/);
 assert.match(text(nodes.get('workflow-runs')),/Still unverified: marblism, campaign, gmail, directory/);
 assert.doesNotMatch(text(nodes.get('workflow-runs')),/Check completed/);
});

for(let round=1;round<=3;round++)test(`verified Stripe indicators clear only with a current comparison, round ${round}`,()=>{
 const view=ui();view.render(data([]));
 view.run(`render({asOf:'2026-11-01T17:00:00Z',month:'2026-11',netCollectedCents:0,costCents:null,stripe:{status:'current',customers:0,checkedAt:'2026-11-01T17:00:00Z',detail:'Payments match Stripe.'},business:{periods:{7:{start:'2026-10-25',end:'2026-10-31',previousStart:'2026-10-18',previousEnd:'2026-10-24',metrics:[
 {id:'customers',label:'Paying customers',value:0,status:'verified',previous:null,change:null,series:[]},
 {id:'money',label:'Money collected',value:1700,status:'verified',previous:0,change:1700,series:[]}
 ]}}}})`);
 const stripe=()=>view.nodes.get('source-health').children.find(c=>c.attributes['data-disclosure-key']==='Stripe');
 assert.match(text(stripe()),/Up to date.*match Stripe/s);assert.doesNotMatch(text(stripe()),/Needs attention/);
 assert.match(text(view.nodes.get('kpi-grid').children[0]),/0.*Verified with Stripe.*Staff accounts excluded/s);
 assert.equal(view.nodes.get('goal-status').textContent,'0 paying customers');
 view.run("overviewData.stripe={status:'incomplete',detail:'App records changed after the Stripe check.'};renderHealth()");
 assert.match(text(stripe()),/Needs attention.*App records changed/s);assert.doesNotMatch(text(stripe()),/Up to date/);
});
