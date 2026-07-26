// Interview lifecycle test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-lifecycle.test.mjs
//
// Two live defects shared one root cause — the client had no lifecycle, so
// speech before the official interview was committed and scored, and after
// the interviewer announced the report the session kept accepting speech and
// could carry on interviewing. These tests pin the boundary:
//
//   CONNECTING -> AUDIO_CHECK -> ACTIVE_INTERVIEW -> CLOSING -> COMPLETE
//
// with the two invariants that make it robust against realtime's event
// model: item verdicts are permanent (a whisper transcript arriving late
// cannot re-litigate them), and exclusion always beats inclusion.

import assert from 'node:assert/strict';
import {
  createInterviewLifecycle,
  isClosingAnnouncement,
  isHearingCheckTurn,
  LIFECYCLE
} from '../../../../js/voice-lifecycle.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

// Drive a lifecycle through the normal happy path up to the requested phase.
function lifecycleAt(phase) {
  const lc = createInterviewLifecycle();
  if (phase === LIFECYCLE.CONNECTING) return lc;
  lc.to(LIFECYCLE.AUDIO_CHECK);
  if (phase === LIFECYCLE.AUDIO_CHECK) return lc;
  lc.noteGreetingDone();
  lc.noteUserCommitted('item_ack');
  if (phase === LIFECYCLE.ACTIVE_INTERVIEW) return lc;
  lc.to(LIFECYCLE.CLOSING);
  if (phase === LIFECYCLE.CLOSING) return lc;
  lc.to(LIFECYCLE.COMPLETE);
  return lc;
}

// ------------------------------------------------------------ transitions

test('a fresh lifecycle starts in CONNECTING and commits nothing', () => {
  const lc = createInterviewLifecycle();
  assert.equal(lc.phase(), LIFECYCLE.CONNECTING);
  assert.equal(lc.shouldCommit(null), false);
  assert.equal(lc.shouldCommit('item_1'), false);
});

test('the forward path is the only path: connecting -> audio check -> active -> closing -> complete', () => {
  const lc = createInterviewLifecycle();
  assert.equal(lc.to(LIFECYCLE.AUDIO_CHECK), true);
  assert.equal(lc.to(LIFECYCLE.ACTIVE_INTERVIEW), true);
  assert.equal(lc.to(LIFECYCLE.CLOSING), true);
  assert.equal(lc.to(LIFECYCLE.COMPLETE), true);
  assert.equal(lc.phase(), LIFECYCLE.COMPLETE);
});

test('skipping ahead is rejected: no CLOSING before the interview, no ACTIVE from CONNECTING', () => {
  const lc = createInterviewLifecycle();
  assert.equal(lc.to(LIFECYCLE.CLOSING), false);
  assert.equal(lc.to(LIFECYCLE.ACTIVE_INTERVIEW), false);
  assert.equal(lc.phase(), LIFECYCLE.CONNECTING);
});

test('COMPLETE is reachable from every phase, so every existing terminal path keeps working', () => {
  for (const phase of [LIFECYCLE.CONNECTING, LIFECYCLE.AUDIO_CHECK, LIFECYCLE.ACTIVE_INTERVIEW, LIFECYCLE.CLOSING]) {
    const lc = lifecycleAt(phase);
    assert.equal(lc.to(LIFECYCLE.COMPLETE), true, `complete must be reachable from ${phase}`);
  }
});

test('nothing leaves COMPLETE: repeated or late transition callbacks cannot reopen the session', () => {
  const lc = lifecycleAt(LIFECYCLE.COMPLETE);
  assert.equal(lc.to(LIFECYCLE.ACTIVE_INTERVIEW), false);
  assert.equal(lc.to(LIFECYCLE.AUDIO_CHECK), false);
  assert.equal(lc.to(LIFECYCLE.CLOSING), false);
  assert.equal(lc.to(LIFECYCLE.COMPLETE), false, 'even complete->complete reports no transition');
  assert.equal(lc.phase(), LIFECYCLE.COMPLETE);
});

