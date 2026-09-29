// Conduct escalation gate test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-conduct.test.mjs
//
// "One clear warning, then end" was a prompt instruction only, so nothing
// stopped the model ending a session it had never warned. These tests cover the
// state machine that now enforces it, including the false-positive case that
// matters most: a candidate quoting profanity from a real workplace story is
// answering the question, and must never lose their session over it.
//
// They also cover the review findings on earlier implementations:
//   1. a duplicated tool call converting a REFUSED unwarned end into a real one
//   2. a conduct end completing without waiting for the closing spoken line
//   3. a LATE whisper transcript, describing pre-warning audio, retroactively
//      satisfying "the candidate spoke again" and letting (1) through anyway

import assert from 'node:assert/strict';
import {
  createConductGate,
  createClosingTurnGate,
  readToolCall,
  isSafetyReferral,
  isConductWarningLine,
  LIVE_CANDIDATE_SPEECH_EVENTS,
  CONDUCT_TOOL,
  SAFETY_TOOL
} from '../../../../js/voice-conduct.js';
import {
  INTERVIEWER_TOOLS,
  CONDUCT_TOOL_NAME,
  SAFETY_TOOL_NAME
} from '../voice-interviewer.js';

// Live speech signal, as the client passes it in.
const SPOKE = 'input_audio_buffer.speech_started';

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
  g.noteCandidateSpoke(SPOKE);
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
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('end', 'call_2'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

test('a repeated warning WITHOUT new speech is ignored (replay stays inert)', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning'), 'warn');
  // No candidate speech in between: these are duplicates/replays, not incidents
  assert.equal(g.decide('warning'), 'ignore');
  assert.equal(g.decide('warning'), 'ignore');
  assert.equal(g.wasWarned(), true);
});

// -- dev blocker 1: repeated abuse never ended the session ---------------------
//
// Live, the model reported every new incident as stage "warning" and never
// chose "end", so the session warned forever: the gate could refuse an end but
// never initiate one. A second warning AFTER new candidate speech is the model
// reporting a second incident — the gate now escalates it to the end itself.

test('BLOCKER 1: a second warning after new candidate speech ENDS the session', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'c1'), 'warn');
  g.noteCandidateSpoke(SPOKE);                    // the candidate re-offends
  assert.equal(g.decide('warning', 'c2'), 'end'); // model mislabels it: still ends
  assert.equal(g.endReason(), 'ended_by_interviewer');
});

test('BLOCKER 1: warning loop can never continue past the second incident', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'c1'), 'warn');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('warning', 'c2'), 'end');
  // Anything after the end — more warnings, more ends — is inert
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('warning', 'c3'), 'ignore');
  assert.equal(g.decide('end', 'c4'), 'ignore');
});

test('BLOCKER 1: warn_instead followed by a mislabeled second incident also ends', () => {
  const g = createConductGate();
  // Model skipped the warning and asked to end: refused, counted as warning
  assert.equal(g.decide('end', 'c1'), 'warn_instead');
  g.noteCandidateSpoke(SPOKE);
  // Model then warns again instead of ending: escalates all the same
  assert.equal(g.decide('warning', 'c2'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer_unwarned');
});

test('BLOCKER 1: a replayed second warning with a different id still cannot end early', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  // The same warning surfaces again from response.done with a different id and
  // NO intervening candidate speech: must stay a no-op, not become the end
  assert.equal(g.decide('warning', 'item_1'), 'ignore');
  assert.equal(g.decide('warning', 'resp_1'), 'ignore');
});

// Mic noise can fire input_audio_buffer.speech_started without real candidate
// speech, so "spoke since warning" alone is weaker than it looks. The second
// discriminator is the response id: a replay is the same response re-surfacing,
// while a genuine second incident is always a fresh response.
test('noise + a same-response replay never ends the session (Bugbot)', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1', 'resp_A'), 'warn');
  g.noteCandidateSpoke(SPOKE);                                 // cough, speaker bleed
  // The warning's replay arrives with a DIFFERENT dedupe id but the SAME response
  assert.equal(g.decide('warning', 'item_1', 'resp_A'), 'ignore');
  assert.equal(g.decide('end', 'item_2', 'resp_A'), 'ignore');
  // Still open: only one real incident has happened
  assert.equal(g.wasWarned(), true);
});

