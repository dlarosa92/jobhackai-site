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
function ui() {
  const nodes = new Map();
  const document = { createElement: tag => new Element(tag), getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, new Element('div'));
    return nodes.get(id);
  } };
  const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ document, URL, Intl, Date, Set });
  vm.runInContext(source.slice(0, source.indexOf("$('refresh').addEventListener")), context);
  return { render: data => { context.data = data; vm.runInContext('renderCampaigns(data)', context); }, nodes };
}
const item = (id, channel, state, extra = {}) => ({ id, channel, state, title: id, detail: 'Saved draft details', evidence: 'Source checked', impact: 'campaign', reviewUrl: 'https://chatgpt.com/space/example', updatedAt: '2026-10-17 23:00:00', ...extra });
const data = items => ({ items, asOf: '2026-10-18T02:00:00Z', gmailSync: { status: 'current', lastSuccessfulSyncAt: '2026-10-18T01:59:00Z', trackedCount: 1 } });
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(x => x.textContent).join(' ');
const lane = (nodes, title) => nodes.get('board').children.find(x => text(x.children[0]).includes(title));

test('holds, approvals, waiting emails and scheduled posts are distinct, each with plain channel names', () => {
  const { render, nodes } = ui();
  render(data([
    item('Replacement email', 'Stan · Outreach', 'hold'),
    item('Ready email', 'Stan · Email', 'pending'),
    item('Approved email', 'Stan · Email', 'approved'),
    item('LinkedIn post', 'Sonny · LinkedIn', 'scheduled'),
    item('Pinterest post', 'Sonny · Pinterest', 'hold'),
    item('Reply', 'Gmail · tracked conversation', 'waiting', { source: 'gmail', impact: 'prospect', detail: 'I&#39;d like to connect &amp; talk. &lt;script&gt;' }),
  ]));
  assert.match(text(lane(nodes, 'Being prepared')), /Email · Not ready for approval.*Replacement email/);
  assert.equal(walk(lane(nodes, 'Being prepared')).some(x => x.className === 'approve'), false);
  assert.match(text(lane(nodes, 'Needs your approval')), /Ready email.*Approve this draft/);
  assert.match(text(lane(nodes, 'Approved, not sent or scheduled')), /Email · Approved, not sent.*Approved email/);
  assert.doesNotMatch(text(lane(nodes, 'Approved, not sent or scheduled')), /LinkedIn post/);
  assert.match(text(lane(nodes, 'Scheduled posts')), /LinkedIn · Post scheduled.*LinkedIn post/);
  assert.match(text(lane(nodes, 'Waiting for an email reply')), /Email · Waiting for an email reply/);
  assert.doesNotMatch(text(nodes.get('board')), /outreach/i);
  assert.match(text(nodes.get('board')), /I'd like to connect & talk. <script>/);
  assert.equal(walk(nodes.get('board')).filter(x => x.tag === 'script').length, 0);
  assert.match(nodes.get('campaign-checked').textContent, /Oct 17, 2026, 7:00 PM ET/);
});

test('platform filter and expanded drafts survive refresh, with honest empty Pinterest status', () => {
  const { render, nodes } = ui();
  const items = Array.from({ length: 5 }, (_, i) => item(`Email ${i}`, 'Stan · Email', 'hold'));
  render(data([...items, item('Post', 'Sonny · LinkedIn', 'scheduled')]));
  nodes.get('channel-filters').children.find(x => x.textContent.startsWith('Email (')).listeners.click();
  assert.doesNotMatch(text(nodes.get('board')), /LinkedIn ·/);
  const preparing = lane(nodes, 'Being prepared');
  preparing.children.find(x => x.className === 'show-more').listeners.click();
  render(data([...items, item('New post', 'Sonny · LinkedIn', 'scheduled')]));
  assert.match(text(lane(nodes, 'Being prepared')), /Email 4/);
  assert.doesNotMatch(text(nodes.get('board')), /New post/);
  nodes.get('channel-filters').children.find(x => x.textContent.startsWith('Pinterest (')).listeners.click();
  assert.match(nodes.get('filter-status').textContent, /No Pinterest items are saved/);
  assert.match(nodes.get('filter-status').textContent, /does not mean there is no activity/);
  assert.match(nodes.get('focus-text').textContent, /5 saved drafts are still being prepared/);
});

test('unknown channels are explicit and untrusted review URLs do not become links', () => {
  const { render, nodes } = ui();
  render(data([item('Unknown draft', 'Stan', 'hold', { reviewUrl: 'javascript:alert(1)' })]));
  assert.match(text(nodes.get('board')), /Channel not recorded/);
  assert.equal(walk(nodes.get('board')).filter(x => x.tag === 'a').length, 0);
});