test('entering CLOSING twice reports false the second time — one wrap-up, not two', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.to(LIFECYCLE.CLOSING), true);
  assert.equal(lc.to(LIFECYCLE.CLOSING), false);
});

// ------------------------------------------- regression 1: pre-start speech

test('speech committed while CONNECTING is excluded forever, even after the interview goes ACTIVE', () => {
  const lc = createInterviewLifecycle();
  assert.equal(lc.noteUserCommitted('item_prestart'), 'excluded');
  // Interview proceeds normally afterwards...
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  lc.noteUserCommitted('item_ack');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  // ...and the pre-start item's late whisper transcript still may not commit.
  assert.equal(lc.shouldCommit('item_prestart'), false);
});

test('speech before the greeting finishes does not start the interview and is excluded', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  // The candidate talks over the connecting/greeting phase.
  assert.equal(lc.noteUserCommitted('item_early'), 'excluded');
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK, 'no transition before the greeting is done');
  assert.equal(lc.shouldCommit('item_early'), false);
});

test('items announced outside the active interview are not forwarded to the transcript assembler', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  assert.equal(lc.noteItem('item_greeting'), false, 'the greeting item is not interview material');
  assert.equal(lc.shouldCommit('item_greeting'), false);
});

// ------------------------------------- regression 2: audio-check exclusion

test('the audio-check exchange is excluded end to end, and the ack starts the interview', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  // Interviewer's greeting item announced during the check
  assert.equal(lc.noteItem('item_greeting'), false);
  lc.noteGreetingDone();
  // Candidate acknowledges: the commit transitions to ACTIVE...
  assert.equal(lc.noteUserCommitted('item_ack'), 'begin_interview');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  // ...but the acknowledgement itself is excluded, including via the
  // conversation.item.created event that arrives AFTER the transition.
  assert.equal(lc.noteItem('item_ack'), false, 'exclusion beats a later announcement in ACTIVE');
  assert.equal(lc.shouldCommit('item_ack'), false, 'the late whisper transcript of the ack never commits');
  assert.equal(lc.shouldCommit('item_greeting'), false);
});

test('a reconnect during the audio check re-arms the greeting instead of skipping the check', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  assert.equal(lc.isGreetingDone(), true);
  lc.noteReconnect();
  assert.equal(lc.isGreetingDone(), false, 'the fresh realtime session greets again');
  // The next commit is pre-greeting chatter again, not the acknowledgement.
  assert.equal(lc.noteUserCommitted('item_after_drop'), 'excluded');
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK);
});

test('a reconnect mid-interview changes nothing: the phase stays ACTIVE and turns keep committing', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteReconnect();
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteItem('item_after_reconnect'), true);
  assert.equal(lc.shouldCommit('item_after_reconnect'), true);
});

// --------------------------------------- regression 3: active turns commit

test('genuine interview turns are committed: user commits and assistant items in ACTIVE', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteUserCommitted('item_answer'), 'committed');
  assert.equal(lc.noteItem('item_answer'), true, 'the answer item is forwarded to the assembler');
  assert.equal(lc.noteItem('item_question'), true);
  assert.equal(lc.shouldCommit('item_answer'), true);
  assert.equal(lc.shouldCommit('item_question'), true);
});

test('a whisper transcript for an ACTIVE item still commits when it arrives during CLOSING', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteUserCommitted('item_last_answer');
  lc.to(LIFECYCLE.CLOSING);
  // The candidate's final answer was in flight when the wrap-up began; its
  // transcript arriving late must not be dropped.
  assert.equal(lc.shouldCommit('item_last_answer'), true);
});

test('id-less transcripts fall back to the phase at arrival: ACTIVE commits, everything else does not', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.shouldCommit(null), true);
  lc.to(LIFECYCLE.CLOSING);
  assert.equal(lc.shouldCommit(null), false);
});