test('a second incident from a NEW response still ends after speech', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1', 'resp_A'), 'warn');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('warning', 'call_2', 'resp_B'), 'end');
  assert.equal(g.endReason(), 'ended_by_interviewer');
});

test('missing response ids fall back to the speech guard alone', () => {
  // API shapes that omit response_id must not lose the blocker-1 escalation
  const g = createConductGate();
  assert.equal(g.decide('warning', 'c1'), 'warn');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('end', 'c2'), 'end');
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
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('end', 'call_2'), 'end');
  // The replay of that same end resolves to a different id and must not
  // re-trigger. The caller guards too, but the gate should not invite it.
  assert.equal(g.decide('end', 'item_2'), 'ignore');
});

test('candidate speech before any warning does not license an unwarned end', () => {
  const g = createConductGate();
  g.noteCandidateSpoke(SPOKE);
  g.noteCandidateSpoke(SPOKE);
  // Still the first offense, so still a warning rather than an end
  assert.equal(g.decide('end', 'call_1'), 'warn_instead');
});

test('a warning resets the clock: pre-warning speech does not license an end', () => {
  const g = createConductGate();
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('warning', 'c1'), 'warn');
  assert.equal(g.decide('end', 'c2'), 'ignore');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('end', 'c3'), 'end');
});

// -- review finding 3: only LIVE speech signals may satisfy "spoke again" ------

test('a late whisper transcript does NOT license a replayed unwarned end', () => {
  const g = createConductGate();
  // First offense: the model skips the warning and asks to end. Refused.
  assert.equal(g.decide('end', 'call_abc'), 'warn_instead');
  // The whisper transcript for that SAME first utterance now lands. It is
  // pre-warning audio arriving late, so it must not count as speaking again.
  g.noteCandidateSpoke('conversation.item.input_audio_transcription.completed');
  // ...so the duplicate of that end call still cannot close the interview.
  assert.equal(g.decide('end', 'item_xyz'), 'ignore');
});

test('only the live speech events are accepted as speaking again', () => {
  assert.deepEqual(LIVE_CANDIDATE_SPEECH_EVENTS, [
    'input_audio_buffer.speech_started',
    'input_audio_buffer.committed'
  ]);
  for (const evt of LIVE_CANDIDATE_SPEECH_EVENTS) {
    const g = createConductGate();
    g.decide('warning', 'c1');
    g.noteCandidateSpoke(evt);
    assert.equal(g.decide('end', 'c2'), 'end', `${evt} should count as speaking`);
  }
});

test('non-live, missing, and malformed speech signals are all rejected', () => {
  const rejected = [
    'conversation.item.input_audio_transcription.completed',
    'conversation.item.created',
    'response.done',
    'input_audio_buffer.speech_stopped',
    'INPUT_AUDIO_BUFFER.SPEECH_STARTED',
    '', null, undefined, 0, {}, []
  ];
  for (const evt of rejected) {
    const g = createConductGate();
    g.decide('warning', 'c1');
    g.noteCandidateSpoke(evt);
    assert.equal(g.decide('end', 'c2'), 'ignore', `${JSON.stringify(evt)} must not count as speaking`);
  }
});

test('the same call id is ignored outright (cheap first layer)', () => {
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1'), 'warn');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.decide('warning', 'call_1'), 'ignore');
});

