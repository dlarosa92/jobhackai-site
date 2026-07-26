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

// Must match INTERVIEWER_TOOLS in app/functions/_lib/voice-interviewer.js.
// A test asserts these stay in sync with the server-side names.
export var CONDUCT_TOOL = 'conduct_action';
export var SAFETY_TOOL = 'end_for_safety';

function parseStage(rawArgs) {
  if (rawArgs && typeof rawArgs === 'object') {
    return typeof rawArgs.stage === 'string' ? rawArgs.stage : '';
  }
  try {
    var parsed = JSON.parse(rawArgs || '{}');
    return parsed && typeof parsed.stage === 'string' ? parsed.stage : '';
  } catch (_) {
    return '';
  }
}

function classifyCall(name, rawArgs, callId, fallbackId, responseId) {
  var stage = parseStage(rawArgs);
  var tool = null;
  if (name === CONDUCT_TOOL) {
    tool = 'conduct';
  } else if (name === SAFETY_TOOL) {
    tool = 'safety';
  } else if (!name) {
    // Two tools are registered now, so an unnamed function call is genuinely
    // ambiguous — the old "it can only be the one tool" shortcut is no longer
    // sound. Infer only from an unmistakable argument shape, and otherwise
    // refuse to guess: silently doing nothing is far better than ending a
    // session, or warning a candidate, on a coin flip.
    if (stage === CONDUCT_WARNING_STAGE || stage === CONDUCT_END_STAGE) tool = 'conduct';
    else return null;
  } else {
    return null;   // a tool we do not own
  }
  return {
    tool: tool,
    stage: tool === 'conduct' ? stage : '',
    // The TRUE call_id, needed to answer with a function_call_output. Empty
    // when the event did not carry one.
    callId: callId || '',
    // Stable-enough key for replay suppression, which may fall back.
    dedupeId: callId || fallbackId || '',
    // Which response made this call. The closing-turn gate needs it to tell
    // THIS response's audio from a previous turn's.
    responseId: responseId || ''
  };
}

/**
 * Interpret a realtime event that may carry one of our tool calls, from either
 * the dedicated `response.function_call_arguments.done` event or a
 * `function_call` item inside `response.done`. Returns
 * { tool: 'conduct'|'safety', stage, callId, dedupeId } or null.
 */
export function readToolCall(evt) {
  if (!evt) return null;
  if (evt.type === 'response.function_call_arguments.done') {
    return classifyCall(evt.name, evt.arguments, evt.call_id, evt.item_id || evt.response_id, evt.response_id);
  }
  var out = evt.response && evt.response.output;
  if (!out || !out.length) return null;
  for (var i = 0; i < out.length; i++) {
    var item = out[i];
    if (!item || item.type !== 'function_call') continue;
    var found = classifyCall(
      item.name,
      item.arguments,
      item.call_id,
      item.id || (evt.response && evt.response.id),
      evt.response && evt.response.id
    );
    if (found) return found;
  }
  return null;
}

/**
 * Does this INTERVIEWER utterance contain a crisis referral — the "call or
 * text 988" line the safety rule mandates?
 *
 * This exists because the safety close cannot depend on the model calling
 * end_for_safety: live, it spoke the crisis guidance, skipped the tool, and
 * resumed interview questions. The referral line itself is the most reliable
 * signal that the safety rule fired, so the client treats speaking it as the
 * decision to close and the tool call as a formality.
 *
 * Matches BOTH wordings the prompt permits, since the model may use either:
 *   - "call or text 988": a referral verb with 988 in the same clause
 *   - "contact emergency services now": the emergency-services phrase with a
 *     present-tense referral verb, in a sentence that reads as a directive —
 *     sentence-initial imperative, "please"/"you should", or an urgency word
 * Kept out of legitimate interviews by shape, not just keywords:
 *   - questions never match, so "did you ever call 988 in that role?" in an
 *     interview for a crisis-line job stays an interview question
 *   - past-tense echoes of a candidate's story never match: "so you called
 *     emergency services?" and "you decided to contact emergency services
 *     that night" carry no imperative, directive, or urgency shape
 * Residual false positive, accepted deliberately: a non-question duty
 * description like "in that role you contact emergency services immediately"
 * would close the session politely. Missing a real referral means someone in
 * danger keeps being interviewed; the asymmetry decides it.
 * Feed it interviewer turns only; candidate speech mentioning 988 is content.
 */
export function isSafetyReferral(text) {
  if (typeof text !== 'string' || text.length < 8) return false;
  // Sentence-split without lookbehind (older Safari parses this file too)
  var sentences = text.replace(/([.!?])/g, '$1\n').split('\n');
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].toLowerCase();
    if (!s || s.indexOf('?') >= 0) continue;
    // Interview prompts about crisis-line work are not referrals, and
    // behavioral prompts are often imperative ("describe a time you had to
    // call 988"), so the question filter alone cannot catch them. A real
    // referral never opens with a prompt verb and never frames the call as
    // past experience.
    if (/^\s*(?:please\s+)?(?:describe|tell|walk|talk|share|give|explain)\b/.test(s)) continue;
    if (/\b(?:had to|used to|ever)\s+(?:call|text|dial|contact|reach)\b/.test(s)) continue;
    if (/\b(?:call|text|dial|contact|reach)\b[^]{0,30}\b988\b/.test(s)) return true;
    if (/\b(?:call|contact|reach)\b[^]{0,25}\bemergency services\b/.test(s)) {
      var imperative = /^\s*(?:please\s+)?(?:contact|call|reach(?:\s+out)?(?:\s+to)?)\b/.test(s);
      var directive = /\b(?:please|you should|you need to|i need you to|i want you to)\b/.test(s);
      var urgent = /\b(?:now|right now|immediately|right away|as soon as)\b/.test(s);
      if (imperative || directive || urgent) return true;
    }
  }
  return false;
}