test('a dropped item announcement never deletes a genuine ACTIVE turn (transcript-order parity)', () => {
  // The assembler appends transcripts whose announcement was lost rather than
  // dropping them — a missing turn corrupts the score, a mis-ordered one is
  // cosmetic. The lifecycle honors the same rule: an UNKNOWN item commits by
  // the phase at arrival, while every excluded turn is excluded by an
  // explicit verdict, never by luck of event delivery.
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.shouldCommit('item_never_announced'), true);
  lc.to(LIFECYCLE.CLOSING);
  assert.equal(lc.shouldCommit('item_also_never_announced'), false, 'unknown ids outside ACTIVE stay out');
});

// ------------------------------------------------ regression 4: closing

test('entering CLOSING immediately excludes new items and new speech', () => {
  const lc = lifecycleAt(LIFECYCLE.CLOSING);
  assert.equal(lc.noteItem('item_late_chatter'), false);
  assert.equal(lc.noteUserCommitted('item_late_speech'), 'excluded');
  assert.equal(lc.shouldCommit('item_late_chatter'), false);
  assert.equal(lc.shouldCommit('item_late_speech'), false);
  assert.equal(lc.phase(), LIFECYCLE.CLOSING, 'late speech cannot restart the interview');
});

test('late chatter after COMPLETE is excluded and cannot reopen anything', () => {
  const lc = lifecycleAt(LIFECYCLE.COMPLETE);
  assert.equal(lc.noteUserCommitted('item_postgame'), 'excluded');
  assert.equal(lc.noteItem('item_postgame_2'), false);
  assert.equal(lc.phase(), LIFECYCLE.COMPLETE);
});

// ---------------------------------- regression 5: repeated / late callbacks

test('replayed committed events cannot re-trigger the interview start', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  assert.equal(lc.noteUserCommitted('item_ack'), 'begin_interview');
  // The same event replayed — and any later commit — is an ordinary commit,
  // never a second "begin".
  assert.equal(lc.noteUserCommitted('item_ack'), 'committed');
  assert.equal(lc.noteUserCommitted('item_next'), 'committed');
  // Replay did not re-include the excluded ack:
  assert.equal(lc.shouldCommit('item_ack'), false);
});

test('exclusion is permanent: no later event can re-include an excluded item', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.excludeItem('item_x');
  assert.equal(lc.noteItem('item_x'), false);
  assert.equal(lc.noteUserCommitted('item_x'), 'committed', 'the phase answer is committed...');
  assert.equal(lc.shouldCommit('item_x'), false, '...but the excluded item itself still never commits');
});

test('a duplicate greeting-done (replayed response.done) is harmless', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  lc.noteGreetingDone();
  assert.equal(lc.noteUserCommitted('item_ack'), 'begin_interview');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
});

test('greeting-done outside the audio check is ignored, so a late response.done cannot arm anything', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteGreetingDone();   // e.g. a straggler event after the interview began
  lc.to(LIFECYCLE.CLOSING);
  assert.equal(lc.noteUserCommitted('item_late'), 'excluded', 'no begin_interview from CLOSING');
});

// ------------------- the cannot-hear round (PR #848 review, P1 finding)

test('the happy path confirms: the first real opening closes the window permanently', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.isAwaitingOpening(), true, 'the ack is provisional until the opening lands');
  assert.equal(
    lc.noteAssistantTurn('item_open', 'Welcome to your mock interview for the Data Analyst role. Tell me about a recent analysis you owned.'),
    'confirmed'
  );
  assert.equal(lc.isAwaitingOpening(), false);
  assert.equal(lc.shouldCommit('item_open'), true, 'the opening itself commits');
});