test('a warning survives a reconnect: only reset() clears it', () => {
  const g = createConductGate();
  g.decide('warning');
  assert.equal(g.wasWarned(), true);
  g.noteCandidateSpoke(SPOKE);
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

// -- LIVE DEV REGRESSION: repeated abuse never ended the session ---------------
//
// Observed sequence in the failed release-gate test: first directed insult,
// one professional warning, second directed insult, the interviewer says again
// that she will not continue through the language... and then keeps asking
// questions. Root cause was twofold: she spoke the warning without ever
// calling conduct_action (so the gate heard nothing), and the escalation
// required live speech events AND a new response, so a missing speech signal
// silenced even explicit tool calls.

test('LIVE REGRESSION: insult, warning, second insult, spoken warning - session ends, then silence', () => {
  const g = createConductGate();
  // First directed insult: the model warns via the tool (response A) and the
  // transcript of its own warning line arrives for the same response.
  assert.equal(g.decide('warning', 'call_1', 'resp_A'), 'warn');
  assert.equal(g.noteSpokenWarning('resp_A'), 'ignore');
  // Second directed insult: the model only SPEAKS the warning again, no tool.
  assert.equal(g.noteSpokenWarning('resp_B'), 'end');
  // Then silence: everything after the close is inert.
  assert.equal(g.noteSpokenWarning('resp_C'), 'ignore');
  assert.equal(g.decide('end', 'call_9', 'resp_C'), 'ignore');
  assert.equal(g.decide('warning', 'call_10', 'resp_D'), 'ignore');
  assert.equal(g.endReason(), 'ended_by_interviewer');
});

test('LIVE REGRESSION: purely spoken warnings, never a single tool call', () => {
  const g = createConductGate();
  assert.equal(g.noteSpokenWarning('resp_A'), 'warn');
  assert.equal(g.noteSpokenWarning('resp_B'), 'end');
});

test('LIVE REGRESSION: dead speech events cannot silence tool escalation', () => {
  // If input_audio_buffer events are never delivered, the old gate ignored
  // every repeat call and the client answered "continue" - the fully armed
  // gate produced the endless-warning loop itself. Response identity alone
  // must now be sufficient.
  const g = createConductGate();
  assert.equal(g.decide('warning', 'call_1', 'resp_A'), 'warn');
  // note: NO noteCandidateSpoke ever fires
  assert.equal(g.decide('warning', 'call_2', 'resp_B'), 'end');
});

test('a spoken warning and its duplicate transcript event stay ONE warning', () => {
  const g = createConductGate();
  assert.equal(g.noteSpokenWarning('resp_A'), 'warn');
  // GA + beta transcript event names can both surface the same response
  assert.equal(g.noteSpokenWarning('resp_A'), 'ignore');
  assert.equal(g.wasWarned(), true);
});

test('a spoken warning without ids needs independent evidence to end', () => {
  const g = createConductGate();
  assert.equal(g.noteSpokenWarning(''), 'warn');
  // No response ids and no candidate speech: cannot prove a second incident
  assert.equal(g.noteSpokenWarning(''), 'ignore');
  g.noteCandidateSpoke(SPOKE);
  assert.equal(g.noteSpokenWarning(''), 'end');
});

test('the warning REGISTER is detected; everyday interviewer speech is not', () => {
  // The mandated register and close paraphrases
  assert.equal(isConductWarningLine("I'm going to stop you there. That's not language I'll continue an interview through. Keep it professional and we'll carry on."), true);
  assert.equal(isConductWarningLine('I will not continue the interview through that language.'), true);
  assert.equal(isConductWarningLine('That language has no place in an interview.'), true);
  assert.equal(isConductWarningLine("I won't be spoken to that way."), true);
  // Everyday interviewer speech that shares the words
  assert.equal(isConductWarningLine('Let me stop you there - what was the outcome?'), false);
  assert.equal(isConductWarningLine('Why did you choose that language for the backend?'), false);
  assert.equal(isConductWarningLine("We won't focus on that language today."), false);
  assert.equal(isConductWarningLine('How do you keep it professional under pressure?'), false);
  assert.equal(isConductWarningLine('Keep it professional.'), false);
  assert.equal(isConductWarningLine('That language is not appropriate for this project.'), false);
  assert.equal(isConductWarningLine(''), false);
  assert.equal(isConductWarningLine(null), false);
});

// -- dev blocker 2: crisis guidance spoken, tool skipped, interview resumed ----
//
// The safety close cannot depend on the model calling end_for_safety. The
// referral line itself is the decision: if the interviewer says it, the client
// closes the session whether or not the tool call arrives. The detector is fed
// INTERVIEWER turns only and is deliberately narrow.

test('BLOCKER 2: the mandated referral phrasing is detected', () => {
  assert.equal(isSafetyReferral('Please call or text 988 right now.'), true);
  assert.equal(isSafetyReferral('If you are in the US, call or text 988. This matters more than any interview.'), true);
  assert.equal(isSafetyReferral('You should contact 988 immediately.'), true);
  assert.equal(isSafetyReferral('Please reach out to 988 now.'), true);
});

test('BLOCKER 2: referral after an opening question still detected', () => {
  // Realistic model output mixes a question with the referral; the referral
  // sentence itself is not a question, so it must still match
  assert.equal(isSafetyReferral('Are you safe right now? Please call 988 now.'), true);
});

test('BLOCKER 2: interview questions about 988 do NOT end a session', () => {
  // A candidate interviewing for a crisis-line job gets asked about it
  assert.equal(isSafetyReferral('Did you ever call 988 as part of your role?'), false);
  assert.equal(isSafetyReferral('What drew you to 988 crisis work?'), false);
});

test('BLOCKER 2: imperative interview PROMPTS about 988 do not end a session (Bugbot)', () => {
  // Behavioral prompts are often phrased without a question mark, so the
  // question filter alone cannot protect a crisis-line mock interview
  assert.equal(isSafetyReferral('Describe when you had to call or text 988 to de-escalate a caller.'), false);
  assert.equal(isSafetyReferral('Walk me through how you would call or text 988 with a caller in crisis.'), false);
  assert.equal(isSafetyReferral('Tell me about a shift where you had to contact 988 twice.'), false);
  // ...while the real referral, which never opens with a prompt verb and
  // never frames the call as past experience, still matches
  assert.equal(isSafetyReferral('Please call or text 988 right now.'), true);
  assert.equal(isSafetyReferral('If you are in the US, call or text 988.'), true);
});

test('BLOCKER 2: the ordinary distress redirect does not trigger the backstop', () => {
  // Rule 4's no-resources redirect contains no referral and must stay inert
  assert.equal(isSafetyReferral('This is interview practice, so it is not the right place for it. If it is real, you deserve to talk to someone who can actually help.'), false);
});

test('BLOCKER 2: the permitted emergency-services wording is detected (Codex P1)', () => {
  // The prompt's FIRST permitted wording contains no "988"; the backstop must
  // catch it too or a rule-following model can still evade the close
  assert.equal(isSafetyReferral('Please contact emergency services now.'), true);
  assert.equal(isSafetyReferral('Contact emergency services right away.'), true);
  assert.equal(isSafetyReferral('You should contact emergency services.'), true);
  assert.equal(isSafetyReferral('I need you to call emergency services immediately.'), true);
  assert.equal(isSafetyReferral('This matters far more than a practice interview. Please contact emergency services now, or call or text 988 if you are in the US.'), true);
});

test('BLOCKER 2: echoing a story about emergency services still does not trigger', () => {
  // Past-tense and descriptive echoes have none of the referral shape:
  // no imperative opening, no directive, no urgency word
  assert.equal(isSafetyReferral('So you called emergency services during the incident.'), false);
  assert.equal(isSafetyReferral('You decided to contact emergency services that night.'), false);
  assert.equal(isSafetyReferral('Tell me about the night you had to contact emergency services.'), false);
  // Questions about the duty never match, whatever their tense
  assert.equal(isSafetyReferral('When you contact emergency services in that role, what is the protocol?'), false);
});

test('BLOCKER 2: near-miss numbers and junk input stay false', () => {
  assert.equal(isSafetyReferral('The store extension was 9880.'), false);
  assert.equal(isSafetyReferral('We served 988 customers.'), false);
  assert.equal(isSafetyReferral(''), false);
  assert.equal(isSafetyReferral(null), false);
  assert.equal(isSafetyReferral(undefined), false);
  assert.equal(isSafetyReferral('short'), false);
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

// ------------------------------------------------------------- tool call reads
//
// Two tools are registered now, so the old "an unnamed function call can only be
// the conduct tool" shortcut is unsound — guessing wrong either ends a session
// or warns a candidate for nothing.

test('client tool names match the server-registered tools', () => {
  assert.equal(CONDUCT_TOOL, CONDUCT_TOOL_NAME);
  assert.equal(SAFETY_TOOL, SAFETY_TOOL_NAME);
  const names = INTERVIEWER_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ['conduct_action', 'end_for_safety']);
});

test('a conduct call is read from its dedicated event, preserving the real call_id', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'conduct_action',
    call_id: 'call_real',
    item_id: 'item_other',
    arguments: JSON.stringify({ stage: 'warning' })
  });
  assert.equal(call.tool, 'conduct');
  assert.equal(call.stage, 'warning');
  // The true call_id is what a function_call_output must echo back
  assert.equal(call.callId, 'call_real');
  assert.equal(call.dedupeId, 'call_real');
});

