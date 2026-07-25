// Ordered transcript assembly test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-transcript-order.test.mjs
//
// Covers the real-session bug: the Realtime API delivers a user turn's
// whisper transcript AFTER the assistant transcript for the turn it
// preceded, so arrival-order appending scrambled the conversation that gets
// stored, shown to the candidate, and fed to the scorecard model.

import assert from 'node:assert/strict';
import { createTranscriptOrder } from '../../../../js/voice-transcript-order.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

const asyncTests = [];
function asyncTest(name, fn) {
  asyncTests.push(async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
  });
}

test('out-of-order transcripts land in conversation order', () => {
  const o = createTranscriptOrder();
  // Items are announced in true order...
  o.noteItem('item_user_1');
  o.noteItem('item_asst_1');
  o.noteItem('item_user_2');
  // ...but transcripts arrive scrambled (assistant first, user late)
  o.setText('item_asst_1', 'assistant', 'So 45 customers served?');
  o.setText('item_user_2', 'user', 'Yes, about 45.');
  o.setText('item_user_1', 'user', 'It was Christmas Eve.');

  assert.deepEqual(o.list(), [
    { speaker: 'user', text: 'It was Christmas Eve.' },
    { speaker: 'assistant', text: 'So 45 customers served?' },
    { speaker: 'user', text: 'Yes, about 45.' }
  ]);
});

test('the reported symptom is fixed: interviewer never precedes the candidate', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1');
  // Assistant transcript arrives before the user transcript it responded to
  o.setText('a1', 'assistant', 'Take your time - so the employee quit.');
  o.setText('u1', 'user', 'He quit.');
  const list = o.list();
  assert.equal(list[0].text, 'He quit.');
  assert.equal(list[1].text, 'Take your time - so the employee quit.');
});

test('unannounced item ids append in arrival order (graceful degradation)', () => {
  const o = createTranscriptOrder();
  o.setText('never_announced_1', 'user', 'first');
  o.setText('never_announced_2', 'assistant', 'second');
  assert.deepEqual(o.list(), [
    { speaker: 'user', text: 'first' },
    { speaker: 'assistant', text: 'second' }
  ]);
});

test('missing item id falls back to append, never drops the turn', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.setText('u1', 'user', 'kept');
  o.setText(null, 'assistant', 'also kept');
  o.append('user', 'appended directly');
  assert.deepEqual(o.list().map((t) => t.text), ['kept', 'also kept', 'appended directly']);
});

test('unfilled slots never leak as placeholders', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1');            // announced but transcript never arrived
  o.noteItem('u2');
  o.setText('u1', 'user', 'one');
  o.setText('u2', 'user', 'two');
  assert.deepEqual(o.list(), [
    { speaker: 'user', text: 'one' },
    { speaker: 'user', text: 'two' }
  ]);
});

test('identical consecutive same-speaker lines are deduped (event replays)', () => {
  const o = createTranscriptOrder();
  o.append('assistant', 'Tell me about a deadline.');
  o.append('assistant', 'Tell me about a deadline.');
  o.append('user', 'Tell me about a deadline.');   // different speaker: kept
  o.append('assistant', 'Tell me about a deadline.');
  assert.equal(o.list().length, 3);
});

test('re-filling the same item id updates in place, no duplicate slot', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.setText('u1', 'user', 'partial');
  o.setText('u1', 'user', 'partial but corrected');
  assert.deepEqual(o.list(), [{ speaker: 'user', text: 'partial but corrected' }]);
});

test('duplicate noteItem for one id does not reserve twice', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('u1');
  o.setText('u1', 'user', 'once');
  assert.equal(o.list().length, 1);
});

test('reset clears everything for a fresh session', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.setText('u1', 'user', 'old session');
  o.reset();
  assert.deepEqual(o.list(), []);
  o.noteItem('u2');
  o.setText('u2', 'user', 'new session');
  assert.deepEqual(o.list(), [{ speaker: 'user', text: 'new session' }]);
});

