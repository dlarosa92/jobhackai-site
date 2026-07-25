// Conduct escalation gate test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-conduct.test.mjs
//
// "One clear warning, then end" was a prompt instruction only, so nothing
// stopped the model ending a session it had never warned. These tests cover the
// state machine that now enforces it, including the false-positive case that
// matters most: a candidate quoting profanity from a real workplace story is
// answering the question, and must never lose their session over it.
//
// They also cover the two review findings on the first implementation:
//   1. a duplicated tool call converting a REFUSED unwarned end into a real one
//   2. a conduct end completing without waiting for the closing spoken line

import assert from 'node:assert/strict';
import { createConductGate, createClosingTurnGate } from '../../../../js/voice-conduct.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

// ---------------------------------------------------------------- conduct gate

test('a fresh gate has no warning and does not end anything', () => {
  const g = createConductGate();
  assert.equal(g.wasWarned(), false);
});

test('the documented path: warning, candidate re-offends, then end', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning'), 'warn');
  assert.equal(g.wasWarned(), true);
  g.noteCandidateSpoke();
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

test('after a refused end, the next real incident does end the session', () => {
  const g = createConductGate();
  assert.equal(g.decide('end', 'call_1'), 'warn_instead');
  g.noteCandidateSpoke();
  assert.equal(g.decide('end', 'call_2'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

test('a repeated warning is ignored, not treated as escalation', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning'), 'warn');
  assert.equal(g.decide('warning'), 'ignore');
  assert.equal(g.decide('warning'), 'ignore');
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

// -- review finding 1: duplicate conduct events must not end early -------------
//
// Realtime surfaces one tool call twice, and the two events carry different id
// fields, so id dedupe alone is not enough. The load-bearing guard is that the
// candidate must have spoken again — a replay cannot manufacture speech.

test('a replayed unwarned end does NOT end the session, even with a DIFFERENT id', () => {
  const g = createConductGate();
  // response.function_call_arguments.done — resolves to the call_id
  assert.equal(g.decide('end', 'call_abc'), 'warn_instead');
  // ...then the same call again in response.done output, id resolved differently
  assert.equal(g.decide('end', 'item_xyz'), 'ignore');
  assert.equal(g.decide('end', 'resp_123'), 'ignore');
});

test('a replayed unwarned end does NOT end the session with NO id at all', () => {
  const g = createConductGate();
  assert.equal(g.decide('end', ''), 'warn_instead');
  assert.equal(g.decide('end', ''), 'ignore');
  assert.equal(g.decide('end'), 'ignore');
});

test('a replayed legitimate end is idempotent across differing ids', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  g.noteCandidateSpoke();
  assert.equal(g.decide('end', 'call_2'), 'end');
  // The replay of that same end resolves to a different id and must not
  // re-trigger. The caller guards too, but the gate should not invite it.
  assert.equal(g.decide('end', 'item_2'), 'ignore');
});

test('candidate speech before any warning does not license an unwarned end', () => {
  const g = createConductGate();
  g.noteCandidateSpoke();
  g.noteCandidateSpoke();
  // Still the first offense, so still a warning rather than an end
  assert.equal(g.decide('end', 'call_1'), 'warn_instead');
});

test('a warning resets the clock: pre-warning speech does not license an end', () => {
  const g = createConductGate();
  g.noteCandidateSpoke();
  assert.equal(g.decide('warning', 'c1'), 'warn');
  assert.equal(g.decide('end', 'c2'), 'ignore');
  g.noteCandidateSpoke();
  assert.equal(g.decide('end', 'c3'), 'end');
});

test('the same call id is ignored outright (cheap first layer)', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  g.noteCandidateSpoke();
  assert.equal(g.decide('warning', 'call_1'), 'ignore');
});

test('a warning survives a reconnect: only reset() clears it', () => {
  const g = createConductGate();
  g.decide('warning');
  assert.equal(g.wasWarned(), true);
  g.noteCandidateSpoke();
  assert.equal(g.decide('end'), 'end');
});

test('reset gives a brand-new session a clean slate', () => {
  const g = createConductGate();
  g.decide('end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
  g.reset();
  assert.equal(g.wasWarned(), false);
  assert.equal(g.endReason(), 'ended_by_interviewer');
  assert.equal(g.decide('end', 'call_1'), 'warn_instead');
});

test('gates are independent (no shared state across sessions)', () => {
  const a = createConductGate();
  const b = createConductGate();
  a.decide('warning');
  assert.equal(a.wasWarned(), true);
  assert.equal(b.wasWarned(), false);
  assert.equal(b.decide('end'), 'warn_instead');
});

// ----------------------------------------------------------- closing turn gate

// Deterministic fake clock so the timing logic is testable without real waits.
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Number(ms || 0), fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId = id; }
        }
        if (nextId === null) break;
        const t = timers.get(nextId);
        timers.delete(nextId);
        now = t.at;
        t.fn();
      }
      now = target;
    },
    pending() { return timers.size; }
  };
}