test('a cannot-hear reply demotes: the repeated check and the whole round stay excluded', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteItem('item_greet');
  lc.noteGreetingDone();
  // The candidate replies — but it was "I can't hear you", not a confirmation.
  assert.equal(lc.noteUserCommitted('item_cant_hear'), 'begin_interview');
  // The model re-runs the check; the app walks the provisional transition back.
  lc.noteItem('item_check2');
  assert.equal(lc.noteAssistantTurn('item_check2', 'Let me try that again — can you hear me clearly now?'), 'demoted');
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK);
  assert.equal(lc.shouldCommit('item_check2'), false, 'the repeated check never commits');
  assert.equal(lc.shouldCommit('item_cant_hear'), false);
  // The greeting stays armed: the next commit is the next provisional ack.
  assert.equal(lc.isGreetingDone(), true);
  assert.equal(lc.noteUserCommitted('item_real_ack'), 'begin_interview');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.shouldCommit('item_real_ack'), false, 'the real acknowledgement is excluded too');
  // And the real opening confirms and commits.
  lc.noteItem('item_open');
  assert.equal(lc.noteAssistantTurn('item_open', 'Welcome. Walk me through a recent analysis you owned.'), 'confirmed');
  assert.equal(lc.shouldCommit('item_open'), true);
});

test('user speech committed inside the settling window is pulled back out on demotion', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);   // provisional ack given
  // The candidate barges in over the repeated check before its transcript lands.
  assert.equal(lc.noteUserCommitted('item_barge'), 'committed');
  assert.equal(lc.shouldCommit('item_barge'), true, 'included until the window settles');
  assert.equal(lc.noteAssistantTurn('item_check2', 'Can you hear me now?'), 'demoted');
  assert.equal(lc.shouldCommit('item_barge'), false, 'demotion excludes the whole round');
});

test('a demotion reports every item of its round for assembler purge', () => {
  // Exclusion gates future writes; a whisper that landed inside the window is
  // already written, so the caller purges these ids from the assembler.
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.deepEqual(lc.demotedItems(), [], 'nothing to purge before any demotion');
  lc.noteUserCommitted('item_barge');
  lc.noteAssistantTurn('item_check2', 'Can you hear me now?');
  assert.deepEqual(lc.demotedItems(), ['item_check2', 'item_barge']);
  // Each round replaces the list: the next demotion reports only its own items.
  lc.noteUserCommitted('item_ack2');
  lc.noteAssistantTurn('item_check3', 'How about now — can you hear me?');
  assert.deepEqual(lc.demotedItems(), ['item_check3']);
});

test('multiple cannot-hear rounds converge, each round fully excluded', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteAssistantTurn('item_c2', 'Can you hear me now?'), 'demoted');
  assert.equal(lc.noteUserCommitted('item_ack2'), 'begin_interview');
  assert.equal(lc.noteAssistantTurn('item_c3', 'How about now — are you able to hear me?'), 'demoted');
  assert.equal(lc.noteUserCommitted('item_ack3'), 'begin_interview');
  assert.equal(lc.noteAssistantTurn('item_open', 'Great. Welcome — tell me about your current role.'), 'confirmed');
  for (const id of ['item_c2', 'item_ack2', 'item_c3', 'item_ack3']) {
    assert.equal(lc.shouldCommit(id), false, `${id} must stay excluded`);
  }
  assert.equal(lc.shouldCommit('item_open'), true);
});

test('the window is one-shot: a mid-interview hearing check can never drag the session backwards', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteAssistantTurn('item_open', 'Welcome. First question: what drew you to this role?'), 'confirmed');
  // Minutes later the interviewer checks the line after a blip — that is
  // conversation now, not lifecycle.
  assert.equal(lc.noteAssistantTurn('item_blip', 'Sorry, you cut out for a second — can you hear me okay?'), 'none');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteItem('item_blip'), true, 'the mid-interview check commits like any turn');
});

test('demotion is internal only: to() remains forward-only from ACTIVE', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.to(LIFECYCLE.AUDIO_CHECK), false);
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
});

