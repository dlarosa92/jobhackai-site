/**
 * Conduct escalation gate for the voice mock interview.
 *
 * "One clear warning, then end" used to live only in the interviewer's prompt,
 * which means nothing actually stopped the model from ending a session it had
 * never warned — a false positive would have closed a legitimate interview and
 * consumed the candidate's session. The interviewer now reports each conduct
 * action as a two-stage tool call, and this gate decides what the client does
 * with it, so the rule holds in application state regardless of how well the
 * model follows instructions.
 *
 * Refusing an unwarned end still counts as the warning. That way a genuinely
 * abusive candidate is closed out on their next incident rather than getting a
 * free pass, and the deviation is recorded against the session instead of
 * disappearing.
 *
 * The rule survives duplicate events. Realtime surfaces one tool call twice —
 * as its own `response.function_call_arguments.done` and again in the
 * `response.done` output — and the two carry different id fields, so id-based
 * dedupe alone is not enough: a replay whose id resolved differently would find
 * the warning the refusal had just recorded and end the session on the FIRST
 * offense. The load-bearing guard is therefore behavioral, not id-based: ending
 * requires the candidate to have spoken again since the warning. A replayed
 * tool call cannot manufacture new candidate speech, so it can never escalate.
 */

export var CONDUCT_WARNING_STAGE = 'warning';
export var CONDUCT_END_STAGE = 'end';

/**
 * The only realtime events allowed to mark "the candidate spoke again".
 *
 * Both fire live, while the candidate is at the microphone, and both precede the
 * model response for that same utterance. A whisper transcript
 * (`conversation.item.input_audio_transcription.completed`) is deliberately NOT
 * here: it is computed asynchronously and can land long after the audio it
 * describes, including audio from BEFORE the warning. Accepting it let the
 * transcript of the FIRST offense retroactively satisfy "spoke since warning",
 * so a replayed end call passed the gate and closed the interview on a first
 * offense — the exact failure the gate exists to prevent. The allowlist lives
 * here, not at the call site, so a future caller cannot reintroduce it.
 */
export var LIVE_CANDIDATE_SPEECH_EVENTS = [
  'input_audio_buffer.speech_started',
  'input_audio_buffer.committed'
];

export function createConductGate() {
  var warned = false;
  var deviated = false;
  var spokeSinceWarning = false;
  var ended = false;
  var seen = Object.create(null);

  /**
   * What the client should do with a reported conduct stage:
   *   'warn'         record the warning; the interview continues
   *   'warn_instead' an end was requested with no prior warning: refuse the
   *                  end, but treat this as the warning
   *   'end'          end the session (warned, and the conduct continued)
   *   'ignore'       nothing to do — a duplicate call, a duplicate warning, an
   *                  end with no new candidate speech since the warning, or an
   *                  unknown stage
   *
   * `callId` identifies the tool call, and is a cheap first layer of replay
   * defense. It is deliberately NOT the only one; see the note above.
   */
  function decide(stage, callId) {
    // Once the session is ending there is nothing left to decide, so a replay
    // of the end call cannot re-trigger it however its id resolves.
    if (ended) return 'ignore';
    if (callId) {
      if (seen[callId]) return 'ignore';
      seen[callId] = true;
    }
    if (stage === CONDUCT_END_STAGE) {
      if (!warned) {
        warned = true;
        deviated = true;
        spokeSinceWarning = false;
        return 'warn_instead';
      }
      // Warned already, but the candidate has not said anything since. There is
      // no "continued" behavior to end over, so this is a replay or an
      // immediate re-call, not a second offense.
      if (!spokeSinceWarning) return 'ignore';
      ended = true;
      return 'end';
    }
    if (stage === CONDUCT_WARNING_STAGE) {
      if (warned) return 'ignore';
      warned = true;
      spokeSinceWarning = false;
      return 'warn';
    }
    return 'ignore';
  }

  /**
   * The candidate started or finished speaking, per `eventType`. Only the live
   * events in LIVE_CANDIDATE_SPEECH_EVENTS count; anything else — notably a late
   * whisper transcript, which may describe pre-warning audio — is rejected here
   * rather than trusted to the caller. See that constant for why.
   */
  function noteCandidateSpoke(eventType) {
    if (LIVE_CANDIDATE_SPEECH_EVENTS.indexOf(eventType) < 0) return;
    if (warned) spokeSinceWarning = true;
  }

  // Reported to /complete so a conduct termination is auditable, and so a
  // session where the model skipped the warning is countable separately.
  function endReason() {
    return deviated ? 'ended_by_interviewer_unwarned' : 'ended_by_interviewer';
  }

  function wasWarned() { return warned; }

  // Only for a brand-new session. A reconnect must NOT reset this, or a
  // candidate could clear their warning by dropping the connection.
  function reset() {
    warned = false;
    deviated = false;
    spokeSinceWarning = false;
    ended = false;
    seen = Object.create(null);
  }

  return {
    decide: decide,
    noteCandidateSpoke: noteCandidateSpoke,
    endReason: endReason,
    wasWarned: wasWarned,
    reset: reset
  };
}