function makeGate(clock, opts) {
  const calls = [];
  const gate = createClosingTurnGate({
    timeoutMs: 6000,
    graceMs: 750,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDone: (reason) => calls.push(reason),
    ...(opts || {})
  });
  return { gate, calls };
}

test('closing turn: waits for both the response and the closing audio', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(true);                 // closing line already speaking
  gate.noteResponseDone();
  assert.deepEqual(calls, [], 'must not finish while audio is still playing');
  gate.noteAudioStopped();
  assert.deepEqual(calls, ['complete']);
});

test('closing turn: audio finishing before the response still waits', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(true);
  gate.noteAudioStopped();
  assert.deepEqual(calls, [], 'response.done has not arrived yet');
  gate.noteResponseDone();
  assert.deepEqual(calls, ['complete']);
});

// -- review finding 2: a stale "not playing" flag skipped the audio wait -------

test('closing turn: audio starting AFTER the request is still waited for', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  // The tool call arrives while nothing is playing: the previous turn's audio
  // has stopped and the closing line has not begun. The old code read that as
  // "audio already done" and cut the closing line off.
  gate.start(false);
  gate.noteResponseDone();
  assert.deepEqual(calls, [], 'must not finish before the closing audio begins');
  clock.advance(500);                     // still inside the grace window
  gate.noteAudioStarted();
  assert.deepEqual(calls, [], 'audio has begun; wait for it to finish');
  clock.advance(4000);
  gate.noteAudioStopped();
  assert.deepEqual(calls, ['complete']);
});

test('closing turn: no audio at all resolves via the grace window, not the backstop', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(false);
  gate.noteResponseDone();
  clock.advance(749);
  assert.deepEqual(calls, [], 'grace window has not elapsed');
  clock.advance(2);
  assert.deepEqual(calls, ['complete'], 'concluded there is no closing audio');
});

test('closing turn: the grace window only starts once the response is done', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(false);
  clock.advance(3000);                    // no response.done yet
  assert.deepEqual(calls, [], 'nothing should resolve on the grace path yet');
  gate.noteResponseDone();
  clock.advance(751);
  assert.deepEqual(calls, ['complete']);
});

test('closing turn: a stale audio stop before any start is ignored', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(false);
  gate.noteAudioStopped();                // trailing stop from the previous turn
  gate.noteResponseDone();
  assert.deepEqual(calls, [], 'that stop was not the closing line');
  clock.advance(751);
  assert.deepEqual(calls, ['complete']);
});

test('closing turn: the backstop fires when events never complete', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(true);
  clock.advance(5999);
  assert.deepEqual(calls, []);
  clock.advance(2);
  assert.deepEqual(calls, ['timeout']);
});

test('closing turn: audio that starts but never stops still hits the backstop', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(false);
  gate.noteResponseDone();
  gate.noteAudioStarted();
  clock.advance(6001);
  assert.deepEqual(calls, ['timeout']);
});

test('closing turn: finishes exactly once and leaves no timers behind', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(true);
  gate.noteResponseDone();
  gate.noteAudioStopped();
  assert.deepEqual(calls, ['complete']);
  // Late duplicate events must not re-fire, and the backstop must be cleared
  gate.noteResponseDone();
  gate.noteAudioStopped();
  clock.advance(60000);
  assert.deepEqual(calls, ['complete']);
  assert.equal(clock.pending(), 0, 'no dangling timers');
  assert.equal(gate.isActive(), false);
});

test('closing turn: cancel abandons the wait and clears timers', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  gate.start(true);
  gate.cancel();
  clock.advance(60000);
  assert.deepEqual(calls, [], 'a cancelled wait never calls back');
  assert.equal(clock.pending(), 0);
  assert.equal(gate.isActive(), false);
});

test('closing turn: start is idempotent while already active', () => {
  const clock = fakeClock();
  const { gate, calls } = makeGate(clock);
  assert.equal(gate.start(true), true);
  assert.equal(gate.start(true), false, 'second start is refused');
  gate.noteResponseDone();
  gate.noteAudioStopped();
  assert.deepEqual(calls, ['complete']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