/**
 * Does this INTERVIEWER utterance contain the conduct-warning register — the
 * "that's not language I'll continue an interview through" line?
 *
 * Same rationale as isSafetyReferral: the model speaks the warning and skips
 * the tool, so the spoken line has to count. Detection alone never ends a
 * session — it can record the one warning, and only a SECOND independent
 * conduct signal (another spoken warning or a tool call, from a different
 * response) closes it.
 *
 * Patterns are deliberately narrow, all in non-question sentences:
 *   - "not language ..." (the mandated register)
 *   - a refusal verb + continue/tolerate/accept + language ("I will not
 *     continue the interview through that language")
 *   - "that language has no place / doesn't belong / isn't acceptable ..."
 *     anchored to interview/professional context, so programming-language
 *     talk ("that language is not appropriate for this project") stays out
 *   - "won't be spoken to / talked to (that way)"
 *   - "keep it professional" counts ONLY alongside "stop you there" — either
 *     alone is everyday interviewer speech ("let me stop you there — what was
 *     the outcome?" is an interruption, not a warning)
 */
export function isConductWarningLine(text) {
  if (typeof text !== 'string' || text.length < 12) return false;
  var sentences = text.replace(/([.!?])/g, '$1\n').split('\n');
  var keepProfessional = false;
  var stopYouThere = false;
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].toLowerCase();
    if (!s || s.indexOf('?') >= 0) continue;
    if (/\bnot language\b/.test(s)) return true;
    if (/\b(?:won'?t|will not|would not|wouldn'?t|not going to|refuse to|cannot|can'?t)\b[^]{0,30}\b(?:continue|tolerate|accept|take|allow|put up with|listen to)\b[^]{0,40}\b(?:language|kind of talk|talk like that)\b/.test(s)) return true;
    if (/\b(?:that|this|such) (?:language|kind of talk)\b[^]{0,50}\b(?:no place|doesn'?t belong|does not belong|not acceptable|isn'?t acceptable|not appropriate|isn'?t appropriate)\b[^]{0,40}\b(?:interview|professional|here)\b/.test(s)) return true;
    if (/\b(?:won'?t|will not|not going to) (?:be )?(?:spoken|talked) to\b/.test(s)) return true;
    if (/\bkeep (?:it|this|things) professional\b/.test(s)) keepProfessional = true;
    if (/\bstop you (?:right )?there\b/.test(s)) stopYouThere = true;
  }
  return keepProfessional && stopYouThere;
}

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
  var warnResponseId = '';
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
  // A repeat call once warned escalates to the end only when it is a genuine
  // second incident. The PRIMARY discriminator is response identity: a replay
  // is the same response re-surfacing, while a real second incident is always
  // a fresh response, because the model only speaks again after a new
  // candidate turn. The live speech guard is only the FALLBACK for events
  // that omit response ids — it must never be a second requirement, because
  // requiring both meant that if `input_audio_buffer` events were not
  // delivered, every repeat call was ignored and answered with an instruction
  // to continue: the fully-armed gate produced exactly the endless-warnings
  // failure it existed to prevent.
  function isSecondIncident(responseId) {
    if (responseId && warnResponseId) return responseId !== warnResponseId;
    return spokeSinceWarning;
  }

  function decide(stage, callId, responseId) {
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
        warnResponseId = responseId || '';
        return 'warn_instead';
      }
      if (!isSecondIncident(responseId)) return 'ignore';
      ended = true;
      return 'end';
    }
    if (stage === CONDUCT_WARNING_STAGE) {
      if (warned) {
        // There is no second warning in this policy: one warning, then end.
        // Live, the model kept choosing stage "warning" for every new incident
        // and the session never ended, because only an explicit stage "end"
        // could end it — the gate could refuse an end but never initiate one.
        // A repeat warning that is a genuine second incident escalates exactly
        // as if it had been labeled "end"; a replay or duplicate stays inert.
        if (!isSecondIncident(responseId)) return 'ignore';
        ended = true;
        return 'end';
      }
      warned = true;
      spokeSinceWarning = false;
      warnResponseId = responseId || '';
      return 'warn';
    }
    return 'ignore';
  }

  /**
   * A conduct warning the interviewer SPOKE without reporting it through the
   * tool. Live, the model said the warning register repeatedly and never
   * called conduct_action once, so the gate never heard about any of it and
   * the session could not end — the same skip-the-tool behavior that broke
   * the safety close, fixed the same way: the spoken line is the decision.
   * Returns 'warn' (first warning recorded), 'end' (second incident: close
   * the session), or 'ignore' (duplicate transcript event, same response as
   * the recorded warning, or no way to prove a second incident).
   */
  function noteSpokenWarning(responseId) {
    if (ended) return 'ignore';
    if (!warned) {
      warned = true;
      spokeSinceWarning = false;
      warnResponseId = responseId || '';
      return 'warn';
    }
    // The same response's own spoken line (or its duplicate transcript event)
    // is the warning we already have, not a second one.
    if (responseId && warnResponseId && responseId === warnResponseId) return 'ignore';
    // Ids incomplete: only end with independent evidence of a second incident.
    if (!(responseId && warnResponseId) && !spokeSinceWarning) return 'ignore';
    ended = true;
    return 'end';
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
    warnResponseId = '';
    seen = Object.create(null);
  }

  return {
    decide: decide,
    noteSpokenWarning: noteSpokenWarning,
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
  window.readVoiceToolCall = readToolCall;
  window.isSafetyReferral = isSafetyReferral;
  window.isConductWarningLine = isConductWarningLine;
}
