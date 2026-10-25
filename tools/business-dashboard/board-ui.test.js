import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, value) { this.listeners[key] = value; }
}
function ui(options = {}) {
  const nodes = new Map();
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
 assert.match(text(lane(nodes,'Ready for your review')),/Ready social/);
 assert.match(text(lane(nodes,'In progress')),/Copy checks/);
 assert.match(text(lane(nodes,'Up next')),/Measure signups/);
 assert.equal(lane(nodes,'Waiting or blocked').open,false);
 assert.equal(lane(nodes,'Completed activity').open,false);
 assert.match(text(nodes.get('next-decisions')),/Ready social/);
 assert.doesNotMatch(text(nodes.get('next-decisions')),/Suppressed contact|Published post/);
});
test('department and platform filters persist through refresh',()=>{
 const {render,nodes}=ui();const items=[item('Social','Facebook','hold',{department:'marketing'}),item('Feature','Product','hold',{department:'product'})];render(data(items));
 nodes.get('department-filters').children.find(x=>x.textContent==='Product & Technology').listeners.click();render(data(items));
 assert.match(text(nodes.get('board')),/Feature/);assert.doesNotMatch(text(nodes.get('board')),/Social/);
 nodes.get('channel-filters').children.find(x=>x.textContent.startsWith('Pinterest (')).listeners.click();
 assert.match(nodes.get('filter-status').textContent,/does not mean there is no native activity/);
});
test('all draft cards open full copy inside one accessible dialog; unsafe URLs and HTML remain inert',()=>{
 const {render,nodes}=ui();const full='Complete draft <script>untrusted()</script> with all of the copy.';
 render(data([item('Exact post','Facebook','pending',{boardLane:'ready',workId:'one',canApprove:true,snapshot:{text:full,html:'<script>untrusted()</script>',destination:'Exact company account',timing:'Monday after release',media:[],links:[],evidence:[]},reviewUrl:'javascript:alert(1)'})]));
 nodes.get('review-dialog').showModal=()=>{nodes.get('review-dialog').open=true;};
 walk(lane(nodes,'Ready for your review')).find(x=>x.className==='card-title').listeners.click();
 assert.equal(nodes.get('review-dialog').open,true);assert.match(text(nodes.get('review-content')),/Complete draft.*Exact company account|Exact company account.*Complete draft/s);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='script'),false);
 const frame=walk(nodes.get('review-content')).find(x=>x.tag==='iframe');assert.equal(frame.attributes.sandbox,'');assert.match(frame.srcdoc,/default-src/);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='a'),false);
 assert.match(text(nodes.get('review-actions')),/Approve.*Request changes.*Decline/);
});
test('incomplete summaries cannot expose an approval button and empty decisions explain real work',()=>{
 const {render,nodes}=ui();render(data([item('Incomplete','Facebook','pending')]));
 nodes.get('review-dialog').showModal=()=>{};
 walk(lane(nodes,'In progress')).find(x=>x.className==='card-title').listeners.click();
 assert.doesNotMatch(text(nodes.get('review-actions')),/Approve/);
 assert.match(text(nodes.get('review-content')),/complete draft, destination and media have not been verified/);
 assert.match(nodes.get('focus-text').textContent,/1 items in progress/);
 assert.doesNotMatch(nodes.get('focus-text').textContent,/caught up/i);
});
test('healthy Gmail cannot hide a stalled preparation run or a partial Analytics report',()=>{
 const {render,nodes}=ui();const state=data([]);
 state.workflow={alerts:[{detail:'Content preparation: stalled. No completed receipt.'}],workflows:[{label:'Content preparation',status:'stalled',lastSuccessAt:null,lastRun:null}]};
 state.analytics={status:'stale',detail:'Source observation only.',report:{startDate:'2026-09-27',endDate:'2026-10-24',checkedAt:'2026-10-25T14:00:00Z',sourceUrl:'https://analytics.google.com/analytics/web/',events:[{name:'partner_kit_action',count:6,users:1}],coverage:{internalTrafficExcluded:false,attributionVerified:false,purchasesReconciled:false,campaignBreakdownComplete:false,kitActionBreakdownComplete:false},notes:'One reported user is not six customers.'}};
 render(state);
 assert.match(text(nodes.get('gmail-sync')),/current/);assert.match(text(nodes.get('workflow-alerts')),/stalled/);
 assert.match(text(nodes.get('workflow-summary')),/needs? attention/);
 assert.match(text(nodes.get('analytics-report')),/Not observed.*Unverified/);assert.match(text(nodes.get('analytics-report')),/kit action breakdown/);assert.match(text(nodes.get('analytics-status')),/stale/);
});
test('prospect review shows the format and holds copy approval behind a separate format decision',()=>{
 const {render,nodes}=ui();nodes.get('review-dialog');
 const outreach=item('Coach email','Email','hold',{source:'outreach',outreachId:'coach',deliveryState:'review',revision:'a'.repeat(64),message:{recipient:'coach@example.com',subject:'Practice',text:'Complete email',html:'<p>Complete email</p>'},formatRequest:{reason:'The recipient requested a formatted comparison.'},formatApproved:false,issues:['HTML needs owner format approval.']});
 nodes.get('review-dialog').showModal=()=>{};
 render(data([outreach]));walk(nodes.get('board')).find(x=>x.className==='card-title').listeners.click();
 assert.match(text(nodes.get('review-content')),/Format exception: The recipient requested/);
 assert.match(text(nodes.get('review-actions')),/Approve format exception/);
 assert.equal(nodes.get('review-actions').children.some(x=>x.textContent==='Approve'),false);
 outreach.message.html='';outreach.formatRequest=null;outreach.issues=[];
 render(data([outreach]));assert.match(text(nodes.get('review-content')),/Format: Plain text with visible URLs/);
 assert.equal(walk(nodes.get('review-content')).some(x=>x.tag==='iframe'),false);
 assert.equal(nodes.get('review-actions').children.some(x=>x.textContent==='Approve'),true);
});