test('list() returns a fresh array each call (no shared mutation)', () => {
  const o = createTranscriptOrder();
  o.append('user', 'x');
  const a = o.list();
  a.push({ speaker: 'user', text: 'injected' });
  assert.equal(o.list().length, 1);
});

// ---------- previous_item_id ordering ----------

test('previous_item_id inserts an out-of-band item after its anchor, not at the end', () => {
  const o = createTranscriptOrder();
  o.noteItem('a');
  o.noteItem('b', 'a');
  o.noteItem('c', 'b');
  // An item announced late but belonging right after 'a'
  o.noteItem('a2', 'a');
  o.setText('a', 'user', 'one');
  o.setText('a2', 'user', 'one-and-a-half');
  o.setText('b', 'assistant', 'two');
  o.setText('c', 'user', 'three');
  assert.deepEqual(o.list().map((t) => t.text), ['one', 'one-and-a-half', 'two', 'three']);
});

test('in-order previous_item_id chains behave exactly like appending', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1', null);
  o.noteItem('a1', 'u1');
  o.noteItem('u2', 'a1');
  o.setText('a1', 'assistant', 'mid');
  o.setText('u2', 'user', 'last');
  o.setText('u1', 'user', 'first');
  assert.deepEqual(o.list().map((t) => t.text), ['first', 'mid', 'last']);
});

test('an unknown previous_item_id appends rather than dropping the turn', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('u2', 'never_seen');
  o.setText('u1', 'user', 'first');
  o.setText('u2', 'user', 'second');
  assert.deepEqual(o.list().map((t) => t.text), ['first', 'second']);
});

test('a repeat noteItem never moves an already-reserved slot', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1', 'u1');
  o.noteItem('u1', 'a1');        // contradictory replay: must not reorder
  o.setText('u1', 'user', 'first');
  o.setText('a1', 'assistant', 'second');
  assert.deepEqual(o.list().map((t) => t.text), ['first', 'second']);
});

// ---------- pending / flush ----------

test('pendingCount counts only announced slots still awaiting a transcript', () => {
  const o = createTranscriptOrder();
  assert.equal(o.pendingCount(), 0);
  o.noteItem('u1');
  o.noteItem('a1');
  assert.equal(o.pendingCount(), 2);
  o.setText('u1', 'user', 'filled');
  assert.equal(o.pendingCount(), 1);
  o.append('assistant', 'appended directly');   // id-less, never pending
  assert.equal(o.pendingCount(), 1);
  o.setText('a1', 'assistant', 'filled too');
  assert.equal(o.pendingCount(), 0);
});

asyncTest('flushTranscript resolves immediately when nothing is in flight', async () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.setText('u1', 'user', 'done');
  assert.equal(await o.flushTranscript({ timeoutMs: 50 }), true);
});

asyncTest('flushTranscript resolves as soon as the late transcript lands', async () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1');
  o.setText('a1', 'assistant', 'arrived first');
  // The user's whisper transcript is still in flight when the session ends
  const flushed = o.flushTranscript({ timeoutMs: 5000 });
  setTimeout(() => o.setText('u1', 'user', 'the line that ended the session'), 10);
  assert.equal(await flushed, true);
  // ...and the recovered turn is in the right place, not appended at the end
  assert.deepEqual(o.list().map((t) => t.text), [
    'the line that ended the session',
    'arrived first'
  ]);
});

asyncTest('flushTranscript gives up on timeout and keeps what already arrived', async () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1');            // never arrives
  o.setText('u1', 'user', 'kept');
  assert.equal(await o.flushTranscript({ timeoutMs: 20 }), false);
  assert.deepEqual(o.list().map((t) => t.text), ['kept']);
});

asyncTest('a zero timeout does not wait', async () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  assert.equal(await o.flushTranscript({ timeoutMs: 0 }), false);
});

asyncTest('reset releases an in-progress flush instead of hanging it', async () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  const flushed = o.flushTranscript({ timeoutMs: 5000 });
  o.reset();
  assert.equal(await flushed, false);
});

for (const run of asyncTests) await run();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
