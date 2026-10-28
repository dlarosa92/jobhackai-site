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
 assert.match(text(nodes.get('source-health')),/Gmail.*Current/s);assert.match(text(nodes.get('workflow-alerts')),/stalled/);
 assert.match(text(nodes.get('data-brief')),/need attention/);
 assert.match(text(nodes.get('analytics-report')),/Not observed.*Unverified/);assert.match(text(nodes.get('analytics-report')),/kit action breakdown/);assert.match(text(nodes.get('analytics-status')),/stale/);
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
 requests[2](response(numbers));requests[3](response(data([item('Newest work','Product','hold')])));await second;
 requests[0](response(numbers));requests[1](response(data([item('Old work','Product','hold')])));await first;
 assert.match(text(uiState.nodes.get('board')),/Newest work/);assert.doesNotMatch(text(uiState.nodes.get('board')),/Old work/);
 const failed=uiState.run('refresh()');requests[4]({ok:false});requests[5]({ok:false});await failed;
 assert.match(text(uiState.nodes.get('board')),/Newest work/);assert.equal(uiState.nodes.get('campaign-error').hidden,false);
 uiState.run("selectedDepartment='product';renderCampaigns(boardData)");assert.equal(uiState.nodes.get('campaign-error').hidden,false);
 assert.match(text(uiState.nodes.get('data-summary')),/Refresh failed/);
});