test('settling never happens outside an open window: junk, empty, closing, terminal', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.noteAssistantTurn('item_x', ''), 'none', 'empty transcripts do not settle the window');
  assert.equal(lc.noteAssistantTurn('item_x', '   '), 'none');
  assert.equal(lc.isAwaitingOpening(), true, 'window still open after junk');
  lc.to(LIFECYCLE.CLOSING);
  assert.equal(lc.noteAssistantTurn('item_y', 'Can you hear me now?'), 'none');
  lc.to(LIFECYCLE.COMPLETE);
  assert.equal(lc.noteAssistantTurn('item_z', 'Can you hear me now?'), 'none');
});

test('a reconnect after a demotion re-greets like any audio-check drop', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteAssistantTurn('item_c2', 'Can you hear me now?');   // demoted
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK);
  lc.noteReconnect();
  assert.equal(lc.isGreetingDone(), false, 'the fresh session greets again');
});

// ---------------- content-based greeting arming (Bugbot: greeting done on any response)

test('a racing auto-response that is not the hearing question arms nothing', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  // The model replied to pre-start chatter with something else entirely.
  lc.noteAudioCheckTranscript("I'm sorry, I didn't quite catch that.");
  lc.noteGreetingDone();
  assert.equal(lc.isGreetingDone(), false, 'a non-check response must not arm the acknowledgement');
  assert.equal(lc.noteUserCommitted('item_x'), 'excluded', 'the next commit is still pre-interview chatter');
  // The model then actually asks the hearing question: NOW it arms.
  lc.noteAudioCheckTranscript('Hi. Before we begin, can you hear me clearly?');
  assert.equal(lc.isGreetingDone(), true);
  assert.equal(lc.noteUserCommitted('item_ack'), 'begin_interview');
});

test('a greeting cut off before the question does not arm; the re-ask does', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteAudioCheckTranscript('Hi, before we begin');   // barge-in truncated the line
  lc.noteGreetingDone();
  assert.equal(lc.isGreetingDone(), false);
  lc.noteAudioCheckTranscript('Let me try again — can you hear me clearly?');
  assert.equal(lc.isGreetingDone(), true);
});

test('liveness fallback: a response with no transcript seen still arms the check', () => {
  // Never arming on lost transcript events would strand the session in
  // AUDIO_CHECK and exclude the entire interview — the worse failure.
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  assert.equal(lc.isGreetingDone(), true);
});

test('the spoken flag is per response: a later transcript-less response uses the fallback', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteAudioCheckTranscript('One moment.');
  lc.noteGreetingDone();                    // spoke, not a check: no arm, flag resets
  assert.equal(lc.isGreetingDone(), false);
  lc.noteGreetingDone();                    // next response: nothing spoken at all
  assert.equal(lc.isGreetingDone(), true, 'liveness fallback applies per response');
});

test('out-of-order events: a fallback arm is revoked when its transcript turns out not to be the question', () => {
  // response.done processed before the response's transcript (out-of-order
  // delivery): the liveness fallback arms on the unknown response...
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  assert.equal(lc.isGreetingDone(), true, 'fallback armed the unknown response');
  // ...then the transcript arrives late and is NOT the hearing question:
  // the guess is revoked, and the next commit stays pre-interview chatter.
  lc.noteAudioCheckTranscript("I'm sorry, I didn't quite catch that.");
  assert.equal(lc.isGreetingDone(), false, 'late knowledge revokes the guess');
  assert.equal(lc.noteUserCommitted('item_x'), 'excluded');
  // The real hearing question then arms by content as usual.
  lc.noteAudioCheckTranscript('Hi. Before we begin, can you hear me clearly?');
  assert.equal(lc.noteUserCommitted('item_ack'), 'begin_interview');
});

test('a late transcript that IS the question keeps a fallback arm (content-confirms it)', () => {
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  lc.noteAudioCheckTranscript('Hi. Before we begin, can you hear me clearly?');
  assert.equal(lc.isGreetingDone(), true);
  // A later non-check line can never revoke a content-confirmed arm.
  lc.noteAudioCheckTranscript('Take your time.');
  assert.equal(lc.isGreetingDone(), true);
});