test('a conduct call is read from a response.done output item', () => {
  const call = readToolCall({
    type: 'response.done',
    response: {
      id: 'resp_1',
      output: [
        { type: 'message' },
        { type: 'function_call', name: 'conduct_action', call_id: 'call_9', arguments: '{"stage":"end"}' }
      ]
    }
  });
  assert.equal(call.tool, 'conduct');
  assert.equal(call.stage, 'end');
  assert.equal(call.callId, 'call_9');
});

// The closing-turn gate must be able to tell THIS response's audio from a
// previous turn's, so the response id travels with the call.
test('the response id travels with the call, from either event shape', () => {
  const dedicated = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'conduct_action',
    call_id: 'call_1',
    response_id: 'resp_A',
    arguments: '{"stage":"warning"}'
  });
  assert.equal(dedicated.responseId, 'resp_A');

  const fromDone = readToolCall({
    type: 'response.done',
    response: {
      id: 'resp_B',
      output: [{ type: 'function_call', name: 'end_for_safety', call_id: 'call_2', arguments: '{}' }]
    }
  });
  assert.equal(fromDone.responseId, 'resp_B');
});

test('a missing response id reads as empty rather than undefined', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'conduct_action',
    call_id: 'call_1',
    arguments: '{"stage":"end"}'
  });
  assert.equal(call.responseId, '', 'empty means "cannot match any playing audio"');
});