/**
 * Tracks when the interviewer's closing turn is actually finished, so a conduct
 * end does not cut her off mid-sentence, lose the response's token usage, or
 * tear down the channel before the triggering utterance is transcribed.
 *
 * Audio counts as settled only once audio that began AFTER the end was
 * requested has stopped. Reading a live "is audio playing" flag at request time
 * is wrong: on a conduct end the tool call routinely arrives before
 * `output_audio_buffer.started` for the closing line, while the PREVIOUS turn's
 * audio has already stopped — so the flag says "nothing playing" and the wait is
 * skipped exactly when it was needed. When the response completes and no
 * closing audio has begun, a short grace window decides whether any is coming.
 *
 * Timers are injectable so this is testable without real time.
 */
export function createClosingTurnGate(opts) {
  opts = opts || {};
  var timeoutMs = opts.timeoutMs != null ? Number(opts.timeoutMs) : 6000;
  var graceMs = opts.graceMs != null ? Number(opts.graceMs) : 750;
  var setT = opts.setTimeout || setTimeout;
  var clearT = opts.clearTimeout || clearTimeout;
  var onDone = typeof opts.onDone === 'function' ? opts.onDone : function () {};

  var active = false;
  var responseDone = false;
  var audioStarted = false;
  var audioStopped = false;
  var noAudio = false;
  var timer = null;
  var graceTimer = null;

  function clearTimers() {
    if (timer) { clearT(timer); timer = null; }
    if (graceTimer) { clearT(graceTimer); graceTimer = null; }
  }

  function finish(reason) {
    if (!active) return;
    active = false;
    clearTimers();
    onDone(reason);
  }

  function audioSettled() {
    return audioStarted ? audioStopped : noAudio;
  }

  function evaluate() {
    if (!active || !responseDone) return;
    if (audioSettled()) { finish('complete'); return; }
    // The response is complete but no closing audio has begun. Give it a moment
    // to show up before concluding there is none.
    if (!audioStarted && !graceTimer) {
      graceTimer = setT(function () {
        graceTimer = null;
        if (!active || audioStarted) return;
        noAudio = true;
        evaluate();
      }, graceMs);
    }
  }

  /** Begin waiting. `audioAlreadyPlaying` means the closing line is mid-flight. */
  function start(audioAlreadyPlaying) {
    if (active) return false;
    active = true;
    responseDone = false;
    audioStarted = !!audioAlreadyPlaying;
    audioStopped = false;
    noAudio = false;
    // Absolute backstop: a dropped event must never hold the session open.
    timer = setT(function () { timer = null; finish('timeout'); }, timeoutMs);
    return true;
  }

  function noteResponseDone() {
    if (!active) return;
    responseDone = true;
    evaluate();
  }

  function noteAudioStarted() {
    if (!active) return;
    audioStarted = true;
    audioStopped = false;
    if (graceTimer) { clearT(graceTimer); graceTimer = null; }
  }

  function noteAudioStopped() {
    if (!active) return;
    if (!audioStarted) return;   // stale stop from a previous turn
    audioStopped = true;
    evaluate();
  }

  /** Abandon the wait (the session is ending for some other reason). */
  function cancel() {
    if (!active) return;
    active = false;
    clearTimers();
  }

  function isActive() { return active; }

  return {
    start: start,
    noteResponseDone: noteResponseDone,
    noteAudioStarted: noteAudioStarted,
    noteAudioStopped: noteAudioStopped,
    cancel: cancel,
    isActive: isActive
  };
}

if (typeof window !== 'undefined') {
  window.createConductGate = createConductGate;
  window.createClosingTurnGate = createClosingTurnGate;
}