test('a pre-ack straggler transcript settles nothing: the window waits for a post-ack turn', () => {
  // The greeting's response (r_pre) was last seen when the ack opened the
  // window; its transcript arriving late — or replayed — is not the turn
  // that answers the acknowledgement.
  const lc = createInterviewLifecycle();
  lc.to(LIFECYCLE.AUDIO_CHECK);
  lc.noteGreetingDone();
  assert.equal(lc.noteUserCommitted('item_ack', 'r_pre'), 'begin_interview');
  // A replayed greeting transcript (hearing-check shaped!) from the pre-ack
  // response must not spuriously demote the open window...
  assert.equal(lc.noteAssistantTurn('item_greet', 'Hi. Before we begin, can you hear me clearly?', 'r_pre'), 'none');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.isAwaitingOpening(), true, 'the window is still open');
  // ...and a late non-check straggler must not confirm it either — otherwise
  // the real hearing question would arrive post-settlement and be committed.
  assert.equal(lc.noteAssistantTurn('item_pre2', 'One moment.', 'r_pre'), 'none');
  assert.equal(lc.isAwaitingOpening(), true);
  // The genuinely post-ack turn settles as usual: here, a re-check demotes.
  assert.equal(lc.noteAssistantTurn('item_recheck', 'Can you hear me clearly now?', 'r_post'), 'demoted');
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK);
});

test('settling without response ids keeps the previous behavior', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);   // helper passes no ids
  assert.equal(lc.noteAssistantTurn('item_open', 'Welcome. Tell me about your current role.'), 'confirmed');
});

test('audio-check transcripts outside AUDIO_CHECK arm nothing', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteAssistantTurn('item_open', 'Welcome. First question: what drew you here?');   // settle
  lc.noteAudioCheckTranscript('Can you hear me clearly?');   // mid-interview line
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
});

// ------- the settling window across a reconnect (Bugbot: window survives reconnect)

test('a reconnect does not close an open settling window, and the window settles on the new connection', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);   // provisional ack, window open
  lc.noteReconnect();
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.isAwaitingOpening(), true, 'the unsettled window survives the drop');
  // The resumed session re-runs the check (interviewStarted was false):
  // the window demotes on it and client converges with the server.
  assert.equal(lc.noteAssistantTurn('item_recheck', 'Hi. Before we begin, can you hear me clearly?'), 'demoted');
  assert.equal(lc.phase(), LIFECYCLE.AUDIO_CHECK);
  assert.equal(lc.noteUserCommitted('item_ack2'), 'begin_interview');
});

test('a settled interview reconnects with no window, so no resume line can ever demote it', () => {
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  lc.noteAssistantTurn('item_open', 'Welcome. Tell me about your current role.');
  lc.noteReconnect();
  assert.equal(lc.isAwaitingOpening(), false);
  assert.equal(lc.noteAssistantTurn('item_resume', 'Welcome back — can you hear me okay?'), 'none');
  assert.equal(lc.phase(), LIFECYCLE.ACTIVE_INTERVIEW, 'a hearing-shaped resume line is conversation, not lifecycle');
});

// ------------------------------------ the hearing-check detector

test('hearing-check turns are detected across the register', () => {
  assert.equal(isHearingCheckTurn('Can you hear me clearly?'), true);
  assert.equal(isHearingCheckTurn('Let me try that again. Can you hear me now?'), true);
  assert.equal(isHearingCheckTurn('Hearing me okay this time?'), true);
  assert.equal(isHearingCheckTurn('Is my audio coming through better?'), true);
  assert.equal(isHearingCheckTurn('Am I coming through?'), true);
  assert.equal(isHearingCheckTurn('Are you able to hear me alright?'), true);
});