test('callId is empty when the event carries none, and dedupeId falls back', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'conduct_action',
    item_id: 'item_5',
    arguments: '{"stage":"warning"}'
  });
  assert.equal(call.callId, '', 'no call_id to answer with');
  assert.equal(call.dedupeId, 'item_5', 'replay suppression still has a key');
});

test('a safety call is read and carries no conduct stage', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'end_for_safety',
    call_id: 'call_safe',
    arguments: '{}'
  });
  assert.equal(call.tool, 'safety');
  assert.equal(call.stage, '');
  assert.equal(call.callId, 'call_safe');
});

test('an unnamed call with a valid conduct stage is still read as conduct', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    call_id: 'call_x',
    arguments: '{"stage":"warning"}'
  });
  assert.equal(call.tool, 'conduct');
  assert.equal(call.stage, 'warning');
});

test('an unnamed call with no recognizable stage is refused, never guessed', () => {
  for (const args of ['{}', '', null, '{"stage":"safety"}', 'not json', '{"foo":1}']) {
    const call = readToolCall({
      type: 'response.function_call_arguments.done',
      call_id: 'call_x',
      arguments: args
    });
    assert.equal(call, null, `args ${JSON.stringify(args)} must not be guessed at`);
  }
});

test('a tool we do not own is ignored', () => {
  assert.equal(readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'some_other_tool',
    call_id: 'c1',
    arguments: '{"stage":"end"}'
  }), null);
});

test('events with no tool call at all read as null', () => {
  assert.equal(readToolCall(null), null);
  assert.equal(readToolCall({ type: 'response.done', response: { output: [] } }), null);
  assert.equal(readToolCall({ type: 'response.done', response: {} }), null);
  assert.equal(readToolCall({ type: 'response.done' }), null);
  assert.equal(readToolCall({ type: 'output_audio_buffer.stopped' }), null);
  assert.equal(readToolCall({
    type: 'response.done',
    response: { output: [{ type: 'message', content: [] }] }
  }), null);
});

test('already-parsed argument objects are accepted too', () => {
  const call = readToolCall({
    type: 'response.function_call_arguments.done',
    name: 'conduct_action',
    call_id: 'c1',
    arguments: { stage: 'end' }
  });
  assert.equal(call.stage, 'end');
});

// A safety close must never be routed through the conduct gate: the candidate
// has done nothing wrong, and the gate would both refuse the end (leaving the
// session live) and record a conduct warning against them.
test('the conduct gate would mishandle a safety end, which is why it is bypassed', () => {
  const g = createConductGate();
  assert.equal(g.decide('end', 'call_safety'), 'warn_instead');
  assert.equal(g.wasWarned(), true, 'this is exactly the mislabeling to avoid');
  // The safety path does not call decide() at all, so a real safety end leaves
  // the gate untouched:
  const clean = createConductGate();
  assert.equal(clean.wasWarned(), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
