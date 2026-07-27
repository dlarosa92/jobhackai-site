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
  o.append('assistant', 'Tell me about a deadline.');
  assert.equal(o.list().length, 1);
  // NOTE: a USER turn verbatim-identical to an adjacent assistant turn is no
  // longer kept — that exact pattern is microphone echo (see the echo tests
  // below), which is why this test no longer uses one as its "different
  // speaker" case.
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

// ---------- microphone echo (dev blocker 3) ----------
//
// A real dev session's stored transcript opened with the interviewer's own
// greeting attributed to the CANDIDATE: her voice played through the speakers,
// the open mic picked it up, and whisper transcribed it as a user turn. A user
// turn that is a near-verbatim copy of an adjacent interviewer turn is that
// artifact, not an answer.

test('BLOCKER 3: the greeting echoed back as a user turn is dropped', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1');
  o.noteItem('u1');
  o.setText('a1', 'assistant', 'Welcome to your mock interview for the barista role. Tell me about yourself.');
  o.setText('u1', 'user', 'Welcome to your mock interview for the barista role. Tell me about yourself.');
  assert.deepEqual(o.list(), [
    { speaker: 'assistant', text: 'Welcome to your mock interview for the barista role. Tell me about yourself.' }
  ]);
});

test('BLOCKER 3: a partial echo (subset of the assistant line) is dropped too', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1');
  o.noteItem('u1');
  o.setText('a1', 'assistant', 'Welcome to your mock interview for the barista role. Tell me about yourself.');
  // Whisper often catches only a fragment of the leaked audio
  o.setText('u1', 'user', 'Welcome to your mock interview for the barista role.');
  assert.equal(o.list().length, 1);
});

test('BLOCKER 3: echo works in either slot order (user item created first)', () => {
  const o = createTranscriptOrder();
  o.noteItem('u1');
  o.noteItem('a1');
  o.setText('u1', 'user', 'Tell me about a time you handled a difficult customer.');
  o.setText('a1', 'assistant', 'Tell me about a time you handled a difficult customer.');
  assert.deepEqual(o.list().map((t) => t.speaker), ['assistant']);
});

test('BLOCKER 3: a real answer that quotes part of the question is KEPT', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1');
  o.noteItem('u1');
  o.setText('a1', 'assistant', 'Tell me about a conflict with a manager.');
  o.setText('u1', 'user', 'A conflict with a manager, sure. It was Christmas Eve and my manager wanted to close early.');
  assert.equal(o.list().length, 2, 'partial overlap is a quote, not echo');
});

test('BLOCKER 3: an answer built from the question\'s own words is KEPT (Codex P1)', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1');
  o.noteItem('u1');
  o.setText('a1', 'assistant', 'Would you describe your role as strategic, operational, or both?');
  // 100% of the answer's tokens appear in the question, but it reproduces only
  // a fraction of the question — coverage is what tells it apart from echo
  o.setText('u1', 'user', 'Strategic, operational, or both - both.');
  assert.equal(o.list().length, 2, 'a real answer must never be deleted');
});

test('BLOCKER 3: short answers are never treated as echo', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1');
  o.noteItem('u1');
  o.setText('a1', 'assistant', 'Yes. Are you ready to begin the interview now?');
  o.setText('u1', 'user', 'Yes.');
  assert.equal(o.list().length, 2, 'below the token floor, always kept');
});

test('BLOCKER 3: a distant identical line is not treated as echo', () => {
  const o = createTranscriptOrder();
  o.noteItem('a1'); o.noteItem('u1'); o.noteItem('a2'); o.noteItem('u2'); o.noteItem('u3');
  o.setText('a1', 'assistant', 'Describe the hardest deadline you have ever hit for me.');
  o.setText('u1', 'user', 'The launch, definitely. We had six weeks and lost two engineers.');
  o.setText('a2', 'assistant', 'What did you cut to make it?');
  o.setText('u2', 'user', 'Scope. We dropped the reporting dashboard.');
  // Outside the ±2 window relative to a1: kept even though near-verbatim
  o.setText('u3', 'user', 'Describe the hardest deadline you have ever hit for me.');
  assert.equal(o.list().length, 5);
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

// ---- drop(): retroactive removal for a walked-back audio-check round ----
// (PR #848: exclusion in the lifecycle gates future writes; a whisper that
// already filled its slot has to be pulled back out of the assembly.)

test('drop removes an already-filled turn from the assembled transcript', () => {
  const o = createTranscriptOrder();
  o.noteItem('item_a');
  o.noteItem('item_b');
  o.setText('item_a', 'user', 'hello hello is this working');
  o.setText('item_b', 'assistant', 'Can you hear me now?');
  o.drop('item_a');
  o.drop('item_b');
  assert.deepEqual(o.list(), []);
});

test('a late transcript for a dropped id is inert — it cannot re-enter via the append path', () => {
  const o = createTranscriptOrder();
  o.noteItem('item_a');
  o.drop('item_a');
  o.setText('item_a', 'user', 'late whisper of a dropped turn');
  assert.deepEqual(o.list(), []);
  // Even an id never announced here stays out once dropped
  o.drop('item_never_seen');
  o.setText('item_never_seen', 'user', 'straggler');
  assert.deepEqual(o.list(), []);
});

test('drop leaves unrelated turns and ordering untouched', () => {
  const o = createTranscriptOrder();
  o.noteItem('item_q');
  o.noteItem('item_x');
  o.noteItem('item_a');
  o.setText('item_q', 'assistant', 'First question.');
  o.setText('item_x', 'user', 'window chatter');
  o.setText('item_a', 'user', 'Real answer.');
  o.drop('item_x');
  assert.deepEqual(o.list(), [
    { speaker: 'assistant', text: 'First question.' },
    { speaker: 'user', text: 'Real answer.' }
  ]);
});

test('dropping a pending slot stops it counting toward a flush', () => {
  const o = createTranscriptOrder();
  o.noteItem('item_pending');
  assert.equal(o.pendingCount(), 1);
  o.drop('item_pending');
  assert.equal(o.pendingCount(), 0);
});

asyncTest('dropping the last pending slot completes an in-flight flush without the timeout', async () => {
  const o = createTranscriptOrder();
  o.noteItem('item_pending');
  const flushed = o.flushTranscript({ timeoutMs: 5000 });
  o.drop('item_pending');
  assert.equal(await flushed, true, 'flush must settle on the drop, not run to timeout');
});

test('drop(null) and dropping unknown ids are safe no-ops for the assembly', () => {
  const o = createTranscriptOrder();
  o.noteItem('item_a');
  o.setText('item_a', 'user', 'kept');
  o.drop(null);
  o.drop(undefined);
  assert.deepEqual(o.list(), [{ speaker: 'user', text: 'kept' }]);
});

for (const run of asyncTests) await run();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