test('precision bias: no real interview opening or question reads as a hearing check', () => {
  // The mandated opening: statement + first question, no hearing register
  assert.equal(isHearingCheckTurn('Welcome to your mock interview for the Senior Software Engineer role. Tell me about a recent project you led.'), false);
  // Interview questions about hearing/audio-adjacent topics
  assert.equal(isHearingCheckTurn('Tell me about a time you felt your ideas were not heard by your team?'), false);
  assert.equal(isHearingCheckTurn('What would you do if a customer said they could not hear you on a support call?'), false);
  assert.equal(isHearingCheckTurn('How do you make yourself heard in a loud, fast-moving incident channel?'), false);
  // Statements never match: hearing checks are questions
  assert.equal(isHearingCheckTurn('I can hear you clearly now, thank you.'), false);
  // Junk
  assert.equal(isHearingCheckTurn(''), false);
  assert.equal(isHearingCheckTurn(null), false);
});

// ------------------------------------------- the closing-line detector

test('the mandated closing register is detected', () => {
  assert.equal(isClosingAnnouncement(
    'Thank you for your time today, Maya. I enjoyed hearing about the checkout migration. ' +
    'Your feedback report is being prepared and will appear on this page.'
  ), true);
});

test('closing variants: wrap signal + report on its way', () => {
  assert.equal(isClosingAnnouncement(
    "That concludes our interview. Thanks so much for talking with me. " +
    "Your report is on its way and will appear on this page shortly."
  ), true);
  assert.equal(isClosingAnnouncement(
    'I have no further questions. Thank you for your time. Your feedback report is being generated now.'
  ), true);
});

test('the "when will I hear back" deflection never closes the session: it carries the next question', () => {
  assert.equal(isClosingAnnouncement(
    'Your feedback report is ready on this page right after the session ends. ' +
    'Now, tell me about a time you had to handle a conflict on your team?'
  ), false);
});

test('a report mention without the closing register does not close the session', () => {
  // Deflection phrased as a statement, but with no thanks and no wrap signal
  assert.equal(isClosingAnnouncement(
    'The written report is ready on this page moments after the session ends. Let us keep going.'
  ), false);
  // Mid-interview acknowledgment thanks, no report sentence
  assert.equal(isClosingAnnouncement(
    'Thank you for sharing that. It sounds like the launch was a turning point.'
  ), false);
  // Wrap-adjacent language without any report sentence
  assert.equal(isClosingAnnouncement(
    "That's all I wanted to cover on that project. Let's move on."
  ), false);
});

test('any question mark disqualifies the turn — a closing turn is a statement', () => {
  assert.equal(isClosingAnnouncement(
    'Thank you for your time today. Your feedback report is being prepared. ' +
    'Is there anything you would like to add?'
  ), false);
});

test('candidate-shaped and junk input is never a closing signal', () => {
  assert.equal(isClosingAnnouncement(''), false);
  assert.equal(isClosingAnnouncement(null), false);
  assert.equal(isClosingAnnouncement(undefined), false);
  assert.equal(isClosingAnnouncement('thanks'), false);
  assert.equal(isClosingAnnouncement('ok great'), false);
});

// -------------------------------------- regression 6: terminal-path shape

test('the safety/conduct/manual/timeout shape holds: ACTIVE -> COMPLETE directly, skipping CLOSING', () => {
  // Guarded ends (conduct, safety) and manual ends complete without a
  // wrap-up phase; the lifecycle must allow that path untouched.
  const lc = lifecycleAt(LIFECYCLE.ACTIVE_INTERVIEW);
  assert.equal(lc.to(LIFECYCLE.COMPLETE), true);
  assert.equal(lc.phase(), LIFECYCLE.COMPLETE);
});

test('a session ended during the audio check (manual end, failure) completes cleanly with nothing committed', () => {
  const lc = lifecycleAt(LIFECYCLE.AUDIO_CHECK);
  lc.noteItem('item_greeting');
  assert.equal(lc.to(LIFECYCLE.COMPLETE), true);
  assert.equal(lc.shouldCommit('item_greeting'), false);
  assert.equal(lc.shouldCommit(null), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
