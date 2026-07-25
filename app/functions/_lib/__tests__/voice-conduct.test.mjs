// Conduct escalation gate test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-conduct.test.mjs
//
// "One clear warning, then end" was a prompt instruction only, so nothing
// stopped the model ending a session it had never warned. These tests cover the
// state machine that now enforces it, including the false-positive case that
// matters most: a candidate quoting profanity from a real workplace story is
// answering the question, and must never lose their session over it.

import assert from 'node:assert/strict';
import { createConductGate } from '../../../../js/voice-conduct.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

test('a fresh gate has no warning and does not end anything', () => {
  const g = createConductGate();
  assert.equal(g.wasWarned(), false);
});

test('the documented path: warning first, then end', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning'), 'warn');
  assert.equal(g.wasWarned(), true);
  assert.equal(g.decide('end'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer');
});

test('an end with no prior warning is refused and becomes the warning', () => {
  const g = createConductGate();
  assert.equal(g.decide('end'), 'warn_instead');
  assert.equal(g.wasWarned(), true);
  // The deviation is recorded, so it can be counted rather than guessed at
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

test('after a refused end, the next incident does end the session', () => {
  const g = createConductGate();
  assert.equal(g.decide('end'), 'warn_instead');
  assert.equal(g.decide('end'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

// Realtime surfaces one tool call twice: as its own
// response.function_call_arguments.done, then again in the response.done
// output. Without call-id dedupe the replay re-enters the gate, finds the
// warning the refusal just recorded, and ends the session anyway.
test('the replay of a refused unwarned end does NOT end the session', () => {
  const g = createConductGate();
  assert.equal(g.decide('end', 'call_abc'), 'warn_instead');
  assert.equal(g.decide('end', 'call_abc'), 'ignore');
  assert.equal(g.decide('end', 'call_abc'), 'ignore');
});

test('the replay of a legitimate end is idempotent', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  assert.equal(g.decide('warning', 'call_1'), 'ignore');
  assert.equal(g.decide('end', 'call_2'), 'end');
  assert.equal(g.decide('end', 'call_2'), 'ignore');
  assert.equal(g.endReason(), 'ended_by_interviewer');
});

test('a genuinely new end call after a refusal still ends the session', () => {
  const g = createConductGate();
  assert.equal(g.decide('end', 'call_1'), 'warn_instead');
  // The candidate did it again, so this is a different call id
  assert.equal(g.decide('end', 'call_2'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

test('call ids are per-gate, and reset clears them', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  g.reset();
  // Same id, new session: decided fresh rather than swallowed as a replay
  assert.equal(g.decide('warning', 'call_1'), 'warn');
});

test('a repeated warning is ignored, not treated as escalation', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning'), 'warn');
  assert.equal(g.decide('warning'), 'ignore');
  assert.equal(g.decide('warning'), 'ignore');
  // Still exactly one warning issued, so the interview is still open
  assert.equal(g.wasWarned(), true);
});

test('unknown, empty, and malformed stages never end a session', () => {
  for (const stage of ['', null, undefined, 'END', 'Warning', 'conduct', 'stop', 0, 1, {}, []]) {
    const g = createConductGate();
    assert.equal(g.decide(stage), 'ignore', `stage ${JSON.stringify(stage)} must be ignored`);
    assert.equal(g.wasWarned(), false);
  }
});

test('stage matching is exact: no case folding, no substrings', () => {
  const g = createConductGate();
  assert.equal(g.decide('ending'), 'ignore');
  assert.equal(g.decide('warnings'), 'ignore');
  assert.equal(g.decide(' end'), 'ignore');
  assert.equal(g.wasWarned(), false);
});

test('a warning survives a reconnect: only reset() clears it', () => {
  const g = createConductGate();
  g.decide('warning');
  // A reconnect reuses the same gate, so the candidate cannot drop the
  // connection to wipe their warning and start over.
  assert.equal(g.wasWarned(), true);
  assert.equal(g.decide('end'), 'end');
});

test('reset gives a brand-new session a clean slate', () => {
  const g = createConductGate();
  g.decide('end');                       // deviation recorded
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
  g.reset();
  assert.equal(g.wasWarned(), false);
  assert.equal(g.endReason(), 'ended_by_interviewer');
  // And the one-warning rule applies again from scratch
  assert.equal(g.decide('end'), 'warn_instead');
});

test('gates are independent (no shared state across sessions)', () => {
  const a = createConductGate();
  const b = createConductGate();
  a.decide('warning');
  assert.equal(a.wasWarned(), true);
  assert.equal(b.wasWarned(), false);
  assert.equal(b.decide('end'), 'warn_instead');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
